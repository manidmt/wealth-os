# Importación bancaria robusta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Categorización bank-agnóstica (MCC + LLM gpt-4o-mini), exclusión de movimientos ("no contabilizar"), y detección de duplicados contra gastos manuales, para que la importación de Enable Banking sea definitiva.

**Architecture:** Mapa MCC puro + clasificador LLM por lotes en `_shared/`; detección de duplicados pura; las 3 funciones de sync orquestan MCC→dedup→LLM→upsert; nuevas columnas `movements.excluded`/`duplicate_of`; el dashboard excluye `excluded`; UI de toggle y revisión de duplicados.

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), OpenAI gpt-4o-mini, React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-bank-import-robust-design.md`

**⚠️ Task 8 (deploy + secret OPENAI_API_KEY + re-sync) la hace el controlador; la key está en `/tmp/wealth-agent/.env`.**

---

## Estructura de ficheros

| Fichero | Acción |
|---|---|
| `supabase/migrations/20260613150000_movements_flags.sql` | Crear (excluded, duplicate_of) |
| `supabase/functions/_shared/mcc-categories.ts` + `src/lib/mcc-categories.ts` + test | Crear (mapa MCC) |
| `supabase/functions/_shared/dedup.ts` + `src/lib/dedup.ts` + test | Crear (findDuplicate) |
| `supabase/functions/_shared/llm-classify.ts` + `src/lib/llm-classify.ts` + test | Crear (prompt/parse + classifyBatch) |
| `supabase/functions/_shared/bank-mapping.ts` + test | Modificar (MCC en vez de keyword) |
| `supabase/functions/_shared/categorize.ts`, `src/lib/categorize.ts`, `src/lib/categorize.test.ts` | Borrar (superado) |
| `supabase/functions/bank-callback/index.ts`, `bank-sync/index.ts`, `bank-sync-all/index.ts` | Modificar (pipeline) |
| `src/lib/movements-api.ts` | Modificar (excluded/duplicate_of) |
| `src/lib/dashboard-data.ts` | Modificar (excluir excluded) |
| `src/components/app/AddMovementSheet.tsx` | Modificar (toggle No contabilizar) |
| `src/routes/expenses.tsx` | Modificar (revisar duplicados + estilo excluded) |

---

### Task 1: Migración + tipos + totales

**Files:** Create `supabase/migrations/20260613150000_movements_flags.sql`; Modify `src/lib/movements-api.ts`, `src/lib/dashboard-data.ts`

- [ ] **Step 1: Migración** — contenido exacto:
```sql
alter table public.movements
  add column if not exists excluded boolean not null default false,
  add column if not exists duplicate_of uuid references public.movements(id) on delete set null;
```

- [ ] **Step 2: Aplicar** `npx supabase db push 2>&1 | tail -6`. Expected: aplica `20260613150000`. Si se queja de migraciones anteriores, NO tocar — reportar.

- [ ] **Step 3: Verificar** (anon en .env como VITE_SUPABASE_PUBLISHABLE_KEY):
```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -4 -s "$URL/rest/v1/movements?select=excluded,duplicate_of&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]` o filas (NO "column does not exist").

- [ ] **Step 4: Tipos en `src/lib/movements-api.ts`** — en `MovementRecord` (tras `currency`) añadir:
```typescript
  excluded: boolean;
  duplicate_of: string | null;
```
En `rowToRecord`, añadir al objeto devuelto (tras `currency`):
```typescript
    excluded: row.excluded ?? false,
    duplicate_of: row.duplicate_of ?? null,
```
En `useMonthMovements`, ampliar el `.select(...)` a:
```typescript
        .select("id, type, date, category, description, amount, currency, excluded, duplicate_of")
```
En `CreateMovementInput` (buscar su definición arriba del fichero) añadir campo opcional:
```typescript
  excluded?: boolean;
```
y en `useCreateMovement` añadir `excluded: input.excluded ?? false,` al insert. `useUpdateMovement` ya hace spread de `patch`, así que `excluded` se actualizará al pasarlo.

