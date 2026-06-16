import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PlatformBadge } from "./PlatformBadge";
import { AssistantMark } from "@/components/assistant/AssistantMark";
import { PositionSheet } from "@/components/app/PositionSheet";
import { useMoney } from "@/components/app/CurrencyProvider";
import { useDeletePosition, ASSET_TYPE_LABELS, type PortfolioPosition } from "@/lib/portfolio-api";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, ShoppingCart, ArrowUpRight, ArrowDownRight } from "lucide-react";

type Props = {
  position: PortfolioPosition | null;
  totalValue: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PositionDrawer({ position, totalValue, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const money = useMoney();
  const deletePosition = useDeletePosition();

  const [sheetMode, setSheetMode] = useState<"edit" | "add-shares" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!position) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const weight = totalValue > 0 ? (position.marketValueEur / totalValue) * 100 : 0;
  const pnlPositive = position.pnlValueEur > 0;
  const pnlZero = position.pnlValueEur === 0;
  const PnlIcon = pnlZero ? null : pnlPositive ? ArrowUpRight : ArrowDownRight;
  const isCash = position.assetType === "broker_cash";
  const askPrompt = `Cuéntame más sobre mi posición "${position.assetName}" en ${position.platform}: peso, riesgo y posibles ajustes.`;

  async function handleDelete() {
    await deletePosition.mutateAsync(position!.id);
    setConfirmDelete(false);
    onOpenChange(false);
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(false);
          onOpenChange(o);
        }}
      >
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
          <SheetHeader className="gap-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {ASSET_TYPE_LABELS[position.assetType]}
            </div>
            <SheetTitle className="font-display text-2xl tracking-tight">
              {position.assetName}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Detalle de la posición {position.assetName}
            </SheetDescription>
            <div className="flex items-center justify-between gap-3 pt-1">
              <PlatformBadge name={position.platform} />
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {position.ticker && (
                  <span className="font-mono">{position.ticker}</span>
                )}
                {position.currency !== "EUR" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                    {position.currency}
                  </span>
                )}
              </div>
            </div>
          </SheetHeader>

          <div className="mt-6 grid gap-3 px-4 sm:grid-cols-2">
            <Stat label="Valor de mercado" value={money.format1(position.marketValueEur)} />
            <Stat label="Peso del portfolio" value={`${weight.toFixed(2)}%`} />
          </div>

          {!isCash && (
            <>
              <div className="mt-4 px-4">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Detalle
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Stat
                    label="Cantidad"
                    value={
                      position.quantity >= 1
                        ? position.quantity.toLocaleString("es-ES")
                        : position.quantity.toFixed(6).replace(/\.?0+$/, "")
                    }
                  />
                  <Stat
                    label="Precio actual"
                    value={`${position.currentPrice.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${position.currency}`}
                  />
                  <Stat
                    label="Precio medio"
                    value={`${position.avgCost.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${position.currency}`}
                  />
                  <Stat
                    label="Coste total"
                    value={money.format1(position.costBasisEur)}
                  />
                </div>
              </div>

              <div className="mt-3 px-4">
                <div
                  className={cn(
                    "flex items-center justify-between rounded-lg border p-3",
                    pnlZero
                      ? "border-border bg-muted/30"
                      : pnlPositive
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
                        pnlZero
                          ? "text-foreground"
                          : pnlPositive
                            ? "text-positive"
                            : "text-negative",
                      )}
                    >
                      {money.format1(position.pnlValueEur)}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium tabular-nums",
                      pnlZero
                        ? "bg-muted text-muted-foreground"
                        : pnlPositive
                          ? "bg-positive/10 text-positive"
                          : "bg-negative/10 text-negative",
                    )}
                  >
                    {PnlIcon && <PnlIcon className="h-3.5 w-3.5" />}
                    {position.pnlPct != null
                      ? `${(position.pnlPct * 100).toFixed(2)}%`
                      : "—"}
                  </div>
                </div>
              </div>
            </>
          )}

          {position.notes ? (
            <div className="mt-3 px-4 text-[12px] text-muted-foreground">
              {position.notes}
            </div>
          ) : null}

          {confirmDelete && (
            <div className="mt-4 px-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px]">
                <p className="font-medium text-destructive">¿Eliminar esta posición?</p>
                <p className="mt-1 text-muted-foreground">
                  Se borrará permanentemente de tu portfolio.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deletePosition.isPending}
                    className="rounded-md bg-destructive px-3 py-1.5 text-[12px] font-medium text-destructive-foreground transition hover:opacity-90 disabled:opacity-60"
                  >
                    {deletePosition.isPending ? "Eliminando…" : "Confirmar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition hover:text-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 pt-4">
            {!isCash && (
              <button
                type="button"
                onClick={() => setSheetMode("add-shares")}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-[12px] font-medium text-foreground transition hover:bg-muted"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                Añadir compra
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheetMode("edit")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-[12px] font-medium text-foreground transition hover:bg-muted"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-negative/30 bg-background px-2.5 py-2 text-[12px] font-medium text-negative transition hover:bg-negative/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Borrar
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/assistant", search: { q: askPrompt } });
              }}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90"
            >
              <AssistantMark className="h-3.5 w-3.5" />
              Preguntar
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {sheetMode && (
        <PositionSheet
          mode={sheetMode}
          position={position}
          open={!!sheetMode}
          onOpenChange={(o) => { if (!o) setSheetMode(null); }}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}
