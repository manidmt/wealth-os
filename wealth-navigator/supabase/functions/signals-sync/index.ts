import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

// Series internas en market_signals (no se muestran en UI):
// msci_ath, gold_ath, btc_ath (máximo histórico) y btc_close_w (cierre semanal BTC, fecha = lunes ISO).

const YH = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };

async function yahooLast(symbol: string): Promise<number> {
  const r = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(`yahoo ${symbol}: HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`yahoo ${symbol}: ${j?.chart?.error?.description ?? "respuesta vacía"}`);
  const closes = (result.indicators.quote[0].close as (number | null)[]).filter((c) => c != null);
  if (closes.length === 0) throw new Error(`yahoo ${symbol}: sin cierres`);
  return closes[closes.length - 1] as number;
}

async function fredLast(series: string, key: string): Promise<number> {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=10`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`fred ${series}: HTTP ${r.status}`);
  const j = await r.json();
  const obs = j.observations.find((o: { value: string }) => o.value !== ".");
  if (!obs) throw new Error(`fred ${series}: sin observaciones`);
  return parseFloat(obs.value);
}

function isoWeekMonday(d: Date): string {
  const day = d.getUTCDay() || 7;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - day + 1);
  return m.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const fredKey = Deno.env.get("FRED_API_KEY")!;
  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, number> = {};
  const errors: string[] = [];

  const upsert = async (signal_key: string, value: number, date = today) => {
    const { error } = await db
      .from("market_signals")
      .upsert({ signal_key, date, value, source: "auto" }, { onConflict: "signal_key,date" });
    if (error) throw new Error(`upsert ${signal_key}: ${error.message}`);
  };

  // 1. Directas
  for (const [key, fn] of [
    ["vix", () => yahooLast("^VIX")],
    ["dxy", () => yahooLast("DX-Y.NYB")],
    ["tips_10y_real", () => fredLast("DFII10", fredKey)],
    ["hy_spread", () => fredLast("BAMLH0A0HYM2", fredKey)],
  ] as [string, () => Promise<number>][]) {
    try {
      const v = await fn();
      await upsert(key, v);
      results[key] = v;
    } catch (e) {
      errors.push(`${key}: ${(e as Error).message}`);
    }
  }

  // 2. Drawdowns con ATH incremental
  for (const [symbol, ddKey, athKey] of [
    ["IWDA.AS", "msci_dd", "msci_ath"],
    ["GC=F", "gold_dd", "gold_ath"],
    ["BTC-USD", "btc_dd", "btc_ath"],
  ] as [string, string, string][]) {
    try {
      const price = await yahooLast(symbol);
      const { data: athRow, error: athErr } = await db
        .from("market_signals")
        .select("value")
        .eq("signal_key", athKey)
        .order("value", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (athErr) throw new Error(`read ${athKey}: ${athErr.message}`);
      const ath = Math.max(Number(athRow?.value ?? 0), price);
      await upsert(athKey, ath);
      await upsert(ddKey, price / ath - 1);
      results[ddKey] = price / ath - 1;

      if (symbol === "BTC-USD") {
        await upsert("btc_close_w", price, isoWeekMonday(new Date()));
        const { data: weeks, error: weeksErr } = await db
          .from("market_signals")
          .select("value")
          .eq("signal_key", "btc_close_w")
          .order("date", { ascending: false })
          .limit(200);
        if (weeksErr) throw new Error(`read btc_close_w: ${weeksErr.message}`);
        if (weeks && weeks.length >= 100) {
          const avg = weeks.reduce((s, w) => s + Number(w.value), 0) / weeks.length;
          await upsert("btc_p200w", price / avg);
          results.btc_p200w = price / avg;
        } else {
          errors.push(`btc_p200w: solo ${weeks?.length ?? 0} cierres semanales (seed pendiente)`);
        }
      }
    } catch (e) {
      errors.push(`${ddKey}: ${(e as Error).message}`);
    }
  }

  return corsResponse({ ok: errors.length === 0, results, errors });
});
