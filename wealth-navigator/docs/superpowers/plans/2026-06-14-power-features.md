# Cosas chulas (recurrentes, reglas de categoría, FIRE, insights) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar 4 mejoras independientes: detección de gastos recurrentes (que alimentan el presupuesto), reglas de categoría persistentes en el import, panel FIRE, y dos insights extra en el Resumen.

**Architecture:** Lógica pura en `src/lib/*.ts` (Vitest); regla de categoría como shared `_shared/category-rules.ts` re-exportado (patrón `strategy-engine.ts`). Dos tablas nuevas (`movement_category_rules`, `fire_settings`). Hooks TanStack, componentes nuevos, y aplicación de reglas en las 3 Edge Functions de sync.

**Tech Stack:** Vite + React + TanStack Router/Query + Supabase (Deno Edge Functions) + Vitest.

---

## Convenciones (leer antes de empezar)
- Pure tests `*.test.ts` junto al módulo. `import { describe, it, expect } from "vitest";`. Correr `npm run test -- <name>`.
- `BudgetMap` en `src/lib/budget-calc.ts`; `groupForCategory`/`BUDGET_GROUPS` en `budget-groups.ts`; `EXPENSE_CATEGORIES`/`INCOME_CATEGORIES` y los hooks de reglas de exclusión en `movements-api.ts`; tipo `Insight` en `assistant-mock.ts`; `euro`/`formatMonth` en `dashboard-data.ts`; `useDashboard` en `@/hooks/use-dashboard`; `useAuth` en `@/hooks/use-auth`.
- Supabase: tablas no tipadas / columna `excluded` → cast `(supabase as any)`. Numéricos → `Number()`.
- Re-export shared: `src/lib/strategy-engine.ts` hace `export * from "../../supabase/functions/_shared/strategy-engine";` — calcar para `category-rules`.
- Sin emojis. Checks: `npm run lint` (no añadir errores nuevos; ~628 preexistentes en `supabase/functions/**` y `scripts/` se ignoran) y `npm run build`.

---

## Task 1: Reglas de categoría (puro + shared)

**Files:** Create `supabase/functions/_shared/category-rules.ts`, `src/lib/category-rules.ts`, `src/lib/category-rules.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/category-rules.test.ts
import { describe, it, expect } from "vitest";
import { categoryFromRules } from "./category-rules";

describe("categoryFromRules", () => {
  const rules = [
    { match_text: "NETFLIX", category: "Suscripciones" },
    { match_text: "mercadona", category: "Comida" },
  ];
  it("casa por substring case-insensitive", () => {
    expect(categoryFromRules("PAGO NETFLIX.COM 123", rules)).toBe("Suscripciones");
    expect(categoryFromRules("COMPRA MERCADONA MADRID", rules)).toBe("Comida");
  });
  it("sin coincidencia => null", () => {
    expect(categoryFromRules("BIZUM A JUAN", rules)).toBeNull();
  });
  it("la primera regla que casa gana", () => {
    const r = [
      { match_text: "AMAZON", category: "Compras" },
      { match_text: "AMAZON PRIME", category: "Suscripciones" },
    ];
    expect(categoryFromRules("AMAZON PRIME VIDEO", r)).toBe("Compras");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- category-rules`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// supabase/functions/_shared/category-rules.ts
export type CategoryRule = { match_text: string; category: string };

export function categoryFromRules(description: string, rules: CategoryRule[]): string | null {
  const desc = (description ?? "").toUpperCase();
  for (const r of rules) {
    const m = (r.match_text ?? "").toUpperCase().trim();
    if (m && desc.includes(m)) return r.category;
  }
  return null;
}
```

```typescript
// src/lib/category-rules.ts
export * from "../../supabase/functions/_shared/category-rules.ts";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- category-rules`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/category-rules.ts src/lib/category-rules.ts src/lib/category-rules.test.ts
git commit -m "feat: category rules helper (concept -> category)"
```

---

## Task 2: Detección de recurrentes (puro)

