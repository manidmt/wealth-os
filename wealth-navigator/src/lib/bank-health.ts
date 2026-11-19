import type { BankConnection } from "./bank-api";

export const EXPIRY_WARNING_DAYS = 14;
const STALE_HOURS = 48;
const DAY = 86_400_000;

export type BankAlert = {
  connection: BankConnection;
  institution: string;
  kind: "expired" | "expiring" | "stale";
  expiresAt: string | null;
  staleDays: number;
};

/** Un aviso por conexión: la caducidad manda porque reconectar arregla también el sync parado. */
export function bankAlerts(connections: BankConnection[], now = Date.now()): BankAlert[] {
  const alerts: BankAlert[] = [];
  for (const c of connections) {
    if (c.status !== "active" && c.status !== "expired") continue;
    const expiresMs = c.session_expires_at ? Date.parse(c.session_expires_at) : null;
    const lastMs = Date.parse(c.last_synced_at ?? c.created_at);
    const base = {
      connection: c,
      institution: c.institution_name,
      expiresAt: c.session_expires_at,
      staleDays: Math.floor((now - lastMs) / DAY),
    };

    if (c.status === "expired" || (expiresMs !== null && expiresMs <= now)) {
      alerts.push({ ...base, kind: "expired" });
    } else if (expiresMs !== null && expiresMs - now <= EXPIRY_WARNING_DAYS * DAY) {
      alerts.push({ ...base, kind: "expiring" });
    } else if (now - lastMs > STALE_HOURS * 3_600_000) {
      alerts.push({ ...base, kind: "stale" });
    }
  }
  return alerts;
}
