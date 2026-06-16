import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard, SectionLabel } from "@/components/app/SectionCard";
import { KpiCard } from "@/components/app/KpiCard";
import { DeltaBadge } from "@/components/app/DeltaBadge";
import { RangeProvider, RangeToolbar, useRange } from "@/components/app/RangeToolbar";
import { MonthDetailDrawer } from "@/components/app/MonthDetailDrawer";
import {
  BarList,
  DonutChart,
  NetWorthAreaChart,
} from "@/components/charts/charts";
import { InsightsCard } from "@/components/assistant/InsightsCard";
import { BudgetSummaryCard } from "@/components/planning/BudgetSummaryCard";
import { useMoney } from "@/components/app/CurrencyProvider";
import { formatMonth } from "@/lib/dashboard-data";
import { useDashboard } from "@/hooks/use-dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Resumen — Wealth OS" },
      {
        name: "description",
        content:
          "Vista ejecutiva del patrimonio: KPIs, evolución mensual, allocation y gasto del mes.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const data = useDashboard();
  return (
    <AppShell pageEyebrow="Resumen ejecutivo">
      <PageHeader
        eyebrow={`${data.latestMonth === data.currentCalendarMonth ? "En curso" : "Cierre"} · ${formatMonth(data.latestMonth)}`}
        title="Resumen"
        description={`Vista ejecutiva del patrimonio de ${data.owner}. Cifras en tiempo real basadas en posiciones actuales.`}
        actions={
          <Link
            to="/net-worth"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] font-medium hover:border-border-strong"
          >
            Ver evolución <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <RangeProvider defaultRange="12M">
        <div className="px-4 md:px-8">
          <RangeToolbar label={`${data.latestMonth === data.currentCalendarMonth ? "En curso" : "Cierre"} · ${formatMonth(data.latestMonth)}`} />
        </div>
        <HomeBody />
      </RangeProvider>
    </AppShell>
  );
}

