# Refinamientos de importación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Tolerancia de importe en dedup, autoexclusión de retiradas de efectivo, y reglas de exclusión por concepto.

**Spec:** `docs/superpowers/specs/2026-06-13-import-refinements-design.md`

**⚠️ Task 6 (deploy + seed regla Indexa + re-import) la hace el controlador.**

---

### Task 1: Tolerancia de dedup + helpers de no-gasto (TDD)

**Files:** Modify `supabase/functions/_shared/dedup.ts`, `src/lib/dedup.test.ts`; Create `supabase/functions/_shared/non-expense.ts`, `src/lib/non-expense.ts`, `src/lib/non-expense.test.ts`

- [ ] **Step 1: Ampliar test** `src/lib/dedup.test.ts` — añadir casos de tolerancia (mantener los existentes):
```typescript
  it("28 vs 28.73 mismo día → match (tolerancia importe)", () =>
    expect(findDuplicate({ amount: 28.73, type: "expense", date: "2026-06-03" },
      [{ id: "x", amount: 28, type: "expense", date: "2026-06-03" }])).toBe("x"));
  it("23 vs 22.99 → match", () =>
    expect(findDuplicate({ amount: 22.99, type: "expense", date: "2026-06-02" },
      [{ id: "y", amount: 23, type: "expense", date: "2026-06-02" }])).toBe("y"));
  it("28 vs 35 → null (fuera de tolerancia)", () =>
    expect(findDuplicate({ amount: 35, type: "expense", date: "2026-06-03" },
      [{ id: "z", amount: 28, type: "expense", date: "2026-06-03" }])).toBeNull());
  it("importe grande dentro del 5% → match", () =>
    expect(findDuplicate({ amount: 210, type: "expense", date: "2026-06-03" },
      [{ id: "g", amount: 200, type: "expense", date: "2026-06-03" }])).toBe("g"));
```
**OJO:** revisar que el test existente "importe distinto → null" use 14 vs 15 (diff 1 < 1.5 → ahora SÍ haría match). Cambiarlo a un importe claramente fuera, p.ej. `amount: 30` vs manual `15` (diff 15 > max(1.5, 0.75)).

- [ ] **Step 2: Run** `npm test -- dedup` → FAIL en los nuevos.

- [ ] **Step 3: Implementar** — en `supabase/functions/_shared/dedup.ts`, cambiar `findDuplicate`:
```typescript
export function findDuplicate(
  q: DedupQuery, manuals: DedupRow[],
  opts: { amountAbs?: number; amountPct?: number; toleranceDays?: number } = {},
): string | null {
  const { amountAbs = 1.5, amountPct = 0.05, toleranceDays = 3 } = opts;
  const qt = new Date(q.date).getTime();
  for (const m of manuals) {
    if (m.type !== q.type) continue;
    const a = Number(m.amount), b = Number(q.amount);
    const tol = Math.max(amountAbs, amountPct * Math.max(a, b));
    if (Math.abs(a - b) > tol) continue;
    const diffDays = Math.abs(new Date(m.date).getTime() - qt) / 86400000;
    if (diffDays <= toleranceDays) return m.id;
  }
  return null;
}
```

- [ ] **Step 4: Test no-gasto failing** — `src/lib/non-expense.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isCashWithdrawal, matchesExclusionRule } from "./non-expense";

describe("isCashWithdrawal", () => {
  it("MCC 6011 → true", () => expect(isCashWithdrawal("6011", "lo que sea")).toBe(true));
  it("MCC 6010 → true", () => expect(isCashWithdrawal("6010", "x")).toBe(true));
  it("concepto RET. EFECTIVO → true", () =>
    expect(isCashWithdrawal(null, "RET. EFECTIVO A DEBITO CON TARJ. EN CAJERO")).toBe(true));
  it("REINTEGRO → true", () => expect(isCashWithdrawal(null, "REINTEGRO CAJERO")).toBe(true));
  it("compra normal → false", () =>
    expect(isCashWithdrawal("5411", "PAGO CON TARJETA MERCADONA")).toBe(false));
});

describe("matchesExclusionRule", () => {
  const rules = [{ match_text: "INDEXA" }];
  it("adeudo Indexa → true", () => expect(matchesExclusionRule("ADEUDO INDEXA CAPITAL SGIIC", rules)).toBe(true));
  it("case-insensitive", () => expect(matchesExclusionRule("pago indexa", rules)).toBe(true));
  it("sin coincidencia → false", () => expect(matchesExclusionRule("PAGO BBVA", rules)).toBe(false));
  it("sin reglas → false", () => expect(matchesExclusionRule("ADEUDO INDEXA", [])).toBe(false));
});
```

- [ ] **Step 5: Run** `npm test -- non-expense` → FAIL.

