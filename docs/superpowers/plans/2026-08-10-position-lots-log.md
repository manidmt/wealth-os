# Position Lots Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single aggregate (`quantity`/`avg_cost`) on `portfolio_positions` with an editable log of purchase lots (`position_lots`), so any individual purchase — manual or from a DCA plan contribution — can be corrected without recalculating the weighted average by hand.

**Architecture:** New table `position_lots` is the source of truth for a position's holdings. `portfolio_positions.quantity`/`avg_cost` become a cache recomputed in TypeScript (sum of quantities, weighted-average price) every time a lot is created, edited, or deleted — no Postgres triggers for business logic, following the existing repo convention (triggers are only used for `updated_at` bookkeeping via the shared `set_updated_at()` function). Lots created from a DCA contribution (Planning) carry a `plan_contribution_id` FK; editing such a lot from Portfolio also patches the linked `plan_contributions` row so the two views never diverge.

**Tech Stack:** React + TypeScript (Vite), TanStack Query, Supabase (Postgres + RLS), Vitest, `supabase-js` one-shot scripts (existing `scripts/seed-strategies.ts` pattern).

## Global Constraints

- `position_lots.quantity` and `position_lots.price` must be `> 0` — no negative/sale lots in this feature (spec decision 6).
- A position must always keep at least one lot with the resulting total quantity `> 0` — deleting the last lot, or editing one down to a non-positive total, is rejected (spec decision 6).
- No Postgres triggers for aggregate recomputation — do it in TypeScript mutations (spec decision 5, matches existing repo convention).
- Lots inherit the parent position's currency — no `currency` column on `position_lots` (spec "fuera de alcance").
- Do not modify `planned_amount`, `multiplier`, or `signal_note` on `plan_contributions` (spec "fuera de alcance").
- Feature 2 (patrimonio histórico por mes) is explicitly out of scope for this plan.

---

### Task 1: `position_lots` table + RLS

**Files:**
- Create: `wealth-navigator/supabase/migrations/20260810120000_position_lots.sql`

**Interfaces:**
- Produces: table `public.position_lots(id, user_id, position_id, plan_contribution_id, date, quantity, price, notes, created_at, updated_at)`, consumed by every later task via `supabase-js` `.from("position_lots")`.

- [ ] **Step 1: Write the migration**

```sql
create table public.position_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.portfolio_positions(id) on delete cascade,
  plan_contribution_id uuid references public.plan_contributions(id) on delete set null,
  date date not null,
  quantity numeric(20,8) not null check (quantity > 0),
  price numeric(20,8) not null check (price > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_contribution_id)
);

create index position_lots_position_id_idx on public.position_lots (position_id);

alter table public.position_lots enable row level security;

create policy "Position lots: users can view own"
  on public.position_lots for select to authenticated
  using (auth.uid() = user_id);

create policy "Position lots: users can insert own"
  on public.position_lots for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Position lots: users can update own"
  on public.position_lots for update to authenticated
  using (auth.uid() = user_id);

create policy "Position lots: users can delete own"
  on public.position_lots for delete to authenticated
  using (auth.uid() = user_id);

create trigger position_lots_set_updated_at
  before update on public.position_lots
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Apply the migration to the project's Supabase instance**

Run: `cd wealth-navigator && npx supabase db push` (or the project's normal migration-apply command — check `wealth-navigator/README.md` if `supabase db push` isn't configured for a linked remote project).
Expected: migration applies with no errors; `position_lots` exists in the schema.

- [ ] **Step 3: Commit**

```bash
cd wealth-navigator
git add supabase/migrations/20260810120000_position_lots.sql
git commit -m "$(cat <<'EOF'
feat(db): add position_lots table for per-position purchase log

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 2: Pure lot-aggregation calculator

**Files:**
- Create: `wealth-navigator/src/lib/position-lots-calc.ts`
- Test: `wealth-navigator/src/lib/position-lots-calc.test.ts`

