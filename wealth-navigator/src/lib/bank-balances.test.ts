import { describe, it, expect } from "vitest";
import { pickBalance, findAdoptableAccount, type EbBalance } from "./bank-balances";

const bal = (type: string, amount: string, currency = "EUR"): EbBalance => ({
  balance_type: type,
  balance_amount: { amount, currency },
});

describe("pickBalance", () => {
  it("prefiere el saldo contable actual (ITBD) sobre cierre y disponible", () => {
    expect(pickBalance([bal("ITAV", "900"), bal("CLBD", "800"), bal("ITBD", "850.5")])).toEqual({
      amount: 850.5,
      currency: "EUR",
    });
  });
  it("cae a CLBD y luego a disponible", () => {
    expect(pickBalance([bal("ITAV", "900"), bal("CLBD", "800")])?.amount).toBe(800);
    expect(pickBalance([bal("ITAV", "900")])?.amount).toBe(900);
  });
  it("usa el primero si el tipo no es conocido", () => {
    expect(pickBalance([bal("ZZZZ", "12")])?.amount).toBe(12);
  });
  it("respeta saldos negativos y descarta importes inválidos", () => {
    expect(pickBalance([bal("ITBD", "-45.2")])?.amount).toBe(-45.2);
    expect(pickBalance([bal("ITBD", "abc")])).toBeNull();
    expect(pickBalance([])).toBeNull();
  });
});

describe("findAdoptableAccount", () => {
  const acc = (id: string, name: string, uid: string | null = null) => ({
    id,
    name,
    bank_account_uid: uid,
  });

  it("adopta la cuenta manual con el mismo nombre, ignorando mayúsculas y acentos", () => {
    expect(
      findAdoptableAccount([acc("1", "Trade Republic"), acc("2", "BBVA")], "trade republic"),
    ).toBe("1");
  });
  it("coincide si el banco incluye el nombre de la cuenta", () => {
    expect(findAdoptableAccount([acc("1", "MyInvestor")], "MyInvestor Banco")).toBe("1");
  });
  it("no adopta cuentas ya enlazadas", () => {
    expect(findAdoptableAccount([acc("1", "BBVA", "uid-1")], "BBVA")).toBeNull();
  });
  it("no adopta si hay ambigüedad o ninguna coincidencia", () => {
    expect(findAdoptableAccount([acc("1", "BBVA"), acc("2", "BBVA ahorro")], "BBVA")).toBeNull();
    expect(findAdoptableAccount([acc("1", "Pluxee")], "BBVA")).toBeNull();
  });
});
