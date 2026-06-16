# Refinamientos de importación — Design

**Date:** 2026-06-13
**Scope:** Tres ajustes sobre la importación bancaria ya desplegada: (1) tolerancia de importe en la detección de duplicados; (2) autoexclusión de retiradas de efectivo; (3) reglas de exclusión por concepto (recurrentes que no son gasto, p.ej. adeudos de Indexa que van al plan de pensiones).
**Out of scope:** convertir adeudos en aportaciones de portfolio; detección de transferencias internas por pares +X/−X.

## Decisiones (aprobadas)
- Dedup: emparejar si `|a−b| ≤ max(1,50€, 5%·max(a,b))` y fecha `±3` días (sigue solo marcando para revisión, nunca borra).
- Retiradas de efectivo (MCC 6011/6010 o concepto "RET. EFECTIVO"/"REINTEGRO"/"DISPOSICION EFECTIVO") → `excluded = true` por defecto (des-excluibles a mano).
- Recurrentes: **reglas de exclusión por concepto** (substring case-insensitive). Se crean desde el panel de edición al marcar "No contabilizar"; se aplican en cada import.

---

## 1. Dedup con tolerancia — `_shared/dedup.ts`

`findDuplicate(q, manuals, opts?)`: empareja si `m.type === q.type`, `|m.amount − q.amount| ≤ max(1.50, 0.05·max(m.amount,q.amount))`, y `|fechas| ≤ 3 días`. (Antes exigía importe exacto ±0.001.) Defaults: `amountAbs = 1.5`, `amountPct = 0.05`, `toleranceDays = 3`.

---

## 2. Detección de no-gasto — `_shared/non-expense.ts` (puro, testeable)

```typescript
export function isCashWithdrawal(mcc: string | null | undefined, description: string): boolean;
//  mcc ∈ {6010,6011}  OR  /RET\.?\s*EFECTIVO|REINTEGRO|DISPOSICION\s+EFECTIVO|DISPOSICION\s+CAJERO/i sobre description

export type ExclusionRule = { match_text: string };
export function matchesExclusionRule(description: string, rules: ExclusionRule[]): boolean;
//  true si description.toUpperCase() incluye algún rule.match_text.toUpperCase()
```

---

## 3. Tabla de reglas — `supabase/migrations/20260613160000_exclusion_rules.sql`

```sql
create table public.movement_exclusion_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_text text not null,
  created_at timestamptz not null default now(),
  unique(user_id, match_text)
);
alter table public.movement_exclusion_rules enable row level security;
create policy "own rules" on public.movement_exclusion_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## 4. Pipeline (las 3 funciones de sync)

`enrichRows` carga las reglas del usuario (`movement_exclusion_rules`), y al decidir `excluded` por fila combina:
```
excluded = (duplicate_of !== null) || isCashWithdrawal(mcc, description) || matchesExclusionRule(description, rules)
```
`mapTransaction` debe pasar el `merchant_category_code` a la fila (campo nuevo `mcc` en `MovementRow`, NO se guarda en `movements` —solo se usa en memoria para `isCashWithdrawal`— o se pasa la tx original). Se omite la capa LLM para filas ya `excluded` (ahorra tokens): el filtro de pendientes pasa a `!r.excluded && r.category === "Sin categoría"`.

---

## 5. Frontend

- **`movements-api.ts`**: hooks `useExclusionRules()`, `useCreateExclusionRule()`, `useDeleteExclusionRule()`.
- **`AddMovementSheet`**: cuando "No contabilizar" está activado, mostrar un bloque opcional "Excluir siempre movimientos con este concepto": un `Input` (por defecto un token del concepto, editable) + checkbox/botón "Crear regla". Al guardar el movimiento, si está marcado, crear la regla.
- **`settings.tsx`** (o sección en Gastos): lista de reglas activas con botón borrar (gestión mínima).

---

## 6. Despliegue / datos
- Migración + redeploy de las 3 funciones.
- Sembrar la regla del usuario: `INDEXA` (la mencionó explícitamente). El usuario añade más desde la UI.
- Borrar los 96 importados actuales y re-sync para aplicar: nueva tolerancia de dedup (pillará Bus/Gym), autoexclusión de efectivo y la regla Indexa.

---

## 7. Testing
- **`findDuplicate`** (Vitest): 28 vs 28.73 (±fecha) → match; 23 vs 22.99 → match; 28 vs 35 → null; importes grandes con 5% → match/no-match en el borde; tipo distinto → null.
- **`isCashWithdrawal`** (Vitest): MCC 6011 → true; "RET. EFECTIVO..." → true; compra normal → false.
- **`matchesExclusionRule`** (Vitest): "ADEUDO INDEXA CAPITAL" con regla "INDEXA" → true; sin regla → false; case-insensitive.
- **E2E**: re-sync → Bus/Gym aparecen como duplicados; la retirada de 50€ entra excluida; los adeudos de Indexa entran excluidos.

## 8. Riesgos
- Tolerancia de importe más laxa → algún falso duplicado (dos gastos parecidos el mismo día); aceptable porque solo marca para revisar.
- Reglas por substring demasiado cortas podrían excluir de más; el usuario controla el texto.
