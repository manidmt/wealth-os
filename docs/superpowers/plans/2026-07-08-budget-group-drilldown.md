# Budget Group Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user click a budget group (Comida, Ocio, Hogar, ...) in the "Presupuesto del mes" card to expand/collapse a breakdown of that group's subcategories and their real spend this month.

**Architecture:** Single-file UI change to `BudgetSummaryCard.tsx`. Reuses the exact expand/collapse + per-category aggregation pattern already implemented in the sibling component `BudgetTable.tsx` (same repo, same conventions) — no new state management library, no new query, no new backend code.

**Tech Stack:** React + TypeScript (Vite), TanStack Query (`useMonthCategorySpend` already wired), Tailwind CSS, `lucide-react` icons (`ChevronRight`, `ChevronDown`).

## Global Constraints

- No new Supabase query — `useMonthCategorySpend(month)` (already used by `BudgetSummaryCard`) already returns `{ category, amount }[]` for the month; aggregate client-side.
- Hide subcategories with 0 € spend this month (spec decision 3).
- Preserve `BUDGET_GROUPS[].categories` declared order (spec decision 4).
- Multiple groups can be expanded simultaneously — independent `Set<string>` state per group key, not accordion (spec decision 1).
- Subcategory rows show name + amount only — no bar, no percentage (spec decision 2).
- Do not modify `BudgetTable.tsx`, `budget-api.ts`, `budget-calc.ts`, or `budget-groups.ts`.
- This is a pure UI change — per spec, no new unit test is required. Verify with `npm run lint`, `npm test`, `npm run build` (must stay green/unchanged) plus manual check in the running app.

---

### Task 1: Expand/collapse subcategory breakdown in BudgetSummaryCard

**Files:**
- Modify: `wealth-navigator/src/components/planning/BudgetSummaryCard.tsx` (full file, 77 lines today)

**Interfaces:**
- Consumes: `useBudget(month): { data: MonthlyBudget | null }`, `useMonthCategorySpend(month): { data: { category: string; amount: number }[] }` — both already imported from `@/lib/budget-api`, signatures unchanged.
- Consumes: `BUDGET_GROUPS: BudgetGroup[]` from `@/lib/budget-groups`, where `BudgetGroup = { key: string; label: string; categories: string[] }` — unchanged.
- Produces: no new exports. `BudgetSummaryCard` keeps its existing public signature `({ title }: { title?: string }) => JSX.Element`, used unchanged by `index.tsx:150` and `expenses.tsx:154`.

- [ ] **Step 1: Replace the file with the updated implementation**

Replace the full contents of `wealth-navigator/src/components/planning/BudgetSummaryCard.tsx` with:

```tsx
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ChevronDown } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { useBudget, useMonthCategorySpend } from "@/lib/budget-api";
import { BUDGET_GROUPS } from "@/lib/budget-groups";
import { groupActuals, totalBudgeted, type BudgetMap } from "@/lib/budget-calc";
import { projectMonthEnd, budgetAlert } from "@/lib/budget-projection";
import { euro } from "@/lib/dashboard-data";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ALERT_BAR: Record<string, string> = {
  ok: "bg-primary",
  warning: "bg-amber-500",
  over: "bg-red-500",
};

export function BudgetSummaryCard({ title = "Presupuesto del mes" }: { title?: string }) {
  const month = currentMonth();
  const { data: budget } = useBudget(month);
  const { data: spend = [] } = useMonthCategorySpend(month);
  const now = new Date();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const budgets: BudgetMap = budget?.budgets ?? {};
  const actuals = groupActuals(spend);
  const groups = BUDGET_GROUPS.filter((g) => (budgets[g.key] ?? 0) > 0);

  // Gasto real por categoría individual, para el desglose de cada grupo.
  const spendByCategory = new Map<string, number>();
  for (const s of spend) {
    spendByCategory.set(
      s.category,
      (spendByCategory.get(s.category) ?? 0) + (Number(s.amount) || 0),
    );
  }

  if (!budget || groups.length === 0) {
    return (
      <SectionCard title={title} description="Aún no has definido el presupuesto de este mes.">
        <Link
          to="/planning"
          search={{ tab: "gastos" }}
          className="text-[13px] font-medium text-primary hover:underline"
        >
          Define tu presupuesto del mes
        </Link>
      </SectionCard>
    );
  }

  const totalBudget = totalBudgeted(budgets);
  const totalActual = BUDGET_GROUPS.reduce((s, g) => s + (actuals[g.key] ?? 0), 0);
  const totalProjected = projectMonthEnd(totalActual, now, true);

  return (
    <SectionCard
      title={title}
      description={`A este ritmo cerrarás en ${euro.format(totalProjected)} de ${euro.format(totalBudget)} presupuestado.`}
    >
      <div className="space-y-3">
        {groups.map((g) => {
          const b = budgets[g.key] ?? 0;
          const a = actuals[g.key] ?? 0;
          const projected = projectMonthEnd(a, now, true);
          const alert = budgetAlert(b, a, projected);
          const barPct = Math.min(b > 0 ? a / b : 0, 1) * 100;
          const isOpen = expanded.has(g.key);
          const subcats = g.categories.filter((cat) => (spendByCategory.get(cat) ?? 0) > 0);
          return (
            <div key={g.key} className="space-y-1">
              <button
                type="button"
                onClick={() => toggle(g.key)}
                className="w-full space-y-1 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex justify-between text-[12.5px]">
                  <span className="inline-flex items-center gap-1.5 font-medium hover:text-primary">
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {g.label}
                  </span>
                  <span className="text-muted-foreground">
                    {euro.format(a)} / {euro.format(b)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${ALERT_BAR[alert]}`} style={{ width: `${barPct}%` }} />
                </div>
              </button>
              {isOpen && subcats.length > 0 && (
                <div className="space-y-0.5 pl-5 pt-0.5">
                  {subcats.map((cat) => (
                    <div
                      key={cat}
                      className="flex justify-between text-[11px] text-muted-foreground"
                    >
                      <span>{cat}</span>
                      <span>{euro.format(spendByCategory.get(cat) ?? 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Run lint**

Run: `cd wealth-navigator && npm run lint`
Expected: no new errors/warnings from `BudgetSummaryCard.tsx`.

- [ ] **Step 3: Run the test suite**

Run: `cd wealth-navigator && npm test`
Expected: all tests pass, same count as before this change (no test targets `BudgetSummaryCard.tsx` directly today, so this only guards against unrelated regressions).

- [ ] **Step 4: Run the build**

Run: `cd wealth-navigator && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run: `cd wealth-navigator && npm run dev`, open the dashboard (`/`) and Planning → Gastos (`/planning?tab=gastos`).
Check:
- Each group row (Comida, Ocio, Hogar, ...) is clickable and toggles a chevron between ▶ and ▼.
- Clicking one group does not collapse another already-open group (multiple can be open at once).
- Expanding a group shows only its subcategories with spend > 0 this month, with amounts matching the equivalent breakdown in the "Presupuesto por categoría" table (`/planning` → Gastos → `BudgetTable`).
- A group whose subcategories all have 0 € spend shows no breakdown rows when expanded (empty, since `subcats.length > 0` gate).

- [ ] **Step 6: Commit**

```bash
cd wealth-navigator
git add src/components/planning/BudgetSummaryCard.tsx
git commit -m "$(cat <<'EOF'
feat(planning): expand/collapse subcategory breakdown per budget group

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015JxR1Ne7JMTRfc7CVZPsSe
EOF
)"
```
