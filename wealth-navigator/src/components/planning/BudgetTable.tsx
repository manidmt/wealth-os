import { Fragment, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { BUDGET_GROUPS } from "@/lib/budget-groups";
import { budgetStatus, totalBudgeted, type BudgetMap } from "@/lib/budget-calc";
import { projectMonthEnd, budgetAlert } from "@/lib/budget-projection";
import { euro } from "@/lib/dashboard-data";

const ALERT_BAR: Record<string, string> = {
  ok: "bg-primary",
  warning: "bg-amber-500",
  over: "bg-red-500",
};
const ALERT_LABEL: Record<string, { text: string; cls: string }> = {
  ok: { text: "Vas bien", cls: "text-emerald-600 dark:text-emerald-400" },
  warning: { text: "Vas justo", cls: "text-amber-600 dark:text-amber-400" },
  over: { text: "Te pasas", cls: "text-red-500" },
};

export function BudgetTable({
  budgets,
  actuals,
  onChange,
  monthIsCurrent = true,
  categorySpend = [],
}: {
  budgets: BudgetMap;
  actuals: BudgetMap;
  onChange: (groupKey: string, amount: number) => void;
  monthIsCurrent?: boolean;
  categorySpend?: { category: string; amount: number }[];
}) {
  const now = new Date();
  const totalPlanned = totalBudgeted(budgets);
  const totalActual = totalBudgeted(actuals);
  const totalProjected = projectMonthEnd(totalActual, now, monthIsCurrent);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Gasto real por categoría individual, para el desglose de cada grupo.
  const spendByCategory = new Map<string, number>();
  for (const s of categorySpend) {
    spendByCategory.set(
      s.category,
      (spendByCategory.get(s.category) ?? 0) + (Number(s.amount) || 0),
    );
  }

  return (
    <SectionCard
      title="Presupuesto por categoría"
      description="Cuánto quieres gastar en cada grupo y cómo vas frente a lo real (con proyección a fin de mes). Pulsa un grupo para ver sus categorías."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Grupo</th>
              <th className="pb-2 pr-4 text-right font-medium">Presupuesto</th>
              <th className="pb-2 pr-4 text-right font-medium">Gastado</th>
              <th className="pb-2 pr-4 font-medium">Consumido</th>
              <th className="pb-2 pr-4 text-right font-medium">Proyección</th>
              <th className="pb-2 text-right font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {BUDGET_GROUPS.map((g) => {
              const planned = budgets[g.key] ?? 0;
              const actual = actuals[g.key] ?? 0;
              const { pct } = budgetStatus(planned, actual);
              const projected = projectMonthEnd(actual, now, monthIsCurrent);
              const alert = budgetAlert(planned, actual, projected);
              const barPct = Math.min(pct, 1) * 100;
              const isOpen = expanded.has(g.key);
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td className="py-2 pr-4 font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggle(g.key)}
                        className="inline-flex items-center gap-1.5 text-left hover:text-primary"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {g.label}
                      </button>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <Input
                        type="number"
                        step="1"
                        value={planned}
                        onChange={(e) => onChange(g.key, Number(e.target.value) || 0)}
                        className="ml-auto w-24 text-right text-[12.5px]"
                      />
                    </td>
                    <td className="py-2 pr-4 text-right">{euro.format(actual)}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${ALERT_BAR[alert]}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {planned > 0 ? `${Math.round(pct * 100)}%` : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right text-muted-foreground">
                      {monthIsCurrent && planned > 0 ? euro.format(projected) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {planned === 0 ? (
                        <span className="text-muted-foreground">Sin presupuesto</span>
                      ) : (
                        <span className={ALERT_LABEL[alert].cls}>{ALERT_LABEL[alert].text}</span>
                      )}
                    </td>
                  </tr>
                  {isOpen &&
                    g.categories.map((cat) => (
                      <tr key={`${g.key}-${cat}`} className="bg-muted/20 text-[11.5px]">
                        <td className="py-1.5 pr-4 pl-7 text-muted-foreground">{cat}</td>
                        <td className="py-1.5 pr-4" />
                        <td className="py-1.5 pr-4 text-right text-muted-foreground">
                          {euro.format(spendByCategory.get(cat) ?? 0)}
                        </td>
                        <td className="py-1.5 pr-4" />
                        <td className="py-1.5 pr-4" />
                        <td className="py-1.5" />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 text-right">{euro.format(totalPlanned)}</td>
              <td className="py-2 pr-4 text-right">{euro.format(totalActual)}</td>
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4 text-right">
                {monthIsCurrent ? euro.format(totalProjected) : "—"}
              </td>
              <td className="py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </SectionCard>
  );
}
