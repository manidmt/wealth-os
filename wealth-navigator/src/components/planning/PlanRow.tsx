import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Flame, CalendarCheck } from "lucide-react";
import type { InvestmentPlan } from "@/lib/planning-api";
import { usePlanContributions, useFireDryPowder } from "@/lib/planning-api";
import type { SignalMap } from "@/lib/strategy-engine";
import type { PortfolioPosition } from "@/lib/portfolio-api";
import type { MonthlyFinancials } from "@/lib/planning-calc";
import { buildPlanContextEntry } from "@/lib/planning-context";
import { euro } from "@/lib/dashboard-data";

type PositionLike = Pick<
  PortfolioPosition,
  "id" | "quantity" | "avgCost" | "currentPrice" | "assetName"
>;

export function PlanRow({
  plan,
  signals,
  positions,
  monthlyFinancials,
  month,
  onEdit,
  onContribute,
}: {
  plan: InvestmentPlan;
  signals: SignalMap;
  positions: PositionLike[];
  monthlyFinancials: MonthlyFinancials[];
  month: string;
  onEdit: () => void;
  onContribute: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fire = useFireDryPowder();
  const { data: contributions = [] } = usePlanContributions(plan.id);

  const e = buildPlanContextEntry({
    plan,
    signals,
    positions,
    contributions,
    monthlyFinancials,
    month,
  });

  const light = e.trigger.fired
    ? "bg-red-500"
    : e.trigger.blocked
      ? "bg-amber-500"
      : "bg-emerald-500";
  const isStrategy = !!plan.asset_class;
  const canFire = e.trigger.fired && (e.dryPowder?.currentEur ?? 0) > 0;
  const triggerMulti = plan.multiplier_rules?.trigger?.multi;

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${light}`} title={e.trigger.detail} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{plan.name}</span>
          <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
            {isStrategy && e.multiplier !== 1
              ? `${e.baseAmount.toFixed(0)}€ ×${e.multiplier}`
              : e.rule}
          </span>
          <span className="shrink-0 tabular-nums text-[13px] font-semibold">
            {plan.rule_type === "event" ? "—" : `${e.effectiveQuota.toFixed(0)} €/mes`}
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={
            canFire && triggerMulti != null
              ? () => fire.mutate({ plan, multi: triggerMulti, signalNote: e.trigger.detail })
              : onContribute
          }
          disabled={!plan.active || (canFire && fire.isPending)}
          className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
            canFire
              ? "border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20"
              : "border-border bg-background text-foreground/80 hover:border-border-strong"
          }`}
        >
          {canFire ? (
            <>
              <Flame className="mr-1 inline h-3.5 w-3.5" />
              Soltar
            </>
          ) : (
            <>
              <CalendarCheck className="mr-1 inline h-3.5 w-3.5" />
              Aportar
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="space-y-1.5 pb-3 pl-6 pr-2 text-[12px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Activo</span>
            <span className="text-foreground">{plan.asset_name}</span>
          </div>
          {e.positionValueEur != null && (
            <div className="flex justify-between">
              <span>Posición · P&L</span>
              <span className="text-foreground">
                {euro.format(e.positionValueEur)}
                {" · "}
                <span className={e.pnlPct! >= 0 ? "text-emerald-600" : "text-red-500"}>
                  {e.pnlPct! >= 0 ? "+" : ""}
                  {e.pnlPct!.toFixed(1)}%
                </span>
              </span>
            </div>
          )}
          {e.dryPowder && (
            <div className="flex justify-between">
              <span>Pólvora seca</span>
              <span className="text-foreground">
                {euro.format(e.dryPowder.currentEur)}
                {e.dryPowder.monthlyFeedEur > 0
                  ? ` (+${e.dryPowder.monthlyFeedEur.toFixed(0)} €/mes)`
                  : ""}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Planificado · aportado</span>
            <span className="text-foreground">
              {euro.format(e.plannedThisMonth)}
              {" · "}
              {e.actualThisMonth != null ? euro.format(e.actualThisMonth) : "sin registrar"}
            </span>
          </div>
          <div className="pt-0.5 text-[11px]">{e.trigger.detail}</div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[12px] text-foreground/70 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              type="button"
              onClick={onContribute}
              className="inline-flex items-center gap-1 text-[12px] text-foreground/70 hover:text-foreground"
            >
              <CalendarCheck className="h-3.5 w-3.5" />
              Registrar aportación
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
