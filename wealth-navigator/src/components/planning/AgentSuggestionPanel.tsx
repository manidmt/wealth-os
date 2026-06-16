import { useRef, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { useAuth } from "@/hooks/use-auth";
import { openAgentStream } from "@/lib/agent-ws";
import { buildBudgetSuggestionPrompt } from "@/lib/budget-suggestion";
import { suggestBudgetCuts, parseAgentBudgetJson } from "@/lib/budget-suggest";
import { savingsGap, type BudgetMap, type IncomeItem } from "@/lib/budget-calc";
import { BUDGET_GROUPS } from "@/lib/budget-groups";

const GROUP_KEYS = BUDGET_GROUPS.map((g) => g.key);

export function AgentSuggestionPanel({
  month,
  incomes,
  savingsGoal,
  budgets,
  actuals,
  onApply,
}: {
  month: string;
  incomes: IncomeItem[];
  savingsGoal: number;
  budgets: BudgetMap;
  actuals: BudgetMap;
  onApply: (next: BudgetMap) => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
  const [error, setError] = useState("");
  const [agentProposal, setAgentProposal] = useState<BudgetMap | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const deficit = Math.max(0, -savingsGap(incomes, budgets, savingsGoal));
  const localProposal = suggestBudgetCuts(budgets, actuals, deficit);
  const proposal = agentProposal ? { ...budgets, ...agentProposal } : localProposal;
  const hasProposal =
    agentProposal !== null || JSON.stringify(localProposal) !== JSON.stringify(budgets);

  const visibleText = text.replace(/```json[\s\S]*?```/i, "").trim();

  function ask() {
    if (!user?.id) return;
    setText("");
    setError("");
    setAgentProposal(null);
    setStatus("streaming");
    const prompt = buildBudgetSuggestionPrompt({ month, incomes, savingsGoal, budgets, actuals });
    let acc = "";
    closeRef.current = openAgentStream(user.id, prompt, [], {
      onToken: (t) => {
        acc += t;
        setText(acc);
      },
      onDone: () => {
        const parsed = parseAgentBudgetJson(acc, GROUP_KEYS);
        if (parsed) setAgentProposal(parsed);
        setStatus("idle");
      },
      onError: (e) => {
        setError(e);
        setStatus("error");
      },
    });
  }

  return (
    <SectionCard
      title="Sugerencias del agente"
      description="Pide al Wealth Agent cómo cuadrar gastos y ahorro, y aplica su propuesta."
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={ask}
          disabled={status === "streaming"}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {status === "streaming" ? "Pensando…" : "Pedir sugerencias al agente"}
        </button>
        {hasProposal && (
          <button
            type="button"
            onClick={() => onApply(proposal)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Check className="h-3.5 w-3.5" />
            {agentProposal ? "Aplicar propuesta del agente" : "Aplicar recorte sugerido"}
          </button>
        )}
      </div>

      {status === "error" && <p className="mt-3 text-[12.5px] text-muted-foreground">{error}</p>}
      {visibleText && (
        <div className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2.5 text-[12.5px] leading-relaxed">
          {visibleText}
        </div>
      )}
    </SectionCard>
  );
}
