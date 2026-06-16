# Matching Aportaciones ↔ Portfolio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Vincular estrategias con posiciones del portfolio (matcher difuso + override manual) y, al registrar una aportación con precio, actualizar o crear la posición.

**Spec:** `docs/superpowers/specs/2026-06-13-contribution-portfolio-matching-design.md`

**Tech:** Supabase, React + TanStack Query, Vitest. Convención del repo: hooks con `(supabase as any)` + eslint-disable; numéricos de PostgREST coercionados con `Number()`.

---

### Task 1: Migración + tipo

**Files:**
- Create: `supabase/migrations/20260613100000_plan_portfolio_link.sql`
- Modify: `src/lib/planning-api.ts`

- [ ] **Step 1: Migración** — contenido exacto:

```sql
alter table public.investment_plans
  add column if not exists portfolio_position_id uuid
    references public.portfolio_positions(id) on delete set null;
```

- [ ] **Step 2: Aplicar** `npx supabase db push 2>&1 | tail -8`. Expected: aplica `20260613100000`. Si se queja de migraciones anteriores ya aplicadas, NO tocar — reportar.

- [ ] **Step 3: Verificar** (anon en .env como VITE_SUPABASE_PUBLISHABLE_KEY):
```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -4 -s "$URL/rest/v1/investment_plans?select=portfolio_position_id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]` o filas (NO "column does not exist").

- [ ] **Step 4: Tipo** — en `src/lib/planning-api.ts`, en `InvestmentPlan` añadir tras `annual_multiplier_year`:
```typescript
  portfolio_position_id: string | null;
```

- [ ] **Step 5: Build** `npm run build 2>&1 | tail -3` → ✓ built. Commit:
```bash
git add supabase/migrations/20260613100000_plan_portfolio_link.sql src/lib/planning-api.ts
git commit -m "feat: investment_plans.portfolio_position_id link to portfolio"
```

---

### Task 2: Matcher difuso (TDD)

**Files:**
- Create: `src/lib/position-match.ts`
- Create: `src/lib/position-match.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/position-match.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalize, matchScore, suggestPosition, rankPositions } from "./position-match";

const positions = [
  { id: "p-msci", assetName: "MSCI World" },
  { id: "p-emerg", assetName: "MSCI Emerging" },
  { id: "p-btc", assetName: "Bitcoin" },
  { id: "p-oro", assetName: "Oro" },
];

describe("normalize", () => {
  it("baja, sin acentos, sin paréntesis", () =>
    expect(normalize("Oro (IGLN) — Ñoño")).toBe("oro igln nono"));
});

describe("matchScore", () => {
  it("contención exacta → 1", () =>
    expect(matchScore("bitcoin criptan btc", "Bitcoin")).toBe(1));
  it("sin relación → bajo", () =>
    expect(matchScore("renta fija hy", "Bitcoin")).toBeLessThan(0.5));
});

describe("suggestPosition", () => {
  it("Bitcoin (Criptan)/BTC → p-btc", () =>
    expect(suggestPosition("Bitcoin (Criptan)", "BTC", positions)?.id).toBe("p-btc"));
  it("RV Core (MSCI World) → p-msci, no p-emerg", () =>
    expect(suggestPosition("RV Core (MSCI World)", "MSCI World (IWDA)", positions)?.id).toBe("p-msci"));
  it("Oro (IGLN)/iShares Physical Gold → p-oro", () =>
    expect(suggestPosition("Oro (IGLN)", "iShares Physical Gold", positions)?.id).toBe("p-oro"));
  it("S&P 500 sin posición → null", () =>
    expect(suggestPosition("RV Oportunista (S&P 500)", "S&P 500", positions)).toBeNull());
});

describe("rankPositions", () => {
  it("ordena por score desc, MSCI World primero", () => {
    const r = rankPositions("RV Core (MSCI World)", "MSCI World (IWDA)", positions);
    expect(r[0].id).toBe("p-msci");
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });
});
```

- [ ] **Step 2: Run** `npm test -- position-match` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — `src/lib/position-match.ts`:

