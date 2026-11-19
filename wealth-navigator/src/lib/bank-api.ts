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
  sync_transactions: boolean;
  created_at: string;
};

export type Aspsp = { name: string; country: string };

// supabase-js solo dice "non-2xx status code"; el motivo real va en el cuerpo.
export async function functionError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    const body = await ctx.json().catch(() => null);
    if (body?.error) return new Error(body.error);
  }
  return error as Error;
}

export function useAspsps() {
  const { user } = useAuth();
  return useQuery<Aspsp[]>({
    queryKey: ["aspsps"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bank-aspsps", { body: {} });
      if (error) throw await functionError(error);
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
    mutationFn: async (input: {
      aspsp: Aspsp;
      syncTransactions: boolean;
    }): Promise<{ url: string }> => {
      const { data, error } = await supabase.functions.invoke("bank-connect", {
        body: {
          aspsp_name: input.aspsp.name,
          aspsp_country: input.aspsp.country,
          sync_transactions: input.syncTransactions,
        },
      });
      if (error) throw await functionError(error);
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
      if (error) throw await functionError(error);
      if (data.error) throw new Error(data.error);
      return data as { ok: boolean; synced: number; inserted: number; balances: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_connections"] });
      queryClient.invalidateQueries({ queryKey: ["cash_accounts"] });
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

export function useSetSyncTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { connectionId: string; enabled: boolean }) => {
      // Al reactivar, last_synced_at=null fuerza traer de nuevo los últimos 90 días.
      const patch = input.enabled
        ? { sync_transactions: true, last_synced_at: null }
        : { sync_transactions: false };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("bank_connections")
        .update(patch)
        .eq("id", input.connectionId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank_connections"] }),
  });
}

/** Reautoriza el mismo banco; bank-callback sustituye la conexión antigua al volver. */
export function useReconnectBank() {
  const connectBank = useConnectBank();
  return {
    isPending: connectBank.isPending,
    error: connectBank.error as Error | null,
    reconnect: async (conn: BankConnection) => {
      const { url } = await connectBank.mutateAsync({
        aspsp: { name: conn.institution_name, country: conn.aspsp_country ?? "ES" },
        syncTransactions: conn.sync_transactions,
      });
      window.location.href = url;
    },
  };
}
