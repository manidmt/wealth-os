# Log de compras por posición (lotes) — Design

**Fecha:** 2026-08-10
**Repo:** monorepo `wealth-os` (`wealth-navigator/`)

## Problema

`portfolio_positions` solo guarda un agregado (`quantity`, `avg_cost`) por
posición. No existe ningún historial de compras individuales:

- Para las 12 posiciones manuales (Alphabet, MicroStrategy, MSCI Emerging,
  Bayer, Silver Miners, Fondo de Pensiones, Metaplanet, Brookfield ×2,
  StableC, Constellation Software, Microsoft, Quanterix) no hay ningún
  registro de compra — todas se crearon de golpe el 2026-05-15 con el
  agregado actual.
- Para las 3 posiciones vinculadas a un plan DCA (MSCI World → `RV Core`,
  Oro → `Oro (IGLN)`, Bitcoin → `Bitcoin (Criptan)`) sí existen aportaciones
  reales con fecha y precio en `plan_contributions`, pero solo son visibles
  (y no editables) desde Planning; el agregado en `portfolio_positions` se
  recalcula al vuelo en `portfolio-sync.ts` sin dejar rastro de cada compra.

Esto hace imposible corregir un precio mal introducido en una compra
concreta sin recalcular el coste medio a mano (como se hizo manualmente
para MSCI Emerging el 2026-08-09).

## Solución

Introducir una tabla de lotes de compra (`position_lots`) que sea la fuente
de la verdad para `quantity`/`avg_cost` de cualquier posición, con UI para
añadir, editar y borrar lotes individuales desde el panel de la posición en
Portfolio.

### Decisiones (aprobadas)

1. **Alcance:** aplica a las 15 posiciones del portfolio, no solo a las
   manuales. Para las 3 vinculadas a un plan, el lote se crea
   automáticamente al registrar la aportación en Planning; para el resto,
   se añade/edita el lote directamente en Portfolio.
2. **Backfill:** para las 3 posiciones con plan, se importa cada fila de
   `plan_contributions` con `price`/`units` no nulos como un lote real
   (fecha y precio reales); si la suma no cubre el 100% de la `quantity`
   actual, se añade un lote de ajuste "Saldo inicial" con la diferencia.
   Para las otras 12, un único lote "Saldo inicial" con `quantity`/`avg_cost`
   actuales, fechado en `created_at` de la posición.
3. **UI:** el log de lotes vive dentro del panel de la posición
   (`PositionSheet`/`PositionDrawer`), sustituyendo al modo actual
   "Añadir compra" (add-shares). Se muestra como tabla con fecha, cantidad,
   precio, importe, y editar/borrar por fila.
4. **Sync con DCA:** un lote que venga de una aportación de Planning queda
   vinculado a su fila de `plan_contributions` (`plan_contribution_id`).
   Editarlo desde Portfolio actualiza también `price`/`units`/
   `actual_amount` en `plan_contributions`, para que ambas vistas no
   diverjan nunca.
5. **Cálculo de agregados:** `portfolio_positions.quantity`/`avg_cost` dejan
   de mutarse directamente; se recalculan (suma de cantidades, coste medio
   ponderado) en la propia mutación de TypeScript cada vez que cambia un
   lote de esa posición — coherente con el resto del repo, que no usa
   triggers de Postgres en ningún sitio.
6. **Restricciones de integridad:** `quantity` y `price` de un lote deben
   ser `> 0` (no se modelan ventas/lotes negativos en esta feature). No se
   puede borrar el último lote restante de una posición ni editar uno de
   forma que la cantidad total resultante de la posición quede en `≤ 0`
   — una posición debe conservar siempre al menos un lote con cantidad
   positiva.

### Cambios

- **Nueva migración SQL:**
  - Tabla `position_lots` (`id`, `user_id`, `position_id` FK →
    `portfolio_positions`, `plan_contribution_id` FK nullable/único →
    `plan_contributions`, `date`, `quantity`, `price`, `notes`,
    `created_at`, `updated_at`), con RLS por `user_id` igual que el resto de
    tablas del proyecto.
  - Script de backfill (dentro de la misma migración o en una migración de
    datos aparte) que puebla `position_lots` para las 15 posiciones
    existentes según la regla del punto 2.

- **`src/lib/position-lots-api.ts` (nuevo):**
  - `usePositionLots(positionId)`: lee lotes de una posición, ordenados por
    fecha.
  - `useCreateLot()`, `useUpdateLot()`, `useDeleteLot()`: mutan
    `position_lots` y, en el mismo flujo, recalculan y persisten
    `quantity`/`avg_cost` en `portfolio_positions` (misma fórmula de coste
    medio ponderado ya usada hoy en `portfolio-sync.ts` /
    `PositionSheet.tsx`).
  - `useUpdateLot()` además: si el lote tiene `plan_contribution_id`,
    actualiza `price`, `units` (= `quantity` del lote) y `actual_amount`
    (= `quantity * price`) en la fila correspondiente de
    `plan_contributions`.

- **`src/lib/portfolio-sync.ts`:** `useSyncContributionToPosition` deja de
  escribir `quantity`/`avg_cost` a mano; en su lugar inserta un
  `position_lot` (con `plan_contribution_id` apuntando a la aportación
  recién creada) y delega el recálculo del agregado en la lógica común de
  `position-lots-api.ts`.

- **`src/components/app/PositionSheet.tsx`:**
  - El modo `add-shares` pasa a crear un lote (`useCreateLot`) en vez de
    llamar a `useUpdatePosition` con el agregado recalculado a mano.
  - Nueva tabla de lotes (fecha, cantidad, precio, importe) con acciones de
    editar/borrar por fila, visible en los modos `edit`/`add-shares`.

## Testing

- Tests unitarios para el cálculo de agregado (suma de cantidades, coste
  medio ponderado) en `position-lots-api.ts`, cubriendo: alta de lote,
  edición de lote (incluyendo el caso con `plan_contribution_id`), borrado
  de lote, y que borrar el único lote restante de una posición (o dejar la
  cantidad total en `≤ 0`) se rechaza con error.
- Test del backfill: dado un set de `plan_contributions` que no cubre el
  100% de la `quantity` de una posición, verificar que se genera el lote de
  ajuste correcto.
- Verificación manual en Portfolio: abrir una posición manual (MSCI
  Emerging), ver su lote de saldo inicial, editarlo, comprobar que el
  agregado de la posición cambia acorde. Abrir MSCI World, comprobar que
  aparecen los lotes reales importados de `plan_contributions`, editar uno
  y comprobar que el `ContributionLog` de Planning refleja el cambio.

## Fuera de alcance

- Cálculo de patrimonio histórico real por mes usando precios históricos
  (feature 2, se diseñará después, apoyándose en `position_lots`).
- Cambios en `planned_amount`, `multiplier` o `signal_note` de
  `plan_contributions` — siguen siendo exclusivos de Planning.
- Multi-divisa por lote: el lote hereda la divisa de la posición (no se
  añade un campo `currency` propio en `position_lots`).
