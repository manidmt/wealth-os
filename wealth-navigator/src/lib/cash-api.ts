import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { CashAccount } from "./cash";

export function useCashAccounts() {
  const { user } = useAuth();
  return useQuery<CashAccount[]>({
    queryKey: ["cash_accounts"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("cash_accounts")
        .select("id, name, balance, updated_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // PostgREST devuelve numeric como string → number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((a: any) => ({ ...a, balance: Number(a.balance) }));
    },
    enabled: !!user,
  });
}

export function useUpsertCashAccount() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; balance: number }) => {
      const row = {
        user_id: user!.id,
        name: input.name,
        balance: input.balance,
        updated_at: new Date().toISOString(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error } = input.id
        ? await db.from("cash_accounts").update(row).eq("id", input.id)
        : await db.from("cash_accounts").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash_accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useDeleteCashAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("cash_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash_accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
