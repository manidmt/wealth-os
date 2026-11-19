import { useState } from "react";
import { Pencil, Check, X, EyeOff, Eye, TrendingUp } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { useRecentMovements } from "@/lib/movements-api";
import { detectRecurring, applyOverrides, type RecurringExpense } from "@/lib/recurring";
import { useRecurringOverrides, useUpsertRecurringOverride } from "@/lib/recurring-overrides";
import { euro } from "@/lib/dashboard-data";

export function RecurringExpensesCard() {
  const { data: movs = [] } = useRecentMovements(6);
  const { data: overrides = [] } = useRecurringOverrides();
  const upsert = useUpsertRecurringOverride();

  const raw = detectRecurring(movs);
  const recurring = applyOverrides(raw, overrides);
  const total = recurring.reduce((s, r) => s + r.monthlyAmount, 0);
  const hidden = raw.filter((r) => overrides.some((o) => o.concept === r.concept && !o.active));

  const [editingConcept, setEditingConcept] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  function startEdit(r: RecurringExpense) {
    setEditingConcept(r.concept);
    setEditName(r.displayConcept);
    setEditAmount(String(r.monthlyAmount));
  }
  function cancelEdit() {
    setEditingConcept(null);
  }
  function saveEdit(r: RecurringExpense) {
    const amount = parseFloat(editAmount.replace(",", "."));
    upsert.mutate({
      concept: r.concept,
      display_name: editName.trim() || null,
      monthly_amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    });
    setEditingConcept(null);
  }
  function hide(r: RecurringExpense) {
    upsert.mutate({ concept: r.concept, active: false });
  }
  function unhide(concept: string) {
    upsert.mutate({ concept, active: true });
  }

  return (
    <SectionCard
      title="Gastos fijos"
      description={
        recurring.length
          ? `Suscripciones y recibos recurrentes · ${euro.format(total)}/mes estimado. Detectados automáticamente; puedes corregir el nombre, el importe u ocultarlos.`
          : "Aún no se detectan gastos fijos recurrentes."
      }
    >
      {recurring.length > 0 && (
        <div className="space-y-2">
          {recurring.map((r) => {
            const isEditing = editingConcept === r.concept;
            return (
              <div
                key={r.concept}
                className="flex items-center justify-between gap-3 text-[12.5px]"
              >
                {isEditing ? (
                  <>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-[12.5px]"
                      />
                      <Input
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="h-7 w-24 text-right text-[12.5px] tabular-nums"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveEdit(r)}
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
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-0">
                      <span className="font-medium">{r.displayConcept}</span>
                      <span className="text-muted-foreground"> · {r.category}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.priceIncreased && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <TrendingUp className="h-3 w-3" />
                          subió {euro.format(r.lastAmount - r.monthlyAmount)}
                        </span>
                      )}
                      <span className="font-medium">{euro.format(r.monthlyAmount)}/mes</span>
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        title="Editar"
                        className="text-muted-foreground/50 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => hide(r)}
                        title="No es un gasto fijo"
                        className="text-muted-foreground/50 hover:text-destructive"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hidden.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            {showHidden ? "Ocultar" : "Mostrar"} {hidden.length} oculto
            {hidden.length === 1 ? "" : "s"}
          </button>
          {showHidden && (
            <div className="mt-2 space-y-1.5">
              {hidden.map((r) => (
                <div
                  key={r.concept}
                  className="flex items-center justify-between text-[12px] text-muted-foreground"
                >
                  <span>{r.displayConcept}</span>
                  <button
                    type="button"
                    onClick={() => unhide(r.concept)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Eye className="h-3 w-3" /> Mostrar de nuevo
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
