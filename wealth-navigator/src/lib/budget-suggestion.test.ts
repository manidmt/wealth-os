import { describe, it, expect } from "vitest";
import { buildBudgetSuggestionPrompt } from "./budget-suggestion";

describe("buildBudgetSuggestionPrompt", () => {
  const prompt = buildBudgetSuggestionPrompt({
    month: "2026-06",
    incomes: [{ label: "Salario", amount: 1750 }],
    savingsGoal: 300,
    budgets: { comida: 330, ocio: 200 },
    actuals: { comida: 150, ocio: 80 },
  });
  it("incluye total de ingresos y objetivo", () => {
    expect(prompt).toContain("1750");
    expect(prompt).toContain("300");
  });
  it("incluye ahorro planificado y el déficit/holgura", () => {
    expect(prompt).toContain("1220");
  });
  it("incluye cada grupo con planificado vs real", () => {
    expect(prompt).toMatch(/Comida.*330.*150/s);
    expect(prompt).toMatch(/Ocio.*200.*80/s);
  });
  it("pide sugerencias de recorte", () => {
    expect(prompt.toLowerCase()).toContain("recort");
  });
  it("pide un bloque json con las claves de grupo", () => {
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain("comida");
    expect(prompt).toContain("ocio");
  });
});