- [ ] **Step 5: Excluir en totales** — en `src/lib/dashboard-data.ts`, en `computeDashboard`, dentro del bucle `for (const m of movements)` (justo después de la línea `for (const m of movements) {`) añadir como primera sentencia:
```typescript
    if (m.excluded) continue;
```
Y en la query que carga los movimientos del dashboard (buscar el `.from("movements").select(...)` con queryKey `["dashboard-snapshot", ...]`), añadir `excluded` a la lista de columnas seleccionadas (si usa `select("*")` no hace falta).

- [ ] **Step 6: Verificar** `npm run build 2>&1 | tail -3` → ✓ built. `npm test` → 50 verde. Commit:
```bash
git add supabase/migrations/20260613150000_movements_flags.sql src/lib/movements-api.ts src/lib/dashboard-data.ts
git commit -m "feat: movements.excluded/duplicate_of columns; exclude from totals"
```

---

### Task 2: Mapa MCC (TDD)

**Files:** Create `supabase/functions/_shared/mcc-categories.ts`, `src/lib/mcc-categories.ts`, `src/lib/mcc-categories.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/mcc-categories.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { categoryFromMcc } from "./mcc-categories";

describe("categoryFromMcc", () => {
  it("5411 supermercado → Comida", () => expect(categoryFromMcc("5411")).toBe("Comida"));
  it("5812 restaurante → Comer fuera", () => expect(categoryFromMcc("5812")).toBe("Comer fuera"));
  it("4121 taxi/rideshare → Transporte", () => expect(categoryFromMcc("4121")).toBe("Transporte"));
  it("5541 gasolinera → Coche", () => expect(categoryFromMcc("5541")).toBe("Coche"));
  it("4900 utilities → Hogar", () => expect(categoryFromMcc("4900")).toBe("Hogar"));
  it("4899 streaming → Suscripciones", () => expect(categoryFromMcc("4899")).toBe("Suscripciones"));
  it("ambiguo 5999 → null", () => expect(categoryFromMcc("5999")).toBeNull());
  it("null/undefined → null", () => {
    expect(categoryFromMcc(null)).toBeNull();
    expect(categoryFromMcc(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npm test -- mcc-categories` → FAIL.

- [ ] **Step 3: Implementar** — `supabase/functions/_shared/mcc-categories.ts`:
```typescript
// MCC (ISO 18245) → categoría de la app. Estándar, agnóstico al banco.
// null = ambiguo/desconocido → lo resuelve la capa LLM.
const MCC_MAP: Record<string, string> = {
  // Comida / supermercados
  "5411": "Comida", "5422": "Comida", "5451": "Comida", "5462": "Comida", "5499": "Comida",
  // Comer fuera
  "5811": "Comer fuera", "5812": "Comer fuera", "5814": "Comer fuera",
  // Transporte
  "4111": "Transporte", "4112": "Transporte", "4121": "Transporte", "4131": "Transporte", "4789": "Transporte",
  // Coche
  "5541": "Coche", "5542": "Coche", "7523": "Coche", "7538": "Coche", "7549": "Coche",
  // Viaje
  "4511": "Viaje", "4722": "Viaje", "7011": "Viaje", "7512": "Viaje",
  // Salud
  "5912": "Salud", "8011": "Salud", "8021": "Salud", "8042": "Salud", "8043": "Salud", "8062": "Salud",
  // Gimnasio / deporte
  "7997": "Gimnasio", "7941": "Gimnasio", "5940": "Deporte", "5941": "Deporte",
  // Ropa
  "5611": "Ropa", "5621": "Ropa", "5631": "Ropa", "5651": "Ropa", "5691": "Ropa", "5699": "Ropa",
  // Tecnología
  "5045": "Tecnología", "5732": "Tecnología", "5734": "Tecnología", "7372": "Tecnología",
  // Suscripciones / digital
  "4899": "Suscripciones", "5815": "Suscripciones", "5816": "Suscripciones", "5817": "Suscripciones", "5818": "Suscripciones",
  // Hogar / suministros / telecom
  "4814": "Hogar", "4900": "Hogar", "5200": "Hogar", "5211": "Hogar", "5251": "Hogar",
  // Ocio
  "7832": "Ocio", "7841": "Ocio", "7922": "Ocio", "7929": "Ocio", "7996": "Ocio", "5813": "Ocio",
  // Educación / formación
  "8211": "Educación", "8220": "Educación", "8241": "Educación", "8299": "Educación", "5942": "Educación",
  // Impuestos / administración
  "9311": "Impuestos", "9222": "Impuestos", "9399": "Impuestos",
  // Cuidado personal
  "7230": "Cuidado personal", "7298": "Cuidado personal", "5977": "Cuidado personal",
  // Regalo
  "5947": "Regalo",
};

export function categoryFromMcc(mcc: string | null | undefined): string | null {
  if (!mcc) return null;
  return MCC_MAP[mcc.trim()] ?? null;
}
```
Y `src/lib/mcc-categories.ts`:
```typescript
export * from "../../supabase/functions/_shared/mcc-categories";
```

