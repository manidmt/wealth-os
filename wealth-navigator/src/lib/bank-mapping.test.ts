import { describe, it, expect } from "vitest";
import { mapTransaction, isBooked, withFallbackIds, type EbTransaction } from "./bank-mapping";

const base: EbTransaction = {
  transaction_amount: { amount: "12.34", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-06-10",
  transaction_id: "tx-1",
  merchant_category_code: "5411",
  remittance_information: ["COMPRA SUPERMERCADO"],
};

describe("mapTransaction", () => {
  it("DBIT → expense, amount abs, categoría por MCC", () => {
    expect(mapTransaction(base, "u1")).toMatchObject({
      user_id: "u1", type: "expense", amount: 12.34, currency: "EUR",
      date: "2026-06-10", description: "COMPRA SUPERMERCADO", category: "Comida", external_id: "tx-1",
    });
  });
  it("sin MCC reconocido → Sin categoría", () =>
    expect(mapTransaction({ ...base, merchant_category_code: null }, "u1").category).toBe("Sin categoría"));
  it("CRDT → income", () =>
    expect(mapTransaction({ ...base, credit_debit_indicator: "CRDT", merchant_category_code: null }, "u1").type).toBe("income"));
  it("description desde creditor si no hay remittance", () =>
    expect(mapTransaction({ ...base, remittance_information: undefined, creditor: { name: "ACME SL" } }, "u1").description).toBe("ACME SL"));
  it("external_id cae a entry_reference si falta transaction_id", () =>
    expect(mapTransaction({ ...base, transaction_id: undefined, entry_reference: "ref-9" }, "u1").external_id).toBe("ref-9"));
});

describe("isBooked", () => {
  it("BOOK true, PDNG false", () => {
    expect(isBooked(base)).toBe(true);
    expect(isBooked({ ...base, status: "PDNG" })).toBe(false);
  });
});

describe("withFallbackIds", () => {
  const noId: EbTransaction = { ...base, transaction_id: undefined, entry_reference: undefined };

  it("respeta los ids del banco", () => {
    expect(withFallbackIds([base], "acc")[0].fallback_id).toBeUndefined();
  });
  it("genera un id estable entre syncs", () => {
    const a = withFallbackIds([noId], "acc")[0].fallback_id;
    const b = withFallbackIds([{ ...noId }], "acc")[0].fallback_id;
    expect(a).toMatch(/^fp:[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(mapTransaction(withFallbackIds([noId], "acc")[0], "u1").external_id).toBe(a);
  });
  it("distingue movimientos idénticos del mismo día y cuentas distintas", () => {
    const [x, y] = withFallbackIds([noId, { ...noId }], "acc");
    expect(x.fallback_id).not.toBe(y.fallback_id);
    expect(withFallbackIds([noId], "otra")[0].fallback_id).not.toBe(x.fallback_id);
  });
  it("cambia si cambia importe o fecha", () => {
    const id = withFallbackIds([noId], "acc")[0].fallback_id;
    const amount = { ...noId, transaction_amount: { amount: "12.35", currency: "EUR" } };
    expect(withFallbackIds([amount], "acc")[0].fallback_id).not.toBe(id);
    expect(withFallbackIds([{ ...noId, booking_date: "2026-06-11" }], "acc")[0].fallback_id).not.toBe(id);
  });
});
