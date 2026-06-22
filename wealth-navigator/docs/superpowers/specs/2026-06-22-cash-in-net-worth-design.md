# Efectivo en el patrimonio + reconciliación — Diseño

**Fecha:** 2026-06-22
**Estado:** aprobado, listo para plan de implementación

## Problema

La gráfica "Distribución del patrimonio" (Resumen, `index.tsx`, `data.allocation`)
muestra **solo la cartera de inversión** (`portfolio_positions`, ~19k) pero se
titula patrimonio (~38-39k del `net_worth` de `monthly_snapshots`). El **efectivo
/ liquidez** (~19-20k = patrimonio − cartera) no está modelado ni se ve.

Además, `dashboard-data.ts` calcula la cartera con `quantity * current_price`
**sin `fx_to_eur`**, así que las posiciones en USD/CAD están infladas en la dona
del Resumen (inconsistente con la página de Portfolio, que sí aplica el cambio).

## Decisión (aprobada)

- **Efectivo derivado por defecto** (cero mantenimiento): `efectivo = patrimonio − cartera`.
- **Cuentas de efectivo opcionales** (BBVA, Trade Republic…) que el usuario edita
  cada ~2 meses como check. Si hay cuentas, **mandan** sobre el derivado.
- **Reconciliación manual**: se muestra efectivo-en-cuentas vs efectivo-derivado y
  el delta; si no cuadra, aviso suave. Sin reescritura automática de snapshots.
- En la dona, el efectivo es **un único bloque "Efectivo"** (el desglose por cuenta
  va en la sección de cuentas, no en la dona).
- Sección de cuentas en la página de **Patrimonio**.

## Modelo de datos

Tabla nueva `cash_accounts`:
```sql
create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  balance numeric not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- RLS owner: for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
```

## Lógica del efectivo — módulo puro `src/lib/cash.ts` (testeable)

```ts
export type CashAccount = { id: string; name: string; balance: number; updated_at: string };

export type CashResolution = {
  total: number;          // efectivo usado (cuentas si las hay, si no derivado)
  derived: number;        // patrimonio(snapshot) − cartera
  accountsTotal: number;  // suma de saldos de cuentas
  source: "accounts" | "derived";
  reconcileDelta: number; // accountsTotal − derived (0 si no hay cuentas)
  hasAccounts: boolean;
};

export function accountsTotal(accounts: { balance: number }[]): number;

export function resolveCash(input: {
  accounts: { balance: number }[];
  netWorthSnapshot: number; // patrimonio vivo basado en snapshot (antes de override)
  portfolioEur: number;     // cartera en EUR (con fx_to_eur)
}): CashResolution;
```

- `derived = netWorthSnapshot − portfolioEur`.
- `hasAccounts = accounts.length > 0`.
- `total = hasAccounts ? accountsTotal(accounts) : derived`.
- `reconcileDelta = hasAccounts ? accountsTotal − derived : 0`.

## Hooks — `src/lib/cash-api.ts`

`useCashAccounts()` (query `["cash_accounts"]`, ordenada por `created_at`),
`useUpsertCashAccount()` (insert si no hay id, update si lo hay; setea `updated_at`),
`useDeleteCashAccount()`. Todas invalidan `["cash_accounts"]` **y** `["dashboard-snapshot"]`
(para que la dona/KPI se refresquen). Patrón `(supabase as any)` como el resto.

## Cambios en `dashboard-data.ts`

1. **fx_to_eur**: en el bucle de portfolio, valorar cada posición como
   `Number(quantity) * Number(current_price) * (Number(fx_to_eur) || 1)`. Aplica a
   `totalPortfolio`, `byCategoryMap`, `byPlatformMap` y `holdings.value`. (El select
   ya es `*`, incluye `fx_to_eur`.)
2. **Fetch de cuentas**: en el `useQuery` (queryKey `["dashboard-snapshot"]`) añadir
   `(supabase as any).from("cash_accounts").select("id, name, balance, updated_at")`
   al `Promise.all`, y pasar `cashAccounts` a `computeDashboard`.
