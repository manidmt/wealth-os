import { groupForCategory } from "./budget-groups";
import type { BudgetMap } from "./budget-calc";

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

export function medianByGroup(
  movsConMes: { month: string; category: string; amount: number }[],
): BudgetMap {
  const perGroupMonth = new Map<string, Map<string, number>>();
  for (const m of movsConMes) {
    const g = groupForCategory(m.category);
    if (!perGroupMonth.has(g)) perGroupMonth.set(g, new Map());
    const byMonth = perGroupMonth.get(g)!;
    byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + (Number(m.amount) || 0));
  }
  const out: BudgetMap = {};
  for (const [g, byMonth] of perGroupMonth) {
    out[g] = roundTo5(median([...byMonth.values()]));
  }
  return out;
}
