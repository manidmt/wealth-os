export type BudgetAlert = "ok" | "warning" | "over";

export function projectMonthEnd(actual: number, now: Date, monthIsCurrent: boolean): number {
  if (!monthIsCurrent) return actual;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  if (dayOfMonth <= 0) return actual;
  return (actual / dayOfMonth) * daysInMonth;
}

export function budgetAlert(budget: number, actual: number, projected: number): BudgetAlert {
  if (budget <= 0) return "ok";
  if (actual > budget) return "over";
  if (projected > budget) return "warning";
  return "ok";
}
