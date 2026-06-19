import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const YH = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };
const QUOTED = ["stock", "etf", "crypto"];

async function yahooQuote(symbol: string): Promise<{ price: number; currency: string }> {
  const r = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description ?? "respuesta vacía");
  const closes = (result.indicators.quote[0].close as (number | null)[]).filter((c) => c != null);
  if (closes.length === 0) throw new Error("sin cierres");
  return { price: closes[closes.length - 1] as number, currency: result.meta?.currency ?? "EUR" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const today = new Date().toISOString().slice(0, 10);
  const updated: { name: string; price: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const fxCache = new Map<string, number>();

  async function fxToEur(cur: string): Promise<number> {
    if (cur === "EUR") return 1;
    if (fxCache.has(cur)) return fxCache.get(cur)!;
    const { price } = await yahooQuote(`${cur}EUR=X`);
    fxCache.set(cur, price);
    return price;
  }

  const { data: positions, error } = await db
    .from("portfolio_positions")
    .select("id, asset_name, ticker, currency, asset_type, updated_at")
    .in("asset_type", QUOTED);
  if (error) return corsResponse({ error: error.message }, 400);

  const eligible = (positions ?? []).filter(
    (p: { ticker: string | null; updated_at: string }) =>
      p.ticker && p.ticker.trim() !== "" &&
      new Date(p.updated_at).toISOString().slice(0, 10) < today,
  );

  for (const p of eligible) {
    try {
      const { price, currency } = await yahooQuote(p.ticker as string);
      const rate = await fxToEur((currency ?? "EUR").toUpperCase());
      const eurPrice = price * rate;
      const { error: uErr } = await db
        .from("portfolio_positions")
        .update({ current_price: eurPrice })
        .eq("id", p.id);
      if (uErr) throw new Error(uErr.message);
      updated.push({ name: p.asset_name, price: eurPrice });
    } catch (e) {
      skipped.push({ name: p.asset_name, reason: e instanceof Error ? e.message : "error" });
    }
  }

  return corsResponse({ updated, skipped });
});
