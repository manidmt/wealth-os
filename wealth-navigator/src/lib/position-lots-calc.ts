/** Agrega una lista de lotes de compra en cantidad total + coste medio ponderado. */
export function aggregateLots(
  lots: { quantity: number; price: number }[],
): { quantity: number; avg_cost: number } {
  const quantity = lots.reduce((s, l) => s + l.quantity, 0);
  if (quantity <= 0) return { quantity: 0, avg_cost: 0 };
  const cost = lots.reduce((s, l) => s + l.quantity * l.price, 0);
  return { quantity, avg_cost: cost / quantity };
}
