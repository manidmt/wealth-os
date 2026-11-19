export type EbBalance = {
  name?: string;
  balance_amount: { amount: string; currency: string };
  balance_type: string;
  reference_date?: string;
  last_change_date_time?: string;
};

// Saldo contable actual primero; los "disponibles" pueden incluir descubierto.
const BALANCE_PREFERENCE = ["ITBD", "CLBD", "XPCD", "ITAV", "CLAV", "OTHR"];

export function pickBalance(balances: EbBalance[]): { amount: number; currency: string } | null {
  const parsed = balances
    .map((b) => ({
      type: b.balance_type,
      amount: parseFloat(b.balance_amount?.amount),
      currency: b.balance_amount?.currency,
    }))
    .filter((b) => Number.isFinite(b.amount) && b.currency);
  if (!parsed.length) return null;
  for (const type of BALANCE_PREFERENCE) {
    const hit = parsed.find((b) => b.type === type);
    if (hit) return { amount: hit.amount, currency: hit.currency };
  }
  return { amount: parsed[0].amount, currency: parsed[0].currency };
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type CashAccountRef = { id: string; name: string; bank_account_uid: string | null };

/** Cuenta manual sin enlazar cuyo nombre coincide con el banco; solo si es inequívoca. */
export function findAdoptableAccount(accounts: CashAccountRef[], institutionName: string): string | null {
  const inst = normalize(institutionName);
  if (!inst) return null;
  const candidates = accounts.filter((a) => {
    if (a.bank_account_uid) return false;
    const name = normalize(a.name);
    return name.length > 0 && (name.includes(inst) || inst.includes(name));
  });
  return candidates.length === 1 ? candidates[0].id : null;
}
