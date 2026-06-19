# Backfill de aportaciones + Actualizar precios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All implementer/reviewer subagents must use the `sonnet` model — never opus or fable.**

**Goal:** Add bulk backfill of past contributions (log-only) to investment plans, gate portfolio sync to the current month only, and add a "Actualizar precios" button that refreshes quoted positions (stock/etf/crypto) via Yahoo, converted to EUR.

**Architecture:** Pure rule `feedsPortfolio(month)` (sync iff current month) shared by the contribution modal and the new bulk backfill editor. A Deno Edge Function `prices-sync` fetches Yahoo prices server-side (browser CORS-blocked), converts non-EUR to EUR via Yahoo FX, and updates the user's positions under RLS.

**Tech Stack:** Vite + React + TanStack Query, Supabase (Postgres/RLS, Edge Functions Deno), Vitest, sonner (toasts).

**Spec:** `docs/superpowers/specs/2026-06-19-backfill-and-price-sync-design.md`

**Working dir:** `/home/manidmt/Desktop/wealth-os/wealth-navigator` (single git repo at `/home/manidmt/Desktop/wealth-os`). Branch: `feature/investment-planning-intelligence` (current).

---

## File Structure

**New:**
- `src/lib/contribution-sync-rule.ts` (+ `.test.ts`) — `feedsPortfolio(month, now?)`.
- `src/lib/backfill-contributions.ts` (+ `.test.ts`) — row parsing/validation/build.
- `src/components/planning/BackfillContributions.tsx` — bulk editor block.
- `src/lib/prices-api.ts` — `useSyncPrices` hook + `PriceSyncResult` type.
- `supabase/functions/prices-sync/index.ts` — Deno Edge Function.

**Modified:**
- `src/components/planning/ContributionLog.tsx` — mount `<BackfillContributions>`.
- `src/components/planning/InvestmentPlanning.tsx` — `ContributionModal` uses `feedsPortfolio`; `ContributionHistory` mounts `<BackfillContributions>`.
- `src/routes/portfolio.tsx` — "Actualizar precios" button.

**Baseline note:** the repo already has some pre-existing `tsc --noEmit` errors in unrelated files (budget-api.ts, movements-api.ts, a few Recharts/CreatePlanInput lines in InvestmentPlanning.tsx). Ignore them. The gate is: new tests pass, `npm run build` succeeds, and no NEW tsc errors reference the files you touched.

---

## Task 1: `feedsPortfolio` rule (pure, TDD)

**Files:**
- Create: `src/lib/contribution-sync-rule.ts`
- Test: `src/lib/contribution-sync-rule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/contribution-sync-rule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { feedsPortfolio } from "./contribution-sync-rule";

const now = new Date("2026-06-19T00:00:00Z");

describe("feedsPortfolio", () => {
  it("is true for the current month", () => {
    expect(feedsPortfolio("2026-06", now)).toBe(true);
  });
  it("is false for a past month", () => {
    expect(feedsPortfolio("2026-03", now)).toBe(false);
  });
  it("is false for a future month", () => {
    expect(feedsPortfolio("2026-07", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/contribution-sync-rule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/contribution-sync-rule.ts`:

```ts
/**
 * Una aportación alimenta la posición del portfolio SOLO si su mes (YYYY-MM)
 * es el mes actual. Las aportaciones pasadas (backfill) quedan en log-only para
 * no duplicar lo que el portfolio ya refleja.
 */
export function feedsPortfolio(month: string, now: Date = new Date()): boolean {
  return month === now.toISOString().slice(0, 7);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/contribution-sync-rule.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contribution-sync-rule.ts src/lib/contribution-sync-rule.test.ts
git commit -m "feat: feedsPortfolio rule (sync only current-month contributions)"
```

---

## Task 2: `backfill-contributions` module (pure, TDD)

