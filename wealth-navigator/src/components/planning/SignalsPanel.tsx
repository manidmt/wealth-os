import { useState } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { PANEL_SIGNALS, useLatestSignals, useUpsertManualSignal } from "@/lib/signals-api";
import { isStale, type SignalKey } from "@/lib/strategy-engine";

export function SignalsPanel() {
  const { data: signals = {} } = useLatestSignals();
  const upsert = useUpsertManualSignal();
  const [editing, setEditing] = useState<SignalKey | null>(null);
  const [value, setValue] = useState("");

  const fmt = (k: SignalKey, v: number) =>
    k.endsWith("_dd") ? `${(v * 100).toFixed(1)} %` : v.toFixed(2);

  return (
    <SectionCard title="Señales de mercado">
      <div className="divide-y divide-border text-[13px]">
        {PANEL_SIGNALS.map(({ key, label, manual, hint }) => {
          const s = signals[key];
          const stale = s ? isStale(s) : false;
          return (
            <div key={key} className="flex items-center gap-3 py-2">
              <span className="w-44 font-medium">{label}</span>
              <span className="w-24 tabular-nums">{s ? fmt(key, s.value) : "—"}</span>
              <span className="flex-1 text-muted-foreground">
                {s ? s.date : "sin dato"} · {hint}
                {stale && (
                  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">
                    caducada
                  </span>
                )}
                {!s && manual && (
                  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">
                    pendiente
                  </span>
                )}
              </span>
              {manual && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(key);
                    setValue(s ? String(s.value) : "");
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{PANEL_SIGNALS.find((p) => p.key === editing)?.label}</DialogTitle>
          </DialogHeader>
          <Input
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            disabled={upsert.isPending || value === ""}
            onClick={() => {
              upsert.mutate(
                { signal_key: editing!, value: Number(value) },
                { onSuccess: () => setEditing(null) },
              );
            }}
          >
            Guardar
          </Button>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
