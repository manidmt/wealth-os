import { describe, it, expect } from "vitest";
import { categoryFromMcc } from "./mcc-categories";

describe("categoryFromMcc", () => {
  it("5411 supermercado → Comida", () => expect(categoryFromMcc("5411")).toBe("Comida"));
  it("5812 restaurante → Comer fuera", () => expect(categoryFromMcc("5812")).toBe("Comer fuera"));
  it("4121 taxi/rideshare → Transporte", () => expect(categoryFromMcc("4121")).toBe("Transporte"));
  it("5541 gasolinera → Coche", () => expect(categoryFromMcc("5541")).toBe("Coche"));
  it("4900 utilities → Hogar", () => expect(categoryFromMcc("4900")).toBe("Hogar"));
  it("4899 streaming → Suscripciones", () => expect(categoryFromMcc("4899")).toBe("Suscripciones"));
  it("ambiguo 5999 → null", () => expect(categoryFromMcc("5999")).toBeNull());
  it("null/undefined → null", () => {
    expect(categoryFromMcc(null)).toBeNull();
    expect(categoryFromMcc(undefined)).toBeNull();
  });
});
