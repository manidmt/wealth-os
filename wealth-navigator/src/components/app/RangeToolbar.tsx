import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RangeKey = "3M" | "6M" | "12M" | "YTD" | "ALL";
export type CompareMode = "prev" | "first" | "ytd";

const OPTIONS: { key: RangeKey; label: string; months: number | "ytd" | "all" }[] = [
  { key: "3M", label: "3M", months: 3 },
  { key: "6M", label: "6M", months: 6 },
  { key: "12M", label: "12M", months: 12 },
  { key: "YTD", label: "YTD", months: "ytd" },
  { key: "ALL", label: "Todo", months: "all" },
];

const COMPARE_OPTIONS: { key: CompareMode; label: string; hint: string }[] = [
  { key: "prev", label: "Mes ant.", hint: "Frente al mes inmediatamente anterior" },
  { key: "first", label: "Inicio rango", hint: "Frente al primer mes del rango activo" },
  { key: "ytd", label: "YTD", hint: "Frente al primer mes del año en curso" },
];

type Ctx = {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  compare: CompareMode;
  setCompare: (c: CompareMode) => void;
  /** Trim a series with `month: "YYYY-MM"` field according to the active range. */
  slice<T extends { month: string }>(rows: T[]): T[];
  /** Pick the comparison baseline row according to the active compare mode. */
  baseline<T extends { month: string }>(rows: T[]): T | null;
};

const RangeContext = createContext<Ctx | null>(null);

export function RangeProvider({
  children,
  defaultRange = "12M",
  defaultCompare = "prev",
}: {
  children: ReactNode;
  defaultRange?: RangeKey;
  defaultCompare?: CompareMode;
}) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [compare, setCompare] = useState<CompareMode>(defaultCompare);

  const value = useMemo<Ctx>(() => {
    const opt = OPTIONS.find((o) => o.key === range)!;
    function slice<T extends { month: string }>(rows: T[]) {
      if (!rows.length) return rows;
      if (opt.months === "all") return rows;
      if (opt.months === "ytd") {
        const lastYear = rows[rows.length - 1].month.slice(0, 4);
        return rows.filter((r) => r.month.startsWith(lastYear));
      }
      return rows.slice(-opt.months);
    }
    function baseline<T extends { month: string }>(rows: T[]) {
      if (rows.length < 2) return null;
      const sliced = slice(rows);
      if (compare === "prev") return sliced[sliced.length - 2] ?? null;
      if (compare === "first") return sliced[0] ?? null;
      // ytd
      const lastYear = rows[rows.length - 1].month.slice(0, 4);
      return rows.find((r) => r.month.startsWith(lastYear)) ?? null;
    }
    return { range, setRange, compare, setCompare, slice, baseline };
  }, [range, compare]);

  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange() {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error("useRange must be used inside <RangeProvider>");
  return ctx;
}

type ToolbarProps = {
  /** Optional left-aligned context label (e.g. "Resumen · 12 cierres"). */
  label?: ReactNode;
  /** Optional extra controls on the right. */
  actions?: ReactNode;
  /** Show the compare-mode segmented control (default: true). */
  showCompare?: boolean;
  className?: string;
};

export function RangeToolbar({ label, actions, showCompare = true, className }: ToolbarProps) {
  const { range, setRange, compare, setCompare } = useRange();
  return (
    <div
      className={cn(
        "sticky top-14 z-20 -mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
        <span className="text-[10.5px] uppercase tracking-[0.16em]">Rango</span>
        <div
          role="tablist"
          aria-label="Rango temporal"
          className="inline-flex rounded-md border border-border bg-card p-0.5 text-[12px]"
        >
          {OPTIONS.map((o) => {
            const active = o.key === range;
            return (
              <button
                key={o.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setRange(o.key)}
                className={cn(
                  "rounded px-2.5 py-1 font-medium tabular-nums transition",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {label ? <span className="hidden truncate sm:inline">{label}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {showCompare ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="hidden text-[10.5px] uppercase tracking-[0.16em] sm:inline">
              Comparar
            </span>
            <div
              role="tablist"
              aria-label="Modo de comparación"
              className="inline-flex rounded-md border border-border bg-card p-0.5 text-[12px]"
            >
              {COMPARE_OPTIONS.map((o) => {
                const active = o.key === compare;
                return (
                  <button
                    key={o.key}
                    role="tab"
                    aria-selected={active}
                    type="button"
                    title={o.hint}
                    onClick={() => setCompare(o.key)}
                    className={cn(
                      "rounded px-2.5 py-1 font-medium transition",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
