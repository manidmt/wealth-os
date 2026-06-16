import { useMemo } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Checkbox } from "@/components/ui/checkbox";
import type { InvestmentPlan, RoutineItem } from "@/lib/planning-api";
import { useRoutineLog, useUpsertRoutineLog } from "@/lib/planning-api";
import { toEnginePlan } from "@/lib/planning-calc";
import { effectiveQuota, evaluateTrigger, type SignalMap } from "@/lib/strategy-engine";

function buildItems(
  strategies: InvestmentPlan[],
  signals: SignalMap,
): Omit<RoutineItem, "done" | "done_at">[] {
  const items: Omit<RoutineItem, "done" | "done_at">[] = [];
  for (const p of strategies) {
    const enginePlan = toEnginePlan(p);
    items.push({
      key: `buy-${p.id}`,
      label: `Aportar ${effectiveQuota(enginePlan, signals).toFixed(0)} € a ${p.name}`,
    });
    if (p.dry_powder && p.dry_powder.monthly_feed_eur > 0) {
      items.push({
        key: `feed-${p.id}`,
        label: `Transferir ${Number(p.dry_powder.monthly_feed_eur).toFixed(0)} € a pólvora de ${p.name}`,
      });
    }
  }
  items.push({ key: "signals", label: "Revisar señales (panel de abajo: manuales al día)" });
  for (const p of strategies) {
    const tr = evaluateTrigger(
      p.multiplier_rules?.trigger,
      signals,
      p.dry_powder?.last_fired_at ?? null,
    );
    if (tr.fired && (p.dry_powder?.current_eur ?? 0) > 0) {
      items.push({
        key: `fire-${p.id}`,
        label: `Soltar pólvora de ${p.name} (${Number(p.dry_powder!.current_eur).toFixed(0)} €) — ${tr.detail}`,
      });
    }
  }
  return items;
}

export function MonthlyRoutine({
  strategies,
  signals,
}: {
  strategies: InvestmentPlan[];
  signals: SignalMap;
}) {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const periodLabel = new Date(`${period}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const { data: log } = useRoutineLog(period);
  const upsert = useUpsertRoutineLog();

  const items = useMemo(() => {
    const built = buildItems(
      strategies.filter((s) => s.active),
      signals,
    );
    const saved = new Map((log?.items ?? []).map((i) => [i.key, i]));
    const builtKeys = new Set(built.map((b) => b.key));
    const merged = built.map((b) => ({
      ...b,
      done: saved.get(b.key)?.done ?? false,
      done_at: saved.get(b.key)?.done_at ?? null,
    }));
    // Pasos guardados que ya no se generan (ej. disparo que dejó de cumplirse): se conservan
    const leftovers = (log?.items ?? []).filter((i) => !builtKeys.has(i.key));
    return [...merged, ...leftovers];
  }, [strategies, signals, log]);

  const doneCount = items.filter((i) => i.done).length;

  const toggle = (key: string) => {
    const next = items.map((i) =>
      i.key === key
        ? { ...i, done: !i.done, done_at: !i.done ? new Date().toISOString() : null }
        : i,
    );
    const allDone = next.every((i) => i.done);
    upsert.mutate({ period, items: next, completed_at: allDone ? new Date().toISOString() : null });
  };

  return (
    <SectionCard
      title={`Rutina de ${periodLabel}`}
      description={`${doneCount}/${items.length} pasos`}
    >
      <div className="space-y-2">
        {items.map((i) => (
          <label key={i.key} className="flex cursor-pointer items-center gap-3 text-[13px]">
            <Checkbox checked={i.done} onCheckedChange={() => toggle(i.key)} />
            <span className={i.done ? "text-muted-foreground line-through" : ""}>{i.label}</span>
          </label>
        ))}
      </div>
      {doneCount === items.length && items.length > 0 && (
        <p className="mt-3 text-[12px] text-emerald-600">Rutina del mes completada</p>
      )}
    </SectionCard>
  );
}
