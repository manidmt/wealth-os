import { type ExpenseMonth } from "@/lib/dashboard-data";

/**
 * Etiquetas transversales del gasto. A diferencia de las categorías
 * (Vivienda, Alimentación…), las etiquetas describen la *naturaleza* del
 * gasto y se cruzan entre categorías (p. ej. una suscripción de música
 * es Ocio + Recurrente + Suscripción).
 *
 * Cuando se conecte el backend, esto se reemplaza por una agregación real
 * sobre los movimientos etiquetados.
 */
export type ExpenseTag = {
  key: string;
  label: string;
  /** Peso base sobre el gasto total del mes (la suma puede superar 1: las
   *  etiquetas no son excluyentes). */
  weight: number;
  color: string;
};

export const EXPENSE_TAGS: ExpenseTag[] = [
  { key: "esencial",     label: "Esencial",      weight: 0.62, color: "var(--chart-1)" },
  { key: "recurrente",   label: "Recurrente",    weight: 0.55, color: "var(--chart-2)" },
  { key: "ocio",         label: "Ocio",          weight: 0.18, color: "var(--chart-3)" },
  { key: "suscripcion",  label: "Suscripciones", weight: 0.12, color: "var(--chart-4)" },
  { key: "variable",     label: "Variable",      weight: 0.28, color: "var(--chart-5)" },
  { key: "salud",        label: "Salud",         weight: 0.08, color: "var(--chart-1)" },
];

/** Hash determinista [0,1) basado en mes + tag, para perturbar pesos. */
function jitter(month: string, key: string) {
  let h = 2166136261;
  const s = `${month}:${key}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to [-0.18, +0.18]
  const u = ((h >>> 0) % 10000) / 10000;
  return (u - 0.5) * 0.36;
}

export type TagBreakdownItem = {
  tag: ExpenseTag;
  value: number;
  share: number;
};

/** Devuelve la asignación por etiqueta para un mes (ordenada desc). */
export function tagBreakdown(month: string, byMonth: ExpenseMonth[]): TagBreakdownItem[] {
  const m = byMonth.find((x) => x.month === month);
  if (!m) return [];
  const total = m.expenseTotal;
  const items = EXPENSE_TAGS.map((t) => {
    const w = Math.max(0.02, t.weight + jitter(month, t.key));
    const value = Math.round(total * w);
    return { tag: t, value, share: w };
  });
  return items.sort((a, b) => b.value - a.value);
}

/** Serie temporal de una etiqueta a lo largo de los meses dados. */
export function tagSeries(months: ExpenseMonth[], key: string): number[] {
  const tag = EXPENSE_TAGS.find((t) => t.key === key);
  if (!tag) return [];
  return months.map((m) => {
    const w = Math.max(0.02, tag.weight + jitter(m.month, key));
    return Math.round(m.expenseTotal * w);
  });
}
