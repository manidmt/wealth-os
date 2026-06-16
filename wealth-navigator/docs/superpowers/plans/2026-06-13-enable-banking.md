# Enable Banking Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Importar transacciones bancarias reales a `movements` vía Enable Banking (PSD2 gratuito) con auto-categorización a las categorías existentes, botón manual + cron diario, reaprovechando la arquitectura GoCardless ya codeada.

**Architecture:** Cliente JWT RS256 en `_shared/enablebanking.ts` (reemplaza `gocardless.ts`); funciones puras `categorize.ts` y `bank-mapping.ts` en `_shared/` con re-export a `src/lib/` para tests Vitest (patrón strategy-engine); 5 Edge Functions; reuso de tabla `bank_connections` (+3 columnas), ruta `/bank-callback` y sección Ajustes.

**Tech Stack:** Supabase Edge Functions (Deno), Web Crypto (RS256), React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-enable-banking-design.md`

**⚠️ Dependencia del usuario:** las Tasks 1-8 son CÓDIGO y se ejecutan sin el `.pem`. La **Task 9** (secrets + deploy + cron + prueba real) está BLOQUEADA hasta que el usuario coloque el `.pem` y dé el `application_id`.

---

## Estructura de ficheros

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260613110000_enable_banking.sql` | Crear | columnas aspsp_country, auth_state, session_expires_at |
| `supabase/functions/_shared/categorize.ts` | Crear | reglas keyword→categoría (pura) |
| `src/lib/categorize.ts` + `.test.ts` | Crear | re-export + tests |
| `supabase/functions/_shared/bank-mapping.ts` | Crear | mapTransaction Enable Banking (pura) |
| `src/lib/bank-mapping.ts` + `.test.ts` | Crear | re-export + tests |
| `supabase/functions/_shared/enablebanking.ts` | Crear | cliente JWT/auth/sessions/transactions |
| `supabase/functions/_shared/gocardless.ts` | Borrar | retirado |
| `supabase/functions/bank-aspsps/index.ts` | Crear | lista bancos ES |
| `supabase/functions/bank-connect/index.ts` | Reescribir | POST /auth |
| `supabase/functions/bank-callback/index.ts` | Reescribir | POST /sessions + 1ª sync |
| `supabase/functions/bank-sync/index.ts` | Reescribir | sync usuario |
| `supabase/functions/bank-sync-all/index.ts` | Reescribir | sync cron |
| `src/lib/bank-api.ts` | Reescribir | hooks (aspsps dinámicos) |
| `src/routes/bank-callback.tsx` | Reescribir | callback code+state |
| `src/routes/settings.tsx` | Modificar | sección cuentas bancarias |
| `supabase/migrations/20260613120000_bank_sync_cron.sql` | Crear | pg_cron diario |

---

### Task 1: Migración + tipo de conexión

**Files:** Create `supabase/migrations/20260613110000_enable_banking.sql`; Modify `src/lib/bank-api.ts`

- [ ] **Step 1: Migración** — contenido exacto:
```sql
alter table public.bank_connections
  add column if not exists aspsp_country text,
  add column if not exists auth_state text,
  add column if not exists session_expires_at timestamptz;
```

- [ ] **Step 2: Aplicar** `npx supabase db push 2>&1 | tail -6`. Expected: aplica `20260613110000`. Si se queja de migraciones anteriores ya aplicadas, NO tocar — reportar.

- [ ] **Step 3: Verificar** (anon en .env como VITE_SUPABASE_PUBLISHABLE_KEY):
```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -4 -s "$URL/rest/v1/bank_connections?select=aspsp_country,auth_state,session_expires_at&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]` (NO "column does not exist").

- [ ] **Step 4: Tipo** — en `src/lib/bank-api.ts`, en `BankConnection` añadir tras `error_message`:
```typescript
  aspsp_country: string | null;
  auth_state: string | null;
  session_expires_at: string | null;
```
(El resto de bank-api.ts se reescribe en Task 6; aquí solo el tipo para que compile.)

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260613110000_enable_banking.sql src/lib/bank-api.ts
git commit -m "feat: bank_connections columns for Enable Banking sessions"
```

---

### Task 2: Auto-categorización (TDD)

**Files:** Create `supabase/functions/_shared/categorize.ts`, `src/lib/categorize.ts`, `src/lib/categorize.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/categorize.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { categorize } from "./categorize";