- [ ] **Step 4: Run** `npm test -- mcc-categories` → pasan. Global verde.

- [ ] **Step 5: Lint+commit**:
```bash
npx eslint --fix src/lib/mcc-categories.ts src/lib/mcc-categories.test.ts
git add supabase/functions/_shared/mcc-categories.ts src/lib/mcc-categories.ts src/lib/mcc-categories.test.ts
git commit -m "feat: MCC (ISO 18245) to category map"
```

---

### Task 3: Detección de duplicados (TDD)

**Files:** Create `supabase/functions/_shared/dedup.ts`, `src/lib/dedup.ts`, `src/lib/dedup.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/dedup.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { findDuplicate, type DedupRow } from "./dedup";

const manuals: DedupRow[] = [
  { id: "m1", amount: 15, type: "expense", date: "2026-06-10" },
  { id: "m2", amount: 50, type: "expense", date: "2026-06-01" },
];

describe("findDuplicate", () => {
  it("mismo importe+tipo, fecha exacta → match", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-10" }, manuals)).toBe("m1"));
  it("dentro de ±3 días → match", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-12" }, manuals)).toBe("m1"));
  it("fuera de ±3 días → null", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-20" }, manuals)).toBeNull());
  it("importe distinto → null", () =>
    expect(findDuplicate({ amount: 14, type: "expense", date: "2026-06-10" }, manuals)).toBeNull());
  it("tipo distinto → null", () =>
    expect(findDuplicate({ amount: 15, type: "income", date: "2026-06-10" }, manuals)).toBeNull());
  it("sin manuales → null", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-10" }, [])).toBeNull());
});
```

- [ ] **Step 2: Run** `npm test -- dedup` → FAIL.

- [ ] **Step 3: Implementar** — `supabase/functions/_shared/dedup.ts`:
```typescript
export type DedupRow = { id: string; amount: number; type: "income" | "expense"; date: string };
export type DedupQuery = { amount: number; type: "income" | "expense"; date: string };

const DAY = 86400000;

/** Devuelve el id del manual que parece duplicar a `q` (mismo importe+tipo, fecha ±3 días), o null. */
export function findDuplicate(q: DedupQuery, manuals: DedupRow[], toleranceDays = 3): string | null {
  const qt = new Date(q.date).getTime();
  for (const m of manuals) {
    if (m.type !== q.type) continue;
    if (Math.abs(Number(m.amount) - Number(q.amount)) > 0.001) continue;
    const diffDays = Math.abs(new Date(m.date).getTime() - qt) / DAY;
    if (diffDays <= toleranceDays) return m.id;
  }
  return null;
}
```
Y `src/lib/dedup.ts`:
```typescript
export * from "../../supabase/functions/_shared/dedup";
```

- [ ] **Step 4: Run** `npm test -- dedup` → pasan. Global verde.

- [ ] **Step 5: Lint+commit**:
```bash
npx eslint --fix src/lib/dedup.ts src/lib/dedup.test.ts
git add supabase/functions/_shared/dedup.ts src/lib/dedup.ts src/lib/dedup.test.ts
git commit -m "feat: duplicate detection against manual movements"
```

---

### Task 4: Clasificador LLM (TDD para los helpers puros)