```typescript
export type MatchCandidate = { id: string; assetName: string };
export type MatchResult = { id: string; score: number };

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[n];
}

/** strategyText = name + " " + assetName (sin normalizar); positionName crudo. */
export function matchScore(strategyText: string, positionName: string): number {
  const st = normalize(strategyText);
  const pos = normalize(positionName);
  if (!pos || !st) return 0;
  // contención en cualquier dirección
  if (st.includes(pos) || pos.includes(st)) return 1;
  // solapamiento de tokens
  const stTok = new Set(tokens(st));
  const posTok = tokens(pos);
  const overlap = posTok.length
    ? posTok.filter((t) => stTok.has(t)).length / posTok.length
    : 0;
  // levenshtein normalizado contra el texto completo de estrategia
  const dist = levenshtein(pos, st);
  const lev = 1 - dist / Math.max(pos.length, st.length);
  return Math.max(overlap, lev);
}

export function rankPositions(
  strategyName: string,
  strategyAssetName: string,
  positions: MatchCandidate[],
): MatchResult[] {
  const text = `${strategyName} ${strategyAssetName}`;
  return positions
    .map((p) => ({ id: p.id, score: matchScore(text, p.assetName) }))
    .sort((a, b) => b.score - a.score);
}

export function suggestPosition(
  strategyName: string,
  strategyAssetName: string,
  positions: MatchCandidate[],
  threshold = 0.6,
): MatchResult | null {
  const ranked = rankPositions(strategyName, strategyAssetName, positions);
  return ranked.length && ranked[0].score >= threshold ? ranked[0] : null;
}
```

- [ ] **Step 4: Run** `npm test -- position-match` → todos pasan. También `npm test` → 23 previos + nuevos verdes.

- [ ] **Step 5: Lint+commit**:
```bash
npx eslint --fix src/lib/position-match.ts src/lib/position-match.test.ts
git add src/lib/position-match.ts src/lib/position-match.test.ts
git commit -m "feat: fuzzy position matcher (containment + levenshtein)"
```

---

### Task 3: Recálculo de posición (TDD)

**Files:**
- Create: `src/lib/portfolio-sync.ts` (solo la función pura `applyContribution` en esta tarea)
- Create: `src/lib/portfolio-sync.test.ts`

- [ ] **Step 1: Test failing** — `src/lib/portfolio-sync.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyContribution } from "./portfolio-sync";

describe("applyContribution", () => {
  it("posición vacía (qty 0): avg = precio", () => {
    // 200€ a 10/u → 20 units; desde 0
    expect(applyContribution({ quantity: 0, avg_cost: 0 }, 200, 20)).toEqual({
      quantity: 20,
      avg_cost: 10,
    });
  });
  it("precio medio ponderado", () => {
    // 100u@10 (basis 1000) + 200€ comprando 20u@10 → 120u, avg (1000+200)/120 = 10
    expect(applyContribution({ quantity: 100, avg_cost: 10 }, 200, 20)).toEqual({
      quantity: 120,
      avg_cost: 10,
    });
  });
  it("sube el avg si compras más caro", () => {
    // 10u@10 (100) + 60€ por 4u (15/u) → 14u, avg (100+60)/14 ≈ 11.4286
    const r = applyContribution({ quantity: 10, avg_cost: 10 }, 60, 4);
    expect(r.quantity).toBe(14);
    expect(r.avg_cost).toBeCloseTo(11.4286, 3);
  });
  it("units 0 → sin cambio de qty, avg preservado", () => {
    expect(applyContribution({ quantity: 5, avg_cost: 7 }, 0, 0)).toEqual({
      quantity: 5,
      avg_cost: 7,
    });
  });
});
```

- [ ] **Step 2: Run** `npm test -- portfolio-sync` → FAIL.

- [ ] **Step 3: Implementar** — `src/lib/portfolio-sync.ts` (solo la función pura; el hook va en Task 4):

```typescript
/** Recalcula cantidad y precio medio ponderado al añadir una aportación. */
export function applyContribution(
  pos: { quantity: number; avg_cost: number },
  amount: number,
  units: number,
): { quantity: number; avg_cost: number } {
  const newQty = pos.quantity + units;
  if (newQty <= 0) return { quantity: pos.quantity, avg_cost: pos.avg_cost };
  const newAvg = (pos.quantity * pos.avg_cost + amount) / newQty;
  return { quantity: newQty, avg_cost: newAvg };
}
```

- [ ] **Step 4: Run** `npm test -- portfolio-sync` → pasan. `npm test` global verde.

- [ ] **Step 5: Lint+commit**:
```bash
npx eslint --fix src/lib/portfolio-sync.ts src/lib/portfolio-sync.test.ts
git add src/lib/portfolio-sync.ts src/lib/portfolio-sync.test.ts
git commit -m "feat: weighted-average-cost recompute for contributions"
```

---

### Task 4: Hook de sincronización

**Files:**
- Modify: `src/lib/portfolio-sync.ts` (añadir el hook)