function HomeBody() {
  const data = useDashboard();
  const { slice, baseline, compare } = useRange();
  const money = useMoney();
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const series = slice(data.series);
  const expenseMonths = slice(data.expenses.byMonth);
  const lastMonths = expenseMonths.slice(-6);

  // KPI computations driven by the active range + compare mode
  const last = series[series.length - 1] ?? data.series[data.series.length - 1];
  const first = series[0] ?? data.series[0];
  const baseSeries = baseline(data.series) ?? first;
  const change = last.netWorth - baseSeries.netWorth;
  const changePct = baseSeries.netWorth > 0 ? change / baseSeries.netWorth : 0;

  const baseExp = baseline(data.expenses.byMonth);
  const lastExp = expenseMonths[expenseMonths.length - 1];
  const expDelta =
    lastExp && baseExp ? lastExp.expenseTotal - baseExp.expenseTotal : 0;

  const compareLabel =
    compare === "prev"
      ? `vs ${formatMonth(baseSeries.month)}`
      : compare === "first"
        ? `vs inicio ${formatMonth(baseSeries.month)}`
        : `vs YTD ${formatMonth(baseSeries.month)}`;

  const totalSavings = expenseMonths.reduce((acc, m) => acc + m.net, 0);

  const topCats = data.expenses.currentMonthCategories.slice(0, 5);
  const topHoldings = [...data.portfolio.holdings]
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const allocationTotal = data.allocation.reduce((a, b) => a + b.value, 0);

  // Sparkline trends from the active range slice
  const netWorthTrend = series.map((p) => p.netWorth);
  const assetsTrend = series.map((p) => p.assets);
  const monthlyDeltas = series
    .map((p, i, arr) => (i === 0 ? 0 : p.netWorth - arr[i - 1].netWorth))
    .slice(1);
  const savingsTrend = expenseMonths.map((m) => m.net);

  return (
    <div className="space-y-10 px-4 py-8 md:px-8">
      <section>
        <SectionLabel>Patrimonio · {compareLabel}</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            accent="primary"
            label="Patrimonio neto"
            value={money.format(last.netWorth)}
            hint={`Activos ${money.format(last.assets)} · Pasivos ${money.format(last.liabilities)}`}
            badge={<DeltaBadge value={changePct} asPercent />}
            series={netWorthTrend}
          />
          <KpiCard
            label="Variación"
            value={money.format1(change)}
            hint={compareLabel}
            badge={<DeltaBadge value={changePct} asPercent />}
            series={monthlyDeltas}
            sparkColor={change >= 0 ? "var(--positive)" : "var(--negative)"}
          />
          <KpiCard
            label="Ahorro acumulado"
            value={money.format1(totalSavings)}
            hint={`${expenseMonths.length} cierres en el rango`}
            series={savingsTrend}
            sparkColor="var(--chart-2)"
          />
          <KpiCard
            label="Gasto del mes"
            value={lastExp ? money.format1(lastExp.expenseTotal) : "—"}
            hint={baseExp ? `vs ${money.format1(baseExp.expenseTotal)} (${compareLabel})` : ""}
            badge={baseExp ? <DeltaBadge value={expDelta} invert /> : null}
            series={expenseMonths.map((m) => m.expenseTotal)}
            sparkColor="var(--chart-4)"
          />
        </div>
      </section>

      <InsightsCard />

      <section>
        <BudgetSummaryCard />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <SectionCard
          title="Evolución del patrimonio"
          description={`Serie mensual desde ${formatMonth(first.month)}. Pulsa un mes para ver el detalle.`}
          askPrompt="Analiza la evolución del patrimonio neto: tendencia, mejores y peores meses, y ritmo de crecimiento."
          actions={
            <Link
              to="/net-worth"
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              Detalle →
            </Link>
          }
        >
          <NetWorthAreaChart series={series} onSelectMonth={setSelectedMonth} />
        </SectionCard>

        <SectionCard
          title="Distribución del patrimonio"
          description="Composición por tipo de activo sobre el total."
          askPrompt="¿Está bien diversificada mi distribución por tipo de activo? Señala concentraciones."
        >
          <DonutChart data={data.allocation} total={allocationTotal} />
        </SectionCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <SectionCard
          title={`Gasto del mes — ${formatMonth(data.expenses.currentMonth)}`}
          description={`Total ${money.format1(data.expenses.currentMonthTotal)} · Ingresos ${money.format1(data.expenses.currentMonthIncome)}`}
          askPrompt={`Explícame el gasto de ${formatMonth(data.expenses.currentMonth)}: top categorías, anomalías y comparativa con el mes anterior.`}
          actions={
            <Link
              to="/expenses"
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              Detalle →
            </Link>
          }
        >
          <BarList items={topCats} />
        </SectionCard>

        <SectionCard
          title="Posiciones principales"
          description="Top posiciones por valor de mercado."
          askPrompt="Comenta mis posiciones principales: peso relativo, riesgo de concentración y posibles ajustes."
          actions={
            <Link
              to="/portfolio"
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              Portfolio →
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {topHoldings.map((h) => (
              <li
                key={h.label + h.platform}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {h.label}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {h.platform}
                  </div>
                </div>
                <div className="text-[13px] font-medium tabular-nums">
                  {money.format1(h.value)}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </section>

      <section>
        <SectionLabel>Últimos cierres en el rango</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {lastMonths.map((m) => (
            <button
              key={m.month}
              type="button"
              onClick={() => setSelectedMonth(m.month)}
              className="rounded-lg border border-border bg-card p-3.5 text-left transition hover:border-border-strong"
            >
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatMonth(m.month)}
              </div>
              <div className="mt-1 font-display text-base font-semibold tabular-nums">
                {money.format1(m.net)}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                Gasto {money.format1(m.expenseTotal)}
              </div>
            </button>
          ))}
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
