# Memoria del Wealth Agent (historial + perfil), optimizada en tokens — Diseño

**Fecha:** 2026-06-25
**Estado:** aprobado, listo para plan de implementación

## Objetivo

Que el Wealth Agent **guarde las conversaciones** (sobreviven a recargas) y tenga
**memoria de largo plazo sobre el usuario** (perfil/hechos que recuerda siempre),
**sin disparar el coste de tokens** cuando el hilo crece.

## Estado actual

- El agente (FastAPI, `run_agent_stream`) recibe `message, history, context` por WS
  y construye `system + (context opcional) + history + message`. El `history` lo
  manda el front; vive en `useState` y se pierde al recargar. No hay BD ni memoria.
- 3 superficies de chat:
  - `AgentChatWidget` (FAB flotante): WS propio, envía `{message, history}`.
  - `/assistant` (`assistant.tsx`): WS propio, envía `{message, history}`.
  - `InvestmentAssistant` (planificación): usa `openAgentStream` con `{message, history, context}`.

## Idea clave (coste acotado)

El agente **nunca manda todo el hilo**. En cada turno arma el contexto así:

> `system + [MEMORIA: facts + summary] + últimos N mensajes literales + mensaje nuevo`

- `facts`: perfil/hechos durables del usuario (memoria de largo plazo, compacto).
- `summary`: resumen rodante de la conversación **antigua** (lo ya plegado).
- Ventana reciente: solo los últimos N mensajes (verbatim).
- Cuando los mensajes sin resumir superan un umbral, una **compactación** (1 llamada
  LLM ocasional) pliega los viejos en `summary`, actualiza `facts`, avanza
  `summarized_until` y los saca de la ventana. → coste por turno pequeño y constante.

Constantes: `WINDOW_SIZE = 12`, `COMPACT_THRESHOLD = 20`.

## Modelo de datos (Supabase, proyecto pqfixpcbupdslrdfealq)

```sql
create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,            -- 'user' | 'assistant'
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

El **agente** escribe con service role (bypassa RLS). El **front** solo lee
`agent_messages` (RLS de dueño) para mostrar el historial.

## Persistencia: ¿qué chats guardan el hilo?

- **Hilo único persistente** = el chat general del agente (`AgentChatWidget` + `/assistant`).
  Esas superficies envían `remember: true`; el agente reconstruye el contexto desde la
  BD (ignora el `history` del cliente), guarda el turno y compacta.
- **`InvestmentAssistant`** (planificación) sigue **efímero** (`remember` ausente/false):
  usa su `history` local + `context`, **pero igualmente recibe la MEMORIA `facts`**
  inyectada (el agente conoce al usuario en todas partes).
- La memoria `facts` se inyecta **siempre** (con o sin `remember`).

## Agente — módulo nuevo `app/services/memory_service.py`

```python
WINDOW_SIZE = 12
COMPACT_THRESHOLD = 20

