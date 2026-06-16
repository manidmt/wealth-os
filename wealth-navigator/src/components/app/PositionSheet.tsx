import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASSET_TYPE_LABELS,
  COMMON_CURRENCIES,
  COMMON_PLATFORMS,
  useCreatePosition,
  useUpdatePosition,
  type PortfolioAssetType,
  type PortfolioPosition,
} from "@/lib/portfolio-api";

type Props =
  | { mode: "create"; open: boolean; onOpenChange: (o: boolean) => void }
  | {
      mode: "edit" | "add-shares";
      position: PortfolioPosition;
      open: boolean;
      onOpenChange: (o: boolean) => void;
    };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function n(val: number | string) {
  return parseFloat(String(val).replace(",", "."));
}

export function PositionSheet(props: Props) {
  const { open, onOpenChange, mode } = props;
  const position = mode !== "create" ? props.position : null;

  const createPosition = useCreatePosition();
  const updatePosition = useUpdatePosition();

  const [assetName, setAssetName] = useState("");
  const [ticker, setTicker] = useState("");
  const [isin, setIsin] = useState("");
  const [assetType, setAssetType] = useState<PortfolioAssetType>("stock");
  const [platform, setPlatform] = useState("");
  const [customPlatform, setCustomPlatform] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayStr());

  // add-shares mode
  const [addQty, setAddQty] = useState("");
  const [addPrice, setAddPrice] = useState("");

  useEffect(() => {
    if (!open) return;
    if (position) {
      setAssetName(position.assetName);
      setTicker(position.ticker);
      setIsin(position.isin);
      setAssetType(position.assetType);
      const knownPlatform = COMMON_PLATFORMS.includes(position.platform);
      setPlatform(knownPlatform ? position.platform : "__custom__");
      setCustomPlatform(knownPlatform ? "" : position.platform);
      setQuantity(String(position.quantity));
      setAvgCost(String(position.avgCost));
      setCurrentPrice(String(position.currentPrice));
      setCurrency(position.currency);
      setNotes(position.notes);
      setDate(position.openedAt.slice(0, 10));
    } else {
      setAssetName("");
      setTicker("");
      setIsin("");
      setAssetType("stock");
      setPlatform("");
      setCustomPlatform("");
      setQuantity("");
      setAvgCost("");
      setCurrentPrice("");
      setCurrency("EUR");
      setNotes("");
      setDate(todayStr());
    }
    setAddQty("");
    setAddPrice("");
  }, [open, position]);

  const resolvedPlatform = platform === "__custom__" ? customPlatform.trim() : platform;

  // live preview for add-shares
  const existingQty = position ? position.quantity : 0;
  const existingAvg = position ? position.avgCost : 0;
  const addQtyNum = n(addQty) || 0;
  const addPriceNum = n(addPrice) || 0;
  const newTotalQty = existingQty + addQtyNum;
  const newAvgCost =
    newTotalQty > 0
      ? (existingQty * existingAvg + addQtyNum * addPriceNum) / newTotalQty
      : existingAvg;

  const isPending = createPosition.isPending || updatePosition.isPending;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const qty = n(quantity);
    const avg = n(avgCost);
    const price = n(currentPrice) || avg;
    if (!assetName || !resolvedPlatform || qty <= 0 || avg < 0) return;

    await createPosition.mutateAsync({
      assetName,
      ticker: ticker.trim() || undefined,
      isin: isin.trim() || undefined,
      assetType,
      platform: resolvedPlatform,
      quantity: qty,
      avgCost: avg,
      currentPrice: price,
      currency,
      notes: notes.trim() || undefined,
      date,
    });
    onOpenChange(false);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!position) return;
    const qty = n(quantity);
    const avg = n(avgCost);
    const price = n(currentPrice) || avg;
    if (!assetName || !resolvedPlatform || qty <= 0 || avg < 0) return;

    await updatePosition.mutateAsync({
      id: position.id,
      assetName,
      ticker: ticker.trim() || undefined,
      isin: isin.trim() || undefined,
      assetType,
      platform: resolvedPlatform,
      quantity: qty,
      avgCost: avg,
      currentPrice: price,
      currency,
      notes: notes.trim() || undefined,
    });
    onOpenChange(false);
  }

  async function handleAddShares(e: React.FormEvent) {
    e.preventDefault();
    if (!position || addQtyNum <= 0 || addPriceNum < 0) return;

    await updatePosition.mutateAsync({
      id: position.id,
      quantity: newTotalQty,
      avgCost: newAvgCost,
    });
    onOpenChange(false);
  }

  const title =
    mode === "create"
      ? "Nueva posición"
      : mode === "add-shares"
        ? "Añadir compra"
        : "Editar posición";

  const eyebrow =
    mode === "create"
      ? "Portfolio"
      : mode === "add-shares"
        ? position?.assetName ?? "Posición"
        : position?.assetName ?? "Editar";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="gap-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </div>
          <SheetTitle className="font-display text-2xl tracking-tight">
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {title} en el portfolio
          </SheetDescription>
        </SheetHeader>

        {mode === "add-shares" ? (
          <form onSubmit={handleAddShares} className="mt-6 flex flex-col gap-5 px-1">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-[12.5px] leading-relaxed">
              <div className="text-muted-foreground">Posición actual</div>
              <div className="mt-1 flex justify-between tabular-nums">
                <span className="font-medium">{existingQty} unidades</span>
                <span className="text-muted-foreground">@ {existingAvg.toFixed(4)} {position?.currency}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-qty" className="text-[12px]">
                Cantidad comprada
              </Label>
              <Input
                id="add-qty"
                type="number"
                min="0.0001"
                step="any"
                placeholder="0"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                required
                className="text-[13px] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-price" className="text-[12px]">
                Precio por unidad ({position?.currency ?? "EUR"})
              </Label>
              <Input
                id="add-price"
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={addPrice}
                onChange={(e) => setAddPrice(e.target.value)}
                required
                className="text-[13px] tabular-nums"
              />
            </div>

            {addQtyNum > 0 && addPriceNum > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-[12.5px]">
                <div className="text-muted-foreground">Resultado tras la compra</div>
                <div className="mt-1.5 grid grid-cols-2 gap-1 tabular-nums">
                  <span className="text-muted-foreground">Total unidades</span>
                  <span className="text-right font-medium">{newTotalQty.toFixed(6).replace(/\.?0+$/, "")}</span>
                  <span className="text-muted-foreground">Precio medio</span>
                  <span className="text-right font-medium">{newAvgCost.toFixed(4)} {position?.currency}</span>
                  <span className="text-muted-foreground">Coste total</span>
                  <span className="text-right font-medium">
                    {(newTotalQty * newAvgCost).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {position?.currency}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-[13px] text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <Button
                type="submit"
                disabled={isPending || addQtyNum <= 0 || addPriceNum < 0}
                className="min-w-[100px]"
              >
                {isPending ? "Guardando…" : "Confirmar compra"}
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={mode === "create" ? handleCreate : handleEdit}
            className="mt-6 flex flex-col gap-4 px-1"
          >
            <div className="space-y-1.5">
              <Label htmlFor="pos-name" className="text-[12px]">Nombre del activo</Label>
              <Input
                id="pos-name"
                placeholder="Ej. MSCI World ETF"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                required
                className="text-[13px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pos-ticker" className="text-[12px]">
                  Ticker <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <Input
                  id="pos-ticker"
                  placeholder="IWDA"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  className="text-[13px] font-mono uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-isin" className="text-[12px]">
                  ISIN <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <Input
                  id="pos-isin"
                  placeholder="IE00B4L5Y983"
                  value={isin}
                  onChange={(e) => setIsin(e.target.value)}
                  className="text-[13px] font-mono uppercase"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px]">Tipo de activo</Label>
              <Select
                value={assetType}
                onValueChange={(v) => setAssetType(v as PortfolioAssetType)}
              >
                <SelectTrigger className="text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-[13px]">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px]">Plataforma / broker</Label>
              <Select
                value={platform}
                onValueChange={setPlatform}
              >
                <SelectTrigger className="text-[13px]">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p} className="text-[13px]">
                      {p}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__" className="text-[13px]">
                    Otra…
                  </SelectItem>
                </SelectContent>
              </Select>
              {platform === "__custom__" && (
                <Input
                  placeholder="Nombre de la plataforma"
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value)}
                  className="mt-2 text-[13px]"
                  required
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pos-qty" className="text-[12px]">Cantidad</Label>
                <Input
                  id="pos-qty"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                  className="text-[13px] tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Divisa</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-[13px]">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pos-avg" className="text-[12px]">Precio medio compra</Label>
                <Input
                  id="pos-avg"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={avgCost}
                  onChange={(e) => setAvgCost(e.target.value)}
                  required
                  className="text-[13px] tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-price" className="text-[12px]">
                  Precio actual{" "}
                  <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <Input
                  id="pos-price"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="= precio medio"
                  value={currentPrice}
                  onChange={(e) => setCurrentPrice(e.target.value)}
                  className="text-[13px] tabular-nums"
                />
              </div>
            </div>

            {mode === "create" && (
              <div className="space-y-1.5">
                <Label htmlFor="pos-date" className="text-[12px]">
                  Fecha de apertura{" "}
                  <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <Input
                  id="pos-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-[13px]"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pos-notes" className="text-[12px]">
                Notas <span className="text-muted-foreground">(opc.)</span>
              </Label>
              <Input
                id="pos-notes"
                placeholder="Cualquier anotación"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-[13px]"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-[13px] text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !assetName ||
                  !resolvedPlatform ||
                  !quantity ||
                  !avgCost
                }
                className="min-w-[100px]"
              >
                {isPending
                  ? "Guardando…"
                  : mode === "create"
                    ? "Crear posición"
                    : "Guardar cambios"}
              </Button>
            </div>

            {(createPosition.isError || updatePosition.isError) && (
              <p className="text-[12px] text-destructive">
                Error al guardar. Inténtalo de nuevo.
              </p>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
