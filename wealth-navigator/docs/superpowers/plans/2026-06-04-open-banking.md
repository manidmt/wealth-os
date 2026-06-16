# Open Banking Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar cuentas bancarias vía GoCardless para importar transacciones automáticamente a `movements`, con sync diario sin intervención manual.

**Architecture:** Cuatro Supabase Edge Functions (Deno) actúan de backend seguro; los secrets de GoCardless nunca llegan al frontend. El usuario autoriza desde la UI → GoCardless realiza el OAuth con el banco → Edge Function persiste transacciones en `movements` con dedup por `external_id`. Un schedule diario en Supabase re-sincroniza todas las cuentas activas.

**Tech Stack:** GoCardless Bank Account Data API v2, Supabase Edge Functions (Deno 1.x), Supabase CLI (npx), React + TanStack Router, @tanstack/react-query.

---

## Estructura de archivos

```
supabase/
  config.toml                          ← Modificar: project_id nuevo
  functions/
    _shared/
      gocardless.ts                    ← Crear: cliente GoCardless compartido
      cors.ts                          ← Crear: headers CORS compartidos
    bank-connect/index.ts              ← Crear: inicia OAuth con banco
    bank-callback/index.ts             ← Crear: completa OAuth, activa cuenta
    bank-sync/index.ts                 ← Crear: sync transacciones (usuario)
    bank-sync-all/index.ts             ← Crear: sync cron (todos usuarios)

src/
  lib/bank-api.ts                      ← Crear: hooks React Query
  routes/bank-callback.tsx             ← Crear: página redirect post-OAuth
  routes/settings.tsx                  ← Modificar: añadir sección Bancos
```

---

### Task 1: Prerequisitos — GoCardless + Supabase CLI

**Files:** `supabase/config.toml`

- [ ] **Step 1: Actualizar config.toml al nuevo proyecto**

```bash
sed -i 's/jywkkbmurlohupuyakmu/pqfixpcbupdslrdfealq/' supabase/config.toml
cat supabase/config.toml
```

Expected: `project_id = "pqfixpcbupdslrdfealq"`

- [ ] **Step 2: Autenticar Supabase CLI**

```bash
npx supabase login
```

Se abrirá el navegador. Completa el login con tu cuenta de supabase.com. Cuando termine, la terminal mostrará "Logged in as manidmt5@gmail.com" o similar.

- [ ] **Step 3: Vincular CLI al proyecto**

```bash
npx supabase link --project-ref pqfixpcbupdslrdfealq
```

Pedirá la database password del proyecto (la que pusiste al crear el proyecto en supabase.com). Si no la recuerdas, está en Settings → Database → Connection string del dashboard.

- [ ] **Step 4: Registrarse en GoCardless y obtener secrets**

1. Ir a https://bankaccountdata.gocardless.com/
2. Registrar cuenta gratuita con tu email
3. En el dashboard → Developers → User secrets → "Create new"
4. Guardar el `Secret ID` y `Secret Key`

- [ ] **Step 5: Guardar secrets en Supabase**

```bash
npx supabase secrets set GOCARDLESS_SECRET_ID="<TU_SECRET_ID>" GOCARDLESS_SECRET_KEY="<TU_SECRET_KEY>" APP_URL="https://wealthos.manidmt.es" --project-ref pqfixpcbupdslrdfealq
```

Verificar:
```bash
npx supabase secrets list --project-ref pqfixpcbupdslrdfealq
```

Expected: 3 secrets listados (GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY, APP_URL).

- [ ] **Step 6: Verificar institution IDs de GoCardless para tus bancos**

```bash
# Obtener token
TOKEN=$(curl -s -X POST https://bankaccountdata.gocardless.com/api/v2/token/new/ \
  -H "Content-Type: application/json" \
  -d "{\"secret_id\": \"$GOCARDLESS_SECRET_ID\", \"secret_key\": \"$GOCARDLESS_SECRET_KEY\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access'])")

# Buscar tus bancos en España
curl -s "https://bankaccountdata.gocardless.com/api/v2/institutions/?country=ES" \
  -H "Authorization: Bearer $TOKEN" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
targets = ['bbva', 'n26', 'revolut', 'myinvestor', 'trade']
for inst in data:
    if any(t in inst['name'].lower() for t in targets):
        print(inst['id'], inst['name'])
"
```