- [ ] **Step 6: Implementar** — `supabase/functions/_shared/non-expense.ts`:
```typescript
const CASH_RE = /RET\.?\s*EFECTIVO|REINTEGRO|DISPOSICION\s+(EFECTIVO|CAJERO)|RETIRADA\s+EFECTIVO/i;

export function isCashWithdrawal(mcc: string | null | undefined, description: string): boolean {
  if (mcc === "6011" || mcc === "6010") return true;
  return CASH_RE.test(description);
}

export type ExclusionRule = { match_text: string };

export function matchesExclusionRule(description: string, rules: ExclusionRule[]): boolean {
  const d = description.toUpperCase();
  return rules.some((r) => r.match_text && d.includes(r.match_text.toUpperCase()));
}
```
Y `src/lib/non-expense.ts`:
```typescript
export * from "../../supabase/functions/_shared/non-expense";
```

- [ ] **Step 7: Run** `npm test -- non-expense` y `npm test -- dedup` → pasan. Global verde. `npm run build` ✓.

- [ ] **Step 8: Lint+commit**:
```bash
npx eslint --fix src/lib/non-expense.ts src/lib/non-expense.test.ts src/lib/dedup.test.ts
git add supabase/functions/_shared/dedup.ts src/lib/dedup.test.ts supabase/functions/_shared/non-expense.ts src/lib/non-expense.ts src/lib/non-expense.test.ts
git commit -m "feat: dedup amount tolerance; cash-withdrawal and exclusion-rule helpers"
```

---

### Task 2: Tabla de reglas + hooks

**Files:** Create `supabase/migrations/20260613160000_exclusion_rules.sql`; Modify `src/lib/movements-api.ts`

- [ ] **Step 1: Migración** — contenido exacto:
```sql
create table if not exists public.movement_exclusion_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_text text not null,
  created_at timestamptz not null default now(),
  unique(user_id, match_text)
);
alter table public.movement_exclusion_rules enable row level security;
create policy "own rules" on public.movement_exclusion_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Aplicar** `npx supabase db push 2>&1 | tail -6`. Verificar (anon):
```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"'); KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -4 -s "$URL/rest/v1/movement_exclusion_rules?limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]`.

- [ ] **Step 3: Hooks** — añadir al final de `src/lib/movements-api.ts`:
```typescript
export type ExclusionRule = { id: string; user_id: string; match_text: string; created_at: string };

export function useExclusionRules() {
  const { user } = useAuth();
  return useQuery<ExclusionRule[]>({
    queryKey: ["exclusion_rules", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movement_exclusion_rules").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateExclusionRule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (match_text: string) => {
      if (!user) throw new Error("No autenticado");
      const { error } = await supabase
        .from("movement_exclusion_rules")
        .upsert({ user_id: user.id, match_text: match_text.trim() }, { onConflict: "user_id,match_text" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusion_rules"] }),
  });
}

export function useDeleteExclusionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("movement_exclusion_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusion_rules"] }),
  });
}
```

- [ ] **Step 4:** `npm run build` ✓, `npx eslint src/lib/movements-api.ts` limpio, `npm test` verde. Commit:
```bash
git add supabase/migrations/20260613160000_exclusion_rules.sql src/lib/movements-api.ts
git commit -m "feat: movement_exclusion_rules table and hooks"
```

---

### Task 3: Pipeline — aplicar exclusiones en las 3 funciones

**Files:** Modify `supabase/functions/bank-callback/index.ts`, `bank-sync/index.ts`, `bank-sync-all/index.ts`

El `enrichRows` actual recibe `(supabase, rows, userId, dateFrom)`. Cambiarlo a `(supabase, rows, txs, userId, dateFrom)` donde `txs[i]` es la transacción original alineada con `rows[i]` (para leer `merchant_category_code`). Nueva versión del helper (reemplazar en las TRES funciones, manteniendo las constantes EXPENSE/INCOME_CATEGORIES):

```typescript
import { findDuplicate, type DedupRow } from "../_shared/dedup.ts";
import { isCashWithdrawal, matchesExclusionRule } from "../_shared/non-expense.ts";
import { classifyBatch } from "../_shared/llm-classify.ts";

