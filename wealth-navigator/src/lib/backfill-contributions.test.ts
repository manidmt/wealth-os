import { describe, it, expect } from "vitest";
import { emptyRow, isValidRow, buildContributions } from "./backfill-contributions";

describe("emptyRow", () => {
  it("returns blank fields", () => {
    expect(emptyRow()).toEqual({ month: "", amount: "", price: "" });
  });
});

describe("isValidRow", () => {
  it("accepts a well-formed row", () => {
    expect(isValidRow({ month: "2026-03", amount: "400", price: "10.40" })).toBe(true);
  });
  it("rejects a bad month", () => {
    expect(isValidRow({ month: "2026-13", amount: "400", price: "10" })).toBe(false);
    expect(isValidRow({ month: "2026-3", amount: "400", price: "10" })).toBe(false);
    expect(isValidRow({ month: "", amount: "400", price: "10" })).toBe(false);
  });
  it("rejects non-positive amount or price", () => {
    expect(isValidRow({ month: "2026-03", amount: "0", price: "10" })).toBe(false);
    expect(isValidRow({ month: "2026-03", amount: "400", price: "0" })).toBe(false);
    expect(isValidRow({ month: "2026-03", amount: "", price: "10" })).toBe(false);
  });
});

describe("buildContributions", () => {
  it("builds only valid rows, computing units and date, parsing comma decimals", () => {
    const rows = [
      { month: "2026-03", amount: "400", price: "10,40" },
      { month: "bad", amount: "1", price: "1" },
      { month: "2026-04", amount: "500", price: "10" },
    ];
    const built = buildContributions(rows);
    expect(built).toHaveLength(2);
    expect(built[0]).toEqual({
      month: "2026-03",
      date: "2026-03-01",
      amount: 400,
      price: 10.4,
      units: 400 / 10.4,
    });
    expect(built[1].units).toBe(50);
    expect(built[1].date).toBe("2026-04-01");
  });
});
