import type { PortfolioPosition } from "./portfolio-api";

export type SortKey = "assetName" | "platform" | "quantity" | "pnl" | "marketValueEur" | "weight";
export type SortDir = "asc" | "desc";
export type PnlMode = "pct" | "eur";

export const TEXT_KEYS: SortKey[] = ["assetName", "platform"];

/** Valor numérico de una posición para una columna ordenable (null = sin dato). */
function numericValue(p: PortfolioPosition, key: SortKey, pnlMode: PnlMode): number | null {
  switch (key) {
    case "quantity":
      return p.quantity;
    case "marketValueEur":
    case "weight": // el peso es proporcional al valor de mercado → mismo orden
      return p.marketValueEur;
    case "pnl":
      return pnlMode === "pct" ? p.pnlPct : p.pnlValueEur;
    default:
      return null;
  }
}

/**
 * Comparador de posiciones por columna. Los nulos van siempre al final,
 * independientemente de la dirección.
 */
export function comparePositions(
  a: PortfolioPosition,
  b: PortfolioPosition,
  key: SortKey,
  dir: SortDir,
  pnlMode: PnlMode,
): number {
  const sign = dir === "asc" ? 1 : -1;

  if (key === "assetName" || key === "platform") {
    return sign * a[key].localeCompare(b[key], "es");
  }

  const av = numericValue(a, key, pnlMode);
  const bv = numericValue(b, key, pnlMode);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return sign * (av - bv);
}

export function sortPositions(
  positions: PortfolioPosition[],
  key: SortKey,
  dir: SortDir,
  pnlMode: PnlMode,
): PortfolioPosition[] {
  return [...positions].sort((a, b) => comparePositions(a, b, key, dir, pnlMode));
}
