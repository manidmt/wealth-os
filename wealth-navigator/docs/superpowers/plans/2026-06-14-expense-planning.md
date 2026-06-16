# Planificación de gastos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dividir `/planning` en pestañas Inversión/Gastos y construir la planificación mensual de gastos (ingresos, presupuesto por grupos, objetivo de ahorro, seguimiento real vs planificado, sugerencias del Wealth Agent, duplicar mes anterior).

**Architecture:** Lógica pura en módulos `src/lib/*.ts` testeados con Vitest (`budget-groups`, `budget-calc`, `budget-suggestion`). Datos en una tabla `monthly_budgets` (una fila por usuario/mes, jsonb). Hooks de datos con TanStack Query en `budget-api.ts`. Un helper `agent-ws.ts` extrae el WebSocket del asistente y lo comparte. UI en componentes bajo `src/components/planning/` orquestados por dos pestañas en `routes/planning.tsx`.

**Tech Stack:** Vite + React + TanStack Router/Query + Supabase (Postgres/RLS) + Vitest. Componentes shadcn (`SectionCard`, `Input`, `Select`, `Dialog`).

---

## Convenciones del repo (leer antes de empezar)

- Tests puros: `*.test.ts` junto al módulo, `import { describe, it, expect } from "vitest"`. Correr con `npm run test`.
- Cliente Supabase: `import { supabase } from "@/integrations/supabase/client";`. Acceso con cast `(supabase as any)` para tablas no tipadas (patrón en `planning-api.ts`).
- Auth: `import { useAuth } from "@/hooks/use-auth";` → `const { user } = useAuth();`.
- PostgREST devuelve numéricos como string → envolver con `Number()`.
- Sin emojis en la UI.
- Categorías de gasto: `EXPENSE_CATEGORIES` en `src/lib/movements-api.ts` (23 strings).
- Componentes pesados: ver `routes/planning.tsx` y `routes/assistant.tsx` para estilos (clases tailwind con tamaños `text-[12px]` etc.).
- Build/checks: `npm run lint` y `npm run build`. Pure: `npm run test`.

---

## Task 1: Mapa de grupos de presupuesto (puro)

**Files:**
- Create: `src/lib/budget-groups.ts`
- Test: `src/lib/budget-groups.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/budget-groups.test.ts
import { describe, it, expect } from "vitest";
import { BUDGET_GROUPS, groupForCategory } from "./budget-groups";
import { EXPENSE_CATEGORIES } from "./movements-api";

describe("budget-groups", () => {
  it("mapea categorías a su grupo esperado", () => {
    expect(groupForCategory("Comida")).toBe("comida");
    expect(groupForCategory("Café")).toBe("comida");
    expect(groupForCategory("Comer fuera")).toBe("ocio");
    expect(groupForCategory("Viaje")).toBe("ocio");
    expect(groupForCategory("Coche")).toBe("transporte");
    expect(groupForCategory("Suscripciones")).toBe("hogar");
    expect(groupForCategory("Gimnasio")).toBe("salud");
    expect(groupForCategory("Tecnología")).toBe("compras");
    expect(groupForCategory("Educación")).toBe("otros");
  });

  it("categoría desconocida cae en otros", () => {
    expect(groupForCategory("NoExiste")).toBe("otros");
    expect(groupForCategory("")).toBe("otros");
  });

  it("cubre las 23 categorías sin solapes", () => {
    const mapped = BUDGET_GROUPS.flatMap((g) => g.categories);
    // sin duplicados
    expect(new Set(mapped).size).toBe(mapped.length);
    // cada categoría existente está en exactamente un grupo
    for (const cat of EXPENSE_CATEGORIES) {
      expect(mapped).toContain(cat);
    }
    // y no hay categorías de más en el mapa
    for (const cat of mapped) {
      expect(EXPENSE_CATEGORIES).toContain(cat);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- budget-groups`
Expected: FAIL ("Failed to resolve import ./budget-groups" o similar).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/budget-groups.ts
export type BudgetGroup = { key: string; label: string; categories: string[] };

export const BUDGET_GROUPS: BudgetGroup[] = [
  { key: "comida", label: "Comida", categories: ["Comida", "Café"] },
  { key: "ocio", label: "Ocio", categories: ["Ocio", "Viaje", "Comer fuera"] },
  { key: "transporte", label: "Transporte", categories: ["Transporte", "Coche"] },
  { key: "hogar", label: "Hogar", categories: ["Hogar", "Suscripciones", "Impuestos", "Gestiones"] },
  {
    key: "salud",
    label: "Salud y bienestar",
    categories: ["Salud", "Gimnasio", "Deporte", "Cuidado personal", "Higiene", "Suplementos"],
  },
  { key: "compras", label: "Compras", categories: ["Ropa", "Tecnología", "Regalo"] },
  { key: "otros", label: "Otros", categories: ["Otro", "Educación", "Formación"] },
];

