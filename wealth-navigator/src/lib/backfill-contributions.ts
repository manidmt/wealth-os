export type BackfillRow = { month: string; amount: string; price: string };

export type BuiltContribution = {
  month: string; // YYYY-MM
  date: string; // YYYY-MM-01
  amount: number;
  price: number;
  units: number;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function num(v: string): number {
  return parseFloat(String(v).replace(",", "."));
}

export function emptyRow(): BackfillRow {
  return { month: "", amount: "", price: "" };
}

export function isValidRow(row: BackfillRow): boolean {
  if (!MONTH_RE.test(row.month)) return false;
  const amount = num(row.amount);
  const price = num(row.price);
  return Number.isFinite(amount) && amount > 0 && Number.isFinite(price) && price > 0;
}

export function buildContributions(rows: BackfillRow[]): BuiltContribution[] {
  return rows.filter(isValidRow).map((row) => {
    const amount = num(row.amount);
    const price = num(row.price);
    return {
      month: row.month,
      date: `${row.month}-01`,
      amount,
      price,
      units: amount / price,
    };
  });
}
