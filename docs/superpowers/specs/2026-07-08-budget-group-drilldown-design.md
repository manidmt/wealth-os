# Desglose de subcategorías en "Presupuesto del mes" — Design

**Fecha:** 2026-07-08
**Repo:** monorepo `wealth-os` (`wealth-navigator/`)

## Problema

La tarjeta "Presupuesto del mes" (`BudgetSummaryCard.tsx`, visible en el
Dashboard y en Planning → Gastos) muestra una barra de progreso por grupo de
gasto (Comida, Ocio, Transporte, Hogar, ...), pero no permite ver qué
subcategorías componen ese gasto. Para saber, por ejemplo, cuánto de "Hogar"
corresponde a Suscripciones frente a Impuestos, hay que ir a la tabla detallada
de `/planning` (`BudgetTable.tsx`), que sí tiene ese desglose.

## Solución

Añadir a `BudgetSummaryCard` el mismo mecanismo de expandir/colapsar que ya
existe en `BudgetTable.tsx`: al pinchar en un grupo, se despliega debajo la
lista de sus subcategorías con el gasto real de cada una este mes.

### Decisiones (aprobadas)

1. **Estado de expansión por grupo:** `Set<string>` con las claves de grupo
   abiertas. Cada grupo se expande/colapsa de forma independiente — no es
   acordeón, pueden estar varios abiertos a la vez.
2. **Contenido del desglose:** solo nombre de la subcategoría + importe
   gastado este mes (`euro.format`). Sin barra ni porcentaje — no existe
   presupuesto por subcategoría, solo por grupo.
3. **Filtrado:** se ocultan las subcategorías con 0 € de gasto este mes. Solo
   se listan las que tienen movimientos reales.
4. **Orden:** se preserva el orden declarado en `BUDGET_GROUPS[].categories`.
5. **Origen de datos:** ninguna query nueva. `useMonthCategorySpend(month)`
   (ya usado por `BudgetSummaryCard`) devuelve `{ category, amount }[]`; se
   agrega por categoría igual que ya hace `BudgetTable.tsx`
   (`spendByCategory` map).
6. **Alcance:** solo `BudgetSummaryCard.tsx`. No se toca `BudgetTable.tsx`
   (ya tiene su propio expand), ni el cálculo de presupuesto/alertas, ni el
   backend.

### Cambios

- **`src/components/planning/BudgetSummaryCard.tsx`:**
  - Nuevo estado local `expanded: Set<string>` + `toggle(key)` (mismo patrón
    que `BudgetTable.tsx`).
  - Construir `spendByCategory: Map<string, number>` a partir de `spend`
    (agregando por `category`).
  - La fila de cada grupo (label + barra) pasa a renderizarse dentro de un
    `<button>` con icono chevron (`ChevronRight`/`ChevronDown` de
    `lucide-react`, igual que `BudgetTable`) y `aria-expanded`.
  - Si el grupo está expandido, debajo de su barra se renderiza una lista de
    `g.categories` filtrando las de `spendByCategory.get(cat) > 0`, cada una
    con `<span>{cat}</span>` + `<span>{euro.format(amount)}</span>` en texto
    pequeño/atenuado (`text-[11px] text-muted-foreground` o similar, acorde al
    estilo ya usado en `BudgetTable`).

## Testing

Componente de UI puro (sin lógica de negocio nueva) — no requiere test
unitario nuevo. Verificación manual en dashboard y en Planning → Gastos:
expandir/colapsar varios grupos a la vez, comprobar que solo aparecen
subcategorías con gasto > 0 y que los importes coinciden con los de
`BudgetTable`.

## Fuera de alcance

- Barra o porcentaje por subcategoría (no hay presupuesto a ese nivel).
- Presupuesto editable por subcategoría.
- Cambios en `BudgetTable.tsx` o en las queries de `budget-api.ts`.
