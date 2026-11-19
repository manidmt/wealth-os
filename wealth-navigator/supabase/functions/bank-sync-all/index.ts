import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { getAllTransactions } from "../_shared/enablebanking.ts";
import { syncBalances, ensureAccountIds } from "../_shared/bank-balance-sync.ts";
import { mapTransaction, isBooked, withFallbackIds } from "../_shared/bank-mapping.ts";
import { findDuplicate, type DedupRow } from "../_shared/dedup.ts";
import { isCashWithdrawal, matchesExclusionRule } from "../_shared/non-expense.ts";
import { classifyBatch } from "../_shared/llm-classify.ts";
import { categoryFromRules } from "../_shared/category-rules.ts";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "../_shared/categories.ts";

// dado: rows: MovementRow[] (de mapTransaction), txs: transacciones originales alineadas con rows, userId: string, supabase, dateFrom: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichRows(supabase: any, rows: any[], txs: any[], userId: string, dateFrom: string) {
  // reglas de exclusión del usuario
  const { data: rulesRaw } = await supabase
    .from("movement_exclusion_rules").select("match_text").eq("user_id", userId);
  const rules = (rulesRaw ?? []) as { match_text: string }[];
  const { data: catRulesRaw } = await supabase
    .from("movement_category_rules").select("match_text, category").eq("user_id", userId);
  const catRules = (catRulesRaw ?? []) as { match_text: string; category: string }[];
  // manuales para dedup
  const { data: manualsRaw } = await supabase
    .from("movements").select("id, amount, type, date")
    .is("external_id", null).eq("user_id", userId).gte("date", dateFrom);
  const manuals: DedupRow[] = (manualsRaw ?? []).map((m: any) => ({
    id: m.id, amount: Number(m.amount), type: m.type, date: m.date,
  }));
  const claimed = new Set<string>();
  rows.forEach((r, i) => {
    const available = manuals.filter((m) => !claimed.has(m.id));
    const dup = findDuplicate({ amount: r.amount, type: r.type, date: r.date }, available);
    if (dup) claimed.add(dup);
    r.duplicate_of = dup;
    const mcc = txs[i]?.merchant_category_code ?? null;
    r.excluded = dup !== null || isCashWithdrawal(mcc, r.description) || matchesExclusionRule(r.description, rules);
    const ruleCat = categoryFromRules(r.description, catRules);
    if (ruleCat) r.category = ruleCat;
  });
  // LLM solo para las NO excluidas sin categoría, por tipo
  for (const type of ["expense", "income"] as const) {
    const pending = rows.filter((r) => !r.excluded && r.type === type && r.category === "Sin categoría");
    if (pending.length === 0) continue;
    const cats = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const items = pending.map((r, i) => ({ id: String(i), description: r.description }));
    const result = await classifyBatch(items, cats);
    pending.forEach((r, i) => { r.category = result[String(i)] ?? "Sin categoría"; });
  }
  return rows;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Solo el cron: la clave publicable que pasa la verificación JWT es pública, y cada
  // llamada gasta el cupo diario de accesos PSD2 de todas las conexiones.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return corsResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: connections, error } = await supabase.from("bank_connections").select("*").eq("status", "active");
    if (error) return corsResponse({ error: error.message }, 500);

    // dry_run: solo descarga y registra en logs las transacciones (diagnóstico); no escribe nada.
    const body = await req.json().catch(() => ({}));
    const dryRun = (body as { dry_run?: boolean }).dry_run === true;
    const onlyId = (body as { connection_id?: string }).connection_id;

    let inserted = 0;
    let balances = 0;
    const errors: string[] = [];
    for (const conn of connections ?? []) {
      if (onlyId && conn.id !== onlyId) continue;
      try {
        const dateFrom = conn.last_synced_at
          ? (conn.last_synced_at as string).slice(0, 10)
          : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
        const accountIds = await ensureAccountIds(supabase, conn as never).catch((e) => {
          console.error("ensureAccountIds", conn.id, (e as Error).message);
          return (conn.account_ids ?? []) as string[];
        });
        const txUids = conn.sync_transactions === false ? [] : accountIds;
        for (const uid of txUids) {
          const fetched = await getAllTransactions(uid, dateFrom);
          const txs = withFallbackIds(fetched.filter(isBooked), uid);
          for (const t of fetched.slice(0, 4)) {
            // deno-lint-ignore no-explicit-any
            const o = t as any;
            console.log("tx sample", uid.slice(0, 8), "nonNull", Object.keys(o).filter((k) => o[k] != null && !(Array.isArray(o[k]) && !o[k].length)).join(","), "note", String(o.note ?? "").slice(0, 60), "btc", JSON.stringify(o.bank_transaction_code ?? null).slice(0, 120), "rem", JSON.stringify(o.remittance_information ?? null).slice(0, 80), "cred", JSON.stringify(o.creditor ?? null).slice(0, 60));
          }
          console.log("transactions", uid.slice(0, 8), "fetched", fetched.length, "booked", fetched.filter(isBooked).length, "usable", txs.length, "statuses", [...new Set(fetched.map((t) => t.status))].join(","), "keys", Object.keys(fetched[0] ?? {}).join(","));
          if (!txs.length || dryRun) continue;
          const rows = txs.map((t) => mapTransaction(t, conn.user_id as string));
          const enriched = await enrichRows(supabase, rows, txs, conn.user_id as string, dateFrom);
          const { error: upErr } = await supabase.from("movements").upsert(enriched, { onConflict: "external_id", ignoreDuplicates: true });
          if (upErr) {
            await supabase.from("bank_connections").update({ error_message: `sync: ${upErr.message}` }).eq("id", conn.id);
          } else {
            inserted += enriched.length;
          }
        }
        if (dryRun) continue;
        balances += (await syncBalances(supabase, conn as never)).updated;
        await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("id", conn.id);
      } catch (e) {
        // Un banco caído o con el límite diario agotado no debe frenar al resto.
        console.error("sync", conn.id, (e as Error).message);
        errors.push(`${conn.institution_name}: ${(e as Error).message}`.slice(0, 300));
        await supabase.from("bank_connections")
          .update({ error_message: `sync: ${(e as Error).message}`.slice(0, 500) })
          .eq("id", conn.id);
      }
    }
    return corsResponse({ ok: true, synced: (connections ?? []).length, inserted, balances, errors });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
