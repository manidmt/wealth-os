import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { PlatformBadge } from "./PlatformBadge";
import { AssistantMark } from "@/components/assistant/AssistantMark";
import { useMoney } from "@/components/app/CurrencyProvider";
import { type Holding } from "@/lib/dashboard-data";
import { holdingDetail, formatQty } from "@/lib/holding-details";
import { Pencil, Trash2, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  holding: Holding | null;
  total: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function HoldingDrawer({ holding, total, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const money = useMoney();
  const [pendingAction, setPendingAction] = useState<null | "edit" | "delete">(null);

  if (!holding) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const detail = holdingDetail(holding);
  const weight = total > 0 ? (holding.value / total) * 100 : 0;
  const isLiability = holding.value < 0;
  const askPrompt = `Cuéntame más sobre mi posición "${holding.label}" en ${holding.platform}: peso, riesgo y posibles ajustes.`;

  const plPositive = detail.unrealized > 0;
  const plZero = detail.unrealized === 0;
  const PlIcon = plZero ? null : plPositive ? ArrowUpRight : ArrowDownRight;

  const close = () => {
    setPendingAction(null);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setPendingAction(null);
        onOpenChange(o);
      }}
    >
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader className="gap-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {holding.category ?? "Posición"}
          </div>
          <SheetTitle className="font-display text-2xl tracking-tight">
            {holding.label}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detalle de la posición {holding.label}
          </SheetDescription>
          <div className="flex items-center justify-between gap-3 pt-2">
            <PlatformBadge name={holding.platform} />
            <span className="text-[11px] text-muted-foreground">{detail.lastUpdatedAt}</span>
          </div>
        </SheetHeader>

        <div className="mt-6 grid gap-3 px-4 sm:grid-cols-2">
          <Stat label="Valor de mercado" value={money.format1(holding.value)} accent={isLiability ? "negative" : undefined} />
          <Stat label="Peso del portfolio" value={`${weight.toFixed(2)}%`} />
        </div>

        {!detail.isCash && (
          <>
            <div className="mt-6 px-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Detalle de la posición
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Stat label="Cantidad" value={formatQty(detail.quantity)} />
                <Stat label="Precio actual" value={money.format1(detail.currentPrice)} />
                <Stat label="Precio medio compra" value={money.format1(detail.avgPrice)} />
                <Stat label="Coste total" value={money.format1(detail.cost)} />
              </div>
            </div>

            <div className="mt-3 px-4">
              <div
                className={cn(
                  "flex items-center justify-between rounded-lg border p-3",
                  plZero
                    ? "border-border bg-muted/30"
                    : plPositive
                      ? "border-positive/30 bg-positive/5"
                      : "border-negative/30 bg-negative/5",
                )}
              >
                <div>
                  <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    P/L no realizado
                  </div>
                  <div
                    className={cn(
                      "mt-1 font-display text-lg font-semibold tabular-nums",
                      plZero
                        ? "text-foreground"
                        : plPositive
                          ? "text-positive"
                          : "text-negative",
                    )}
                  >
                    {money.format1(detail.unrealized)}
                  </div>
                </div>
                <div
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium tabular-nums",
                    plZero
                      ? "bg-muted text-muted-foreground"
                      : plPositive
                        ? "bg-positive/10 text-positive"
                        : "bg-negative/10 text-negative",
                  )}
                >
                  {PlIcon && <PlIcon className="h-3.5 w-3.5" />}
                  {(detail.unrealizedPct * 100).toFixed(2)}%
                </div>
              </div>
              <div className="mt-2 text-[11.5px] text-muted-foreground">
                Primera compra: {detail.firstBoughtAt}
              </div>
            </div>
          </>
        )}

        {detail.isCash && (
          <div className="mt-6 px-4">
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-[12px] leading-relaxed text-muted-foreground">
              Posición de efectivo: el saldo se registra como valor único, sin
              precio medio ni cantidad asociada.
            </div>
          </div>
        )}

        {pendingAction && (
          <div className="mt-4 px-4">
            <div className="rounded-lg border border-amber-300/40 bg-amber-100/30 p-3 text-[12px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {pendingAction === "edit"
                ? "La edición de posiciones llegará al conectar el backend. De momento puedes anotar el cambio en Ajustes."
                : "Para borrar la posición necesitamos el backend conectado. Confirma desde Ajustes cuando esté disponible."}
            </div>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 pt-4">
          <button
            type="button"
            onClick={() => setPendingAction("edit")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
          <button
            type="button"
            onClick={() => setPendingAction("delete")}
            className="inline-flex items-center gap-1.5 rounded-md border border-negative/30 bg-background px-2.5 py-2 text-[12px] font-medium text-negative transition hover:bg-negative/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Borrar
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              navigate({ to: "/assistant", search: { q: askPrompt } });
            }}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            <AssistantMark className="h-3.5 w-3.5" />
            Preguntar al asistente
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "negative";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "mt-1 font-display text-base font-semibold tabular-nums " +
          (accent === "negative" ? "text-negative" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}
