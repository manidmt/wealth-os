import { describe, it, expect } from "vitest";
import { normalizeConcept, detectRecurring, recurringFloorByGroup } from "./recurring";

function mov(month: string, description: string, amount: number, category = "Suscripciones") {
  return { date: `${month}-10`, description, amount, category };
}

describe("normalizeConcept", () => {
  it("quita dígitos y puntuación, mayúsculas", () => {
    expect(normalizeConcept("Netflix.com 12345")).toBe("NETFLIX COM");
    expect(normalizeConcept("PAGO  Spotify-ES")).toBe("PAGO SPOTIFY ES");
  });
});

describe("detectRecurring", () => {
  it("detecta un fijo presente >= 3 meses y marca subida de precio", () => {
    const movs = [
      mov("2026-01", "NETFLIX", 13), mov("2026-02", "NETFLIX", 13), mov("2026-03", "NETFLIX", 13),
      mov("2026-04", "NETFLIX", 13), mov("2026-05", "NETFLIX", 13), mov("2026-06", "NETFLIX", 16),
    ];
    const out = detectRecurring(movs);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Suscripciones");
    expect(out[0].group).toBe("hogar");
    expect(out[0].monthlyAmount).toBe(13);
    expect(out[0].lastAmount).toBe(16);
    expect(out[0].priceIncreased).toBe(true);
  });
  it("ignora gasto variable aunque sea mensual", () => {
    const movs = [
      mov("2026-01", "MERCADONA", 40, "Comida"), mov("2026-02", "MERCADONA", 90, "Comida"),
      mov("2026-03", "MERCADONA", 55, "Comida"), mov("2026-04", "MERCADONA", 30, "Comida"),
    ];
    expect(detectRecurring(movs)).toHaveLength(0);
  });
  it("ignora lo que aparece menos de 3 meses", () => {
    const movs = [mov("2026-05", "GIMNASIO", 25, "Gimnasio"), mov("2026-06", "GIMNASIO", 25, "Gimnasio")];
    expect(detectRecurring(movs)).toHaveLength(0);
  });
});

describe("recurringFloorByGroup", () => {
  it("suma el importe mensual por grupo", () => {
    const rec = [
      { concept: "NETFLIX", displayConcept: "NETFLIX", category: "Suscripciones", group: "hogar", monthlyAmount: 13, lastAmount: 13, priceIncreased: false, monthsSeen: 4 },
      { concept: "GIMNASIO", displayConcept: "GIMNASIO", category: "Gimnasio", group: "salud", monthlyAmount: 25, lastAmount: 25, priceIncreased: false, monthsSeen: 4 },
    ];
    expect(recurringFloorByGroup(rec)).toEqual({ hogar: 13, salud: 25 });
  });
});
