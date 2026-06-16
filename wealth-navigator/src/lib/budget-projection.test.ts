import { describe, it, expect } from "vitest";
import { projectMonthEnd, budgetAlert } from "./budget-projection";

describe("budget-projection", () => {
  it("projectMonthEnd extrapola lineal en el mes en curso", () => {
    const now = new Date(2026, 5, 15);
    expect(projectMonthEnd(100, now, true)).toBeCloseTo(200, 5);
  });
  it("projectMonthEnd el día 1 no divide por cero", () => {
    const now = new Date(2026, 5, 1);
    expect(projectMonthEnd(10, now, true)).toBeCloseTo(300, 5);
  });
  it("projectMonthEnd en mes pasado devuelve el actual", () => {
    const now = new Date(2026, 5, 15);
    expect(projectMonthEnd(100, now, false)).toBe(100);
  });
  it("budgetAlert: over si el real ya superó", () => {
    expect(budgetAlert(200, 250, 300)).toBe("over");
  });
  it("budgetAlert: warning si la proyección superará pero el real no", () => {
    expect(budgetAlert(200, 120, 240)).toBe("warning");
  });
  it("budgetAlert: ok si proyección dentro de presupuesto", () => {
    expect(budgetAlert(200, 80, 160)).toBe("ok");
  });
  it("budgetAlert: presupuesto 0 => ok", () => {
    expect(budgetAlert(0, 50, 100)).toBe("ok");
  });
});
