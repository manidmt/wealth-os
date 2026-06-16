# Mejoras de planificación de gastos — Design

**Date:** 2026-06-14
**Scope:** Empaquetar 5 mejoras sobre la planificación de gastos ya desplegada: (1) mostrar también el presupuesto del mes en Resumen y Gastos; (2) proyección a fin de mes + semáforo; (3) autorrellenar presupuesto desde la mediana de 6 meses; (4) reconciliar y visualizar el reparto ahorro→inversión; (5) sugerencia del agente aplicable de un clic.
**Out of scope:** crear aportaciones (plan_contributions) automáticamente; modificar el servicio Python del agente; planificación anual; las "cosas chulas" generales (backlog en engram, obs 271).

## Decisiones (aprobadas)
- Mejora 4: **reconciliar y visualizar** (reparto editable guardado en el presupuesto; NO crea aportaciones).
- Mejora 5: **ambos** — la propuesta base es el cálculo local; si el agente devuelve un JSON válido, ese prevalece.
- Mejora 3: **mediana de 6 meses**, redondeo a 5€.
- Mejora 1: "mostrar también" (no se quita nada de `/planning`).
- Mejora 2 semáforo: `over` si el real ya superó el presupuesto; `warning` si la proyección lo superará pero el real aún no; `ok` en el resto. Solo se proyecta en el mes en curso.

---

## 1. Base de datos — `supabase/migrations/20260614160000_budget_allocations.sql`

```sql
alter table public.monthly_budgets
  add column if not exists allocations jsonb not null default '{}'::jsonb;
```

`allocations`: reparto del ahorro planificado por destino. Claves = id de plan de inversión, más las claves especiales `"__polvora__"` (pólvora) y todo lo no repartido es "sin asignar" (derivado, no se guarda). Ej: `{ "<planId>": 200, "__polvora__": 70 }`.

---

## 2. Proyección y semáforo — `src/lib/budget-projection.ts` (puro, testeable)

```typescript
export type BudgetAlert = "ok" | "warning" | "over";

/** Extrapola el gasto a fin de mes de forma lineal por días transcurridos.
 *  Si `monthIsCurrent` es false (mes pasado), la proyección es el propio actual. */
export function projectMonthEnd(actual: number, now: Date, monthIsCurrent: boolean): number;
//  current: actual / díaDelMes * díasDelMes ; pasado: actual

export function budgetAlert(budget: number, actual: number, projected: number): BudgetAlert;
//  budget<=0 -> "ok"; actual>budget -> "over"; projected>budget -> "warning"; else "ok"
```

`projectMonthEnd` toma `now` como parámetro para poder testear. `monthIsCurrent` lo calcula el llamante comparando el mes del presupuesto con el mes de `now`.

---

## 3. Mediana histórica — `src/lib/budget-history.ts` (puro, testeable)

```typescript
import type { BudgetMap } from "./budget-calc";

export function median(values: number[]): number; // [] -> 0
export function roundTo5(n: number): number;       // redondeo al múltiplo de 5 más cercano

/** Mediana del gasto real por grupo a lo largo de los meses dados, redondeada a 5€.
 *  movsConMes: filas con { month: 'YYYY-MM', category, amount }. Se agrupa por mes y
 *  grupo (groupForCategory); por cada grupo se toma la mediana sobre los meses presentes. */
export function medianByGroup(
  movsConMes: { month: string; category: string; amount: number }[],
): BudgetMap;
```

Para cada grupo se construye la serie de totales mensuales (un valor por mes con gasto en ese grupo) y se toma la mediana, luego `roundTo5`. Un mes atípico (un viaje puntual) no dispara el presupuesto.

---

## 4. Sugerencia: recorte local + parser del agente — `src/lib/budget-suggest.ts` (puro, testeable)

