import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import {
  currentMultiplier, effectiveQuota, evaluateTrigger, isStale,
  type SignalMap, type SignalKey,
} from "../_shared/strategy-engine.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const email = new URL(req.url).searchParams.get("user_email");
  if (!email) return corsResponse({ error: "user_email requerido" }, 400);

  const { data: users } = await db.auth.admin.listUsers();
  const user = users?.users.find((u) => u.email === email);
  if (!user) return corsResponse({ error: "usuario no encontrado" }, 404);

  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const { data: sigRows } = await db
    .from("market_signals")
    .select("signal_key, date, value, source")
    .gte("date", since)
    .order("date", { ascending: false });
  const signals: SignalMap = {};
  for (const r of sigRows ?? []) {
    const k = r.signal_key as SignalKey;
    if (!signals[k]) signals[k] = { value: Number(r.value), date: r.date, source: r.source };
  }

  const { data: plans } = await db
    .from("investment_plans")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true)
    .not("asset_class", "is", null);

  const staleSignals = Object.entries(signals)
    .filter(([, s]) => isStale(s!))
    .map(([k, s]) => ({ signal: k, date: s!.date }));

  const strategies = (plans ?? []).map((p) => {
    const plan = {
      amount: p.amount == null ? null : Number(p.amount),
      multiplier_rules: p.multiplier_rules,
      annual_multiplier: Number(p.annual_multiplier ?? 1),
      annual_multiplier_year: p.annual_multiplier_year == null ? null : Number(p.annual_multiplier_year),
    };
    const tr = evaluateTrigger(p.multiplier_rules?.trigger, signals, p.dry_powder?.last_fired_at ?? null);
    return {
      name: p.name,
      base_eur: plan.amount,
      multiplier: currentMultiplier(plan, signals),
      effective_eur: effectiveQuota(plan, signals),
      dry_powder_eur: p.dry_powder?.current_eur ?? null,
      trigger: { fired: tr.fired, blocked: tr.blocked, detail: tr.detail },
    };
  });

  return corsResponse({
    month: new Date().toISOString().slice(0, 7),
    strategies,
    stale_signals: staleSignals,
    fired: strategies.filter((s) => s.trigger.fired).map((s) => s.name),
  });
});
