export type DedupRow = { id: string; amount: number; type: "income" | "expense"; date: string };
export type DedupQuery = { amount: number; type: "income" | "expense"; date: string };

/** Devuelve el id del manual que parece duplicar a `q` (mismo importe+tipo dentro de tolerancia, fecha ±toleranceDays), o null. */
export function findDuplicate(
  q: DedupQuery,
  manuals: DedupRow[],
  opts: { amountAbs?: number; amountPct?: number; toleranceDays?: number } = {},
): string | null {
  const { amountAbs = 1.5, amountPct = 0.05, toleranceDays = 2 } = opts;
  const qt = new Date(q.date).getTime();
  for (const m of manuals) {
    if (m.type !== q.type) continue;
    const a = Number(m.amount),
      b = Number(q.amount);
    const tol = Math.max(amountAbs, amountPct * Math.max(a, b));
    if (Math.abs(a - b) > tol) continue;
    const diffDays = Math.abs(new Date(m.date).getTime() - qt) / 86400000;
    if (diffDays <= toleranceDays) return m.id;
  }
  return null;
}