**Interfaces:**
- Produces: `aggregateLots(lots: { quantity: number; price: number }[]): { quantity: number; avg_cost: number }` — consumed by Task 5 (`position-lots-api.ts`) and Task 3 (`position-lots-backfill.test.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { aggregateLots } from "./position-lots-calc";

describe("aggregateLots", () => {
  it("sin lotes: agregado vacío", () => {
    expect(aggregateLots([])).toEqual({ quantity: 0, avg_cost: 0 });
  });

  it("un solo lote: avg = precio del lote", () => {
    expect(aggregateLots([{ quantity: 20, price: 10 }])).toEqual({
      quantity: 20,
      avg_cost: 10,
    });
  });

  it("varios lotes: media ponderada por cantidad", () => {
    const r = aggregateLots([
      { quantity: 100, price: 10 },
      { quantity: 20, price: 20 },
    ]);
    expect(r.quantity).toBe(120);
    expect(r.avg_cost).toBeCloseTo(11.6667, 3);
  });

  it("mantiene precisión con cantidades pequeñas (cripto)", () => {
    const r = aggregateLots([
      { quantity: 0.01, price: 60000 },
      { quantity: 0.005, price: 54000 },
    ]);
    expect(r.quantity).toBeCloseTo(0.015, 8);
    expect(r.avg_cost).toBeCloseTo(58000, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wealth-navigator && npx vitest run src/lib/position-lots-calc.test.ts`
Expected: FAIL — `position-lots-calc.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
/** Agrega una lista de lotes de compra en cantidad total + coste medio ponderado. */
export function aggregateLots(
  lots: { quantity: number; price: number }[],
): { quantity: number; avg_cost: number } {
  const quantity = lots.reduce((s, l) => s + l.quantity, 0);
  if (quantity <= 0) return { quantity: 0, avg_cost: 0 };
  const cost = lots.reduce((s, l) => s + l.quantity * l.price, 0);
  return { quantity, avg_cost: cost / quantity };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wealth-navigator && npx vitest run src/lib/position-lots-calc.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd wealth-navigator
git add src/lib/position-lots-calc.ts src/lib/position-lots-calc.test.ts
git commit -m "$(cat <<'EOF'
feat(portfolio): add pure lot-aggregation calculator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 3: Backfill lot generator (pure function)

**Files:**
- Create: `wealth-navigator/src/lib/position-lots-backfill.ts`
- Test: `wealth-navigator/src/lib/position-lots-backfill.test.ts`

**Interfaces:**
- Consumes: `aggregateLots` from `./position-lots-calc` (Task 2).
- Produces: `computeBackfillLots(position: BackfillPosition, contributions: BackfillContribution[]): BackfillLotInput[]`, `type BackfillLotInput = { position_id: string; plan_contribution_id: string | null; date: string; quantity: number; price: number; notes: string | null }` — consumed by Task 4 (`scripts/backfill-position-lots.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { computeBackfillLots } from "./position-lots-backfill";
import { aggregateLots } from "./position-lots-calc";

describe("computeBackfillLots", () => {
  it("posición manual sin contribuciones: un único lote 'Saldo inicial'", () => {
    const position = {
      id: "pos-1",
      quantity: 94.6,
      avg_cost: 12.5875,
      created_at: "2026-05-15T08:46:03.773407+00:00",
    };
    const lots = computeBackfillLots(position, []);
    expect(lots).toEqual([
      {
        position_id: "pos-1",
        plan_contribution_id: null,
        date: "2026-05-15",
        quantity: 94.6,
        price: 12.5875,
        notes: "Saldo inicial",
      },
    ]);
  });

  it("posición con plan: contribuciones cubren el 100% de la cantidad", () => {
    const position = { id: "pos-2", quantity: 30, avg_cost: 11, created_at: "2026-01-01T00:00:00Z" };
    const contributions = [
      { id: "c1", date: "2026-01-15", price: 10, units: 20 },
      { id: "c2", date: "2026-02-15", price: 13, units: 10 },
    ];
    const lots = computeBackfillLots(position, contributions);
    expect(lots).toEqual([
      { position_id: "pos-2", plan_contribution_id: "c1", date: "2026-01-15", quantity: 20, price: 10, notes: null },
      { position_id: "pos-2", plan_contribution_id: "c2", date: "2026-02-15", quantity: 10, price: 13, notes: null },
    ]);
    // La media ponderada de los lotes generados reproduce el avg_cost original.
    const agg = aggregateLots(lots);
    expect(agg.quantity).toBeCloseTo(position.quantity, 8);
    expect(agg.avg_cost).toBeCloseTo(position.avg_cost, 8);
  });

  it("posición con plan: contribuciones cubren solo una parte → lote de ajuste", () => {
    const position = {
      id: "pos-3",
      quantity: 1120.3658525191859,
      avg_cost: 10.997261628686607,
      created_at: "2026-05-15T08:46:03.773407+00:00",
    };
    const contributions = [{ id: "c1", date: "2026-06-01", price: 12, units: 100 }];
    const lots = computeBackfillLots(position, contributions);
    expect(lots).toHaveLength(2);
    expect(lots[0]).toEqual({
      position_id: "pos-3",
      plan_contribution_id: "c1",
      date: "2026-06-01",
      quantity: 100,
      price: 12,
      notes: null,
    });
    const adj = lots[1];
    expect(adj.plan_contribution_id).toBeNull();
    expect(adj.notes).toBe("Saldo inicial (ajuste)");
    expect(adj.date).toBe("2026-05-15");
    expect(adj.quantity).toBeCloseTo(position.quantity - 100, 8);
    // La media ponderada de TODOS los lotes generados reproduce el avg_cost original.
    const agg = aggregateLots(lots);
    expect(agg.quantity).toBeCloseTo(position.quantity, 6);
    expect(agg.avg_cost).toBeCloseTo(position.avg_cost, 6);
  });

  it("ignora contribuciones sin price o sin units", () => {
    const position = { id: "pos-4", quantity: 10, avg_cost: 5, created_at: "2026-03-01T00:00:00Z" };
    const contributions = [
      { id: "c1", date: "2026-03-10", price: null, units: 10 },
      { id: "c2", date: "2026-03-20", price: 5, units: null },
    ];
    const lots = computeBackfillLots(position, contributions);
    expect(lots).toEqual([
      {
        position_id: "pos-4",
        plan_contribution_id: null,
        date: "2026-03-01",
        quantity: 10,
        price: 5,
        notes: "Saldo inicial",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wealth-navigator && npx vitest run src/lib/position-lots-backfill.test.ts`
Expected: FAIL — `position-lots-backfill.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
export type BackfillPosition = {
  id: string;
  quantity: number;
  avg_cost: number;
  created_at: string;
};

export type BackfillContribution = {
  id: string;
  date: string;
  price: number | null;
  units: number | null;
};

export type BackfillLotInput = {
  position_id: string;
  plan_contribution_id: string | null;
  date: string;
  quantity: number;
  price: number;
  notes: string | null;
};

const EPSILON = 1e-6;

/**
 * Genera los lotes iniciales de una posición a partir de sus aportaciones DCA
 * reales (si las hay). Si no cubren el 100% de la cantidad actual, añade un
 * lote de ajuste que reproduce exactamente el avg_cost/quantity actuales.
 */
export function computeBackfillLots(
  position: BackfillPosition,
  contributions: BackfillContribution[],
): BackfillLotInput[] {
  const openedAt = position.created_at.slice(0, 10);
  const valid = contributions.filter(
    (c): c is BackfillContribution & { price: number; units: number } =>
      c.price != null && c.units != null && c.units > 0,
  );

  if (valid.length === 0) {
    return [
      {
        position_id: position.id,
        plan_contribution_id: null,
        date: openedAt,
        quantity: position.quantity,
        price: position.avg_cost,
        notes: "Saldo inicial",
      },
    ];
  }

  const lots: BackfillLotInput[] = valid.map((c) => ({
    position_id: position.id,
    plan_contribution_id: c.id,
    date: c.date,
    quantity: c.units,
    price: c.price,
    notes: null,
  }));

  const coveredQty = valid.reduce((s, c) => s + c.units, 0);
  const remaining = position.quantity - coveredQty;

  if (remaining > EPSILON) {
    const coveredCost = valid.reduce((s, c) => s + c.units * c.price, 0);
    const targetCost = position.quantity * position.avg_cost;
    const adjPrice = (targetCost - coveredCost) / remaining;
    lots.push({
      position_id: position.id,
      plan_contribution_id: null,
      date: openedAt,
      quantity: remaining,
      price: adjPrice,
      notes: "Saldo inicial (ajuste)",
    });
  }

  return lots;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wealth-navigator && npx vitest run src/lib/position-lots-backfill.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd wealth-navigator
git add src/lib/position-lots-backfill.ts src/lib/position-lots-backfill.test.ts
git commit -m "$(cat <<'EOF'
feat(portfolio): add pure backfill-lot generator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 4: One-shot backfill script

**Files:**
- Create: `wealth-navigator/scripts/backfill-position-lots.ts`

**Interfaces:**
- Consumes: `computeBackfillLots` from `../src/lib/position-lots-backfill` (Task 3).

- [ ] **Step 1: Write the script**

```typescript
/**
 * Backfill one-shot: puebla position_lots para las posiciones ya existentes.
 * Uso: SUPABASE_URL=... SERVICE_ROLE_KEY=... npx tsx scripts/backfill-position-lots.ts
 */
import { createClient } from "@supabase/supabase-js";
import { computeBackfillLots, type BackfillContribution } from "../src/lib/position-lots-backfill";

const db = createClient(process.env.SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!);

async function main() {
  const { data: positions, error: posErr } = await db
    .from("portfolio_positions")
    .select("id, user_id, quantity, avg_cost, created_at");
  if (posErr) throw posErr;

  const { data: plans, error: plansErr } = await db
    .from("investment_plans")
    .select("id, portfolio_position_id")
    .not("portfolio_position_id", "is", null);
  if (plansErr) throw plansErr;

  const { data: contributions, error: contribErr } = await db
    .from("plan_contributions")
    .select("id, plan_id, date, price, units");
  if (contribErr) throw contribErr;

  const positionIdByPlanId = new Map((plans ?? []).map((p) => [p.id, p.portfolio_position_id as string]));
  const contribsByPositionId = new Map<string, BackfillContribution[]>();
  for (const c of contributions ?? []) {
    const positionId = positionIdByPlanId.get(c.plan_id);
    if (!positionId) continue;
    const list = contribsByPositionId.get(positionId) ?? [];
    list.push({ id: c.id, date: c.date, price: c.price, units: c.units });
    contribsByPositionId.set(positionId, list);
  }

  let skipped = 0;
  let inserted = 0;

  for (const position of positions ?? []) {
    const { count, error: countErr } = await db
      .from("position_lots")
      .select("id", { count: "exact", head: true })
      .eq("position_id", position.id);
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) {
      console.log(`skip ${position.id}: ya tiene ${count} lote(s)`);
      skipped++;
      continue;
    }

    const contribs = contribsByPositionId.get(position.id) ?? [];
    const lots = computeBackfillLots(position, contribs);
    const { error: insErr } = await db
      .from("position_lots")
      .insert(lots.map((l) => ({ ...l, user_id: position.user_id })));
    if (insErr) throw insErr;
    console.log(`${position.id}: ${lots.length} lote(s) insertados`);
    inserted += lots.length;
  }

  console.log(`\nHecho. ${inserted} lotes insertados, ${skipped} posiciones ya tenían lotes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script against the project's Supabase instance**

Run: `cd wealth-navigator && SUPABASE_URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2) SERVICE_ROLE_KEY=<service_role_key_from_wealth-agent/.env> npx tsx scripts/backfill-position-lots.ts`
Expected: one line per position, ending with "Hecho. N lotes insertados, 0 posiciones ya tenían lotes." (all 15 positions, first run).

- [ ] **Step 3: Verify the backfill against real data**

Run: query `position_lots` grouped by `position_id` and compare the weighted average / summed quantity against `portfolio_positions.quantity`/`avg_cost` for a few positions (at least MSCI Emerging and MSCI World, one manual and one plan-linked) to confirm they match within rounding.

- [ ] **Step 4: Commit**

```bash
cd wealth-navigator
git add scripts/backfill-position-lots.ts
git commit -m "$(cat <<'EOF'
feat(scripts): add one-shot backfill for position_lots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 5: `position-lots-api.ts` — React Query hooks

**Files:**
- Create: `wealth-navigator/src/lib/position-lots-api.ts`

**Interfaces:**
- Consumes: `aggregateLots` from `./position-lots-calc` (Task 2).
- Produces: `type PositionLot`, `usePositionLots(positionId: string | null)`, `insertPositionLot(input): Promise<void>` (plain async function, not a hook — consumed directly by Task 6's `portfolio-sync.ts`), `useCreateLot()`, `useUpdateLot()`, `useDeleteLot()` — consumed by Task 7 (`PositionLotsTable.tsx`).

- [ ] **Step 1: Write the implementation**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { aggregateLots } from "./position-lots-calc";

export type PositionLot = {
  id: string;
  user_id: string;
  position_id: string;
  plan_contribution_id: string | null;
  date: string;
  quantity: number;
  price: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function usePositionLots(positionId: string | null) {
  const { user } = useAuth();
  return useQuery<PositionLot[]>({
    queryKey: ["position_lots", positionId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("position_lots")
        .select("*")
        .eq("position_id", positionId)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!positionId,
  });
}

async function fetchLots(positionId: string): Promise<{ id: string; quantity: number; price: number }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("position_lots")
    .select("id, quantity, price")
    .eq("position_id", positionId);
  if (error) throw error;
  return data ?? [];
}

async function recomputePositionAggregate(positionId: string): Promise<void> {
  const lots = await fetchLots(positionId);
  const agg = aggregateLots(lots);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("portfolio_positions")
    .update({ quantity: agg.quantity, avg_cost: agg.avg_cost })
    .eq("id", positionId);
  if (error) throw error;
}

export type InsertLotInput = {
  user_id: string;
  position_id: string;
  plan_contribution_id?: string | null;
  date: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

/** Inserta un lote y recalcula el agregado de la posición. Función plana (no hook): la usan tanto useCreateLot como portfolio-sync.ts. */
export async function insertPositionLot(input: InsertLotInput): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("position_lots").insert({
    user_id: input.user_id,
    position_id: input.position_id,
    plan_contribution_id: input.plan_contribution_id ?? null,
    date: input.date,
    quantity: input.quantity,
    price: input.price,
    notes: input.notes ?? null,
  });
  if (error) throw error;
  await recomputePositionAggregate(input.position_id);
}

function invalidateAfterLotChange(
  qc: ReturnType<typeof useQueryClient>,
  positionId: string,
) {
  qc.invalidateQueries({ queryKey: ["position_lots", positionId] });
  qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
  qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
  qc.invalidateQueries({ queryKey: ["plan_contributions"] });
}

export function useCreateLot() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      position_id: string;
      date: string;
      quantity: number;
      price: number;
    }) => {
      await insertPositionLot({ ...input, user_id: user!.id });
    },
    onSuccess: (_d, vars) => invalidateAfterLotChange(qc, vars.position_id),
  });
}

export function useUpdateLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      position_id: string;
      quantity: number;
      price: number;
    }) => {
      const others = (await fetchLots(input.position_id)).filter((l) => l.id !== input.id);
      const resultingQty = others.reduce((s, l) => s + l.quantity, 0) + input.quantity;
      if (resultingQty <= 0) {
        throw new Error("La cantidad total de la posición no puede quedar en 0 o negativa.");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lot, error: lotErr } = await (supabase as any)
        .from("position_lots")
        .select("plan_contribution_id")
        .eq("id", input.id)
        .single();
      if (lotErr) throw lotErr;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("position_lots")
        .update({ quantity: input.quantity, price: input.price })
        .eq("id", input.id);
      if (error) throw error;

      if (lot.plan_contribution_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: cErr } = await (supabase as any)
          .from("plan_contributions")
          .update({
            price: input.price,
            units: input.quantity,
            actual_amount: input.quantity * input.price,
          })
          .eq("id", lot.plan_contribution_id);
        if (cErr) throw cErr;
      }

      await recomputePositionAggregate(input.position_id);
    },
    onSuccess: (_d, vars) => invalidateAfterLotChange(qc, vars.position_id),
  });
}

export function useDeleteLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; position_id: string; plan_contribution_id: string | null }) => {
      if (input.plan_contribution_id) {
        throw new Error("Este lote viene de una aportación del plan — edítalo o bórralo desde Planning.");
      }
      const others = (await fetchLots(input.position_id)).filter((l) => l.id !== input.id);
      if (others.length === 0) {
        throw new Error("No puedes borrar el único lote de una posición.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("position_lots").delete().eq("id", input.id);
      if (error) throw error;
      await recomputePositionAggregate(input.position_id);
    },
    onSuccess: (_d, vars) => invalidateAfterLotChange(qc, vars.position_id),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd wealth-navigator && npx tsc --noEmit`
Expected: no new type errors from `position-lots-api.ts`.

- [ ] **Step 3: Commit**

```bash
cd wealth-navigator
git add src/lib/position-lots-api.ts
git commit -m "$(cat <<'EOF'
feat(portfolio): add position_lots React Query hooks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 6: Wire DCA contributions to create synced lots

**Files:**
- Modify: `wealth-navigator/src/lib/planning-api.ts` (function `useUpsertContribution`, ~line 155-176 per current file)
- Modify: `wealth-navigator/src/lib/portfolio-sync.ts` (function `useSyncContributionToPosition`, full file)
- Modify: `wealth-navigator/src/components/planning/InvestmentPlanning.tsx` (function `ContributionModal.onSubmit`, ~line 725-743 per current file)

**Interfaces:**
- Consumes: `insertPositionLot` from `./position-lots-api` (Task 5).
- Produces: `useUpsertContribution()` now resolves to the created/updated `PlanContribution` row (was `void`) — no other current callers exist besides `ContributionModal`, so this is a safe signature widening.

- [ ] **Step 1: Make `useUpsertContribution` return the row**

In `wealth-navigator/src/lib/planning-api.ts`, replace:

```typescript
export function useUpsertContribution() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      plan_id: string;
      date: string;
      planned_amount: number;
      actual_amount: number;
      price?: number | null;
      units?: number | null;
      multiplier?: number | null;
      signal_note?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("plan_contributions")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "plan_id,date" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["plan_contributions", vars.plan_id] });
    },
  });
}
```

with:

```typescript
export function useUpsertContribution() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      plan_id: string;
      date: string;
      planned_amount: number;
      actual_amount: number;
      price?: number | null;
      units?: number | null;
      multiplier?: number | null;
      signal_note?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("plan_contributions")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "plan_id,date" })
        .select()
        .single();
      if (error) throw error;
      return data as PlanContribution;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["plan_contributions", vars.plan_id] });
    },
  });
}
```

- [ ] **Step 2: Replace the manual averaging in `portfolio-sync.ts` with a lot insert**

Replace the full contents of `wealth-navigator/src/lib/portfolio-sync.ts` with:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { InvestmentPlan } from "./planning-api";
import { suggestPosition } from "./position-match";
import { insertPositionLot } from "./position-lots-api";

const ASSET_TYPE_BY_CLASS: Record<string, string> = {
  rv_core: "fund",
  rv_opp: "etf",
  gold: "other",
  btc: "crypto",
  rf: "bond",
};

/**
 * Vuelca una aportación (con precio) a la posición de portfolio vinculada como
 * un lote de compra: la resuelve por matcher difuso o la crea si no hay.
 */
export function useSyncContributionToPosition() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      plan: InvestmentPlan;
      amount: number;
      units: number;
      date: string;
      contributionId: string;
    }) => {
      const { plan, amount, units, date, contributionId } = input;
      if (units <= 0) return;
      const price = amount / units;

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

      if (!targetId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: created, error: cErr } = await (supabase as any)
          .from("portfolio_positions")
          .insert({
            user_id: user!.id,
            asset_name: plan.asset_name,
            asset_type: ASSET_TYPE_BY_CLASS[plan.asset_class ?? ""] ?? "other",
            platform: "",
            quantity: 0,
            avg_cost: 0,
            current_price: price,
            currency: "EUR",
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        targetId = created.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("investment_plans")
          .update({ portfolio_position_id: targetId })
          .eq("id", plan.id);
      }

      await insertPositionLot({
        user_id: user!.id,
        position_id: targetId!,
        plan_contribution_id: contributionId,
        date,
        quantity: units,
        price,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["investment_plans"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
      qc.invalidateQueries({ queryKey: ["position_lots"] });
    },
  });
}
```

