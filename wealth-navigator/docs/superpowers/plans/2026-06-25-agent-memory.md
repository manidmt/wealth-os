# Agent Memory (history + profile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All implementer/reviewer subagents must use the `sonnet` model — never opus or fable.**

**Goal:** Persist agent conversations and give the agent long-term memory about the user, with bounded token cost via a recent-message window + rolling summary + durable facts.

**Architecture:** Two Supabase tables (`agent_messages`, `agent_memory`). The agent (service role) saves each turn, reconstructs context from DB (memory block + recent window) instead of the full client history, and compacts old messages into a summary + facts when a threshold is exceeded. The frontend loads history for display and flags the main chats with `remember: true`.

**Tech Stack:** FastAPI (Python, supabase-py, openai), Supabase (Postgres/RLS), Vite + React + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-25-agent-memory-design.md`

**Working dir:** `/home/manidmt/Desktop/wealth-os` (single repo). Agent under `wealth-agent/`, frontend under `wealth-navigator/`. Branch: `feature/agent-memory`.

**Important:** The Python agent has **no test infra** — Python tasks verify with `python -m py_compile` and the controller does manual WS verification at the end. Frontend gate: `npm run build` succeeds, eslint clean on touched files, no NEW tsc errors in touched files (the repo has pre-existing tsc errors elsewhere — ignore them).

---

## File Structure

**New:**
- `supabase/migrations/20260625120000_agent_memory.sql` (wealth-navigator) — both tables.
- `wealth-agent/app/services/memory_service.py` — load/save/compact memory.
- `wealth-navigator/src/lib/agent-api.ts` — `useAgentMessages` hook.

**Modified:**
- `wealth-agent/app/services/agent_service.py` — memory injection + persistence + `remember`.
- `wealth-agent/app/routers/chat.py` — read `remember`.
- `wealth-navigator/src/components/agent/AgentChatWidget.tsx` — load history + `remember: true`.
- `wealth-navigator/src/routes/assistant.tsx` — load history + `remember: true`.

`agent-ws.ts` is intentionally NOT changed: no current caller of `openAgentStream` needs `remember` (the planning chat stays ephemeral; it still gets `facts` injected agent-side).

---

## Task 1: Migration — agent_messages + agent_memory

**Files:**
- Create: `wealth-navigator/supabase/migrations/20260625120000_agent_memory.sql`

Do NOT run `supabase db push` (the controller applies it). Just create the file and commit.

- [ ] **Step 1: Write the migration**

Create `wealth-navigator/supabase/migrations/20260625120000_agent_memory.sql`:

```sql
create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index agent_messages_user_created_idx on public.agent_messages (user_id, created_at);
alter table public.agent_messages enable row level security;
create policy "own agent messages" on public.agent_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.agent_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  facts text not null default '',
  summary text not null default '',
  summarized_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.agent_memory enable row level security;
create policy "own agent memory" on public.agent_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Commit**

```bash
cd /home/manidmt/Desktop/wealth-os
git add wealth-navigator/supabase/migrations/20260625120000_agent_memory.sql
git commit -m "feat: agent_messages and agent_memory tables"
```

---

## Task 2: `memory_service.py`

**Files:**
- Create: `wealth-agent/app/services/memory_service.py`

The agent's supabase client comes from `data_service.get_supabase_client()` (service role). supabase-py query API: `.table(name).select(cols).eq(col, val).gt(col, val).order(col, desc=bool).limit(n).execute()` → `resp.data` (list of dicts); `.insert([...]).execute()`; `.upsert({...}, on_conflict="user_id").execute()`. The OpenAI client + `MODEL` are passed in from the caller.

- [ ] **Step 1: Create the module**

```python
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
```

