import { categoryFromMcc } from "./mcc-categories.ts";

export type EbTransaction = {
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status: "BOOK" | "PDNG";
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  transaction_id?: string;
  entry_reference?: string;
  merchant_category_code?: string | null;
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
  /** Id sintético cuando el banco no manda transaction_id ni entry_reference. */
  fallback_id?: string;
};

export type MovementRow = {
  user_id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  currency: string;
  description: string;
  category: string;
  external_id: string;
};

export function isBooked(tx: EbTransaction): boolean {
  return tx.status === "BOOK";
}

export function mapTransaction(tx: EbTransaction, userId: string): MovementRow {
  const type = tx.credit_debit_indicator === "CRDT" ? "income" : "expense";
  const amount = Math.abs(parseFloat(tx.transaction_amount.amount));
  const description = (
    tx.remittance_information?.join(" ") ||
    tx.creditor?.name ||
    tx.debtor?.name ||
    "Sin descripción"
  ).trim().slice(0, 200);
  return {
    user_id: userId,
    date: (tx.booking_date ?? tx.value_date ?? tx.transaction_date) as string,
    type,
    amount,
    currency: tx.transaction_amount.currency,
    description,
    category: categoryFromMcc(tx.merchant_category_code) ?? "Sin categoría",
    external_id: (tx.transaction_id ?? tx.entry_reference ?? tx.fallback_id) as string,
  };
}

function fnv1a(str: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Algunos bancos (Trade Republic) no mandan ningún id. Se deriva uno estable de
 * los datos del movimiento; el contador distingue movimientos idénticos del mismo
 * día, y es estable porque cada sync pide días completos (date_from es una fecha).
 */
export function withFallbackIds(txs: EbTransaction[], accountUid: string): EbTransaction[] {
  const seen = new Map<string, number>();
  return txs.map((tx) => {
    if (tx.transaction_id || tx.entry_reference) return tx;
    const key = [
      accountUid,
      tx.booking_date ?? tx.value_date ?? tx.transaction_date ?? "",
      tx.credit_debit_indicator,
      tx.transaction_amount.amount,
      tx.transaction_amount.currency,
      (tx.remittance_information ?? []).join(" "),
      tx.creditor?.name ?? "",
      tx.debtor?.name ?? "",
    ].join("|");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const full = `${key}|${n}`;
    return { ...tx, fallback_id: `fp:${fnv1a(full, 0x811c9dc5)}${fnv1a(full, 0x01234567)}` };
  });
}
