# Planificación de gastos — Design

**Date:** 2026-06-14
**Scope:** Dividir la sección `/planning` en dos pestañas (Inversión / Gastos) y construir la **planificación mensual de gastos**: ingresos previstos, presupuesto por grupos de categorías, objetivo de ahorro con cuadre, seguimiento real vs planificado, sugerencias del Wealth Agent y duplicación del mes anterior.
**Out of scope:** planificación anual; presupuestar las 23 categorías una a una; modificar el servicio Python del agente; editar el mapa categoría→grupo desde la UI; autodetección de nada nuevo en la importación.

## Decisiones (aprobadas)
- Navegación: **pestañas dentro de `/planning`** (`?tab=inversion` | `?tab=gastos`, por defecto la última usada / inversión). El contenido actual se mueve íntegro a `<InvestmentPlanning>` sin cambios funcionales.
- Presupuesto por **7 grupos amplios** (no por las 23 categorías) con mapa `categoría→grupo`.
- Sugerencias: **conectar el Wealth Agent ya**, vía prompt compuesto en el frontend sobre el WS existente (sin tocar el Python), con degradación elegante si el WS no responde.
- La pestaña de Gastos opera sobre **un mes** (selector con flechas, por defecto el mes actual).

---

## 1. Grupos de presupuesto — `src/lib/budget-groups.ts` (puro, testeable)

7 grupos que cubren las 23 `EXPENSE_CATEGORIES` existentes:

| key | label | Categorías |
|---|---|---|
| `comida` | Comida | Comida, Café |
| `ocio` | Ocio | Ocio, Viaje, Comer fuera |
| `transporte` | Transporte | Transporte, Coche |
| `hogar` | Hogar | Hogar, Suscripciones, Impuestos, Gestiones |
| `salud` | Salud y bienestar | Salud, Gimnasio, Deporte, Cuidado personal, Higiene, Suplementos |
| `compras` | Compras | Ropa, Tecnología, Regalo |
| `otros` | Otros | Otro, Educación, Formación |

```typescript
export type BudgetGroup = { key: string; label: string; categories: string[] };
export const BUDGET_GROUPS: BudgetGroup[];
export function groupForCategory(category: string): string; // clave de grupo; fallback "otros"
```

Las 23 categorías quedan cubiertas (cada una en exactamente un grupo); cualquier categoría desconocida → `otros`.

---

## 2. Base de datos — `supabase/migrations/20260614120000_monthly_budgets.sql`

```sql
create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,                 -- 'YYYY-MM'
  incomes jsonb not null default '[]'::jsonb,   -- [{label, amount}]
  savings_goal numeric not null default 0,
  budgets jsonb not null default '{}'::jsonb,    -- { comida:330, ocio:200, ... } por group key
  created_at timestamptz not null default now(),
  unique(user_id, month)
);
alter table public.monthly_budgets enable row level security;
create policy "own budgets" on public.monthly_budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

jsonb para `incomes` y `budgets` sigue el patrón ya usado (`routine_logs.items`, `dry_powder`). Una fila por mes simplifica duplicar y editar.

---

## 3. Cálculo — `src/lib/budget-calc.ts` (puro, testeable)

```typescript
export type IncomeItem = { label: string; amount: number };
export type BudgetMap = Record<string, number>;       // group key -> €
export type GroupStatus = { pct: number; remaining: number; over: boolean };

export function totalIncome(incomes: IncomeItem[]): number;
export function totalBudgeted(budgets: BudgetMap): number;
export function groupActuals(
  movements: { category: string; amount: number }[],
): BudgetMap;                                          // suma por grupo vía groupForCategory
export function budgetStatus(planned: number, actual: number): GroupStatus;
// pct = planned>0 ? actual/planned : (actual>0?1:0); remaining = planned-actual; over = actual>planned
export function plannedSavings(incomes: IncomeItem[], budgets: BudgetMap): number;
// totalIncome - totalBudgeted
export function availableForExpenses(incomes: IncomeItem[], savingsGoal: number): number;
// totalIncome - savingsGoal
export function savingsGap(incomes: IncomeItem[], budgets: BudgetMap, goal: number): number;
// plannedSavings - goal  (negativo => déficit: hay que recortar |gap|)
export function actualSavingsSoFar(incomes: IncomeItem[], actuals: BudgetMap): number;
// totalIncome - sum(actuals)
```

`pct` se usa para la barra (se puede clampar a 1 en la UI; el valor real puede superar 1 para señalar exceso).

---

## 4. Prompt de sugerencias — `src/lib/budget-suggestion.ts` (puro, testeable)

```typescript
export function buildBudgetSuggestionPrompt(input: {
  month: string;
  incomes: IncomeItem[];
  savingsGoal: number;
  budgets: BudgetMap;        // planificado por grupo
  actuals: BudgetMap;        // gasto real por grupo
}): string;
```

Devuelve un mensaje en español para el agente que incluye: total de ingresos, objetivo de ahorro, ahorro planificado y el déficit/holgura, y por cada grupo `label: planificado X€ / real Y€`. Pide explícitamente sugerencias concretas de recorte por grupo para alcanzar el objetivo (p. ej. "Para ahorrar N€ tendrías que recortar M€; sugiere en qué grupos"). El parser de respuesta no es necesario: la respuesta es texto libre que se muestra en streaming.

---

## 5. Conexión con el agente — `src/lib/agent-ws.ts`

Extrae la lógica del WebSocket (hoy embebida en `routes/assistant.tsx`) a un helper reutilizable:

```typescript
export function openAgentStream(
  userId: string,
  message: string,
  handlers: { onToken: (t: string) => void; onDone: () => void; onError: (e: string) => void },
): () => void;   // devuelve un "close" para abortar
```

Usa `VITE_AGENT_WS_URL` (fallback `ws://localhost:8000`), abre `/ws/{userId}`, envía `{ message, history: [] }`, acumula `{token}`, cierra en `{done}` / `{error}`. Si la conexión falla o no abre en ~5s → `onError("El agente no está disponible ahora.")`. `routes/assistant.tsx` se refactoriza para usar este helper (sin cambiar su comportamiento).