describe("categorize (expense)", () => {
  it("MERCADONA → Comida", () => expect(categorize("COMPRA MERCADONA MADRID", "expense")).toBe("Comida"));
  it("NETFLIX → Suscripciones", () => expect(categorize("NETFLIX.COM", "expense")).toBe("Suscripciones"));
  it("AMAZON PRIME → Suscripciones (gana a AMAZON)", () =>
    expect(categorize("AMAZON PRIME*123", "expense")).toBe("Suscripciones"));
  it("AMAZON (sin prime) → Tecnología", () => expect(categorize("AMAZON MKTPLACE", "expense")).toBe("Tecnología"));
  it("IBERDROLA → Hogar", () => expect(categorize("RECIBO IBERDROLA", "expense")).toBe("Hogar"));
  it("REPSOL → Coche", () => expect(categorize("E.S. REPSOL", "expense")).toBe("Coche"));
  it("desconocido → Sin categoría", () => expect(categorize("PAGO XYZ 9999", "expense")).toBe("Sin categoría"));
});

describe("categorize (income)", () => {
  it("NOMINA → Nómina", () => expect(categorize("ABONO NOMINA EMPRESA SL", "income")).toBe("Nómina"));
  it("ingreso desconocido → Sin categoría", () => expect(categorize("TRANSFERENCIA", "income")).toBe("Sin categoría"));
});
```

- [ ] **Step 2: Run** `npm test -- categorize` → FAIL.

- [ ] **Step 3: Implementar** — `supabase/functions/_shared/categorize.ts`:
```typescript
// Reglas keyword→categoría. Categorías = las de EXPENSE_CATEGORIES/INCOME_CATEGORIES
// en src/lib/movements-api.ts. Orden: específicas antes que genéricas (primer match gana).
type Rule = { keywords: string[]; category: string };

const EXPENSE_RULES: Rule[] = [
  { category: "Suscripciones", keywords: ["NETFLIX", "SPOTIFY", "HBO", "DISNEY", "AMAZON PRIME", "PRIME VIDEO", "YOUTUBE", "ICLOUD", "APPLE.COM/BILL", "CHATGPT", "OPENAI", "GITHUB", "NOTION"] },
  { category: "Comida", keywords: ["MERCADONA", "LIDL", "CARREFOUR", "DIA ", "ALDI", "CONSUM", "EROSKI", "ALCAMPO", "HIPERCOR", "SUPERCOR"] },
  { category: "Comer fuera", keywords: ["GLOVO", "UBER EATS", "JUST EAT", "JUSTEAT", "TELEPIZZA", "DOMINOS", "MCDONALD", "BURGER KING", "GOIKO", "KFC", "RESTAURANTE"] },
  { category: "Café", keywords: ["STARBUCKS", "CAFE "] },
  { category: "Hogar", keywords: ["IBERDROLA", "ENDESA", "NATURGY", "GAS NATURAL", "CANAL ISABEL", " AGUA", "COMUNIDAD", "ALQUILER", "IKEA", "LEROY MERLIN"] },
  { category: "Coche", keywords: ["GASOLINA", "REPSOL", "CEPSA", "GALP", "PARKING", "ITV", "PEAJE", "AUTOPISTA", "TALLER"] },
  { category: "Transporte", keywords: ["RENFE", "METRO ", "EMT ", "ALSA", "UBER", "CABIFY", "BOLT", "FREENOW", "BICIMAD"] },
  { category: "Salud", keywords: ["FARMACIA", "CLINICA", "DENTISTA", "HOSPITAL", "SANITAS", "ADESLAS"] },
  { category: "Gimnasio", keywords: ["GIMNASIO", "GYM", "BASIC FIT", "BASICFIT", "MCFIT", "ALTAFIT"] },
  { category: "Deporte", keywords: ["DECATHLON", "NIKE", "ADIDAS"] },
  { category: "Ropa", keywords: ["ZARA", "H&M", "PRIMARK", "BERSHKA", "PULL", "MANGO", "UNIQLO", "SHEIN"] },
  { category: "Tecnología", keywords: ["AMAZON", "MEDIAMARKT", "MEDIA MARKT", "PCCOMPONENTES", "APPLE STORE", "ALIEXPRESS", "FNAC"] },
  { category: "Formación", keywords: ["UDEMY", "COURSERA", "DOMESTIKA", "PLATZI", "MATRICULA", "UNIVERSIDAD"] },
  { category: "Impuestos", keywords: ["HACIENDA", "AEAT", "IMPUESTO", "TRIBUTO", " IBI", "TGSS", "SEGURIDAD SOCIAL"] },
  { category: "Ocio", keywords: ["CINE", "CINESA", "YELMO", "TEATRO", "TICKETMASTER", "STEAM", "PLAYSTATION", "XBOX", "NINTENDO"] },
  { category: "Viaje", keywords: ["BOOKING", "AIRBNB", "RYANAIR", "IBERIA", "VUELING", "HOTEL", "EXPEDIA", "EDREAMS"] },
  { category: "Cuidado personal", keywords: ["PELUQUERIA", "BARBERIA", "SEPHORA", "PRIMOR", "DOUGLAS"] },
];