**Files:** Create `supabase/functions/_shared/llm-classify.ts`, `src/lib/llm-classify.ts`, `src/lib/llm-classify.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/llm-classify.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildClassifyPrompt, parseClassifyResponse } from "./llm-classify";

const cats = ["Comida", "Transporte", "Suscripciones"];

describe("buildClassifyPrompt", () => {
  it("incluye categorías e ids", () => {
    const p = buildClassifyPrompt([{ id: "a", description: "UBER TRIP" }], cats);
    expect(p).toContain("Comida");
    expect(p).toContain("Transporte");
    expect(p).toContain("UBER TRIP");
    expect(p).toContain('"a"');
  });
});

describe("parseClassifyResponse", () => {
  it("asigna categorías válidas", () =>
    expect(parseClassifyResponse('{"a":"Transporte","b":"Comida"}', cats, ["a", "b"]))
      .toEqual({ a: "Transporte", b: "Comida" }));
  it("categoría inválida → Sin categoría", () =>
    expect(parseClassifyResponse('{"a":"Coches"}', cats, ["a"])).toEqual({ a: "Sin categoría" }));
  it("id ausente → Sin categoría", () =>
    expect(parseClassifyResponse('{"a":"Comida"}', cats, ["a", "b"]))
      .toEqual({ a: "Comida", b: "Sin categoría" }));
  it("JSON malformado → todo Sin categoría", () =>
    expect(parseClassifyResponse("no soy json", cats, ["a", "b"]))
      .toEqual({ a: "Sin categoría", b: "Sin categoría" }));
});
```

- [ ] **Step 2: Run** `npm test -- llm-classify` → FAIL.

- [ ] **Step 3: Implementar** — `supabase/functions/_shared/llm-classify.ts`:
```typescript
const FALLBACK = "Sin categoría";

export function buildClassifyPrompt(items: { id: string; description: string }[], categories: string[]): string {
  return [
    "Clasifica cada movimiento bancario en EXACTAMENTE una de estas categorías:",
    categories.join(", "),
    "",
    "Responde SOLO un objeto JSON { id: categoria }. Usa exactamente los nombres de categoría dados.",
    "Si dudas, elige la más probable. No inventes categorías nuevas.",
    "",
    "Movimientos:",
    JSON.stringify(items),
  ].join("\n");
}

export function parseClassifyResponse(raw: string, validCategories: string[], ids: string[]): Record<string, string> {
  const valid = new Set(validCategories);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const out: Record<string, string> = {};
  for (const id of ids) {
    const cat = parsed[id];
    out[id] = typeof cat === "string" && valid.has(cat) ? cat : FALLBACK;
  }
  return out;
}

/** Clasifica por lotes con OpenAI gpt-4o-mini. Si falla, todo "Sin categoría". */
export async function classifyBatch(
  items: { id: string; description: string }[],
  categories: string[],
): Promise<Record<string, string>> {
  const ids = items.map((i) => i.id);
  if (items.length === 0) return {};
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return Object.fromEntries(ids.map((id) => [id, FALLBACK]));
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Eres un clasificador de gastos. Devuelves solo JSON." },
          { role: "user", content: buildClassifyPrompt(items, categories) },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`openai HTTP ${resp.status}`);
    const j = await resp.json();
    const content = j.choices?.[0]?.message?.content ?? "{}";
    return parseClassifyResponse(content, categories, ids);
  } catch {
    return Object.fromEntries(ids.map((id) => [id, FALLBACK]));
  }
}
```
Y `src/lib/llm-classify.ts`:
```typescript
export { buildClassifyPrompt, parseClassifyResponse } from "../../supabase/functions/_shared/llm-classify";
```
(Nota: el re-export del frontend NO incluye `classifyBatch` porque usa `Deno.env`; solo se testean los helpers puros.)

- [ ] **Step 4: Run** `npm test -- llm-classify` → pasan. Global verde. `npx --yes deno check supabase/functions/_shared/llm-classify.ts` → pasa.

- [ ] **Step 5: Lint+commit**:
```bash
npx eslint --fix src/lib/llm-classify.ts src/lib/llm-classify.test.ts
git add supabase/functions/_shared/llm-classify.ts src/lib/llm-classify.ts src/lib/llm-classify.test.ts
git commit -m "feat: LLM batch classifier (gpt-4o-mini) with pure prompt/parse helpers"
```

---

### Task 5: Mapeo por MCC (TDD) + retirar categorize keyword

