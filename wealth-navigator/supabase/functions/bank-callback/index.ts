import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { createSession, getAllTransactions } from "../_shared/enablebanking.ts";
import { mapTransaction, isBooked } from "../_shared/bank-mapping.ts";
import { findDuplicate, type DedupRow } from "../_shared/dedup.ts";
import { isCashWithdrawal, matchesExclusionRule } from "../_shared/non-expense.ts";
import { classifyBatch } from "../_shared/llm-classify.ts";
import { categoryFromRules } from "../_shared/category-rules.ts";

// EXPENSE_CATEGORIES / INCOME_CATEGORIES (copiadas de src/lib/movements-api.ts; mantener sincronizadas)
const EXPENSE_CATEGORIES = ["Café","Coche","Comer fuera","Comida","Cuidado personal","Deporte","Educación","Formación","Gestiones","Gimnasio","Higiene","Hogar","Impuestos","Ocio","Otro","Regalo","Ropa","Salud","Suplementos","Suscripciones","Tecnología","Transporte","Viaje"];
const INCOME_CATEGORIES = ["Nómina","Salario","Extra","Tarjeta Restaurante","Ticket restaurante","Comer fuera","Otros ingresos"];

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
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return corsResponse({ error: "Unauthorized" }, 401);

    const { code, state } = await req.json() as { code: string; state: string };
    const session = await createSession(code);
    const uids = session.accounts.map((a) => a.uid);
    const expires = new Date(Date.now() + 180 * 86400_000).toISOString();

    const { data: updated, error: updErr } = await supabase.from("bank_connections")
      .update({
        requisition_id: session.session_id,
        account_ids: uids,
        status: "active",
        error_message: null,
        session_expires_at: expires,
      })
      .eq("auth_state", state)
      .eq("user_id", user.id)
      .select("id");
    if (updErr) return corsResponse({ error: updErr.message }, 500);
    if (!updated || updated.length === 0) {
      return corsResponse({ error: "No pending connection matches this authorization (state mismatch or expired)." }, 400);
    }

    const dateFrom = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    let inserted = 0;
    for (const uid of uids) {
      const txs = (await getAllTransactions(uid, dateFrom)).filter(isBooked).filter((t) => t.transaction_id || t.entry_reference);
      if (!txs.length) continue;
      const rows = txs.map((t) => mapTransaction(t, user.id));
      const enriched = await enrichRows(supabase, rows, txs, user.id, dateFrom);
      const { error } = await supabase.from("movements").upsert(enriched, { onConflict: "external_id", ignoreDuplicates: true });
      if (error) {
        await supabase.from("bank_connections").update({ error_message: `sync: ${error.message}` }).eq("auth_state", state);
      } else {
        inserted += enriched.length;
      }
    }
    await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("auth_state", state);

    return corsResponse({ ok: true, accounts: uids.length, inserted });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
