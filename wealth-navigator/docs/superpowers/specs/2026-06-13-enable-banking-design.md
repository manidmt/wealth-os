# Integración Enable Banking (PSD2 gratuito) — Design

**Date:** 2026-06-13
**Scope:** Importar transacciones bancarias reales a `movements` vía Enable Banking (API gratuita uso personal), con auto-categorización a las categorías existentes, botón manual + cron diario. Reaprovecha la arquitectura ya codeada para GoCardless (tabla `bank_connections`, `movements.external_id`, ruta `/bank-callback`, sección de Ajustes), retirando `gocardless.ts`.
**Out of scope:** posiciones de inversión (PSD2 solo cubre cuenta corriente), conversión FX, edición de reglas de categorización desde la UI (el mapa es editable en código).

## Decisiones (brainstorming aprobado)
- Selector amplio de bancos ES (lista dinámica desde `/aspsps?country=ES`).
- Sync: botón manual en Ajustes + pg_cron diario (`bank-sync-all`).
- Auto-categorización por palabras clave a las **categorías ya existentes** en gastos mensuales (objetivo: dejar de actualizar gastos a mano).
- `access.valid_until` largo (**180 días**) para no re-autorizar a menudo (el banco lo capa si no lo soporta).

## Prerrequisitos (usuario, una vez)
1. Registrarse en el panel de enablebanking.com, crear aplicación (uso personal / AIS) → descarga un `.pem` (clave privada; el nombre del fichero = `application_id`).
2. Configurar redirect `https://wealthos.manidmt.es/bank-callback` en la aplicación.
3. En *restricted production* habilitar el/los bancos a usar (gratis, cuentas propias).
4. Colocar el `.pem`; se guardan dos secrets en Supabase: `ENABLE_BANKING_APP_ID` (nombre del fichero sin `.pem`) y `ENABLE_BANKING_PRIVATE_KEY_B64` (el PEM completo en base64, para evitar problemas de saltos de línea en el secret).

---

## 1. Cliente — `supabase/functions/_shared/enablebanking.ts` (reemplaza `gocardless.ts`)

Base URL `https://api.enablebanking.com`. Auth: JWT RS256 firmado con la clave privada, usado como Bearer directo (no hay token endpoint).

```typescript
async function makeJwt(): Promise<string>;
// header { typ:"JWT", alg:"RS256", kid: APP_ID }
// payload { iss:"enablebanking.com", aud:"api.enablebanking.com", iat, exp: iat+3600 }
// firma con crypto.subtle: importa ENABLE_BANKING_PRIVATE_KEY_B64 (base64→PEM→pkcs8 DER),
//   algoritmo RSASSA-PKCS1-v1_5 / SHA-256.

export async function listAspsps(country = "ES"): Promise<{ name: string; country: string; logo?: string }[]>;
//   GET /aspsps?country=ES → { aspsps: [...] }

export async function startAuth(p: {
  aspspName: string; aspspCountry: string; state: string; redirectUrl: string; validUntil: string;
}): Promise<{ url: string }>;
//   POST /auth  body { access:{valid_until}, aspsp:{name,country}, state, redirect_url, psu_type:"personal" }

export async function createSession(code: string): Promise<{ session_id: string; accounts: { uid: string }[] }>;
//   POST /sessions  body { code }

export async function getTransactions(
  accountUid: string, dateFrom: string, continuationKey?: string,
): Promise<{ transactions: EbTransaction[]; continuation_key?: string }>;
//   GET /accounts/{uid}/transactions?date_from=YYYY-MM-DD[&continuation_key=...]
```

Helper `makeJwt` firma RS256 vía Web Crypto. La clave se importa una vez por invocación.

---

## 2. Base de datos — `supabase/migrations/20260613110000_enable_banking.sql`

```sql
alter table public.bank_connections
  add column if not exists aspsp_country text,
  add column if not exists auth_state text,
  add column if not exists session_expires_at timestamptz;
```

Reuso semántico de columnas existentes: `institution_name` = nombre ASPSP, `requisition_id` = `session_id` de Enable Banking, `account_ids` (jsonb) = uids de cuenta. `auth_state` correlaciona el callback con la conexión pendiente; `session_expires_at` para avisar de re-autorización. `institution_id` queda sin uso (nullable).

---

## 3. Edge Functions (mismos nombres; internals nuevos)

Todas: `serve` de deno std@0.168, `corsResponse`, cliente Supabase con el JWT del usuario (anon) salvo `bank-sync-all` (service role). Secrets `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY_B64`.