const CATEGORY_TO_GROUP: Record<string, string> = Object.fromEntries(
  BUDGET_GROUPS.flatMap((g) => g.categories.map((c) => [c, g.key])),
);

export function groupForCategory(category: string): string {
  return CATEGORY_TO_GROUP[category] ?? "otros";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- budget-groups`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-groups.ts src/lib/budget-groups.test.ts
git commit -m "feat: budget group map covering the 23 expense categories"
```

---

## Task 2: Cálculo de presupuesto (puro)

**Files:**
- Create: `src/lib/budget-calc.ts`
- Test: `src/lib/budget-calc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/budget-calc.test.ts
import { describe, it, expect } from "vitest";
import {
  totalIncome,
  totalBudgeted,
  groupActuals,
  budgetStatus,
  plannedSavings,
  availableForExpenses,
  savingsGap,
  actualSavingsSoFar,
  type IncomeItem,
} from "./budget-calc";

const incomes: IncomeItem[] = [
  { label: "Salario", amount: 1750 },
  { label: "Otros", amount: 0 },
];

describe("budget-calc", () => {
  it("totalIncome suma las partidas", () => {
    expect(totalIncome(incomes)).toBe(1750);
    expect(totalIncome([])).toBe(0);
  });

  it("totalBudgeted suma el mapa", () => {
    expect(totalBudgeted({ comida: 330, ocio: 200 })).toBe(530);
    expect(totalBudgeted({})).toBe(0);
  });

  it("groupActuals pliega categorías al grupo", () => {
    const movs = [
      { category: "Comida", amount: 100 },
      { category: "Café", amount: 30 }, // también comida
      { category: "Comer fuera", amount: 50 }, // ocio
      { category: "NoExiste", amount: 5 }, // otros
    ];
    expect(groupActuals(movs)).toEqual({ comida: 130, ocio: 50, otros: 5 });
  });

  it("budgetStatus calcula pct, restante y exceso", () => {
    expect(budgetStatus(200, 150)).toEqual({ pct: 0.75, remaining: 50, over: false });
    expect(budgetStatus(200, 250)).toEqual({ pct: 1.25, remaining: -50, over: true });
    expect(budgetStatus(200, 200)).toEqual({ pct: 1, remaining: 0, over: false });
    expect(budgetStatus(0, 0)).toEqual({ pct: 0, remaining: 0, over: false });
    expect(budgetStatus(0, 10)).toEqual({ pct: 1, remaining: -10, over: true });
  });

  it("plannedSavings = ingresos - presupuestado", () => {
    expect(plannedSavings(incomes, { comida: 330, ocio: 200 })).toBe(1220);
  });

  it("availableForExpenses = ingresos - objetivo", () => {
    expect(availableForExpenses(incomes, 300)).toBe(1450);
  });

  it("savingsGap negativo => déficit", () => {
    // ingresos 1750, presupuestado 1600 => ahorro plan 150; objetivo 300 => gap -150
    expect(savingsGap(incomes, { comida: 1600 }, 300)).toBe(-150);
    // holgura
    expect(savingsGap(incomes, { comida: 1000 }, 300)).toBe(450);
  });

  it("actualSavingsSoFar = ingresos - gasto real", () => {
    expect(actualSavingsSoFar(incomes, { comida: 130, ocio: 50 })).toBe(1570);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- budget-calc`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/budget-calc.ts
import { groupForCategory } from "./budget-groups";

export type IncomeItem = { label: string; amount: number };
export type BudgetMap = Record<string, number>;
export type GroupStatus = { pct: number; remaining: number; over: boolean };

export function totalIncome(incomes: IncomeItem[]): number {
  return incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
}

export function totalBudgeted(budgets: BudgetMap): number {
  return Object.values(budgets).reduce((s, v) => s + (Number(v) || 0), 0);
}

export function groupActuals(movements: { category: string; amount: number }[]): BudgetMap {
  const out: BudgetMap = {};
  for (const m of movements) {
    const key = groupForCategory(m.category);
    out[key] = (out[key] ?? 0) + (Number(m.amount) || 0);
  }
  return out;
}

export function budgetStatus(planned: number, actual: number): GroupStatus {
  const pct = planned > 0 ? actual / planned : actual > 0 ? 1 : 0;
  return { pct, remaining: planned - actual, over: actual > planned };
}

export function plannedSavings(incomes: IncomeItem[], budgets: BudgetMap): number {
  return totalIncome(incomes) - totalBudgeted(budgets);
}

export function availableForExpenses(incomes: IncomeItem[], savingsGoal: number): number {
  return totalIncome(incomes) - savingsGoal;
}

export function savingsGap(incomes: IncomeItem[], budgets: BudgetMap, goal: number): number {
  return plannedSavings(incomes, budgets) - goal;
}

export function actualSavingsSoFar(incomes: IncomeItem[], actuals: BudgetMap): number {
  return totalIncome(incomes) - totalBudgeted(actuals);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- budget-calc`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-calc.ts src/lib/budget-calc.test.ts
git commit -m "feat: budget calc helpers (totals, group actuals, savings gap)"
```

---

## Task 3: Prompt de sugerencias del agente (puro)

**Files:**
- Create: `src/lib/budget-suggestion.ts`
- Test: `src/lib/budget-suggestion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/budget-suggestion.test.ts
import { describe, it, expect } from "vitest";
import { buildBudgetSuggestionPrompt } from "./budget-suggestion";

describe("buildBudgetSuggestionPrompt", () => {
  const prompt = buildBudgetSuggestionPrompt({
    month: "2026-06",
    incomes: [{ label: "Salario", amount: 1750 }],
    savingsGoal: 300,
    budgets: { comida: 330, ocio: 200 },
    actuals: { comida: 150, ocio: 80 },
  });

  it("incluye total de ingresos y objetivo", () => {
    expect(prompt).toContain("1750");
    expect(prompt).toContain("300");
  });

  it("incluye ahorro planificado y el déficit/holgura", () => {
    // ingresos 1750 - presupuestado 530 = 1220 ahorro planificado
    expect(prompt).toContain("1220");
  });

  it("incluye cada grupo con planificado vs real", () => {
    expect(prompt).toMatch(/Comida.*330.*150/s);
    expect(prompt).toMatch(/Ocio.*200.*80/s);
  });

  it("pide sugerencias de recorte", () => {
    expect(prompt.toLowerCase()).toContain("recort");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- budget-suggestion`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/budget-suggestion.ts
import { BUDGET_GROUPS } from "./budget-groups";
import {
  totalIncome,
  plannedSavings,
  savingsGap,
  type BudgetMap,
  type IncomeItem,
} from "./budget-calc";

export function buildBudgetSuggestionPrompt(input: {
  month: string;
  incomes: IncomeItem[];
  savingsGoal: number;
  budgets: BudgetMap;
  actuals: BudgetMap;
}): string {
  const { month, incomes, savingsGoal, budgets, actuals } = input;
  const income = totalIncome(incomes);
  const planned = plannedSavings(incomes, budgets);
  const gap = savingsGap(incomes, budgets, savingsGoal);

  const lines = BUDGET_GROUPS.map((g) => {
    const p = budgets[g.key] ?? 0;
    const a = actuals[g.key] ?? 0;
    return `- ${g.label}: planificado ${p}€ / real ${a}€`;
  }).join("\n");

  const gapLine =
    gap < 0
      ? `Con este plan el ahorro estimado es ${planned}€, ${Math.abs(gap)}€ por debajo del objetivo (${savingsGoal}€).`
      : `Con este plan el ahorro estimado es ${planned}€, ${gap}€ por encima del objetivo (${savingsGoal}€).`;

  return [
    `Estás revisando mi planificación de gastos del mes ${month}.`,
    `Ingresos previstos: ${income}€. Objetivo de ahorro: ${savingsGoal}€.`,
    gapLine,
    `Presupuesto y gasto real por grupo:`,
    lines,
    gap < 0
      ? `Para alcanzar el objetivo tendría que recortar ${Math.abs(gap)}€. Sugiéreme en qué grupos concretos recortar y cuánto, priorizando donde voy más holgado o me estoy pasando. Sé concreto y breve.`
      : `Voy bien para el objetivo. Dime si ves algún grupo donde me esté pasando y si podría ahorrar aún más. Sé concreto y breve.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- budget-suggestion`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-suggestion.ts src/lib/budget-suggestion.test.ts
git commit -m "feat: build Wealth Agent budget suggestion prompt"
```

---

## Task 4: Migración `monthly_budgets`

**Files:**
- Create: `supabase/migrations/20260614120000_monthly_budgets.sql`

> El despliegue real (`npx supabase db push`) lo ejecuta el controlador (SDD) fuera del subagente. Esta tarea solo crea el fichero de migración y lo commitea.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260614120000_monthly_budgets.sql
create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  incomes jsonb not null default '[]'::jsonb,
  savings_goal numeric not null default 0,
  budgets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, month)
);

alter table public.monthly_budgets enable row level security;

create policy "own budgets" on public.monthly_budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Verify SQL is syntactically sane**

Run: `grep -c "create table\|create policy\|enable row level security" supabase/migrations/20260614120000_monthly_budgets.sql`
Expected: `3`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614120000_monthly_budgets.sql
git commit -m "feat: monthly_budgets table with RLS"
```

---

## Task 5: Helper de WebSocket del agente + refactor del asistente

**Files:**
- Create: `src/lib/agent-ws.ts`
- Modify: `src/routes/assistant.tsx` (sustituir la lógica inline del WS por el helper, sin cambiar comportamiento)

- [ ] **Step 1: Create the helper**

```typescript
// src/lib/agent-ws.ts
const WS_BASE_URL =
  (import.meta.env.VITE_AGENT_WS_URL as string | undefined) ?? "ws://localhost:8000";

export type AgentHandlers = {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export type AgentMessage = { role: "user" | "assistant"; content: string };

/**
 * Abre un WS al agente, envía {message, history} y enruta los eventos de stream.
 * Devuelve una función para cerrar/abortar la conexión.
 */
export function openAgentStream(
  userId: string,
  message: string,
  history: AgentMessage[],
  handlers: AgentHandlers,
): () => void {
  let settled = false;
  const ws = new WebSocket(`${WS_BASE_URL}/ws/${userId}`);

  const timeout = setTimeout(() => {
    if (!settled && ws.readyState !== WebSocket.OPEN) {
      settled = true;
      handlers.onError("El agente no está disponible ahora.");
      ws.close();
    }
  }, 5000);

  ws.onopen = () => {
    ws.send(JSON.stringify({ message, history }));
  };

  ws.onmessage = (ev) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (typeof parsed?.token === "string") {
      handlers.onToken(parsed.token as string);
      return;
    }
    if (parsed?.done) {
      settled = true;
      clearTimeout(timeout);
      handlers.onDone();
      ws.close();
      return;
    }
    if (parsed?.error) {
      settled = true;
      clearTimeout(timeout);
      handlers.onError(String(parsed.error));
      ws.close();
    }
  };

  ws.onerror = () => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      handlers.onError("El agente no está disponible ahora.");
    }
  };

  ws.onclose = () => {
    clearTimeout(timeout);
  };

  return () => {
    clearTimeout(timeout);
    ws.close();
  };
}
```

- [ ] **Step 2: Refactor `assistant.tsx` to reuse the helper**

In `src/routes/assistant.tsx`, the current `send()` opens a persistent WS in a `useEffect` and streams tokens. Keep the assistant's existing UX (persistent connection, streaming into `messages`). Minimal refactor: extract the WS base URL constant to import from the helper so there is a single source. Replace the local `WS_BASE_URL` declaration:

Remove:
```typescript
const WS_BASE_URL =
  (import.meta.env.VITE_AGENT_WS_URL as string | undefined) ?? "ws://localhost:8000";
```
Add to the import block at the top (after the existing imports):
```typescript
import { AGENT_WS_BASE_URL } from "@/lib/agent-ws";
```
And in `agent-ws.ts`, export the base url so both share it. Add at the end of `agent-ws.ts`:
```typescript
export const AGENT_WS_BASE_URL = WS_BASE_URL;
```
Then in `assistant.tsx` replace the usage `new WebSocket(`${WS_BASE_URL}/ws/${user.id}`)` with `new WebSocket(`${AGENT_WS_BASE_URL}/ws/${user.id}`)`.

> Rationale: the assistant uses a long-lived connection; `openAgentStream` is for one-shot requests (budget panel). We share only the base URL to avoid divergence, without risking the assistant's behavior.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: sin errores nuevos. (Si `npm run build` falla por algo preexistente ajeno a estos ficheros, anótalo y continúa.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent-ws.ts src/routes/assistant.tsx
git commit -m "feat: agent-ws helper for one-shot agent streams; share WS base url"
```

---

## Task 6: Hooks de datos `budget-api.ts`

**Files:**
- Create: `src/lib/budget-api.ts`

- [ ] **Step 1: Create the API module**

```typescript
// src/lib/budget-api.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { IncomeItem, BudgetMap } from "./budget-calc";

export type MonthlyBudget = {
  id: string;
  user_id: string;
  month: string; // 'YYYY-MM'
  incomes: IncomeItem[];
  savings_goal: number;
  budgets: BudgetMap;
  created_at: string;
};

export function useBudget(month: string) {
  const { user } = useAuth();
  return useQuery<MonthlyBudget | null>({
    queryKey: ["monthly_budgets", month, user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("monthly_budgets")
        .select("*")
        .eq("month", month)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { ...data, savings_goal: Number(data.savings_goal) } as MonthlyBudget;
    },
    enabled: !!user,
  });
}

export function useUpsertBudget() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      month: string;
      incomes: IncomeItem[];
      savings_goal: number;
      budgets: BudgetMap;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("monthly_budgets")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "user_id,month" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["monthly_budgets", vars.month] }),
  });
}

