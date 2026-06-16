import { BUDGET_GROUPS } from "./budget-groups";
import { totalIncome, plannedSavings, savingsGap, type BudgetMap, type IncomeItem } from "./budget-calc";

export function buildBudgetSuggestionPrompt(input: {
  month: string;
  incomes: IncomeItem[];
  savingsGoal: number;
  budgets: BudgetMap;
  actuals: BudgetMap;
}): string {
  const { month, incomes, savingsGoal, budgets, actuals } = input;
  const income = totalIncome(incomes);
  const planned = plannedSavings(incomes, budgets);
  const gap = savingsGap(incomes, budgets, savingsGoal);

  const lines = BUDGET_GROUPS.map((g) => {
    const p = budgets[g.key] ?? 0;
    const a = actuals[g.key] ?? 0;
    return `- ${g.label}: planificado ${p}€ / real ${a}€`;
  }).join("\n");

  const gapLine =
    gap < 0
      ? `Con este plan el ahorro estimado es ${planned}€, ${Math.abs(gap)}€ por debajo del objetivo (${savingsGoal}€).`
      : `Con este plan el ahorro estimado es ${planned}€, ${gap}€ por encima del objetivo (${savingsGoal}€).`;

  const groupKeys = BUDGET_GROUPS.map((g) => g.key).join(", ");

  return [
    `Estás revisando mi planificación de gastos del mes ${month}.`,
    `Ingresos previstos: ${income}€. Objetivo de ahorro: ${savingsGoal}€.`,
    gapLine,
    `Presupuesto y gasto real por grupo:`,
    lines,
    gap < 0
      ? `Para alcanzar el objetivo tendría que recortar ${Math.abs(gap)}€. Sugiéreme en qué grupos concretos recortar y cuánto, priorizando donde voy más holgado o me estoy pasando. Sé concreto y breve.`
      : `Voy bien para el objetivo. Dime si ves algún grupo donde me esté pasando y si hay margen para algún recorte adicional. Sé concreto y breve.`,
    `Termina tu respuesta con un bloque de código json (entre triple backtick json) con el presupuesto propuesto por grupo, usando exactamente estas claves: ${groupKeys}. Solo números enteros en euros, sin comentarios.`,
  ].join("\n");
}
