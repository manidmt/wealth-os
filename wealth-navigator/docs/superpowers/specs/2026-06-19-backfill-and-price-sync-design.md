# Backfill de aportaciones + Actualizar precios — Diseño

**Fecha:** 2026-06-19
**Estado:** aprobado, listo para plan de implementación

## Objetivo

Dos features independientes en wealth-navigator, en un mismo spec por cercanía de dominio (seguimiento de inversión):

1. **Backfill de aportaciones**: poder cargar en lote aportaciones pasadas de un plan (mes, importe, precio) para que aparezcan en su log (planificado vs real, precio medio), **sin sumarlas al portfolio**.
2. **Actualizar precios**: un botón que actualiza el precio de las posiciones cotizadas (acciones/ETFs/cripto) que no se han actualizado hoy, vía Yahoo Finance, **convirtiendo a EUR**.

## Contexto actual

- `plan_contributions` (tabla): `plan_id, date (YYYY-MM-01), planned_amount, actual_amount, price, units, multiplier, signal_note`. Hook `useUpsertContribution` hace upsert con `onConflict: "plan_id,date"`.
- `ContributionModal` (en `InvestmentPlanning.tsx`): registra una aportación de un mes; **hoy sincroniza con la posición del portfolio siempre que haya precio** (`syncPosition.mutate` cuando `values.price > 0`), vía `useSyncContributionToPosition` (suma unidades, recalcula precio medio).
- Logs por plan: `ContributionLog` (estrategias) y `ContributionHistory` (DCA, dentro de `InvestmentPlanning.tsx`).
- `portfolio_positions`: `current_price`, `currency`, `ticker`, `isin`, `asset_type`, `quantity`, `avg_cost`, `updated_at` (trigger `set_updated_at` ya re-asentado). La app trata `current_price`/`avg_cost` **como EUR** (`rowToPosition` usa `rateToEur = 1` hardcoded; no hay servicio FX).
- Edge Functions (Deno) en `supabase/functions/`; `signals-sync` ya hace fetch a Yahoo (`query1.finance.yahoo.com/v8/finance/chart/{symbol}` → último cierre) con `_shared/cors.ts`.
- `sonner` disponible para toasts (`Toaster` montado en `__root.tsx`).

## Regla transversal (clave)

**Una aportación alimenta la posición del portfolio SOLO si su mes es el mes actual.**

Módulo puro `src/lib/contribution-sync-rule.ts`:
```ts
export function feedsPortfolio(month: string, now: Date = new Date()): boolean {
  return month === now.toISOString().slice(0, 7);
}
```
Lo usan **ambos** caminos: el modal existente y el backfill. Esto evita doble conteo: el portfolio ya refleja el estado actual; las aportaciones pasadas solo rellenan el histórico.

---

## Parte A — Backfill de aportaciones

### A.1 Módulo puro `src/lib/backfill-contributions.ts` (testeable)

```ts
export type BackfillRow = { month: string; amount: string; price: string };

export type BuiltContribution = {
  month: string;        // YYYY-MM
  date: string;         // YYYY-MM-01
  amount: number;
  price: number;
  units: number;        // amount / price
};

/** Fila vacía para inicializar el editor. */
export function emptyRow(): BackfillRow;

/** Valida una fila: month con formato YYYY-MM, amount>0, price>0. */
export function isValidRow(row: BackfillRow): boolean;

/** Convierte filas válidas en contribuciones construidas (ignora inválidas). */
export function buildContributions(rows: BackfillRow[]): BuiltContribution[];
```

- `month` válido: `/^\d{4}-(0[1-9]|1[0-2])$/`.
- `amount`/`price` se parsean con coma→punto; deben ser > 0.
- `units = amount / price`; `date = month + "-01"`.

### A.2 Componente `src/components/planning/BackfillContributions.tsx`

Bloque plegable "Añadir aportaciones" dentro del log de un plan. Props: `{ plan: InvestmentPlan }`.

- Estado: `rows: BackfillRow[]` (arranca con una fila vacía).
- UI: tabla con inputs por fila (`month` tipo `month`, `amount` number, `price` number), botón `✕` por fila (elimina), `+ añadir fila`, y `Guardar N aportaciones` (N = nº de filas válidas; deshabilitado si N=0 o mientras guarda).
- Al guardar, para cada `BuiltContribution`:
  1. `useUpsertContribution`: `{ plan_id, date, planned_amount, actual_amount: amount, price, units, multiplier: null }`. `planned_amount` = `computePlannedAmount(plan, monthlyFinancials, month)` (el componente recibe `monthlyFinancials` por prop desde el log, que ya lo tiene del padre; si el log no lo tiene a mano, se pasa `[]` y `planned_amount = computePlannedAmount(plan, [], month)`).
  2. Si `feedsPortfolio(month)` → `useSyncContributionToPosition().mutateAsync({ plan, amount, units })`. (En la práctica, filas pasadas no sincronizan.)
- Tras guardar todas: limpia las filas (vuelve a una fila vacía) y muestra toast `"N aportaciones guardadas"`. Las queries de contribuciones se invalidan por `useUpsertContribution` (ya invalida `["plan_contributions", plan_id]`); añadir invalidación de `["plan_contributions","all"]` para que el contexto de planificación y demás se refresquen.

`ContributionLog` y `ContributionHistory` renderizan `<BackfillContributions plan={plan} />` al final (pasando `monthlyFinancials` donde esté disponible).

