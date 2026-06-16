import { useState } from "react";
import { Copy } from "lucide-react";
import { useDuplicateBudget } from "@/lib/budget-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DuplicatePreviousMonthButton({
  month,
  hasData,
}: {
  month: string;
  hasData: boolean;
}) {
  const duplicate = useDuplicateBudget();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    try {
      await duplicate.mutateAsync({ from: shiftMonth(month, -1), to: month });
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo duplicar.");
    }
  }

  function onClick() {
    if (hasData) {
      setConfirmOpen(true);
    } else {
      void run();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={duplicate.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        <Copy className="h-3.5 w-3.5" />
        Duplicar mes anterior
      </button>
      {error && !confirmOpen && <span className="ml-2 text-[11px] text-red-500">{error}</span>}

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Sobrescribir planificación</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Este mes ya tiene una planificación. ¿Reemplazarla con la del mes anterior?
          </p>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-md border border-border px-4 py-2 text-[12.5px] hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={duplicate.isPending}
              className="rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Reemplazar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
