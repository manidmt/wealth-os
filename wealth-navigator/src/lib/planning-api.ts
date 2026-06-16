import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { MultiplierRules } from "./strategy-engine";

export type RuleType = "fixed" | "pct_income" | "pct_savings" | "event";
export type Frequency = "monthly" | "quarterly";

export type AssetClass = "rv_core" | "rv_opp" | "gold" | "btc" | "rf";
export type DryPowder = {
  current_eur: number;
  monthly_feed_eur: number;
  last_fired_at: string | null;
};

export type InvestmentPlan = {
  id: string;
  user_id: string;
  name: string;
  asset_name: string;
  rule_type: RuleType;
  amount: number | null;
  percentage: number | null;
  frequency: Frequency;
  return_pessimistic: number;
  return_base: number;
  return_optimistic: number;
  start_date: string;
  active: boolean;
  notes: string | null;
  asset_class: AssetClass | null;
  multiplier_rules: MultiplierRules | null;
  dry_powder: DryPowder | null;
  annual_multiplier: number;
  annual_multiplier_year: number | null;
  portfolio_position_id: string | null;
  created_at: string;
};

export type PlanContribution = {
  id: string;
  user_id: string;
  plan_id: string;
  date: string;
  planned_amount: number;
  actual_amount: number | null;
  price: number | null;
  units: number | null;
  multiplier: number | null;
  signal_note: string | null;
  created_at: string;
};

export type CreatePlanInput = Omit<InvestmentPlan, "id" | "user_id" | "created_at">;
export type UpdatePlanInput = Partial<CreatePlanInput> & { id: string };

// ── Plans ──────────────────────────────────────────────────────────────────

export function useInvestmentPlans() {
  const { user } = useAuth();
  return useQuery<InvestmentPlan[]>({
    queryKey: ["investment_plans", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("investment_plans")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreatePlan() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePlanInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("investment_plans")
        .insert({ ...input, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_plans"] }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...rest }: UpdatePlanInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("investment_plans").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_plans"] }),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("investment_plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_plans"] }),
  });
}

// ── Contributions ──────────────────────────────────────────────────────────

export function usePlanContributions(planId: string | null) {
  const { user } = useAuth();
  return useQuery<PlanContribution[]>({
    queryKey: ["plan_contributions", planId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("plan_contributions")
        .select("*")
        .eq("plan_id", planId)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!planId,
  });
}

export function useUpsertContribution() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      plan_id: string;
      date: string;
      planned_amount: number;
      actual_amount: number;
      price?: number | null;
      units?: number | null;
      multiplier?: number | null;
      signal_note?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("plan_contributions")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "plan_id,date" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["plan_contributions", vars.plan_id] });
    },
  });
}

// ── Routine logs ───────────────────────────────────────────────────────────

export type RoutineItem = { key: string; label: string; done: boolean; done_at: string | null };

export type RoutineLog = {
  id: string;
  user_id: string;
  period: string; // '2026-06' | '2026-annual'
  items: RoutineItem[];
  completed_at: string | null;
};

export function useRoutineLog(period: string) {
  const { user } = useAuth();
  return useQuery<RoutineLog | null>({
    queryKey: ["routine_logs", period, user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("routine_logs")
        .select("*")
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useUpsertRoutineLog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      period: string;
      items: RoutineItem[];
      completed_at?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("routine_logs")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "user_id,period" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["routine_logs", vars.period] }),
  });
}

// ── Dry powder ─────────────────────────────────────────────────────────────

/** Suelta la pólvora: registra aportación extraordinaria y resetea el pool. */
export function useFireDryPowder() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { plan: InvestmentPlan; multi: number; signalNote: string }) => {
      const { plan, multi, signalNote } = input;
      const powder = plan.dry_powder!;
      const today = new Date().toISOString().slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cErr } = await (supabase as any).from("plan_contributions").insert({
        user_id: user!.id,
        plan_id: plan.id,
        date: today,
        planned_amount: 0,
        actual_amount: powder.current_eur,
        multiplier: multi,
        signal_note: signalNote,
      });
      if (cErr) throw cErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: pErr } = await (supabase as any)
        .from("investment_plans")
        .update({ dry_powder: { ...powder, current_eur: 0, last_fired_at: today } })
        .eq("id", plan.id);
      if (pErr) throw pErr;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["investment_plans"] });
      qc.invalidateQueries({ queryKey: ["plan_contributions", vars.plan.id] });
    },
  });
}
