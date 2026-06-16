# Cosas chulas (recurrentes, reglas de categoría, FIRE, insights) — Design

**Date:** 2026-06-14
**Scope:** 4 mejoras independientes en wealth-navigator: (1) detección de gastos recurrentes/suscripciones; (2) reglas de categoría persistentes "concepto → categoría" en el import; (3) panel FIRE/independencia; (4) ampliar los insights del Resumen. Sin avisos por Telegram.
**Out of scope:** recategorizar el histórico en masa (las reglas aplican a imports futuros / re-sync), supuestos fiscales en FIRE, autodetección de traspasos.

## Decisiones (aprobadas)
- Recurrentes: tarjeta "Gastos fijos" en Gastos (con aviso de subida de precio) **y** alimentan el autorrelleno del presupuesto como suelo mínimo por grupo.
- Reglas de categoría: **la regla manda siempre** (orden: regla → MCC → LLM → "Sin categoría"). Se gestionan en Settings.
- FIRE: número = gasto anual objetivo × (1/SWR) (×25 al 4%); SWR y retorno esperado configurables; tarjeta en Resumen + panel editable en Patrimonio.
- Insights: ampliar `computeInsights`/`InsightsCard` con presupuesto y suscripciones (sin sección nueva).

---

## Feature 2 — Reglas de categoría persistentes

### Tabla — `supabase/migrations/20260614180000_category_rules.sql`
```sql
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

### Lógica pura — `supabase/functions/_shared/category-rules.ts` + re-export `src/lib/category-rules.ts`
```typescript
export type CategoryRule = { match_text: string; category: string };
/** Devuelve la categoría de la primera regla cuyo match_text (case-insensitive) esté
 *  contenido en description; null si ninguna casa. */
export function categoryFromRules(description: string, rules: CategoryRule[]): string | null;
```
`src/lib/category-rules.ts`: `export * from "../../supabase/functions/_shared/category-rules.ts";` (patrón de `strategy-engine.ts`). Test con Vitest sobre el re-export.

### Pipeline — `bank-callback`, `bank-sync`, `bank-sync-all`
En `enrichRows`, cargar `movement_category_rules` del usuario (como ya se cargan las de exclusión) y, tras `mapTransaction`, aplicar por fila ANTES del LLM: `const rc = categoryFromRules(r.description, catRules); if (rc) r.category = rc;`. Así la regla gana sobre el MCC y el LLM solo actúa sobre lo que siga `"Sin categoría"`. Redeploy de las 3 funciones.

### Hooks — `src/lib/movements-api.ts`
`useCategoryRules()`, `useCreateCategoryRule({ match_text, category })`, `useDeleteCategoryRule(id)`. Calcados de `useExclusionRules`/`useCreateExclusionRule`/`useDeleteExclusionRule`.

### UI — `src/routes/settings.tsx`
`CategoryRulesSection` (junto a `ExclusionRulesSection`): input de concepto + `Select` de categoría (de `EXPENSE_CATEGORIES` + `INCOME_CATEGORIES`) + botón crear; lista de reglas con borrar. Sin emojis.

---

## Feature 1 — Recurrentes / gastos fijos

### Lógica pura — `src/lib/recurring.ts`
```typescript
import { groupForCategory } from "./budget-groups";
import type { BudgetMap } from "./budget-calc";

export type RecurringExpense = {
  concept: string;        // descripción normalizada (clave)
  displayConcept: string; // descripción representativa (legible)
  category: string;
  group: string;
  monthlyAmount: number;  // mediana de las ocurrencias mensuales
  lastAmount: number;     // importe del mes más reciente
  priceIncreased: boolean;
  monthsSeen: number;
};

export function normalizeConcept(description: string): string;
// mayúsculas, sin dígitos ni puntuación, espacios colapsados, trim

export function detectRecurring(
  movs: { date: string; description: string; amount: number; category: string }[],
  opts?: { minMonths?: number; amountAbs?: number; amountPct?: number },
): RecurringExpense[];
// Agrupa por normalizeConcept; por concepto agrega el gasto de cada mes (un valor por mes);
// recurrente si aparece en >= minMonths meses distintos y los importes mensuales son
// consistentes (dentro de ±max(amountAbs, amountPct·mediana)). monthlyAmount = mediana,
// lastAmount = mes más reciente, priceIncreased = lastAmount supera la tolerancia sobre la
// mediana de los meses previos, category = la más frecuente del concepto, group = groupForCategory(category).
// Defaults: minMonths=3, amountAbs=2, amountPct=0.05.

export function recurringFloorByGroup(recurring: RecurringExpense[]): BudgetMap;
// suma monthlyAmount por grupo
```

### Hook — `src/lib/movements-api.ts`
`useRecentMovements(months: number)`: `movements` (`type='expense'`, `excluded=false`) de los últimos `months` meses → `{ date, description, amount, category }[]` (cast `(supabase as any)` por `excluded`).

### UI — `src/components/app/RecurringExpensesCard.tsx`, montada en `src/routes/expenses.tsx`
`useRecentMovements(6)` → `detectRecurring`. Tarjeta "Gastos fijos": total mensual estimado + lista (concepto, categoría, importe mensual, badge "subió X€" si `priceIncreased`). Estado vacío si no hay recurrentes.

### Integración con el autorrelleno — `src/components/planning/ExpensePlanning.tsx`
`autofillFromHistory` pasa a usar `max(mediana, sueloRecurrente)` por grupo: combina `medianByGroup(history)` con `recurringFloorByGroup(detectRecurring(recentMovs))`, tomando el mayor por clave. Así el presupuesto nunca queda por debajo de los fijos detectados.

---

## Feature 3 — Panel FIRE

### Tabla — `supabase/migrations/20260614190000_fire_settings.sql`
```sql
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