const INCOME_RULES: Rule[] = [
  { category: "Nómina", keywords: ["NOMINA", "NÓMINA", "PAYROLL"] },
  { category: "Salario", keywords: ["SALARIO"] },
  { category: "Ticket restaurante", keywords: ["TICKET RESTAURANTE", "TARJETA RESTAURANTE", "EDENRED", "SODEXO"] },
];

export function categorize(description: string, type: "income" | "expense"): string {
  const d = description.toUpperCase();
  const rules = type === "income" ? INCOME_RULES : EXPENSE_RULES;
  for (const rule of rules) {
    if (rule.keywords.some((k) => d.includes(k))) return rule.category;
  }
  return "Sin categoría";
}
```
Y `src/lib/categorize.ts`:
```typescript
export * from "../../supabase/functions/_shared/categorize";
```

- [ ] **Step 4: Run** `npm test -- categorize` → pasan. `npm test` global verde.

- [ ] **Step 5: Lint+commit**
```bash
npx eslint --fix src/lib/categorize.ts src/lib/categorize.test.ts
git add supabase/functions/_shared/categorize.ts src/lib/categorize.ts src/lib/categorize.test.ts
git commit -m "feat: keyword auto-categorization to existing app categories"
```

---

### Task 3: Mapeo de transacción (TDD)

**Files:** Create `supabase/functions/_shared/bank-mapping.ts`, `src/lib/bank-mapping.ts`, `src/lib/bank-mapping.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/bank-mapping.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { mapTransaction, type EbTransaction } from "./bank-mapping";