export function useDuplicateBudget() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { from: string; to: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: src, error: e1 } = await (supabase as any)
        .from("monthly_budgets")
        .select("*")
        .eq("month", input.from)
        .maybeSingle();
      if (e1) throw e1;
      if (!src) throw new Error("No hay planificación en el mes anterior para duplicar.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e2 } = await (supabase as any).from("monthly_budgets").upsert(
        {
          user_id: user!.id,
          month: input.to,
          incomes: src.incomes,
          savings_goal: src.savings_goal,
          budgets: src.budgets,
        },
        { onConflict: "user_id,month" },
      );
      if (e2) throw e2;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["monthly_budgets", vars.to] }),
  });
}

/** Gasto real del mes por categoría (expense, no excluido). */
export function useMonthCategorySpend(month: string) {
  const { user } = useAuth();
  return useQuery<{ category: string; amount: number }[]>({
    queryKey: ["month_category_spend", month, user?.id],
    queryFn: async () => {
      const start = `${month}-01`;
      // primer día del mes siguiente
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("movements")
        .select("category, amount")
        .eq("type", "expense")
        .eq("excluded", false)
        .gte("date", start)
        .lt("date", next);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        category: (r.category as string) ?? "Otro",
        amount: Number(r.amount) || 0,
      }));
    },
    enabled: !!user,
  });
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: sin errores nuevos en `budget-api.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/budget-api.ts
git commit -m "feat: budget-api hooks (useBudget, upsert, duplicate, month category spend)"
```

