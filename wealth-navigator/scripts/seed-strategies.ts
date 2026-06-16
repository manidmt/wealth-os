/**
 * Seed de estrategias del Excel ESTATEGIA_PERSONAL.xlsx + histórico para ATH y 200WMA.
 * Uso: SUPABASE_URL=... SERVICE_ROLE_KEY=... USER_EMAIL=manidmt5@gmail.com npx tsx scripts/seed-strategies.ts
 */
import { createClient } from "@supabase/supabase-js";
import type { MultiplierRules } from "../supabase/functions/_shared/strategy-engine";

const db = createClient(process.env.SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!);
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };

async function yahooHistory(symbol: string, interval: "1wk" | "1mo") {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=${interval}`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(`yahoo ${symbol}: HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(`yahoo ${symbol}: ${j?.chart?.error?.description ?? "respuesta vacía"}`);
  const ts: number[] = res.timestamp;
  const closes: (number | null)[] = res.indicators.quote[0].close;
  return ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((x): x is { date: string; close: number } => x.close != null);
}

async function upsertSignals(rows: { signal_key: string; date: string; value: number }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from("market_signals")
      .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, source: "auto" })), { onConflict: "signal_key,date" });
    if (error) throw error;
  }
}

async function main() {
  // 1. Resolver usuario
  const { data: users, error: uErr } = await db.auth.admin.listUsers();
  if (uErr) throw uErr;
  const user = users.users.find((u) => u.email === process.env.USER_EMAIL);
  if (!user) throw new Error(`Usuario ${process.env.USER_EMAIL} no encontrado`);

  // 2. Histórico semanal BTC → btc_close_w + btc_ath
  const btc = await yahooHistory("BTC-USD", "1wk");
  await upsertSignals(btc.map((x) => ({ signal_key: "btc_close_w", date: x.date, value: x.close })));
  const btcAth = Math.max(...btc.map((x) => x.close));
  await upsertSignals([{ signal_key: "btc_ath", date: btc[btc.length - 1].date, value: btcAth }]);
  console.log(`btc: ${btc.length} semanas, ATH=${btcAth}`);

  // 3. ATH MSCI World (IWDA) y Oro (GC=F) desde histórico mensual
  for (const [symbol, athKey] of [["IWDA.AS", "msci_ath"], ["GC=F", "gold_ath"]] as const) {
    const hist = await yahooHistory(symbol, "1mo");
    const ath = Math.max(...hist.map((x) => x.close));
    await upsertSignals([{ signal_key: athKey, date: hist[hist.length - 1].date, value: ath }]);
    console.log(`${athKey}=${ath}`);
  }

  // 4. Estrategias del Excel (fuente de verdad: hoja CONTEXTO)
  const strategies: {
    name: string;
    asset_name: string;
    asset_class: string;
    amount: number;
    active?: boolean;
    multiplier_rules: MultiplierRules | null;
    dry_powder: { current_eur: number; monthly_feed_eur: number; last_fired_at: string | null } | null;
    return_pessimistic: number;
    return_base: number;
    return_optimistic: number;
  }[] = [
    {
      name: "RV Core (MSCI World)",
      asset_name: "MSCI World (IWDA)",
      asset_class: "rv_core",
      amount: 200,
      multiplier_rules: {
        base: {
          type: "ladder", cadence: "annual", signal: "msci_dd",
          steps: [{ lte: -0.1, multi: 2 }, { lte: -0.2, multi: 3 }], default: 1,
        },
      },
      dry_powder: null,
      return_pessimistic: 5, return_base: 10.9, return_optimistic: 14,
    },
    {
      name: "RV Oportunista (S&P 500)",
      asset_name: "S&P 500",
      asset_class: "rv_opp",
      amount: 100,
      multiplier_rules: {
        trigger: {
          type: "combo",
          conditions: [
            { signal: "vix", op: "gt", value: 50 },
            { signal: "insiders_ratio", op: "gte", value: 0.5 },
          ],
          multi: 4, cooldown_months: 3,
        },
      },
      dry_powder: { current_eur: 3000, monthly_feed_eur: 33, last_fired_at: null },
      return_pessimistic: 7, return_base: 16.2, return_optimistic: 20,
    },
    {
      name: "Oro (IGLN)",
      asset_name: "iShares Physical Gold",
      asset_class: "gold",
      amount: 100,
      multiplier_rules: {
        base: {
          type: "matrix", cadence: "annual",
          row_signal: "tips_10y_real", col_signal: "dxy",
          row_breaks: [1, 0.5, 0], col_breaks: [100, 110, 120],
          values: [[1, 1, 2, 2], [2, 2, 3, 3], [3, 3, 4, 5], [4, 4, 5, 6]],
          bonus: { signal: "gold_dd", lte: -0.15, add: 1 }, max: 6,
        },
        trigger: {
          type: "combo",
          conditions: [
            { signal: "tips_10y_real", op: "lt", value: 0.5 },
            { signal: "dxy", op: "gt", value: 110 },
            { signal: "gold_dd", op: "lte", value: -0.05 },
          ],
          multi: 6, cooldown_months: 6,
        },
      },
      dry_powder: { current_eur: 1000, monthly_feed_eur: 50, last_fired_at: null },
      return_pessimistic: 6, return_base: 13.7, return_optimistic: 17,
    },
    {
      name: "Bitcoin (Criptan)",
      asset_name: "BTC",
      asset_class: "btc",
      amount: 50,
      multiplier_rules: {
        base: {
          type: "ladder", cadence: "annual", signal: "btc_dd",
          steps: [{ lte: -0.3, multi: 2 }, { lte: -0.5, multi: 3 }, { lte: -0.7, multi: 4 }], default: 1,
        },
        trigger: {
          type: "combo",
          conditions: [
            { signal: "btc_dd", op: "lt", value: -0.5 },
            { signal: "btc_mvrv", op: "lt", value: 0 },
            { signal: "btc_p200w", op: "lt", value: 1.2 },
            { signal: "btc_puell", op: "lt", value: 0.5 },
          ],
          multi: 4, cooldown_months: 6,
        },
      },
      dry_powder: { current_eur: 1000, monthly_feed_eur: 0, last_fired_at: null },
      return_pessimistic: 8, return_base: 15, return_optimistic: 25,
    },
    {
      name: "Renta Fija (HY)",
      asset_name: "iShares HY USA EUR Hedged",
      asset_class: "rf",
      amount: 0,
      active: false, // inactiva hasta sep-2027; su escalera ascendente de spreads llega en fase 2
      multiplier_rules: {
        base: {
          type: "ladder", cadence: "monthly", signal: "hy_spread",
          steps: [{ lte: 999, multi: 1 }], default: 1, // neutro a propósito (multi 1 siempre)
        },
      },
      dry_powder: null,
      return_pessimistic: 2, return_base: 6.4, return_optimistic: 8,
    },
  ];

  for (const s of strategies) {
    const { data: existing } = await db
      .from("investment_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", s.name)
      .maybeSingle();
    const row = {
      user_id: user.id,
      name: s.name,
      asset_name: s.asset_name,
      rule_type: "fixed",
      amount: s.amount,
      percentage: null,
      frequency: "monthly",
      return_pessimistic: s.return_pessimistic,
      return_base: s.return_base,
      return_optimistic: s.return_optimistic,
      start_date: "2026-06-01",
      active: s.active ?? true,
      notes: "Migrada del Excel ESTATEGIA_PERSONAL",
      asset_class: s.asset_class,
      multiplier_rules: s.multiplier_rules,
      dry_powder: s.dry_powder,
      annual_multiplier: 1,
      annual_multiplier_year: 2026,
    };
    const { error } = existing
      ? await db.from("investment_plans").update(row).eq("id", existing.id)
      : await db.from("investment_plans").insert(row);
    if (error) throw error;
    console.log(`${existing ? "updated" : "created"}: ${s.name}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
