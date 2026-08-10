import { describe, it, expect } from "vitest";
import { aggregateLots } from "./position-lots-calc";

describe("aggregateLots", () => {
  it("sin lotes: agregado vacío", () => {
    expect(aggregateLots([])).toEqual({ quantity: 0, avg_cost: 0 });
  });

  it("un solo lote: avg = precio del lote", () => {
    expect(aggregateLots([{ quantity: 20, price: 10 }])).toEqual({
      quantity: 20,
      avg_cost: 10,
    });
  });

  it("varios lotes: media ponderada por cantidad", () => {
    const r = aggregateLots([
      { quantity: 100, price: 10 },
      { quantity: 20, price: 20 },
    ]);
    expect(r.quantity).toBe(120);
    expect(r.avg_cost).toBeCloseTo(11.6667, 3);
  });

  it("mantiene precisión con cantidades pequeñas (cripto)", () => {
    const r = aggregateLots([
      { quantity: 0.01, price: 60000 },
      { quantity: 0.005, price: 54000 },
    ]);
    expect(r.quantity).toBeCloseTo(0.015, 8);
    expect(r.avg_cost).toBeCloseTo(58000, 2);
  });
});