**Files:** Create `src/lib/recurring.ts`, `src/lib/recurring.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/recurring.test.ts
import { describe, it, expect } from "vitest";
import { normalizeConcept, detectRecurring, recurringFloorByGroup } from "./recurring";

function mov(month: string, description: string, amount: number, category = "Suscripciones") {
  return { date: `${month}-10`, description, amount, category };
}

describe("normalizeConcept", () => {
  it("quita dígitos y puntuación, mayúsculas", () => {
    expect(normalizeConcept("Netflix.com 12345")).toBe("NETFLIX COM");
    expect(normalizeConcept("PAGO  Spotify-ES")).toBe("PAGO SPOTIFY ES");
  });
});

describe("detectRecurring", () => {
  it("detecta un fijo presente >= 3 meses y marca subida de precio", () => {
    const movs = [
      mov("2026-01", "NETFLIX", 13),
      mov("2026-02", "NETFLIX", 13),
      mov("2026-03", "NETFLIX", 13),
      mov("2026-04", "NETFLIX", 13),
      mov("2026-05", "NETFLIX", 13),
      mov("2026-06", "NETFLIX", 16),
    ];
    const out = detectRecurring(movs);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Suscripciones");
    expect(out[0].group).toBe("hogar");
    expect(out[0].monthlyAmount).toBe(13);
    expect(out[0].lastAmount).toBe(16);
    expect(out[0].priceIncreased).toBe(true);
  });
  it("ignora gasto variable aunque sea mensual", () => {
    const movs = [
      mov("2026-01", "MERCADONA", 40, "Comida"),
      mov("2026-02", "MERCADONA", 90, "Comida"),
      mov("2026-03", "MERCADONA", 55, "Comida"),
      mov("2026-04", "MERCADONA", 30, "Comida"),
    ];
    expect(detectRecurring(movs)).toHaveLength(0);
  });
  it("ignora lo que aparece menos de 3 meses", () => {
    const movs = [mov("2026-05", "GIMNASIO", 25, "Gimnasio"), mov("2026-06", "GIMNASIO", 25, "Gimnasio")];
    expect(detectRecurring(movs)).toHaveLength(0);
  });
});

describe("recurringFloorByGroup", () => {
  it("suma el importe mensual por grupo", () => {
    const rec = [
      { concept: "NETFLIX", displayConcept: "NETFLIX", category: "Suscripciones", group: "hogar", monthlyAmount: 13, lastAmount: 13, priceIncreased: false, monthsSeen: 4 },
      { concept: "GIMNASIO", displayConcept: "GIMNASIO", category: "Gimnasio", group: "salud", monthlyAmount: 25, lastAmount: 25, priceIncreased: false, monthsSeen: 4 },
    ];
    expect(recurringFloorByGroup(rec)).toEqual({ hogar: 13, salud: 25 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- recurring`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/recurring.ts
import { groupForCategory } from "./budget-groups";
import { median } from "./budget-history";
import type { BudgetMap } from "./budget-calc";

export type RecurringExpense = {
  concept: string;
  displayConcept: string;
  category: string;
  group: string;
  monthlyAmount: number;
  lastAmount: number;
  priceIncreased: boolean;
  monthsSeen: number;
};

export function normalizeConcept(description: string): string {
  return (description ?? "")
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "Otro";
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) {
    best = v;
    bestN = n;
  }
  return best;
}

export function detectRecurring(
  movs: { date: string; description: string; amount: number; category: string }[],
  opts?: { minMonths?: number; amountAbs?: number; amountPct?: number },
): RecurringExpense[] {
  const minMonths = opts?.minMonths ?? 3;
  const amountAbs = opts?.amountAbs ?? 2;
  const amountPct = opts?.amountPct ?? 0.05;

  const byConcept = new Map<string, typeof movs>();
  for (const m of movs) {
    const key = normalizeConcept(m.description);
    if (!key) continue;
    if (!byConcept.has(key)) byConcept.set(key, []);
    byConcept.get(key)!.push(m);
  }

  const out: RecurringExpense[] = [];
  for (const [concept, items] of byConcept) {
    // total por mes
    const byMonth = new Map<string, number>();
    for (const it of items) {
      const month = it.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + (Number(it.amount) || 0));
    }
    const monthsSorted = [...byMonth.keys()].sort();
    const monthsSeen = monthsSorted.length;
    if (monthsSeen < minMonths) continue;

    const amounts = monthsSorted.map((mo) => byMonth.get(mo)!);
    const lastAmount = amounts[amounts.length - 1];
    const prior = amounts.slice(0, -1);
    const medPrior = median(prior.length ? prior : amounts);
    const tol = Math.max(amountAbs, amountPct * medPrior);
    const consistent = prior.every((a) => Math.abs(a - medPrior) <= tol);
    if (!consistent) continue;

    const category = mostFrequent(items.map((it) => it.category));
    out.push({
      concept,
      displayConcept: items[items.length - 1].description,
      category,
      group: groupForCategory(category),
      monthlyAmount: median(amounts),
      lastAmount,
      priceIncreased: lastAmount - medPrior > tol,
      monthsSeen,
    });
  }
  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

