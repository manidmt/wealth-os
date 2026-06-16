# Mejoras de planificación de gastos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empaquetar 5 mejoras sobre la planificación de gastos: presupuesto visible en Resumen/Gastos, proyección a fin de mes con semáforo, autorrelleno por mediana de 6 meses, reconciliación ahorro→inversión, y sugerencia del agente aplicable de un clic.

**Architecture:** Lógica pura nueva en `src/lib/budget-projection.ts`, `budget-history.ts`, `budget-suggest.ts` (Vitest). Una columna `allocations jsonb` en `monthly_budgets`. Componentes nuevos `BudgetSummaryCard` (montado en Resumen y Gastos) y `SavingsAllocationPanel`; extensiones de `BudgetTable`, `AgentSuggestionPanel`, `ExpensePlanning`, y hooks en `budget-api.ts`. No se toca el servicio Python del agente.

**Tech Stack:** Vite + React + TanStack Router/Query + Supabase + Vitest. Componentes shadcn (`SectionCard`, `Input`).

---

## Convenciones (leer antes de empezar)
- Tests puros: `*.test.ts` junto al módulo. `import { describe, it, expect } from "vitest";`. Correr: `npm run test -- <name>`.
- Tipos `IncomeItem`/`BudgetMap` viven en `src/lib/budget-calc.ts`. Grupos en `src/lib/budget-groups.ts` (`BUDGET_GROUPS`, `groupForCategory`). Son 8 grupos: comida, ocio, transporte, hogar, salud, compras, formacion, otros.
- Supabase: `import { supabase } from "@/integrations/supabase/client";`; tablas no tipadas y la columna `excluded`/`allocations` requieren cast `(supabase as any)` (ya se hace en `useMonthCategorySpend`). Numéricos PostgREST → `Number()`.
- `euro` y `formatMonth` de `@/lib/dashboard-data`. `useAuth` de `@/hooks/use-auth`.
- Inversión: `useInvestmentPlans` de `@/lib/planning-api`; `computePlannedAmount`/`toEnginePlan`/`MonthlyFinancials` de `@/lib/planning-calc`; `effectiveQuota`/`SignalMap` de `@/lib/strategy-engine`; `useLatestSignals` de `@/lib/signals-api`.
- Sin emojis. Checks: `npm run lint` (no añadir errores nuevos; ~626 preexistentes en `supabase/functions/**` y `scripts/` se ignoran) y `npm run build`.

---

## Task 1: Proyección y semáforo (puro)

**Files:** Create `src/lib/budget-projection.ts`, `src/lib/budget-projection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/budget-projection.test.ts
import { describe, it, expect } from "vitest";
import { projectMonthEnd, budgetAlert } from "./budget-projection";

describe("budget-projection", () => {
  it("projectMonthEnd extrapola lineal en el mes en curso", () => {
    // 15 de junio (30 días): gastados 100 => proyección 200
    const now = new Date(2026, 5, 15);
    expect(projectMonthEnd(100, now, true)).toBeCloseTo(200, 5);
  });
  it("projectMonthEnd el día 1 no divide por cero", () => {
    const now = new Date(2026, 5, 1);
    expect(projectMonthEnd(10, now, true)).toBeCloseTo(300, 5); // 10/1*30
  });
  it("projectMonthEnd en mes pasado devuelve el actual", () => {
    const now = new Date(2026, 5, 15);
    expect(projectMonthEnd(100, now, false)).toBe(100);
  });
  it("budgetAlert: over si el real ya superó", () => {
    expect(budgetAlert(200, 250, 300)).toBe("over");
  });
  it("budgetAlert: warning si la proyección superará pero el real no", () => {
    expect(budgetAlert(200, 120, 240)).toBe("warning");
  });
  it("budgetAlert: ok si proyección dentro de presupuesto", () => {
    expect(budgetAlert(200, 80, 160)).toBe("ok");
  });
  it("budgetAlert: presupuesto 0 => ok", () => {
    expect(budgetAlert(0, 50, 100)).toBe("ok");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- budget-projection`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implement**

```typescript
// src/lib/budget-projection.ts
export type BudgetAlert = "ok" | "warning" | "over";

/** Extrapola el gasto a fin de mes de forma lineal por días transcurridos.
 *  Mes pasado (monthIsCurrent=false) => devuelve el actual sin extrapolar. */
export function projectMonthEnd(actual: number, now: Date, monthIsCurrent: boolean): number {
  if (!monthIsCurrent) return actual;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  if (dayOfMonth <= 0) return actual;
  return (actual / dayOfMonth) * daysInMonth;
}

export function budgetAlert(budget: number, actual: number, projected: number): BudgetAlert {
  if (budget <= 0) return "ok";
  if (actual > budget) return "over";
  if (projected > budget) return "warning";
  return "ok";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- budget-projection`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-projection.ts src/lib/budget-projection.test.ts