3. **`computeDashboard(movements, positions, snapshots, cashAccounts)`**: tras
   calcular el `liveNW` actual (basado en snapshot, sin tocar el resto), llamar
   `resolveCash({ accounts: cashAccounts, netWorthSnapshot: liveNW, portfolioEur: totalPortfolio })`.
   - Si `source === "accounts"` → el patrimonio vivo pasa a `finalNW = totalPortfolio + cash.total`;
     se reescribe la entrada viva del mes en curso (`assets`/`netWorth`) con `finalNW`.
   - Si `source === "derived"` → `finalNW = liveNW` (sin cambios).
4. **Allocation**: si `cash.total > 0`, añadir `{ label: "Efectivo", value: cash.total }`
   a `allocation` (y reordenar por valor). Así la dona suma el patrimonio total.
5. **Exponer** en `DashboardData` un campo `cash: CashResolution` para la reconciliación.

`DashboardData` gana `cash: CashResolution`.

## UI

### Dona (Resumen) — sin cambios de código
`index.tsx` ya hace `allocationTotal = data.allocation.reduce(...)` y
`<DonutChart data={data.allocation} total={allocationTotal} />`. Como `allocation`
ahora incluye "Efectivo", la dona muestra inversión por categoría + Efectivo y
suma el patrimonio. (Verificar que el color/leyenda del nuevo trozo se ve bien.)

### Sección "Cuentas de efectivo" — `src/components/app/CashAccountsCard.tsx`
Montada en `net-worth.tsx` (página de Patrimonio), tras la tabla de snapshots.

- **Lista** de cuentas (`useCashAccounts`): por fila, nombre + saldo editable
  (input number) + botón borrar. Editar saldo y confirmar (blur/Enter) →
  `useUpsertCashAccount`. Botón "Añadir cuenta" → fila nueva (nombre + saldo) →
  crear.
- **Reconciliación** (footer del card): muestra
  `Efectivo en cuentas: {accountsTotal}` vs `Derivado (patrimonio − cartera): {derived}`
  y el `Δ`. Si `|reconcileDelta| > max(50, 1% del derived)` y hay cuentas, aviso
  suave ("No cuadra con el snapshot; revisa saldos o el cierre"). Si no hay cuentas,
  texto: "Sin cuentas: se usa el efectivo derivado del último cierre."

## Alcance / fuera (YAGNI)
- No se reescriben snapshots automáticamente; la reconciliación es informativa +
  edición manual de saldos.
- Sin desglose por cuenta en la dona (un solo bloque "Efectivo").
- El histórico mensual (serie de snapshots) no se toca; solo el valor vivo del mes
  en curso pasa a `cartera + efectivo` cuando hay cuentas.

## Testing
- **Vitest `cash.ts`**: `accountsTotal`; `resolveCash` con/sin cuentas (derived vs
  accounts, reconcileDelta, source).
- **Vitest `dashboard-data` (si hay test):** opcional — fx aplicado a la cartera.
  (No hay tests de dashboard-data hoy; el fx se verifica manualmente comparando con
  la página de Portfolio.)
- Manual: con 0 cuentas, la dona muestra Efectivo = patrimonio − cartera y suma el
  KPI; al añadir cuentas, el efectivo y el KPI pasan a cartera + cuentas, y la
  reconciliación muestra el delta.

## Estructura de archivos

**Nuevos:**
- `src/lib/cash.ts` (+ `cash.test.ts`)
- `src/lib/cash-api.ts`
- `src/components/app/CashAccountsCard.tsx`
- `supabase/migrations/<ts>_cash_accounts.sql`

**Modificados:**
- `src/lib/dashboard-data.ts` (fx_to_eur, fetch cuentas, computeDashboard, allocation, cash en DashboardData)
- `src/routes/net-worth.tsx` (monta CashAccountsCard)
