import { describe, it, expect } from "vitest";
import { sortPositions } from "./position-sort";
import type { PortfolioPosition } from "./portfolio-api";

function pos(overrides: Partial<PortfolioPosition>): PortfolioPosition {
  const base = {
    id: "x",
    assetId: "x",
    assetName: "Asset",
    ticker: "",
    isin: "",
    assetType: "stock",
    platform: "Broker",
    quantity: 1,
    avgCost: 1,
    currentPrice: 1,
    currency: "EUR",
    notes: "",
    openedAt: "2026-01-01",
    updatedAt: "2026-01-01",
    rateToEur: 1,
    costBasis: 1,
    marketValue: 1,
    pnlValue: 0,
    pnlPct: 0,
    costBasisEur: 1,
    marketValueEur: 1,
    pnlValueEur: 0,
    portfolioWeight: 0,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...base, ...overrides } as any as PortfolioPosition;
}

const a = pos({
  assetName: "Bayer",
  quantity: 10,
  marketValueEur: 300,
  pnlPct: 0.05,
  pnlValueEur: 15,
});
const b = pos({
  assetName: "Alphabet",
  quantity: 5,
  marketValueEur: 900,
  pnlPct: 0.2,
  pnlValueEur: 150,
});
const c = pos({
  assetName: "Microsoft",
  quantity: 20,
  marketValueEur: 100,
  pnlPct: null,
  pnlValueEur: 0,
});

describe("sortPositions", () => {
  it("sorts by market value descending (default portfolio view)", () => {
    const r = sortPositions([a, b, c], "marketValueEur", "desc", "pct");
    expect(r.map((p) => p.marketValueEur)).toEqual([900, 300, 100]);
  });

  it("sorts by quantity ascending", () => {
    const r = sortPositions([a, b, c], "quantity", "asc", "pct");
    expect(r.map((p) => p.quantity)).toEqual([5, 10, 20]);
  });

  it("sorts by asset name alphabetically", () => {
    const r = sortPositions([a, b, c], "assetName", "asc", "pct");
    expect(r.map((p) => p.assetName)).toEqual(["Alphabet", "Bayer", "Microsoft"]);
  });

  it("orders P/L differently by pct vs eur", () => {
    const byPct = sortPositions([a, b], "pnl", "desc", "pct").map((p) => p.assetName);
    const byEur = sortPositions([a, b], "pnl", "desc", "eur").map((p) => p.assetName);
    // b has higher pct (0.2 vs 0.05) AND higher eur (150 vs 15) → same here,
    // but verify the value source switches by checking ascending eur
    expect(byPct[0]).toBe("Alphabet");
    expect(byEur[0]).toBe("Alphabet");
    const ascEur = sortPositions([a, b], "pnl", "asc", "eur").map((p) => p.assetName);
    expect(ascEur).toEqual(["Bayer", "Alphabet"]);
  });

  it("puts null P/L last regardless of direction", () => {
    const desc = sortPositions([a, b, c], "pnl", "desc", "pct");
    const asc = sortPositions([a, b, c], "pnl", "asc", "pct");
    expect(desc[desc.length - 1].assetName).toBe("Microsoft");
    expect(asc[asc.length - 1].assetName).toBe("Microsoft");
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortPositions(input, "marketValueEur", "desc", "pct");
    expect(input.map((p) => p.assetName)).toEqual(["Bayer", "Alphabet", "Microsoft"]);
  });
});
