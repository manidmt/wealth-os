import { describe, it, expect } from "vitest";
import { suggestBudgetCuts, parseAgentBudgetJson } from "./budget-suggest";

describe("suggestBudgetCuts", () => {
  it("déficit <= 0 no cambia nada", () => {
    const b = { comida: 300, ocio: 200 };
    expect(suggestBudgetCuts(b, {}, 0)).toEqual(b);
    expect(suggestBudgetCuts(b, {}, -50)).toEqual(b);
  });
  it("reparte el recorte por holgura y respeta el suelo del gasto real", () => {
    const budgets = { comida: 300, ocio: 200 };
    const actuals = { comida: 100, ocio: 50 };
    const out = suggestBudgetCuts(budgets, actuals, 100);
    expect(out.comida).toBe(243);
    expect(out.ocio).toBe(157);
    expect(out.comida + out.ocio).toBeCloseTo(400, 0);
    expect(out.comida).toBeGreaterThanOrEqual(actuals.comida);
  });
  it("sin holgura no recorta", () => {
    const budgets = { comida: 100 };
    const actuals = { comida: 100 };
    expect(suggestBudgetCuts(budgets, actuals, 50)).toEqual({ comida: 100 });
  });
});

describe("parseAgentBudgetJson", () => {
  const keys = ["comida", "ocio", "transporte"];
  it("extrae un bloque json válido filtrando claves", () => {
    const text = "Te sugiero esto.\n```json\n{\"ocio\": 110, \"comida\": 280, \"inventado\": 5}\n```\nUn saludo.";
    expect(parseAgentBudgetJson(text, keys)).toEqual({ ocio: 110, comida: 280 });
  });
  it("sin bloque json => null", () => {
    expect(parseAgentBudgetJson("texto sin json", keys)).toBeNull();
  });
  it("json malformado => null", () => {
    expect(parseAgentBudgetJson("```json\n{no es json}\n```", keys)).toBeNull();
  });
  it("descarta valores no numéricos o negativos", () => {
    const text = "```json\n{\"ocio\": \"x\", \"comida\": -5, \"transporte\": 80}\n```";
    expect(parseAgentBudgetJson(text, keys)).toEqual({ transporte: 80 });
  });
});
