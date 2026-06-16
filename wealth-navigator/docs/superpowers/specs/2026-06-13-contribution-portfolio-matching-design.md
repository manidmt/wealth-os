# Matching Aportaciones ↔ Portfolio — Design

**Date:** 2026-06-13
**Scope:** Vincular cada estrategia de `/planning` con una posición de `portfolio_positions` y, al registrar una aportación con precio, sincronizar la posición (actualizar participaciones y precio medio, o crearla). Vínculo difuso por nombre (contención + Levenshtein) con override manual.
**Out of scope:** sincronizar la pólvora (se registra sin precio), conversión de divisas FX, two-way sync (editar la posición no reescribe las aportaciones).

## Decisiones (brainstorming aprobado)
- Al registrar aportación con precio → **actualizar** la posición vinculada (participaciones += units, precio medio ponderado recalculado).
- Vínculo: **matcher difuso** (contención de nombre + Levenshtein) que sugiere; override manual en el modal de estrategia; se persiste el ID elegido.
- Estrategias sin posición → **crear** la posición en la primera aportación con precio (si no hay match fuerte).

---

## 1. Base de datos

```sql
alter table public.investment_plans
  add column if not exists portfolio_position_id uuid
    references public.portfolio_positions(id) on delete set null;
```

`on delete set null`: si se borra la posición, la estrategia queda sin vincular (no se borra la estrategia).

`InvestmentPlan` (planning-api.ts) gana `portfolio_position_id: string | null`. Como `CreatePlanInput = Omit<InvestmentPlan, "id"|"user_id"|"created_at">`, el campo queda creable/actualizable automáticamente.

---

## 2. Matcher difuso — `src/lib/position-match.ts` (puro, testeable)

```typescript
export type MatchCandidate = { id: string; assetName: string };
export type MatchResult = { id: string; score: number };

// normaliza: minúsculas, sin diacríticos, no-alfanumérico→espacio, colapsa espacios
export function normalize(s: string): string;

// score 0..1 entre el texto de una estrategia y una posición
export function matchScore(strategyText: string, positionName: string): number;

// mejor posición para una estrategia; null si ninguna supera el umbral
export function suggestPosition(
  strategyName: string,
  strategyAssetName: string,
  positions: MatchCandidate[],
  threshold?: number, // default 0.6
): MatchResult | null;

// todas ordenadas por score desc (para el desplegable del modal)
export function rankPositions(
  strategyName: string,
  strategyAssetName: string,
  positions: MatchCandidate[],
): MatchResult[];
```

**Algoritmo de `matchScore(strategyText, positionName)`** (strategyText = `name + " " + asset_name` normalizado):
1. `posNorm = normalize(positionName)`.
2. **Contención**: si `posNorm` aparece como substring de `strategyText` (o viceversa) → `1.0`.
3. **Solapamiento de tokens**: `|tokens(posNorm) ∩ tokens(strategyText)| / |tokens(posNorm)|`.
4. **Levenshtein** normalizado entre `posNorm` y `strategyAssetName` normalizado: `1 - dist/max(len)`.
5. `score = max(contención, solapamiento, levenshtein)`.

`suggestPosition` toma el argmax sobre las posiciones; si `score >= threshold` lo devuelve, si no `null`.

**Casos de prueba (nombres reales):**
| Estrategia (name / asset_name) | Posición | score esperado |
|---|---|---|
| Bitcoin (Criptan) / BTC | Bitcoin | 1.0 (contención) |
| RV Core (MSCI World) / MSCI World (IWDA) | MSCI World | 1.0 |
| RV Core (MSCI World) | MSCI Emerging | ~0.5 (no gana) |
| Oro (IGLN) / iShares Physical Gold | Oro | 1.0 |
| RV Oportunista (S&P 500) / S&P 500 | (ninguna) | null |

---

## 3. Recálculo de posición — `src/lib/portfolio-sync.ts` (puro + hook)

**Función pura** (testeable):
```typescript
export function applyContribution(
  pos: { quantity: number; avg_cost: number },
  amount: number,
  units: number,
): { quantity: number; avg_cost: number } {
  const newQty = pos.quantity + units;
  const newAvg = newQty > 0 ? (pos.quantity * pos.avg_cost + amount) / newQty : 0;
  return { quantity: newQty, avg_cost: newAvg };
}
```