- [ ] **Step 1: Añadir el hook** al final de `src/lib/portfolio-sync.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { InvestmentPlan } from "./planning-api";
import { suggestPosition } from "./position-match";

const ASSET_TYPE_BY_CLASS: Record<string, string> = {
  rv_core: "fund",
  rv_opp: "etf",
  gold: "other",
  btc: "crypto",
  rf: "bond",
};

/**
 * Vuelca una aportación (con precio) a la posición de portfolio vinculada:
 * actualiza si existe, la resuelve por matcher difuso o la crea si no hay.
 */
export function useSyncContributionToPosition() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { plan: InvestmentPlan; amount: number; units: number }) => {
      const { plan, amount, units } = input;
      if (units <= 0) return;
      const price = amount / units;

      // 1. cargar posiciones del usuario
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: positions, error: pErr } = await (supabase as any)
        .from("portfolio_positions")
        .select("id, asset_name, quantity, avg_cost");
      if (pErr) throw pErr;
      const all = (positions ?? []) as {
        id: string;
        asset_name: string;
        quantity: number;
        avg_cost: number;
      }[];

      // 2. resolver posición destino
      let targetId = plan.portfolio_position_id;
      if (!targetId) {
        const match = suggestPosition(
          plan.name,
          plan.asset_name,
          all.map((p) => ({ id: p.id, assetName: p.asset_name })),
        );
        targetId = match?.id ?? null;
        if (targetId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("investment_plans")
            .update({ portfolio_position_id: targetId })
            .eq("id", plan.id);
        }
      }

      if (targetId) {
        // 3. actualizar posición existente
        const pos = all.find((p) => p.id === targetId);
        if (pos) {
          const newQty = Number(pos.quantity) + units;
          const newAvg =
            newQty > 0 ? (Number(pos.quantity) * Number(pos.avg_cost) + amount) / newQty : 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any)
            .from("portfolio_positions")
            .update({ quantity: newQty, avg_cost: newAvg })
            .eq("id", targetId);
          if (error) throw error;
        }
      } else {
        // 4. crear posición y vincular
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: created, error: cErr } = await (supabase as any)
          .from("portfolio_positions")
          .insert({
            user_id: user!.id,
            asset_name: plan.asset_name,
            asset_type: ASSET_TYPE_BY_CLASS[plan.asset_class ?? ""] ?? "other",
            platform: "",
            quantity: units,
            avg_cost: price,
            current_price: price,
            currency: "EUR",
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("investment_plans")
          .update({ portfolio_position_id: created.id })
          .eq("id", plan.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["investment_plans"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
```

Nota: la función pura `applyContribution` y el hook duplican la fórmula del precio medio; el hook usa la fórmula inline con `Number()` (coerción PostgREST). `applyContribution` queda como la versión testeada de referencia — si el reviewer prefiere, el hook puede llamarla tras coercionar; mantener una sola fórmula es aceptable.

- [ ] **Step 2: Verificar** `npm run build 2>&1 | tail -3` → ✓ built. `npx eslint src/lib/portfolio-sync.ts` limpio (--fix si hace falta). `npm test` verde.

- [ ] **Step 3: Commit**:
```bash
git add src/lib/portfolio-sync.ts
git commit -m "feat: useSyncContributionToPosition (link/update/create position)"
```

---

### Task 5: Wire en ContributionModal (planning.tsx)

**Files:**
- Modify: `src/routes/planning.tsx`

- [ ] **Step 1: Importar** el hook arriba: `import { useSyncContributionToPosition } from "@/lib/portfolio-sync";`

- [ ] **Step 2:** En `ContributionModal`, instanciar `const syncPosition = useSyncContributionToPosition();`. En el submit, tras el `upsertContribution.mutate(...)` con éxito (encadenar en su `onSuccess` o `await mutateAsync`), si `values.price` está presente:
```typescript
syncPosition.mutate({
  plan,
  amount: values.actual_amount,
  units: values.actual_amount / values.price,
});
```
Usar `mutateAsync` o el `onSuccess` del upsert para asegurar orden (primero registra la aportación, luego sincroniza). No bloquear el cierre del modal por el sync (best-effort: si el sync falla, la aportación ya quedó registrada).

- [ ] **Step 3:** Añadir bajo el campo de precio un texto condicional: cuando el campo precio está vacío, mostrar en gris "Indica el precio para sincronizar con tu portfolio." Reutilizar el patrón de textos de ayuda existente del modal.

- [ ] **Step 4:** Build + lint + restart:
```bash
npm run build 2>&1 | tail -3
npx eslint src/routes/planning.tsx | tail -3
systemctl --user restart wealth-navigator.service && sleep 3 && systemctl --user is-active wealth-navigator.service
```
- [ ] **Step 5: Commit**:
```bash
git add src/routes/planning.tsx
git commit -m "feat: sync contribution to portfolio position on register"
```

---

### Task 6: Dropdown "Posición vinculada" en PlanModal (planning.tsx)

**Files:**
- Modify: `src/routes/planning.tsx`

