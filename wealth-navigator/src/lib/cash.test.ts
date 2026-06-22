import { describe, it, expect } from "vitest";
import { accountsTotal, resolveCash } from "./cash";

describe("accountsTotal", () => {
  it("sums balances", () => {
    expect(accountsTotal([{ balance: 4000 }, { balance: 12000 }])).toBe(16000);
  });
  it("is 0 for no accounts", () => {
    expect(accountsTotal([])).toBe(0);
  });
});

describe("resolveCash", () => {
  it("uses derived (netWorth - portfolio) when there are no accounts", () => {
    const r = resolveCash({ accounts: [], netWorthSnapshot: 39000, portfolioEur: 19000 });
    expect(r.source).toBe("derived");
    expect(r.derived).toBe(20000);
    expect(r.total).toBe(20000);
    expect(r.accountsTotal).toBe(0);
    expect(r.reconcileDelta).toBe(0);
    expect(r.hasAccounts).toBe(false);
  });

  it("uses the accounts sum when accounts exist, and reports the delta vs derived", () => {
    const r = resolveCash({
      accounts: [{ balance: 4000 }, { balance: 12000 }],
      netWorthSnapshot: 39000,
      portfolioEur: 19000,
    });
    expect(r.source).toBe("accounts");
    expect(r.accountsTotal).toBe(16000);
    expect(r.total).toBe(16000);
    expect(r.derived).toBe(20000);
    expect(r.reconcileDelta).toBe(-4000); // 16000 - 20000
    expect(r.hasAccounts).toBe(true);
  });
});