**Files:**
- Create: `src/lib/backfill-contributions.ts`
- Test: `src/lib/backfill-contributions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/backfill-contributions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emptyRow, isValidRow, buildContributions } from "./backfill-contributions";

describe("emptyRow", () => {
  it("returns blank fields", () => {
    expect(emptyRow()).toEqual({ month: "", amount: "", price: "" });
  });
});

describe("isValidRow", () => {
  it("accepts a well-formed row", () => {
    expect(isValidRow({ month: "2026-03", amount: "400", price: "10.40" })).toBe(true);
  });
  it("rejects a bad month", () => {
    expect(isValidRow({ month: "2026-13", amount: "400", price: "10" })).toBe(false);
    expect(isValidRow({ month: "2026-3", amount: "400", price: "10" })).toBe(false);
    expect(isValidRow({ month: "", amount: "400", price: "10" })).toBe(false);
  });
  it("rejects non-positive amount or price", () => {
    expect(isValidRow({ month: "2026-03", amount: "0", price: "10" })).toBe(false);
    expect(isValidRow({ month: "2026-03", amount: "400", price: "0" })).toBe(false);
    expect(isValidRow({ month: "2026-03", amount: "", price: "10" })).toBe(false);
  });
});

describe("buildContributions", () => {
  it("builds only valid rows, computing units and date, parsing comma decimals", () => {
    const rows = [
      { month: "2026-03", amount: "400", price: "10,40" },
      { month: "bad", amount: "1", price: "1" },
      { month: "2026-04", amount: "500", price: "10" },
    ];
    const built = buildContributions(rows);
    expect(built).toHaveLength(2);
    expect(built[0]).toEqual({
      month: "2026-03",
      date: "2026-03-01",
      amount: 400,
      price: 10.4,
      units: 400 / 10.4,
    });
    expect(built[1].units).toBe(50);
    expect(built[1].date).toBe("2026-04-01");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/backfill-contributions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/backfill-contributions.ts`:

```ts
export type BackfillRow = { month: string; amount: string; price: string };

export type BuiltContribution = {
  month: string; // YYYY-MM
  date: string; // YYYY-MM-01
  amount: number;
  price: number;
  units: number;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function num(v: string): number {
  return parseFloat(String(v).replace(",", "."));
}

export function emptyRow(): BackfillRow {
  return { month: "", amount: "", price: "" };
}

export function isValidRow(row: BackfillRow): boolean {
  if (!MONTH_RE.test(row.month)) return false;
  const amount = num(row.amount);
  const price = num(row.price);
  return Number.isFinite(amount) && amount > 0 && Number.isFinite(price) && price > 0;
}

export function buildContributions(rows: BackfillRow[]): BuiltContribution[] {
  return rows.filter(isValidRow).map((row) => {
    const amount = num(row.amount);
    const price = num(row.price);
    return {
      month: row.month,
      date: `${row.month}-01`,
      amount,
      price,
      units: amount / price,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/backfill-contributions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backfill-contributions.ts src/lib/backfill-contributions.test.ts
git commit -m "feat: backfill-contributions parsing module"
```

---

## Task 3: Gate ContributionModal sync to current month

**Files:**
- Modify: `src/components/planning/InvestmentPlanning.tsx` (the `ContributionModal` component)

Context: `ContributionModal` already computes `const month = dateValue?.slice(0, 7) ?? "";` and, in `onSubmit`, syncs to the portfolio whenever `values.price > 0`. Change it to also require the current month via `feedsPortfolio`.

- [ ] **Step 1: Import the rule**

At the top of `src/components/planning/InvestmentPlanning.tsx`, add to the existing imports:

```ts
import { feedsPortfolio } from "@/lib/contribution-sync-rule";
```

- [ ] **Step 2: Update the sync condition**

In `ContributionModal`'s `onSubmit`, locate:

```ts
    if (values.price && values.price > 0) {
      syncPosition.mutate({
        plan,
        amount: values.actual_amount,
        units: values.actual_amount / values.price,
      });
    }
```

Replace the `if` condition with:

```ts
    if (feedsPortfolio(month) && values.price && values.price > 0) {
      syncPosition.mutate({
        plan,
        amount: values.actual_amount,
        units: values.actual_amount / values.price,
      });
    }
```

(`month` is already in scope in `ContributionModal`. The contribution itself is still upserted regardless of month; only the portfolio sync is gated.)

- [ ] **Step 3: Typecheck + build**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit 2>&1 | grep "InvestmentPlanning.tsx" ; npm run build`
Expected: no NEW tsc errors mentioning `feedsPortfolio`/`month`; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/InvestmentPlanning.tsx
git commit -m "feat: gate contribution-to-portfolio sync to current month"
```

---

