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
    external_id: (tx.transaction_id ?? tx.entry_reference) as string,
  };
}
