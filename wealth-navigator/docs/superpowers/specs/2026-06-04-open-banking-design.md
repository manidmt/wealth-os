# Open Banking Integration Design — GoCardless

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Conectar cuentas bancarias vía GoCardless Bank Account Data API para importar transacciones automáticamente a `movements`, con sync diario sin intervención manual.

**Architecture:** Tres Supabase Edge Functions actúan como backend seguro (los secrets de GoCardless nunca llegan al frontend). El usuario autoriza el acceso desde la app → GoCardless hace el fetch de transacciones → Edge Function upserta en `movements`. Un cron diario en Supabase re-sincroniza todas las cuentas activas. La UI se integra en la página de Configuración existente.

**Tech Stack:** GoCardless Bank Account Data API (gratis, 2300+ bancos EU), Supabase Edge Functions (Deno/TypeScript), Supabase pg_cron (sync diario), React frontend con TanStack Router.

---

## Bancos objetivo

| Banco | Cobertura GoCardless | Uso |
|---|---|---|
| BBVA | ✅ | Principal — nómina, gastos |
| N26 | ✅ | Secundario |
| Revolut | ✅ | Apenas usado |
| Trade Republic | ⚠️ solo cuenta cash | Portfolio no cubierto por PSD2 |
| MyInvestor | ⚠️ solo cuenta cash | Fondos no cubiertos por PSD2 |

Las posiciones de inversión (Trade Republic, MyInvestor) siguen actualizándose manualmente en `portfolio_positions`.

---

## Prerequisitos (acciones del usuario)

1. Registrarse en https://bankaccountdata.gocardless.com/ (cuenta gratuita)
2. Crear una aplicación y obtener `SECRET_ID` y `SECRET_KEY`
3. Guardar los secrets en Supabase: Settings → Edge Functions → Secrets

---

## Cambios en base de datos

### Nueva tabla: `bank_connections`

```sql
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_id text not null,        -- ej: "BBVA_ES_BBVAESMMXXX"
  institution_name text not null,      -- ej: "BBVA"
  requisition_id text not null unique, -- GoCardless requisition ID
  account_ids jsonb not null default '[]',  -- array de GoCardless account IDs
  status text not null default 'pending'    -- pending | active | expired | error
    check (status in ('pending', 'active', 'expired', 'error')),
  last_synced_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(user_id, institution_id)
);

alter table public.bank_connections enable row level security;
create policy "own connections" on public.bank_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### Columna nueva en `movements`: `external_id`

```sql
alter table public.movements add column external_id text unique;
```

Se usa para deduplicación: `transactionId` de GoCardless. Si ya existe, el upsert no duplica.

---

## Edge Functions

### 1. `bank-connect` (POST)

Recibe `{ institution_id, institution_name }`. Crea una requisition en GoCardless y devuelve la URL de autorización del banco.

```
POST /functions/v1/bank-connect
Body: { institution_id: string, institution_name: string }
Returns: { link: string, requisition_id: string }
```

Flujo interno:
1. Obtener token GoCardless (POST /token/new/)
2. Crear requisition (POST /api/v2/requisitions/) con `redirect: https://wealthos.manidmt.es/bank-callback`
3. Insertar fila en `bank_connections` con status='pending'
4. Devolver `{link, requisition_id}`

### 2. `bank-callback` (POST)

Llamada tras la autorización del banco. Recibe el `requisition_id`, obtiene los account IDs de GoCardless y lanza el primer sync.

```
POST /functions/v1/bank-callback
Body: { requisition_id: string }
Returns: { ok: true, accounts: number, transactions: number }
```

Flujo interno:
1. GET /api/v2/requisitions/{id}/ → obtener account_ids
2. UPDATE bank_connections: account_ids, status='active'
3. Llamar a la lógica de sync para esa conexión
4. Devolver resumen

### 3. `bank-sync` (POST)

Sincroniza transacciones de todas las conexiones activas del usuario (o de una conexión específica si se pasa `connection_id`).

```
POST /functions/v1/bank-sync
Body: { connection_id?: string }  -- omitir = sync todas
Returns: { synced: number, inserted: number, skipped: number }
```