**Files:** Modify `supabase/functions/_shared/bank-mapping.ts`, `src/lib/bank-mapping.test.ts`; Delete `supabase/functions/_shared/categorize.ts`, `src/lib/categorize.ts`, `src/lib/categorize.test.ts`

- [ ] **Step 1: Actualizar el test** `src/lib/bank-mapping.test.ts` — reemplazar el import y los casos que dependían de la categorización por keyword. El mapeo ahora categoriza por MCC (campo `merchant_category_code`), no por descripción:
```typescript
import { describe, it, expect } from "vitest";
import { mapTransaction, isBooked, type EbTransaction } from "./bank-mapping";

const base: EbTransaction = {
  transaction_amount: { amount: "12.34", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-06-10",
  transaction_id: "tx-1",
  merchant_category_code: "5411",
  remittance_information: ["COMPRA SUPERMERCADO"],
};

describe("mapTransaction", () => {
  it("DBIT → expense, amount abs, categoría por MCC", () => {
    expect(mapTransaction(base, "u1")).toMatchObject({
      user_id: "u1", type: "expense", amount: 12.34, currency: "EUR",
      date: "2026-06-10", description: "COMPRA SUPERMERCADO", category: "Comida", external_id: "tx-1",
    });
  });
  it("sin MCC reconocido → Sin categoría", () =>
    expect(mapTransaction({ ...base, merchant_category_code: null }, "u1").category).toBe("Sin categoría"));
  it("CRDT → income", () =>
    expect(mapTransaction({ ...base, credit_debit_indicator: "CRDT", merchant_category_code: null }, "u1").type).toBe("income"));
  it("description desde creditor si no hay remittance", () =>
    expect(mapTransaction({ ...base, remittance_information: undefined, creditor: { name: "ACME SL" } }, "u1").description).toBe("ACME SL"));
  it("external_id cae a entry_reference si falta transaction_id", () =>
    expect(mapTransaction({ ...base, transaction_id: undefined, entry_reference: "ref-9" }, "u1").external_id).toBe("ref-9"));
});

describe("isBooked", () => {
  it("BOOK true, PDNG false", () => {
    expect(isBooked(base)).toBe(true);
    expect(isBooked({ ...base, status: "PDNG" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npm test -- bank-mapping` → FAIL (category sale "Comida" solo si usa MCC; falla con la impl actual de keyword).

- [ ] **Step 3: Modificar** `supabase/functions/_shared/bank-mapping.ts`:
  - Cambiar el import: quitar `import { categorize } from "./categorize.ts";` y poner `import { categoryFromMcc } from "./mcc-categories.ts";`
  - En `EbTransaction` añadir `merchant_category_code?: string | null;`
  - En `mapTransaction`, cambiar la línea de `category` por:
```typescript
    category: categoryFromMcc(tx.merchant_category_code) ?? "Sin categoría",
```

- [ ] **Step 4: Run** `npm test -- bank-mapping` → pasan.

- [ ] **Step 5: Borrar el categorizador por keyword** (superado por MCC+LLM):
```bash
rm supabase/functions/_shared/categorize.ts src/lib/categorize.ts src/lib/categorize.test.ts
grep -rn "categorize" supabase/functions src/ | grep -v "mcc\|llm-classify\|categoria\|category" || echo "sin referencias colgantes"
```
Expected: ninguna referencia restante a `./categorize`. `npm test` global verde (sin los tests de categorize). `npm run build` ✓. `npx --yes deno check supabase/functions/_shared/bank-mapping.ts` ✓.

- [ ] **Step 6: Commit**:
```bash
git add supabase/functions/_shared/bank-mapping.ts src/lib/bank-mapping.test.ts supabase/functions/_shared/categorize.ts src/lib/categorize.ts src/lib/categorize.test.ts
git commit -m "feat: categorize by MCC in mapper; drop keyword categorizer"
```

---

### Task 6: Pipeline en las Edge Functions de sync

**Files:** Modify `supabase/functions/bank-callback/index.ts`, `supabase/functions/bank-sync/index.ts`, `supabase/functions/bank-sync-all/index.ts`

