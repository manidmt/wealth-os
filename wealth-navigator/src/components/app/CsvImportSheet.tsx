import { useRef, useState } from "react";
import { Upload, CheckCircle2, AlertCircle, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { parseCSV, type CsvBank, type ParsedRow } from "@/lib/csv-import";
import { useBulkImportMovements } from "@/lib/movements-api";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

const BANKS: { id: CsvBank; label: string }[] = [
  { id: "auto", label: "Detectar auto" },
  { id: "bbva", label: "BBVA" },
  { id: "n26", label: "N26" },
];

export function CsvImportSheet({ open, onOpenChange }: Props) {
  const [bank, setBank] = useState<CsvBank>("auto");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bulkImport = useBulkImportMovements();

  function reset() {
    setRows([]);
    setParseErrors([]);
    setFileName("");
    setResult(null);
    bulkImport.reset();
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFile(file: File) {
    setResult(null);
    bulkImport.reset();
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text, bank);
      setRows(parsed.rows);
      setParseErrors(parsed.errors);
    };
    reader.readAsText(file, "UTF-8");
  }

  async function handleImport() {
    const res = await bulkImport.mutateAsync(rows);
    setResult(res);
    setRows([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const income = rows.filter((r) => r.type === "income").length;
  const expenses = rows.filter((r) => r.type === "expense").length;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader className="gap-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Importar</div>
          <SheetTitle className="font-display text-2xl tracking-tight">Importar CSV</SheetTitle>
          <SheetDescription className="text-[13px]">
            Exporta desde tu banco y arrastra el archivo aquí.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-1 pt-6">
          {/* Bank selector */}
          <div>
            <div className="mb-2 text-[12px] font-medium">Banco</div>
            <div className="flex flex-wrap gap-2">
              {BANKS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { setBank(b.id); reset(); }}
                  className={`rounded-full border px-3 py-1 text-[12px] transition ${
                    bank === b.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {bank === "bbva" && "BBVA → App o Web → Movimientos → Exportar CSV (separador punto y coma)."}
              {bank === "n26" && "N26 → Cuenta → Exportar transacciones → CSV."}
              {bank === "auto" && "Selecciona tu banco para ver instrucciones de exportación."}
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-10 text-center transition hover:border-border-strong"
          >
            <Upload className="mb-3 h-6 w-6 text-muted-foreground" />
            {fileName ? (
              <span className="text-[13px] font-medium">{fileName}</span>
            ) : (
              <>
                <span className="text-[13px] font-medium">Arrastra el CSV aquí</span>
                <span className="mt-1 text-[12px] text-muted-foreground">o haz clic para seleccionar</span>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-warning">
                <AlertCircle className="h-3.5 w-3.5" /> {parseErrors.length} fila(s) ignoradas
              </div>
              <ul className="mt-1 space-y-0.5">
                {parseErrors.slice(0, 3).map((e, i) => (
                  <li key={i} className="text-[11.5px] text-muted-foreground">{e}</li>
                ))}
                {parseErrors.length > 3 && (
                  <li className="text-[11.5px] text-muted-foreground">…y {parseErrors.length - 3} más</li>
                )}
              </ul>
            </div>
          )}

          {/* Preview */}
          {rows.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium">
                  {rows.length} transacciones · {income} ingresos · {expenses} gastos
                </span>
                <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12px]">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium">Descripción</th>
                      <th className="px-3 py-2 font-medium text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, 6).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.date}</td>
                        <td className="max-w-[160px] truncate px-3 py-2">{r.description}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.type === "income" ? "text-positive" : ""}`}>
                          {r.type === "income" ? "+" : "-"}{r.amount.toFixed(2)} €
                        </td>
                      </tr>
                    ))}
                    {rows.length > 6 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                          …y {rows.length - 6} más
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import result */}
          {result && (
            <div className="flex items-start gap-3 rounded-lg border border-positive/30 bg-positive/5 px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
              <div>
                <div className="text-[13px] font-medium">{result.inserted} transacciones importadas</div>
                {result.skipped > 0 && (
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    {result.skipped} ya existían y se ignoraron (dedup por external_id)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Import error */}
          {bulkImport.isError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[12px] text-destructive">
              {(bulkImport.error as Error).message.includes("external_id")
                ? "Falta la columna external_id. Ejecuta primero la migración SQL en el dashboard de Supabase."
                : `Error: ${(bulkImport.error as Error).message}`}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => { reset(); onOpenChange(false); }}
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cerrar
          </button>
          <Button onClick={handleImport} disabled={!rows.length || bulkImport.isPending}>
            {bulkImport.isPending ? "Importando…" : rows.length ? `Importar ${rows.length}` : "Importar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
