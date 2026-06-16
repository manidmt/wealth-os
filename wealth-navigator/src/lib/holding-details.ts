import type { Holding } from "@/lib/dashboard-data";

/**
 * Synthetic position metadata derived deterministically from the holding label.
 * Replace with real backend data once positions are persisted.
 */
export type HoldingDetail = {
  isCash: boolean;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  cost: number;
  unrealized: number;
  unrealizedPct: number;
  currency: string;
  firstBoughtAt: string;
  lastUpdatedAt: string;
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

const CASH_CATEGORIES = new Set(["Cuentas", "Efectivo broker"]);

export function holdingDetail(h: Holding): HoldingDetail {
  const isCash = CASH_CATEGORIES.has(h.category ?? "");
  const seed = hash(h.label + "|" + h.platform);
  const seed2 = hash(h.platform + "::" + h.label);

  if (isCash) {
    return {
      isCash: true,
      quantity: 1,
      avgPrice: h.value,
      currentPrice: h.value,
      cost: h.value,
      unrealized: 0,
      unrealizedPct: 0,
      currency: "EUR",
      firstBoughtAt: "—",
      lastUpdatedAt: "Hoy",
    };
  }

  // Price magnitude varies by category for plausibility.
  const cat = h.category ?? "Otros";
  let priceBase: number;
  if (cat === "Crypto") priceBase = 200 + seed * 60000;
  else if (cat === "Oro") priceBase = 1800 + seed * 400;
  else if (cat === "Acciones") priceBase = 25 + seed * 250;
  else if (cat === "Fondos inversión") priceBase = 80 + seed * 200;
  else priceBase = 40 + seed * 200;

  const currentPrice = Math.max(1, Math.round(priceBase * 100) / 100);
  const quantityRaw = h.value / currentPrice;
  const quantity =
    cat === "Crypto"
      ? Math.round(quantityRaw * 10000) / 10000
      : Math.round(quantityRaw * 100) / 100;

  // Avg cost factor between 0.65 and 1.18 of current price.
  const factor = 0.65 + seed2 * 0.53;
  const avgPrice = Math.round(currentPrice * factor * 100) / 100;
  const cost = Math.round(avgPrice * quantity * 100) / 100;
  const unrealized = Math.round((h.value - cost) * 100) / 100;
  const unrealizedPct = cost > 0 ? unrealized / cost : 0;

  // Approximate dates.
  const monthsAgo = 4 + Math.floor(seed * 28);
  const first = new Date();
  first.setMonth(first.getMonth() - monthsAgo);
  const firstBoughtAt = first.toLocaleDateString("es-ES", {
    month: "short",
    year: "numeric",
  });

  const minsAgo = Math.floor(seed2 * 180);
  const lastUpdatedAt =
    minsAgo < 60
      ? `Hace ${Math.max(1, minsAgo)} min`
      : `Hace ${Math.floor(minsAgo / 60)} h`;

  return {
    isCash: false,
    quantity,
    avgPrice,
    currentPrice,
    cost,
    unrealized,
    unrealizedPct,
    currency: cat === "Crypto" ? "USD" : "EUR",
    firstBoughtAt,
    lastUpdatedAt,
  };
}

export function formatQty(n: number) {
  const decimals = n < 1 ? 4 : n < 10 ? 3 : 2;
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(n);
}

export function freshnessLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diffMs = now.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Actualizado ahora";
  if (min < 60) return `Actualizado hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Actualizado hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `Actualizado hace ${days} d`;
  const months = Math.floor(days / 30);
  return `Actualizado hace ${months} mes${months === 1 ? "" : "es"}`;
}
