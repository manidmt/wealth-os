// Motor de reglas de estrategias semipasivas. PURO: sin imports, sin I/O.
// Compartido entre Edge Functions (Deno) y frontend (re-export en src/lib).

export type SignalKey =
  | "vix"
  | "dxy"
  | "tips_10y_real"
  | "hy_spread"
  | "msci_dd"
  | "gold_dd"
  | "btc_dd"
  | "btc_p200w"
  | "btc_mvrv"
  | "btc_puell"
  | "insiders_ratio";

export type SignalValue = { value: number; date: string; source: "auto" | "manual" };
export type SignalMap = Partial<Record<SignalKey, SignalValue>>;

export type LadderRule = {
  type: "ladder";
  cadence: "annual" | "monthly";
  signal: SignalKey;
  steps: { lte: number; multi: number }[];
  default: number;
};

export type MatrixRule = {
  type: "matrix";
  cadence: "annual";
  row_signal: SignalKey;
  col_signal: SignalKey;
  row_breaks: number[]; // descendentes: fila = primer i con value >= breaks[i]; si ninguno, última fila
  col_breaks: number[]; // ascendentes: col = nº de breaks estrictamente menores que value
  values: number[][];
  bonus?: { signal: SignalKey; lte: number; add: number };
  max: number;
};

export type ComboRule = {
  type: "combo";
  conditions: { signal: SignalKey; op: "gt" | "gte" | "lt" | "lte"; value: number }[];
  multi: number;
  cooldown_months: number;
};

export type MultiplierRules = {
  base?: LadderRule | MatrixRule;
  trigger?: ComboRule;
};

export const MANUAL_STALE_DAYS = 35;

export function isStale(s: SignalValue, now: Date = new Date()): boolean {
  if (s.source !== "manual") return false;
  const age = (now.getTime() - new Date(s.date).getTime()) / 86400000;
  return age > MANUAL_STALE_DAYS;
}

export type BaseResult = { multi: number; detail: string };

export function evaluateBase(
  rule: LadderRule | MatrixRule | undefined,
  signals: SignalMap,
): BaseResult {
  if (!rule) return { multi: 1, detail: "sin regla" };
  if (rule.type === "ladder") {
    const s = signals[rule.signal];
    if (!s) return { multi: rule.default, detail: `${rule.signal}: sin dato` };
    const hit = rule.steps.filter((st) => s.value <= st.lte);
    const multi = hit.length ? Math.max(...hit.map((st) => st.multi)) : rule.default;
    return { multi, detail: `${rule.signal}=${s.value.toFixed(3)} → x${multi}` };
  }
  const row = signals[rule.row_signal];
  const col = signals[rule.col_signal];
  if (!row || !col) return { multi: 1, detail: "matrix: sin datos" };
  let r = rule.row_breaks.findIndex((b) => row.value >= b);
  if (r === -1) r = rule.row_breaks.length;
  const c = rule.col_breaks.filter((b) => col.value > b).length;
  let multi = rule.values[r][c];
  let detail = `${rule.row_signal}=${row.value} × ${rule.col_signal}=${col.value} → x${multi}`;
  if (rule.bonus) {
    const bs = signals[rule.bonus.signal];
    if (bs && bs.value <= rule.bonus.lte) {
      multi += rule.bonus.add;
      detail += ` +${rule.bonus.add} bonus`;
    }
  }
  multi = Math.min(multi, rule.max);
  return { multi, detail };
}

export type TriggerResult = {
  fired: boolean;
  blocked: "cooldown" | "stale_signal" | null;
  detail: string;
};

const OPS = {
  gt: (a: number, b: number) => a > b,
  gte: (a: number, b: number) => a >= b,
  lt: (a: number, b: number) => a < b,
  lte: (a: number, b: number) => a <= b,
};

export function evaluateTrigger(
  rule: ComboRule | undefined,
  signals: SignalMap,
  lastFiredAt: string | null,
  now: Date = new Date(),
): TriggerResult {
  if (!rule) return { fired: false, blocked: null, detail: "sin trigger" };

  for (const c of rule.conditions) {
    const s = signals[c.signal];
    if (!s) return { fired: false, blocked: "stale_signal", detail: `${c.signal}: sin dato` };
    if (isStale(s, now))
      return { fired: false, blocked: "stale_signal", detail: `${c.signal}: caducada (${s.date})` };
  }

  const met = rule.conditions.every((c) => OPS[c.op](signals[c.signal]!.value, c.value));
  if (!met) {
    const detail = rule.conditions
      .map(
        (c) =>
          `${c.signal}=${signals[c.signal]!.value} ${OPS[c.op](signals[c.signal]!.value, c.value) ? "✓" : "✗"}`,
      )
      .join(" · ");
    return { fired: false, blocked: null, detail };
  }

  if (lastFiredAt) {
    const last = new Date(lastFiredAt);
    const months =
      (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth());
    if (months < rule.cooldown_months) {
      return {
        fired: false,
        blocked: "cooldown",
        detail: `cooldown hasta ${rule.cooldown_months - months} meses más`,
      };
    }
  }
  return { fired: true, blocked: null, detail: `disparo x${rule.multi}` };
}

// Subconjunto de InvestmentPlan que necesita el motor (evita acoplar al tipo completo del frontend)
export type StrategyPlanLike = {
  amount: number | null;
  multiplier_rules: MultiplierRules | null;
  annual_multiplier: number;
  annual_multiplier_year: number | null;
};

export function currentMultiplier(plan: StrategyPlanLike, signals: SignalMap): number {
  const base = plan.multiplier_rules?.base;
  if (!base) return 1;
  if (base.cadence === "annual") return plan.annual_multiplier;
  return evaluateBase(base, signals).multi;
}

export function effectiveQuota(plan: StrategyPlanLike, signals: SignalMap): number {
  return (plan.amount ?? 0) * currentMultiplier(plan, signals);
}
