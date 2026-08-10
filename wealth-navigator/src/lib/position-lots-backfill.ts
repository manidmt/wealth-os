export type BackfillPosition = {
  id: string;
  quantity: number;
  avg_cost: number;
  created_at: string;
};

export type BackfillContribution = {
  id: string;
  date: string;
  price: number | null;
  units: number | null;
};

export type BackfillLotInput = {
  position_id: string;
  plan_contribution_id: string | null;
  date: string;
  quantity: number;
  price: number;
  notes: string | null;
};

const EPSILON = 1e-6;

/**
 * Genera los lotes iniciales de una posición a partir de sus aportaciones DCA
 * reales (si las hay). Si no cubren el 100% de la cantidad actual, añade un
 * lote de ajuste que reproduce exactamente el avg_cost/quantity actuales.
 */
export function computeBackfillLots(
  position: BackfillPosition,
  contributions: BackfillContribution[],
): BackfillLotInput[] {
  const openedAt = position.created_at.slice(0, 10);
  const valid = contributions.filter(
    (c): c is BackfillContribution & { price: number; units: number } =>
      c.price != null && c.units != null && c.units > 0,
  );

  if (valid.length === 0) {
    return [
      {
        position_id: position.id,
        plan_contribution_id: null,
        date: openedAt,
        quantity: position.quantity,
        price: position.avg_cost,
        notes: "Saldo inicial",
      },
    ];
  }

  const lots: BackfillLotInput[] = valid.map((c) => ({
    position_id: position.id,
    plan_contribution_id: c.id,
    date: c.date,
    quantity: c.units,
    price: c.price,
    notes: null,
  }));

  const coveredQty = valid.reduce((s, c) => s + c.units, 0);
  const remaining = position.quantity - coveredQty;

  if (remaining > EPSILON) {
    const coveredCost = valid.reduce((s, c) => s + c.units * c.price, 0);
    const targetCost = position.quantity * position.avg_cost;
    const adjPrice = (targetCost - coveredCost) / remaining;
    lots.push({
      position_id: position.id,
      plan_contribution_id: null,
      date: openedAt,
      quantity: remaining,
      price: adjPrice,
      notes: "Saldo inicial (ajuste)",
    });
  }

  return lots;
}