- **`bank-aspsps`** (NUEVA, GET): `listAspsps("ES")` → lista para el selector. Cacheable en cliente.
- **`bank-connect`** (POST `{ aspsp_name, aspsp_country }`): `state = crypto.randomUUID()`; `startAuth({..., redirectUrl: https://wealthos.manidmt.es/bank-callback, validUntil: +180d})`; insert `bank_connections { user_id, institution_name: aspsp_name, aspsp_country, auth_state: state, status:"pending" }`; devuelve `{ url }`.
- **`bank-callback`** (POST `{ code, state }`): `createSession(code)` → `session_id` + uids; update la conexión con `auth_state=state`: `requisition_id=session_id`, `account_ids=uids`, `status="active"`, `session_expires_at=+180d`; lanza la primera sync de esa conexión; devuelve `{ ok, accounts, inserted }`.
- **`bank-sync`** (POST `{ connection_id? }`): conexiones `active` del usuario; por cada cuenta, `getTransactions(date_from = last_synced_at o hoy-90d, paginando por continuation_key)`; mapear, dedup `external_id`, auto-categorizar, `upsert movements onConflict external_id ignoreDuplicates`; update `last_synced_at`; en error, `status` y `error_message`.
- **`bank-sync-all`** (cron, service role): itera todas las conexiones `active` de todos los usuarios; misma lógica.

---

## 4. Mapeo de transacción (solo `status === "BOOK"`, se ignoran `PDNG`)

```typescript
type EbTransaction = {
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status: "BOOK" | "PDNG";
  booking_date?: string; value_date?: string; transaction_date?: string;
  transaction_id?: string; entry_reference?: string;
  remittance_information?: string[];
  creditor?: { name?: string }; debtor?: { name?: string };
};
```

- `type` = `credit_debit_indicator === "CRDT" ? "income" : "expense"`
- `amount` = `Math.abs(parseFloat(transaction_amount.amount))`
- `currency` = `transaction_amount.currency`
- `date` = `booking_date ?? value_date ?? transaction_date`
- `description` = `remittance_information?.join(" ") || creditor?.name || debtor?.name || "Sin descripción"` (trim, slice 200)
- `external_id` = `transaction_id ?? entry_reference ?? <hash(date|amount|description)>` (dedup; el hash es fallback solo si faltan ambos)
- `category` = `categorize(description, type)` (§5)

---

## 5. Auto-categorización — `supabase/functions/_shared/categorize.ts` (pura, testeable)

Mapea a las categorías reales de la app (`EXPENSE_CATEGORIES`/`INCOME_CATEGORIES` de `movements-api.ts`). Reglas como lista ordenada `{ keywords: string[]; category: string }` evaluada de arriba abajo sobre la descripción en mayúsculas; primer match gana; fallback `"Sin categoría"` (señal de revisión, no es una categoría estándar pero el selector la admite al editar).

```typescript
export function categorize(description: string, type: "income" | "expense"): string;
```

**Reglas (representativas; el mapa completo vive en el fichero, ampliable):**
- Específicas antes que genéricas (p.ej. `AMAZON PRIME`→Suscripciones antes que `AMAZON`→Tecnología).
- Gasto:
  - `NETFLIX, SPOTIFY, HBO, DISNEY, AMAZON PRIME, PRIME VIDEO, YOUTUBE, ICLOUD, APPLE.COM/BILL, CHATGPT, OPENAI, GITHUB, NOTION` → **Suscripciones**
  - `MERCADONA, LIDL, CARREFOUR, DIA, ALDI, CONSUM, EROSKI, ALCAMPO, HIPERCOR` → **Comida**
  - `GLOVO, UBER EATS, JUST EAT, TELEPIZZA, DOMINOS, MCDONALD, BURGER KING, GOIKO, RESTAURANTE` → **Comer fuera**
  - `STARBUCKS, CAFE` → **Café**
  - `IBERDROLA, ENDESA, NATURGY, GAS NATURAL, CANAL ISABEL, AGUA, COMUNIDAD, ALQUILER, IKEA, LEROY MERLIN` → **Hogar**
  - `GASOLINA, REPSOL, CEPSA, GALP, PARKING, ITV, PEAJE, AUTOPISTA, TALLER` → **Coche**
  - `RENFE, METRO, EMT, ALSA, UBER, CABIFY, BOLT, FREENOW, BICIMAD` → **Transporte**
  - `FARMACIA, CLINICA, DENTISTA, HOSPITAL, SANITAS, ADESLAS` → **Salud**
  - `GIMNASIO, GYM, BASIC FIT, BASICFIT, MCFIT, ALTAFIT` → **Gimnasio**
  - `DECATHLON, NIKE, ADIDAS` → **Deporte**
  - `ZARA, H&M, PRIMARK, BERSHKA, PULL, MANGO, UNIQLO, SHEIN` → **Ropa**
  - `AMAZON, MEDIAMARKT, PCCOMPONENTES, APPLE STORE, ALIEXPRESS, FNAC` → **Tecnología**
  - `UDEMY, COURSERA, DOMESTIKA, PLATZI, MATRICULA, UNIVERSIDAD` → **Formación**
  - `HACIENDA, AEAT, IMPUESTO, TRIBUTO, IBI, TGSS, SEGURIDAD SOCIAL` → **Impuestos**
  - `CINE, CINESA, YELMO, TEATRO, TICKETMASTER, STEAM, PLAYSTATION, XBOX, NINTENDO` → **Ocio**
  - `BOOKING, AIRBNB, RYANAIR, IBERIA, VUELING, HOTEL, EXPEDIA, EDREAMS` → **Viaje**
  - `PELUQUERIA, BARBERIA, SEPHORA, PRIMOR, DOUGLAS` → **Cuidado personal**
  - `FARMACIA?`/`MERCADONA` ya cubren higiene; sin regla propia → cae a fallback.