async function enrichRows(supabase: any, rows: any[], txs: any[], userId: string, dateFrom: string) {
  // reglas de exclusión del usuario
  const { data: rulesRaw } = await supabase
    .from("movement_exclusion_rules").select("match_text").eq("user_id", userId);
  const rules = (rulesRaw ?? []) as { match_text: string }[];
  // manuales para dedup
  const { data: manualsRaw } = await supabase
    .from("movements").select("id, amount, type, date")
    .is("external_id", null).eq("user_id", userId).gte("date", dateFrom);
  const manuals: DedupRow[] = (manualsRaw ?? []).map((m: any) => ({
    id: m.id, amount: Number(m.amount), type: m.type, date: m.date,
  }));
  rows.forEach((r, i) => {
    const dup = findDuplicate({ amount: r.amount, type: r.type, date: r.date }, manuals);
    r.duplicate_of = dup;
    const mcc = txs[i]?.merchant_category_code ?? null;
    r.excluded = dup !== null || isCashWithdrawal(mcc, r.description) || matchesExclusionRule(r.description, rules);
  });
  // LLM solo para las NO excluidas sin categoría, por tipo
  for (const type of ["expense", "income"] as const) {
    const pending = rows.filter((r) => !r.excluded && r.type === type && r.category === "Sin categoría");
    if (pending.length === 0) continue;
    const cats = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const items = pending.map((r, i) => ({ id: String(i), description: r.description }));
    const result = await classifyBatch(items, cats);
    pending.forEach((r, i) => { r.category = result[String(i)] ?? "Sin categoría"; });
  }
  return rows;
}
```

- [ ] **Step 1:** En cada una de las 3 funciones, donde se construyen `rows` y se llama `enrichRows(supabase, rows, conn.user_id, dateFrom)` (o `user.id`), pasar también `txs`: `enrichRows(supabase, rows, txs, <userId>, dateFrom)`. Verificar que `txs` es el array filtrado (isBooked + con id) del que se mapean `rows` — deben estar alineados (mismo orden, misma longitud). Si en alguna función el filtrado produce `rows` de un `txs` ya filtrado, usar esa misma variable filtrada como `txs`.

- [ ] **Step 2:** Reemplazar el cuerpo de `enrichRows` por el de arriba en las 3 funciones (añadir el import de `non-expense.ts`).

- [ ] **Step 3:** Type-check `npx --yes deno check supabase/functions/bank-callback/index.ts supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts` → pasan. `npm test` verde, `npm run build` ✓.

- [ ] **Step 4: Commit**:
```bash
git add supabase/functions/bank-callback/index.ts supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts
git commit -m "feat: apply cash-withdrawal and exclusion-rule auto-exclusion in sync pipeline"
```

---

### Task 4: UI — crear reglas + gestionarlas

**Files:** Modify `src/components/app/AddMovementSheet.tsx`, `src/routes/settings.tsx`

- [ ] **Step 1: LEER** ambos. En `AddMovementSheet.tsx`, cuando el toggle `excluded` está activo, mostrar un bloque opcional: un `Input` "Excluir siempre los que contengan" (valor por defecto: un token del concepto actual — usar la primera palabra significativa de la descripción, o dejar vacío) + un checkbox/switch "Crear regla". Importar `useCreateExclusionRule`. En el submit, si el checkbox está marcado y el input no está vacío, llamar `createRule.mutate(inputValue)` además de guardar el movimiento. Solo visible cuando `excluded` está activo.

- [ ] **Step 2:** En `settings.tsx`, añadir una sección "Reglas de exclusión" que liste `useExclusionRules()` (cada una con su `match_text` y un botón borrar → `useDeleteExclusionRule()`), y un input para añadir una nueva (`useCreateExclusionRule`). Seguir los patrones de la página. Sin emojis.

- [ ] **Step 3:** `npm run build` ✓, `npx eslint` limpio en los 2 ficheros, `npm test` verde. Restart: `systemctl --user restart wealth-navigator.service && sleep 3 && systemctl --user is-active wealth-navigator.service`.

- [ ] **Step 4: Commit**:
```bash
git add src/components/app/AddMovementSheet.tsx src/routes/settings.tsx
git commit -m "feat: create exclusion rule from edit sheet; manage rules in settings"
```

---

### Task 5: Verificación de tipos/tests global

- [ ] **Step 1:** `npm test` (todos verdes), `npm run build` ✓, `npx --yes deno check` en las 3 funciones de sync.
- [ ] **Step 2: Commit** si quedó algo.

---

### Task 6: 🔒 Deploy + seed regla Indexa + re-import (controlador)

- [ ] **Step 1:** Redeploy: `for fn in bank-callback bank-sync bank-sync-all; do npx supabase functions deploy $fn 2>&1 | tail -1; done`
- [ ] **Step 2: Sembrar regla Indexa** (service role; user_id del usuario):
```bash
URL=...; SRK=...  # via npx supabase projects api-keys
curl -X POST "$URL/rest/v1/movement_exclusion_rules" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" -d '{"user_id":"5acfa18c-c6ba-499a-88fe-53d49998673a","match_text":"INDEXA"}'
```
- [ ] **Step 3:** Borrar los 96 importados (external_id not null) + reset `last_synced_at` de BBVA + re-sync vía bank-sync-all.
- [ ] **Step 4: Verificar**: Bus 28/28.73 y Gym 23/22.99 marcados como duplicado (excluded+duplicate_of); la retirada de 50€ `excluded`; adeudos Indexa `excluded`. Distribución de categorías y conteo de excluidos.

---

## Self-review
- Cobertura spec: §1→T1; §2→T1; §3→T2; §4→T3; §5→T4; §6→T6; §7→T1/T6. ✓
- Consistencia: `findDuplicate(q, manuals, opts?)` retrocompatible (opts opcional). `enrichRows` gana parámetro `txs` en las 3 funciones — alinear con el array filtrado. `isCashWithdrawal`/`matchesExclusionRule` puros y testeados. Hooks de reglas siguen el patrón de movements-api.
- Desviación: el test existente de dedup "importe distinto" hay que ajustarlo (14 vs 15 ahora casa). Documentado en T1 Step 1.
