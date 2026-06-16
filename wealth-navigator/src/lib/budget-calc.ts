import { groupForCategory } from "./budget-groups";

export type IncomeItem = { label: string; amount: number };
export type BudgetMap = Record<string, number>;
export type GroupStatus = { pct: number; remaining: number; over: boolean };

export function totalIncome(incomes: IncomeItem[]): number {
  return incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
}
export function totalBudgeted(budgets: BudgetMap): number {
  return Object.values(budgets).reduce((s, v) => s + (Number(v) || 0), 0);
}
export function groupActuals(movements: { category: string; amount: number }[]): BudgetMap {
  const out: BudgetMap = {};
  for (const m of movements) {
    const key = groupForCategory(m.category);
    out[key] = (out[key] ?? 0) + (Number(m.amount) || 0);
  }
  return out;
}
export function budgetStatus(planned: number, actual: number): GroupStatus {
  const pct = planned > 0 ? actual / planned : actual > 0 ? 1 : 0;
  return { pct, remaining: planned - actual, over: actual > planned };
}
export function plannedSavings(incomes: IncomeItem[], budgets: BudgetMap): number {
  return totalIncome(incomes) - totalBudgeted(budgets);
}
export function availableForExpenses(incomes: IncomeItem[], savingsGoal: number): number {
  return totalIncome(incomes) - savingsGoal;
}
export function savingsGap(incomes: IncomeItem[], budgets: BudgetMap, goal: number): number {
  return plannedSavings(incomes, budgets) - goal;
}
export function actualSavingsSoFar(incomes: IncomeItem[], actuals: BudgetMap): number {
  return totalIncome(incomes) - totalBudgeted(actuals);
}