**Hook orquestador** `useSyncContributionToPosition()` (mutation). Input: `{ plan: InvestmentPlan; amount: number; units: number }`. Flujo:
1. Carga las posiciones del usuario (`portfolio_positions` del user).
2. Resolver posición destino:
   - Si `plan.portfolio_position_id` no es null → esa.
   - Si null → `suggestPosition(plan.name, plan.asset_name, positions)`. Si match → usarla y persistir el vínculo (`investment_plans.portfolio_position_id = match.id`).
   - Si sigue sin match → **crear** posición y persistir el vínculo.
3. Si posición existente: `applyContribution(pos, amount, units)` → `update portfolio_positions set quantity, avg_cost`.
4. Si crear: `insert portfolio_positions { user_id, asset_name: plan.asset_name, asset_type: ASSET_TYPE_BY_CLASS[plan.asset_class], platform: "", quantity: units, avg_cost: price, current_price: price, currency: "EUR" }` y luego `update investment_plans set portfolio_position_id`.
5. Invalida queries `["portfolio-positions"]` e `["investment_plans"]`.

`ASSET_TYPE_BY_CLASS`: `rv_core→"fund"`, `rv_opp→"etf"`, `gold→"other"`, `btc→"crypto"`, `rf→"bond"`. (price = amount/units, ya disponible en el submit.)

**Nota de divisa**: la aritmética asume que `amount` (EUR) y el `avg_cost` de la posición están en la misma divisa. Tus estrategias mapean a posiciones EUR, así que es correcto; si una posición estuviera en otra divisa, el cálculo es best-effort (documentado, sin conversión).

---

## 4. Flujo de aportación (planning.tsx, ContributionModal)

Tras `useUpsertContribution` con éxito, **solo si `values.price` está presente** (hay `units`):
- llamar `syncContribution.mutate({ plan, amount: values.actual_amount, units: values.actual_amount / values.price })`.
- Si no hay precio → no se sincroniza; mostrar un texto en el modal: "Indica el precio para sincronizar con tu portfolio."

`useFireDryPowder` (soltar pólvora) **no cambia**: registra la aportación sin precio, así que no sincroniza (decisión de fase 1).

---

## 5. Modal de editar estrategia (PlanModal)

Nuevo campo "Posición vinculada": `<select>` con:
- Opción "— sin vincular —".
- Opción "Crear automáticamente al aportar" (deja `portfolio_position_id` null; el sync decidirá).
- Las posiciones del portfolio ordenadas por `rankPositions(...)` (mejor match arriba).
- Valor por defecto cuando `portfolio_position_id` es null: la sugerencia difusa preseleccionada (si supera umbral), si no "Crear automáticamente al aportar".

Al guardar, persiste `portfolio_position_id` vía `useUpdatePlan`/`useCreatePlan`.

---

## 6. Tarjeta de estrategia (StrategyCard)

Si `plan.portfolio_position_id` no es null, una línea compacta con el valor de mercado y P&L de la posición vinculada: `Posición: {marketValue} € · P&L {pnlPct} %` (verde/rojo). Si está sin vincular, nada (o un discreto "sin posición vinculada"). Aviso discreto de posible doble conteo en el tooltip/ayuda del modal de aportación, no en la tarjeta.

---

## 7. Archivos

| Archivo | Acción |
|---|---|
| `supabase/migrations/20260613100000_plan_portfolio_link.sql` | Crear (columna) |
| `src/lib/position-match.ts` | Crear (matcher puro) |
| `src/lib/position-match.test.ts` | Crear (Vitest) |
| `src/lib/portfolio-sync.ts` | Crear (applyContribution puro + hook useSyncContributionToPosition) |
| `src/lib/portfolio-sync.test.ts` | Crear (Vitest del recálculo) |
| `src/lib/planning-api.ts` | Modificar (campo portfolio_position_id) |
| `src/routes/planning.tsx` | Modificar (ContributionModal sync, PlanModal dropdown) |
| `src/components/planning/StrategyCard.tsx` | Modificar (línea de posición vinculada) |

---

## 8. Testing
- **Vitest matcher**: los 5 casos de la tabla §2 + `normalize` (acentos, paréntesis) + que MSCI World gana a MSCI Emerging.
- **Vitest applyContribution**: posición vacía (qty 0), suma con precio medio ponderado conocido (p.ej. 100u@10 + 50€@5u... comprobar avg), units 0 → sin cambio.
- **Verificación manual E2E**: registrar 200 € @ precio en RV Core → la posición "MSCI World" sube participaciones y recalcula avg; registrar en una estrategia sin posición (S&P 500) → crea la posición y la vincula.

## 9. Riesgos
- Doble conteo si el usuario también actualiza la posición a mano / por CSV: es acción manual deliberada; se avisa en el modal.
- Requiere `db push` de la migración antes de desplegar el frontend que escribe `portfolio_position_id`.
