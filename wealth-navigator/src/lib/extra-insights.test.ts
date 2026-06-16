import { describe, it, expect } from "vitest";
import { budgetInsight, recurringInsight } from "./extra-insights";
import type { RecurringExpense } from "./recurring";

describe("budgetInsight", () => {
  it("avisa si un grupo proyecta pasarse", () => {
    const now = new Date(2026, 5, 15);
    const ins = budgetInsight({ ocio: 200 }, { ocio: 150 }, now);
    expect(ins).not.toBeNull();
    expect(ins!.tone).toBe("warning");
    expect(ins!.title.toLowerCase()).toContain("ocio");
  });
  it("null si todo dentro de presupuesto", () => {
    const now = new Date(2026, 5, 15);
    expect(budgetInsight({ ocio: 200 }, { ocio: 50 }, now)).toBeNull();
  });
});

describe("recurringInsight", () => {
  const rec: RecurringExpense[] = [
    { concept: "NETFLIX", displayConcept: "NETFLIX", category: "Suscripciones", group: "hogar", monthlyAmount: 13, lastAmount: 16, priceIncreased: true, monthsSeen: 6 },
    { concept: "GIMNASIO", displayConcept: "GIMNASIO", category: "Gimnasio", group: "salud", monthlyAmount: 25, lastAmount: 25, priceIncreased: false, monthsSeen: 6 },
  ];
  it("resume número y total mensual", () => {
    const ins = recurringInsight(rec);
    expect(ins).not.toBeNull();
    expect(ins!.title).toContain("2");
  });
  it("null si no hay recurrentes", () => {
    expect(recurringInsight([])).toBeNull();
  });
});
