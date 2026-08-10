import { describe, it, expect } from "vitest";
import { computeBackfillLots } from "./position-lots-backfill";
import { aggregateLots } from "./position-lots-calc";

describe("computeBackfillLots", () => {
  it("posición manual sin contribuciones: un único lote 'Saldo inicial'", () => {
    const position = {
      id: "pos-1",
      quantity: 94.6,
      avg_cost: 12.5875,
      created_at: "2026-05-15T08:46:03.773407+00:00",
    };
    const lots = computeBackfillLots(position, []);
    expect(lots).toEqual([
      {
        position_id: "pos-1",
        plan_contribution_id: null,
        date: "2026-05-15",
        quantity: 94.6,
        price: 12.5875,
        notes: "Saldo inicial",
      },
    ]);
  });

  it("posición con plan: contribuciones cubren el 100% de la cantidad", () => {
    const position = { id: "pos-2", quantity: 30, avg_cost: 11, created_at: "2026-01-01T00:00:00Z" };
    const contributions = [
      { id: "c1", date: "2026-01-15", price: 10, units: 20 },
      { id: "c2", date: "2026-02-15", price: 13, units: 10 },
    ];
    const lots = computeBackfillLots(position, contributions);
    expect(lots).toEqual([
      { position_id: "pos-2", plan_contribution_id: "c1", date: "2026-01-15", quantity: 20, price: 10, notes: null },
      { position_id: "pos-2", plan_contribution_id: "c2", date: "2026-02-15", quantity: 10, price: 13, notes: null },
    ]);
    // La media ponderada de los lotes generados reproduce el avg_cost original.
    const agg = aggregateLots(lots);
    expect(agg.quantity).toBeCloseTo(position.quantity, 8);
    expect(agg.avg_cost).toBeCloseTo(position.avg_cost, 8);
  });

  it("posición con plan: contribuciones cubren solo una parte → lote de ajuste", () => {
    const position = {
      id: "pos-3",
      quantity: 1120.3658525191859,
      avg_cost: 10.997261628686607,
      created_at: "2026-05-15T08:46:03.773407+00:00",
    };
    const contributions = [{ id: "c1", date: "2026-06-01", price: 12, units: 100 }];
    const lots = computeBackfillLots(position, contributions);
    expect(lots).toHaveLength(2);
    expect(lots[0]).toEqual({
      position_id: "pos-3",
      plan_contribution_id: "c1",
      date: "2026-06-01",
      quantity: 100,
      price: 12,
      notes: null,
    });
    const adj = lots[1];
    expect(adj.plan_contribution_id).toBeNull();
    expect(adj.notes).toBe("Saldo inicial (ajuste)");
    expect(adj.date).toBe("2026-05-15");
    expect(adj.quantity).toBeCloseTo(position.quantity - 100, 8);
    // La media ponderada de TODOS los lotes generados reproduce el avg_cost original.
    const agg = aggregateLots(lots);
    expect(agg.quantity).toBeCloseTo(position.quantity, 6);
    expect(agg.avg_cost).toBeCloseTo(position.avg_cost, 6);
  });

  it("ignora contribuciones sin price o sin units", () => {
    const position = { id: "pos-4", quantity: 10, avg_cost: 5, created_at: "2026-03-01T00:00:00Z" };
    const contributions = [
      { id: "c1", date: "2026-03-10", price: null, units: 10 },
      { id: "c2", date: "2026-03-20", price: 5, units: null },
    ];
    const lots = computeBackfillLots(position, contributions);
    expect(lots).toEqual([
      {
        position_id: "pos-4",
        plan_contribution_id: null,
        date: "2026-03-01",
        quantity: 10,
        price: 5,
        notes: "Saldo inicial",
      },
    ]);
  });

  it("lanza un error si las contribuciones superan la cantidad actual (sobre-cobertura)", () => {
    const position = { id: "pos-5", quantity: 10, avg_cost: 5, created_at: "2026-01-01T00:00:00Z" };
    const contributions = [{ id: "c1", date: "2026-01-10", price: 5, units: 15 }];
    expect(() => computeBackfillLots(position, contributions)).toThrow(/exceed quantity/);
  });
});