Flujo interno por cuenta GoCardless:
1. GET /api/v2/accounts/{id}/transactions/?date_from=<last_synced_at o 90 días atrás>
2. Mapear cada transacción → movements row:
   - `date`: `bookingDate`
   - `type`: amount > 0 → 'income', amount < 0 → 'expense'
   - `amount`: `abs(transactionAmount.amount)`
   - `currency`: `transactionAmount.currency`
   - `description`: `remittanceInformationUnstructured` o nombre del acreedor/deudor
   - `category`: 'Sin categoría' (el usuario puede editar después)
   - `external_id`: `transactionId`
3. Upsert con `onConflict: external_id` → ignora duplicados
4. UPDATE bank_connections: last_synced_at = now()

### 4. Cron diario (pg_cron en Supabase)

```sql
select cron.schedule(
  'bank-sync-daily',
  '0 8 * * *',  -- cada día a las 8:00 UTC
  $$
  select net.http_post(
    url := 'https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/bank-sync-all',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

La función `bank-sync-all` es idéntica a `bank-sync` pero itera sobre TODOS los usuarios (se ejecuta como service_role).

---

## Frontend

### Ruta nueva: `/bank-callback`

Página mínima que extrae `?ref=<requisition_id>` de la URL, llama a `bank-callback` Edge Function y redirige a `/settings`.

```typescript
// src/routes/bank-callback.tsx
// Lee ?ref= → POST bank-callback → navigate('/settings')
```

### Sección en `/settings`

Nueva sección "Cuentas bancarias" al final de la página de configuración existente:

- Lista de conexiones activas (institución, estado, última sync)
- Botón "Conectar banco" → modal con selector de banco
- Botón "Sincronizar" por conexión
- Botón "Desconectar"

Lista de bancos en el picker (hardcoded, los más comunes en España):
```typescript
const INSTITUTIONS = [
  { id: "BBVA_ES_BBVAESMMXXX", name: "BBVA" },
  { id: "N26_NTSBDEB1XXX", name: "N26" },
  { id: "REVOLUT_REVOGB21", name: "Revolut" },
  { id: "ING_INGDESMMXXX", name: "ING" },
  { id: "SANTANDER_BSCHESMM", name: "Santander" },
  { id: "CAIXABANK_CAIXESBBXXX", name: "CaixaBank" },
  { id: "MYINVESTOR_ES", name: "MyInvestor" },
  { id: "TRADE_REPUBLIC_TRPUDEB1XXX", name: "Trade Republic" },
];
```

---

## Archivos a crear/modificar

| Archivo | Acción |
|---|---|
| `supabase/functions/bank-connect/index.ts` | Crear |
| `supabase/functions/bank-callback/index.ts` | Crear |
| `supabase/functions/bank-sync/index.ts` | Crear (usuario específico) |
| `supabase/functions/bank-sync-all/index.ts` | Crear (cron, todos usuarios) |
| `supabase/functions/_shared/gocardless.ts` | Crear (cliente GoCardless compartido) |
| `supabase/migrations/YYYYMMDD_bank_connections.sql` | Crear |
| `src/routes/bank-callback.tsx` | Crear |
| `src/routes/settings.tsx` | Modificar (añadir sección bancos) |
| `src/lib/bank-api.ts` | Crear (hooks React Query para bank_connections) |
| `supabase/config.toml` | Modificar (project_id → nuevo proyecto) |

---

## Seguridad

- Los secrets `GOCARDLESS_SECRET_ID` y `GOCARDLESS_SECRET_KEY` solo viven en Supabase Edge Functions secrets, nunca en el frontend ni en `.env`
- Las Edge Functions validan `Authorization: Bearer <anon_key>` + extraen `user_id` del JWT para filtrar datos
- GoCardless nunca recibe las credenciales bancarias del usuario (flujo OAuth PSD2)
- Los tokens de GoCardless se obtienen fresh en cada invocación (sin almacenar en DB)

---

## Limitaciones conocidas

- GoCardless free tier: historial de 90 días, 4 requests/día por cuenta
- Trade Republic y MyInvestor: solo transacciones de cuenta corriente, no posiciones de fondos/ETFs
- Las transacciones importadas tienen `category: 'Sin categoría'` — el usuario las categoriza manualmente o se añade auto-categorización por keywords en el futuro
- Requisitions de GoCardless expiran a los 90 días — habrá que re-autorizar periódicamente (se puede detectar y avisar en la UI)
