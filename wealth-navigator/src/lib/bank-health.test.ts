import { describe, it, expect } from "vitest";
import { bankAlerts } from "./bank-health";
import type { BankConnection } from "./bank-api";

const NOW = Date.parse("2026-11-26T10:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const conn = (over: Partial<BankConnection> = {}): BankConnection => ({
  id: "c1",
  user_id: "u1",
  institution_id: null,
  institution_name: "BBVA",
  requisition_id: "s1",
  account_ids: ["a1"],
  status: "active",
  last_synced_at: iso(NOW - 2 * 3_600_000),
  error_message: null,
  aspsp_country: "ES",
  auth_state: null,
  session_expires_at: iso(NOW + 60 * DAY),
  sync_transactions: true,
  created_at: iso(NOW - 100 * DAY),
  ...over,
});

describe("bankAlerts", () => {
  it("sin avisos si todo está al día", () => {
    expect(bankAlerts([conn()], NOW)).toEqual([]);
  });

  it("avisa cuando faltan 14 días o menos para caducar", () => {
    expect(bankAlerts([conn({ session_expires_at: iso(NOW + 14 * DAY) })], NOW)).toMatchObject([
      { kind: "expiring", institution: "BBVA" },
    ]);
    expect(bankAlerts([conn({ session_expires_at: iso(NOW + 15 * DAY) })], NOW)).toEqual([]);
  });

  it("marca como caducada si la fecha pasó o el estado es expired", () => {
    expect(bankAlerts([conn({ session_expires_at: iso(NOW - DAY) })], NOW)[0].kind).toBe("expired");
    expect(bankAlerts([conn({ status: "expired" })], NOW)[0].kind).toBe("expired");
  });

  it("avisa si un banco activo lleva más de 48 h sin sincronizar", () => {
    const [a] = bankAlerts([conn({ last_synced_at: iso(NOW - 3 * DAY) })], NOW);
    expect(a).toMatchObject({ kind: "stale", staleDays: 3 });
    expect(bankAlerts([conn({ last_synced_at: iso(NOW - 47 * 3_600_000) })], NOW)).toEqual([]);
  });

  it("la caducidad tiene prioridad sobre la sincronización parada", () => {
    const alerts = bankAlerts(
      [conn({ session_expires_at: iso(NOW + 3 * DAY), last_synced_at: iso(NOW - 5 * DAY) })],
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("expiring");
  });

  it("ignora conexiones pendientes y en error sin sesión", () => {
    expect(bankAlerts([conn({ status: "pending", session_expires_at: null })], NOW)).toEqual([]);
  });

  it("una conexión nunca sincronizada cuenta desde su creación", () => {
    expect(
      bankAlerts([conn({ last_synced_at: null, created_at: iso(NOW - 4 * DAY) })], NOW)[0].kind,
    ).toBe("stale");
    expect(bankAlerts([conn({ last_synced_at: null, created_at: iso(NOW - DAY) })], NOW)).toEqual(
      [],
    );
  });
});
