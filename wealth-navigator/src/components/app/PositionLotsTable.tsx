import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  usePositionLots,
  useUpdateLot,
  useDeleteLot,
  type PositionLot,
} from "@/lib/position-lots-api";

function n(val: string) {
  return parseFloat(val.replace(",", "."));
}

export function PositionLotsTable({
  positionId,
  currency,
}: {
  positionId: string;
  currency: string;
}) {
  const { data: lots = [], isLoading } = usePositionLots(positionId);
  const updateLot = useUpdateLot();
  const deleteLot = useDeleteLot();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startEdit(lot: PositionLot) {
    setEditingId(lot.id);
    setEditQty(String(lot.quantity));
    setEditPrice(String(lot.price));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveEdit(lot: PositionLot) {
    const quantity = n(editQty);
    const price = n(editPrice);
    if (!(quantity > 0) || !(price > 0)) {
      setError("Cantidad y precio deben ser mayores que 0.");
      return;
    }
    try {
      await updateLot.mutateAsync({ id: lot.id, position_id: positionId, quantity, price });
      setEditingId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    }
  }

  async function handleDelete(lot: PositionLot) {
    setError(null);
    try {
      await deleteLot.mutateAsync({ id: lot.id, position_id: positionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al borrar.");
    }
  }

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        Historial de compras
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] text-[12px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1">Fecha</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Importe</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const isEditing = editingId === lot.id;
              return (
                <tr key={lot.id} className="border-t border-border">
                  <td className="py-1.5">{lot.date}</td>
                  {isEditing ? (
                    <>
                      <td className="py-1 pr-1">
                        <Input
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          className="h-7 w-20 text-[12px] tabular-nums"
                        />
                      </td>
                      <td className="py-1 pr-1">
                        <Input
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="h-7 w-20 text-[12px] tabular-nums"
                        />
                      </td>
                      <td className="tabular-nums text-muted-foreground">
                        {(n(editQty || "0") * n(editPrice || "0")).toFixed(2)} {currency}
                      </td>
                      <td className="flex items-center gap-1 py-1">
                        <button
                          type="button"
                          onClick={() => saveEdit(lot)}
                          disabled={updateLot.isPending}
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="tabular-nums">{lot.quantity}</td>
                      <td className="tabular-nums">
                        {lot.price.toFixed(4)} {currency}
                      </td>
                      <td className="tabular-nums text-muted-foreground">
                        {(lot.quantity * lot.price).toFixed(2)} {currency}
                      </td>
                      <td className="flex items-center gap-2 py-1">
                        <button
                          type="button"
                          onClick={() => startEdit(lot)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {!lot.plan_contribution_id && (
                          <button
                            type="button"
                            onClick={() => handleDelete(lot)}
                            disabled={deleteLot.isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {lot.plan_contribution_id && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            DCA
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
