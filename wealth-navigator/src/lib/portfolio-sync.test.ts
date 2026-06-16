import { describe, it, expect } from "vitest";
import { applyContribution } from "./portfolio-sync";

describe("applyContribution", () => {
  it("posición vacía (qty 0): avg = precio", () => {
    expect(applyContribution({ quantity: 0, avg_cost: 0 }, 200, 20)).toEqual({
      quantity: 20,
      avg_cost: 10,
    });
  });
  it("precio medio ponderado", () => {
    expect(applyContribution({ quantity: 100, avg_cost: 10 }, 200, 20)).toEqual({
      quantity: 120,
      avg_cost: 10,
    });
  });
  it("sube el avg si compras más caro", () => {
    const r = applyContribution({ quantity: 10, avg_cost: 10 }, 60, 4);
    expect(r.quantity).toBe(14);
    expect(r.avg_cost).toBeCloseTo(11.4286, 3);
  });
  it("units 0 → sin cambio de qty, avg preservado", () => {
    expect(applyContribution({ quantity: 5, avg_cost: 7 }, 0, 0)).toEqual({
      quantity: 5,
      avg_cost: 7,
    });
  });
});
