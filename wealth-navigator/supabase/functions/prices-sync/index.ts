import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const YH = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };
// Tipos que se intentan preciar (los demás —cash, etc.— se ignoran). 'fund' y
// 'other' se incluyen porque se identifican por ISIN.
const QUOTED = ["stock", "etf", "crypto", "fund", "other"];

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

/** Resuelve un ISIN al mejor símbolo de Yahoo vía el endpoint de búsqueda. */
async function resolveIsin(isin: string): Promise<string> {
  const r = await fetch(`${SEARCH}?q=${encodeURIComponent(isin)}&quotesCount=5`, { headers: UA });
  if (!r.ok) throw new Error(`search HTTP ${r.status}`);
  const j = await r.json();
  const sym = (j?.quotes ?? []).map((q: { symbol?: string }) => q.symbol).find((s: string | undefined) => !!s);
  if (!sym) throw new Error("ISIN no encontrado en Yahoo");
  return sym as string;
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
    .select("id, asset_name, ticker, isin, currency, asset_type, updated_at")
    .in("asset_type", QUOTED);
  if (error) return corsResponse({ error: error.message }, 400);

  // Solo los que no se actualizaron hoy. Resolución de símbolo: ticker si lo hay,
  // si no el ISIN (resuelto vía búsqueda de Yahoo). Sin ninguno → omitido.
  const stale = (positions ?? []).filter(
    (p: { updated_at: string }) =>
      new Date(p.updated_at).toISOString().slice(0, 10) < today,
  );

  for (const p of stale) {
    const ticker = (p.ticker ?? "").trim();
    const isin = (p.isin ?? "").trim();
    if (!ticker && !isin) {
      skipped.push({ name: p.asset_name, reason: "sin ticker ni ISIN" });
      continue;
    }
    try {
      const symbol = ticker || (await resolveIsin(isin));
      const { price, currency } = await yahooQuote(symbol);
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