## Task 4: BackfillContributions component + mount in logs

**Files:**
- Create: `src/components/planning/BackfillContributions.tsx`
- Modify: `src/components/planning/ContributionLog.tsx`
- Modify: `src/components/planning/InvestmentPlanning.tsx` (`ContributionHistory`)

Hooks/signatures to reuse (verify before use):
- `useUpsertContribution()` → mutation; `mutateAsync({ plan_id, date, planned_amount, actual_amount, price, units, multiplier, signal_note? })`. It invalidates `["plan_contributions", plan_id]` on success.
- `useSyncContributionToPosition()` → mutation; `mutateAsync({ plan, amount, units })`.
- `computePlannedAmount(plan, monthlyFinancials, month)` from `@/lib/planning-calc`.
- `feedsPortfolio(month)` from `@/lib/contribution-sync-rule` (Task 1).
- `buildContributions`, `emptyRow`, `isValidRow`, type `BackfillRow` from `@/lib/backfill-contributions` (Task 2).
- `toast` from `sonner`.
- `useQueryClient` from `@tanstack/react-query` (to invalidate `["plan_contributions","all"]`).
- `MonthlyFinancials` type from `@/lib/planning-calc`.

- [ ] **Step 1: Create `BackfillContributions.tsx`**

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import type { InvestmentPlan } from "@/lib/planning-api";
import { useUpsertContribution } from "@/lib/planning-api";
import { useSyncContributionToPosition } from "@/lib/portfolio-sync";
import { computePlannedAmount, type MonthlyFinancials } from "@/lib/planning-calc";
import { feedsPortfolio } from "@/lib/contribution-sync-rule";
import {
  emptyRow,
  isValidRow,
  buildContributions,
  type BackfillRow,
} from "@/lib/backfill-contributions";