```typescript
import { BUDGET_GROUPS } from "./budget-groups";
import type { BudgetMap } from "./budget-calc";

/** Propuesta de presupuesto recortado para cerrar un déficit `deficit` (>0 = hay que recortar).
 *  Reparte el recorte priorizando grupos donde el real supera lo presupuestado (over) y, tras
 *  ellos, proporcionalmente al presupuesto de cada grupo. Nunca deja un grupo por debajo de su
 *  gasto real (no se puede "des-gastar") ni en negativo. Devuelve el nuevo BudgetMap. */
export function suggestBudgetCuts(budgets: BudgetMap, actuals: BudgetMap, deficit: number): BudgetMap;

/** Extrae el primer bloque ```json ... ``` del texto del agente y devuelve un BudgetMap solo con
 *  las claves válidas (de validKeys) y valores numéricos >= 0. null si no hay JSON parseable. */
export function parseAgentBudgetJson(text: string, validKeys: string[]): BudgetMap | null;
```

`suggestBudgetCuts`: si `deficit <= 0` devuelve `budgets` sin cambios. El recorte respeta el suelo del gasto real ya hecho por grupo. `validKeys` = las claves de `BUDGET_GROUPS`.

---

## 5. Prompt del agente — extensión de `src/lib/budget-suggestion.ts`

