import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/dashboard-data";
import { useMoney } from "@/components/app/CurrencyProvider";

type Props = {
  value: number;
  /** Render as a percentage instead of an absolute number. value is the ratio. */
  asPercent?: boolean;
  /** Invert sign meaning (useful for "expenses": more is worse). */
  invert?: boolean;
  className?: string;
  prefix?: string;
};

export function DeltaBadge({ value, asPercent, invert, className, prefix }: Props) {
  const money = useMoney();
  const sign = value === 0 ? 0 : value > 0 ? 1 : -1;
  const tone =
    sign === 0
      ? "neutral"
      : invert
        ? sign > 0
          ? "negative"
          : "positive"
        : sign > 0
          ? "positive"
          : "negative";

  const Icon = sign === 0 ? Minus : sign > 0 ? ArrowUpRight : ArrowDownRight;

  const display = asPercent
    ? formatPercent(value)
    : new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: money.code,
        maximumFractionDigits: 0,
        signDisplay: "exceptZero",
      }).format(money.convert(value));

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium tabular-nums",
        tone === "positive" &&
          "bg-positive/10 text-positive ring-1 ring-positive/20",
        tone === "negative" &&
          "bg-negative/10 text-negative ring-1 ring-negative/20",
        tone === "neutral" &&
          "bg-muted text-muted-foreground ring-1 ring-border",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {prefix}
      {display}
    </span>
  );
}
