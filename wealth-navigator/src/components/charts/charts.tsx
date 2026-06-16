import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { monthShort, type SeriesPoint } from "@/lib/dashboard-data";
import { useMoney } from "@/components/app/CurrencyProvider";

/**
 * Recharts' ResponsiveContainer measures its parent at mount; during SSR /
 * the first hydration pass it has zero size and the chart renders empty
 * (requiring a hard refresh). Gating render behind a mount flag avoids the
 * mismatch and forces a clean client-side measure.
 */
function ChartMount({ children, height }: { children: ReactNode; height: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div
        className="w-full animate-pulse rounded-md bg-muted/40"
        style={{ height }}
        aria-hidden
      />
    );
  }
  return <div style={{ height, width: "100%" }}>{children}</div>;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--foreground)",
  boxShadow: "0 8px 24px -16px oklch(0.2 0.04 250 / 0.25)",
};

const axisStyle = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
};

function shortNumber(n: number) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(Math.round(n));
}

/* ----------------------------- Net worth area ---------------------------- */

export function NetWorthAreaChart({
  series,
  onSelectMonth,
}: {
  series: SeriesPoint[];
  onSelectMonth?: (month: string) => void;
}) {
  const money = useMoney();
  const rows = series.map((p) => ({
    month: monthShort(p.month) + " " + p.month.slice(2, 4),
    rawMonth: p.month,
    netWorth: money.convert(p.netWorth),
    assets: money.convert(p.assets),
  }));
  const handleClick = (e: { activePayload?: { payload: { rawMonth: string } }[] }) => {
    const m = e?.activePayload?.[0]?.payload?.rawMonth;
    if (m && onSelectMonth) onSelectMonth(m);
  };
  return (
    <ChartMount height={280}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={rows}
          margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
          onClick={handleClick as never}
          style={onSelectMonth ? { cursor: "pointer" } : undefined}
        >
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} {...axisStyle} />
          <YAxis
            tickFormatter={shortNumber}
            tickLine={false}
            axisLine={false}
            width={48}
            {...axisStyle}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            contentStyle={tooltipStyle}
            formatter={(v: unknown) =>
              new Intl.NumberFormat("es-ES", {
                style: "currency",
                currency: money.code,
                maximumFractionDigits: 1,
              }).format(Number(v))
            }
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#nwFill)"
            name="Patrimonio"
            isAnimationActive={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}

/* ----------------------------- Donut ------------------------------------- */

export function DonutChart({
  data,
  total,
}: {
  data: { label: string; value: number }[];
  total?: number;
}) {
  const money = useMoney();
  const sum = total ?? data.reduce((acc, d) => acc + d.value, 0);
  const converted = data.map((d) => ({ ...d, value: money.convert(d.value) }));
  return (
    <div className="relative">
      <ChartMount height={240}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={converted}
              dataKey="value"
              nameKey="label"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {converted.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: unknown, n: unknown) => [
                new Intl.NumberFormat("es-ES", {
                  style: "currency",
                  currency: money.code,
                  maximumFractionDigits: 1,
                }).format(Number(v)),
                String(n),
              ]}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11.5, color: "var(--muted-foreground)" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </ChartMount>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-12">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Total
        </div>
        <div className="font-display text-xl font-semibold tabular-nums">
          {money.format1(sum)}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Bars by month ----------------------------- */

export function MonthlyExpensesBars({
  rows,
  onSelectMonth,
}: {
  rows: { month: string; expenseTotal: number; incomeTotal: number; net: number }[];
  onSelectMonth?: (month: string) => void;
}) {
  const money = useMoney();
  const data = rows.map((r) => ({
    month: monthShort(r.month),
    rawMonth: r.month,
    Gastos: money.convert(r.expenseTotal),
    Ingresos: money.convert(r.incomeTotal),
    Neto: money.convert(r.net),
  }));
  const handleClick = (e: { activePayload?: { payload: { rawMonth: string } }[] }) => {
    const m = e?.activePayload?.[0]?.payload?.rawMonth;
    if (m && onSelectMonth) onSelectMonth(m);
  };
  return (
    <ChartMount height={280}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 8, left: 0, bottom: 8 }}
          onClick={handleClick as never}
          style={onSelectMonth ? { cursor: "pointer" } : undefined}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} {...axisStyle} />
          <YAxis tickFormatter={shortNumber} tickLine={false} axisLine={false} width={48} {...axisStyle} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: unknown) =>
              new Intl.NumberFormat("es-ES", {
                style: "currency",
                currency: money.code,
                maximumFractionDigits: 1,
              }).format(Number(v))
            }
          />
          <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} iconType="circle" iconSize={8} />
          <Bar dataKey="Ingresos" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          <Bar dataKey="Gastos" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          <Line type="monotone" dataKey="Neto" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}

/* ----------------------------- Horizontal bar list ------------------------ */

export function BarList({
  items,
  total,
}: {
  items: { label: string; value: number }[];
  total?: number;
}) {
  const money = useMoney();
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  return (
    <ul className="space-y-3">
      {items.map((it, i) => {
        const pct = sum > 0 ? (it.value / sum) * 100 : 0;
        return (
          <li key={it.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate text-foreground">{it.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {money.format1(it.value)}{" "}
                <span className="text-muted-foreground/70">· {pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------- Sparkline --------------------------------- */

export function Sparkline({ values, color }: { values: number[]; color?: string }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ChartMount height={40}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color ?? "var(--chart-1)"}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
