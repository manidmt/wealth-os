import { InvestmentPlanning } from "./InvestmentPlanning";
import { ExpensePlanning } from "./ExpensePlanning";

export type PlanningTab = "inversion" | "gastos";

export function PlanningTabs({
  tab,
  onTabChange,
}: {
  tab: PlanningTab;
  onTabChange: (t: PlanningTab) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-8">
      <div className="flex gap-1 border-b border-border">
        {(["inversion", "gastos"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium transition ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "inversion" ? "Inversión" : "Gastos"}
          </button>
        ))}
      </div>
      <div className="pt-2">
        {tab === "inversion" ? <InvestmentPlanning /> : <ExpensePlanning />}
      </div>
    </div>
  );
}