- Ingreso:
  - `NOMINA, NÓMINA, PAYROLL` → **Nómina**
  - `SALARIO` → **Salario**
  - `TICKET RESTAURANTE, TARJETA RESTAURANTE, EDENRED, SODEXO` → **Ticket restaurante**

`BIZUM` y transferencias genéricas → fallback `"Sin categoría"` (demasiado ambiguas).

---

## 6. Frontend (reusa sección Ajustes + `/bank-callback`)

- `src/lib/bank-api.ts`: hooks React Query — `useAspsps()` (GET bank-aspsps), `useBankConnections()`, `useConnectBank()`, `useSyncBank()`, `useDisconnectBank()`.
- Sección "Cuentas bancarias" en `settings.tsx`: lista de conexiones (banco, estado, última sync, aviso si `session_expires_at` < 7 días), botón "Conectar banco" → modal con selector poblado por `useAspsps()` (buscador por nombre), botón "Sincronizar" por conexión, "Desconectar".
- `src/routes/bank-callback.tsx`: lee `?code` y `?state`, POST `bank-callback`, navega a `/settings` con resultado.
- Sin emojis (consistente con la limpieza reciente).

---

## 7. Cron — `supabase/migrations/20260613120000_bank_sync_cron.sql`

pg_cron diario (08:00 UTC) → `net.http_post` a `bank-sync-all` con la publishable key (mismo patrón que `signals-sync-daily`). Idempotente (`unschedule` si existe).

---

## 8. Seguridad
- `ENABLE_BANKING_PRIVATE_KEY_B64` y `ENABLE_BANKING_APP_ID` solo como secrets de Edge Functions; nunca al frontend ni a `.env`.
- El JWT se firma por petición; sin almacenar.
- Las funciones validan el JWT del usuario (anon + `Authorization`) y filtran por `user_id`; `bank-sync-all` corre como service role solo en el cron.

---

## 9. Testing
- **`categorize`** (deno/Vitest pura): cada regla representativa (MERCADONA→Comida, NETFLIX→Suscripciones, IBERDROLA→Hogar, AMAZON PRIME→Suscripciones vs AMAZON→Tecnología por orden, NOMINA→Nómina), y fallback "Sin categoría".
- **`mapTransaction`** (pura): CRDT→income/DBIT→expense, amount abs, date fallback, description desde remittance/creditor, external_id desde transaction_id, y que PDNG se descarta.
- **Verificación E2E** (requiere PEM): conectar un banco real → autorizar → ver movimientos importados con `external_id` y categoría; re-sync no duplica.

## 10. Dependencias y riesgos
- **Bloqueado en el usuario**: el `.pem` (no estaba en `~/Downloads/enable-banking`) → necesario para secrets, deploy y prueba real. Todo el código se implementa sin él.
- Enable Banking sandbox/restricted-production: el banco debe estar habilitado en el panel; si no, el `/auth` falla — se reporta en la UI.
- Firma RS256 en Deno con Web Crypto: importar PKCS#8; si el `.pem` es PKCS#1 (RSA PRIVATE KEY) habrá que convertir a PKCS#8 (`openssl pkcs8`) al preparar el secret.
- Categorías: el fallback "Sin categoría" no está en `EXPENSE_CATEGORIES` pero el selector lo admite al editar; sirve de bucket de revisión.
