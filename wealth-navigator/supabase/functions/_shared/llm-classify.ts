const FALLBACK = "Sin categoría";

export function buildClassifyPrompt(items: { id: string; description: string }[], categories: string[]): string {
  return [
    "Clasifica cada movimiento bancario en EXACTAMENTE una de estas categorías:",
    categories.join(", "),
    "",
    "Responde SOLO un objeto JSON { id: categoria }. Usa exactamente los nombres de categoría dados.",
    "Si dudas, elige la más probable. No inventes categorías nuevas.",
    "",
    "Movimientos:",
    JSON.stringify(items),
  ].join("\n");
}

export function parseClassifyResponse(raw: string, validCategories: string[], ids: string[]): Record<string, string> {
  const valid = new Set(validCategories);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const out: Record<string, string> = {};
  for (const id of ids) {
    const cat = parsed[id];
    out[id] = typeof cat === "string" && valid.has(cat) ? cat : FALLBACK;
  }
  return out;
}

/** Clasifica por lotes con OpenAI gpt-4o-mini. Si falla, todo "Sin categoría". */
export async function classifyBatch(
  items: { id: string; description: string }[],
  categories: string[],
): Promise<Record<string, string>> {
  const ids = items.map((i) => i.id);
  if (items.length === 0) return {};
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return Object.fromEntries(ids.map((id) => [id, FALLBACK]));
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Eres un clasificador de gastos. Devuelves solo JSON." },
          { role: "user", content: buildClassifyPrompt(items, categories) },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`openai HTTP ${resp.status}`);
    const j = await resp.json();
    const content = j.choices?.[0]?.message?.content ?? "{}";
    return parseClassifyResponse(content, categories, ids);
  } catch {
    return Object.fromEntries(ids.map((id) => [id, FALLBACK]));
  }
}