### Lógica pura — `src/lib/fire.ts`
```typescript
export function fireNumber(annualExpense: number, swrRate: number): number;
// swrRate>0 ? annualExpense/(swrRate/100) : 0   (×25 al 4%)
export function fireProgress(netWorth: number, fireNumber: number): number;
// fireNumber>0 ? clamp(netWorth/fireNumber, 0, 1) : 0
export function monthsToFire(
  netWorth: number, fireNumber: number, monthlySavings: number, expectedReturnPct: number,
): number | null;
// simula mensual: nw = nw*(1+r/1200) + monthlySavings; cuenta meses hasta nw>=fireNumber;
// null si no se alcanza en 1200 meses (100 años). 0 si ya alcanzado.
export function estimatedFireDate(now: Date, months: number): string; // 'YYYY-MM'
```

### Hooks — `src/lib/fire-api.ts`
`useFireSettings()` (fila del usuario o defaults), `useUpsertFireSettings()` (`onConflict: user_id`).

### Datos
`netWorth` y ahorro mensual real (media de `incomeTotal − expenseTotal` de los últimos 12 meses de `useDashboard().expenses.byMonth`).

### UI
- `src/components/app/FireCard.tsx` (compacta) en **Resumen** (`index.tsx`): número FIRE, % alcanzado (barra), fecha estimada. Si `annual_expense=0` → CTA "Configura tu objetivo" a Patrimonio.
- `src/components/app/FirePanel.tsx` (editable) en **Patrimonio** (`net-worth.tsx`): inputs de gasto anual objetivo, SWR (%) y retorno esperado (%), guardados con `useUpsertFireSettings`; muestra número FIRE, progreso, ahorro mensual usado y fecha estimada.

---

## Feature 4 — Ampliar insights

`src/components/assistant/InsightsCard.tsx` añade, tras los insights actuales de `computeInsights`, dos generados localmente (reusando los datos ya disponibles):
- **Presupuesto**: si algún grupo proyecta pasarse, "A este ritmo te pasas N€ del presupuesto de {grupo}". (Usa `useBudget(mesActual)` + `useMonthCategorySpend` + `projectMonthEnd`/`budgetAlert`.)
- **Suscripciones**: "Tienes {n} gastos fijos por {total}€/mes" y, si alguno subió, "{concepto} subió {X}€". (Usa `useRecentMovements(6)` + `detectRecurring`.)

Helper puro `src/lib/extra-insights.ts` con `budgetInsight(...)` y `recurringInsight(...)` que devuelven `Insight | null` (mismo tipo `Insight` de `assistant-mock`), testeables; la card los añade si no son null. Máximo 2 extra para no saturar.

---

## Tests (Vitest, módulos puros)
- `category-rules`: casa (substring case-insensitive), no casa → null, primera regla gana.
- `recurring`: `normalizeConcept` (quita dígitos/puntuación); `detectRecurring` (≥3 meses → recurrente, <3 → no; tolerancia de importe; `priceIncreased` cuando el último sube; category/group correctos); `recurringFloorByGroup` (suma por grupo).
- `fire`: `fireNumber` (×25 al 4%, swr 0 → 0), `fireProgress` (clamp 0..1), `monthsToFire` (alcanzable con/sin retorno; inalcanzable → null; ya alcanzado → 0), `estimatedFireDate`.
- `extra-insights`: `budgetInsight` (devuelve aviso cuando se proyecta exceso; null si todo ok), `recurringInsight` (cuenta y total; null si no hay recurrentes).

No se testean componentes React, hooks ni Edge Functions con Vitest (verificación E2E manual).

## E2E / verificación manual
- Crear una regla "NETFLIX → Suscripciones" en Settings; re-sync → los cargos de Netflix entran como Suscripciones aunque el MCC dijera otra cosa.
- La tarjeta "Gastos fijos" lista las suscripciones reales con su importe mensual; "Rellenar (mediana 6m)" nunca deja un grupo por debajo de sus fijos.
- Panel FIRE: fijar gasto anual 24.000€, SWR 4% → número 600.000€, progreso y fecha coherentes con el patrimonio y el ahorro real.
- El Resumen muestra hasta 2 insights extra (presupuesto/suscripciones) junto a los existentes.

## Riesgos
- Normalización de conceptos: bancos con descripciones muy variables pueden fragmentar un recurrente; los umbrales (≥3 meses, ±max(2€,5%)) son conservadores y la tarjeta es informativa.
- `monthsToFire` con ahorro ≤ 0 y patrimonio < objetivo puede no converger → null (se muestra "objetivo no alcanzable a este ritmo").
- 3 funciones de sync comparten `enrichRows` duplicado: aplicar el cambio de reglas de categoría en las tres y redeplegar.
- Tablas nuevas no tipadas en `types.ts` → usar cast `(supabase as any)` en los hooks (patrón ya usado).
