import { describe, it, expect } from "vitest";
import { buildPlanContextEntry, buildPlanningContext, serializePlanningContext } from "./planning-context";
import type { InvestmentPlan, PlanContribution } from "./planning-api";

const now = new Date("2026-06-18T00:00:00Z");

function plan(overrides: Partial<InvestmentPlan> = {}): InvestmentPlan {
  return {
    id: "p1", user_id: "u1", name: "RV Core", asset_name: "MSCI World",
    rule_type: "fixed", amount: 300, percentage: null, frequency: "monthly",
    return_pessimistic: 3, return_base: 7, return_optimistic: 10,
    start_date: "2026-01-01", active: true, notes: null,
    asset_class: "rv_core", multiplier_rules: null, dry_powder: null,
    annual_multiplier: 1, annual_multiplier_year: 2026,
    portfolio_position_id: null, created_at: "2026-01-01", ...overrides,
  };
}

describe("buildPlanContextEntry", () => {
  it("derives quota, multiplier and planned/actual for a fixed DCA plan", () => {
    const contribs: PlanContribution[] = [{
      id: "c1", user_id: "u1", plan_id: "p1", date: "2026-06-01",
      planned_amount: 300, actual_amount: 280, price: null, units: null,
      multiplier: null, signal_note: null, created_at: "2026-06-01",
    }];
    const e = buildPlanContextEntry({
      plan: plan(), signals: {}, positions: [], contributions: contribs,
      monthlyFinancials: [], month: "2026-06", now,
    });
    expect(e.name).toBe("RV Core");
    expect(e.assetClass).toBe("rv_core");
    expect(e.effectiveQuota).toBe(300);
    expect(e.multiplier).toBe(1);
    expect(e.plannedThisMonth).toBe(300);
    expect(e.actualThisMonth).toBe(280);
    expect(e.trigger.fired).toBe(false);
    expect(e.dryPowder).toBeNull();
  });

  it("computes pnl from a linked position", () => {
    const e = buildPlanContextEntry({
      plan: plan({ portfolio_position_id: "pos1" }),
      signals: {},
      positions: [{ id: "pos1", assetName: "X", quantity: 10, avgCost: 100, currentPrice: 110 }],
      contributions: [], monthlyFinancials: [], month: "2026-06", now,
    });
    expect(e.positionValueEur).toBe(1100);
    expect(e.pnlPct).toBeCloseTo(10, 5);
  });
});

describe("buildPlanningContext + serialize", () => {
  it("includes signals freshness and savings", () => {
    const ctx = buildPlanningContext({
      month: "2026-06",
      plans: [plan()],
      signals: { vix: { value: 18.2, date: "2026-06-10", source: "auto" } },
      positions: [],
      contributions: [],
      monthlyFinancials: [],
      routine: [{ label: "Aportar 300 € a RV Core", done: false }],
      savingsAvailableEur: 540,
      portfolioTotalEur: 16000,
      now,
    });
    expect(ctx.plans).toHaveLength(1);
    const vix = ctx.signals.find((s) => s.key === "vix")!;
    expect(vix.value).toBe(18.2);
    expect(vix.stale).toBe(false);
    expect(ctx.savingsAvailableEur).toBe(540);

    const text = serializePlanningContext(ctx);
    expect(text).toContain("2026-06");
    expect(text).toContain("RV Core");
    expect(text).toContain("VIX");
    expect(text).toContain("540");
  });

  it("marks a missing manual signal as no-data and a stale one as stale", () => {
    const ctx = buildPlanningContext({
      month: "2026-06", plans: [], positions: [], contributions: [],
      monthlyFinancials: [], routine: [], savingsAvailableEur: null, portfolioTotalEur: null,
      signals: { btc_mvrv: { value: 2, date: "2026-01-01", source: "manual" } },
      now,
    });
    const mvrv = ctx.signals.find((s) => s.key === "btc_mvrv")!;
    expect(mvrv.stale).toBe(true);
    const insiders = ctx.signals.find((s) => s.key === "insiders_ratio")!;
    expect(insiders.value).toBeNull();
  });
});
