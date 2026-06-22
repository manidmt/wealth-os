export type CashAccount = {
  id: string;
  name: string;
  balance: number;
  updated_at: string;
};

export type CashResolution = {
  total: number; // efectivo usado (cuentas si las hay, si no derivado)
  derived: number; // patrimonio(snapshot) − cartera
  accountsTotal: number; // suma de saldos de cuentas
  source: "accounts" | "derived";
  reconcileDelta: number; // accountsTotal − derived (0 si no hay cuentas)
  hasAccounts: boolean;
};

export function accountsTotal(accounts: { balance: number }[]): number {
  return accounts.reduce((s, a) => s + a.balance, 0);
}

export function resolveCash(input: {
  accounts: { balance: number }[];
  netWorthSnapshot: number;
  portfolioEur: number;
}): CashResolution {
  const total = accountsTotal(input.accounts);
  const derived = input.netWorthSnapshot - input.portfolioEur;
  const hasAccounts = input.accounts.length > 0;
  return {
    total: hasAccounts ? total : derived,
    derived,
    accountsTotal: total,
    source: hasAccounts ? "accounts" : "derived",
    reconcileDelta: hasAccounts ? total - derived : 0,
    hasAccounts,
  };
}