`buildBudgetSuggestionPrompt` añade al final una instrucción para que el agente devuelva, tras su explicación, un bloque ```json con el presupuesto propuesto por grupo usando las CLAVES de grupo (`comida`, `ocio`, …) y números enteros. Test: el prompt contiene la palabra `json` y la lista de claves de grupo válidas.

---

## 6. API / hooks — `src/lib/budget-api.ts`

- `MonthlyBudget` gana `allocations: BudgetMap` (mapa destino→€). `useBudget` lo lee (default `{}`). `useUpsertBudget` acepta `allocations`.
- Nuevo `useHistoricalCategorySpend(months: number)`: consulta `movements` (`type='expense'`, `excluded=false`) de los últimos `months` meses naturales completos anteriores al actual, devuelve `{ month, category, amount }[]`. (Igual filtro que `useMonthCategorySpend`, pero rango multi-mes y con `month` derivado de `date.slice(0,7)`.)

---

## 7. Componentes

### 7.1 `BudgetSummaryCard` (reutilizable) — `src/components/planning/BudgetSummaryCard.tsx`
Lee `useBudget(mesActual)` + `useMonthCategorySpend(mesActual)`. Por grupo con presupuesto > 0: nombre, barra de progreso coloreada por `budgetAlert`, `gastado / presupuesto`, y proyección a fin de mes. Pie con total y aviso global ("a este ritmo cerrarás en X€ vs Y€"). Si no hay presupuesto del mes → estado vacío sutil con enlace a `/planning?tab=gastos` ("Define tu presupuesto del mes"). Sin emojis. Acepta prop opcional `title` (default "Presupuesto del mes").
- Se monta en **`src/routes/index.tsx`** (Resumen) y **`src/routes/expenses.tsx`** (Gastos), sin retirar contenido existente.

### 7.2 `BudgetTable` (extensión) — `src/components/planning/BudgetTable.tsx`
Añade columna/indicador de **proyección a fin de mes** y colorea el estado según `budgetAlert` (ok/warning/over) en lugar del booleano `over` actual. Mantiene inputs editables, restante y totales.

### 7.3 `SavingsAllocationPanel` — `src/components/planning/SavingsAllocationPanel.tsx`
En la pestaña Gastos. Lee `useInvestmentPlans()` (de `planning-api`). Destinos = planes activos + `__polvora__`. Precarga (si `allocations` vacío) con la aportación prevista de cada plan en el mes: para planes de estrategia `effectiveQuota(toEnginePlan(plan), signals)`, para el resto `computePlannedAmount(plan, monthlyFinancials, mes)`. Inputs editables por destino. Muestra: objetivo de ahorro, suma asignada, **sin asignar** (= objetivo − suma; puede ser negativo → aviso de descuadre). Guarda en `allocations` vía `useUpsertBudget`. NO crea aportaciones.

### 7.4 `AgentSuggestionPanel` (extensión) — `src/components/planning/AgentSuggestionPanel.tsx`
- Recibe además `onApply(budgets: BudgetMap)` y los `budgets`/`actuals` actuales.
- Propuesta base local: `suggestBudgetCuts(budgets, actuals, max(0, -gap))` (gap = `savingsGap`). Botón **"Aplicar sugerencia"** → `onApply(propuesta)`.
- Al recibir texto del agente, intenta `parseAgentBudgetJson(text, clavesGrupo)`; si devuelve un mapa válido, ese **prevalece** como propuesta a aplicar (se fusiona sobre el presupuesto actual). El bloque JSON no se muestra crudo: se oculta del texto visible.
- Si el agente no responde, el botón "Aplicar" sigue disponible con la propuesta local.

### 7.5 `ExpensePlanning` (extensión) — `src/components/planning/ExpensePlanning.tsx`
- Botón **"Rellenar con mi histórico (mediana 6m)"**: `medianByGroup(useHistoricalCategorySpend(6))` → `setBudgets(propuesta)` + autosave. Coloca junto a "Duplicar mes anterior".
- Monta `SavingsAllocationPanel` (tras el objetivo de ahorro) y pasa `onApply` a `AgentSuggestionPanel` (que hace `setBudgets(...)` + autosave).

---

## 8. Flujo de datos
`monthly_budgets` (incl. `allocations`) ← ExpensePlanning (edición/autorrelleno/aplicar/reparto). `BudgetSummaryCard` y `BudgetTable` solo leen presupuesto + gasto real del mes y derivan proyección/alerta. `SavingsAllocationPanel` lee planes de inversión (solo lectura) y escribe `allocations`.

## 9. Tests (Vitest, módulos puros)
- `budget-projection`: `projectMonthEnd` (día 1 del mes, mitad de mes, mes pasado=actual), `budgetAlert` (ok/warning/over y budget=0).
- `budget-history`: `median` (par/impar, vacío), `roundTo5`, `medianByGroup` (outlier no infla; agrupa categorías; redondeo).
- `budget-suggest`: `suggestBudgetCuts` (deficit<=0 sin cambios; cuadra el déficit; respeta suelo del real; sin negativos), `parseAgentBudgetJson` (JSON válido; ausente→null; claves inválidas filtradas; valores no numéricos descartados).
- `budget-suggestion`: el prompt pide el bloque `json` con claves de grupo.

No se testean componentes React ni I/O con Vitest (verificación manual E2E).

## 10. E2E / verificación manual
- Resumen y Gastos muestran la tarjeta de presupuesto del mes con barras y semáforo; sin presupuesto → CTA a /planning.
- A mitad de mes, un grupo con gasto alto muestra proyección > presupuesto y color warning/over.
- "Rellenar con histórico" propone valores razonables (mediana, no media) y se pueden retocar.
- El reparto ahorro→inversión precarga desde los planes, es editable y avisa si la suma no cuadra con el objetivo.
- "Pedir sugerencias" + "Aplicar": ajusta el presupuesto; si el agente devuelve JSON, prevalece; si no responde, aplica el recorte local.

## 11. Riesgos
- Proyección lineal: ruidosa a principios de mes (pocos días) → es una estimación, se etiqueta como tal.
- JSON del agente: el modelo podría no devolver JSON o devolverlo mal formado → `parseAgentBudgetJson` degrada a la propuesta local.
- Precarga del reparto depende de `computePlannedAmount`/`effectiveQuota` ya existentes; si un plan no tiene aportación prevista clara, su precarga es 0 (editable).
- Añadir la tarjeta a Resumen/Gastos no debe descuadrar layouts existentes (montaje aditivo, en su propia `SectionCard`).
