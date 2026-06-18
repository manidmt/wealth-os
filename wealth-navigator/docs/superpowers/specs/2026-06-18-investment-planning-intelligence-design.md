# Planificación de inversión: inteligencia + lista compacta — Diseño

**Fecha:** 2026-06-18
**Estado:** aprobado, listo para plan de implementación

## Objetivo

Hacer la pestaña de Planificación de inversión (`/planning?tab=inversion`) más
**inteligente y proactiva** y más **ligera visualmente**:

1. El Wealth Agent gana contexto real de planificación y produce un **briefing
   mensual** ("esto es lo que toca este mes") y responde **chat contextual**.
2. El bloque "Mis planes" pasa de tarjetas rectangulares grandes a una **lista
   compacta expandible**.
3. Se corrige un bug en el modal de registrar aportación (campos "opcionales"
   que en realidad bloquean el guardado).

## Contexto actual (lo que ya existe)

- **Motor determinista en TypeScript** (`supabase/functions/_shared/strategy-engine.ts`,
  re-exportado a `src/lib/strategy-engine.ts`, con tests): señales →
  multiplicador (`currentMultiplier`) → cuota efectiva (`effectiveQuota`),
  triggers de pólvora seca (`evaluateTrigger`), frescura de señal (`isStale`).
- **Agente Python** (fork `manidmt/wealth-agent`, FastAPI/uvicorn en
  `127.0.0.1:8001`): carga movements/portfolio/snapshots de Supabase y responde
  por WS con protocolo `{message, history}` → `{token}…{done}`. **No** conoce
  planes, señales, presupuesto ni rutina. Su system prompt prohíbe explícitamente
  "predicciones futuras" y limita el scope.
- **Página `/assistant`**: chat completo (WS propio, historial, playbooks,
  render markdown con `Markdownish`/`Composer`/`ThinkingDots`).
- **`src/lib/agent-ws.ts`**: helper `openAgentStream(userId, message, history, handlers)`
  usado por la sugerencia de presupuesto.
- **`InvestmentPlanning.tsx`** (31 KB, un solo archivo): grid de `StrategyCard`
  (estrategias) + `PlanCard` inline (DCA), `JanuaryWizard`, `MonthlyRoutine`,
  proyección, historial, `SignalsPanel`, modales de plan y de aportación.

## Decisión de arquitectura

**Híbrido inclinado al front.** El motor determinista vive solo en TypeScript y
está testeado; reimplementarlo en Python crearía una segunda fuente de verdad
que se desincroniza. Por tanto:

- El **frontend** sigue siendo la única fuente de verdad del estado determinista
  (cuotas efectivas, triggers, frescura de señales, ahorro disponible del mes).
- Un módulo puro nuevo **serializa** ese estado en un bloque de contexto.
- El **agente** se extiende mínimamente para **aceptar** ese contexto por WS y
  combinarlo con los datos de mercado/cartera que ya carga. Sin lógica duplicada.

## Alcance

**Dentro:**
1. "Mis planes" → lista compacta expandible (`PlanRow`).
2. Contexto de planificación serializado (`planning-context.ts`).
3. Campo `context` en el protocolo WS (front + agente Python).
4. Briefing mensual cacheado en Supabase + panel "Asistente de inversión".
5. Chat contextual de seguimiento reutilizando las piezas de `/assistant`.
6. Fix del modal de aportación.

**Fuera (futuro, anotar en engram):**
- Alertas proactivas (señal disparada, desviación, asignación desviada).
- Rebalanceo vs asignación objetivo.
- Que `/assistant` global herede contexto de planificación.

---

## Componentes

### 1. Lista compacta `PlanRow.tsx`

Reemplaza el grid de `StrategyCard` + `PlanCard` inline. Una fila por plan
(activo), válida para estrategias y para DCA normales.

**Colapsada (una línea):**
`semáforo · nombre · "base€ ×multi" · cuota €/mes · [Aportar|Soltar] · chevron`

- Semáforo: rojo (`tr.fired`), ámbar (`tr.blocked`), verde (resto). Para DCA sin
  trigger → verde neutro.
- `base€ ×multi`: para DCA con regla no-fija se muestra la regla (`formatRule`)
  en vez de `base€ ×multi`; el multiplicador solo aparece si la estrategia tiene
  `multiplier_rules`.
- Cuota: `effectiveQuota` para estrategias; `computePlannedAmount` para DCA
  (`—` si `rule_type === "event"`).
- Acción: "Soltar" (destructivo) solo si `tr.fired && dry_powder.current_eur > 0`;
  si no, "Aportar".