Note: `applyContribution` (the old pure helper) and its test file `portfolio-sync.test.ts` are removed since the averaging logic now lives in `aggregateLots` (Task 2), already tested there — delete both.

- [ ] **Step 3: Thread the contribution id through `ContributionModal.onSubmit`**

In `wealth-navigator/src/components/planning/InvestmentPlanning.tsx`, replace:

```typescript
  async function onSubmit(values: ContributionForm) {
    await upsert.mutateAsync({
      plan_id: plan.id,
      date: values.date + "-01",
      planned_amount: planned,
      actual_amount: values.actual_amount,
      price: values.price ?? null,
      units: values.price ? values.actual_amount / values.price : null,
      multiplier: values.multiplier ?? null,
    });
    if (feedsPortfolio(month) && values.price && values.price > 0) {
      syncPosition.mutate({
        plan,
        amount: values.actual_amount,
        units: values.actual_amount / values.price,
      });
    }
    onClose();
  }
```

with:

```typescript
  async function onSubmit(values: ContributionForm) {
    const date = values.date + "-01";
    const contribution = await upsert.mutateAsync({
      plan_id: plan.id,
      date,
      planned_amount: planned,
      actual_amount: values.actual_amount,
      price: values.price ?? null,
      units: values.price ? values.actual_amount / values.price : null,
      multiplier: values.multiplier ?? null,
    });
    if (feedsPortfolio(month) && values.price && values.price > 0) {
      syncPosition.mutate({
        plan,
        amount: values.actual_amount,
        units: values.actual_amount / values.price,
        date,
        contributionId: contribution.id,
      });
    }
    onClose();
  }
```

