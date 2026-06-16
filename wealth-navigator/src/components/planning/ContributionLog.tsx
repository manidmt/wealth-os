import { useState } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import type { InvestmentPlan } from "@/lib/planning-api";
import { usePlanContributions } from "@/lib/planning-api";

export function ContributionLog({ plan }: { plan: InvestmentPlan }) {
  const { data: contributions = [] } = usePlanContributions(plan.id);
  const [currentPrice, setCurrentPrice] = useState("");

  const withUnits = contributions.filter((c) => c.units && c.actual_amount);
  const totalInvested = contributions.reduce((s, c) => s + Number(c.actual_amount ?? 0), 0);
  const totalUnits = withUnits.reduce((s, c) => s + Number(c.units ?? 0), 0);
  const wap =
    totalUnits > 0
      ? withUnits.reduce((s, c) => s + Number(c.actual_amount ?? 0), 0) / totalUnits
      : null;
  const cp = Number(currentPrice);
  const ret = wap && cp > 0 ? (cp / wap - 1) * 100 : null;

  return (
    <SectionCard title={`LOG — ${plan.name}`}>
      <table className="w-full text-[12px]">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1">Fecha</th>
            <th>Aportado</th>
            <th>Precio</th>
            <th>Unidades</th>
            <th>Multi</th>
            <th>Señal</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-1">{c.date}</td>
              <td className="tabular-nums">
                {c.actual_amount != null ? `${Number(c.actual_amount).toFixed(0)} €` : "—"}
              </td>
              <td className="tabular-nums">{c.price != null ? Number(c.price).toFixed(2) : "—"}</td>
              <td className="tabular-nums">{c.units != null ? Number(c.units).toFixed(4) : "—"}</td>
              <td>{c.multiplier != null ? `×${Number(c.multiplier)}` : "—"}</td>
              <td className="text-muted-foreground">{c.signal_note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-[12px]">
        <span>
          Total aportado: <b>{totalInvested.toFixed(0)} €</b>
        </span>
        {wap && (
          <span>
            Precio medio ponderado: <b>{wap.toFixed(2)}</b>
          </span>
        )}
        {wap && (
          <span className="flex items-center gap-1">
            Precio actual:{" "}
            <Input
              className="h-7 w-24"
              type="number"
              step="any"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(e.target.value)}
            />
            {ret !== null && (
              <b className={ret >= 0 ? "text-emerald-600" : "text-red-600"}>
                {ret >= 0 ? "+" : ""}
                {ret.toFixed(1)} %
              </b>
            )}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
