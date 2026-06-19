import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import type { InvestmentPlan } from "@/lib/planning-api";
import { useUpsertContribution } from "@/lib/planning-api";
import { useSyncContributionToPosition } from "@/lib/portfolio-sync";
import { computePlannedAmount, type MonthlyFinancials } from "@/lib/planning-calc";
import { feedsPortfolio } from "@/lib/contribution-sync-rule";
import {
  emptyRow,
  isValidRow,
  buildContributions,
  type BackfillRow,
} from "@/lib/backfill-contributions";

export function BackfillContributions({
  plan,
  monthlyFinancials = [],
}: {
  plan: InvestmentPlan;
  monthlyFinancials?: MonthlyFinancials[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BackfillRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const upsert = useUpsertContribution();
  const syncPosition = useSyncContributionToPosition();
  const qc = useQueryClient();

  const validCount = rows.filter(isValidRow).length;

  function setRow(i: number, patch: Partial<BackfillRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)));
  }

  async function save() {
    const built = buildContributions(rows);
    if (built.length === 0) return;
    setSaving(true);
    try {
      for (const c of built) {
        await upsert.mutateAsync({
          plan_id: plan.id,
          date: c.date,
          planned_amount: computePlannedAmount(plan, monthlyFinancials, c.month),
          actual_amount: c.amount,
          price: c.price,
          units: c.units,
          multiplier: null,
        });
        if (feedsPortfolio(c.month)) {
          await syncPosition.mutateAsync({ plan, amount: c.amount, units: c.units });
        }
      }
      qc.invalidateQueries({ queryKey: ["plan_contributions", "all"] });
      toast.success(
        `${built.length} aportación${built.length === 1 ? "" : "es"} guardada${built.length === 1 ? "" : "s"}`,
      );
      setRows([emptyRow()]);
    } catch (e) {
      toast.error(`No se pudieron guardar: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground/80 hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Añadir aportaciones
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] text-muted-foreground">
            <span>Mes</span>
            <span>Importe €</span>
            <span>Precio</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
              <Input
                type="month"
                value={row.month}
                onChange={(e) => setRow(i, { month: e.target.value })}
                className="h-8 text-[12.5px]"
              />
              <Input
                type="number"
                step="any"
                placeholder="400"
                value={row.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                className="h-8 text-[12.5px] tabular-nums"
              />
              <Input
                type="number"
                step="any"
                placeholder="10.40"
                value={row.price}
                onChange={(e) => setRow(i, { price: e.target.value })}
                className="h-8 text-[12.5px] tabular-nums"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Eliminar fila"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 text-[12px] text-foreground/70 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir fila
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || validCount === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {saving
                ? "Guardando…"
                : `Guardar ${validCount} aportacion${validCount === 1 ? "" : "es"}`}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Las aportaciones de meses pasados solo se registran en el log; no se suman al portfolio.
          </p>
        </div>
      )}
    </div>
  );
}
