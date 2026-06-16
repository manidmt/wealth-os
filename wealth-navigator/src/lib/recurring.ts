import { groupForCategory } from "./budget-groups";
import { median } from "./budget-history";
import type { BudgetMap } from "./budget-calc";

export type RecurringExpense = {
  concept: string;
  displayConcept: string;
  category: string;
  group: string;
  monthlyAmount: number;
  lastAmount: number;
  priceIncreased: boolean;
  monthsSeen: number;
};

export function normalizeConcept(description: string): string {
  return (description ?? "")
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "Otro";
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) {
    best = v;
    bestN = n;
  }
  return best;
}

export function detectRecurring(
  movs: { date: string; description: string; amount: number; category: string }[],
  opts?: { minMonths?: number; amountAbs?: number; amountPct?: number },
): RecurringExpense[] {
  const minMonths = opts?.minMonths ?? 3;
  const amountAbs = opts?.amountAbs ?? 2;
  const amountPct = opts?.amountPct ?? 0.05;

  const byConcept = new Map<string, typeof movs>();
  for (const m of movs) {
    const key = normalizeConcept(m.description);
    if (!key) continue;
    if (!byConcept.has(key)) byConcept.set(key, []);
    byConcept.get(key)!.push(m);
  }

  const out: RecurringExpense[] = [];
  for (const [concept, items] of byConcept) {
    const byMonth = new Map<string, number>();
    for (const it of items) {
      const month = it.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + (Number(it.amount) || 0));
    }
    const monthsSorted = [...byMonth.keys()].sort();
    const monthsSeen = monthsSorted.length;
    if (monthsSeen < minMonths) continue;

    const amounts = monthsSorted.map((mo) => byMonth.get(mo)!);
    const lastAmount = amounts[amounts.length - 1];
    const prior = amounts.slice(0, -1);
    const medPrior = median(prior.length ? prior : amounts);
    const tol = Math.max(amountAbs, amountPct * medPrior);
    const consistent = prior.every((a) => Math.abs(a - medPrior) <= tol);
    if (!consistent) continue;

    const category = mostFrequent(items.map((it) => it.category));
    out.push({
      concept,
      displayConcept: items[items.length - 1].description,
      category,
      group: groupForCategory(category),
      monthlyAmount: median(amounts),
      lastAmount,
      priceIncreased: lastAmount - medPrior > tol,
      monthsSeen,
    });
  }
  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

export function recurringFloorByGroup(recurring: RecurringExpense[]): BudgetMap {
  const out: BudgetMap = {};
  for (const r of recurring) out[r.group] = (out[r.group] ?? 0) + r.monthlyAmount;
  return out;
}