Patrón compartido a aplicar en las TRES (cada una con su scope de usuario). Tras obtener `rows` mapeadas (vía `mapTransaction`), antes del upsert, insertar este bloque (adaptando `userId` y el cliente `supabase`):

```typescript
import { findDuplicate, type DedupRow } from "../_shared/dedup.ts";
import { classifyBatch } from "../_shared/llm-classify.ts";

// EXPENSE_CATEGORIES / INCOME_CATEGORIES (copiadas de src/lib/movements-api.ts; mantener sincronizadas)
const EXPENSE_CATEGORIES = ["Café","Coche","Comer fuera","Comida","Cuidado personal","Deporte","Educación","Formación","Gestiones","Gimnasio","Higiene","Hogar","Impuestos","Ocio","Otro","Regalo","Ropa","Salud","Suplementos","Suscripciones","Tecnología","Transporte","Viaje"];
const INCOME_CATEGORIES = ["Nómina","Salario","Extra","Tarjeta Restaurante","Ticket restaurante","Comer fuera","Otros ingresos"];

// dado: rows: MovementRow[] (de mapTransaction), userId: string, supabase, dateFrom: string
async function enrichRows(supabase: any, rows: any[], userId: string, dateFrom: string) {
  // 1. duplicados contra manuales (external_id null) del usuario en el rango
  const { data: manualsRaw } = await supabase
    .from("movements")
    .select("id, amount, type, date")
    .is("external_id", null)
    .eq("user_id", userId)
    .gte("date", dateFrom);
  const manuals: DedupRow[] = (manualsRaw ?? []).map((m: any) => ({
    id: m.id, amount: Number(m.amount), type: m.type, date: m.date,
  }));
  for (const r of rows) {
    const dup = findDuplicate({ amount: r.amount, type: r.type, date: r.date }, manuals);
    r.duplicate_of = dup;
    r.excluded = dup !== null; // duplicado sospechoso no cuenta hasta revisar
  }
  // 2. capa LLM para las sin categoría, separando por tipo
  for (const type of ["expense", "income"] as const) {
    const pending = rows.filter((r) => r.type === type && r.category === "Sin categoría");
    if (pending.length === 0) continue;
    const cats = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const items = pending.map((r, i) => ({ id: String(i), description: r.description }));
    const result = await classifyBatch(items, cats);
    pending.forEach((r, i) => { r.category = result[String(i)] ?? "Sin categoría"; });
  }
  return rows;
}
```

- [ ] **Step 1: `bank-sync/index.ts`** — importar `enrichRows` helpers (pegar el bloque de arriba como funciones del módulo) y, en el bucle por cuenta, tras construir `rows = txs.map((t) => mapTransaction(t, conn.user_id))`, hacer:
```typescript
        const enriched = await enrichRows(supabase, rows, conn.user_id as string, dateFrom);
        const { error } = await supabase.from("movements").upsert(enriched, { onConflict: "external_id", ignoreDuplicates: true });
        if (error) {
          await supabase.from("bank_connections").update({ error_message: `sync: ${error.message}` }).eq("id", conn.id);
        } else {
          inserted += enriched.length;
        }
```
(Sustituye el upsert silencioso anterior; ahora registra el error en `error_message`.)

- [ ] **Step 2: `bank-sync-all/index.ts`** — idéntico patrón (cliente service role, `conn.user_id` por conexión).

- [ ] **Step 3: `bank-callback/index.ts`** — en el bucle de la primera sync, aplicar el mismo `enrichRows` + upsert con manejo de error (registrar en `error_message` por `auth_state`). `dateFrom` es el de 90 días que ya calcula.

- [ ] **Step 4: Type-check** `npx --yes deno check supabase/functions/bank-callback/index.ts supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts` → pasan. `npm run build` ✓ (no afecta), `npm test` verde.

- [ ] **Step 5: Commit**:
```bash
git add supabase/functions/bank-callback/index.ts supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts
git commit -m "feat: sync pipeline — MCC+LLM categorize, dedup vs manuals, surface upsert errors"
```

---

### Task 7: Frontend — toggle excluir + revisar duplicados

**Files:** Modify `src/components/app/AddMovementSheet.tsx`, `src/routes/expenses.tsx`

