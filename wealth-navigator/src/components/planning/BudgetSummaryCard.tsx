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
