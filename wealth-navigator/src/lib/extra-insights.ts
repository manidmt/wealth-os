import type { Insight } from "./assistant-mock";
import type { BudgetMap } from "./budget-calc";
import { BUDGET_GROUPS } from "./budget-groups";
import { projectMonthEnd } from "./budget-projection";
import { euro1 } from "./dashboard-data";
import type { RecurringExpense } from "./recurring";

export function budgetInsight(budgets: BudgetMap, actuals: BudgetMap, now: Date): Insight | null {
  let worst: { label: string; over: number } | null = null;
  for (const g of BUDGET_GROUPS) {
    const b = budgets[g.key] ?? 0;
    if (b <= 0) continue;
    const projected = projectMonthEnd(actuals[g.key] ?? 0, now, true);
    const over = projected - b;
    if (over > 0 && (!worst || over > worst.over)) worst = { label: g.label, over };
  }
  if (!worst) return null;
  return {
    id: "i-budget",
    tone: "warning",
    title: `A este ritmo te pasas ${euro1.format(worst.over)} en ${worst.label}`,
    body: `La proyección a fin de mes de ${worst.label} supera tu presupuesto.`,
    prompt: `¿Cómo puedo recortar el gasto de ${worst.label} este mes?`,
  };
}

export function recurringInsight(recurring: RecurringExpense[]): Insight | null {
  if (recurring.length === 0) return null;
  const total = recurring.reduce((s, r) => s + r.monthlyAmount, 0);
  const hiked = recurring.filter((r) => r.priceIncreased);
  const extra = hiked.length ? ` ${hiked.length} subieron de precio.` : "";
  return {
    id: "i-recurring",
    tone: hiked.length ? "warning" : "neutral",
    title: `${recurring.length} gastos fijos por ${euro1.format(total)}/mes`,
    body: `Suscripciones y recibos recurrentes detectados.${extra}`,
    prompt: "Revisa mis gastos fijos y dime cuáles podría cancelar.",
  };
}
