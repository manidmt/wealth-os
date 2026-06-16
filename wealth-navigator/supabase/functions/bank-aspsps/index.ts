import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import { listAspsps } from "../_shared/enablebanking.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const aspsps = await listAspsps("ES");
    return corsResponse({ aspsps });
  } catch (e) {
    return corsResponse({ error: (e as Error).message }, 500);
  }
});
