import { describe, it, expect } from "vitest";
import { findDuplicate, type DedupRow } from "./dedup";

const manuals: DedupRow[] = [
  { id: "m1", amount: 15, type: "expense", date: "2026-06-10" },
  { id: "m2", amount: 50, type: "expense", date: "2026-06-01" },
];

describe("findDuplicate", () => {
  it("mismo importe+tipo, fecha exacta → match", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-10" }, manuals)).toBe("m1"));
  it("dentro de ±2 días → match", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-12" }, manuals)).toBe("m1"));
  it("fuera de ±2 días → null", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-20" }, manuals)).toBeNull());
  it("Δ3 días → null por defecto (ventana ±2)", () =>
    expect(
      findDuplicate({ amount: 15, type: "expense", date: "2026-06-13" }, [
        { id: "d3", amount: 15, type: "expense", date: "2026-06-10" },
      ]),
    ).toBeNull());
  it("importe distinto → null", () =>
    expect(findDuplicate({ amount: 30, type: "expense", date: "2026-06-10" }, manuals)).toBeNull());
  it("tipo distinto → null", () =>
    expect(findDuplicate({ amount: 15, type: "income", date: "2026-06-10" }, manuals)).toBeNull());
  it("sin manuales → null", () =>
    expect(findDuplicate({ amount: 15, type: "expense", date: "2026-06-10" }, [])).toBeNull());
  it("28 vs 28.73 mismo día → match (tolerancia importe)", () =>
    expect(
      findDuplicate({ amount: 28.73, type: "expense", date: "2026-06-03" }, [
        { id: "x", amount: 28, type: "expense", date: "2026-06-03" },
      ]),
    ).toBe("x"));
  it("23 vs 22.99 → match", () =>
    expect(
      findDuplicate({ amount: 22.99, type: "expense", date: "2026-06-02" }, [
        { id: "y", amount: 23, type: "expense", date: "2026-06-02" },
      ]),
    ).toBe("y"));
  it("28 vs 35 → null (fuera de tolerancia)", () =>
    expect(
      findDuplicate({ amount: 35, type: "expense", date: "2026-06-03" }, [
        { id: "z", amount: 28, type: "expense", date: "2026-06-03" },
      ]),
    ).toBeNull());
  it("importe grande dentro del 5% → match", () =>
    expect(
      findDuplicate({ amount: 210, type: "expense", date: "2026-06-03" }, [
        { id: "g", amount: 200, type: "expense", date: "2026-06-03" },
      ]),
    ).toBe("g"));
});