- [ ] **Step 2: Syntax check**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-agent && python -m py_compile app/services/memory_service.py && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
cd /home/manidmt/Desktop/wealth-os
git add wealth-agent/app/services/memory_service.py
git commit -m "feat(agent): memory_service (load/save/compact conversation memory)"
```

---

## Task 3: Wire memory + persistence into the agent

**Files:**
- Modify: `wealth-agent/app/services/agent_service.py`
- Modify: `wealth-agent/app/routers/chat.py`

- [ ] **Step 1: Update imports in `agent_service.py`**

The current import is `from app.services.data_service import load_user_data`. Change it and add the memory import:

```python
from app.services.data_service import load_user_data, get_supabase_client
from app.services.memory_service import (
    load_memory,
    load_recent_messages,
    save_turn,
    maybe_compact,
    memory_block,
)
```

- [ ] **Step 2: Rewrite `run_agent_stream` in `agent_service.py`**

Replace the entire `async def run_agent_stream(...)` function with:

```python
async def run_agent_stream(user_id, message, history, context=None, remember=False):
    _, df_movements_recent, df_portfolio = load_user_data(user_id)
    system_prompt = build_system_prompt(df_movements_recent)

    supabase = get_supabase_client()
    mem = load_memory(supabase, user_id)

    system_messages = [{"role": "system", "content": system_prompt}]
    block = memory_block(mem["facts"], mem["summary"])
    if block:
        system_messages.append({"role": "system", "content": block})
    if context:
        system_messages.append({
            "role": "system",
            "content": (
                "ESTADO DE PLANIFICACIÓN DE INVERSIÓN DEL USUARIO (fuente fiable, "
                "ya calculada por la app). Úsalo junto con tus tools. Sobre este "
                "estado SÍ puedes razonar de forma accionable (qué aportar este mes, "
                "qué señal se ha disparado, desviaciones), pero no inventes cifras "
                "que no estén aquí ni en tus datos:\n\n" + context
            ),
        })

    if remember:
        window = load_recent_messages(supabase, user_id, mem["summarized_until"])
        messages = window + [{"role": "user", "content": message}]
    else:
        messages = [{"role": m.role, "content": m.content} for m in history]
        messages.append({"role": "user", "content": message})

    full = ""
    for _ in range(5):
        response = await client.chat.completions.create(
            model=MODEL,
            messages=system_messages + messages,
            tools=TOOLS_SCHEMA,
            tool_choice="auto",
            temperature=0.1,
            max_completion_tokens=1024,
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            stream = await client.chat.completions.create(
                model=MODEL,
                messages=system_messages + messages,
                temperature=0.1,
                max_completion_tokens=1024,
                stream=True,
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content
                if token:
                    full += token
                    yield token
            if remember:
                save_turn(supabase, user_id, message, full)
                await maybe_compact(supabase, user_id, client, MODEL, mem)
            return

        messages.append(msg)
        for tool_call in msg.tool_calls:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            result = dispatch_tool(tool_name, tool_args, df_movements_recent, df_portfolio)
            messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})

    yield "No se pudo resolver la consulta en el número máximo de iteraciones."
```

(Only changes vs current: `remember` param, memory load + block, the `remember` branch for building `messages`, accumulating `full`, and the `save_turn`/`maybe_compact` before `return`.)

- [ ] **Step 3: Read `remember` in `chat.py`**

In `wealth-agent/app/routers/chat.py`, after `context = data.get("context")`, add:
```python
            remember = bool(data.get("remember", False))
```
and change the call to:
```python
            async for token in run_agent_stream(user_id, message, history, context, remember):
                await websocket.send_text(json.dumps({"token": token}))
```

- [ ] **Step 4: Syntax check**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-agent && python -m py_compile app/services/agent_service.py app/routers/chat.py && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
cd /home/manidmt/Desktop/wealth-os
git add wealth-agent/app/services/agent_service.py wealth-agent/app/routers/chat.py
git commit -m "feat(agent): inject memory + persist turns when remember=true"
```

---

## Task 4: Frontend hook `useAgentMessages`

**Files:**
- Create: `wealth-navigator/src/lib/agent-api.ts`

- [ ] **Step 1: Create the hook**

Import paths match `planning-api.ts`: supabase from `@/integrations/supabase/client`, useAuth from `@/hooks/use-auth`.

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AgentMessage = { id: string; role: "user" | "assistant"; content: string };