def load_memory(supabase, user_id) -> dict          # {facts, summary, summarized_until}
def load_recent_messages(supabase, user_id, since)  # mensajes con created_at > since (o últimos), orden asc → [{role, content}]
def save_turn(supabase, user_id, user_text, assistant_text)  # inserta 2 filas
async def maybe_compact(supabase, user_id, client, model)    # si nº mensajes sin resumir > THRESHOLD: resume los más antiguos (todos menos los últimos WINDOW_SIZE) + extrae facts vía LLM; actualiza agent_memory
def memory_block(facts, summary) -> str | None      # bloque de sistema con facts + summary (None si ambos vacíos)
```

- `maybe_compact`: selecciona los mensajes con `created_at > summarized_until`; si son
  > THRESHOLD, toma los más antiguos (deja los últimos WINDOW_SIZE en la ventana),
  llama al LLM para (a) actualizar `summary` integrando esos mensajes con el `summary`
  previo y (b) **fusionar `facts`** (hechos durables nuevos sobre el usuario, sin
  duplicar), y avanza `summarized_until` al `created_at` del último mensaje plegado.
- El prompt de compactación: "Resume de forma compacta la conversación previa
  conservando lo relevante; y lista los hechos DURABLES sobre el usuario (objetivos,
  preferencias, tolerancia al riesgo, decisiones, contexto). Devuelve JSON
  {summary, facts}." (Pura llamada LLM con el cliente OpenAI existente y MODEL.)

## Agente — `agent_service.run_agent_stream`

Firma: `run_agent_stream(user_id, message, history, context=None, remember=False)`.

1. `load_user_data` (igual que ahora) + `mem = load_memory(supabase, user_id)`.
2. `system_messages = [system_prompt]`; si `memory_block(mem.facts, mem.summary)` → añade ese bloque de sistema; si `context` → añade el bloque de planificación (igual que ahora).
3. Mensajes de conversación:
   - Si `remember`: `window = load_recent_messages(supabase, user_id, mem.summarized_until)` (limitado a los últimos ~WINDOW_SIZE*2); `messages = window + [{user, message}]`. (Ignora el `history` del cliente.)
   - Si no: `messages = history + [{user, message}]` (comportamiento actual).
4. Bucle de tools + streaming **igual que ahora**, pero acumulando el texto del asistente en `full`.
5. Al terminar el streaming, si `remember`: `save_turn(user_id, message, full)`; `await maybe_compact(...)`.

(El `supabase` se obtiene con `get_supabase_client()` de `data_service`.)

## Agente — `chat.py`

Leer `remember = data.get("remember", False)` y pasarlo:
`run_agent_stream(user_id, message, history, context, remember)`.

## Frontend

- **`agent-ws.ts`** `openAgentStream`: nuevo 6º parámetro opcional `remember?: boolean`; si se pasa, va en el payload. (Para futuro; el widget y /assistant usan WS propio.)
- **Hook nuevo `src/lib/agent-api.ts`**: `useAgentMessages()` → `select id, role, content, created_at from agent_messages order by created_at asc limit 200` (RLS de dueño), mapeado a `{id, role, content}`. (`role` 'assistant' se muestra como mensaje del agente.)
- **`AgentChatWidget`**: al abrir (open=true), sembrar `messages` desde `useAgentMessages` (solo una vez por apertura); en `send`, añadir `remember: true` al payload. (El historial se reconstruye en el agente; el front lo carga solo para mostrar.)
- **`assistant.tsx`** (`/assistant`): al montar, sembrar `messages` desde `useAgentMessages`; en `send`, añadir `remember: true` al payload.
- **`InvestmentAssistant`**: sin cambios de persistencia (sigue efímero); se beneficia de `facts` automáticamente.

## Alcance / fuera (YAGNI)

- Sin conversaciones múltiples ni títulos (hilo único por usuario).
- Sin UI de "borrar memoria/olvidar" (futuro; la tabla permite borrado por RLS si se quiere).
- El `InvestmentAssistant` no persiste su hilo (solo memoria `facts`).

## Testing

- El **agente no tiene infra de tests**; se verifica **manualmente** por WS: (1) mandar
  mensajes con `remember:true`, recargar y comprobar que el historial persiste; (2)
  superar el umbral y comprobar que `agent_memory.summary`/`facts` se rellenan y el
  contexto por turno no crece; (3) preguntar algo dicho hace muchos turnos y ver que lo
  recuerda vía summary/facts.
- **Vitest** posible para una utilidad pura del front si surge (p.ej. mapeo de roles);
  no hay lógica compleja de front aquí.

## Estructura de archivos

**Nuevos:**
- `wealth-agent/app/services/memory_service.py`
- `supabase/migrations/<ts>_agent_memory.sql`
- `src/lib/agent-api.ts` (`useAgentMessages`)

**Modificados:**
- `wealth-agent/app/services/agent_service.py` (memoria + persistencia + remember)
- `wealth-agent/app/routers/chat.py` (lee `remember`)
- `src/lib/agent-ws.ts` (param `remember`)
- `src/components/agent/AgentChatWidget.tsx` (cargar historial + remember:true)
- `src/routes/assistant.tsx` (cargar historial + remember:true)
