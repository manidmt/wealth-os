import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type BankConnectionStatus = "pending" | "active" | "expired" | "error";

export type BankConnection = {
  id: string;
  user_id: string;
  institution_id: string | null;
  institution_name: string;
  requisition_id: string | null;
  account_ids: string[];
  status: BankConnectionStatus;
  last_synced_at: string | null;
  error_message: string | null;
  aspsp_country: string | null;
  auth_state: string | null;
  session_expires_at: string | null;
  created_at: string;
};

export type Aspsp = { name: string; country: string };

export function useAspsps() {
  const { user } = useAuth();
  return useQuery<Aspsp[]>({
    queryKey: ["aspsps"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bank-aspsps", { body: {} });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return (data.aspsps ?? []) as Aspsp[];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
}

export function useBankConnections() {
  const { user } = useAuth();
  return useQuery<BankConnection[]>({
    queryKey: ["bank_connections", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("bank_connections")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useConnectBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (aspsp: Aspsp): Promise<{ url: string }> => {
      const { data, error } = await supabase.functions.invoke("bank-connect", {
        body: { aspsp_name: aspsp.name, aspsp_country: aspsp.country },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank_connections"] }),
  });
}

export function useSyncBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId?: string) => {
      const { data, error } = await supabase.functions.invoke("bank-sync", {
        body: connectionId ? { connection_id: connectionId } : {},
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as { ok: boolean; synced: number; inserted: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_connections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useDisconnectBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("bank_connections")
        .delete()
        .eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank_connections"] }),
  });
}