export function useAgentMessages() {
  const { user } = useAuth();
  return useQuery<AgentMessage[]>({
    queryKey: ["agent_messages", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("agent_messages")
        .select("id, role, content, created_at")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((m: any) => ({ id: m.id, role: m.role, content: m.content }));
    },
    enabled: !!user,
    staleTime: 10_000,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit 2>&1 | grep "agent-api" || echo "no errors in agent-api"`
Expected: `no errors in agent-api`.

- [ ] **Step 3: Commit**

```bash
cd /home/manidmt/Desktop/wealth-os
git add wealth-navigator/src/lib/agent-api.ts
git commit -m "feat: useAgentMessages hook (load persisted agent history)"
```

---

## Task 5: Load history + set `remember` in the two main chats

**Files:**
- Modify: `wealth-navigator/src/components/agent/AgentChatWidget.tsx`
- Modify: `wealth-navigator/src/routes/assistant.tsx`

### AgentChatWidget.tsx

Its `Msg` type is `{ role: "user" | "system"; content: string; id: string }` (assistant messages use role `"system"`). It keeps `messages` in `useState` and opens a WS when `open` becomes true. The `send()` builds `history` and sends `{ message, history }`.

- [ ] **Step 1: Import the hook and seed history on open**

Add the import at the top:
```ts
import { useAgentMessages } from "@/lib/agent-api";
```

Inside the component, after the existing state hooks, add:
```ts
  const { data: persisted } = useAgentMessages();
  const seededRef = useRef(false);
```
(There is already a `useRef` import in this file.)

Add an effect that seeds the messages once each time the widget opens (place it after the WS `useEffect`):
```ts
  useEffect(() => {
    if (open && !seededRef.current && persisted && persisted.length > 0) {
      setMessages(
        persisted.map((m) => ({
          id: m.id,
          role: m.role === "user" ? ("user" as const) : ("system" as const),
          content: m.content,
        })),
      );
      seededRef.current = true;
    }
    if (!open) seededRef.current = false;
  }, [open, persisted]);
```

- [ ] **Step 2: Send `remember: true`**

In `send()`, change the `ws.send(...)` line from:
```ts
    wsRef.current.send(JSON.stringify({ message: text, history }));
```
to:
```ts
    wsRef.current.send(JSON.stringify({ message: text, history, remember: true }));
```

### assistant.tsx

`AssistantPage` keeps `messages` (`Msg = { id, role: "user" | "assistant", content, pending? }`) in state, opens a WS, and `send()` sends `{ message, history }`.

- [ ] **Step 3: Import + seed history on mount**

Add the import near the other imports:
```ts
import { useAgentMessages } from "@/lib/agent-api";
```

In `AssistantPage`, after the existing state declarations, add:
```ts
  const { data: persisted } = useAgentMessages();
  const seededRef = useRef(false);
```
(`useRef` is already imported in this file.)

Add an effect to seed once when history arrives and there are no messages yet (place it with the other effects):
```ts
  useEffect(() => {
    if (!seededRef.current && persisted && persisted.length > 0 && messages.length === 0) {
      setMessages(persisted.map((m) => ({ id: m.id, role: m.role, content: m.content })));
      seededRef.current = true;
    }
  }, [persisted, messages.length]);
```

- [ ] **Step 4: Send `remember: true`**

In `assistant.tsx`'s `send()`, change:
```ts
    wsRef.current.send(JSON.stringify({ message: trimmed, history }));
```
to:
```ts
    wsRef.current.send(JSON.stringify({ message: trimmed, history, remember: true }));
```

- [ ] **Step 5: Verify**

Run:
```
cd /home/manidmt/Desktop/wealth-os/wealth-navigator
npx eslint src/components/agent/AgentChatWidget.tsx src/routes/assistant.tsx src/lib/agent-api.ts
npm run build
```
Expected: eslint clean; build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /home/manidmt/Desktop/wealth-os
git add wealth-navigator/src/components/agent/AgentChatWidget.tsx wealth-navigator/src/routes/assistant.tsx
git commit -m "feat: load persisted history + remember:true in agent chats"
```

---

## Final verification (controller)

- [ ] Apply the migration: `cd wealth-navigator && npx supabase db push`.
- [ ] `npm run build` clean; restart frontend: `systemctl --user restart wealth-navigator`.
- [ ] Restart the agent: `systemctl --user restart wealth-agent`; `python -m py_compile` already green.
- [ ] Manual WS test (user `5acfa18c-...`): send a couple of messages with `{remember:true}`; query `agent_messages` to confirm rows saved. Reopen the chat in the app → history shows. Send >20 messages → confirm `agent_memory.summary`/`facts` populate and the per-turn context stays bounded (the agent still answers about earlier statements via summary/facts).
- [ ] Confirm the planning chat (InvestmentAssistant) still works and now reflects `facts` (no persistence regression).

---

## Self-Review notes

- **Spec coverage:** tables → Task 1; memory_service (load/save/compact/block) → Task 2; run_agent_stream memory+persistence+remember & chat.py → Task 3; useAgentMessages → Task 4; chat surfaces load history + remember → Task 5. `agent-ws.ts` intentionally unchanged (documented). All covered.
- **Type/signature consistency:** `load_memory` returns `{facts, summary, summarized_until}` used in Task 3; `load_recent_messages(supabase, user_id, since)`, `save_turn(supabase, user_id, user_text, assistant_text)`, `maybe_compact(supabase, user_id, client, model, mem)`, `memory_block(facts, summary)` signatures match between Task 2 (def) and Task 3 (calls). `useAgentMessages` returns `{id, role, content}` consumed in Task 5. `remember` flows front (Task 5) → chat.py (Task 3) → run_agent_stream (Task 3).
- **Placeholder scan:** no TBD/placeholders; every code step is complete.