---

## Task 7: Pestañas en `/planning` y extracción de Inversión

**Files:**
- Create: `src/components/planning/InvestmentPlanning.tsx`
- Create: `src/components/planning/PlanningTabs.tsx`
- Modify: `src/routes/planning.tsx` (adelgazar a cabecera + pestañas; añadir `validateSearch` con `?tab`)

- [ ] **Step 1: Extract the current page body into `InvestmentPlanning`**

Mueve **todo** el cuerpo actual de `PlanningPage` (desde la creación de estado/hooks hasta el JSX interno de `<div className="mx-auto w-full max-w-6xl ...">` y los modales `PlanModal`/`ContributionModal`), junto con los componentes auxiliares `PlanCard`, `ContributionHistory`, `PlanModal`, `ContributionModal` y sus schemas (`planSchema`, `contributionSchema`, `AUTO_POSITION`) a un nuevo componente exportado `InvestmentPlanning` en `src/components/planning/InvestmentPlanning.tsx`. Conserva todos los imports que esos bloques usan (muévelos al nuevo fichero). `InvestmentPlanning` NO renderiza `<AppShell>` ni `<PageHeader>` (eso queda en la ruta); devuelve solo el contenido (el `<div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">...</div>` más los modales en un fragmento).

Firma:
```typescript
export function InvestmentPlanning() {
  // …exactamente la lógica y JSX actuales de PlanningPage, sin AppShell/PageHeader…
}
```