export function recurringFloorByGroup(recurring: RecurringExpense[]): BudgetMap {
  const out: BudgetMap = {};
  for (const r of recurring) out[r.group] = (out[r.group] ?? 0) + r.monthlyAmount;
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- recurring`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recurring.ts src/lib/recurring.test.ts
git commit -m "feat: recurring expense detection with price-increase flag"
```

---

## Task 3: Cálculo FIRE (puro)

**Files:** Create `src/lib/fire.ts`, `src/lib/fire.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/fire.test.ts
import { describe, it, expect } from "vitest";
import { fireNumber, fireProgress, monthsToFire, estimatedFireDate } from "./fire";

describe("fire", () => {
  it("fireNumber = gasto / (swr/100)", () => {
    expect(fireNumber(24000, 4)).toBe(600000);
    expect(fireNumber(24000, 0)).toBe(0);
  });
  it("fireProgress clampa 0..1", () => {
    expect(fireProgress(108000, 600000)).toBeCloseTo(0.18, 5);
    expect(fireProgress(900000, 600000)).toBe(1);
    expect(fireProgress(100, 0)).toBe(0);
  });
  it("monthsToFire: ya alcanzado => 0", () => {
    expect(monthsToFire(600000, 600000, 0, 0)).toBe(0);
  });
  it("monthsToFire: con ahorro sin retorno", () => {
    expect(monthsToFire(0, 1200, 100, 0)).toBe(12);
  });
  it("monthsToFire: inalcanzable => null", () => {
    expect(monthsToFire(0, 100000, 0, 0)).toBeNull();
  });
  it("estimatedFireDate suma meses", () => {
    expect(estimatedFireDate(new Date(2026, 5, 15), 12)).toBe("2027-06");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- fire`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/fire.ts
export function fireNumber(annualExpense: number, swrRate: number): number {
  return swrRate > 0 ? annualExpense / (swrRate / 100) : 0;
}

export function fireProgress(netWorth: number, fire: number): number {
  if (fire <= 0) return 0;
  return Math.max(0, Math.min(netWorth / fire, 1));
}

export function monthsToFire(
  netWorth: number,
  fire: number,
  monthlySavings: number,
  expectedReturnPct: number,
): number | null {
  if (fire <= 0) return null;
  if (netWorth >= fire) return 0;
  let nw = netWorth;
  const r = expectedReturnPct / 100 / 12;
  for (let m = 1; m <= 1200; m++) {
    nw = nw * (1 + r) + monthlySavings;
    if (nw >= fire) return m;
  }
  return null;
}

export function estimatedFireDate(now: Date, months: number): string {
  const d = new Date(now.getFullYear(), now.getMonth() + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- fire`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fire.ts src/lib/fire.test.ts
git commit -m "feat: FIRE calculations (number, progress, months/date to FIRE)"
```

---

## Task 4: Insights extra (puro)

**Files:** Create `src/lib/extra-insights.ts`, `src/lib/extra-insights.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/extra-insights.test.ts
import { describe, it, expect } from "vitest";
import { budgetInsight, recurringInsight } from "./extra-insights";
import type { RecurringExpense } from "./recurring";

describe("budgetInsight", () => {
  it("avisa si un grupo proyecta pasarse", () => {
    // mitad de mes (día 15 de 30), Ocio presupuesto 200, gastado 150 => proyección 300
    const now = new Date(2026, 5, 15);
    const ins = budgetInsight({ ocio: 200 }, { ocio: 150 }, now);
    expect(ins).not.toBeNull();
    expect(ins!.tone).toBe("warning");
    expect(ins!.title.toLowerCase()).toContain("ocio");
  });
  it("null si todo dentro de presupuesto", () => {
    const now = new Date(2026, 5, 15);
    expect(budgetInsight({ ocio: 200 }, { ocio: 50 }, now)).toBeNull();
  });
});

describe("recurringInsight", () => {
  const rec: RecurringExpense[] = [
    { concept: "NETFLIX", displayConcept: "NETFLIX", category: "Suscripciones", group: "hogar", monthlyAmount: 13, lastAmount: 16, priceIncreased: true, monthsSeen: 6 },
    { concept: "GIMNASIO", displayConcept: "GIMNASIO", category: "Gimnasio", group: "salud", monthlyAmount: 25, lastAmount: 25, priceIncreased: false, monthsSeen: 6 },
  ];
  it("resume número y total mensual", () => {
    const ins = recurringInsight(rec);
    expect(ins).not.toBeNull();
    expect(ins!.title).toContain("2");
  });
  it("null si no hay recurrentes", () => {
    expect(recurringInsight([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- extra-insights`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/extra-insights.ts
import type { Insight } from "./assistant-mock";
import type { BudgetMap } from "./budget-calc";
import { BUDGET_GROUPS } from "./budget-groups";
import { projectMonthEnd } from "./budget-projection";
import { euro1 } from "./dashboard-data";
import type { RecurringExpense } from "./recurring";

/** Aviso si algún grupo proyecta pasarse del presupuesto este mes. Elige el de mayor exceso. */
export function budgetInsight(budgets: BudgetMap, actuals: BudgetMap, now: Date): Insight | null {
  let worst: { label: string; over: number } | null = null;
  for (const g of BUDGET_GROUPS) {
    const b = budgets[g.key] ?? 0;
    if (b <= 0) continue;
    const projected = projectMonthEnd(actuals[g.key] ?? 0, now, true);
    const over = projected - b;
    if (over > 0 && (!worst || over > worst.over)) worst = { label: g.label, over };
  }
  if (!worst) return null;
  return {
    id: "i-budget",
    tone: "warning",
    title: `A este ritmo te pasas ${euro1.format(worst.over)} en ${worst.label}`,
    body: `La proyección a fin de mes de ${worst.label} supera tu presupuesto.`,
    prompt: `¿Cómo puedo recortar el gasto de ${worst.label} este mes?`,
  };
}

/** Resumen de gastos fijos detectados. */
export function recurringInsight(recurring: RecurringExpense[]): Insight | null {
  if (recurring.length === 0) return null;
  const total = recurring.reduce((s, r) => s + r.monthlyAmount, 0);
  const hiked = recurring.filter((r) => r.priceIncreased);
  const extra = hiked.length ? ` ${hiked.length} subieron de precio.` : "";
  return {
    id: "i-recurring",
    tone: hiked.length ? "warning" : "neutral",
    title: `${recurring.length} gastos fijos por ${euro1.format(total)}/mes`,
    body: `Suscripciones y recibos recurrentes detectados.${extra}`,
    prompt: "Revisa mis gastos fijos y dime cuáles podría cancelar.",
  };
}
```

> Nota: confirma que `euro1` se exporta desde `@/lib/dashboard-data` (lo usa `assistant-mock.ts`). Si no, usa `euro`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- extra-insights`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/extra-insights.ts src/lib/extra-insights.test.ts
git commit -m "feat: budget and recurring extra insights"
```

---

## Task 5: Migraciones (category rules + fire settings)

**Files:** Create `supabase/migrations/20260614180000_category_rules.sql`, `supabase/migrations/20260614190000_fire_settings.sql`

> Despliegue (`npx supabase db push`) lo hace el controlador.

- [ ] **Step 1: Create both migrations**

```sql
-- supabase/migrations/20260614180000_category_rules.sql
create table public.movement_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_text text not null,
  category text not null,
  created_at timestamptz not null default now(),
  unique(user_id, match_text)
);
alter table public.movement_category_rules enable row level security;
create policy "own category rules" on public.movement_category_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

```sql
-- supabase/migrations/20260614190000_fire_settings.sql
create table public.fire_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  annual_expense numeric not null default 0,
  swr_rate numeric not null default 4,
  expected_return numeric not null default 5,
  updated_at timestamptz not null default now()
);
alter table public.fire_settings enable row level security;
create policy "own fire settings" on public.fire_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Verify**

Run: `grep -l "movement_category_rules" supabase/migrations/20260614180000_category_rules.sql && grep -l "fire_settings" supabase/migrations/20260614190000_fire_settings.sql`
Expected: ambos ficheros listados.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614180000_category_rules.sql supabase/migrations/20260614190000_fire_settings.sql
git commit -m "feat: category rules and fire settings tables"
```

---

## Task 6: Hooks — category rules, recent movements, fire settings

**Files:** Modify `src/lib/movements-api.ts`; Create `src/lib/fire-api.ts`

- [ ] **Step 1: Add category-rule hooks + recent movements to `movements-api.ts`**

Añade tras los hooks de reglas de exclusión:

```typescript
export type CategoryRuleRecord = {
  id: string;
  user_id: string;
  match_text: string;
  category: string;
  created_at: string;
};

export function useCategoryRules() {
  const { user } = useAuth();
  return useQuery<CategoryRuleRecord[]>({
    queryKey: ["category_rules", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("movement_category_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateCategoryRule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { match_text: string; category: string }) => {
      if (!user) throw new Error("No autenticado");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("movement_category_rules")
        .upsert(
          { user_id: user.id, match_text: input.match_text.trim(), category: input.category },
          { onConflict: "user_id,match_text" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category_rules"] }),
  });
}

export function useDeleteCategoryRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("movement_category_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category_rules"] }),
  });
}

/** Movimientos (expense, no excluido) con descripción de los últimos `months` meses. */
export function useRecentMovements(months: number) {
  const { user } = useAuth();
  return useQuery<{ date: string; description: string; amount: number; category: string }[]>({
    queryKey: ["recent_movements", months, user?.id],
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("movements")
        .select("date, description, amount, category")
        .eq("type", "expense")
        .eq("excluded", false)
        .gte("date", fmt(start));
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        date: r.date as string,
        description: (r.description as string) ?? "",
        amount: Number(r.amount) || 0,
        category: (r.category as string) ?? "Otro",
      }));
    },
    enabled: !!user,
  });
}
```

(Confirma que `useQuery`, `useMutation`, `useQueryClient`, `supabase`, `useAuth` ya están importados en el fichero — lo están.)

- [ ] **Step 2: Create `src/lib/fire-api.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type FireSettings = {
  annual_expense: number;
  swr_rate: number;
  expected_return: number;
};

const DEFAULTS: FireSettings = { annual_expense: 0, swr_rate: 4, expected_return: 5 };

export function useFireSettings() {
  const { user } = useAuth();
  return useQuery<FireSettings>({
    queryKey: ["fire_settings", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("fire_settings")
        .select("annual_expense, swr_rate, expected_return")
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULTS;
      return {
        annual_expense: Number(data.annual_expense) || 0,
        swr_rate: Number(data.swr_rate) || 4,
        expected_return: Number(data.expected_return) || 5,
      };
    },
    enabled: !!user,
  });
}

export function useUpsertFireSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FireSettings) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("fire_settings")
        .upsert({ ...input, user_id: user!.id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fire_settings"] }),
  });
}
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/movements-api.ts src/lib/fire-api.ts
git commit -m "feat: hooks for category rules, recent movements and fire settings"
```

---

## Task 7: Aplicar reglas de categoría en las Edge Functions

**Files:** Modify `supabase/functions/bank-sync/index.ts`, `supabase/functions/bank-sync-all/index.ts`, `supabase/functions/bank-callback/index.ts`

> Las 3 comparten un `enrichRows` casi idéntico. Aplica el MISMO cambio en las tres. Redeploy lo hace el controlador.

- [ ] **Step 1: En cada `index.ts`, importar el helper**

Añade junto a los otros imports de `../_shared/...`:
```typescript
import { categoryFromRules } from "../_shared/category-rules.ts";
```

- [ ] **Step 2: En cada `enrichRows`, cargar reglas y aplicarlas antes del LLM**

Tras cargar las reglas de exclusión (`movement_exclusion_rules`), añade la carga de reglas de categoría:
```typescript
  const { data: catRulesRaw } = await supabase
    .from("movement_category_rules").select("match_text, category").eq("user_id", userId);
  const catRules = (catRulesRaw ?? []) as { match_text: string; category: string }[];
```
Y dentro del `rows.forEach((r, i) => { ... })`, tras calcular `r.excluded`, añade (la regla manda sobre el MCC):
```typescript
    const ruleCat = categoryFromRules(r.description, catRules);
    if (ruleCat) r.category = ruleCat;
```
El bucle del LLM ya filtra `r.category === "Sin categoría"`, así que las filas con categoría puesta por regla no van al LLM. (No cambies nada más.)

- [ ] **Step 3: Sanity check (no Vitest para Edge Functions)**

Run: `grep -c "categoryFromRules" supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts supabase/functions/bank-callback/index.ts`
Expected: cada fichero ≥ 2 (import + uso).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bank-sync/index.ts supabase/functions/bank-sync-all/index.ts supabase/functions/bank-callback/index.ts
git commit -m "feat: apply category rules (override MCC) in sync pipeline"
```

---

## Task 8: Settings — CategoryRulesSection

**Files:** Modify `src/routes/settings.tsx`

- [ ] **Step 1: Add the section component and mount it**

Importa al principio (junto a los otros imports de `movements-api` y categorías):
```typescript
import { useCategoryRules, useCreateCategoryRule, useDeleteCategoryRule, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/movements-api";
```
(añade los que falten; si `EXPENSE_CATEGORIES`/`INCOME_CATEGORIES` ya se importan en otro sitio, no dupliques.)

Añade el componente (cerca de `ExclusionRulesSection`):
```tsx
function CategoryRulesSection() {
  const { data: rules = [], isLoading } = useCategoryRules();
  const createRule = useCreateCategoryRule();
  const deleteRule = useDeleteCategoryRule();
  const [matchText, setMatchText] = useState("");
  const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const [category, setCategory] = useState(allCats[0]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const value = matchText.trim();
    if (!value) return;
    createRule.mutate({ match_text: value, category }, { onSuccess: () => setMatchText("") });
  }

  return (
    <SectionCard
      title="Reglas de categoría"
      description="Al importar, los movimientos cuyo concepto contenga este texto se asignan a la categoría elegida (tiene prioridad sobre la detección automática)."
    >
      <div className="space-y-3">
        {isLoading && <p className="text-[13px] text-muted-foreground">Cargando…</p>}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
          >
            <span className="text-[13px]">
              <span className="font-medium">{rule.match_text}</span>
              <span className="text-muted-foreground"> → {rule.category}</span>
            </span>
            <button
              type="button"
              title="Borrar regla"
              onClick={() => deleteRule.mutate(rule.id)}
              disabled={deleteRule.isPending}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {rules.length === 0 && !isLoading && (
          <p className="text-[13px] text-muted-foreground">
            Sin reglas todavía. Ej: concepto "NETFLIX" → categoría "Suscripciones".
          </p>
        )}
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Concepto, p.ej. NETFLIX"
            value={matchText}
            onChange={(e) => setMatchText(e.target.value)}
            className="min-w-[160px] flex-1 text-[13px]"
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allCats.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={createRule.isPending || !matchText.trim()}>
            <Plus className="h-4 w-4" /> Añadir
          </Button>
        </form>
      </div>
    </SectionCard>
  );
}
```
(Confirma que `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`, `Input`, `Button`, `Trash2`, `Plus`, `SectionCard`, `useState` ya están importados en settings.tsx; añade lo que falte — `Select*` viene de `@/components/ui/select`.)

Monta `<CategoryRulesSection />` justo después de `<ExclusionRulesSection />` en el JSX (~línea 510).

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; Settings muestra "Reglas de categoría".

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "feat: category rules management section in settings"
```

---

## Task 9: RecurringExpensesCard + autorrelleno con suelo de fijos

**Files:** Create `src/components/app/RecurringExpensesCard.tsx`; Modify `src/routes/expenses.tsx`; Modify `src/components/planning/ExpensePlanning.tsx`

- [ ] **Step 1: Create the card**

```tsx
// src/components/app/RecurringExpensesCard.tsx
import { TrendingUp } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { useRecentMovements } from "@/lib/movements-api";
import { detectRecurring } from "@/lib/recurring";
import { euro } from "@/lib/dashboard-data";

export function RecurringExpensesCard() {
  const { data: movs = [] } = useRecentMovements(6);
  const recurring = detectRecurring(movs);
  const total = recurring.reduce((s, r) => s + r.monthlyAmount, 0);

  return (
    <SectionCard
      title="Gastos fijos"
      description={
        recurring.length
          ? `Suscripciones y recibos recurrentes · ${euro.format(total)}/mes estimado.`
          : "Aún no se detectan gastos fijos recurrentes."
      }
    >
      {recurring.length > 0 && (
        <div className="space-y-2">
          {recurring.map((r) => (
            <div key={r.concept} className="flex items-center justify-between text-[12.5px]">
              <div className="min-w-0">
                <span className="font-medium">{r.displayConcept}</span>
                <span className="text-muted-foreground"> · {r.category}</span>
              </div>
              <div className="flex items-center gap-2">
                {r.priceIncreased && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <TrendingUp className="h-3 w-3" />
                    subió {euro.format(r.lastAmount - r.monthlyAmount)}
                  </span>
                )}
                <span className="font-medium">{euro.format(r.monthlyAmount)}/mes</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 2: Mount in `expenses.tsx`**

READ `src/routes/expenses.tsx`. Añade el import `import { RecurringExpensesCard } from "@/components/app/RecurringExpensesCard";` y monta `<RecurringExpensesCard />` como sección propia (p.ej. tras `<BudgetSummaryCard />`, dentro del contenedor existente con `px-4 md:px-8`).

- [ ] **Step 3: Autorrelleno con suelo de fijos en `ExpensePlanning.tsx`**

READ `src/components/planning/ExpensePlanning.tsx`. Añade imports:
```typescript
import { useRecentMovements } from "@/lib/budget-api"; // si ya importas de budget-api, mejor desde "@/lib/movements-api"
import { detectRecurring, recurringFloorByGroup } from "@/lib/recurring";
```
(`useRecentMovements` está en `movements-api.ts`; impórtalo de ahí: `import { useRecentMovements } from "@/lib/movements-api";`.)

Tras el hook de histórico, añade:
```typescript
  const { data: recentMovs = [] } = useRecentMovements(6);
  const recurringFloor = recurringFloorByGroup(detectRecurring(recentMovs));
```
Cambia `autofillFromHistory` para combinar mediana y suelo de fijos:
```typescript
  function autofillFromHistory() {
    const med = medianByGroup(history);
    const next: BudgetMap = {};
    for (const g of BUDGET_GROUPS) {
      next[g.key] = Math.max(med[g.key] ?? 0, recurringFloor[g.key] ?? 0);
    }
    applyBudgets(next);
  }
```
(Importa `BUDGET_GROUPS` de `@/lib/budget-groups` si no está ya.)

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; Gastos muestra "Gastos fijos"; el autorrelleno respeta el suelo de fijos.

- [ ] **Step 5: Commit**

```bash
git add src/components/app/RecurringExpensesCard.tsx src/routes/expenses.tsx src/components/planning/ExpensePlanning.tsx
git commit -m "feat: recurring expenses card and floor-aware budget autofill"
```

---

## Task 10: Panel FIRE — FireCard (Resumen) + FirePanel (Patrimonio)

**Files:** Create `src/components/app/FireCard.tsx`, `src/components/app/FirePanel.tsx`; Modify `src/routes/index.tsx`; Modify `src/routes/net-worth.tsx`

- [ ] **Step 1: Shared helper for monthly savings**

En ambos componentes se necesita el ahorro mensual real. Calcúlalo inline desde `useDashboard()`:
```typescript
  const dashboard = useDashboard();
  const recent = dashboard.expenses.byMonth.slice(-12);
  const monthlySavings =
    recent.length > 0
      ? recent.reduce((s, m) => s + (m.incomeTotal - m.expenseTotal), 0) / recent.length
      : 0;
  const netWorth = dashboard.series[dashboard.series.length - 1]?.netWorth ?? 0;
```
(Confirma en `dashboard-data.ts` que `series` tiene `netWorth` y `expenses.byMonth` tiene `incomeTotal`/`expenseTotal` — sí.)

- [ ] **Step 2: Create `FireCard.tsx` (compacta, Resumen)**

```tsx
// src/components/app/FireCard.tsx
import { Link } from "@tanstack/react-router";
import { SectionCard } from "@/components/app/SectionCard";
import { useFireSettings } from "@/lib/fire-api";
import { useDashboard } from "@/hooks/use-dashboard";
import { fireNumber, fireProgress, monthsToFire, estimatedFireDate } from "@/lib/fire";
import { euro, formatMonth } from "@/lib/dashboard-data";

export function FireCard() {
  const { data: fire } = useFireSettings();
  const dashboard = useDashboard();
  const recent = dashboard.expenses.byMonth.slice(-12);
  const monthlySavings =
    recent.length > 0
      ? recent.reduce((s, m) => s + (m.incomeTotal - m.expenseTotal), 0) / recent.length
      : 0;
  const netWorth = dashboard.series[dashboard.series.length - 1]?.netWorth ?? 0;

  if (!fire || fire.annual_expense <= 0) {
    return (
      <SectionCard title="Independencia financiera" description="Define tu objetivo para ver tu progreso.">
        <Link to="/net-worth" className="text-[13px] font-medium text-primary hover:underline">
          Configura tu objetivo FIRE
        </Link>
      </SectionCard>
    );
  }

  const target = fireNumber(fire.annual_expense, fire.swr_rate);
  const progress = fireProgress(netWorth, target);
  const months = monthsToFire(netWorth, target, monthlySavings, fire.expected_return);
  const date = months !== null ? estimatedFireDate(new Date(), months) : null;

  return (
    <SectionCard
      title="Independencia financiera"
      description={`Objetivo ${euro.format(target)} · ahorro ${euro.format(monthlySavings)}/mes.`}
    >
      <div className="space-y-2">
        <div className="flex justify-between text-[12.5px]">
          <span className="text-muted-foreground">Progreso</span>
          <span className="font-semibold">{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex justify-between text-[12.5px]">
          <span className="text-muted-foreground">Estimación</span>
          <span className="font-medium">
            {date ? `~${formatMonth(date)}` : "No alcanzable a este ritmo"}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 3: Create `FirePanel.tsx` (editable, Patrimonio)**

```tsx
// src/components/app/FirePanel.tsx
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFireSettings, useUpsertFireSettings, type FireSettings } from "@/lib/fire-api";
import { useDashboard } from "@/hooks/use-dashboard";
import { fireNumber, fireProgress, monthsToFire, estimatedFireDate } from "@/lib/fire";
import { euro, formatMonth } from "@/lib/dashboard-data";

export function FirePanel() {
  const { data: saved } = useFireSettings();
  const upsert = useUpsertFireSettings();
  const dashboard = useDashboard();

  const [form, setForm] = useState<FireSettings>({ annual_expense: 0, swr_rate: 4, expected_return: 5 });
  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  const recent = dashboard.expenses.byMonth.slice(-12);
  const monthlySavings =
    recent.length > 0
      ? recent.reduce((s, m) => s + (m.incomeTotal - m.expenseTotal), 0) / recent.length
      : 0;
  const netWorth = dashboard.series[dashboard.series.length - 1]?.netWorth ?? 0;

  const target = fireNumber(form.annual_expense, form.swr_rate);
  const progress = fireProgress(netWorth, target);
  const months = monthsToFire(netWorth, target, monthlySavings, form.expected_return);
  const date = months !== null ? estimatedFireDate(new Date(), months) : null;

  function update(patch: Partial<FireSettings>) {
    const next = { ...form, ...patch };
    setForm(next);
    upsert.mutate(next);
  }

  return (
    <SectionCard
      title="Independencia financiera (FIRE)"
      description="Tu número objetivo según la regla del 4% y tu ritmo de ahorro real."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-[12px]">Gasto anual objetivo (€)</Label>
          <Input
            type="number"
            step="100"
            value={form.annual_expense}
            onChange={(e) => update({ annual_expense: Number(e.target.value) || 0 })}
            className="text-[13px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">SWR (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={form.swr_rate}
            onChange={(e) => update({ swr_rate: Number(e.target.value) || 0 })}
            className="text-[13px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">Retorno esperado (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={form.expected_return}
            onChange={(e) => update({ expected_return: Number(e.target.value) || 0 })}
            className="text-[13px]"
          />
        </div>
      </div>
      <div className="mt-4 grid gap-2 rounded-md bg-muted/40 px-3 py-2.5 text-[12.5px] sm:grid-cols-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Número FIRE</span>
          <span className="font-semibold">{euro.format(target)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Progreso</span>
          <span className="font-semibold">{Math.round(progress * 100)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ahorro mensual real</span>
          <span className="font-medium">{euro.format(monthlySavings)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Estimación</span>
          <span className="font-medium">
            {date ? `~${formatMonth(date)}` : "No alcanzable a este ritmo"}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 4: Mount FireCard in `index.tsx` and FirePanel in `net-worth.tsx`**

- `src/routes/index.tsx`: import `FireCard` y monta `<FireCard />` en `HomeBody` (p.ej. junto a `BudgetSummaryCard`).
- `src/routes/net-worth.tsx`: READ el fichero; import `FirePanel` y monta `<FirePanel />` como una sección (dentro del contenedor principal, p.ej. al final del contenido).

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; Resumen muestra la tarjeta FIRE (o CTA) y Patrimonio el panel editable.

- [ ] **Step 6: Commit**

```bash
git add src/components/app/FireCard.tsx src/components/app/FirePanel.tsx src/routes/index.tsx src/routes/net-worth.tsx
git commit -m "feat: FIRE card in Resumen and editable FIRE panel in Patrimonio"
```

---

## Task 11: Insights extra en el Resumen

**Files:** Modify `src/components/assistant/InsightsCard.tsx`

- [ ] **Step 1: Append budget + recurring insights**

READ `src/components/assistant/InsightsCard.tsx`. Añade imports:
```typescript
import { budgetInsight, recurringInsight } from "@/lib/extra-insights";
import { useBudget, useMonthCategorySpend } from "@/lib/budget-api";
import { useRecentMovements } from "@/lib/movements-api";
import { groupActuals } from "@/lib/budget-calc";
import { detectRecurring } from "@/lib/recurring";
```
Dentro del componente, tras `const insights = computeInsights(data);`:
```typescript
  const month = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const { data: budget } = useBudget(month);
  const { data: spend = [] } = useMonthCategorySpend(month);
  const { data: recentMovs = [] } = useRecentMovements(6);

  const extra = [
    budget ? budgetInsight(budget.budgets ?? {}, groupActuals(spend), new Date()) : null,
    recurringInsight(detectRecurring(recentMovs)),
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  const allInsights = [...insights, ...extra].slice(0, 4);
```
Y usa `allInsights` en el render en lugar de `insights` (sustituye la variable que se mapea en el JSX).

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; el Resumen muestra hasta 4 insights (incl. presupuesto/suscripciones cuando aplican).

- [ ] **Step 3: Commit**

```bash
git add src/components/assistant/InsightsCard.tsx
git commit -m "feat: budget and recurring insights in Resumen"
```

---

## Cierre
- [ ] **Despliegue (controlador):** `npx supabase db push` (tablas `movement_category_rules`, `fire_settings`); `npx supabase functions deploy bank-sync bank-sync-all bank-callback` (reglas de categoría en el pipeline).
- [ ] **Rebuild + restart frontend:** `npm run build && systemctl --user restart wealth-navigator`.
- [ ] **Verificación E2E manual:** sección E2E del spec.
- [ ] **Revisión final de código** antes de cerrar la rama.

---

## Notas de revisión (self-review)
- **Cobertura del spec:** F2 reglas→Tasks 1,5,6,7,8; F1 recurrentes→Tasks 2,6,9; F3 FIRE→Tasks 3,5,6,10; F4 insights→Tasks 4,11. Tests puros→Tasks 1-4.
- **Consistencia de tipos:** `CategoryRule` (Task 1) usado en Task 7; `RecurringExpense`/`detectRecurring`/`recurringFloorByGroup` (Task 2) en Tasks 9,11; `fireNumber`/`fireProgress`/`monthsToFire`/`estimatedFireDate` (Task 3) en Task 10; `FireSettings`/`useFireSettings`/`useUpsertFireSettings` (Task 6) en Task 10; `useRecentMovements`/`useCategoryRules`/... (Task 6) en Tasks 8,9,11; `budgetInsight`/`recurringInsight` (Task 4) en Task 11; tipo `Insight` reutilizado de `assistant-mock.ts`.
- **Orden recomendado:** 1→2→3→4 (puros), 5 (DB), 6 (hooks), 7 (pipeline), 8/9/10/11 (UI). Task 9 y 11 dependen de `useRecentMovements`+`detectRecurring` (Tasks 2,6). Task 10 depende de `fire.ts`+`fire-api` (Tasks 3,6). Task 11 depende de Tasks 4,6.
- **Placeholders:** ninguno; todo el código está completo.