- [ ] **Step 4: Delete the now-redundant test file for the old averaging helper**

```bash
cd wealth-navigator
rm src/lib/portfolio-sync.test.ts
```

- [ ] **Step 5: Run the test suite and typecheck**

Run: `cd wealth-navigator && npm test && npx tsc --noEmit`
Expected: all tests pass (one fewer suite than before — `portfolio-sync.test.ts` removed, `position-lots-calc.test.ts` and `position-lots-backfill.test.ts` added, net count should be equal or higher), no type errors.

- [ ] **Step 6: Commit**

```bash
cd wealth-navigator
git add src/lib/planning-api.ts src/lib/portfolio-sync.ts src/components/planning/InvestmentPlanning.tsx
git rm src/lib/portfolio-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(planning): sync DCA contributions to position_lots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 7: `PositionLotsTable` UI + wire into `PositionSheet`

**Files:**
- Create: `wealth-navigator/src/components/app/PositionLotsTable.tsx`
- Modify: `wealth-navigator/src/components/app/PositionSheet.tsx`

**Interfaces:**
- Consumes: `usePositionLots`, `useUpdateLot`, `useDeleteLot`, `useCreateLot`, `type PositionLot` from `@/lib/position-lots-api` (Task 5).
- Produces: `PositionLotsTable({ positionId, currency }: { positionId: string; currency: string })` — a self-contained list+inline-edit+delete component, consumed by `PositionSheet.tsx`.

- [ ] **Step 1: Write `PositionLotsTable.tsx`**

```tsx
import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  usePositionLots,
  useUpdateLot,
  useDeleteLot,
  type PositionLot,
} from "@/lib/position-lots-api";