Anota los IDs reales — los necesitarás en Task 7 (frontend). Ejemplo típico de salida:
```
BBVA_ES_BBVAESMMXXX BBVA
N26_NTSBDEB1XXX N26
REVOLUT_REVOGB21 Revolut
```

- [ ] **Step 7: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: link supabase CLI to new project"
```

---

### Task 2: Migración de base de datos

**Files:** `supabase/migrations/<timestamp>_open_banking.sql` (aplicar vía SQL Editor)

- [ ] **Step 1: Aplicar migración en SQL Editor del nuevo proyecto**

Ir a https://supabase.com/dashboard/project/pqfixpcbupdslrdfealq/sql y ejecutar:

```sql
-- Columna de deduplicación en movements
alter table public.movements add column if not exists external_id text;
create unique index if not exists movements_external_id_idx on public.movements(external_id) where external_id is not null;

-- Tabla bank_connections
create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_id text not null,
  institution_name text not null,
  requisition_id text not null unique,
  account_ids jsonb not null default '[]',
  status text not null default 'pending'
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

- [ ] **Step 2: Verificar**

En el mismo SQL Editor:

```sql
select column_name from information_schema.columns
where table_name = 'movements' and column_name = 'external_id';

select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'bank_connections';
```

Expected: 2 filas de resultado.

---

### Task 3: Edge Function — shared utilities

**Files:**
- Crear: `supabase/functions/_shared/cors.ts`
- Crear: `supabase/functions/_shared/gocardless.ts`

- [ ] **Step 1: Crear headers CORS compartidos**

```typescript
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Crear cliente GoCardless compartido**

```typescript
// supabase/functions/_shared/gocardless.ts
const GC_BASE = "https://bankaccountdata.gocardless.com/api/v2";

export async function getToken(): Promise<string> {
  const resp = await fetch(`${GC_BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      secret_id: Deno.env.get("GOCARDLESS_SECRET_ID"),
      secret_key: Deno.env.get("GOCARDLESS_SECRET_KEY"),
    }),
  });
  if (!resp.ok) throw new Error(`GoCardless token error: ${await resp.text()}`);
  const { access } = await resp.json();
  return access as string;
}

export async function createRequisition(
  token: string,
  institutionId: string,
  reference: string,
  redirectUrl: string,
) {
  const resp = await fetch(`${GC_BASE}/requisitions/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      redirect: redirectUrl,
      institution_id: institutionId,
      reference,
      language: "ES",
    }),
  });
  if (!resp.ok) throw new Error(`Create requisition error: ${await resp.text()}`);
  return resp.json() as Promise<{ id: string; link: string; status: string }>;
}

