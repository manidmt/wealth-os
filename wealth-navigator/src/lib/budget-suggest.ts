import { BUDGET_GROUPS } from "./budget-groups";
import type { BudgetMap } from "./budget-calc";

export function suggestBudgetCuts(
  budgets: BudgetMap,
  actuals: BudgetMap,
  deficit: number,
): BudgetMap {
  const result: BudgetMap = { ...budgets };
  if (deficit <= 0) return result;
  const keys = BUDGET_GROUPS.map((g) => g.key);
  const headroom: Record<string, number> = {};
  let total = 0;
  for (const k of keys) {
    const h = Math.max(0, (budgets[k] ?? 0) - (actuals[k] ?? 0));
    headroom[k] = h;
    total += h;
  }
  if (total <= 0) return result;
  const toCut = Math.min(deficit, total);
  for (const k of keys) {
    if (headroom[k] <= 0) continue;
    const cut = (headroom[k] / total) * toCut;
    result[k] = Math.round((budgets[k] ?? 0) - cut);
  }
  return result;
}

export function parseAgentBudgetJson(text: string, validKeys: string[]): BudgetMap | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: BudgetMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (validKeys.includes(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
