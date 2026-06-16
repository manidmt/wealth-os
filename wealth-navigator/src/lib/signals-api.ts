import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { SignalKey, SignalMap, SignalValue } from "./strategy-engine";

/** Claves visibles en el panel (excluye series internas *_ath, btc_close_w, *_price). */
export const PANEL_SIGNALS: { key: SignalKey; label: string; manual: boolean; hint: string }[] = [
  { key: "vix", label: "VIX", manual: false, hint: "Yahoo ^VIX" },
  { key: "dxy", label: "DXY (índice dólar)", manual: false, hint: "Yahoo DX-Y.NYB" },
  { key: "tips_10y_real", label: "TIPS 10Y real (%)", manual: false, hint: "FRED DFII10" },
  { key: "hy_spread", label: "Spread HY (pp)", manual: false, hint: "FRED BAMLH0A0HYM2" },
  { key: "msci_dd", label: "DD MSCI World", manual: false, hint: "vs ATH" },
  { key: "gold_dd", label: "DD Oro", manual: false, hint: "vs ATH" },
  { key: "btc_dd", label: "DD BTC", manual: false, hint: "vs ATH" },
  { key: "btc_p200w", label: "BTC / 200WMA", manual: false, hint: "calculado" },
  { key: "btc_mvrv", label: "MVRV Z-Score", manual: true, hint: "lookintobitcoin" },
  { key: "btc_puell", label: "Puell Multiple", manual: true, hint: "lookintobitcoin" },
  { key: "insiders_ratio", label: "Insiders ratio", manual: true, hint: "openinsider" },
];

/** Última observación por señal (busca hasta 400 días atrás para cubrir manuales viejas). */
export function useLatestSignals() {
  const { user } = useAuth();
  return useQuery<SignalMap>({
    queryKey: ["market_signals"],
    queryFn: async () => {
      const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("market_signals")
        .select("signal_key, date, value, source")
        .gte("date", since)
        .order("date", { ascending: false });
      if (error) throw error;
      const map: SignalMap = {};
      for (const row of data ?? []) {
        const k = row.signal_key as SignalKey;
        if (!map[k])
          map[k] = { value: Number(row.value), date: row.date, source: row.source } as SignalValue;
      }
      return map;
    },
    enabled: !!user,
  });
}

export function useUpsertManualSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { signal_key: SignalKey; value: number }) => {
      const today = new Date().toISOString().slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("market_signals")
        .upsert(
          { signal_key: input.signal_key, date: today, value: input.value, source: "manual" },
          { onConflict: "signal_key,date" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["market_signals"] }),
  });
}