export async function getRequisition(token: string, requisitionId: string) {
  const resp = await fetch(`${GC_BASE}/requisitions/${requisitionId}/`, {
    headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Get requisition error: ${await resp.text()}`);
  return resp.json() as Promise<{ id: string; status: string; accounts: string[] }>;
}

export async function getTransactions(
  token: string,
  accountId: string,
  dateFrom?: string,
) {
  const url = new URL(`${GC_BASE}/accounts/${accountId}/transactions/`);
  if (dateFrom) url.searchParams.set("date_from", dateFrom);
  const resp = await fetch(url.toString(), {
    headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Get transactions error: ${await resp.text()}`);
  const data = await resp.json() as { transactions: { booked: unknown[]; pending: unknown[] } };
  return data.transactions.booked ?? [];
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: add GoCardless shared Edge Function utilities"
```

---

### Task 4: Edge Function — bank-connect

**Files:**
- Crear: `supabase/functions/bank-connect/index.ts`

- [ ] **Step 1: Crear la función**

```typescript
// supabase/functions/bank-connect/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { getToken, createRequisition } from "../_shared/gocardless.ts";

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

    const { institution_id, institution_name } = await req.json() as {
      institution_id: string;
      institution_name: string;
    };

    const token = await getToken();
    const reference = `${user.id.slice(0, 8)}_${Date.now()}`;
    const redirectUrl = `${Deno.env.get("APP_URL") ?? "https://wealthos.manidmt.es"}/bank-callback`;

    const requisition = await createRequisition(token, institution_id, reference, redirectUrl);

    await supabase.from("bank_connections").upsert(
      {
        user_id: user.id,
        institution_id,
        institution_name,
        requisition_id: requisition.id,
        account_ids: [],
        status: "pending",
      },
      { onConflict: "user_id,institution_id" },
    );

    return corsResponse({ link: requisition.link, requisition_id: requisition.id });
  } catch (e) {
    console.error(e);
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/bank-connect/
git commit -m "feat: add bank-connect Edge Function"
```

---

### Task 5: Edge Function — bank-callback

**Files:**
- Crear: `supabase/functions/bank-callback/index.ts`

- [ ] **Step 1: Crear la función**

```typescript
// supabase/functions/bank-callback/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { getToken, getRequisition, getTransactions } from "../_shared/gocardless.ts";

function mapTransaction(tx: Record<string, unknown>, userId: string) {
  const amountRaw = (tx.transactionAmount as { amount: string; currency: string });
  const amount = parseFloat(amountRaw.amount);
  const isIncome = amount > 0;
  const description =
    (tx.remittanceInformationUnstructured as string) ??
    (tx.creditorName as string) ??
    (tx.debtorName as string) ??
    "Sin descripción";
  return {
    user_id: userId,
    date: (tx.bookingDate ?? tx.valueDate) as string,
    type: isIncome ? "income" : "expense",
    amount: Math.abs(amount),
    currency: amountRaw.currency,
    description: description.trim().slice(0, 200),
    category: "Sin categoría",
    external_id: tx.transactionId as string,
  };
}

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

    const { requisition_id } = await req.json() as { requisition_id: string };
    const token = await getToken();
    const requisition = await getRequisition(token, requisition_id);

    if (!requisition.accounts?.length) {
      await supabase.from("bank_connections")
        .update({ status: "error", error_message: "No accounts returned" })
        .eq("requisition_id", requisition_id);
      return corsResponse({ error: "No accounts linked" }, 400);
    }

    await supabase.from("bank_connections")
      .update({ account_ids: requisition.accounts, status: "active", error_message: null })
      .eq("requisition_id", requisition_id);

    // Initial sync: fetch last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateFrom = ninetyDaysAgo.toISOString().slice(0, 10);

    let inserted = 0;
    for (const accountId of requisition.accounts) {
      const txs = await getTransactions(token, accountId, dateFrom);
      if (!txs.length) continue;
      const rows = (txs as Record<string, unknown>[])
        .filter((tx) => tx.transactionId)
        .map((tx) => mapTransaction(tx, user.id));
      const { error } = await supabase.from("movements").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
      if (error) console.error("upsert error:", error.message);
      else inserted += rows.length;
    }

    await supabase.from("bank_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("requisition_id", requisition_id);

    return corsResponse({ ok: true, accounts: requisition.accounts.length, inserted });
  } catch (e) {
    console.error(e);
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/bank-callback/
git commit -m "feat: add bank-callback Edge Function with initial 90-day sync"
```

---

### Task 6: Edge Functions — bank-sync y bank-sync-all

**Files:**
- Crear: `supabase/functions/bank-sync/index.ts`
- Crear: `supabase/functions/bank-sync-all/index.ts`

- [ ] **Step 1: Crear bank-sync (sync usuario específico)**

```typescript
// supabase/functions/bank-sync/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { getToken, getTransactions } from "../_shared/gocardless.ts";

function mapTransaction(tx: Record<string, unknown>, userId: string) {
  const amountRaw = tx.transactionAmount as { amount: string; currency: string };
  const amount = parseFloat(amountRaw.amount);
  const description =
    (tx.remittanceInformationUnstructured as string) ??
    (tx.creditorName as string) ??
    (tx.debtorName as string) ??
    "Sin descripción";
  return {
    user_id: userId,
    date: (tx.bookingDate ?? tx.valueDate) as string,
    type: amount > 0 ? "income" : "expense",
    amount: Math.abs(amount),
    currency: amountRaw.currency,
    description: description.trim().slice(0, 200),
    category: "Sin categoría",
    external_id: tx.transactionId as string,
  };
}

async function syncConnection(
  supabase: ReturnType<typeof createClient>,
  conn: { id: string; account_ids: string[]; last_synced_at: string | null; user_id: string },
  token: string,
) {
  const dateFrom = conn.last_synced_at
    ? conn.last_synced_at.slice(0, 10)
    : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  let inserted = 0;
  for (const accountId of conn.account_ids as string[]) {
    const txs = await getTransactions(token, accountId, dateFrom);
    if (!txs.length) continue;
    const rows = (txs as Record<string, unknown>[])
      .filter((tx) => tx.transactionId)
      .map((tx) => mapTransaction(tx, conn.user_id));
    const { error } = await supabase.from("movements").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
    if (!error) inserted += rows.length;
  }
  await supabase.from("bank_connections")
    .update({ last_synced_at: new Date().toISOString(), error_message: null })
    .eq("id", conn.id);
  return inserted;
}

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

    const token = await getToken();
    let totalInserted = 0;
    for (const conn of connections ?? []) {
      totalInserted += await syncConnection(supabase, conn, token);
    }

    return corsResponse({ ok: true, synced: (connections ?? []).length, inserted: totalInserted });
  } catch (e) {
    console.error(e);
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Crear bank-sync-all (cron — todos los usuarios, usa service_role)**

```typescript
// supabase/functions/bank-sync-all/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { getToken, getTransactions } from "../_shared/gocardless.ts";

function mapTransaction(tx: Record<string, unknown>, userId: string) {
  const amountRaw = tx.transactionAmount as { amount: string; currency: string };
  const amount = parseFloat(amountRaw.amount);
  const description =
    (tx.remittanceInformationUnstructured as string) ??
    (tx.creditorName as string) ??
    (tx.debtorName as string) ??
    "Sin descripción";
  return {
    user_id: userId,
    date: (tx.bookingDate ?? tx.valueDate) as string,
    type: amount > 0 ? "income" : "expense",
    amount: Math.abs(amount),
    currency: amountRaw.currency,
    description: description.trim().slice(0, 200),
    category: "Sin categoría",
    external_id: tx.transactionId as string,
  };
}

serve(async (req) => {
  // Only accept calls from Supabase scheduler (service role key in Authorization)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader.includes(serviceKey.slice(-20))) {
    return corsResponse({ error: "Forbidden" }, 403);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
  );

  try {
    const token = await getToken();
    const { data: connections } = await supabase
      .from("bank_connections")
      .select("*")
      .eq("status", "active");

    let totalInserted = 0;
    for (const conn of connections ?? []) {
      const dateFrom = conn.last_synced_at
        ? conn.last_synced_at.slice(0, 10)
        : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

      for (const accountId of conn.account_ids as string[]) {
        const txs = await getTransactions(token, accountId, dateFrom);
        if (!txs.length) continue;
        const rows = (txs as Record<string, unknown>[])
          .filter((tx) => tx.transactionId)
          .map((tx) => mapTransaction(tx, conn.user_id));
        const { error } = await supabase.from("movements").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
        if (!error) totalInserted += rows.length;
      }
      await supabase.from("bank_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    return corsResponse({ ok: true, connections: (connections ?? []).length, inserted: totalInserted });
  } catch (e) {
    console.error(e);
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bank-sync/ supabase/functions/bank-sync-all/
git commit -m "feat: add bank-sync and bank-sync-all Edge Functions"
```

---

### Task 7: Desplegar Edge Functions

**Files:** ninguno (deploy via CLI)

- [ ] **Step 1: Desplegar todas las funciones**

```bash
npx supabase functions deploy bank-connect --project-ref pqfixpcbupdslrdfealq --no-verify-jwt=false
npx supabase functions deploy bank-callback --project-ref pqfixpcbupdslrdfealq --no-verify-jwt=false
npx supabase functions deploy bank-sync --project-ref pqfixpcbupdslrdfealq --no-verify-jwt=false
npx supabase functions deploy bank-sync-all --project-ref pqfixpcbupdslrdfealq --no-verify-jwt=true
```

`bank-sync-all` usa `--no-verify-jwt=true` porque el cron de Supabase no pasa un JWT de usuario.

- [ ] **Step 2: Verificar que están desplegadas**

```bash
npx supabase functions list --project-ref pqfixpcbupdslrdfealq
```

Expected: 4 filas con bank-connect, bank-callback, bank-sync, bank-sync-all.

- [ ] **Step 3: Configurar sync diario en el dashboard**

En https://supabase.com/dashboard/project/pqfixpcbupdslrdfealq/functions:
1. Clic en `bank-sync-all`
2. Clic en "Schedule" → "Create a schedule"
3. Cron expression: `0 8 * * *` (todos los días a las 8:00 UTC)
4. Guardar

---

### Task 8: Frontend — bank-api.ts

**Files:**
- Crear: `src/lib/bank-api.ts`

- [ ] **Step 1: Crear hooks React Query para bank_connections**

```typescript
// src/lib/bank-api.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type BankConnectionStatus = "pending" | "active" | "expired" | "error";

export type BankConnection = {
  id: string;
  user_id: string;
  institution_id: string;
  institution_name: string;
  requisition_id: string;
  account_ids: string[];
  status: BankConnectionStatus;
  last_synced_at: string | null;
  error_message: string | null;
  created_at: string;
};

export type Institution = { id: string; name: string };

export const INSTITUTIONS: Institution[] = [
  { id: "BBVA_ES_BBVAESMMXXX", name: "BBVA" },
  { id: "N26_NTSBDEB1XXX", name: "N26" },
  { id: "REVOLUT_REVOGB21", name: "Revolut" },
  { id: "INGDDEFFXXX_ES", name: "ING" },
  { id: "SANTANDER_BSCHESMM", name: "Santander" },
  { id: "CAIXABANK_CAIXESBBXXX", name: "CaixaBank" },
  { id: "MYINVESTOR_ES", name: "MyInvestor" },
  { id: "TRADE_REPUBLIC_TRPUDEB1XXX", name: "Trade Republic" },
];
// ⚠️ Verify these IDs with GoCardless API: GET /api/v2/institutions/?country=ES
// Update after running Task 1 Step 6

export function useBankConnections() {
  const { user } = useAuth();
  return useQuery<BankConnection[]>({
    queryKey: ["bank_connections", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("bank_connections")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useConnectBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (institution: Institution): Promise<{ link: string; requisition_id: string }> => {
      const { data, error } = await supabase.functions.invoke("bank-connect", {
        body: { institution_id: institution.id, institution_name: institution.name },
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
      const { error } = await (supabase as any)
        .from("bank_connections")
        .delete()
        .eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank_connections"] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/bank-api.ts
git commit -m "feat: add bank-api hooks for bank_connections"
```

---

### Task 9: Frontend — ruta /bank-callback

**Files:**
- Crear: `src/routes/bank-callback.tsx`
- Modificar: `src/routeTree.gen.ts` (auto-generado por TanStack, se regenera con `npm run dev`)

- [ ] **Step 1: Crear la ruta**

```typescript
// src/routes/bank-callback.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/bank-callback")({
  component: BankCallbackPage,
});

function BankCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (!ref) {
      setStatus("error");
      setMessage("No requisition reference found in URL");
      return;
    }

    supabase.functions
      .invoke("bank-callback", { body: { requisition_id: ref } })
      .then(({ data, error }) => {
        if (error || data?.error) {
          setStatus("error");
          setMessage(error?.message ?? data?.error ?? "Unknown error");
        } else {
          setStatus("ok");
          setMessage(`${data.accounts} cuenta(s) conectada(s), ${data.inserted} transacciones importadas.`);
          setTimeout(() => navigate({ to: "/settings" }), 2000);
        }
      });
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      {status === "loading" && (
        <p className="text-[13px] text-muted-foreground">Conectando banco…</p>
      )}
      {status === "ok" && (
        <div className="text-center">
          <p className="text-[15px] font-medium text-foreground">Banco conectado</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{message}</p>
          <p className="mt-3 text-[12px] text-muted-foreground">Redirigiendo a Configuración…</p>
        </div>
      )}
      {status === "error" && (
        <div className="text-center">
          <p className="text-[15px] font-medium text-destructive">Error al conectar</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{message}</p>
          <button
            type="button"
            onClick={() => navigate({ to: "/settings" })}
            className="mt-4 rounded-md border border-border px-4 py-2 text-[13px]"
          >
            Volver a Configuración
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Añadir la ruta al AppSidebar type guard**

En `src/components/app/AppSidebar.tsx`, en el tipo `NavItem`, añadir `"/bank-callback"` al union type de `url`. Buscar la línea:

```typescript
type NavItem = {
  title: string;
  url: "/" | "/expenses" | "/portfolio" | "/net-worth" | "/balances" | "/settings" | "/assistant" | "/planning";
```

Y cambiarlo a:

```typescript
type NavItem = {
  title: string;
  url: "/" | "/expenses" | "/portfolio" | "/net-worth" | "/balances" | "/settings" | "/assistant" | "/planning" | "/bank-callback";
```

- [ ] **Step 3: Regenerar routeTree y verificar**

```bash
npm run dev &
sleep 8
kill %1
grep "bank-callback" src/routeTree.gen.ts | head -3
```

Expected: al menos una línea con `/bank-callback` en el routeTree generado.

- [ ] **Step 4: Commit**

```bash
git add src/routes/bank-callback.tsx src/routeTree.gen.ts src/components/app/AppSidebar.tsx
git commit -m "feat: add /bank-callback route for GoCardless OAuth redirect"
```

---

### Task 10: Frontend — sección Bancos en Settings

**Files:**
- Modificar: `src/routes/settings.tsx`

- [ ] **Step 1: Añadir imports al principio del archivo**

Al inicio de `src/routes/settings.tsx`, añadir después de los imports existentes:

```typescript
import { Building2, RefreshCw, Unlink, Plus, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import {
  useBankConnections,
  useConnectBank,
  useSyncBank,
  useDisconnectBank,
  INSTITUTIONS,
  type BankConnection,
} from "@/lib/bank-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
```

- [ ] **Step 2: Añadir el componente BankSection dentro de settings.tsx**

Añadir el componente justo antes de la función `SettingsPage`:

```typescript
function StatusBadge({ status }: { status: BankConnection["status"] }) {
  if (status === "active") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive ring-1 ring-positive/30">
      <CheckCircle2 className="h-3 w-3" /> Activa
    </span>
  );
  if (status === "pending") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning ring-1 ring-warning/30">
      <Clock className="h-3 w-3" /> Pendiente
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive ring-1 ring-destructive/30">
      <AlertCircle className="h-3 w-3" /> {status === "expired" ? "Expirada" : "Error"}
    </span>
  );
}

function BankSection() {
  const { data: connections = [], isLoading } = useBankConnections();
  const connectBank = useConnectBank();
  const syncBank = useSyncBank();
  const disconnectBank = useDisconnectBank();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleConnect(institution: typeof INSTITUTIONS[number]) {
    const result = await connectBank.mutateAsync(institution);
    setDialogOpen(false);
    window.location.href = result.link;
  }

  return (
    <SectionCard
      title="Cuentas bancarias"
      description="Conecta tus bancos vía Open Banking para importar transacciones automáticamente."
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-[13px] text-muted-foreground">Cargando…</p>
        )}

        {connections.map((conn) => (
          <div
            key={conn.id}
            className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{conn.institution_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {conn.last_synced_at
                    ? `Sincronizado ${new Date(conn.last_synced_at).toLocaleDateString("es-ES")}`
                    : "Sin sincronizar"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={conn.status} />
              {conn.status === "active" && (
                <button
                  type="button"
                  title="Sincronizar"
                  onClick={() => syncBank.mutate(conn.id)}
                  disabled={syncBank.isPending}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncBank.isPending ? "animate-spin" : ""}`} />
                </button>
              )}
              <button
                type="button"
                title="Desconectar"
                onClick={() => disconnectBank.mutate(conn.id)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-destructive"
              >
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {connections.length === 0 && !isLoading && (
          <p className="text-[13px] text-muted-foreground">
            Ningún banco conectado. Conecta tu primer banco para importar transacciones automáticamente.
          </p>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-2.5 text-[13px] text-muted-foreground transition hover:border-border-strong hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Conectar banco
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Selecciona tu banco</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2 pt-2">
              {INSTITUTIONS.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  onClick={() => handleConnect(inst)}
                  disabled={connectBank.isPending}
                  className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-left text-[13px] font-medium transition hover:bg-muted disabled:opacity-40"
                >
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {inst.name}
                </button>
              ))}
            </div>
            {connectBank.isError && (
              <p className="text-[12px] text-destructive">{(connectBank.error as Error).message}</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 3: Añadir `useState` al import de React y `BankSection` al JSX**

Verificar que `useState` está importado en el archivo. Si no está, añadirlo:
```typescript
import { useState } from "react";
```

En el JSX de `SettingsPage`, añadir `<BankSection />` justo antes de la sección "Estado del proyecto" (antes del `<section>` que contiene "Modo demostración"):

```typescript
        <BankSection />

        <section>
          <SectionLabel>Estado del proyecto</SectionLabel>
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.tsx src/lib/bank-api.ts
git commit -m "feat: add bank connections section to Settings page"
```

---

### Task 11: Build, deploy y verificación final

**Files:** ninguno

- [ ] **Step 1: Build**

```bash
npm run build 2>&1 | tail -6
```

Expected: `✓ built in XX.XXs` (dos veces, client y server). Sin errores TypeScript.

- [ ] **Step 2: Deploy**

```bash
systemctl --user restart wealth-navigator && sleep 3 && curl -sI http://localhost:8090/ | head -3
```

Expected: `HTTP/1.1 200`

- [ ] **Step 3: Verificar institution IDs reales y actualizar bank-api.ts**

Con los IDs reales obtenidos en Task 1 Step 6, actualizar el array `INSTITUTIONS` en `src/lib/bank-api.ts` si algún ID era incorrecto. Rebuild si hubo cambios:

```bash
npm run build 2>&1 | tail -3
systemctl --user restart wealth-navigator
```

- [ ] **Step 4: Test end-to-end**

1. Abrir `https://wealthos.manidmt.es/settings`
2. Scroll hasta "Cuentas bancarias"
3. Clic "Conectar banco" → seleccionar BBVA
4. Verificar redirección a GoCardless / BBVA OAuth
5. Completar autorización → redirección a `/bank-callback`
6. Verificar mensaje "Banco conectado"
7. Ir a Configuración → verificar que BBVA aparece como "Activa"
8. Comprobar en Supabase dashboard → Table Editor → movements que hay filas con `external_id` no nulo

- [ ] **Step 5: Commit final**

```bash
git add src/lib/bank-api.ts
git commit -m "chore: verify and finalize Open Banking integration"
```
