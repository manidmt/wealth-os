import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type RecurringExpenseOverride = {
  concept: string;
  display_name: string | null;
  monthly_amount: number | null;
  active: boolean;
};

export function useRecurringOverrides() {
  const { user } = useAuth();
  return useQuery<RecurringExpenseOverride[]>({
    queryKey: ["recurring_expense_overrides"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("recurring_expense_overrides")
        .select("concept, display_name, monthly_amount, active");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        ...r,
        monthly_amount: r.monthly_amount == null ? null : Number(r.monthly_amount),
      }));
    },
    enabled: !!user,
  });
}

export function useUpsertRecurringOverride() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      concept: string;
      display_name?: string | null;
      monthly_amount?: number | null;
      active?: boolean;
    }) => {
      const row = {
        user_id: user!.id,
        concept: input.concept,
        display_name: input.display_name ?? null,
        monthly_amount: input.monthly_amount ?? null,
        active: input.active ?? true,
        updated_at: new Date().toISOString(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("recurring_expense_overrides")
        .upsert(row, { onConflict: "user_id,concept" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_expense_overrides"] });
    },
  });
}