- [ ] **Step 2: Create the tabs component**

```tsx
// src/components/planning/PlanningTabs.tsx
import { InvestmentPlanning } from "./InvestmentPlanning";
import { ExpensePlanning } from "./ExpensePlanning";

export type PlanningTab = "inversion" | "gastos";

export function PlanningTabs({
  tab,
  onTabChange,
}: {
  tab: PlanningTab;
  onTabChange: (t: PlanningTab) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-8">
      <div className="flex gap-1 border-b border-border">
        {(["inversion", "gastos"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium transition ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "inversion" ? "Inversión" : "Gastos"}
          </button>
        ))}
      </div>
      <div className="pt-2">
        {tab === "inversion" ? <InvestmentPlanning /> : <ExpensePlanning />}
      </div>
    </div>
  );
}
```

> `ExpensePlanning` se crea en la Task 8. Si esta tarea se ejecuta antes, crea un stub mínimo `export function ExpensePlanning() { return null; }` en `src/components/planning/ExpensePlanning.tsx` para que compile; la Task 8 lo reemplaza.

- [ ] **Step 3: Slim down the route and add the `?tab` search param**

Reescribe `src/routes/planning.tsx` para que quede así (cabecera + pestañas controladas por la URL):

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader } from "@/components/app/SectionCard";
import { PlanningTabs, type PlanningTab } from "@/components/planning/PlanningTabs";

const searchSchema = z.object({
  tab: z.enum(["inversion", "gastos"]).optional(),
});

export const Route = createFileRoute("/planning")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Planificación — Wealth OS" },
      {
        name: "description",
        content:
          "Planifica tus inversiones (DCA, estructuras) y tus gastos mensuales (presupuesto, ahorro).",
      },
    ],
  }),
  component: PlanningPage,
});

function PlanningPage() {
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const active: PlanningTab = tab ?? "inversion";

  return (
    <AppShell pageEyebrow="Planificación">
      <PageHeader
        eyebrow="Planificación"
        title="Planificación"
        description="Organiza tus inversiones y tus gastos mensuales."
      />
      <PlanningTabs
        tab={active}
        onTabChange={(t) =>
          navigate({ to: "/planning", search: { tab: t }, replace: true })
        }
      />
    </AppShell>
  );
}
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; `/planning?tab=inversion` muestra todo lo anterior intacto.

- [ ] **Step 5: Commit**

```bash
git add src/routes/planning.tsx src/components/planning/InvestmentPlanning.tsx src/components/planning/PlanningTabs.tsx src/components/planning/ExpensePlanning.tsx
git commit -m "feat: split /planning into Inversión/Gastos tabs via ?tab search param"
```

---

## Task 8: Pestaña de Gastos — contenedor, mes, ingresos y objetivo

