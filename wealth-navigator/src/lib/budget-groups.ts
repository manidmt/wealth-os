export type BudgetGroup = { key: string; label: string; categories: string[] };

export const BUDGET_GROUPS: BudgetGroup[] = [
  { key: "comida", label: "Comida", categories: ["Comida", "Café"] },
  { key: "ocio", label: "Ocio", categories: ["Ocio", "Viaje", "Comer fuera"] },
  { key: "transporte", label: "Transporte", categories: ["Transporte", "Coche"] },
  { key: "hogar", label: "Hogar", categories: ["Hogar", "Suscripciones", "Impuestos", "Gestiones"] },
  {
    key: "salud",
    label: "Salud y bienestar",
    categories: ["Salud", "Gimnasio", "Deporte", "Cuidado personal", "Higiene", "Suplementos"],
  },
  { key: "compras", label: "Compras", categories: ["Ropa", "Tecnología", "Regalo"] },
  { key: "formacion", label: "Formación", categories: ["Educación", "Formación"] },
  { key: "otros", label: "Otros", categories: ["Otro"] },
];

const CATEGORY_TO_GROUP: Record<string, string> = Object.fromEntries(
  BUDGET_GROUPS.flatMap((g) => g.categories.map((c) => [c, g.key])),
);

export function groupForCategory(category: string): string {
  return CATEGORY_TO_GROUP[category] ?? "otros";
}
