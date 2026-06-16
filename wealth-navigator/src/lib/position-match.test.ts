import { describe, it, expect } from "vitest";
import { normalize, matchScore, suggestPosition, rankPositions } from "./position-match";

const positions = [
  { id: "p-msci", assetName: "MSCI World" },
  { id: "p-emerg", assetName: "MSCI Emerging" },
  { id: "p-btc", assetName: "Bitcoin" },
  { id: "p-oro", assetName: "Oro" },
];

describe("normalize", () => {
  it("baja, sin acentos, sin paréntesis", () =>
    expect(normalize("Oro (IGLN) — Ñoño")).toBe("oro igln nono"));
});

describe("matchScore", () => {
  it("contención exacta → 1", () => expect(matchScore("bitcoin criptan btc", "Bitcoin")).toBe(1));
  it("sin relación → bajo", () => expect(matchScore("renta fija hy", "Bitcoin")).toBeLessThan(0.5));
});

describe("suggestPosition", () => {
  it("Bitcoin (Criptan)/BTC → p-btc", () =>
    expect(suggestPosition("Bitcoin (Criptan)", "BTC", positions)?.id).toBe("p-btc"));
  it("RV Core (MSCI World) → p-msci, no p-emerg", () =>
    expect(suggestPosition("RV Core (MSCI World)", "MSCI World (IWDA)", positions)?.id).toBe(
      "p-msci",
    ));
  it("Oro (IGLN)/iShares Physical Gold → p-oro", () =>
    expect(suggestPosition("Oro (IGLN)", "iShares Physical Gold", positions)?.id).toBe("p-oro"));
  it("S&P 500 sin posición → null", () =>
    expect(suggestPosition("RV Oportunista (S&P 500)", "S&P 500", positions)).toBeNull());
});

describe("rankPositions", () => {
  it("ordena por score desc, MSCI World primero", () => {
    const r = rankPositions("RV Core (MSCI World)", "MSCI World (IWDA)", positions);
    expect(r[0].id).toBe("p-msci");
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });
});