- [ ] **Step 1: LEER** ambos ficheros. En `AddMovementSheet.tsx`, añadir un control **"No contabilizar"** (usar el componente Switch/Checkbox que ya use el proyecto; si hay `@/components/ui/switch` úsalo, si no un checkbox) enlazado a un estado `excluded` inicializado desde `movement?.excluded`. En el submit (tanto create como update) incluir `excluded` en el payload. Etiqueta y ayuda: "No contabilizar — el movimiento no suma en los totales (p.ej. traspaso entre cuentas propias)."

- [ ] **Step 2:** En `expenses.tsx`, añadir una sección **"Revisar duplicados"** visible solo si hay movimientos del mes con `duplicate_of` no nulo. Para cada uno, mostrar el importado (descripción, importe, fecha) y tres botones:
  - **Borrar importado**: `useDeleteMovement(importadoId)`.
  - **No es duplicado**: `useUpdateMovement({ id, month, duplicate_of: null, excluded: false })` → pasa a contar.
  - (El "borrar manual" se puede hacer desde la fila manual normal; no duplicar acción aquí — basta con borrar-importado / no-es-duplicado.)
  Las filas con `excluded` se muestran atenuadas (`opacity-60`) con un badge "No cuenta". Para soportar `duplicate_of: null` en `useUpdateMovement`, confirmar que el patch lo admite (añadir `duplicate_of?: string | null` a `CreateMovementInput` en movements-api si hiciera falta).

- [ ] **Step 3:** `npm run build 2>&1 | tail -3` → ✓. `npx eslint src/components/app/AddMovementSheet.tsx src/routes/expenses.tsx src/lib/movements-api.ts` limpio. `npm test` verde. Restart: `systemctl --user restart wealth-navigator.service && sleep 3 && systemctl --user is-active wealth-navigator.service`.

- [ ] **Step 4: Commit**:
```bash
git add src/components/app/AddMovementSheet.tsx src/routes/expenses.tsx src/lib/movements-api.ts
git commit -m "feat: 'no contabilizar' toggle and duplicate review UI"
```

---

### Task 8: 🔒 Deploy + secret + re-sync (controlador)

- [ ] **Step 1: Secret OpenAI** (la key está en `/tmp/wealth-agent/.env`; no exponerla):
```bash
OAI=$(grep -E "^OPENAI_API_KEY" /tmp/wealth-agent/.env | cut -d= -f2- | tr -d '"')
npx supabase secrets set OPENAI_API_KEY="$OAI" 2>&1 | grep -i finished
```

- [ ] **Step 2: Redeploy** las 3 funciones de sync:
```bash
for fn in bank-callback bank-sync bank-sync-all; do npx supabase functions deploy $fn 2>&1 | tail -1; done
```

- [ ] **Step 3: Re-sync BBVA** (last_synced_at ya en null → 90 días) vía bank-sync-all:
```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -4 -s -X POST "$URL/functions/v1/bank-sync-all" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" --max-time 90
```

- [ ] **Step 4: Verificar** (service role): distribución de categorías (esperar pocas "Sin categoría"), cuántos marcados `duplicate_of`/`excluded`, y que los meses son correctos. Pedir al usuario E2E: editar/excluir/revisar duplicados en la app.

---

## Self-review
- Cobertura spec: §1 BD→T1; §2 MCC→T2; §3 LLM→T4; §4 mapeo+pipeline→T5/T6; §5 totales→T1; §6 frontend→T7; §7 limpieza (hecha)+reimport→T8; §8 secrets→T8; §9 tests→T2/T3/T4/T5. ✓
- Consistencia: `MovementRow` (de bank-mapping) gana `excluded`/`duplicate_of` al asignarlos en `enrichRows` (objetos JS dinámicos; el upsert los manda). `categoryFromMcc`, `findDuplicate`, `classifyBatch/parseClassifyResponse` firmas estables entre tareas. EXPENSE/INCOME_CATEGORIES duplicadas en las edge functions (Deno no importa de src/) — documentado, mantener sincronizado con movements-api.ts.
- Desviaciones: el categorizador keyword se borra (T5); fallback LLM "Sin categoría" en error; dedup solo marca (no borra); excluded por defecto en duplicados para no descuadrar.
