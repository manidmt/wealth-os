import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type InvestmentBriefing = {
  user_id: string;
  period: string;
  content: string;
  generated_at: string;
};

export function useBriefing(period: string) {
  const { user } = useAuth();
  return useQuery<InvestmentBriefing | null>({
    queryKey: ["investment_briefing", period],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("investment_briefings")
        .select("*")
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user,
  });
}

export function useSaveBriefing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { period: string; content: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("investment_briefings")
        .upsert(
          { user_id: user!.id, period: input.period, content: input.content, generated_at: new Date().toISOString() },
          { onConflict: "user_id,period" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["investment_briefing", vars.period] });
    },
  });
}
