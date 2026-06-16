import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/charts/charts";

type Props = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  accent?: "default" | "primary";
  className?: string;
  /** Optional trend series rendered as a 40px sparkline at the bottom. */
  series?: number[];
  /** Override sparkline color (defaults: chart-1, or white tint on primary). */
  sparkColor?: string;
};

export function KpiCard({
  label,
  value,
  hint,
  badge,
  accent = "default",
  className,
  series,
  sparkColor,
}: Props) {
  const isPrimary = accent === "primary";
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between gap-5 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_0_oklch(0.85_0.012_95/0.5)] transition-colors hover:border-border-strong",
        isPrimary && "bg-primary text-primary-foreground border-primary",
        className,
      )}
    >
      {isPrimary && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/5 blur-2xl"
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "text-[11px] uppercase tracking-[0.16em]",
            isPrimary ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {badge}
      </div>

      <div className="space-y-1.5">
        <div
          className={cn(
            "font-display text-[28px] font-semibold leading-none tracking-tight tabular-nums",
            isPrimary ? "text-primary-foreground" : "text-foreground",
          )}
        >
          {value}
        </div>
        {hint ? (
          <div
            className={cn(
              "text-[12px]",
              isPrimary ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {hint}
          </div>
        ) : null}
      </div>

      {series && series.length > 1 ? (
        <div
          className={cn(
            "-mx-1.5 -mb-1.5 h-10",
            isPrimary ? "opacity-90" : "opacity-80",
          )}
        >
          <Sparkline
            values={series}
            color={
              sparkColor ??
              (isPrimary
                ? "color-mix(in oklab, var(--primary-foreground) 75%, transparent)"
                : "var(--chart-1)")
            }
          />
        </div>
      ) : null}
    </div>
  );
}
