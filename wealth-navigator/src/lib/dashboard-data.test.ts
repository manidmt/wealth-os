import { describe, it, expect, vi, afterEach } from "vitest";
import { computeDashboard } from "./dashboard-data";

const snap = (month: string, netWorth: number, portfolio = 0) => ({
  month,
  assets: netWorth,
  liabilities: 0,
  net_worth: netWorth,
  savings: 0,
  portfolio_value: portfolio,
});

describe("computeDashboard con fotos automáticas", () => {
  afterEach(() => vi.useRealTimers());

  it("la foto del mes en curso no cuenta como cierre ni sustituye al cálculo en vivo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const positions = [{ quantity: 10, current_price: 100, fx_to_eur: 1, asset_name: "ETF" }];
    const data = computeDashboard(
      [],
      positions,
      [snap("2026-10", 9000, 900), snap("2026-11", 1)],
      [{ balance: 500 }],
    );
    expect(data.latestClosedMonth).toBe("2026-10");
    expect(data.summary.netWorth).toBe(1500);
    expect(data.series.find((p) => p.month === "2026-10")?.netWorth).toBe(9000);
    expect(data.summary.monthlyChange).toBe(1500 - 9000);
  });
});