**Expandida (al pulsar la fila):**
- P&L de la posición vinculada (si `portfolio_position_id`).
- Pólvora seca: `current_eur` (+ `monthly_feed_eur`/mes si > 0) y botón "Soltar
  pólvora" (`useFireDryPowder`) cuando `tr.fired && current_eur > 0`.
- Detalle del trigger (`tr.detail`).
- Planificado vs aportado del mes en curso (de las contribuciones del plan).
- Botón "Editar" (lápiz) y "Registrar aportación".

`InvestmentPlanning.tsx` deja de renderizar el grid y monta `<PlanRow>` por plan
dentro de la `SectionCard "Mis planes"`. `StrategyCard.tsx` se elimina (su lógica
migra a `PlanRow`). El `PlanCard` inline se elimina.

### 2. Contexto de planificación `planning-context.ts` (puro, testeado)

```ts
export type PlanContextEntry = {
  name: string;
  assetName: string;
  assetClass: string | null;       // null = DCA normal
  rule: string;                    // formatRule(plan)
  baseAmount: number;
  multiplier: number;              // 1 si no aplica
  effectiveQuota: number;
  trigger: { fired: boolean; blocked: boolean; detail: string };
  dryPowder: { currentEur: number; monthlyFeedEur: number } | null;
  positionValueEur: number | null;
  pnlPct: number | null;
  plannedThisMonth: number;
  actualThisMonth: number | null;
};

export type SignalContextEntry = {
  key: string; label: string; value: number | null; date: string | null; stale: boolean;
};

export type PlanningContext = {
  month: string;                   // YYYY-MM
  plans: PlanContextEntry[];
  signals: SignalContextEntry[];
  routine: { label: string; done: boolean }[];
  savingsAvailableEur: number | null;  // ahorro disponible del mes (solo lo sabe el front)
  portfolioTotalEur: number | null;
};

export function buildPlanningContext(input: {...}): PlanningContext;
export function serializePlanningContext(ctx: PlanningContext): string;
```

- `buildPlanningContext` recibe datos ya cargados (planes, señales, posiciones,
  contribuciones por plan, financials/ahorro, rutina) y compone el objeto usando
  el motor TS (`effectiveQuota`, `currentMultiplier`, `evaluateTrigger`, `isStale`).
- `serializePlanningContext` produce un bloque de texto compacto en español,
  legible por el LLM (encabezados por sección: MES, PLANES, SEÑALES, RUTINA,
  AHORRO DISPONIBLE, PATRIMONIO).

### 3. Prompt de briefing `briefing-prompt.ts` (puro, testeado)

```ts
export function buildBriefingPrompt(serializedContext: string, month: string): string;
```

Compone el mensaje que se envía al agente para generar el briefing: incrusta el
contexto serializado y pide un resumen accionable y conciso con secciones fijas
(qué aportar y a qué, señales disparadas y acción, desviaciones plan-vs-real,
qué vigilar este mes). En español, sin inventar cifras, basándose solo en el
contexto y los datos del agente.

### 4. WS con contexto `agent-ws.ts`

`openAgentStream` gana un quinto parámetro opcional:

```ts
export function openAgentStream(
  userId: string,
  message: string,
  history: AgentMessage[],
  handlers: AgentHandlers,
  context?: string,
): () => void;
```

Si `context` está definido, el payload pasa a `{ message, history, context }`;
si no, sigue siendo `{ message, history }` (compatibilidad con la sugerencia de
presupuesto y otros usos).

### 5. Agente Python (fork)

- `app/routers/chat.py`: leer `context = data.get("context")` y pasarlo a
  `run_agent_stream(user_id, message, history, context)`.
- `app/services/agent_service.py`: `run_agent_stream(user_id, message, history, context=None)`.
  Si `context` no es vacío, añadir un bloque de sistema adicional con el estado de
  planificación y una instrucción que **habilita** respuestas tipo briefing/plan
  sobre ese contexto (relaja la prohibición de "predicciones" **solo** para
  razonar sobre el estado aportado; sigue prohibido inventar cifras). El agente
  combina ese contexto con los movements/portfolio que ya carga.

### 6. Persistencia del briefing

Migración nueva `investment_briefings`:

```sql
create table public.investment_briefings (
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,                 -- YYYY-MM
  content text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, period)
);
alter table public.investment_briefings enable row level security;
-- políticas de dueño: select/insert/update/delete where user_id = auth.uid()
```

Hook `briefing-api.ts`:
- `useBriefing(period)` → fila o null.
- `useSaveBriefing()` → upsert (user_id, period, content, generated_at = now()).