git commit -m "feat: month-end projection and budget alert helpers"
```

---

## Task 2: Mediana histórica (puro)

**Files:** Create `src/lib/budget-history.ts`, `src/lib/budget-history.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/budget-history.test.ts
import { describe, it, expect } from "vitest";
import { median, roundTo5, medianByGroup } from "./budget-history";

describe("budget-history", () => {
  it("median impar/par/vacío", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("roundTo5 redondea al múltiplo de 5", () => {
    expect(roundTo5(103)).toBe(105);
    expect(roundTo5(102)).toBe(100);
  });
  it("medianByGroup: un mes atípico no infla la mediana", () => {
    const movs = [
      { month: "2026-01", category: "Ocio", amount: 120 },
      { month: "2026-02", category: "Ocio", amount: 90 },
      { month: "2026-03", category: "Ocio", amount: 300 }, // viaje puntual
      { month: "2026-04", category: "Ocio", amount: 110 },
      { month: "2026-05", category: "Ocio", amount: 95 },
      { month: "2026-06", category: "Ocio", amount: 100 },
    ];
    // sorted 90,95,100,110,120,300 => mediana (100+110)/2 = 105 => round5 105
    expect(medianByGroup(movs)).toEqual({ ocio: 105 });
  });
  it("medianByGroup agrupa categorías del mismo grupo dentro del mes", () => {
    const movs = [
      { month: "2026-01", category: "Comida", amount: 100 },
      { month: "2026-01", category: "Café", amount: 20 }, // comida total 120
      { month: "2026-02", category: "Comida", amount: 80 },
    ];
    // comida: meses [120, 80] => mediana 100 => round5 100
    expect(medianByGroup(movs)).toEqual({ comida: 100 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- budget-history`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/budget-history.ts
import { groupForCategory } from "./budget-groups";
import type { BudgetMap } from "./budget-calc";

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** Mediana del gasto real por grupo a lo largo de los meses dados (un valor por mes
 *  con gasto en ese grupo), redondeada a 5€. */
export function medianByGroup(
  movsConMes: { month: string; category: string; amount: number }[],
): BudgetMap {
  const perGroupMonth = new Map<string, Map<string, number>>(); // group -> (month -> total)
  for (const m of movsConMes) {
    const g = groupForCategory(m.category);
    if (!perGroupMonth.has(g)) perGroupMonth.set(g, new Map());
    const byMonth = perGroupMonth.get(g)!;
    byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + (Number(m.amount) || 0));
  }
  const out: BudgetMap = {};
  for (const [g, byMonth] of perGroupMonth) {
    out[g] = roundTo5(median([...byMonth.values()]));
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- budget-history`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-history.ts src/lib/budget-history.test.ts
git commit -m "feat: median-by-group budget autofill helper"
```

---

## Task 3: Recorte local + parser del agente (puro)

**Files:** Create `src/lib/budget-suggest.ts`, `src/lib/budget-suggest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/budget-suggest.test.ts
import { describe, it, expect } from "vitest";
import { suggestBudgetCuts, parseAgentBudgetJson } from "./budget-suggest";

describe("suggestBudgetCuts", () => {
  it("déficit <= 0 no cambia nada", () => {
    const b = { comida: 300, ocio: 200 };
    expect(suggestBudgetCuts(b, {}, 0)).toEqual(b);
    expect(suggestBudgetCuts(b, {}, -50)).toEqual(b);
  });
  it("reparte el recorte por holgura y respeta el suelo del gasto real", () => {
    const budgets = { comida: 300, ocio: 200 };
    const actuals = { comida: 100, ocio: 50 }; // holgura 200 y 150 (total 350)
    const out = suggestBudgetCuts(budgets, actuals, 100);
    // comida -= 200/350*100≈57 => 243 ; ocio -= 150/350*100≈43 => 157
    expect(out.comida).toBe(243);
    expect(out.ocio).toBe(157);
    expect(out.comida + out.ocio).toBeCloseTo(400, 0); // 500 - 100
    expect(out.comida).toBeGreaterThanOrEqual(actuals.comida);
  });
  it("sin holgura no recorta", () => {
    const budgets = { comida: 100 };
    const actuals = { comida: 100 };
    expect(suggestBudgetCuts(budgets, actuals, 50)).toEqual({ comida: 100 });
  });
});

describe("parseAgentBudgetJson", () => {
  const keys = ["comida", "ocio", "transporte"];
  it("extrae un bloque json válido filtrando claves", () => {
    const text = "Te sugiero esto.\n```json\n{\"ocio\": 110, \"comida\": 280, \"inventado\": 5}\n```\nUn saludo.";
    expect(parseAgentBudgetJson(text, keys)).toEqual({ ocio: 110, comida: 280 });
  });
  it("sin bloque json => null", () => {
    expect(parseAgentBudgetJson("texto sin json", keys)).toBeNull();
  });
  it("json malformado => null", () => {
    expect(parseAgentBudgetJson("```json\n{no es json}\n```", keys)).toBeNull();
  });
  it("descarta valores no numéricos o negativos", () => {
    const text = "```json\n{\"ocio\": \"x\", \"comida\": -5, \"transporte\": 80}\n```";
    expect(parseAgentBudgetJson(text, keys)).toEqual({ transporte: 80 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- budget-suggest`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/budget-suggest.ts
import { BUDGET_GROUPS } from "./budget-groups";
import type { BudgetMap } from "./budget-calc";

/** Propuesta de presupuesto recortado para cerrar `deficit` (>0 = hay que recortar).
 *  Reparte el recorte proporcionalmente a la holgura (presupuesto − gasto real) de cada
 *  grupo, de modo que nunca se recorta por debajo de lo ya gastado ni a negativo. */
export function suggestBudgetCuts(
  budgets: BudgetMap,
  actuals: BudgetMap,
  deficit: number,
): BudgetMap {
  const result: BudgetMap = { ...budgets };
  if (deficit <= 0) return result;
  const keys = BUDGET_GROUPS.map((g) => g.key);
  const headroom: Record<string, number> = {};
  let total = 0;
  for (const k of keys) {
    const h = Math.max(0, (budgets[k] ?? 0) - (actuals[k] ?? 0));
    headroom[k] = h;
    total += h;
  }
  if (total <= 0) return result;
  const toCut = Math.min(deficit, total);
  for (const k of keys) {
    if (headroom[k] <= 0) continue;
    const cut = (headroom[k] / total) * toCut;
    result[k] = Math.round((budgets[k] ?? 0) - cut);
  }
  return result;
}

/** Extrae el primer bloque ```json ... ``` y devuelve un BudgetMap solo con claves de
 *  `validKeys` y valores numéricos >= 0. null si no hay JSON parseable o queda vacío. */
export function parseAgentBudgetJson(text: string, validKeys: string[]): BudgetMap | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: BudgetMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (validKeys.includes(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- budget-suggest`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-suggest.ts src/lib/budget-suggest.test.ts
git commit -m "feat: local budget cut suggestion and agent JSON parser"
```

---

## Task 4: Pedir JSON aplicable en el prompt del agente

**Files:** Modify `src/lib/budget-suggestion.ts`; Modify `src/lib/budget-suggestion.test.ts`

- [ ] **Step 1: Add a failing test**

Añade este test al final del `describe` existente en `src/lib/budget-suggestion.test.ts`:

```typescript
  it("pide un bloque json con las claves de grupo", () => {
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain("comida");
    expect(prompt).toContain("ocio");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- budget-suggestion`
Expected: FAIL (el prompt aún no menciona json/claves).

- [ ] **Step 3: Implement**

En `src/lib/budget-suggestion.ts`, importa las claves de grupo y añade una instrucción final al array que se une con `\n`. Cambia el import superior:

```typescript
import { BUDGET_GROUPS } from "./budget-groups";
```
(ya está importado para `lines`; reutilízalo). Antes del `return [...].join("\n")`, calcula:

```typescript
  const groupKeys = BUDGET_GROUPS.map((g) => g.key).join(", ");
```

Y añade como ÚLTIMO elemento del array que se devuelve (después de la línea de petición de recorte):

```typescript
    `Termina tu respuesta con un bloque de código json (entre triple backtick json) con el presupuesto propuesto por grupo, usando exactamente estas claves: ${groupKeys}. Solo números enteros en euros, sin comentarios.`,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- budget-suggestion`
Expected: PASS (5 tests: los 4 previos + el nuevo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-suggestion.ts src/lib/budget-suggestion.test.ts
git commit -m "feat: ask agent for applicable budget JSON block in prompt"
```

---

## Task 5: Migración `allocations`

**Files:** Create `supabase/migrations/20260614160000_budget_allocations.sql`

> El despliegue (`npx supabase db push`) lo hace el controlador fuera del subagente.

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/20260614160000_budget_allocations.sql
alter table public.monthly_budgets
  add column if not exists allocations jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Verify**

Run: `grep -c "add column if not exists allocations" supabase/migrations/20260614160000_budget_allocations.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614160000_budget_allocations.sql
git commit -m "feat: allocations column on monthly_budgets"
```

---

## Task 6: Hooks — allocations + histórico

**Files:** Modify `src/lib/budget-api.ts`

- [ ] **Step 1: Add `allocations` to the type and read/write paths**

En `src/lib/budget-api.ts`:

1. En el tipo `MonthlyBudget`, añade tras `budgets: BudgetMap;`:
```typescript
  allocations: BudgetMap;
```
2. En `useBudget`, en el `return { ...data, savings_goal: Number(data.savings_goal) }`, cámbialo por:
```typescript
      return {
        ...data,
        savings_goal: Number(data.savings_goal),
        allocations: data.allocations ?? {},
      } as MonthlyBudget;
```
3. En `useUpsertBudget`, amplía el tipo `input` para incluir `allocations` y pásalo en el upsert:
```typescript
    mutationFn: async (input: {
      month: string;
      incomes: IncomeItem[];
      savings_goal: number;
      budgets: BudgetMap;
      allocations: BudgetMap;
    }) => {
```
(el `upsert({ ...input, user_id })` ya incluye `allocations`).
4. En `useDuplicateBudget`, en el objeto que se upserta, añade `allocations: src.allocations ?? {}` junto a `budgets: src.budgets`.

- [ ] **Step 2: Add `useHistoricalCategorySpend`**

Añade al final de `src/lib/budget-api.ts`:

```typescript
/** Gasto real (expense, no excluido) por mes y categoría de los últimos `months` meses
 *  naturales COMPLETOS anteriores al mes actual. */
export function useHistoricalCategorySpend(months: number) {
  const { user } = useAuth();
  return useQuery<{ month: string; category: string; amount: number }[]>({
    queryKey: ["historical_category_spend", months, user?.id],
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1); // exclusivo
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("movements")
        .select("date, category, amount")
        .eq("type", "expense")
        .eq("excluded", false)
        .gte("date", fmt(start))
        .lt("date", fmt(end));
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        month: (r.date as string).slice(0, 7),
        category: (r.category as string) ?? "Otro",
        amount: Number(r.amount) || 0,
      }));
    },
    enabled: !!user,
  });
}
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: sin errores nuevos en `budget-api.ts`.

> Nota: tras este cambio, los llamantes de `useUpsertBudget` deben pasar `allocations`. `ExpensePlanning` se actualiza en la Task 11; si compilas antes de esa task, añade temporalmente `allocations: {}` en sus llamadas a `upsert.mutate(...)` para que TypeScript pase, o ejecuta esta task junto con la 11. El subagente debe asegurarse de que `npm run build` queda verde al cerrar la task (ajustando las llamadas de `ExpensePlanning` si hace falta).

- [ ] **Step 4: Commit**

```bash
git add src/lib/budget-api.ts
git commit -m "feat: allocations field and historical category spend hook"
```

---

## Task 7: BudgetSummaryCard + montaje en Resumen y Gastos

**Files:** Create `src/components/planning/BudgetSummaryCard.tsx`; Modify `src/routes/index.tsx`; Modify `src/routes/expenses.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/planning/BudgetSummaryCard.tsx
import { Link } from "@tanstack/react-router";
import { SectionCard } from "@/components/app/SectionCard";
import { useBudget, useMonthCategorySpend } from "@/lib/budget-api";
import { BUDGET_GROUPS } from "@/lib/budget-groups";
import { groupActuals, totalBudgeted, type BudgetMap } from "@/lib/budget-calc";
import { projectMonthEnd, budgetAlert } from "@/lib/budget-projection";
import { euro } from "@/lib/dashboard-data";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ALERT_BAR: Record<string, string> = {
  ok: "bg-primary",
  warning: "bg-amber-500",
  over: "bg-red-500",
};

export function BudgetSummaryCard({ title = "Presupuesto del mes" }: { title?: string }) {
  const month = currentMonth();
  const { data: budget } = useBudget(month);
  const { data: spend = [] } = useMonthCategorySpend(month);
  const now = new Date();

  const budgets: BudgetMap = budget?.budgets ?? {};
  const actuals = groupActuals(spend);
  const groups = BUDGET_GROUPS.filter((g) => (budgets[g.key] ?? 0) > 0);

  if (!budget || groups.length === 0) {
    return (
      <SectionCard title={title} description="Aún no has definido el presupuesto de este mes.">
        <Link
          to="/planning"
          search={{ tab: "gastos" }}
          className="text-[13px] font-medium text-primary hover:underline"
        >
          Define tu presupuesto del mes
        </Link>
      </SectionCard>
    );
  }

  const totalBudget = totalBudgeted(budgets);
  const totalActual = BUDGET_GROUPS.reduce((s, g) => s + (actuals[g.key] ?? 0), 0);
  const totalProjected = projectMonthEnd(totalActual, now, true);

  return (
    <SectionCard
      title={title}
      description={`A este ritmo cerrarás en ${euro.format(totalProjected)} de ${euro.format(totalBudget)} presupuestado.`}
    >
      <div className="space-y-3">
        {groups.map((g) => {
          const b = budgets[g.key] ?? 0;
          const a = actuals[g.key] ?? 0;
          const projected = projectMonthEnd(a, now, true);
          const alert = budgetAlert(b, a, projected);
          const barPct = Math.min(b > 0 ? a / b : 0, 1) * 100;
          return (
            <div key={g.key} className="space-y-1">
              <div className="flex justify-between text-[12.5px]">
                <span className="font-medium">{g.label}</span>
                <span className="text-muted-foreground">
                  {euro.format(a)} / {euro.format(b)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full ${ALERT_BAR[alert]}`} style={{ width: `${barPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Mount in Resumen (`src/routes/index.tsx`)**

Lee el fichero. Dentro de `HomeBody`, en el JSX devuelto, añade `<BudgetSummaryCard />` como una sección propia cerca del inicio del contenido principal (antes de la primera `<SectionCard>` analítica, ~línea 149), respetando el wrapper de padding horizontal existente (si las secciones van dentro de un contenedor con `px-4 md:px-8`, colócalo igual; si cada bloque trae su propio padding, envuélvelo en `<section className="px-4 md:px-8">`). Añade el import:
```typescript
import { BudgetSummaryCard } from "@/components/planning/BudgetSummaryCard";
```

- [ ] **Step 3: Mount in Gastos (`src/routes/expenses.tsx`)**

Lee el fichero. Añade `<BudgetSummaryCard />` cerca del inicio del contenido (antes de la sección "Histórico mensual", ~línea 151), dentro del contenedor `max-w-*` existente. Añade el mismo import.

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; Resumen y Gastos muestran la tarjeta (o el CTA si no hay presupuesto del mes).

- [ ] **Step 5: Commit**

```bash
git add src/components/planning/BudgetSummaryCard.tsx src/routes/index.tsx src/routes/expenses.tsx
git commit -m "feat: budget summary card mounted in Resumen and Gastos"
```

---

## Task 8: Proyección y semáforo en BudgetTable

**Files:** Modify `src/components/planning/BudgetTable.tsx`

- [ ] **Step 1: Rewrite BudgetTable with projection column and alert coloring**

Reemplaza el contenido completo de `src/components/planning/BudgetTable.tsx` por:

```tsx
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { BUDGET_GROUPS } from "@/lib/budget-groups";
import { budgetStatus, totalBudgeted, type BudgetMap } from "@/lib/budget-calc";
import { projectMonthEnd, budgetAlert } from "@/lib/budget-projection";
import { euro } from "@/lib/dashboard-data";

const ALERT_BAR: Record<string, string> = {
  ok: "bg-primary",
  warning: "bg-amber-500",
  over: "bg-red-500",
};
const ALERT_LABEL: Record<string, { text: string; cls: string }> = {
  ok: { text: "Vas bien", cls: "text-emerald-600 dark:text-emerald-400" },
  warning: { text: "Vas justo", cls: "text-amber-600 dark:text-amber-400" },
  over: { text: "Te pasas", cls: "text-red-500" },
};

export function BudgetTable({
  budgets,
  actuals,
  onChange,
  monthIsCurrent = true,
}: {
  budgets: BudgetMap;
  actuals: BudgetMap;
  onChange: (groupKey: string, amount: number) => void;
  monthIsCurrent?: boolean;
}) {
  const now = new Date();
  const totalPlanned = totalBudgeted(budgets);
  const totalActual = totalBudgeted(actuals);
  const totalProjected = projectMonthEnd(totalActual, now, monthIsCurrent);

  return (
    <SectionCard
      title="Presupuesto por categoría"
      description="Cuánto quieres gastar en cada grupo y cómo vas frente a lo real (con proyección a fin de mes)."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Grupo</th>
              <th className="pb-2 pr-4 text-right font-medium">Presupuesto</th>
              <th className="pb-2 pr-4 text-right font-medium">Gastado</th>
              <th className="pb-2 pr-4 font-medium">Consumido</th>
              <th className="pb-2 pr-4 text-right font-medium">Proyección</th>
              <th className="pb-2 text-right font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {BUDGET_GROUPS.map((g) => {
              const planned = budgets[g.key] ?? 0;
              const actual = actuals[g.key] ?? 0;
              const { pct } = budgetStatus(planned, actual);
              const projected = projectMonthEnd(actual, now, monthIsCurrent);
              const alert = budgetAlert(planned, actual, projected);
              const barPct = Math.min(pct, 1) * 100;
              return (
                <tr key={g.key}>
                  <td className="py-2 pr-4 font-medium text-foreground">{g.label}</td>
                  <td className="py-2 pr-4 text-right">
                    <Input
                      type="number"
                      step="1"
                      value={planned}
                      onChange={(e) => onChange(g.key, Number(e.target.value) || 0)}
                      className="ml-auto w-24 text-right text-[12.5px]"
                    />
                  </td>
                  <td className="py-2 pr-4 text-right">{euro.format(actual)}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${ALERT_BAR[alert]}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {planned > 0 ? `${Math.round(pct * 100)}%` : "—"}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-right text-muted-foreground">
                    {monthIsCurrent && planned > 0 ? euro.format(projected) : "—"}
                  </td>
                  <td className="py-2 text-right">
                    {planned === 0 ? (
                      <span className="text-muted-foreground">Sin presupuesto</span>
                    ) : (
                      <span className={ALERT_LABEL[alert].cls}>{ALERT_LABEL[alert].text}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 text-right">{euro.format(totalPlanned)}</td>
              <td className="py-2 pr-4 text-right">{euro.format(totalActual)}</td>
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4 text-right">
                {monthIsCurrent ? euro.format(totalProjected) : "—"}
              </td>
              <td className="py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; la tabla muestra proyección y semáforo (ok/warning/over). `monthIsCurrent` por defecto true mantiene compatibilidad hasta que la Task 11 lo pase.

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/BudgetTable.tsx
git commit -m "feat: month-end projection and traffic-light status in budget table"
```

---

## Task 9: SavingsAllocationPanel (reparto ahorro→inversión)

**Files:** Create `src/components/planning/SavingsAllocationPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/planning/SavingsAllocationPanel.tsx
import { useMemo } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInvestmentPlans } from "@/lib/planning-api";
import { useLatestSignals } from "@/lib/signals-api";
import { computePlannedAmount, toEnginePlan, type MonthlyFinancials } from "@/lib/planning-calc";
import { effectiveQuota } from "@/lib/strategy-engine";
import { euro } from "@/lib/dashboard-data";
import type { BudgetMap } from "@/lib/budget-calc";

export const POLVORA_KEY = "__polvora__";

export function SavingsAllocationPanel({
  month,
  savingsGoal,
  allocations,
  monthlyFinancials,
  onChange,
}: {
  month: string;
  savingsGoal: number;
  allocations: BudgetMap;
  monthlyFinancials: MonthlyFinancials[];
  onChange: (next: BudgetMap) => void;
}) {
  const { data: plans = [] } = useInvestmentPlans();
  const { data: signals = {} } = useLatestSignals();

  const activePlans = useMemo(() => plans.filter((p) => p.active), [plans]);

  // Valor mostrado por destino: lo guardado o, en su defecto, la aportación prevista del plan.
  function plannedFor(planId: string): number {
    const plan = activePlans.find((p) => p.id === planId);
    if (!plan) return 0;
    return plan.asset_class
      ? effectiveQuota(toEnginePlan(plan), signals)
      : computePlannedAmount(plan, monthlyFinancials, month);
  }

  const rows = [
    ...activePlans.map((p) => ({
      key: p.id,
      label: p.name,
      value: allocations[p.id] ?? Math.round(plannedFor(p.id)),
    })),
    { key: POLVORA_KEY, label: "Pólvora (reserva)", value: allocations[POLVORA_KEY] ?? 0 },
  ];

  const assigned = rows.reduce((s, r) => s + r.value, 0);
  const unassigned = savingsGoal - assigned;

  function update(key: string, amount: number) {
    onChange({ ...allocations, [key]: amount });
  }

  return (
    <SectionCard
      title="Reparto del ahorro"
      description="Cómo se reparte tu ahorro planificado entre tus planes de inversión y la pólvora."
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2">
            <Label className="text-[12.5px]">{r.label}</Label>
            <Input
              type="number"
              step="1"
              value={r.value}
              onChange={(e) => update(r.key, Number(e.target.value) || 0)}
              className="w-32 text-right text-[13px]"
            />
          </div>
        ))}
        <div className="space-y-1 border-t border-border pt-2 text-[12.5px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Objetivo de ahorro</span>
            <span className="font-medium">{euro.format(savingsGoal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Asignado</span>
            <span className="font-medium">{euro.format(assigned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {unassigned < 0 ? "Te pasas del ahorro" : "Sin asignar"}
            </span>
            <span
              className={`font-semibold ${unassigned < 0 ? "text-red-500" : "text-foreground"}`}
            >
              {euro.format(unassigned)}
            </span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila (el componente aún no se monta; eso es la Task 11).

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/SavingsAllocationPanel.tsx
git commit -m "feat: savings allocation panel (reconcile savings into investment plans)"
```

---

## Task 10: AgentSuggestionPanel aplicable

**Files:** Modify `src/components/planning/AgentSuggestionPanel.tsx`

- [ ] **Step 1: Rewrite with Apply button, local suggestion and JSON parsing**

Reemplaza el contenido completo de `src/components/planning/AgentSuggestionPanel.tsx` por:

```tsx
import { useRef, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { useAuth } from "@/hooks/use-auth";
import { openAgentStream } from "@/lib/agent-ws";
import { buildBudgetSuggestionPrompt } from "@/lib/budget-suggestion";
import { suggestBudgetCuts, parseAgentBudgetJson } from "@/lib/budget-suggest";
import { savingsGap, type BudgetMap, type IncomeItem } from "@/lib/budget-calc";
import { BUDGET_GROUPS } from "@/lib/budget-groups";

const GROUP_KEYS = BUDGET_GROUPS.map((g) => g.key);

export function AgentSuggestionPanel({
  month,
  incomes,
  savingsGoal,
  budgets,
  actuals,
  onApply,
}: {
  month: string;
  incomes: IncomeItem[];
  savingsGoal: number;
  budgets: BudgetMap;
  actuals: BudgetMap;
  onApply: (next: BudgetMap) => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
  const [error, setError] = useState("");
  const [agentProposal, setAgentProposal] = useState<BudgetMap | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const deficit = Math.max(0, -savingsGap(incomes, budgets, savingsGoal));
  const localProposal = suggestBudgetCuts(budgets, actuals, deficit);
  // El JSON del agente prevalece; si no, la propuesta local (si recorta algo).
  const proposal = agentProposal ? { ...budgets, ...agentProposal } : localProposal;
  const hasProposal =
    agentProposal !== null || JSON.stringify(localProposal) !== JSON.stringify(budgets);

  // Texto visible sin el bloque json crudo.
  const visibleText = text.replace(/```json[\s\S]*?```/i, "").trim();

  function ask() {
    if (!user?.id) return;
    setText("");
    setError("");
    setAgentProposal(null);
    setStatus("streaming");
    const prompt = buildBudgetSuggestionPrompt({ month, incomes, savingsGoal, budgets, actuals });
    let acc = "";
    closeRef.current = openAgentStream(user.id, prompt, [], {
      onToken: (t) => {
        acc += t;
        setText(acc);
      },
      onDone: () => {
        const parsed = parseAgentBudgetJson(acc, GROUP_KEYS);
        if (parsed) setAgentProposal(parsed);
        setStatus("idle");
      },
      onError: (e) => {
        setError(e);
        setStatus("error");
      },
    });
  }

  return (
    <SectionCard
      title="Sugerencias del agente"
      description="Pide al Wealth Agent cómo cuadrar gastos y ahorro, y aplica su propuesta."
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={ask}
          disabled={status === "streaming"}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {status === "streaming" ? "Pensando…" : "Pedir sugerencias al agente"}
        </button>
        {hasProposal && (
          <button
            type="button"
            onClick={() => onApply(proposal)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Check className="h-3.5 w-3.5" />
            {agentProposal ? "Aplicar propuesta del agente" : "Aplicar recorte sugerido"}
          </button>
        )}
      </div>

      {status === "error" && <p className="mt-3 text-[12.5px] text-muted-foreground">{error}</p>}
      {visibleText && (
        <div className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2.5 text-[12.5px] leading-relaxed">
          {visibleText}
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila. (El nuevo prop `onApply` lo cablea la Task 11; build puede fallar en `ExpensePlanning.tsx` por falta de `onApply` hasta entonces — si ejecutas esta task aislada, añade temporalmente `onApply={() => {}}` en ExpensePlanning o ejecútala junto a la 11. Deja `npm run build` verde al cerrar.)

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/AgentSuggestionPanel.tsx
git commit -m "feat: applicable agent suggestion (local cut + agent JSON, Apply button)"
```

---

## Task 11: Integración en ExpensePlanning

**Files:** Modify `src/components/planning/ExpensePlanning.tsx`

Contexto: `ExpensePlanning` mantiene estado local `incomes`, `savingsGoal`, `budgets` sembrado una vez por mes vía `seededMonthRef`, y persiste con `save({...})` que llama `upsert.mutate`. Lee `useBudget(month)` y `useMonthCategorySpend(month)`. Renderiza selector de mes + `DuplicatePreviousMonthButton`, ingresos, objetivo de ahorro, `BudgetTable` y `AgentSuggestionPanel`.

- [ ] **Step 1: Add imports**

Añade a los imports de `src/components/planning/ExpensePlanning.tsx`:
```typescript
import { useHistoricalCategorySpend } from "@/lib/budget-api";
import { medianByGroup } from "@/lib/budget-history";
import { SavingsAllocationPanel } from "./SavingsAllocationPanel";
import type { MonthlyFinancials } from "@/lib/planning-calc";
import { useDashboard } from "@/hooks/use-dashboard";
```
(`useBudget`, `useUpsertBudget`, `useMonthCategorySpend` ya están importados de `@/lib/budget-api`; añade `useHistoricalCategorySpend` a ese import existente o en línea aparte.)

- [ ] **Step 2: Add allocations state + month financials + history hook**

Dentro del componente:

1. Añade estado de allocations junto a los otros:
```typescript
  const [allocations, setAllocations] = useState<BudgetMap>({});
```
2. Añade datos para precargar el reparto y el histórico:
```typescript
  const dashboard = useDashboard();
  const monthlyFinancials: MonthlyFinancials[] = dashboard.expenses.byMonth.map((m) => ({
    month: m.month,
    income: m.incomeTotal,
    expense: m.expenseTotal,
  }));
  const { data: history = [] } = useHistoricalCategorySpend(6);
```
3. En el `useEffect` de siembra por mes (el que usa `seededMonthRef`), añade dentro de las dos ramas el seteo de allocations:
   - rama `if (budget)`: `setAllocations(budget.allocations ?? {});`
   - rama `else`: `setAllocations({});`

- [ ] **Step 3: Include allocations in `save` and add helpers**

1. Amplía la firma de `save` y el `upsert.mutate`:
```typescript
  function save(next: {
    incomes?: IncomeItem[];
    savings_goal?: number;
    budgets?: BudgetMap;
    allocations?: BudgetMap;
  }) {
    upsert.mutate({
      month,
      incomes: next.incomes ?? incomes,
      savings_goal: next.savings_goal ?? savingsGoal,
      budgets: next.budgets ?? budgets,
      allocations: next.allocations ?? allocations,
    });
  }
```
2. Añade handlers:
```typescript
  function applyBudgets(next: BudgetMap) {
    setBudgets(next);
    save({ budgets: next });
  }
  function autofillFromHistory() {
    const proposal = medianByGroup(history);
    applyBudgets(proposal);
  }
  function updateAllocations(next: BudgetMap) {
    setAllocations(next);
    save({ allocations: next });
  }
```

- [ ] **Step 4: Wire the UI**

1. Junto a `<DuplicatePreviousMonthButton .../>` añade el botón de autorrelleno:
```tsx
          <button
            type="button"
            onClick={autofillFromHistory}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
          >
            Rellenar con mi histórico (mediana 6m)
          </button>
```
2. Tras la `SectionCard` del objetivo de ahorro, monta el reparto:
```tsx
      <SavingsAllocationPanel
        month={month}
        savingsGoal={savingsGoal}
        allocations={allocations}
        monthlyFinancials={monthlyFinancials}
        onChange={updateAllocations}
      />
```
3. Pasa `monthIsCurrent` a `BudgetTable`:
```tsx
      <BudgetTable
        budgets={budgets}
        actuals={actuals}
        onChange={updateBudget}
        monthIsCurrent={month === currentMonth()}
      />
```
4. Pasa `onApply` a `AgentSuggestionPanel`:
```tsx
      <AgentSuggestionPanel
        month={month}
        incomes={incomes}
        savingsGoal={savingsGoal}
        budgets={budgets}
        actuals={actuals}
        onApply={applyBudgets}
      />
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; `/planning?tab=gastos` muestra autorrelleno, reparto del ahorro, proyección/semáforo en la tabla y "Aplicar" en sugerencias.

- [ ] **Step 6: Commit**

```bash
git add src/components/planning/ExpensePlanning.tsx
git commit -m "feat: wire autofill, savings allocation, projection and applicable suggestion into expense planning"
```

---

## Cierre
- [ ] **Despliegue (controlador):** `npx supabase db push` (proyecto `pqfixpcbupdslrdfealq`); verificar columna `allocations` en `monthly_budgets`.
- [ ] **Rebuild + restart frontend:** `npm run build && systemctl --user restart wealth-navigator`.
- [ ] **Verificación E2E manual:** sección 10 del spec.
- [ ] **Revisión final de código** del conjunto antes de cerrar la rama.

---

## Notas de revisión (self-review)
- **Cobertura del spec:** §1 proyección→Task 1; §2 mediana→Task 2; §3 recorte/parser→Task 3; §4 prompt JSON→Task 4; §5 prompt ext→Task 4; §1 DB→Task 5; §6 hooks→Task 6; §7.1 BudgetSummaryCard+montaje→Task 7; §7.2 BudgetTable→Task 8; §7.3 SavingsAllocationPanel→Task 9; §7.4 AgentSuggestionPanel→Task 10; §7.5 ExpensePlanning→Task 11; §9 tests→Tasks 1-4.
- **Consistencia de tipos:** `BudgetMap` (budget-calc) usado en todos; `BudgetAlert`/`projectMonthEnd`/`budgetAlert` (Task 1) usados en Tasks 7,8; `medianByGroup` (Task 2) en Task 11; `suggestBudgetCuts`/`parseAgentBudgetJson` (Task 3) en Task 10; `allocations` (Tasks 5,6) en Tasks 9,11; `POLVORA_KEY` exportado en Task 9 (uso interno). `useUpsertBudget` gana `allocations` en Task 6 → todos los llamantes (solo `ExpensePlanning`) lo pasan en Task 11; mientras tanto la nota en Task 6/10 evita romper el build.
- **Orden recomendado:** 1→2→3→4 (puros), 5 (DB), 6 (hooks), 7 (summary+montaje), 8 (tabla), 9 (panel), 10 (sugerencia), 11 (integración, cierra el build). Tasks 6, 10 y 11 están acopladas por el prop/argumento `allocations`/`onApply`: si se ejecutan aisladas, usar los stubs temporales indicados; lo natural es que el subagente deje `npm run build` verde al final de cada una ajustando ExpensePlanning mínimamente o ejecutando 6+10+11 de forma encadenada.
