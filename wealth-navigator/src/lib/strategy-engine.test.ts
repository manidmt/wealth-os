import { describe, it, expect } from "vitest";
import {
  evaluateBase,
  evaluateTrigger,
  currentMultiplier,
  effectiveQuota,
  type LadderRule,
  type SignalMap,
  type MatrixRule,
  type ComboRule,
  type StrategyPlanLike,
} from "./strategy-engine";

const sig = (value: number): SignalMap => ({
  msci_dd: { value, date: "2026-06-01", source: "auto" },
});

const rvLadder: LadderRule = {
  type: "ladder",
  cadence: "annual",
  signal: "msci_dd",
  steps: [
    { lte: -0.1, multi: 2 },
    { lte: -0.2, multi: 3 },
  ],
  default: 1,
};

describe("ladder rule", () => {
  it("no drawdown → default", () => expect(evaluateBase(rvLadder, sig(-0.05)).multi).toBe(1));
  it("boundary -10% → x2", () => expect(evaluateBase(rvLadder, sig(-0.1)).multi).toBe(2));
  it("-15% → x2", () => expect(evaluateBase(rvLadder, sig(-0.15)).multi).toBe(2));
  it("boundary -20% → x3", () => expect(evaluateBase(rvLadder, sig(-0.2)).multi).toBe(3));
  it("-35% → x3 (deepest)", () => expect(evaluateBase(rvLadder, sig(-0.35)).multi).toBe(3));
  it("señal ausente → default", () => expect(evaluateBase(rvLadder, {}).multi).toBe(1));
});

const goldMatrix: MatrixRule = {
  type: "matrix",
  cadence: "annual",
  row_signal: "tips_10y_real",
  col_signal: "dxy",
  row_breaks: [1, 0.5, 0],
  col_breaks: [100, 110, 120],
  values: [
    [1, 1, 2, 2],
    [2, 2, 3, 3],
    [3, 3, 4, 5],
    [4, 4, 5, 6],
  ],
  bonus: { signal: "gold_dd", lte: -0.15, add: 1 },
  max: 6,
};

const goldSig = (tips: number, dxy: number, dd = 0): SignalMap => ({
  tips_10y_real: { value: tips, date: "2026-06-01", source: "auto" },
  dxy: { value: dxy, date: "2026-06-01", source: "auto" },
  gold_dd: { value: dd, date: "2026-06-01", source: "auto" },
});

describe("matrix rule (oro TIPS×DXY)", () => {
  it("tips 1.2, dxy 95 → 1", () =>
    expect(evaluateBase(goldMatrix, goldSig(1.2, 95)).multi).toBe(1));
  it("tips 1.0 (≥1%), dxy 100 (≤100) → 1", () =>
    expect(evaluateBase(goldMatrix, goldSig(1.0, 100)).multi).toBe(1));
  it("tips 0.7, dxy 105 → 2", () =>
    expect(evaluateBase(goldMatrix, goldSig(0.7, 105)).multi).toBe(2));
  it("tips 0.3, dxy 115 → 4", () =>
    expect(evaluateBase(goldMatrix, goldSig(0.3, 115)).multi).toBe(4));
  it("tips -0.2, dxy 125 → 6", () =>
    expect(evaluateBase(goldMatrix, goldSig(-0.2, 125)).multi).toBe(6));
  it("bonus DD: tips 0.3, dxy 115, dd -16% → 5", () =>
    expect(evaluateBase(goldMatrix, goldSig(0.3, 115, -0.16)).multi).toBe(5));
  it("clamp max: tips -0.2, dxy 125, dd -16% → 6", () =>
    expect(evaluateBase(goldMatrix, goldSig(-0.2, 125, -0.16)).multi).toBe(6));
  it("señal ausente → 1", () => expect(evaluateBase(goldMatrix, {}).multi).toBe(1));
});

const vixCombo: ComboRule = {
  type: "combo",
  conditions: [
    { signal: "vix", op: "gt", value: 50 },
    { signal: "insiders_ratio", op: "gte", value: 0.5 },
  ],
  multi: 4,
  cooldown_months: 3,
};

const NOW = new Date("2026-06-12");
const comboSig = (vix: number, ins: number, insDate = "2026-06-01"): SignalMap => ({
  vix: { value: vix, date: "2026-06-11", source: "auto" },
  insiders_ratio: { value: ins, date: insDate, source: "manual" },
});

describe("combo trigger", () => {
  it("dispara si todas se cumplen", () => {
    const r = evaluateTrigger(vixCombo, comboSig(55, 0.6), null, NOW);
    expect(r.fired).toBe(true);
    expect(r.blocked).toBeNull();
  });
  it("no dispara si falta una condición", () =>
    expect(evaluateTrigger(vixCombo, comboSig(49, 0.6), null, NOW).fired).toBe(false));
  it("cooldown bloquea (<3 meses)", () => {
    const r = evaluateTrigger(vixCombo, comboSig(55, 0.6), "2026-05-01", NOW);
    expect(r.fired).toBe(false);
    expect(r.blocked).toBe("cooldown");
  });
  it("cooldown expirado no bloquea", () =>
    expect(evaluateTrigger(vixCombo, comboSig(55, 0.6), "2026-02-12", NOW).fired).toBe(true));
  it("señal manual caducada (>35d) bloquea", () => {
    const r = evaluateTrigger(vixCombo, comboSig(55, 0.6, "2026-04-20"), null, NOW);
    expect(r.fired).toBe(false);
    expect(r.blocked).toBe("stale_signal");
  });
  it("señal ausente bloquea como stale", () => {
    const r = evaluateTrigger(
      vixCombo,
      { vix: { value: 55, date: "2026-06-11", source: "auto" } },
      null,
      NOW,
    );
    expect(r.fired).toBe(false);
    expect(r.blocked).toBe("stale_signal");
  });
});

const planLike = (over: Partial<StrategyPlanLike>): StrategyPlanLike => ({
  amount: 100,
  multiplier_rules: null,
  annual_multiplier: 1,
  annual_multiplier_year: null,
  ...over,
});

describe("currentMultiplier / effectiveQuota", () => {
  it("plan simple → 1 y cuota base", () => {
    expect(currentMultiplier(planLike({}), {})).toBe(1);
    expect(effectiveQuota(planLike({}), {})).toBe(100);
  });
  it("cadencia annual usa el multiplicador persistido, no la señal", () => {
    const p = planLike({
      multiplier_rules: { base: rvLadder },
      annual_multiplier: 2,
      annual_multiplier_year: 2026,
    });
    expect(currentMultiplier(p, sig(-0.35))).toBe(2); // señal diría 3; vigente es 2
    expect(effectiveQuota(p, sig(-0.35))).toBe(200);
  });
  it("cadencia monthly evalúa on-the-fly", () => {
    const monthlyLadder = { ...rvLadder, cadence: "monthly" as const };
    const p = planLike({ multiplier_rules: { base: monthlyLadder } });
    expect(currentMultiplier(p, sig(-0.25))).toBe(3);
    expect(effectiveQuota(p, sig(-0.25))).toBe(300);
  });
});