### 7. Panel "Asistente de inversión" `InvestmentAssistant.tsx`

Se monta arriba del tab de inversión. Componente cohesivo:

- **Briefing:** si `useBriefing(mesActual)` devuelve fila → render markdown
  (`Markdownish`) + timestamp + botón "Regenerar". Si no → botón "Generar
  briefing de {mes}". Generar:
  1. `serializePlanningContext(buildPlanningContext(...))`.
  2. `openAgentStream(user.id, buildBriefingPrompt(serialized, mes), [], handlers, serialized)`.
  3. Acumular tokens; en `onDone`, `useSaveBriefing` con el texto.
  Botón deshabilitado si no hay planes (hint "crea un plan primero").
- **Chat de seguimiento** (colapsable): reutiliza piezas extraídas de
  `/assistant` a `src/components/assistant/chat-bits.tsx`
  (`Markdownish`, `Composer`, `ThinkingDots`). Cada mensaje se envía con
  `openAgentStream(user.id, texto, history, handlers, serialized)`.

`routes/assistant.tsx` se refactoriza para **importar** esas piezas de
`chat-bits.tsx` (DRY), sin cambiar su comportamiento.

### 8. Fix del modal de aportación

En `InvestmentPlanning.tsx`, `contributionSchema`:

```ts
// Antes (bug): "" → coerce a 0 → .positive() falla → no guarda
price: z.coerce.number().positive().optional(),
multiplier: z.coerce.number().positive().optional(),
```

`z.coerce.number()` convierte el string vacío a `0`, `.positive()` lo rechaza y
`.optional()` solo admite `undefined`. Resultado: dejar el campo vacío bloquea el
guardado pese a mostrarse como "opcional".

**Fix:** envolver con `preprocess` que mapee `""`/`null`/`undefined` → `undefined`:

```ts
const optionalPositive = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().positive().optional(),
);
// price: optionalPositive,  multiplier: optionalPositive,
```

Verificar que `onSubmit` ya trata `values.price`/`values.multiplier` como
posiblemente `undefined` (lo hace: `values.price ?? null`, `values.multiplier ?? null`).

---

## Flujo de datos

1. `InvestmentPlanning` reúne planes, señales, posiciones, dashboard
   (financials/ahorro), contribuciones por plan y rutina.
2. `buildPlanningContext(...)` → `PlanningContext` → `serializePlanningContext` → string.
3. **Briefing:** `openAgentStream(user, buildBriefingPrompt(serialized, mes), [], h, serialized)`
   → stream → `useSaveBriefing`.
4. **Chat:** `openAgentStream(user, userMsg, history, h, serialized)`.
5. El agente inyecta el contexto como bloque de sistema y responde apoyándose en
   ese contexto + sus movements/portfolio.

## Manejo de errores

- Agente offline: `onError` de `openAgentStream` ya emite "El agente no está
  disponible ahora." → mensaje en el panel, botón sigue activo para reintentar,
  **no** se guarda briefing vacío.
- Sin planes: botón de briefing deshabilitado con hint.
- Fallo al guardar el briefing: se conserva el texto en pantalla; se muestra
  aviso inline.

## Testing

- **Vitest `planning-context`**: serialización con casos límite — sin posiciones,
  trigger disparado, señal caducada, sin ahorro disponible, DCA sin multiplicador.
- **Vitest `briefing-prompt`**: incluye el mes, el contexto serializado y pide las
  secciones acordadas.
- **Vitest `agent-ws`**: el payload incluye `context` cuando se pasa, y lo omite
  cuando no.
- **Cambio Python**: verificación manual (no hay infra de test en el agente):
  enviar un mensaje con `context` y comprobar que el agente lo usa.

## Estructura de archivos

**Nuevos:**
- `src/lib/planning-context.ts` (+ `planning-context.test.ts`)
- `src/lib/briefing-prompt.ts` (+ `briefing-prompt.test.ts`)
- `src/lib/briefing-api.ts`
- `src/components/planning/PlanRow.tsx`
- `src/components/planning/InvestmentAssistant.tsx`
- `src/components/assistant/chat-bits.tsx`
- `supabase/migrations/<ts>_investment_briefings.sql`

**Modificados:**
- `src/lib/agent-ws.ts` (parámetro `context`)
- `src/components/planning/InvestmentPlanning.tsx` (lista + monta asistente + fix schema)
- `src/routes/assistant.tsx` (importa `chat-bits`)
- `wealth-agent/app/routers/chat.py`
- `wealth-agent/app/services/agent_service.py`

**Eliminados:**
- `src/components/planning/StrategyCard.tsx` (lógica migrada a `PlanRow`)
