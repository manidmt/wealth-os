import { describe, it, expect } from "vitest";
import { categoryFromRules } from "./category-rules";

describe("categoryFromRules", () => {
  const rules = [
    { match_text: "NETFLIX", category: "Suscripciones" },
    { match_text: "mercadona", category: "Comida" },
  ];
  it("casa por substring case-insensitive", () => {
    expect(categoryFromRules("PAGO NETFLIX.COM 123", rules)).toBe("Suscripciones");
    expect(categoryFromRules("COMPRA MERCADONA MADRID", rules)).toBe("Comida");
  });
  it("sin coincidencia => null", () => {
    expect(categoryFromRules("BIZUM A JUAN", rules)).toBeNull();
  });
  it("la primera regla que casa gana", () => {
    const r = [
      { match_text: "AMAZON", category: "Compras" },
      { match_text: "AMAZON PRIME", category: "Suscripciones" },
    ];
    expect(categoryFromRules("AMAZON PRIME VIDEO", r)).toBe("Compras");
  });
});
