# Cash in Net Worth + Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All implementer/reviewer subagents must use the `sonnet` model — never opus or fable.**

**Goal:** Model cash/liquidity so the "Distribución del patrimonio" donut shows investment-by-category **plus an "Efectivo" slice** summing to real net worth, with optional editable cash accounts and a reconciliation check.

**Architecture:** A pure `cash.ts` resolves cash (sum of user accounts if any, else `netWorth − portfolio`). `dashboard-data.ts` applies `fx_to_eur` to the portfolio, fetches `cash_accounts`, adds the Efectivo slice to `allocation`, and overrides the live net worth when accounts exist. A `CashAccountsCard` on the Patrimonio page edits accounts and shows reconciliation.

**Tech Stack:** Vite + React + TanStack Query, Supabase (Postgres/RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-cash-in-net-worth-design.md`

**Working dir:** `/home/manidmt/Desktop/wealth-os/wealth-navigator` (single git repo at `/home/manidmt/Desktop/wealth-os`). Branch: `feature/cash-in-net-worth` (current).

**Baseline note:** repo has pre-existing unrelated `tsc --noEmit` errors (budget-api.ts, movements-api.ts, InvestmentPlanning.tsx Recharts/CreatePlanInput). Ignore them. Gate per task: new tests pass, `npm run build` succeeds, no NEW tsc errors in touched files.

---

## File Structure

**New:**
- `src/lib/cash.ts` (+ `.test.ts`) — `accountsTotal`, `resolveCash`, types.
- `src/lib/cash-api.ts` — `useCashAccounts`, `useUpsertCashAccount`, `useDeleteCashAccount`.
- `src/components/app/CashAccountsCard.tsx` — editor + reconciliation.
- `supabase/migrations/20260622120000_cash_accounts.sql`.

**Modified:**
- `src/lib/dashboard-data.ts` — fx_to_eur, fetch accounts, computeDashboard, allocation Efectivo, `cash` in DashboardData.
- `src/routes/net-worth.tsx` — mount `<CashAccountsCard />`.

---

## Task 1: `cash.ts` resolver (pure, TDD)

**Files:**
- Create: `src/lib/cash.ts`
- Test: `src/lib/cash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { accountsTotal, resolveCash } from "./cash";

describe("accountsTotal", () => {
  it("sums balances", () => {
    expect(accountsTotal([{ balance: 4000 }, { balance: 12000 }])).toBe(16000);
  });
  it("is 0 for no accounts", () => {
    expect(accountsTotal([])).toBe(0);
  });
});

describe("resolveCash", () => {
  it("uses derived (netWorth - portfolio) when there are no accounts", () => {
    const r = resolveCash({ accounts: [], netWorthSnapshot: 39000, portfolioEur: 19000 });
    expect(r.source).toBe("derived");
    expect(r.derived).toBe(20000);
    expect(r.total).toBe(20000);
    expect(r.accountsTotal).toBe(0);
    expect(r.reconcileDelta).toBe(0);
    expect(r.hasAccounts).toBe(false);
  });

  it("uses the accounts sum when accounts exist, and reports the delta vs derived", () => {
    const r = resolveCash({
      accounts: [{ balance: 4000 }, { balance: 12000 }],
      netWorthSnapshot: 39000,
      portfolioEur: 19000,
    });
    expect(r.source).toBe("accounts");
    expect(r.accountsTotal).toBe(16000);
    expect(r.total).toBe(16000);
    expect(r.derived).toBe(20000);
    expect(r.reconcileDelta).toBe(-4000); // 16000 - 20000
    expect(r.hasAccounts).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/cash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/cash.ts`:

```ts
export type CashAccount = {
  id: string;
  name: string;
  balance: number;
  updated_at: string;
};

export type CashResolution = {
  total: number; // efectivo usado (cuentas si las hay, si no derivado)
  derived: number; // patrimonio(snapshot) − cartera
  accountsTotal: number; // suma de saldos de cuentas
  source: "accounts" | "derived";
  reconcileDelta: number; // accountsTotal − derived (0 si no hay cuentas)
  hasAccounts: boolean;
};

export function accountsTotal(accounts: { balance: number }[]): number {
  return accounts.reduce((s, a) => s + a.balance, 0);
}

export function resolveCash(input: {
  accounts: { balance: number }[];
  netWorthSnapshot: number;
  portfolioEur: number;
}): CashResolution {
  const total = accountsTotal(input.accounts);
  const derived = input.netWorthSnapshot - input.portfolioEur;
  const hasAccounts = input.accounts.length > 0;
  return {
    total: hasAccounts ? total : derived,
    derived,
    accountsTotal: total,
    source: hasAccounts ? "accounts" : "derived",
    reconcileDelta: hasAccounts ? total - derived : 0,
    hasAccounts,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/cash.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cash.ts src/lib/cash.test.ts
git commit -m "feat: cash resolver (accounts sum or derived from snapshot)"
```

---

## Task 2: `cash_accounts` table + hooks

**Files:**
- Create: `supabase/migrations/20260622120000_cash_accounts.sql`
- Create: `src/lib/cash-api.ts`

Do NOT run `supabase db push` (the controller applies the migration). Just create files and commit.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260622120000_cash_accounts.sql`:

```sql
create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  balance numeric not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.cash_accounts enable row level security;
create policy "own cash accounts" on public.cash_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Write the hooks**

Create `src/lib/cash-api.ts` (import paths match `planning-api.ts`: supabase from `@/integrations/supabase/client`, useAuth from `@/hooks/use-auth`):

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { CashAccount } from "./cash";

export function useCashAccounts() {
  const { user } = useAuth();
  return useQuery<CashAccount[]>({
    queryKey: ["cash_accounts"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("cash_accounts")
        .select("id, name, balance, updated_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // PostgREST devuelve numeric como string → number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((a: any) => ({ ...a, balance: Number(a.balance) }));
    },
    enabled: !!user,
  });
}

export function useUpsertCashAccount() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; balance: number }) => {
      const row = {
        user_id: user!.id,
        name: input.name,
        balance: input.balance,
        updated_at: new Date().toISOString(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error } = input.id
        ? await db.from("cash_accounts").update(row).eq("id", input.id)
        : await db.from("cash_accounts").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash_accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useDeleteCashAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("cash_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash_accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "cash-api|cash.ts"` — expect no output.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622120000_cash_accounts.sql src/lib/cash-api.ts
git commit -m "feat: cash_accounts table and hooks"
```

---

## Task 3: Wire cash into `dashboard-data.ts`

**Files:**
- Modify: `src/lib/dashboard-data.ts`

Four changes: (a) apply `fx_to_eur` to portfolio valuation; (b) `cash` field on `DashboardData`; (c) `computeDashboard` accepts accounts, resolves cash, overrides live NW, adds Efectivo to allocation, returns `cash`; (d) the query fetches `cash_accounts`.

- [ ] **Step 1: Add `cash` to the `DashboardData` type and import the resolver**

At the top of `src/lib/dashboard-data.ts`, add to the imports:

```ts
import { resolveCash, type CashResolution } from "./cash";
```

In the `DashboardData` type, add a field (next to `allocation`):

```ts
  cash: CashResolution;
```

- [ ] **Step 2: Apply `fx_to_eur` to the portfolio valuation**

In `computeDashboard`, the portfolio block currently values positions with `quantity * current_price`. Replace the three spots:

`totalPortfolio`:
```ts
  const totalPortfolio = positions.reduce(
    (s: number, p: Record<string, unknown>) =>
      s + Number(p.quantity) * Number(p.current_price) * (Number(p.fx_to_eur) || 1),
    0,
  );
```

The `for (const p of positions)` loop's `val`:
```ts
    const val =
      Number((p as Record<string, unknown>).quantity) *
      Number((p as Record<string, unknown>).current_price) *
      (Number((p as Record<string, unknown>).fx_to_eur) || 1);
```

The `holdings` map's `value`:
```ts
      value: Number(p.quantity) * Number(p.current_price) * (Number(p.fx_to_eur) || 1),
```

- [ ] **Step 3: Accept accounts, resolve cash, override live NW, add Efectivo**

Change the signature:
```ts
function computeDashboard(
  movements: any[],
  positions: any[],
  snapshots: any[],
  cashAccounts: { balance: unknown }[],
): DashboardData {
```

Find the line `const liveNW = baseNW + currentSavings + portfolioDelta;` and immediately AFTER it, insert:

```ts
  const cash = resolveCash({
    accounts: cashAccounts.map((a) => ({ balance: Number(a.balance) })),
    netWorthSnapshot: liveNW,
    portfolioEur: totalPortfolio,
  });
  const finalNW = cash.source === "accounts" ? totalPortfolio + cash.total : liveNW;
```

Then in the `liveEntryData` object that follows, replace `assets`/`netWorth` to use `finalNW`:
```ts
  const liveEntryData = {
    month: currentCalendarMonth,
    assets: finalNW - baseLiabilities,
    liabilities: baseLiabilities,
    netWorth: finalNW,
    savings: currentSavings,
  };
```

(Leave the rest of the live-entry/series logic unchanged.)

- [ ] **Step 4: Add the Efectivo slice to `allocation` and return `cash`**

The `allocation` const is built earlier (`const allocation = [...byCategoryMap.entries()]...`). Do NOT change its definition. In the final `return { ... }` object, replace `allocation,` with a version that appends Efectivo, and add `cash`:

```ts
    allocation:
      cash.total > 0
        ? [...allocation, { label: "Efectivo", value: cash.total }].sort((a, b) => b.value - a.value)
        : allocation,
    cash,
```

(`allocation` and `cash` are both already in scope at the return.)

- [ ] **Step 5: Fetch `cash_accounts` in the query and pass it**

In `useLiveDashboardData`'s `Promise.all`, add a fourth fetch and destructure it; pass to `computeDashboard`:

```ts
      const [
        { data: movements, error: movErr },
        { data: positions, error: posErr },
        { data: snapshots, error: snapErr },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { data: cashAccounts, error: cashErr },
      ] = await Promise.all([
        supabase.from("movements").select("type, date, category, amount, currency, excluded").order("date"),
        supabase.from("portfolio_positions").select("*"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("monthly_snapshots").select("month, assets, liabilities, net_worth, savings, portfolio_value").order("month"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("cash_accounts").select("balance"),
      ]);
      if (movErr) throw movErr;
      if (posErr) throw posErr;
      if (snapErr) throw snapErr;
      if (cashErr) throw cashErr;
      return computeDashboard(movements ?? [], positions ?? [], snapshots ?? [], cashAccounts ?? []);
```

**Note:** `placeholderData: rawData as DashboardData` uses a static JSON import (`@/data/dashboard-data.json`). Do NOT modify that JSON. During the placeholder phase `data.cash` is `undefined`; the only consumer (`CashAccountsCard`, Task 4) already reads `data.cash` with a fallback, so there is no runtime crash. The `as DashboardData` cast keeps it compiling. Nothing to change here beyond the fetch wiring above.

- [ ] **Step 6: Typecheck + build**

Run:
```
npx tsc --noEmit 2>&1 | grep "dashboard-data.ts"
npm run build
```
Expected: no NEW errors in dashboard-data.ts; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboard-data.ts
git commit -m "feat: cash slice + fx_to_eur in dashboard allocation and live net worth"
```

---

## Task 4: `CashAccountsCard` + mount on Patrimonio page

**Files:**
- Create: `src/components/app/CashAccountsCard.tsx`
- Modify: `src/routes/net-worth.tsx`

- [ ] **Step 1: Create `CashAccountsCard.tsx`**

```tsx
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { useMoney } from "@/components/app/CurrencyProvider";
import { useDashboard } from "@/hooks/use-dashboard";
import { useCashAccounts, useUpsertCashAccount, useDeleteCashAccount } from "@/lib/cash-api";

export function CashAccountsCard() {
  const money = useMoney();
  const data = useDashboard();
  const { data: accounts = [] } = useCashAccounts();
  const upsert = useUpsertCashAccount();
  const del = useDeleteCashAccount();

  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");

  const cash = data.cash ?? {
    total: 0,
    derived: 0,
    accountsTotal: 0,
    source: "derived" as const,
    reconcileDelta: 0,
    hasAccounts: false,
  };

  function addAccount() {
    const name = newName.trim();
    const balance = parseFloat(newBalance.replace(",", "."));
    if (!name || !Number.isFinite(balance)) return;
    upsert.mutate(
      { name, balance },
      {
        onSuccess: () => {
          setNewName("");
          setNewBalance("");
        },
      },
    );
  }

  const threshold = Math.max(50, Math.abs(cash.derived) * 0.01);
  const drift = cash.hasAccounts && Math.abs(cash.reconcileDelta) > threshold;

  return (
    <SectionCard
      title="Cuentas de efectivo"
      description="Liquidez por cuenta. Si no añades cuentas, se usa el efectivo derivado del último cierre."
    >
      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
            <Input
              type="number"
              step="any"
              defaultValue={String(a.balance)}
              onBlur={(e) => {
                const balance = parseFloat(e.target.value.replace(",", "."));
                if (Number.isFinite(balance) && balance !== a.balance) {
                  upsert.mutate({ id: a.id, name: a.name, balance });
                }
              }}
              className="h-8 w-32 text-right text-[13px] tabular-nums"
            />
            <button
              type="button"
              onClick={() => del.mutate(a.id)}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Borrar cuenta"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Input
            placeholder="Nombre (ej. BBVA)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 flex-1 text-[13px]"
          />
          <Input
            type="number"
            step="any"
            placeholder="Saldo €"
            value={newBalance}
            onChange={(e) => setNewBalance(e.target.value)}
            className="h-8 w-32 text-right text-[13px] tabular-nums"
          />
          <button
            type="button"
            onClick={addAccount}
            className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Añadir cuenta"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-1 border-t border-border pt-3 text-[12.5px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Efectivo en cuentas</span>
          <span className="tabular-nums">{money.format1(cash.accountsTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Derivado (patrimonio − cartera)</span>
          <span className="tabular-nums">{money.format1(cash.derived)}</span>
        </div>
        {cash.hasAccounts && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Diferencia</span>
            <span className={`tabular-nums ${drift ? "text-negative" : "text-muted-foreground"}`}>
              {cash.reconcileDelta >= 0 ? "+" : ""}
              {money.format1(cash.reconcileDelta)}
            </span>
          </div>
        )}
        {drift && (
          <p className="pt-1 text-[11.5px] text-negative">
            No cuadra con el snapshot. Revisa los saldos o el cierre del mes.
          </p>
        )}
        {!cash.hasAccounts && (
          <p className="pt-1 text-[11.5px] text-muted-foreground">
            Sin cuentas: se usa el efectivo derivado del último cierre.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
```

(`useDashboard()` returns the `DashboardData` directly — confirm by checking `src/hooks/use-dashboard.ts`; it wraps `useLiveDashboardData`. `money.format1` exists on the `useMoney()` result, used across the app. `text-positive`/`text-negative` classes exist.)

- [ ] **Step 2: Mount in `net-worth.tsx`**

In `src/routes/net-worth.tsx`, add the import:
```ts
import { CashAccountsCard } from "@/components/app/CashAccountsCard";
```

In `NetWorthBody`, render it right after the snapshots `<section>` (the one containing the "Snapshots del rango" table), before the `<MonthDetailDrawer ... />`:
```tsx
      <CashAccountsCard />
```

- [ ] **Step 3: Typecheck, lint, build**

Run:
```
npx eslint src/components/app/CashAccountsCard.tsx src/routes/net-worth.tsx
npx tsc --noEmit 2>&1 | grep -E "CashAccountsCard|net-worth.tsx"
npm run build
```
Expected: eslint clean; no NEW tsc errors in those files; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/CashAccountsCard.tsx src/routes/net-worth.tsx
git commit -m "feat: cash accounts editor + reconciliation on net worth page"
```

---

## Final verification (controller)

- [ ] `npm run test` — all Vitest suites pass (incl. cash).
- [ ] Apply the migration: `npx supabase db push`.
- [ ] `npm run build` + `systemctl --user restart wealth-navigator`.
- [ ] Manual: with **0 cash accounts**, the Resumen donut shows an "Efectivo" slice = patrimonio − cartera and the donut total matches the "Patrimonio neto" KPI; the Patrimonio page shows the derived cash. Add a cash account → the Efectivo slice and the live net worth become cartera + cuentas, and the reconciliation shows the delta vs derived. Confirm USD/CAD positions (Brookfield/Constellation) now weigh by their EUR value in the donut (fx_to_eur applied).

---

## Self-Review notes

- **Spec coverage:** cash resolver → Task 1; table+hooks → Task 2; fx_to_eur + accounts + allocation Efectivo + live NW override + `cash` field → Task 3; editor + reconciliation + mount → Task 4. All covered.
- **Type consistency:** `CashAccount`/`CashResolution` and `resolveCash`/`accountsTotal` signatures match between Task 1 (definition) and Tasks 2-4 (consumers). `DashboardData.cash: CashResolution` consistent in Tasks 3 and 4. Hook names (`useCashAccounts`/`useUpsertCashAccount`/`useDeleteCashAccount`) match between Task 2 and Task 4.
- **Placeholder scan:** no TBD/TODO; the `rawData` stub note in Task 3 Step 5 gives a concrete fallback. CashAccountsCard reads `data.cash` with a fallback so it's safe regardless.