- [ ] **Step 1:** En `PlanModal`, cargar las posiciones del usuario (hook existente de portfolio o un fetch ligero; si hay `usePortfolioPositions` reutilizarlo; si no, una query inline). Importar `rankPositions, suggestPosition` de `@/lib/position-match`.

- [ ] **Step 2:** Añadir al formulario (solo para estrategias, es decir cuando hay `asset_class`; en planes simples no aparece) un `<select>` "Posición vinculada":
  - `<option value="">Crear automáticamente al aportar</option>`
  - posiciones ordenadas por `rankPositions(name, asset_name, positions)` con su `assetName` como label.
  - Valor por defecto al crear/editar: `editingPlan?.portfolio_position_id ?? suggestPosition(name, asset_name, positions)?.id ?? ""`.
  - El campo enlaza a `portfolio_position_id` del payload de `useCreatePlan`/`useUpdatePlan` (incluir `portfolio_position_id: value || null`).

- [ ] **Step 3:** Build + lint + restart (igual que Task 5 step 4). Verificar que el select aparece en el modal de una estrategia y que guarda el vínculo (no romper planes simples sin asset_class).

- [ ] **Step 4: Commit**:
```bash
git add src/routes/planning.tsx
git commit -m "feat: linked-position selector in strategy modal with fuzzy default"
```

---

### Task 7: Línea de posición vinculada en StrategyCard

**Files:**
- Modify: `src/components/planning/StrategyCard.tsx`

- [ ] **Step 1:** El card recibe ya `plan`. Para mostrar el valor de la posición vinculada necesita los datos de la posición. Pasar desde `planning.tsx` un mapa `positionsById` (o el array de posiciones) como prop opcional a `StrategyCard`, o cargar las posiciones en el card vía el hook de portfolio. Preferir: pasar `positions` como prop desde la página (que ya las carga para los Tasks 5/6) para no multiplicar queries.

- [ ] **Step 2:** Si `plan.portfolio_position_id` y existe la posición en el mapa, renderizar una línea compacta bajo la cuota:
```tsx
{linkedPos && (
  <p className="mt-1 text-[11px] text-muted-foreground">
    Posición: {Number(linkedPos.quantity * linkedPos.current_price).toFixed(0)} €
    {" · P&L "}
    <span className={pnl >= 0 ? "text-emerald-600" : "text-red-600"}>
      {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)} %
    </span>
  </p>
)}
```
donde `marketValue = Number(quantity)*Number(current_price)`, `cost = Number(quantity)*Number(avg_cost)`, `pnl = cost>0 ? (marketValue/cost - 1)*100 : 0`. Coercionar con `Number()` (PostgREST). Sin emojis (el usuario los quitó).

- [ ] **Step 3:** Actualizar `planning.tsx` para pasar `positions` a cada `StrategyCard`. Build + lint + restart.

- [ ] **Step 4: Commit**:
```bash
git add src/components/planning/StrategyCard.tsx src/routes/planning.tsx
git commit -m "feat: show linked position value and P&L on strategy card"
```

---

### Task 8: Verificación E2E

- [ ] **Step 1:** `npm test` → todos verdes (23 + position-match + portfolio-sync). `npm run build` → ✓.
- [ ] **Step 2:** En `wealthos.manidmt.es/planning`: editar "RV Core (MSCI World)" → el select muestra "MSCI World" preseleccionado. Guardar.
- [ ] **Step 3:** Registrar una aportación de prueba con precio en RV Core → comprobar (vía REST con service role, retrievable con `npx supabase projects api-keys`) que la posición "MSCI World" subió `quantity` y recalculó `avg_cost`. Si fue de prueba, revertir el valor manualmente.
- [ ] **Step 4:** Registrar en una estrategia sin posición (ej. cambiar S&P 500 a "crear automáticamente") con precio → verificar que se creó una posición nueva y que `portfolio_position_id` quedó enlazado.
- [ ] **Step 5:** Commit final si quedó algo, y nota de cualquier desviación.

---

## Self-review
- Cobertura spec: §1→T1, §2→T2, §3→T3, hook §3→T4, §4→T5, §5→T6, §6→T7, §8→T2/T3/T8. ✓
- Consistencia: `applyContribution` (T3) y la fórmula inline del hook (T4) comparten la misma matemática; documentado. `portfolio_position_id` fluye por `CreatePlanInput`/`UpdatePlanInput` vía Omit (T1). `positions` se cargan una vez en la página y se pasan a StrategyCard/PlanModal (T5-T7) para no multiplicar queries.
- Riesgo conocido: doble conteo (avisado en UI, T5 step 3). Pólvora sin precio no sincroniza (por diseño).
