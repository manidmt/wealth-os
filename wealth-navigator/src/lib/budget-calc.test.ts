import { describe, it, expect } from "vitest";
import {
  totalIncome, totalBudgeted, groupActuals, budgetStatus,
  plannedSavings, availableForExpenses, savingsGap, actualSavingsSoFar,
  type IncomeItem,
} from "./budget-calc";

const incomes: IncomeItem[] = [
  { label: "Salario", amount: 1750 },
  { label: "Otros", amount: 0 },
];

describe("budget-calc", () => {
  it("totalIncome suma las partidas", () => {
    expect(totalIncome(incomes)).toBe(1750);
    expect(totalIncome([])).toBe(0);
  });
  it("totalBudgeted suma el mapa", () => {
    expect(totalBudgeted({ comida: 330, ocio: 200 })).toBe(530);
    expect(totalBudgeted({})).toBe(0);
  });
  it("groupActuals pliega categorías al grupo", () => {
    const movs = [
      { category: "Comida", amount: 100 },
      { category: "Café", amount: 30 },
      { category: "Comer fuera", amount: 50 },
      { category: "NoExiste", amount: 5 },
    ];
    expect(groupActuals(movs)).toEqual({ comida: 130, ocio: 50, otros: 5 });
  });
  it("budgetStatus calcula pct, restante y exceso", () => {
    expect(budgetStatus(200, 150)).toEqual({ pct: 0.75, remaining: 50, over: false });
    expect(budgetStatus(200, 250)).toEqual({ pct: 1.25, remaining: -50, over: true });
    expect(budgetStatus(200, 200)).toEqual({ pct: 1, remaining: 0, over: false });
    expect(budgetStatus(0, 0)).toEqual({ pct: 0, remaining: 0, over: false });
    expect(budgetStatus(0, 10)).toEqual({ pct: 1, remaining: -10, over: true });
  });
  it("plannedSavings = ingresos - presupuestado", () => {
    expect(plannedSavings(incomes, { comida: 330, ocio: 200 })).toBe(1220);
  });
  it("availableForExpenses = ingresos - objetivo", () => {
    expect(availableForExpenses(incomes, 300)).toBe(1450);
  });
  it("savingsGap negativo => déficit", () => {
    expect(savingsGap(incomes, { comida: 1600 }, 300)).toBe(-150);
    expect(savingsGap(incomes, { comida: 1000 }, 300)).toBe(450);
  });
  it("actualSavingsSoFar = ingresos - gasto real", () => {
    expect(actualSavingsSoFar(incomes, { comida: 130, ocio: 50 })).toBe(1570);
  });
});