### A.3 Ajuste del `ContributionModal` (regla de sincronización)

En `InvestmentPlanning.tsx`, `ContributionModal.onSubmit`: cambiar la condición de sync para que use la regla. Hoy:
```ts
if (values.price && values.price > 0) {
  syncPosition.mutate({ plan, amount, units });
}
```
Pasa a:
```ts
if (feedsPortfolio(month) && values.price && values.price > 0) {
  syncPosition.mutate({ plan, amount: values.actual_amount, units: values.actual_amount / values.price });
}
```
(`month` = `values.date.slice(0,7)`; se sigue exigiendo precio para poder calcular unidades.) La aportación se guarda igual en el log; solo cambia cuándo toca el portfolio.

---

## Parte B — Actualizar precios (a EUR)

### B.1 Edge Function `supabase/functions/prices-sync/index.ts` (Deno)

Patrón calcado de `signals-sync` (serve + `_shared/cors.ts` + `yahooLast`), pero **con RLS del usuario** (no service role): crea el cliente con la `SUPABASE_ANON_KEY` y reenvía el header `Authorization` de la petición, de modo que `select`/`update` solo afecten a las posiciones del usuario autenticado.

Flujo:
1. `OPTIONS` → CORS preflight.
2. Cliente Supabase con `global.headers.Authorization = req.headers Authorization`.
3. `select id, asset_name, ticker, currency, asset_type, updated_at from portfolio_positions where asset_type in ('stock','etf','crypto') and ticker is not null and ticker <> ''`. Filtrar en JS los que `updated_at::date < hoy` (`new Date(updated_at).toISOString().slice(0,10) < today`).
4. Para cada posición elegible:
   - `yahooQuote(ticker)` → `{ price, currency }` (extiende `yahooLast` para devolver también `result.meta.currency`).
   - Si `currency !== "EUR"`: `rate = fxToEur(currency)` (Yahoo `{currency}EUR=X` último cierre, cacheado por divisa en un `Map`); `eurPrice = price * rate`. Si EUR: `eurPrice = price`.
   - `update portfolio_positions set current_price = eurPrice where id = ...` (el trigger pone `updated_at`).
   - En error (fetch/símbolo/fx) → push a `skipped` con `{ name, reason }`, continúa.
5. Responde `{ updated: [{name, price}], skipped: [{name, reason}] }` con `corsHeaders`.

`yahooQuote(symbol)`:
```ts
async function yahooQuote(symbol: string): Promise<{ price: number; currency: string }> {
  const r = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description ?? "respuesta vacía");
  const closes = (result.indicators.quote[0].close as (number|null)[]).filter((c) => c != null);
  if (closes.length === 0) throw new Error("sin cierres");
  return { price: closes[closes.length - 1] as number, currency: result.meta?.currency ?? "EUR" };
}
```
`fxToEur(cur)` usa `yahooQuote(`${cur}EUR=X`).price`.

### B.2 Hook `src/lib/prices-api.ts`

```ts
export type PriceSyncResult = {
  updated: { name: string; price: number }[];
  skipped: { name: string; reason: string }[];
};
export function useSyncPrices(): UseMutationResult<PriceSyncResult, ...>;
```
- Llama `supabase.functions.invoke("prices-sync")` (incluye la sesión del usuario automáticamente).
- `onSuccess`: invalida `["portfolio-positions"]` y `["dashboard-snapshot"]`.

### B.3 Botón en la cabecera de `portfolio.tsx`

Junto a "Añadir posición": botón **"Actualizar precios"** (icono refresh). Al pulsar:
- `useSyncPrices().mutate()`; mientras, deshabilitado con spinner/"Actualizando…".
- En éxito, `toast` resumen: `"{updated.length} actualizadas"` + si hay omitidas, `", {skipped.length} omitidas"` (y un `toast` secundario o el detalle en el mismo con los nombres/razón si ≤ pocas).
- En error, `toast` de error.

---

## Alcance / fuera (YAGNI)
- El botón de precios no toca `fund`, `bond`, `broker_cash` ni `gold`/`other`.
- Sin histórico de precios, sin gráficas nuevas.
- El backfill no borra aportaciones; reescribe la del mismo mes (upsert por `plan_id,date`).
- No se añade servicio FX general a la app; la conversión a EUR vive solo en la Edge Function de precios.

## Testing
- **Vitest** `contribution-sync-rule.ts` (`feedsPortfolio`: mes actual true, otros false; con `now` inyectado).
- **Vitest** `backfill-contributions.ts` (`isValidRow`, `buildContributions`: unidades, date, filas inválidas ignoradas, coma→punto).
- La Edge Function `prices-sync` se verifica **manualmente** al desplegar (ticker real EUR y uno USD para comprobar la conversión); no hay infra de test de funciones.

## Estructura de archivos

**Nuevos:**
- `src/lib/contribution-sync-rule.ts` (+ test)
- `src/lib/backfill-contributions.ts` (+ test)
- `src/components/planning/BackfillContributions.tsx`
- `src/lib/prices-api.ts`
- `supabase/functions/prices-sync/index.ts`

**Modificados:**
- `src/components/planning/ContributionLog.tsx` (monta BackfillContributions)
- `src/components/planning/InvestmentPlanning.tsx` (ContributionHistory monta BackfillContributions; ContributionModal usa `feedsPortfolio`)
- `src/routes/portfolio.tsx` (botón "Actualizar precios")
