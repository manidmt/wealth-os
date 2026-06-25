import json
from datetime import datetime, timezone

WINDOW_SIZE = 12
COMPACT_THRESHOLD = 20


def load_memory(supabase, user_id):
    resp = (
        supabase.table("agent_memory")
        .select("facts, summary, summarized_until")
        .eq("user_id", user_id)
        .execute()
    )
    rows = resp.data or []
    if rows:
        r = rows[0]
        return {
            "facts": r.get("facts") or "",
            "summary": r.get("summary") or "",
            "summarized_until": r.get("summarized_until"),
        }
    return {"facts": "", "summary": "", "summarized_until": None}


def load_recent_messages(supabase, user_id, since, limit=WINDOW_SIZE * 2):
    q = supabase.table("agent_messages").select("role, content, created_at").eq("user_id", user_id)
    if since:
        q = q.gt("created_at", since)
    resp = q.order("created_at", desc=True).limit(limit).execute()
    rows = list(resp.data or [])
    rows.reverse()  # back to ascending
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def save_turn(supabase, user_id, user_text, assistant_text):
    supabase.table("agent_messages").insert([
        {"user_id": user_id, "role": "user", "content": user_text},
        {"user_id": user_id, "role": "assistant", "content": assistant_text},
    ]).execute()


def memory_block(facts, summary):
    parts = []
    if facts and facts.strip():
        parts.append("HECHOS DURABLES SOBRE EL USUARIO (memoria persistente):\n" + facts.strip())
    if summary and summary.strip():
        parts.append("RESUMEN DE LA CONVERSACIÓN ANTERIOR:\n" + summary.strip())
    if not parts:
        return None
    return "\n\n".join(parts)


async def maybe_compact(supabase, user_id, client, model, mem):
    q = supabase.table("agent_messages").select("role, content, created_at").eq("user_id", user_id)
    if mem.get("summarized_until"):
        q = q.gt("created_at", mem["summarized_until"])
    resp = q.order("created_at", desc=False).execute()
    rows = list(resp.data or [])
    if len(rows) <= COMPACT_THRESHOLD:
        return
    to_fold = rows[:-WINDOW_SIZE]  # deja los últimos WINDOW_SIZE en la ventana
    if not to_fold:
        return
    convo = "\n".join(f"{r['role']}: {r['content']}" for r in to_fold)
    prompt = (
        "Eres el módulo de memoria de un asistente financiero personal. Te doy el RESUMEN "
        "previo, los HECHOS previos y unos MENSAJES nuevos de la conversación. Devuelve SOLO "
        "un JSON {\"summary\": \"...\", \"facts\": \"...\"} donde:\n"
        "- summary: resumen compacto que integra el resumen previo con los mensajes nuevos, "
        "conservando lo relevante para futuras respuestas.\n"
        "- facts: hechos DURABLES sobre el usuario (objetivos, preferencias, tolerancia al "
        "riesgo, decisiones, contexto personal), fusionando los hechos previos sin duplicar.\n\n"
        f"RESUMEN PREVIO:\n{mem.get('summary') or '(ninguno)'}\n\n"
        f"HECHOS PREVIOS:\n{mem.get('facts') or '(ninguno)'}\n\n"
        f"MENSAJES NUEVOS:\n{convo}"
    )
    completion = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=1024,
    )
    raw = completion.choices[0].message.content or ""
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        return  # sin JSON parseable: no compactar (no perder datos)
    try:
        data = json.loads(raw[start:end + 1])
    except Exception:
        return
    new_summary = (data.get("summary") or mem.get("summary") or "").strip()
    new_facts = (data.get("facts") or mem.get("facts") or "").strip()
    supabase.table("agent_memory").upsert(
        {
            "user_id": user_id,
            "facts": new_facts,
            "summary": new_summary,
            "summarized_until": to_fold[-1]["created_at"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id",
    ).execute()
