import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AssistantMark } from "@/components/assistant/AssistantMark";
import { useMoney } from "@/components/app/CurrencyProvider";
import { DeltaBadge } from "@/components/app/DeltaBadge";
import { ExpenseTagsBreakdown } from "@/components/app/ExpenseTagsBreakdown";
import { AddMovementSheet } from "@/components/app/AddMovementSheet";
import { formatMonth, type SeriesPoint, type ExpenseMonth } from "@/lib/dashboard-data";
import { useDashboard } from "@/hooks/use-dashboard";
import { useMonthMovements, useDeleteMovement, type MovementRecord } from "@/lib/movements-api";

type Props = {
  month: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MonthDetailDrawer({ month, open, onOpenChange }: Props) {
  const data = useDashboard();
  const money = useMoney();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<MovementRecord | null>(null);

  const { data: movements, isLoading: movementsLoading } = useMonthMovements(month);
  const deleteMovement = useDeleteMovement();

  if (!month) return null;

  const idx = data.series.findIndex((p) => p.month === month);
  const point: SeriesPoint | undefined = data.series[idx];
  const prev: SeriesPoint | undefined = idx > 0 ? data.series[idx - 1] : undefined;
  const exp: ExpenseMonth | undefined = data.expenses.byMonth.find((m) => m.month === month);
  const prevExp: ExpenseMonth | undefined =
    exp && data.expenses.byMonth.findIndex((m) => m.month === month) > 0
      ? data.expenses.byMonth[data.expenses.byMonth.findIndex((m) => m.month === month) - 1]
      : undefined;

  const niceMonth = formatMonth(month);
  const askPrompt = `Analiza el cierre de ${niceMonth}: variación, gasto, ingresos y posibles anomalías.`;

  const incomes = (movements ?? []).filter((m) => m.type === "income");
  const expenses = (movements ?? []).filter((m) => m.type === "expense");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[88vh] max-h-[900px] w-[96vw] max-w-5xl flex-col gap-0 p-0">
          {/* Header */}
          <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Cierre mensual
            </div>
            <DialogTitle className="font-display text-2xl tracking-tight">{niceMonth}</DialogTitle>
            <DialogDescription className="sr-only">
              Detalle del cierre de {niceMonth}
            </DialogDescription>
          </DialogHeader>

          {/* Body: two-column on lg */}
          <div className="min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[1fr_1.5fr]">
            {/* Left column — stats + etiquetas */}
            <div className="overflow-y-auto border-b border-border p-6 lg:border-b-0 lg:border-r">
              <div className="space-y-6">
                {/* Snapshot stats */}
                {point ? (
                  <div className="space-y-4">
                    <SectionLabel>Patrimonio</SectionLabel>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Stat
                        label="Patrimonio neto"
                        value={money.format1(point.netWorth)}
                        badge={
                          prev ? (
                            <DeltaBadge
                              value={
                                prev.netWorth > 0
                                  ? (point.netWorth - prev.netWorth) / prev.netWorth
                                  : 0
                              }
                              asPercent
                            />
                          ) : null
                        }
                      />
                      <Stat label="Activos" value={money.format1(point.assets)} />
                      <Stat label="Pasivos" value={money.format1(point.liabilities)} />
                      <Stat label="Ahorro neto" value={money.format1(point.savings)} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-[12px] text-muted-foreground">
                    Sin snapshot de patrimonio para este mes.
                  </div>
                )}

                {exp ? (
                  <div className="space-y-3">
                    <SectionLabel>Flujo del mes</SectionLabel>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Stat
                        label="Ingresos"
                        value={money.format1(exp.incomeTotal)}
                        hint={prevExp ? `vs ${money.format1(prevExp.incomeTotal)} ant.` : undefined}
                      />
                      <Stat
                        label="Gastos"
                        value={money.format1(exp.expenseTotal)}
                        hint={
                          prevExp ? `vs ${money.format1(prevExp.expenseTotal)} ant.` : undefined
                        }
                      />
                      <Stat
                        label="Neto del mes"
                        value={money.format1(exp.net)}
                        badge={prevExp ? <DeltaBadge value={exp.net - prevExp.net} /> : null}
                      />
                      <Stat
                        label="Tasa de ahorro"
                        value={
                          exp.incomeTotal > 0
                            ? `${((exp.net / exp.incomeTotal) * 100).toFixed(0)}%`
                            : "—"
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {exp ? (
                  <div className="space-y-2">
                    <SectionLabel>Etiquetas del mes</SectionLabel>
                    <ExpenseTagsBreakdown
                      month={month}
                      rangeMonths={data.expenses.byMonth}
                      compact
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Right column — movimientos */}
            <div className="flex flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between px-6 py-4">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Movimientos
                  {(movements ?? []).length > 0 && (
                    <span className="ml-2 text-foreground">{(movements ?? []).length}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
                >
                  <span className="text-[15px] leading-none">+</span>
                  Añadir
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                {movementsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
                    ))}
                  </div>
                ) : (movements ?? []).length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-[12.5px] text-muted-foreground">
                    <span>Sin movimientos registrados</span>
                    <button
                      type="button"
                      onClick={() => setAddOpen(true)}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Añadir el primero
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {incomes.length > 0 && (
                      <MovementGroup
                        label="Ingresos"
                        rows={incomes}
                        month={month}
                        onEdit={setEditingMovement}
                        onDelete={(id) => deleteMovement.mutate({ id, month })}
                      />
                    )}
                    {expenses.length > 0 && (
                      <MovementGroup
                        label="Gastos"
                        rows={expenses}
                        month={month}
                        onEdit={setEditingMovement}
                        onDelete={(id) => deleteMovement.mutate({ id, month })}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-between border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-[13px] text-muted-foreground hover:text-foreground"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/assistant", search: { q: askPrompt } });
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90"
            >
              <AssistantMark className="h-3.5 w-3.5" />
              Preguntar al asistente
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AddMovementSheet open={addOpen} onOpenChange={setAddOpen} defaultMonth={month} />

      <AddMovementSheet
        open={!!editingMovement}
        onOpenChange={(o) => {
          if (!o) setEditingMovement(null);
        }}
        movement={editingMovement ?? undefined}
      />
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
}

function MovementGroup({
  label,
  rows,
  month: _month,
  onEdit,
  onDelete,
}: {
  label: string;
  rows: MovementRecord[];
  month: string;
  onEdit: (row: MovementRecord) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`flex items-center gap-3 px-4 py-3 text-[13px] ${
              row.excluded ? "opacity-60" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-foreground">{row.category}</span>
                {row.description ? (
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    {row.description}
                  </span>
                ) : null}
                {row.excluded ? (
                  <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    No cuenta
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{row.date}</div>
            </div>
            <span
              className={`shrink-0 tabular-nums font-medium ${
                row.type === "income" ? "text-positive" : "text-foreground"
              }`}
            >
              {row.type === "income" ? "+" : "−"}
              {row.amount.toLocaleString("es-ES", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}{" "}
              €
            </span>
            <button
              type="button"
              onClick={() => onEdit(row)}
              title="Editar"
              className="shrink-0 rounded p-1 text-muted-foreground/40 transition hover:bg-muted hover:text-foreground"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onDelete(row.id)}
              title="Eliminar"
              className="shrink-0 rounded p-1 text-muted-foreground/40 transition hover:bg-destructive/10 hover:text-destructive"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {badge}
      </div>
      <div className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
