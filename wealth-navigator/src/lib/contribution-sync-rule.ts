/**
 * Una aportación alimenta la posición del portfolio SOLO si su mes (YYYY-MM)
 * es el mes actual. Las aportaciones pasadas (backfill) quedan en log-only para
 * no duplicar lo que el portfolio ya refleja.
 */
export function feedsPortfolio(month: string, now: Date = new Date()): boolean {
  return month === now.toISOString().slice(0, 7);
}
