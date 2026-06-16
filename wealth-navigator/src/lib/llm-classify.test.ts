import { describe, it, expect } from "vitest";
import { buildClassifyPrompt, parseClassifyResponse } from "./llm-classify";

const cats = ["Comida", "Transporte", "Suscripciones"];

describe("buildClassifyPrompt", () => {
  it("incluye categorías e ids", () => {
    const p = buildClassifyPrompt([{ id: "a", description: "UBER TRIP" }], cats);
    expect(p).toContain("Comida");
    expect(p).toContain("Transporte");
    expect(p).toContain("UBER TRIP");
    expect(p).toContain('"a"');
  });
});

describe("parseClassifyResponse", () => {
  it("asigna categorías válidas", () =>
    expect(parseClassifyResponse('{"a":"Transporte","b":"Comida"}', cats, ["a", "b"])).toEqual({
      a: "Transporte",
      b: "Comida",
    }));
  it("categoría inválida → Sin categoría", () =>
    expect(parseClassifyResponse('{"a":"Coches"}', cats, ["a"])).toEqual({ a: "Sin categoría" }));
  it("id ausente → Sin categoría", () =>
    expect(parseClassifyResponse('{"a":"Comida"}', cats, ["a", "b"])).toEqual({
      a: "Comida",
      b: "Sin categoría",
    }));
  it("JSON malformado → todo Sin categoría", () =>
    expect(parseClassifyResponse("no soy json", cats, ["a", "b"])).toEqual({
      a: "Sin categoría",
      b: "Sin categoría",
    }));
});
