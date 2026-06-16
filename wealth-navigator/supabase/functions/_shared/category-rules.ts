export type CategoryRule = { match_text: string; category: string };

export function categoryFromRules(description: string, rules: CategoryRule[]): string | null {
  const desc = (description ?? "").toUpperCase();
  for (const r of rules) {
    const m = (r.match_text ?? "").toUpperCase().trim();
    if (m && desc.includes(m)) return r.category;
  }
  return null;
}
