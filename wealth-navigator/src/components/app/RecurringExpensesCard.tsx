import { TrendingUp } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { useRecentMovements } from "@/lib/movements-api";
import { detectRecurring } from "@/lib/recurring";
import { euro } from "@/lib/dashboard-data";

export function RecurringExpensesCard() {
  const { data: movs = [] } = useRecentMovements(6);
  const recurring = detectRecurring(movs);
  const total = recurring.reduce((s, r) => s + r.monthlyAmount, 0);

  return (
    <SectionCard
      title="Gastos fijos"
      description={
        recurring.length
          ? `Suscripciones y recibos recurrentes · ${euro.format(total)}/mes estimado.`
          : "Aún no se detectan gastos fijos recurrentes."
      }
    >
      {recurring.length > 0 && (
        <div className="space-y-2">
          {recurring.map((r) => (
            <div key={r.concept} className="flex items-center justify-between text-[12.5px]">
              <div className="min-w-0">
                <span className="font-medium">{r.displayConcept}</span>
                <span className="text-muted-foreground"> · {r.category}</span>
              </div>
              <div className="flex items-center gap-2">
                {r.priceIncreased && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <TrendingUp className="h-3 w-3" />
                    subió {euro.format(r.lastAmount - r.monthlyAmount)}
                  </span>
                )}
                <span className="font-medium">{euro.format(r.monthlyAmount)}/mes</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
