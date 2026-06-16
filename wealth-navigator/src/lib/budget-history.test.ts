import { describe, it, expect } from "vitest";
import { median, roundTo5, medianByGroup } from "./budget-history";

describe("budget-history", () => {
  it("median impar/par/vacío", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("roundTo5 redondea al múltiplo de 5", () => {
    expect(roundTo5(103)).toBe(105);
    expect(roundTo5(102)).toBe(100);
  });
  it("medianByGroup: un mes atípico no infla la mediana", () => {
    const movs = [
      { month: "2026-01", category: "Ocio", amount: 120 },
      { month: "2026-02", category: "Ocio", amount: 90 },
      { month: "2026-03", category: "Ocio", amount: 300 },
      { month: "2026-04", category: "Ocio", amount: 110 },
      { month: "2026-05", category: "Ocio", amount: 95 },
      { month: "2026-06", category: "Ocio", amount: 100 },
    ];
    expect(medianByGroup(movs)).toEqual({ ocio: 105 });
  });
  it("medianByGroup agrupa categorías del mismo grupo dentro del mes", () => {
    const movs = [
      { month: "2026-01", category: "Comida", amount: 100 },
      { month: "2026-01", category: "Café", amount: 20 },
      { month: "2026-02", category: "Comida", amount: 80 },
    ];
    expect(medianByGroup(movs)).toEqual({ comida: 100 });
  });
});
