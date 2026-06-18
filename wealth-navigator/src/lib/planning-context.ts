import type { InvestmentPlan, PlanContribution } from "./planning-api";
import type { PortfolioPosition } from "./portfolio-api";
import { formatRule, computePlannedAmount, toEnginePlan, type MonthlyFinancials } from "./planning-calc";
import {
  effectiveQuota,
  currentMultiplier,
  evaluateTrigger,
  isStale,
  type SignalMap,
} from "./strategy-engine";
import { PANEL_SIGNALS } from "./signals-api";

export type PlanContextEntry = {
  name: string;
  assetName: string;
  assetClass: string | null;
  rule: string;
  baseAmount: number;
  multiplier: number;
  effectiveQuota: number;
  trigger: { fired: boolean; blocked: string | null; detail: string };
  dryPowder: { currentEur: number; monthlyFeedEur: number } | null;
  positionValueEur: number | null;
  pnlPct: number | null;
  plannedThisMonth: number;
  actualThisMonth: number | null;
};

export type SignalContextEntry = {
  key: string;
  label: string;
  value: number | null;
  date: string | null;
  stale: boolean;
};

export type PlanningContext = {
  month: string;
  plans: PlanContextEntry[];
  signals: SignalContextEntry[];
  routine: { label: string; done: boolean }[];
  savingsAvailableEur: number | null;
  portfolioTotalEur: number | null;
};

type PositionLike = Pick<PortfolioPosition, "id" | "assetName" | "quantity" | "avgCost" | "currentPrice">;

export function buildPlanContextEntry(input: {
  plan: InvestmentPlan;
  signals: SignalMap;
  positions: PositionLike[];
  contributions: PlanContribution[];
  monthlyFinancials: MonthlyFinancials[];
  month: string;
  now?: Date;
}): PlanContextEntry {
  const { plan, signals, positions, contributions, monthlyFinancials, month, now = new Date() } = input;
  const enginePlan = toEnginePlan(plan);
  const isStrategy = !!plan.asset_class;

  const multiplier = isStrategy ? currentMultiplier(enginePlan, signals) : 1;
  const quota = isStrategy
    ? effectiveQuota(enginePlan, signals)
    : computePlannedAmount(plan, monthlyFinancials, month);

  const tr = evaluateTrigger(plan.multiplier_rules?.trigger, signals, plan.dry_powder?.last_fired_at ?? null, now);

  const linked = plan.portfolio_position_id
    ? positions.find((p) => p.id === plan.portfolio_position_id)
    : undefined;
  let positionValueEur: number | null = null;
  let pnlPct: number | null = null;
  if (linked) {
    const qty = Number(linked.quantity);
    positionValueEur = qty * Number(linked.currentPrice);
    const cost = qty * Number(linked.avgCost);
    pnlPct = cost > 0 ? (positionValueEur / cost - 1) * 100 : 0;
  }

  const monthContrib = contributions.find((c) => c.plan_id === plan.id && c.date.slice(0, 7) === month);

  return {
    name: plan.name,
    assetName: plan.asset_name,
    assetClass: plan.asset_class,
    rule: formatRule(plan),
    baseAmount: Number(plan.amount ?? 0),
    multiplier,
    effectiveQuota: quota,
    trigger: { fired: tr.fired, blocked: tr.blocked, detail: tr.detail },
    dryPowder: plan.dry_powder
      ? { currentEur: Number(plan.dry_powder.current_eur), monthlyFeedEur: Number(plan.dry_powder.monthly_feed_eur) }
      : null,
    positionValueEur,
    pnlPct,
    plannedThisMonth: isStrategy ? quota : computePlannedAmount(plan, monthlyFinancials, month),
    actualThisMonth: monthContrib?.actual_amount ?? null,
  };
}

export function buildPlanningContext(input: {
  month: string;
  plans: InvestmentPlan[];
  signals: SignalMap;
  positions: PositionLike[];
  contributions: PlanContribution[];
  monthlyFinancials: MonthlyFinancials[];
  routine: { label: string; done: boolean }[];
  savingsAvailableEur: number | null;
  portfolioTotalEur: number | null;
  now?: Date;
}): PlanningContext {
  const { plans, signals, positions, contributions, monthlyFinancials, month, now = new Date() } = input;

  const planEntries = plans.map((plan) =>
    buildPlanContextEntry({ plan, signals, positions, contributions, monthlyFinancials, month, now }),
  );

  const signalEntries: SignalContextEntry[] = PANEL_SIGNALS.map(({ key, label }) => {
    const s = signals[key];
    return {
      key,
      label,
      value: s ? s.value : null,
      date: s ? s.date : null,
      stale: s ? isStale(s, now) : false,
    };
  });

  return {
    month,
    plans: planEntries,
    signals: signalEntries,
    routine: input.routine,
    savingsAvailableEur: input.savingsAvailableEur,
    portfolioTotalEur: input.portfolioTotalEur,
  };
}

export function serializePlanningContext(ctx: PlanningContext): string {
  const lines: string[] = [];
  lines.push(`MES: ${ctx.month}`);

  lines.push("", "PLANES:");
  if (ctx.plans.length === 0) {
    lines.push("- (sin planes activos)");
  } else {
    for (const p of ctx.plans) {
      const parts = [
        `${p.name} (${p.assetName})`,
        `regla ${p.rule}`,
        `cuota ${p.effectiveQuota.toFixed(0)} €`,
      ];
      if (p.multiplier !== 1) parts.push(`×${p.multiplier}`);
      if (p.trigger.fired) parts.push(`TRIGGER DISPARADO: ${p.trigger.detail}`);
      else if (p.trigger.blocked) parts.push(`trigger bloqueado (${p.trigger.blocked})`);
      if (p.dryPowder) parts.push(`pólvora ${p.dryPowder.currentEur.toFixed(0)} €`);
      if (p.positionValueEur != null) parts.push(`posición ${p.positionValueEur.toFixed(0)} € (P&L ${p.pnlPct!.toFixed(1)}%)`);
      parts.push(`planificado ${p.plannedThisMonth.toFixed(0)} €`);
      parts.push(`aportado ${p.actualThisMonth != null ? p.actualThisMonth.toFixed(0) + " €" : "sin registrar"}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }

  lines.push("", "SEÑALES:");
  for (const s of ctx.signals) {
    const val = s.value != null ? s.value.toString() : "sin dato";
    const flag = s.stale ? " [CADUCADA]" : "";
    lines.push(`- ${s.label}: ${val}${s.date ? ` (${s.date})` : ""}${flag}`);
  }

  lines.push("", "RUTINA DEL MES:");
  if (ctx.routine.length === 0) lines.push("- (sin pasos)");
  else for (const r of ctx.routine) lines.push(`- [${r.done ? "x" : " "}] ${r.label}`);

  lines.push("", `AHORRO DISPONIBLE ESTE MES: ${ctx.savingsAvailableEur != null ? ctx.savingsAvailableEur.toFixed(0) + " €" : "desconocido"}`);
  lines.push(`PATRIMONIO TOTAL: ${ctx.portfolioTotalEur != null ? ctx.portfolioTotalEur.toFixed(0) + " €" : "desconocido"}`);

  return lines.join("\n");
}