function n(val: string) {
  return parseFloat(val.replace(",", "."));
}

export function PositionLotsTable({ positionId, currency }: { positionId: string; currency: string }) {
  const { data: lots = [], isLoading } = usePositionLots(positionId);
  const updateLot = useUpdateLot();
  const deleteLot = useDeleteLot();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startEdit(lot: PositionLot) {
    setEditingId(lot.id);
    setEditQty(String(lot.quantity));
    setEditPrice(String(lot.price));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveEdit(lot: PositionLot) {
    const quantity = n(editQty);
    const price = n(editPrice);
    if (!(quantity > 0) || !(price > 0)) {
      setError("Cantidad y precio deben ser mayores que 0.");
      return;
    }
    try {
      await updateLot.mutateAsync({ id: lot.id, position_id: positionId, quantity, price });
      setEditingId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    }
  }

  async function handleDelete(lot: PositionLot) {
    setError(null);
    try {
      await deleteLot.mutateAsync({
        id: lot.id,
        position_id: positionId,
        plan_contribution_id: lot.plan_contribution_id,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al borrar.");
    }
  }

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        Historial de compras
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] text-[12px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1">Fecha</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Importe</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const isEditing = editingId === lot.id;
              return (
                <tr key={lot.id} className="border-t border-border">
                  <td className="py-1.5">{lot.date}</td>
                  {isEditing ? (
                    <>
                      <td className="py-1 pr-1">
                        <Input
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          className="h-7 w-20 text-[12px] tabular-nums"
                        />
                      </td>
                      <td className="py-1 pr-1">
                        <Input
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="h-7 w-20 text-[12px] tabular-nums"
                        />
                      </td>
                      <td className="tabular-nums text-muted-foreground">
                        {(n(editQty || "0") * n(editPrice || "0")).toFixed(2)} {currency}
                      </td>
                      <td className="flex items-center gap-1 py-1">
                        <button
                          type="button"
                          onClick={() => saveEdit(lot)}
                          disabled={updateLot.isPending}
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={cancelEdit} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="tabular-nums">{lot.quantity}</td>
                      <td className="tabular-nums">
                        {lot.price.toFixed(4)} {currency}
                      </td>
                      <td className="tabular-nums text-muted-foreground">
                        {(lot.quantity * lot.price).toFixed(2)} {currency}
                      </td>
                      <td className="flex items-center gap-2 py-1">
                        <button type="button" onClick={() => startEdit(lot)} className="text-muted-foreground hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {!lot.plan_contribution_id && (
                          <button
                            type="button"
                            onClick={() => handleDelete(lot)}
                            disabled={deleteLot.isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {lot.plan_contribution_id && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            DCA
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire `PositionLotsTable` into `PositionSheet.tsx` and repoint "add-shares" to create a lot**

In `wealth-navigator/src/components/app/PositionSheet.tsx`:

1. Add the import:

```typescript
import { PositionLotsTable } from "@/components/app/PositionLotsTable";
import { useCreateLot } from "@/lib/position-lots-api";
```

2. Add `const createLot = useCreateLot();` next to the existing `const createPosition = useCreatePosition();` / `const updatePosition = useUpdatePosition();` lines, and include it in `isPending`:

```typescript
  const isPending = createPosition.isPending || updatePosition.isPending || createLot.isPending;
```

3. Replace `handleAddShares` (currently patches the aggregate directly) with:

```typescript
  async function handleAddShares(e: React.FormEvent) {
    e.preventDefault();
    if (!position || addQtyNum <= 0 || addPriceNum <= 0) return;

    await createLot.mutateAsync({
      position_id: position.id,
      date: todayStr(),
      quantity: addQtyNum,
      price: addPriceNum,
    });
    setAddQty("");
    setAddPrice("");
  }
```

(Note the change from `addPriceNum < 0` to `addPriceNum <= 0` in the guard, and from `min="0"` semantics — `position_lots.price` has a DB check `> 0`, so a 0 price must be rejected client-side too. Also note it no longer calls `onOpenChange(false)` — the sheet stays open so the user can see the new lot appear in the table below and add more than one lot in a row; add a "Cerrar" affordance via the existing "Cancelar" button, which already closes on click.)

4. Update the "Confirmar compra" button's `disabled` condition to match the new guard:

```typescript
              <Button
                type="submit"
                disabled={isPending || addQtyNum <= 0 || addPriceNum <= 0}
                className="min-w-[100px]"
              >
```

5. Render the lots table for both non-create modes, right after the closing `</form>` of the `add-shares` branch and also after the closing `</form>` of the `edit` branch (i.e., inside the top-level return, after the `{mode === "add-shares" ? (...) : (...)}` block, before the closing `</SheetContent>`):

```tsx
        {mode !== "create" && position && (
          <div className="mt-6 border-t border-border px-1 pt-4">
            <PositionLotsTable positionId={position.id} currency={position.currency} />
          </div>
        )}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd wealth-navigator && npx tsc --noEmit && npx eslint src/components/app/PositionLotsTable.tsx src/components/app/PositionSheet.tsx`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd wealth-navigator && npm run dev`, open Portfolio, click on MSCI Emerging.
Check:
- The "Historial de compras" table shows the backfilled lots (Task 4 must have run already).
- Editing the mis-priced lot's price updates the row, and the position's "Precio medio" in the drawer changes accordingly.
- Opening MSCI World shows its real DCA-derived lots (with a "DCA" badge, no delete button).
- "Añadir compra" on a manual position creates a new row in the table without closing the sheet.
- Trying to delete the last remaining lot of a position shows the inline error and does not delete it.

- [ ] **Step 5: Commit**

```bash
cd wealth-navigator
git add src/components/app/PositionLotsTable.tsx src/components/app/PositionSheet.tsx
git commit -m "$(cat <<'EOF'
feat(portfolio): add editable purchase-lot log to position panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```

---

### Task 8: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `cd wealth-navigator && npm test`
Expected: all tests pass.

- [ ] **Step 2: Run the build**

Run: `cd wealth-navigator && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Run lint on all touched files**

Run: `cd wealth-navigator && npx eslint src/lib/position-lots-calc.ts src/lib/position-lots-backfill.ts src/lib/position-lots-api.ts src/lib/portfolio-sync.ts src/lib/planning-api.ts src/components/planning/InvestmentPlanning.tsx src/components/app/PositionLotsTable.tsx src/components/app/PositionSheet.tsx scripts/backfill-position-lots.ts`
Expected: no errors from these files.

- [ ] **Step 4: Manual end-to-end check of the DCA sync path**

Run: `cd wealth-navigator && npm run dev`, open Planning, register a new contribution with a price for the MSCI World plan.
Check: the new contribution appears in Planning's `ContributionLog`, and a matching new lot (with the "DCA" badge) appears in Portfolio's position panel for MSCI World with the same date/quantity/price.
