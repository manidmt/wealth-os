import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/charts/charts";
import { useMoney } from "@/components/app/CurrencyProvider";
import {
  EXPENSE_TAGS,
  tagBreakdown,
  tagSeries,
  type TagBreakdownItem,
} from "@/lib/expense-tags";
import type { ExpenseMonth } from "@/lib/dashboard-data";

type Props = {
  /** Mes "actual" sobre el que se calcula el desglose. */
  month: string;
  /** Meses dentro del rango activo, para la tendencia de cada etiqueta. */
  rangeMonths: ExpenseMonth[];
  className?: string;
  /** Compacta: oculta sparklines y reduce padding (uso en drawer). */
  compact?: boolean;
};

export function ExpenseTagsBreakdown({ month, rangeMonths, className, compact }: Props) {
  const money = useMoney();
  const items: TagBreakdownItem[] = tagBreakdown(month, rangeMonths);
  const [active, setActive] = useState<string>(items[0]?.tag.key ?? "");

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-[12px] text-muted-foreground">
        Sin etiquetas registradas para este mes.
      </div>
    );
  }

  const max = items[0].value;
  const activeTag = EXPENSE_TAGS.find((t) => t.key === active) ?? items[0].tag;
  const series = tagSeries(rangeMonths, activeTag.key);
  const trendDelta =
    series.length >= 2
      ? (series[series.length - 1] - series[0]) / Math.max(1, series[0])
      : 0;

  return (
    <div className={cn("space-y-4", className)}>
      <ul className={cn("space-y-2.5", compact && "space-y-2")}>
        {items.map((it) => {
          const pct = (it.value / max) * 100;
          const isActive = it.tag.key === active;
          return (
            <li key={it.tag.key}>
              <button
                type="button"
                onClick={() => setActive(it.tag.key)}
                className={cn(
                  "group block w-full rounded-md px-2 py-1.5 text-left transition",
                  isActive ? "bg-muted/60" : "hover:bg-muted/40",
                )}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2 truncate text-foreground">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: it.tag.color }}
                    />
                    <span className="truncate">{it.tag.label}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {money.format1(it.value)}{" "}
                    <span className="text-muted-foreground/70">
                      · {(it.share * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: it.tag.color }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {!compact && series.length > 1 ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Tendencia · {activeTag.label}
            </div>
            <div
              className={cn(
                "text-[11.5px] font-medium tabular-nums",
                trendDelta > 0
                  ? "text-negative"
                  : trendDelta < 0
                    ? "text-positive"
                    : "text-muted-foreground",
              )}
            >
              {trendDelta === 0
                ? "—"
                : `${trendDelta > 0 ? "+" : ""}${(trendDelta * 100).toFixed(1)}%`}
            </div>
          </div>
          <Sparkline values={series} color={activeTag.color} />
          <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground tabular-nums">
            <span>{money.format1(series[0])}</span>
            <span>{money.format1(series[series.length - 1])}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
