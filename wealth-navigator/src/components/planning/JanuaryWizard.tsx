import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";
import type { InvestmentPlan } from "@/lib/planning-api";
import { useUpdatePlan } from "@/lib/planning-api";
import { evaluateBase, type SignalMap } from "@/lib/strategy-engine";

export function JanuaryWizard({
  strategies,
  signals,
}: {
  strategies: InvestmentPlan[];
  signals: SignalMap;
}) {
  const update = useUpdatePlan();
  const year = new Date().getFullYear();

  const pending = strategies.filter(
    (p) =>
      p.active &&
      p.multiplier_rules?.base?.cadence === "annual" &&
      Number(p.annual_multiplier_year ?? 0) < year,
  );

  if (pending.length === 0) return null;

  return (
    <SectionCard title={`Calibración anual ${year}`}>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Fija los multiplicadores del año según las señales a 31 de diciembre. Revisa y confirma cada
        uno.
      </p>
      <div className="space-y-3">
        {pending.map((p) => {
          const proposal = evaluateBase(p.multiplier_rules!.base, signals);
          const base = Number(p.amount ?? 0);
          return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]"
            >
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{proposal.detail}</p>
                <p className="text-[11px]">
                  Propuesta: <b>×{proposal.multi}</b> → cuota {(base * proposal.multi).toFixed(0)}{" "}
                  €/mes
                  {p.asset_class === "btc" &&
                    ` (compra anual: ${(base * proposal.multi * 12).toFixed(0)} € de golpe)`}
                </p>
              </div>
              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    id: p.id,
                    annual_multiplier: proposal.multi,
                    annual_multiplier_year: year,
                  })
                }
              >
                Fijar ×{proposal.multi}
              </Button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