---

## 6. API / hooks — `src/lib/budget-api.ts`

```typescript
export type MonthlyBudget = {
  id: string; user_id: string; month: string;
  incomes: IncomeItem[]; savings_goal: number; budgets: BudgetMap; created_at: string;
};
export function useBudget(month: string);            // fila del mes o null
export function useUpsertBudget();                   // upsert onConflict user_id,month
export function useDuplicateBudget();                // copia incomes/savings_goal/budgets de from→to
export function useMonthCategorySpend(month: string); // movements expense, excluded=false, del mes → [{category, amount}]
```

`useMonthCategorySpend` consulta `movements` (`type='expense'`, `excluded=false`, `date` en `[month-01, fin de mes]`) y devuelve filas `{category, amount}` (coerce `Number()` por PostgREST). Coincide con el filtro de exclusión del dashboard, así que nunca descuadra.

---

## 7. UI

`routes/planning.tsx` se reduce a: cabecera + `<PlanningTabs>` con dos paneles.

- **`src/components/planning/PlanningTabs.tsx`** — conmutador Inversión / Gastos; lee/escribe `?tab` en la URL (search param), por defecto `inversion`.
- **`src/components/planning/InvestmentPlanning.tsx`** — todo el cuerpo actual de `planning.tsx` movido tal cual (wizard, planes, rutina, proyección, log, señales). Sin cambios de comportamiento.
- **`src/components/planning/ExpensePlanning.tsx`** — contenedor de la pestaña Gastos. Selector de mes (‹ Junio 2026 ›, prev/next, por defecto el actual). Carga `useBudget(month)` y `useMonthCategorySpend(month)`. Estado de edición local que se persiste con `useUpsertBudget` (guardado al editar / con debounce o botón "Guardar"; ver plan). Contiene:
  - **`IncomePanel`** — lista editable de ingresos (por defecto Salario / Otros ingresos / Extraordinarios; se pueden añadir/quitar filas) + total.
  - **`SavingsGoalPanel`** — input de objetivo + tarjeta de cuadre: disponible para gastos (`availableForExpenses`), ahorro planificado (`plannedSavings`) vs objetivo, y badge de déficit (`savingsGap<0`) u holgura.
  - **`BudgetTable`** — 7 filas (los grupos): label · input de presupuesto · gasto real (de `groupActuals`) · barra de % consumido · restante · badge "te pasas" (over) / "vas bien". Fila de totales.
  - **`AgentSuggestionPanel`** — botón "Pedir sugerencias al agente": llama `openAgentStream` con `buildBudgetSuggestionPrompt(...)` y muestra el texto en streaming en una tarjeta. Estados: idle / streaming / error (agente no disponible). Sin emojis.
  - **`DuplicatePreviousMonthButton`** — "Duplicar plan del mes anterior": llama `useDuplicateBudget` (mes previo → mes actual); si el mes actual ya tiene datos, pide confirmación antes de sobrescribir.

Sin emojis en toda la UI nueva. Estilo y componentes (`SectionCard`, `Input`, `Select`, `Dialog`) como el resto de la app.

---

## 8. Testing (Vitest, módulos puros)
- **`budget-groups`**: cada una de las 23 categorías mapea al grupo esperado; categoría desconocida → `otros`; los grupos cubren las 23 sin solapes.
- **`budget-calc`**: `totalIncome`/`totalBudgeted`; `groupActuals` suma varias categorías al mismo grupo; `budgetStatus` (pct, remaining, over en el borde planned=actual y planned=0); `plannedSavings`; `availableForExpenses`; `savingsGap` (déficit y holgura); `actualSavingsSoFar`.
- **`budget-suggestion`**: el prompt incluye total de ingresos, objetivo, ahorro planificado/déficit y cada grupo con planificado vs real.

No se testean con Vitest los componentes React ni el WS (I/O); el helper `openAgentStream` se valida manualmente (E2E).

---

## 9. E2E / verificación manual
- `/planning` muestra dos pestañas; "Inversión" conserva todo lo actual; `?tab=gastos` abre la nueva.
- Definir ingresos (1.750€) + objetivo (300€) → la tarjeta de cuadre muestra disponible 1.450€ y, si el presupuesto planificado deja menos de 300€ de ahorro, marca déficit.
- El gasto real por grupo coincide con la suma de movimientos no excluidos del mes.
- "Pedir sugerencias al agente" streamea texto si el WS está levantado; si no, muestra "agente no disponible" sin romper la página.
- "Duplicar plan del mes anterior" copia ingresos/objetivo/presupuesto al mes actual.

## 10. Riesgos
- El WS del agente puede no estar levantado (vive en `/tmp`, efímero) → por eso degradación elegante; los números locales funcionan sin agente.
- Refactor de `assistant.tsx` para usar `agent-ws.ts`: hay que conservar exactamente el comportamiento de streaming/historial actual.
- Mapa categoría→grupo fijo: si en el futuro se añaden categorías nuevas en `EXPENSE_CATEGORIES`, caen a `otros` hasta que se actualice el mapa (aceptable).
