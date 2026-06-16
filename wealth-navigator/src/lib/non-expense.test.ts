import { describe, it, expect } from "vitest";
import { isCashWithdrawal, matchesExclusionRule } from "./non-expense";

describe("isCashWithdrawal", () => {
  it("MCC 6011 → true", () => expect(isCashWithdrawal("6011", "lo que sea")).toBe(true));
  it("MCC 6010 → true", () => expect(isCashWithdrawal("6010", "x")).toBe(true));
  it("concepto RET. EFECTIVO → true", () =>
    expect(isCashWithdrawal(null, "RET. EFECTIVO A DEBITO CON TARJ. EN CAJERO")).toBe(true));
  it("REINTEGRO → true", () => expect(isCashWithdrawal(null, "REINTEGRO CAJERO")).toBe(true));
  it("compra normal → false", () =>
    expect(isCashWithdrawal("5411", "PAGO CON TARJETA MERCADONA")).toBe(false));
});

describe("matchesExclusionRule", () => {
  const rules = [{ match_text: "INDEXA" }];
  it("adeudo Indexa → true", () =>
    expect(matchesExclusionRule("ADEUDO INDEXA CAPITAL SGIIC", rules)).toBe(true));
  it("case-insensitive", () => expect(matchesExclusionRule("pago indexa", rules)).toBe(true));
  it("sin coincidencia → false", () =>
    expect(matchesExclusionRule("PAGO BBVA", rules)).toBe(false));
  it("sin reglas → false", () => expect(matchesExclusionRule("ADEUDO INDEXA", [])).toBe(false));
});
