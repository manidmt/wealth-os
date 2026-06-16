import { Button } from "@/components/ui/button";
import { Flame, Pencil } from "lucide-react";
import type { InvestmentPlan } from "@/lib/planning-api";
import { useFireDryPowder } from "@/lib/planning-api";
import { toEnginePlan } from "@/lib/planning-calc";
import type { PortfolioPosition } from "@/lib/portfolio-api";
import {
  currentMultiplier,
  effectiveQuota,
  evaluateTrigger,
  type SignalMap,
} from "@/lib/strategy-engine";

export function StrategyCard({
  plan,
  signals,
  positions,
  onEdit,
  onRegister,
}: {
  plan: InvestmentPlan;
  signals: SignalMap;
  positions?: Pick<PortfolioPosition, "id" | "quantity" | "avgCost" | "currentPrice">[];
  onEdit: () => void;
  onRegister: () => void;
}) {
  const fire = useFireDryPowder();

  const enginePlan = toEnginePlan(plan);

  const multi = currentMultiplier(enginePlan, signals);
  const quota = effectiveQuota(enginePlan, signals);
  const trigger = plan.multiplier_rules?.trigger;
  const tr = evaluateTrigger(trigger, signals, plan.dry_powder?.last_fired_at ?? null);

  const light = tr.fired ? "bg-red-500" : tr.blocked ? "bg-amber-500" : "bg-emerald-500";

  const linkedPos = plan.portfolio_position_id
    ? positions?.find((p) => p.id === plan.portfolio_position_id)
    : undefined;

  let pnl = 0;
  if (linkedPos) {
    const cost = Number(linkedPos.quantity) * Number(linkedPos.avgCost);
    const marketValue = Number(linkedPos.quantity) * Number(linkedPos.currentPrice);
    pnl = cost > 0 ? (marketValue / cost - 1) * 100 : 0;
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{plan.name}</span>
          {!plan.active && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">inactiva</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className={`h-2.5 w-2.5 rounded-full ${light}`} title={tr.detail} />
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-2 text-[13px]">
        <span className="text-muted-foreground">{Number(plan.amount ?? 0).toFixed(0)} € base</span>
        <span className="text-muted-foreground">×{multi}</span>
        <span className="text-[16px] font-bold tabular-nums">{quota.toFixed(0)} €/mes</span>
      </div>

      {linkedPos && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Posición: {(Number(linkedPos.quantity) * Number(linkedPos.currentPrice)).toFixed(0)} €
          {" · P&L "}
          <span className={pnl >= 0 ? "text-emerald-600" : "text-red-600"}>
            {pnl >= 0 ? "+" : ""}
            {pnl.toFixed(1)} %
          </span>
        </p>
      )}

      {plan.dry_powder && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-[12px]">
          <span>
            Pólvora: <b>{Number(plan.dry_powder.current_eur).toFixed(0)} €</b>
            {plan.dry_powder.monthly_feed_eur > 0 &&
              ` (+${Number(plan.dry_powder.monthly_feed_eur).toFixed(0)} €/mes)`}
          </span>
          {tr.fired && plan.dry_powder.current_eur > 0 && (
            <Button
              size="sm"
              variant="destructive"
              disabled={fire.isPending}
              onClick={() => fire.mutate({ plan, multi: trigger!.multi, signalNote: tr.detail })}
            >
              <Flame className="mr-1 h-3.5 w-3.5" /> Soltar pólvora
            </Button>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">{tr.detail}</p>

      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={onRegister} disabled={!plan.active}>
          Registrar aportación
        </Button>
      </div>
    </div>
  );
}