const base: EbTransaction = {
  transaction_amount: { amount: "12.34", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-06-10",
  transaction_id: "tx-1",
  remittance_information: ["COMPRA MERCADONA"],
};

describe("mapTransaction", () => {
  it("DBIT → expense, amount abs, categoriza", () => {
    const r = mapTransaction(base, "u1");
    expect(r).toMatchObject({
      user_id: "u1", type: "expense", amount: 12.34, currency: "EUR",
      date: "2026-06-10", description: "COMPRA MERCADONA", category: "Comida", external_id: "tx-1",
    });
  });
  it("CRDT → income", () =>
    expect(mapTransaction({ ...base, credit_debit_indicator: "CRDT", remittance_information: ["ABONO NOMINA"] }, "u1").type).toBe("income"));
  it("description desde creditor si no hay remittance", () =>
    expect(mapTransaction({ ...base, remittance_information: undefined, creditor: { name: "ACME SL" } }, "u1").description).toBe("ACME SL"));
  it("date cae a value_date si falta booking_date", () =>
    expect(mapTransaction({ ...base, booking_date: undefined, value_date: "2026-06-09" }, "u1").date).toBe("2026-06-09"));
  it("external_id cae a entry_reference si falta transaction_id", () =>
    expect(mapTransaction({ ...base, transaction_id: undefined, entry_reference: "ref-9" }, "u1").external_id).toBe("ref-9"));
});

describe("isBooked", () => {
  it("BOOK true, PDNG false", async () => {
    const { isBooked } = await import("./bank-mapping");
    expect(isBooked(base)).toBe(true);
    expect(isBooked({ ...base, status: "PDNG" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npm test -- bank-mapping` → FAIL.

- [ ] **Step 3: Implementar** — `supabase/functions/_shared/bank-mapping.ts`:
```typescript
import { categorize } from "./categorize.ts";

export type EbTransaction = {
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status: "BOOK" | "PDNG";
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  transaction_id?: string;
  entry_reference?: string;
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
};

export type MovementRow = {
  user_id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  currency: string;
  description: string;
  category: string;
  external_id: string;
};

export function isBooked(tx: EbTransaction): boolean {
  return tx.status === "BOOK";
}

export function mapTransaction(tx: EbTransaction, userId: string): MovementRow {
  const type = tx.credit_debit_indicator === "CRDT" ? "income" : "expense";
  const amount = Math.abs(parseFloat(tx.transaction_amount.amount));
  const description = (
    tx.remittance_information?.join(" ") ||
    tx.creditor?.name ||
    tx.debtor?.name ||
    "Sin descripción"
  ).trim().slice(0, 200);
  return {
    user_id: userId,
    date: (tx.booking_date ?? tx.value_date ?? tx.transaction_date) as string,
    type,
    amount,
    currency: tx.transaction_amount.currency,
    description,
    category: categorize(description, type),
    external_id: (tx.transaction_id ?? tx.entry_reference) as string,
  };
}
```
Y `src/lib/bank-mapping.ts`:
```typescript
export * from "../../supabase/functions/_shared/bank-mapping";
```
Nota: el re-export de `src/lib/categorize.ts` importa el `_shared/categorize` SIN extensión `.ts`; `bank-mapping.ts` de `_shared` importa `./categorize.ts` CON extensión (Deno). Vite/Vitest resuelve el `src/lib/bank-mapping.ts` que re-exporta el `_shared/bank-mapping`, que a su vez importa `./categorize.ts` — verificar que Vitest resuelve el `.ts`; si falla, en `bank-mapping.ts` importar `from "./categorize.ts"` igualmente (Vite acepta `.ts` explícito en imports). Confirmar con el build.

- [ ] **Step 4: Run** `npm test -- bank-mapping` → pasan. `npm test` global verde. `npm run build` → ✓ (resolución del import cross-boundary OK).

- [ ] **Step 5: Lint+commit**
```bash
npx eslint --fix src/lib/bank-mapping.ts src/lib/bank-mapping.test.ts
git add supabase/functions/_shared/bank-mapping.ts src/lib/bank-mapping.ts src/lib/bank-mapping.test.ts
git commit -m "feat: Enable Banking transaction mapper (CRDT/DBIT, dedup, categorize)"
```

---

### Task 4: Cliente Enable Banking (JWT)

**Files:** Create `supabase/functions/_shared/enablebanking.ts`

- [ ] **Step 1: Implementar** — `supabase/functions/_shared/enablebanking.ts`:
```typescript
import type { EbTransaction } from "./bank-mapping.ts";

const BASE = "https://api.enablebanking.com";

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64url(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

async function importKey(): Promise<CryptoKey> {
  // ENABLE_BANKING_PRIVATE_KEY_B64 = base64 del PEM PKCS#8 completo
  const pem = atob(Deno.env.get("ENABLE_BANKING_PRIVATE_KEY_B64")!);
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function makeJwt(): Promise<string> {
  const appId = Deno.env.get("ENABLE_BANKING_APP_ID")!;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await importKey();
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

async function ebFetch(path: string, init?: RequestInit) {
  const jwt = await makeJwt();
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`EnableBanking ${path}: HTTP ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function listAspsps(country = "ES"): Promise<{ name: string; country: string }[]> {
  const j = await ebFetch(`/aspsps?country=${country}`);
  return (j.aspsps ?? []) as { name: string; country: string }[];
}

export async function startAuth(p: {
  aspspName: string; aspspCountry: string; state: string; redirectUrl: string; validUntil: string;
}): Promise<{ url: string }> {
  return ebFetch(`/auth`, {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: p.validUntil },
      aspsp: { name: p.aspspName, country: p.aspspCountry },
      state: p.state,
      redirect_url: p.redirectUrl,
      psu_type: "personal",
    }),
  }) as Promise<{ url: string }>;
}

export async function createSession(code: string): Promise<{ session_id: string; accounts: { uid: string }[] }> {
  return ebFetch(`/sessions`, { method: "POST", body: JSON.stringify({ code }) }) as Promise<{
    session_id: string; accounts: { uid: string }[];
  }>;
}

export async function getTransactions(
  accountUid: string, dateFrom: string, continuationKey?: string,
): Promise<{ transactions: EbTransaction[]; continuation_key?: string }> {
  const u = new URL(`${BASE}/accounts/${accountUid}/transactions`);
  u.searchParams.set("date_from", dateFrom);
  if (continuationKey) u.searchParams.set("continuation_key", continuationKey);
  const jwt = await makeJwt();
  const resp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${jwt}` } });
  if (!resp.ok) throw new Error(`EnableBanking transactions: HTTP ${resp.status} ${await resp.text()}`);
  return resp.json();
}

/** Todas las transacciones BOOKED de una cuenta desde dateFrom, siguiendo paginación. */
export async function getAllTransactions(accountUid: string, dateFrom: string): Promise<EbTransaction[]> {
  const out: EbTransaction[] = [];
  let key: string | undefined;
  do {
    const page = await getTransactions(accountUid, dateFrom, key);
    out.push(...(page.transactions ?? []));
    key = page.continuation_key;
  } while (key);
  return out;
}
```

- [ ] **Step 2: Type-check** `npx --yes deno check supabase/functions/_shared/enablebanking.ts` → pasa.

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/_shared/enablebanking.ts
git commit -m "feat: Enable Banking client (RS256 JWT, aspsps, auth, sessions, transactions)"
```

---

### Task 5: Edge Functions

**Files:** Create `supabase/functions/bank-aspsps/index.ts`; Rewrite `bank-connect`, `bank-callback`, `bank-sync`, `bank-sync-all`; Delete `supabase/functions/_shared/gocardless.ts`

Patrón común: `serve` de deno std@0.168, `corsResponse`, cliente Supabase con el JWT del usuario (env `SUPABASE_ANON_KEY` + Authorization header), salvo bank-sync-all (service role). `redirectUrl = ${APP_URL ?? "https://wealthos.manidmt.es"}/bank-callback`. `validUntil` = ISO de hoy+180 días.

- [ ] **Step 1: `bank-aspsps/index.ts`** (GET):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { listAspsps } from "../_shared/enablebanking.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const aspsps = await listAspsps("ES");
    return corsResponse({ aspsps });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: `bank-connect/index.ts`** (reescribir):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { startAuth } from "../_shared/enablebanking.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return corsResponse({ error: "Unauthorized" }, 401);

    const { aspsp_name, aspsp_country } = await req.json() as { aspsp_name: string; aspsp_country: string };
    const state = crypto.randomUUID();
    const redirectUrl = `${Deno.env.get("APP_URL") ?? "https://wealthos.manidmt.es"}/bank-callback`;
    const validUntil = new Date(Date.now() + 180 * 86400_000).toISOString();

    const { url } = await startAuth({ aspspName: aspsp_name, aspspCountry: aspsp_country, state, redirectUrl, validUntil });

    await supabase.from("bank_connections").insert({
      user_id: user.id,
      institution_name: aspsp_name,
      aspsp_country,
      auth_state: state,
      status: "pending",
      account_ids: [],
    });

    return corsResponse({ url });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 3: `bank-callback/index.ts`** (reescribir):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { createSession, getAllTransactions } from "../_shared/enablebanking.ts";
import { mapTransaction, isBooked } from "../_shared/bank-mapping.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return corsResponse({ error: "Unauthorized" }, 401);

    const { code, state } = await req.json() as { code: string; state: string };
    const session = await createSession(code);
    const uids = session.accounts.map((a) => a.uid);
    const expires = new Date(Date.now() + 180 * 86400_000).toISOString();

    await supabase.from("bank_connections")
      .update({
        requisition_id: session.session_id,
        account_ids: uids,
        status: "active",
        error_message: null,
        session_expires_at: expires,
      })
      .eq("auth_state", state)
      .eq("user_id", user.id);

    const dateFrom = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    let inserted = 0;
    for (const uid of uids) {
      const txs = (await getAllTransactions(uid, dateFrom)).filter(isBooked).filter((t) => t.transaction_id || t.entry_reference);
      if (!txs.length) continue;
      const rows = txs.map((t) => mapTransaction(t, user.id));
      const { error } = await supabase.from("movements").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
      if (!error) inserted += rows.length;
    }
    await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("auth_state", state);

    return corsResponse({ ok: true, accounts: uids.length, inserted });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 4: `bank-sync/index.ts`** (reescribir):
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { getAllTransactions } from "../_shared/enablebanking.ts";
import { mapTransaction, isBooked } from "../_shared/bank-mapping.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return corsResponse({ error: "Unauthorized" }, 401);

    const body = req.headers.get("content-length") !== "0" ? await req.json().catch(() => ({})) : {};
    const connectionId = (body as { connection_id?: string }).connection_id;

    let query = supabase.from("bank_connections").select("*").eq("status", "active").eq("user_id", user.id);
    if (connectionId) query = query.eq("id", connectionId) as typeof query;
    const { data: connections, error: connErr } = await query;
    if (connErr) return corsResponse({ error: connErr.message }, 500);

    let inserted = 0;
    for (const conn of connections ?? []) {
      const dateFrom = conn.last_synced_at
        ? (conn.last_synced_at as string).slice(0, 10)
        : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
      for (const uid of (conn.account_ids as string[])) {
        const txs = (await getAllTransactions(uid, dateFrom)).filter(isBooked).filter((t) => t.transaction_id || t.entry_reference);
        if (!txs.length) continue;
        const rows = txs.map((t) => mapTransaction(t, conn.user_id as string));
        const { error } = await supabase.from("movements").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
        if (!error) inserted += rows.length;
      }
      await supabase.from("bank_connections")
        .update({ last_synced_at: new Date().toISOString(), error_message: null })
        .eq("id", conn.id);
    }
    return corsResponse({ ok: true, synced: (connections ?? []).length, inserted });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 5: `bank-sync-all/index.ts`** (reescribir) — idéntico a bank-sync pero con service role y SIN filtro de user:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { getAllTransactions } from "../_shared/enablebanking.ts";
import { mapTransaction, isBooked } from "../_shared/bank-mapping.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: connections, error } = await supabase.from("bank_connections").select("*").eq("status", "active");
    if (error) return corsResponse({ error: error.message }, 500);

    let inserted = 0;
    for (const conn of connections ?? []) {
      const dateFrom = conn.last_synced_at
        ? (conn.last_synced_at as string).slice(0, 10)
        : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
      for (const uid of (conn.account_ids as string[])) {
        const txs = (await getAllTransactions(uid, dateFrom)).filter(isBooked).filter((t) => t.transaction_id || t.entry_reference);
        if (!txs.length) continue;
        const rows = txs.map((t) => mapTransaction(t, conn.user_id as string));
        const { error: upErr } = await supabase.from("movements").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
        if (!upErr) inserted += rows.length;
      }
      await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("id", conn.id);
    }
    return corsResponse({ ok: true, synced: (connections ?? []).length, inserted });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 6: Borrar gocardless.ts** `rm supabase/functions/_shared/gocardless.ts`

- [ ] **Step 7: Type-check** todas:
```bash
npx --yes deno check supabase/functions/bank-aspsps/index.ts supabase/functions/bank-connect/index.ts supabase/functions/bank-callback/index.ts supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts
```
Expected: todas pasan, sin referencias a gocardless.

- [ ] **Step 8: Commit**
```bash
git add supabase/functions/
git commit -m "feat: rewrite bank edge functions for Enable Banking (+ bank-aspsps)"
```

---

### Task 6: bank-api.ts (hooks)

**Files:** Rewrite `src/lib/bank-api.ts`

- [ ] **Step 1: Reescribir** `src/lib/bank-api.ts` (mantener `BankConnection` con los campos de Task 1; quitar INSTITUTIONS hardcoded):
```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type BankConnectionStatus = "pending" | "active" | "expired" | "error";

export type BankConnection = {
  id: string;
  user_id: string;
  institution_id: string | null;
  institution_name: string;
  requisition_id: string | null;
  account_ids: string[];
  status: BankConnectionStatus;
  last_synced_at: string | null;
  error_message: string | null;
  aspsp_country: string | null;
  auth_state: string | null;
  session_expires_at: string | null;
  created_at: string;
};

export type Aspsp = { name: string; country: string };

export function useAspsps() {
  const { user } = useAuth();
  return useQuery<Aspsp[]>({
    queryKey: ["aspsps"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bank-aspsps", { body: {} });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return (data.aspsps ?? []) as Aspsp[];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
}

export function useBankConnections() {
  const { user } = useAuth();
  return useQuery<BankConnection[]>({
    queryKey: ["bank_connections", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("bank_connections").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useConnectBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (aspsp: Aspsp): Promise<{ url: string }> => {
      const { data, error } = await supabase.functions.invoke("bank-connect", {
        body: { aspsp_name: aspsp.name, aspsp_country: aspsp.country },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank_connections"] }),
  });
}

export function useSyncBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId?: string) => {
      const { data, error } = await supabase.functions.invoke("bank-sync", {
        body: connectionId ? { connection_id: connectionId } : {},
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as { ok: boolean; synced: number; inserted: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_connections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useDisconnectBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("bank_connections").delete().eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank_connections"] }),
  });
}
```

- [ ] **Step 2:** `npm run build 2>&1 | tail -3` → ✓ built. Si `settings.tsx` importa `INSTITUTIONS` o `Institution`, fallará — se arregla en Task 7 (hazlo seguido). `npx eslint src/lib/bank-api.ts` limpio.

- [ ] **Step 3: Commit**
```bash
git add src/lib/bank-api.ts
git commit -m "feat: bank-api hooks with dynamic aspsps list"
```

---

### Task 7: Frontend — Ajustes + callback

**Files:** Modify `src/routes/settings.tsx`; Rewrite `src/routes/bank-callback.tsx`

- [ ] **Step 1: LEER** `src/routes/settings.tsx` (sección "Cuentas bancarias" / `BankSection` existente) y `src/routes/bank-callback.tsx` actuales. Adaptar la sección al nuevo modelo: selector poblado por `useAspsps()` (con buscador por nombre, puede ser muchos), `useConnectBank()` que ahora devuelve `{ url }` (antes `{ link }`) → `window.location.href = url`. Quitar referencias a `INSTITUTIONS`/`Institution`. Mostrar por conexión: `institution_name`, `status`, `last_synced_at`, y aviso si `session_expires_at` existe y faltan <7 días. Botones Sincronizar (`useSyncBank(conn.id)`) y Desconectar (`useDisconnectBank(conn.id)`). Sin emojis.

- [ ] **Step 2: Reescribir** `src/routes/bank-callback.tsx` para leer `code` y `state` del query y llamar a `bank-callback`:
```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/bank-callback")({
  component: BankCallback,
});

function BankCallback() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState("Conectando tu banco…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setMsg("Faltan parámetros de autorización.");
      return;
    }
    supabase.functions
      .invoke("bank-callback", { body: { code, state } })
      .then(({ data, error }) => {
        if (error || data?.error) throw new Error(error?.message ?? data.error);
        setMsg(`Banco conectado. ${data.inserted ?? 0} movimientos importados.`);
        setTimeout(() => navigate({ to: "/settings" }), 1500);
      })
      .catch((e) => setMsg(`Error: ${e.message}`));
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <p className="text-[14px] text-muted-foreground">{msg}</p>
    </div>
  );
}
```
(Si la firma real de `createFileRoute`/estructura difiere, adaptar a la existente — por eso se lee primero.)

- [ ] **Step 3:** `npm run build 2>&1 | tail -3` → ✓ built (sin errores de `INSTITUTIONS`). `npx eslint src/routes/settings.tsx src/routes/bank-callback.tsx` limpio. `npm test` 35+ verde. Restart: `systemctl --user restart wealth-navigator.service && sleep 3 && systemctl --user is-active wealth-navigator.service`.

- [ ] **Step 4: Commit**
```bash
git add src/routes/settings.tsx src/routes/bank-callback.tsx
git commit -m "feat: Enable Banking settings UI and callback route"
```

---

### Task 8: Migración cron (crear, sin aplicar)

**Files:** Create `supabase/migrations/20260613120000_bank_sync_cron.sql`

- [ ] **Step 1: Crear** `supabase/migrations/20260613120000_bank_sync_cron.sql`:
```sql
-- Cron diario que sincroniza todas las conexiones bancarias activas.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'bank-sync-daily') then
    perform cron.unschedule('bank-sync-daily');
  end if;
end $$;

select cron.schedule(
  'bank-sync-daily',
  '0 8 * * *',
  $job$
  select net.http_post(
    url := 'https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/bank-sync-all',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'apikey', 'sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
```
(pg_cron/pg_net ya están habilitados por el cron de señales. NO se aplica todavía — se aplica en Task 9 tras desplegar bank-sync-all.)

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260613120000_bank_sync_cron.sql
git commit -m "feat: pg_cron daily bank-sync (migration, applied after deploy)"
```

---

### Task 9: 🔒 BLOQUEADA — secrets, deploy, cron, E2E (requiere el .pem del usuario)

**No ejecutar hasta que el usuario coloque el `.pem` y confirme el `application_id`.**

- [ ] **Step 1: Preparar el secret de la clave** (el controlador lo hará con el fichero real, sin exponerlo):
```bash
# Convertir a PKCS#8 si el PEM es PKCS#1 (cabecera "BEGIN RSA PRIVATE KEY"):
#   openssl pkcs8 -topk8 -nocrypt -in <app_id>.pem -out key_pkcs8.pem
# base64 sin saltos:
#   B64=$(base64 -w0 key_pkcs8.pem)
npx supabase secrets set ENABLE_BANKING_APP_ID=<app_id> ENABLE_BANKING_PRIVATE_KEY_B64=<B64>
```

- [ ] **Step 2: Desplegar** las 5 funciones:
```bash
for fn in bank-aspsps bank-connect bank-callback bank-sync bank-sync-all; do npx supabase functions deploy $fn 2>&1 | tail -2; done
```

- [ ] **Step 3: Smoke test bank-aspsps** (publishable key pasa el gateway):
```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -4 -s -X POST "$URL/functions/v1/bank-aspsps" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" | head -c 400
```
Expected: JSON con `aspsps` (lista de bancos ES). Si 500 con error de JWT/clave → revisar el formato del secret (PKCS#8/base64).

- [ ] **Step 4: Aplicar cron** `npx supabase db push 2>&1 | tail -6` (aplica `20260613120000`). Verificar `select jobname from cron.job;` incluye `bank-sync-daily`.

- [ ] **Step 5: E2E manual** en `wealthos.manidmt.es/settings`: Conectar banco → seleccionar tu banco → autorizar en el banco → vuelta a `/bank-callback` → "Banco conectado, N movimientos" → en Gastos, ver los movimientos importados con categoría auto. Pulsar "Sincronizar" otra vez → no duplica (dedup external_id).

- [ ] **Step 6: Commit** de cualquier ajuste final y nota de desviaciones.

---

## Self-review
- Cobertura spec: §1 cliente→T4; §2 BD→T1; §3 funciones→T5; §4 mapeo→T3; §5 categorización→T2; §6 frontend→T6/T7; §7 cron→T8/T9; §8 seguridad→T4/T5 (secrets, JWT por petición); §9 tests→T2/T3 + E2E T9. ✓
- Consistencia de tipos: `EbTransaction`/`MovementRow` definidos en T3 y consumidos en T4/T5; `mapTransaction`/`isBooked` firma estable; `categorize(desc,type)` igual en T2/T3; `BankConnection` ampliado en T1 y reescrito coherente en T6; hooks `useAspsps/useConnectBank({url})` alineados con bank-connect (T5) y settings (T7).
- Desviaciones documentadas: fallback categoría "Sin categoría" (no está en EXPENSE_CATEGORIES pero el selector lo admite); cron y deploy en T9 por dependencia del `.pem`; el JWT no se unit-testea (se valida en E2E + deno check) por requerir clave real.
- Riesgo: PEM PKCS#1 vs PKCS#8 (Web Crypto necesita PKCS#8) — cubierto en T9 step 1.
