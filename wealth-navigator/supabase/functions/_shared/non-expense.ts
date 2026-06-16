const CASH_RE = /RET\.?\s*EFECTIVO|REINTEGRO|DISPOSICION\s+(EFECTIVO|CAJERO)|RETIRADA\s+EFECTIVO/i;

export function isCashWithdrawal(mcc: string | null | undefined, description: string): boolean {
  if (mcc === "6011" || mcc === "6010") return true;
  return CASH_RE.test(description);
}

export type ExclusionRule = { match_text: string };

export function matchesExclusionRule(description: string, rules: ExclusionRule[]): boolean {
  const d = description.toUpperCase();
  return rules.some((r) => r.match_text && d.includes(r.match_text.toUpperCase()));
}
