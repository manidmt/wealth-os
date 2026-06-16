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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  useCreateMovement,
  useCreateExclusionRule,
  useUpdateMovement,
  type MovementRecord,
  type MovementType,
} from "@/lib/movements-api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, the sheet operates in edit mode. */
  movement?: MovementRecord;
  /** Used as default date prefix when creating (YYYY-MM). */
  defaultMonth?: string;
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function categoryOptions(type: MovementType, existing?: string) {
  const base = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (existing && !base.includes(existing)) return [existing, ...base];
  return base;
}

/** Primera palabra "significativa" (≥3 chars) de la descripción, en mayúsculas, o "". */
function significantWord(description: string): string {
  const words = description
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w.replace(/[^A-ZÁÉÍÓÚÑ0-9]/g, "").length >= 3);
  return words[0]?.replace(/[^A-ZÁÉÍÓÚÑ0-9]/g, "") ?? "";
}

export function AddMovementSheet({ open, onOpenChange, movement, defaultMonth }: Props) {
  const isEdit = !!movement;

  const [type, setType] = useState<MovementType>("expense");
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [excluded, setExcluded] = useState(false);
  const [createRuleChecked, setCreateRuleChecked] = useState(false);
  const [ruleMatchText, setRuleMatchText] = useState("");

  const createMovement = useCreateMovement();
  const updateMovement = useUpdateMovement();
  const createRule = useCreateExclusionRule();
  const isPending = createMovement.isPending || updateMovement.isPending;

  // Sync form state when movement or open changes
  useEffect(() => {
    if (!open) return;
    if (movement) {
      setType(movement.type);
      setDate(movement.date);
      setCategory(movement.category);
      setDescription(movement.description ?? "");
      setAmount(String(movement.amount));
      setExcluded(movement.excluded ?? false);
      setRuleMatchText(significantWord(movement.description ?? ""));
      setCreateRuleChecked(false);
    } else {
      setType("expense");
      setDate(defaultMonth ? `${defaultMonth}-${todayStr().slice(8)}` : todayStr());
      setCategory("");
      setDescription("");
      setAmount("");
      setExcluded(false);
      setRuleMatchText("");
      setCreateRuleChecked(false);
    }
  }, [open, movement, defaultMonth]);

  const categories = categoryOptions(type, isEdit ? movement?.category : undefined);

  function reset() {
    setType("expense");
    setDate(defaultMonth ? `${defaultMonth}-${todayStr().slice(8)}` : todayStr());
    setCategory("");
    setDescription("");
    setAmount("");
    setExcluded(false);
    setRuleMatchText("");
    setCreateRuleChecked(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount.replace(",", "."));
    if (!date || !category || isNaN(parsed) || parsed <= 0) return;

    if (isEdit && movement) {
      await updateMovement.mutateAsync({
        id: movement.id,
        month: movement.month,
        type,
        date,
        category,
        description: description.trim() || undefined,
        amount: parsed,
        currency: movement.currency || "EUR",
        excluded,
      });
    } else {
      await createMovement.mutateAsync({
        type,
        date,
        category,
        description: description.trim() || undefined,
        amount: parsed,
        currency: "EUR",
        excluded,
      });
    }

    if (excluded && createRuleChecked && ruleMatchText.trim()) {
      createRule.mutate(ruleMatchText.trim());
    }

    if (!isEdit) reset();
    onOpenChange(false);
  }

  const title = isEdit
    ? `Editar ${type === "expense" ? "gasto" : "ingreso"}`
    : `Añadir ${type === "expense" ? "gasto" : "ingreso"}`;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && !isEdit) reset();
        onOpenChange(o);
      }}
    >
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader className="gap-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {isEdit ? "Editar movimiento" : "Nuevo movimiento"}
          </div>
          <SheetTitle className="font-display text-2xl tracking-tight">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            {isEdit
              ? "Formulario para editar un movimiento"
              : "Formulario para añadir un gasto o ingreso"}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5 px-1">
          {/* Type toggle */}
          <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t);
                  // Keep category only if it exists in the new type's list
                  const next = categoryOptions(t, undefined);
                  if (!next.includes(category)) setCategory("");
                }}
                className={`flex-1 rounded-md py-1.5 text-[13px] font-medium transition ${
                  type === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "expense" ? "Gasto" : "Ingreso"}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mov-date" className="text-[12px]">
              Fecha
            </Label>
            <Input
              id="mov-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mov-cat" className="text-[12px]">
              Categoría
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="mov-cat" className="text-[13px]">
                <SelectValue placeholder="Selecciona una categoría…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c} className="text-[13px]">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mov-desc" className="text-[12px]">
              Descripción <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="mov-desc"
              type="text"
              placeholder="Ej. Café Starbucks"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mov-amount" className="text-[12px]">
              Importe (EUR)
            </Label>
            <div className="relative">
              <Input
                id="mov-amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="pr-10 text-[13px] tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                €
              </span>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="space-y-0.5">
              <Label htmlFor="mov-excluded" className="text-[12px]">
                No contabilizar
              </Label>
              <p className="text-[11.5px] leading-snug text-muted-foreground">
                El movimiento no suma en los totales (p.ej. traspaso entre cuentas propias).
              </p>
            </div>
            <Switch
              id="mov-excluded"
              checked={excluded}
              onCheckedChange={setExcluded}
              className="mt-0.5 shrink-0"
            />
          </div>

          {excluded && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="mov-rule-text" className="text-[12px]">
                  Excluir siempre los que contengan
                </Label>
                <Input
                  id="mov-rule-text"
                  type="text"
                  placeholder="Ej. INDEXA"
                  value={ruleMatchText}
                  onChange={(e) => setRuleMatchText(e.target.value)}
                  className="text-[13px]"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="mov-create-rule" className="text-[12px]">
                  Crear regla
                </Label>
                <Switch
                  id="mov-create-rule"
                  checked={createRuleChecked}
                  onCheckedChange={setCreateRuleChecked}
                  className="shrink-0"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                if (!isEdit) reset();
                onOpenChange(false);
              }}
              className="text-[13px] text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <Button
              type="submit"
              disabled={isPending || !category || !amount}
              className="min-w-[100px]"
            >
              {isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar"}
            </Button>
          </div>

          {(createMovement.isError || updateMovement.isError) && (
            <p className="text-[12px] text-destructive">Error al guardar. Inténtalo de nuevo.</p>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