export function BackfillContributions({
  plan,
  monthlyFinancials = [],
}: {
  plan: InvestmentPlan;
  monthlyFinancials?: MonthlyFinancials[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BackfillRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const upsert = useUpsertContribution();
  const syncPosition = useSyncContributionToPosition();
  const qc = useQueryClient();

  const validCount = rows.filter(isValidRow).length;

  function setRow(i: number, patch: Partial<BackfillRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)));
  }

  async function save() {
    const built = buildContributions(rows);
    if (built.length === 0) return;
    setSaving(true);
    try {
      for (const c of built) {
        await upsert.mutateAsync({
          plan_id: plan.id,
          date: c.date,
          planned_amount: computePlannedAmount(plan, monthlyFinancials, c.month),
          actual_amount: c.amount,
          price: c.price,
          units: c.units,
          multiplier: null,
        });
        if (feedsPortfolio(c.month)) {
          await syncPosition.mutateAsync({ plan, amount: c.amount, units: c.units });
        }
      }
      qc.invalidateQueries({ queryKey: ["plan_contributions", "all"] });
      toast.success(`${built.length} aportación${built.length === 1 ? "" : "es"} guardada${built.length === 1 ? "" : "s"}`);
      setRows([emptyRow()]);
    } catch (e) {
      toast.error(`No se pudieron guardar: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground/80 hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Añadir aportaciones
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] text-muted-foreground">
            <span>Mes</span>
            <span>Importe €</span>
            <span>Precio</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
              <Input
                type="month"
                value={row.month}
                onChange={(e) => setRow(i, { month: e.target.value })}
                className="h-8 text-[12.5px]"
              />
              <Input
                type="number"
                step="any"
                placeholder="400"
                value={row.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                className="h-8 text-[12.5px] tabular-nums"
              />
              <Input
                type="number"
                step="any"
                placeholder="10.40"
                value={row.price}
                onChange={(e) => setRow(i, { price: e.target.value })}
                className="h-8 text-[12.5px] tabular-nums"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Eliminar fila"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 text-[12px] text-foreground/70 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir fila
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || validCount === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Guardando…" : `Guardar ${validCount} aportacion${validCount === 1 ? "" : "es"}`}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Las aportaciones de meses pasados solo se registran en el log; no se suman al portfolio.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `ContributionLog.tsx`**

In `src/components/planning/ContributionLog.tsx`, add the import at the top:

```ts
import { BackfillContributions } from "@/components/planning/BackfillContributions";
```

Then render it just before the closing `</SectionCard>` (after the totals `<div>`):

```tsx
      <BackfillContributions plan={plan} />
    </SectionCard>
```

(`ContributionLog` has no `monthlyFinancials` in scope; omit the prop — it defaults to `[]`.)

- [ ] **Step 3: Mount in `ContributionHistory` (`InvestmentPlanning.tsx`)**

In `src/components/planning/InvestmentPlanning.tsx`, add the import near the other component imports:

```ts
import { BackfillContributions } from "@/components/planning/BackfillContributions";
```

In the `ContributionHistory` function (which receives `{ plan, monthlyFinancials }`), render the editor just before the closing `</SectionCard>`:

```tsx
      <BackfillContributions plan={plan} monthlyFinancials={monthlyFinancials} />
    </SectionCard>
```

Note: `ContributionHistory` currently destructures `monthlyFinancials: _monthlyFinancials` (prefixed unused). Rename it back to `monthlyFinancials` so it can be passed through, and remove the eslint-unused prefix.

- [ ] **Step 4: Typecheck, lint, build**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx eslint src/components/planning/BackfillContributions.tsx src/components/planning/ContributionLog.tsx src/components/planning/InvestmentPlanning.tsx && npm run build`
Expected: eslint clean on those files, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: bulk backfill editor for past contributions (log-only)"
```

---

## Task 5: `prices-sync` Edge Function

**Files:**
- Create: `supabase/functions/prices-sync/index.ts`

Mirror `supabase/functions/signals-sync/index.ts` structure (serve + `_shared/cors.ts`), but use the **caller's JWT** (RLS) instead of the service role.

- [ ] **Step 1: Write the function**

Create `supabase/functions/prices-sync/index.ts`:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const YH = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };
const QUOTED = ["stock", "etf", "crypto"];

async function yahooQuote(symbol: string): Promise<{ price: number; currency: string }> {
  const r = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description ?? "respuesta vacía");
  const closes = (result.indicators.quote[0].close as (number | null)[]).filter((c) => c != null);
  if (closes.length === 0) throw new Error("sin cierres");
  return { price: closes[closes.length - 1] as number, currency: result.meta?.currency ?? "EUR" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const today = new Date().toISOString().slice(0, 10);
  const updated: { name: string; price: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const fxCache = new Map<string, number>();

  async function fxToEur(cur: string): Promise<number> {
    if (cur === "EUR") return 1;
    if (fxCache.has(cur)) return fxCache.get(cur)!;
    const { price } = await yahooQuote(`${cur}EUR=X`);
    fxCache.set(cur, price);
    return price;
  }

  const { data: positions, error } = await db
    .from("portfolio_positions")
    .select("id, asset_name, ticker, currency, asset_type, updated_at")
    .in("asset_type", QUOTED);
  if (error) return corsResponse({ error: error.message }, 400);

  const eligible = (positions ?? []).filter(
    (p: { ticker: string | null; updated_at: string }) =>
      p.ticker && p.ticker.trim() !== "" &&
      new Date(p.updated_at).toISOString().slice(0, 10) < today,
  );

  for (const p of eligible) {
    try {
      const { price, currency } = await yahooQuote(p.ticker as string);
      const rate = await fxToEur((currency ?? "EUR").toUpperCase());
      const eurPrice = price * rate;
      const { error: uErr } = await db
        .from("portfolio_positions")
        .update({ current_price: eurPrice })
        .eq("id", p.id);
      if (uErr) throw new Error(uErr.message);
      updated.push({ name: p.asset_name, price: eurPrice });
    } catch (e) {
      skipped.push({ name: p.asset_name, reason: e instanceof Error ? e.message : "error" });
    }
  }

  return corsResponse({ updated, skipped });
});
```

- [ ] **Step 2: Lint check (Deno is not part of the JS build; just eyeball)**

This file is Deno (URL imports). It is NOT type-checked by the project `tsc`/eslint. Verify visually that it mirrors `signals-sync/index.ts` imports and that `corsResponse` is used. No build step here.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/prices-sync/index.ts
git commit -m "feat: prices-sync edge function (Yahoo quotes to EUR, RLS-scoped)"
```

**Deploy note (controller does this, not the implementer):** `npx supabase functions deploy prices-sync` then manual test. Do NOT deploy from the implementer subagent.

---

## Task 6: `useSyncPrices` hook + portfolio button

**Files:**
- Create: `src/lib/prices-api.ts`
- Modify: `src/routes/portfolio.tsx`

- [ ] **Step 1: Create the hook**

Create `src/lib/prices-api.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PriceSyncResult = {
  updated: { name: string; price: number }[];
  skipped: { name: string; reason: string }[];
};

export function useSyncPrices() {
  const qc = useQueryClient();
  return useMutation<PriceSyncResult>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("prices-sync", { body: {} });
      if (error) throw error;
      return data as PriceSyncResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
```

- [ ] **Step 2: Add the button in `portfolio.tsx`**

In `src/routes/portfolio.tsx`:
- Add imports:
  ```ts
  import { RefreshCw } from "lucide-react";
  import { toast } from "sonner";
  import { useSyncPrices } from "@/lib/prices-api";
  ```
- Inside `PortfolioPage`, near the other hooks, add:
  ```ts
  const syncPrices = useSyncPrices();

  function handleSyncPrices() {
    syncPrices.mutate(undefined, {
      onSuccess: (res) => {
        const parts = [`${res.updated.length} actualizada${res.updated.length === 1 ? "" : "s"}`];
        if (res.skipped.length > 0) parts.push(`${res.skipped.length} omitida${res.skipped.length === 1 ? "" : "s"}`);
        toast.success(parts.join(" · "));
        if (res.skipped.length > 0) {
          toast.message("Omitidas", { description: res.skipped.map((s) => `${s.name}: ${s.reason}`).join("\n") });
        }
      },
      onError: (e) => toast.error(`No se pudieron actualizar: ${e instanceof Error ? e.message : "error"}`),
    });
  }
  ```
- In the `PageHeader` `actions` prop, currently a single "Añadir posición" `<button>`. Wrap it together with a new button so both render. Replace the `actions={ <button ...>Añadir posición</button> }` with:
  ```tsx
  actions={
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleSyncPrices}
        disabled={syncPrices.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${syncPrices.isPending ? "animate-spin" : ""}`} />
        {syncPrices.isPending ? "Actualizando…" : "Actualizar precios"}
      </button>
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
      >
        <span className="text-[16px] leading-none">+</span>
        Añadir posición
      </button>
    </div>
  }
  ```

- [ ] **Step 3: Typecheck, lint, build**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx eslint src/lib/prices-api.ts src/routes/portfolio.tsx && npx tsc --noEmit 2>&1 | grep -E "prices-api|portfolio.tsx" ; npm run build`
Expected: eslint clean; no NEW tsc errors in those files; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prices-api.ts src/routes/portfolio.tsx
git commit -m "feat: 'Actualizar precios' button wired to prices-sync"
```

---

## Final verification (controller)

- [ ] `npm run test` — all Vitest suites pass (incl. contribution-sync-rule, backfill-contributions).
- [ ] `npm run build` — clean.
- [ ] Deploy the edge function: `npx supabase functions deploy prices-sync`.
- [ ] Manual: in a plan log, "Añadir aportaciones" → add a past month (e.g. 2026-03, 400, 10.40) + Guardar → appears in log, portfolio unchanged. Register a current-month contribution with price → portfolio position updates.
- [ ] Manual: portfolio → "Actualizar precios" → a stock/ETF with a valid Yahoo ticker updates (price in EUR); positions updated today are skipped; toast summarizes.
- [ ] Deploy frontend: `npm run build && systemctl --user restart wealth-navigator`.

---

## Self-Review notes

- **Spec coverage:** feedsPortfolio rule → Task 1; backfill module → Task 2; modal gating → Task 3; backfill UI + mounts → Task 4; edge function (Yahoo→EUR, RLS, skip/report) → Task 5; hook + button + toast → Task 6. All covered.
- **Type consistency:** `BackfillRow`/`BuiltContribution` fields and `emptyRow`/`isValidRow`/`buildContributions` signatures match between Task 2 and Task 4. `feedsPortfolio(month, now?)` consistent in Tasks 1, 3, 4. `PriceSyncResult` shape (`updated[]`, `skipped[]`) matches between Task 5 (function response) and Task 6 (hook + toast).
- **Placeholder scan:** no TBD/TODO; all steps have concrete code.