**Files:**
- Create/replace: `src/components/planning/ExpensePlanning.tsx`

- [ ] **Step 1: Implement the container with month selector, income and savings panels**

```tsx
// src/components/planning/ExpensePlanning.tsx
import { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useBudget,
  useUpsertBudget,
  useMonthCategorySpend,
} from "@/lib/budget-api";
import {
  totalIncome,
  availableForExpenses,
  plannedSavings,
  savingsGap,
  groupActuals,
  type IncomeItem,
  type BudgetMap,
} from "@/lib/budget-calc";
import { euro, formatMonth } from "@/lib/dashboard-data";
import { BudgetTable } from "./BudgetTable";
import { AgentSuggestionPanel } from "./AgentSuggestionPanel";
import { DuplicatePreviousMonthButton } from "./DuplicatePreviousMonthButton";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const DEFAULT_INCOMES: IncomeItem[] = [
  { label: "Salario", amount: 0 },
  { label: "Otros ingresos", amount: 0 },
  { label: "Extraordinarios", amount: 0 },
];

export function ExpensePlanning() {
  const [month, setMonth] = useState<string>(currentMonth());
  const { data: budget } = useBudget(month);
  const { data: spend = [] } = useMonthCategorySpend(month);
  const upsert = useUpsertBudget();

  const [incomes, setIncomes] = useState<IncomeItem[]>(DEFAULT_INCOMES);
  const [savingsGoal, setSavingsGoal] = useState<number>(0);
  const [budgets, setBudgets] = useState<BudgetMap>({});

  // Cargar la fila del mes cuando llega / cambia el mes
  useEffect(() => {
    if (budget) {
      setIncomes(budget.incomes?.length ? budget.incomes : DEFAULT_INCOMES);
      setSavingsGoal(Number(budget.savings_goal) || 0);
      setBudgets(budget.budgets ?? {});
    } else {
      setIncomes(DEFAULT_INCOMES);
      setSavingsGoal(0);
      setBudgets({});
    }
  }, [budget, month]);

  const actuals = useMemo(() => groupActuals(spend), [spend]);

  const income = totalIncome(incomes);
  const available = availableForExpenses(incomes, savingsGoal);
  const planSavings = plannedSavings(incomes, budgets);
  const gap = savingsGap(incomes, budgets, savingsGoal);

  function save(next: {
    incomes?: IncomeItem[];
    savings_goal?: number;
    budgets?: BudgetMap;
  }) {
    upsert.mutate({
      month,
      incomes: next.incomes ?? incomes,
      savings_goal: next.savings_goal ?? savingsGoal,
      budgets: next.budgets ?? budgets,
    });
  }

  function updateIncome(idx: number, patch: Partial<IncomeItem>) {
    const next = incomes.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setIncomes(next);
    save({ incomes: next });
  }
  function addIncome() {
    const next = [...incomes, { label: "Ingreso", amount: 0 }];
    setIncomes(next);
    save({ incomes: next });
  }
  function removeIncome(idx: number) {
    const next = incomes.filter((_, i) => i !== idx);
    setIncomes(next);
    save({ incomes: next });
  }

  function updateBudget(groupKey: string, amount: number) {
    const next = { ...budgets, [groupKey]: amount };
    setBudgets(next);
    save({ budgets: next });
  }

  function updateGoal(value: number) {
    setSavingsGoal(value);
    save({ savings_goal: value });
  }

  return (
    <div className="space-y-6 py-4">
      {/* Selector de mes */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] text-center text-[14px] font-semibold capitalize">
            {formatMonth(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <DuplicatePreviousMonthButton month={month} hasData={!!budget} />
      </div>

      {/* Ingresos previstos */}
      <SectionCard title="Ingresos previstos" description="Lo que esperas ingresar este mes.">
        <div className="space-y-2">
          {incomes.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={it.label}
                onChange={(e) => updateIncome(idx, { label: e.target.value })}
                className="text-[13px]"
              />
              <Input
                type="number"
                step="1"
                value={it.amount}
                onChange={(e) => updateIncome(idx, { amount: Number(e.target.value) || 0 })}
                className="w-32 text-right text-[13px]"
              />
              <button
                type="button"
                onClick={() => removeIncome(idx)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-red-500"
                aria-label="Quitar ingreso"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addIncome}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Añadir ingreso
          </button>
          <div className="flex justify-between border-t border-border pt-2 text-[13px] font-semibold">
            <span>Total ingresos</span>
            <span>{euro.format(income)}</span>
          </div>
        </div>
      </SectionCard>

      {/* Objetivo de ahorro + cuadre */}
      <SectionCard title="Objetivo de ahorro" description="Cuánto quieres ahorrar este mes.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[12px]">Objetivo (€)</Label>
            <Input
              type="number"
              step="1"
              value={savingsGoal}
              onChange={(e) => updateGoal(Number(e.target.value) || 0)}
              className="text-[13px]"
            />
          </div>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[12px] space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Disponible para gastos</span>
              <span className="font-medium">{euro.format(available)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ahorro planificado</span>
              <span className="font-medium">{euro.format(planSavings)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Objetivo</span>
              <span className="font-medium">{euro.format(savingsGoal)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <span className="text-muted-foreground">
                {gap < 0 ? "Déficit" : "Holgura"}
              </span>
              <span
                className={`font-semibold ${gap < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}
              >
                {gap < 0 ? "" : "+"}
                {euro.format(gap)}
              </span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Presupuesto por grupo */}
      <BudgetTable budgets={budgets} actuals={actuals} onChange={updateBudget} />

      {/* Sugerencias del agente */}
      <AgentSuggestionPanel
        month={month}
        incomes={incomes}
        savingsGoal={savingsGoal}
        budgets={budgets}
        actuals={actuals}
      />
    </div>
  );
}
```

> Esta tarea referencia `BudgetTable`, `AgentSuggestionPanel` y `DuplicatePreviousMonthButton`, que se crean en las Tasks 9 y 10. Si aún no existen, crea stubs mínimos para compilar:
> - `src/components/planning/BudgetTable.tsx`: `export function BudgetTable(_: { budgets: Record<string,number>; actuals: Record<string,number>; onChange: (k: string, v: number) => void }) { return null; }`
> - `src/components/planning/AgentSuggestionPanel.tsx`: `export function AgentSuggestionPanel(_: Record<string, unknown>) { return null; }`
> - `src/components/planning/DuplicatePreviousMonthButton.tsx`: `export function DuplicatePreviousMonthButton(_: { month: string; hasData: boolean }) { return null; }`
> Las Tasks 9 y 10 los reemplazan con la implementación real.

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; `/planning?tab=gastos` muestra mes, ingresos y objetivo con cuadre en vivo.

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/ExpensePlanning.tsx src/components/planning/BudgetTable.tsx src/components/planning/AgentSuggestionPanel.tsx src/components/planning/DuplicatePreviousMonthButton.tsx
git commit -m "feat: expense planning tab (month selector, incomes, savings goal reconciliation)"
```

