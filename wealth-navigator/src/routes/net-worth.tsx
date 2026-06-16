import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard, SectionLabel } from "@/components/app/SectionCard";
import { KpiCard } from "@/components/app/KpiCard";
import { DeltaBadge } from "@/components/app/DeltaBadge";
import { NetWorthAreaChart } from "@/components/charts/charts";
import { RangeProvider, RangeToolbar, useRange } from "@/components/app/RangeToolbar";
import { MonthDetailDrawer } from "@/components/app/MonthDetailDrawer";
import { useMoney } from "@/components/app/CurrencyProvider";
import { formatMonth } from "@/lib/dashboard-data";
import { useDashboard } from "@/hooks/use-dashboard";

export const Route = createFileRoute("/net-worth")({
  head: () => ({
    meta: [
      { title: "Patrimonio — Wealth OS" },
      { name: "description", content: "Evolución mensual del patrimonio neto, activos y pasivos." },
    ],
  }),
  component: NetWorthPage,
});

function NetWorthPage() {
  const data = useDashboard();
  return (
    <AppShell pageEyebrow="Patrimonio">
      <PageHeader
        eyebrow="Histórico"
        title="Patrimonio"
        description={`Evolución mensual del patrimonio neto desde ${formatMonth(data.series[0].month)} hasta ${formatMonth(data.series[data.series.length - 1].month)}.`}
      />
      <RangeProvider defaultRange="12M">
        <div className="px-4 md:px-8">
          <RangeToolbar />
        </div>
        <NetWorthBody />
      </RangeProvider>
    </AppShell>
  );
}

function NetWorthBody() {
  const data = useDashboard();
  const { slice, baseline, compare } = useRange();
  const money = useMoney();
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const series = slice(data.series);
  const last = series[series.length - 1];
  const first = series[0];
  const base = baseline(data.series) ?? first;
  const totalGrowth = last.netWorth - base.netWorth;
  const totalGrowthPct = base.netWorth > 0 ? totalGrowth / base.netWorth : 0;
  const compareLabel =
    compare === "prev"
      ? `vs ${formatMonth(base.month)}`
      : compare === "first"
        ? `vs inicio ${formatMonth(base.month)}`
        : `vs YTD ${formatMonth(base.month)}`;

  const netTrend = series.map((p) => p.netWorth);
  const assetsTrend = series.map((p) => p.assets);
  const liabTrend = series.map((p) => Math.abs(p.liabilities));

  return (
    <div className="space-y-10 px-4 py-8 md:px-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          accent="primary"
          label="Patrimonio neto"
          value={money.format(last.netWorth)}
          hint={`Cierre ${formatMonth(last.month)}`}
          series={netTrend}
        />
        <KpiCard label="Activos" value={money.format(last.assets)} hint="Total bruto del cierre" series={assetsTrend} />
        <KpiCard label="Pasivos" value={money.format(last.liabilities)} hint="Préstamos y deudas" series={liabTrend} sparkColor="var(--negative)" />
        <KpiCard
          label="Crecimiento"
          value={money.format1(totalGrowth)}
          badge={<DeltaBadge value={totalGrowthPct} asPercent />}
          hint={compareLabel}
          series={netTrend.map((v, i, a) => (i === 0 ? 0 : v - a[i - 1])).slice(1)}
          sparkColor={totalGrowth >= 0 ? "var(--positive)" : "var(--negative)"}
        />
      </section>

      <SectionCard
        title="Evolución del patrimonio neto"
        description="Patrimonio consolidado mes a mes. Pulsa un mes para ver el detalle."
        askPrompt="Describe la evolución de mi patrimonio neto: meses de mayor crecimiento, retrocesos y ritmo medio."
      >
        <NetWorthAreaChart series={series} onSelectMonth={setSelectedMonth} />
      </SectionCard>

      <section>
        <SectionLabel>Snapshots del rango</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40">
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Mes</th>
                <th className="px-4 py-3 font-medium text-right">Activos</th>
                <th className="px-4 py-3 font-medium text-right">Pasivos</th>
                <th className="px-4 py-3 font-medium text-right">Patrimonio</th>
                <th className="px-4 py-3 font-medium text-right">Ahorro</th>
                <th className="px-4 py-3 font-medium text-right">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...series].reverse().map((p, i, arr) => {
                const next = arr[i + 1];
                const delta = next ? p.netWorth - next.netWorth : 0;
                return (
                  <tr
                    key={p.month}
                    onClick={() => setSelectedMonth(p.month)}
                    className="cursor-pointer transition hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 font-medium">{formatMonth(p.month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money.format1(p.assets)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money.format1(p.liabilities)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{money.format1(p.netWorth)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money.format1(p.savings)}</td>
                    <td className="px-4 py-3 text-right">
                      {next ? <DeltaBadge value={delta} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <MonthDetailDrawer
        month={selectedMonth}
        open={!!selectedMonth}
        onOpenChange={(o) => (o ? null : setSelectedMonth(null))}
      />
    </div>
  );
}
