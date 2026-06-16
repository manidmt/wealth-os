import type { InvestmentPlan } from "./planning-api";
import type { StrategyPlanLike } from "./strategy-engine";

export type MonthlyFinancials = {
  month: string; // "YYYY-MM"
  income: number;
  expense: number;
};

/**
 * Calcula el importe planificado para un mes dado según la regla del plan.
 * Para pct_income / pct_savings usa los financials del mismo mes si existen,
 * si no, usa la media de los últimos 6 meses disponibles (estimación).
 */
export function computePlannedAmount(
  plan: InvestmentPlan,
  monthlyFinancials: MonthlyFinancials[],
  targetMonth?: string,
): number {
  if (plan.rule_type === "fixed") {
    return plan.amount ?? 0;
  }

  if (plan.rule_type === "event") {
    return 0; // el usuario introduce el importe al registrar manualmente
  }

  const relevant = targetMonth
    ? monthlyFinancials.filter((m) => m.month === targetMonth)
    : monthlyFinancials.slice(-6);

  const avg =
    relevant.length === 0
      ? { income: 0, savings: 0 }
      : {
          income: relevant.reduce((s, m) => s + m.income, 0) / relevant.length,
          savings: relevant.reduce((s, m) => s + (m.income - m.expense), 0) / relevant.length,
        };

  const pct = (plan.percentage ?? 0) / 100;

  if (plan.rule_type === "pct_income") {
    const base = targetMonth ? (relevant[0]?.income ?? avg.income) : avg.income;
    return base * pct;
  }

  // pct_savings
  const base = targetMonth
    ? relevant[0]
      ? relevant[0].income - relevant[0].expense
      : avg.savings
    : avg.savings;
  return Math.max(0, base * pct);
}

export type ProjectionPoint = {
  month: string; // "YYYY-MM"
  pessimistic: number;
  base: number;
  optimistic: number;
};

/**
 * Proyecta el crecimiento del portfolio durante horizonYears años a partir de hoy,
 * asumiendo aportación mensual constante estimada con la regla del plan.
 * Planes trimestrales usan amount/3 como equivalente mensual.
 */
export function computeProjection(
  plan: InvestmentPlan,
  monthlyFinancials: MonthlyFinancials[],
  horizonYears: number,
): ProjectionPoint[] {
  const rawContribution = computePlannedAmount(plan, monthlyFinancials);
  const monthlyContribution =
    plan.rule_type === "fixed" && plan.frequency === "quarterly"
      ? (plan.amount ?? 0) / 3
      : rawContribution;

  const rates = {
    pessimistic: plan.return_pessimistic / 100 / 12,
    base: plan.return_base / 100 / 12,
    optimistic: plan.return_optimistic / 100 / 12,
  };

  const totalMonths = horizonYears * 12;
  const points: ProjectionPoint[] = [];

  let vPess = 0;
  let vBase = 0;
  let vOpt = 0;

  const now = new Date();

  for (let i = 0; i <= totalMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    points.push({
      month,
      pessimistic: Math.round(vPess),
      base: Math.round(vBase),
      optimistic: Math.round(vOpt),
    });

    vPess = vPess * (1 + rates.pessimistic) + monthlyContribution;
    vBase = vBase * (1 + rates.base) + monthlyContribution;
    vOpt = vOpt * (1 + rates.optimistic) + monthlyContribution;
  }

  return points;
}

/** Adapta una fila de investment_plans (numéricos como string vía PostgREST) al shape del motor. */
export function toEnginePlan(plan: InvestmentPlan): StrategyPlanLike {
  return {
    amount: plan.amount == null ? null : Number(plan.amount),
    multiplier_rules: plan.multiplier_rules,
    annual_multiplier: Number(plan.annual_multiplier ?? 1),
    annual_multiplier_year:
      plan.annual_multiplier_year == null ? null : Number(plan.annual_multiplier_year),
  };
}

/** Formatea la regla de un plan para mostrar en la UI */
export function formatRule(plan: InvestmentPlan): string {
  const freq = plan.frequency === "quarterly" ? "/trimestre" : "/mes";
  if (plan.rule_type === "fixed") return `${plan.amount?.toFixed(0)} €${freq}`;
  if (plan.rule_type === "pct_income") return `${plan.percentage}% ingresos${freq}`;
  if (plan.rule_type === "pct_savings") return `${plan.percentage}% ahorro${freq}`;
  return "A demanda (evento)";
}
