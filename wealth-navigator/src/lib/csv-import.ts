export type CsvBank = "auto" | "bbva" | "n26";

export type ParsedRow = {
  date: string;
  type: "income" | "expense";
  amount: number;
  currency: string;
  description: string;
  external_id: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  errors: string[];
  detectedBank: "bbva" | "n26" | "unknown";
};

// "1.234,56" or "−45,50" → number
function parseSpanishDecimal(s: string): number {
  return parseFloat(
    s.trim().replace(/[−–]/g, "-").replace(/\./g, "").replace(",", "."),
  );
}

// "DD/MM/YYYY" or "DD-MM-YYYY" or "YYYY-MM-DD" → "YYYY-MM-DD"
function toISODate(s: string): string | null {
  const parts = s.trim().split(/[\/\-]/);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts;
  if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
  if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  return null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
}

function externalId(bank: string, date: string, amount: number, desc: string): string {
  return `csv_${bank}_${date}_${Math.round(Math.abs(amount) * 100)}_${slugify(desc)}`;
}

function detectSep(text: string): string {
  const first = text.split(/\r?\n/)[0] ?? "";
  return (first.match(/;/g) ?? []).length >= (first.match(/,/g) ?? []).length ? ";" : ",";
}

function splitCsv(text: string, sep: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const cols: string[] = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === sep && !inQ) { cols.push(cur.trim()); cur = ""; }
        else { cur += ch; }
      }
      cols.push(cur.trim());
      return cols;
    });
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-záéíóúñ0-9 ]/g, "").trim();
}

// ─── N26 ──────────────────────────────────────────────────────────────────────
// Headers: Date, Payee, Account number, Transaction type, Payment reference, Amount (EUR), ...
function parseN26(rows: string[][], headers: string[]): ParseResult {
  const di = headers.findIndex((h) => h === "date");
  const pi = headers.findIndex((h) => h.includes("payee"));
  const ri = headers.findIndex((h) => h.includes("payment reference") || h.includes("reference"));
  const ai = headers.findIndex((h) => h.includes("amount (eur)") || h === "amount (eur)");

  if (di === -1 || ai === -1) {
    return { rows: [], errors: ["No se encontraron columnas Date y Amount (EUR) — ¿es formato N26?"], detectedBank: "n26" };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length || row.every((c) => !c)) continue;
    const date = toISODate(row[di] ?? "");
    if (!date) { errors.push(`Fila ${i + 1}: fecha inválida "${row[di]}"`); continue; }
    const amount = parseFloat(row[ai] ?? "");
    if (isNaN(amount) || amount === 0) { errors.push(`Fila ${i + 1}: importe inválido "${row[ai]}"`); continue; }
    const desc = ((pi >= 0 ? row[pi] : "") || (ri >= 0 ? row[ri] : "") || "Sin descripción").trim().slice(0, 200);
    parsed.push({ date, type: amount > 0 ? "income" : "expense", amount: Math.abs(amount), currency: "EUR", description: desc, external_id: externalId("n26", date, amount, desc) });
  }

  return { rows: parsed, errors, detectedBank: "n26" };
}

// ─── BBVA ─────────────────────────────────────────────────────────────────────
// Headers: Fecha [operación], Fecha valor, Concepto / Descripción del movimiento, Importe (€), Saldo / Disponible
function parseBBVA(rows: string[][], headers: string[]): ParseResult {
  const di = headers.findIndex((h) => h.startsWith("fecha") && !h.includes("valor"));
  const ni = headers.findIndex((h) => h.includes("concepto") || h.includes("descripci"));
  const ai = headers.findIndex((h) => h.includes("importe") && !h.includes("saldo") && !h.includes("disponible"));

  if (di === -1 || ai === -1) {
    return { rows: [], errors: ["No se encontraron columnas Fecha e Importe — ¿es formato BBVA?"], detectedBank: "bbva" };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length || row.every((c) => !c)) continue;
    const date = toISODate(row[di] ?? "");
    if (!date) { errors.push(`Fila ${i + 1}: fecha inválida "${row[di]}"`); continue; }
    const amount = parseSpanishDecimal(row[ai] ?? "");
    if (isNaN(amount) || amount === 0) { errors.push(`Fila ${i + 1}: importe inválido "${row[ai]}"`); continue; }
    const desc = (ni >= 0 ? row[ni] : "") || "Sin descripción";
    parsed.push({ date, type: amount > 0 ? "income" : "expense", amount: Math.abs(amount), currency: "EUR", description: desc.trim().slice(0, 200), external_id: externalId("bbva", date, amount, desc) });
  }

  return { rows: parsed, errors, detectedBank: "bbva" };
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function parseCSV(text: string, bank: CsvBank): ParseResult {
  const sep = detectSep(text);
  const rows = splitCsv(text, sep);
  if (rows.length < 2) return { rows: [], errors: ["Archivo vacío o sin datos"], detectedBank: "unknown" };

  const headers = rows[0].map(normalizeHeader);

  const detected: CsvBank =
    bank !== "auto" ? bank
    : headers.some((h) => h.includes("payee") || h.includes("amount (eur)")) ? "n26"
    : headers.some((h) => h.includes("concepto") || h.includes("disponible") || h.includes("importe")) ? "bbva"
    : "auto";

  if (detected === "n26") return parseN26(rows, headers);
  if (detected === "bbva") return parseBBVA(rows, headers);
  return { rows: [], errors: ["Formato no reconocido. Selecciona el banco manualmente."], detectedBank: "unknown" };
}
