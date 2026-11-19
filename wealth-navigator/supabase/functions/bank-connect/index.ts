import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { listAspsps, startAuth } from "../_shared/enablebanking.ts";

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

    const { aspsp_name, aspsp_country, sync_transactions } = await req.json() as {
      aspsp_name: string; aspsp_country: string; sync_transactions?: boolean;
    };
    const state = crypto.randomUUID();
    const redirectUrl = `${Deno.env.get("APP_URL") ?? "https://wealthos.manidmt.es"}/bank-callback`;
    // Cada banco limita la duración del consentimiento; pedir más hace fallar /auth.
    const aspsp = (await listAspsps(aspsp_country)).find((a) => a.name === aspsp_name);
    const maxSeconds = Math.min(180 * 86400, aspsp?.maximum_consent_validity ?? 180 * 86400);
    const validUntil = new Date(Date.now() + (maxSeconds - 60) * 1000).toISOString();

    const { url } = await startAuth({ aspspName: aspsp_name, aspspCountry: aspsp_country, state, redirectUrl, validUntil });

    await supabase.from("bank_connections").insert({
      user_id: user.id,
      institution_name: aspsp_name,
      aspsp_country,
      auth_state: state,
      status: "pending",
      account_ids: [],
      sync_transactions: sync_transactions !== false,
    });

    return corsResponse({ url });
  } catch (e) {
    console.error("bank-connect", (e as Error).message);
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