---

## Task 9: Tabla de presupuesto por grupo

**Files:**
- Create/replace: `src/components/planning/BudgetTable.tsx`

- [ ] **Step 1: Implement `BudgetTable`**

```tsx
// src/components/planning/BudgetTable.tsx
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { BUDGET_GROUPS } from "@/lib/budget-groups";
import { budgetStatus, totalBudgeted, type BudgetMap } from "@/lib/budget-calc";
import { euro } from "@/lib/dashboard-data";

export function BudgetTable({
  budgets,
  actuals,
  onChange,
}: {
  budgets: BudgetMap;
  actuals: BudgetMap;
  onChange: (groupKey: string, amount: number) => void;
}) {
  const totalPlanned = totalBudgeted(budgets);
  const totalActual = totalBudgeted(actuals);

  return (
    <SectionCard
      title="Presupuesto por categoría"
      description="Cuánto quieres gastar en cada grupo y cómo vas frente a lo real."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Grupo</th>
              <th className="pb-2 pr-4 text-right font-medium">Presupuesto</th>
              <th className="pb-2 pr-4 text-right font-medium">Gastado</th>
              <th className="pb-2 pr-4 font-medium">Consumido</th>
              <th className="pb-2 pr-4 text-right font-medium">Restante</th>
              <th className="pb-2 text-right font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {BUDGET_GROUPS.map((g) => {
              const planned = budgets[g.key] ?? 0;
              const actual = actuals[g.key] ?? 0;
              const { pct, remaining, over } = budgetStatus(planned, actual);
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
                          className={`h-full ${over ? "bg-red-500" : "bg-primary"}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {planned > 0 ? `${Math.round(pct * 100)}%` : "—"}
                      </span>
                    </div>
                  </td>
                  <td
                    className={`py-2 pr-4 text-right ${remaining < 0 ? "text-red-500" : ""}`}
                  >
                    {euro.format(remaining)}
                  </td>
                  <td className="py-2 text-right">
                    {planned === 0 ? (
                      <span className="text-muted-foreground">Sin presupuesto</span>
                    ) : over ? (
                      <span className="text-red-500">Te pasas</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">Vas bien</span>
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
              <td className="py-2 pr-4 text-right">{euro.format(totalPlanned - totalActual)}</td>
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
Expected: compila; la tabla muestra 7 grupos editables con barra, restante y estado.

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/BudgetTable.tsx
git commit -m "feat: budget table by group (planned vs actual, progress, status)"
```

---

## Task 10: Sugerencias del agente y duplicar mes anterior

**Files:**
- Create/replace: `src/components/planning/AgentSuggestionPanel.tsx`
- Create/replace: `src/components/planning/DuplicatePreviousMonthButton.tsx`

- [ ] **Step 1: Implement `AgentSuggestionPanel`**

```tsx
// src/components/planning/AgentSuggestionPanel.tsx
import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { useAuth } from "@/hooks/use-auth";
import { openAgentStream } from "@/lib/agent-ws";
import { buildBudgetSuggestionPrompt } from "@/lib/budget-suggestion";
import type { BudgetMap, IncomeItem } from "@/lib/budget-calc";

export function AgentSuggestionPanel({
  month,
  incomes,
  savingsGoal,
  budgets,
  actuals,
}: {
  month: string;
  incomes: IncomeItem[];
  savingsGoal: number;
  budgets: BudgetMap;
  actuals: BudgetMap;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
  const [error, setError] = useState("");
  const closeRef = useRef<(() => void) | null>(null);

  function ask() {
    if (!user?.id) return;
    setText("");
    setError("");
    setStatus("streaming");
    const prompt = buildBudgetSuggestionPrompt({ month, incomes, savingsGoal, budgets, actuals });
    closeRef.current = openAgentStream(user.id, prompt, [], {
      onToken: (t) => setText((prev) => prev + t),
      onDone: () => setStatus("idle"),
      onError: (e) => {
        setError(e);
        setStatus("error");
      },
    });
  }

  return (
    <SectionCard
      title="Sugerencias del agente"
      description="Pide al Wealth Agent cómo cuadrar gastos y ahorro este mes."
    >
      <button
        type="button"
        onClick={ask}
        disabled={status === "streaming"}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {status === "streaming" ? "Pensando…" : "Pedir sugerencias al agente"}
      </button>

      {status === "error" && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">{error}</p>
      )}
      {text && (
        <div className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2.5 text-[12.5px] leading-relaxed">
          {text}
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 2: Implement `DuplicatePreviousMonthButton`**

```tsx
// src/components/planning/DuplicatePreviousMonthButton.tsx
import { useState } from "react";
import { Copy } from "lucide-react";
import { useDuplicateBudget } from "@/lib/budget-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DuplicatePreviousMonthButton({
  month,
  hasData,
}: {
  month: string;
  hasData: boolean;
}) {
  const duplicate = useDuplicateBudget();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    try {
      await duplicate.mutateAsync({ from: shiftMonth(month, -1), to: month });
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo duplicar.");
    }
  }

  function onClick() {
    if (hasData) {
      setConfirmOpen(true);
    } else {
      void run();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={duplicate.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        <Copy className="h-3.5 w-3.5" />
        Duplicar mes anterior
      </button>
      {error && !confirmOpen && <span className="ml-2 text-[11px] text-red-500">{error}</span>}

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Sobrescribir planificación</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Este mes ya tiene una planificación. ¿Reemplazarla con la del mes anterior?
          </p>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-md border border-border px-4 py-2 text-[12.5px] hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={duplicate.isPending}
              className="rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Reemplazar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: compila; el botón de sugerencias streamea o muestra "agente no disponible"; duplicar pide confirmación si hay datos.

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/AgentSuggestionPanel.tsx src/components/planning/DuplicatePreviousMonthButton.tsx
git commit -m "feat: agent suggestion panel and duplicate-previous-month button"
```

---

## Cierre

- [ ] **Despliegue (controlador):** aplicar la migración con `npx supabase db push` (o `migration up`) sobre el proyecto `pqfixpcbupdslrdfealq`, verificar que `monthly_budgets` existe con RLS.
- [ ] **Verificación E2E manual:** seguir la sección 9 del spec (`docs/superpowers/specs/2026-06-14-expense-planning-design.md`).
- [ ] **Revisión final de código** del conjunto antes de cerrar la rama.

---

## Notas de revisión (self-review)

- **Cobertura del spec:** §1 grupos→Task 1; §2 tabla→Task 4; §3 cálculo→Task 2; §4 prompt→Task 3; §5 agent-ws→Task 5; §6 hooks→Task 6; §7 UI (pestañas→Task 7, contenedor/ingresos/objetivo→Task 8, tabla→Task 9, sugerencias/duplicar→Task 10); §8 tests→Tasks 1-3; §9 E2E→Cierre.
- **Consistencia de tipos:** `IncomeItem`/`BudgetMap`/`GroupStatus` se definen en `budget-calc.ts` (Task 2) y se reutilizan en Tasks 3, 6, 8, 9, 10. `groupForCategory`/`BUDGET_GROUPS` de Task 1 se usan en Tasks 2 y 9. `openAgentStream` (Task 5) se usa en Task 10. Hooks de Task 6 se usan en Tasks 8 y 10.
- **Orden de dependencias:** Tasks 1→2→3 (puros) antes de 6/8/9/10. Task 5 independiente. Task 7 crea stub de `ExpensePlanning`; Task 8 crea stubs de `BudgetTable`/`AgentSuggestionPanel`/`DuplicatePreviousMonthButton`; Tasks 9/10 los reemplazan. Si se ejecuta en orden 1→10 no hacen falta los stubs salvo el de `ExpensePlanning` en Task 7 (que se reemplaza en Task 8).
