import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PriceSyncResult = {
  updated: { name: string; price: number }[];
  skipped: { name: string; reason: string }[];
};

export function useSyncPrices() {
  const qc = useQueryClient();
  return useMutation<PriceSyncResult, Error>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("prices-sync", { body: {} });
      if (error) throw error;
      return data as PriceSyncResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
