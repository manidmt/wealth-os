import { useMemo } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInvestmentPlans } from "@/lib/planning-api";
import { useLatestSignals } from "@/lib/signals-api";
import { computePlannedAmount, toEnginePlan, type MonthlyFinancials } from "@/lib/planning-calc";
import { effectiveQuota } from "@/lib/strategy-engine";
import { euro } from "@/lib/dashboard-data";
import type { BudgetMap } from "@/lib/budget-calc";

export const POLVORA_KEY = "__polvora__";

export function SavingsAllocationPanel({
  month,
  savingsGoal,
  allocations,
  monthlyFinancials,
  onChange,
}: {
  month: string;
  savingsGoal: number;
  allocations: BudgetMap;
  monthlyFinancials: MonthlyFinancials[];
  onChange: (next: BudgetMap) => void;
}) {
  const { data: plans = [] } = useInvestmentPlans();
  const { data: signals = {} } = useLatestSignals();

  const activePlans = useMemo(() => plans.filter((p) => p.active), [plans]);

  function plannedFor(planId: string): number {
    const plan = activePlans.find((p) => p.id === planId);
    if (!plan) return 0;
    return plan.asset_class
      ? effectiveQuota(toEnginePlan(plan), signals)
      : computePlannedAmount(plan, monthlyFinancials, month);
  }

  const rows = [
    ...activePlans.map((p) => ({
      key: p.id,
      label: p.name,
      value: allocations[p.id] ?? Math.round(plannedFor(p.id)),
    })),
    { key: POLVORA_KEY, label: "Pólvora (reserva)", value: allocations[POLVORA_KEY] ?? 0 },
  ];

  const assigned = rows.reduce((s, r) => s + r.value, 0);
  const unassigned = savingsGoal - assigned;

  function update(key: string, amount: number) {
    onChange({ ...allocations, [key]: amount });
  }

  return (
    <SectionCard
      title="Reparto del ahorro"
      description="Cómo se reparte tu ahorro planificado entre tus planes de inversión y la pólvora."
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2">
            <Label className="text-[12.5px]">{r.label}</Label>
            <Input
              type="number"
              step="1"
              value={r.value}
              onChange={(e) => update(r.key, Number(e.target.value) || 0)}
              className="w-32 text-right text-[13px]"
            />
          </div>
        ))}
        <div className="space-y-1 border-t border-border pt-2 text-[12.5px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Objetivo de ahorro</span>
            <span className="font-medium">{euro.format(savingsGoal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Asignado</span>
            <span className="font-medium">{euro.format(assigned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {unassigned < 0 ? "Te pasas del ahorro" : "Sin asignar"}
            </span>
            <span
              className={`font-semibold ${unassigned < 0 ? "text-red-500" : "text-foreground"}`}
            >
              {euro.format(unassigned)}
            </span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
