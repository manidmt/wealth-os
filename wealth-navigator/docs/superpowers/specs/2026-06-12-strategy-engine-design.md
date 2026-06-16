# Motor de Estrategias Semipasivas — Fase 1 (Wealth OS)

**Date:** 2026-06-12
**Scope:** Evolucionar `/planning` para modelar el sistema de estrategias del Excel `ESTATEGIA_PERSONAL.xlsx`: multiplicadores por señales de mercado, pólvora seca con disparos y cooldowns, rutina mensual/anual con checklist, LOG de aportaciones con precios, y aviso por Telegram vía OpenClaw.
**Out of scope (Fase 2):** proyección multi-activo con inflación/fiscalidad, simuladores what-if, reparto automático de exceso de ahorro por tramos, eventos vitales. El Excel solo se jubila al completar la fase 2.

**Decisiones tomadas en brainstorming:**
- Objetivo final: sustituir el Excel por completo (por fases).
- Señales: híbrido — automáticas donde hay API gratuita fiable, manuales con editor para el resto.
- Modelo: evolucionar `investment_plans` (un plan simple = estrategia sin reglas). Sin tabla nueva de estrategias.
- Rutina: checklist en la app + aviso Telegram (cron OpenClaw).
- Arquitectura: señales en BD (tabla global) + motor de reglas declarativas evaluado en cliente TypeScript.

---

## 1. Modelo de datos (Supabase)

### `investment_plans` — columnas nuevas

```sql
alter table public.investment_plans
  add column asset_class text,                -- 'rv_core'|'rv_opp'|'gold'|'btc'|'rf' | null (plan simple)
  add column multiplier_rules jsonb,          -- null = plan simple (multi 1 siempre)
  add column dry_powder jsonb,                -- null = sin pólvora
  add column annual_multiplier numeric not null default 1,
  add column annual_multiplier_year int;      -- año en que se fijó (wizard de enero)
```

`dry_powder` shape:
```json
{ "current_eur": 3000, "monthly_feed_eur": 33, "last_fired_at": null }
```
El disparo de la pólvora lo define el `trigger` de `multiplier_rules` (ver §2). Al disparar, la UI propone soltar `current_eur`; el usuario confirma y se registra como aportación extraordinaria + se actualiza `last_fired_at` y `current_eur`.

### `plan_contributions` — columnas nuevas (esto ES el LOG del Excel)

```sql
alter table public.plan_contributions
  add column price numeric,          -- precio de compra del activo ese mes
  add column units numeric,          -- participaciones (calculado en UI: actual_amount / price)
  add column multiplier numeric,     -- multi aplicado ese mes (trazabilidad)
  add column signal_note text;       -- ej. "Trifecta disparada" (normalmente null)
```

Precio medio ponderado = Σ actual_amount / Σ units, por plan. Rentabilidad real = precio actual de la señal de mercado vs precio medio.

### `market_signals` — nueva tabla GLOBAL (sin user_id: son datos de mercado objetivos)

```sql
create table public.market_signals (
  signal_key text not null,
  date date not null,
  value numeric not null,
  source text not null default 'auto' check (source in ('auto','manual')),
  updated_at timestamptz not null default now(),
  primary key (signal_key, date)
);
alter table public.market_signals enable row level security;
create policy "read signals" on public.market_signals
  for select using (auth.role() = 'authenticated');
create policy "manual write" on public.market_signals
  for insert with check (auth.role() = 'authenticated' and source = 'manual');
create policy "manual update" on public.market_signals
  for update using (auth.role() = 'authenticated') with check (source = 'manual');
```
Las escrituras `auto` las hace la Edge Function con service role (bypassa RLS).

**Catálogo de señales:**

| signal_key | Descripción | Fuente | Modo |
|---|---|---|---|
| `vix` | VIX cierre | Yahoo `^VIX` | auto |
| `dxy` | Índice dólar | Yahoo `DX-Y.NYB` | auto |
| `tips_10y_real` | Yield real TIPS 10Y (%) | FRED `DFII10` | auto |
| `hy_spread` | Spread HY USA (pp) | FRED `BAMLH0A0HYM2` | auto |
| `msci_dd` | Drawdown MSCI World vs ATH (fracción, negativa) | Yahoo `IWDA.AS` (hist. Stooq seed) | auto |
| `gold_dd` | Drawdown oro vs ATH | Yahoo `GC=F` | auto |
| `btc_dd` | Drawdown BTC vs ATH | Yahoo `BTC-USD` / Stooq `btcusd` | auto |
| `btc_p200w` | Precio BTC / media 200 semanas | calculado del histórico propio | auto |
| `btc_mvrv` | MVRV Z-Score | lookintobitcoin (a mano) | manual |
| `btc_puell` | Puell Multiple | lookintobitcoin (a mano) | manual |
| `insiders_ratio` | Ratio compras insiders | openinsider (a mano) | manual |

Las señales manuales caducan: si su `date` tiene >35 días, la UI las marca "caducada" y el motor trata el combo que las use como **no disparable** (nunca disparar con datos viejos).

### `routine_logs` — nueva tabla

```sql
create table public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,              -- '2026-06' (mensual) | '2026-annual'
  items jsonb not null default '[]', -- [{key, label, done, done_at}]
  completed_at timestamptz,
  unique(user_id, period)
);
-- RLS estándar por user_id (mismo patrón que investment_plans)
```

---

## 2. Motor de reglas — `src/lib/strategy-engine.ts`

`multiplier_rules` tiene hasta dos partes: `base` (multiplicador de la cuota mensual) y `trigger` (disparo oportunista de pólvora). Ambas opcionales.

```typescript
type MultiplierRules = {
  base?: LadderRule | MatrixRule;
  trigger?: ComboRule;
};

type LadderRule = {
  type: "ladder";
  cadence: "annual" | "monthly";
  signal: SignalKey;
  steps: { lte: number; multi: number }[];  // ordenados, gana el más profundo
  default: number;                            // normalmente 1
};

type MatrixRule = {
  type: "matrix";
  cadence: "annual";
  row_signal: SignalKey;       // tips_10y_real
  col_signal: SignalKey;       // dxy
  row_breaks: number[];        // umbrales descendentes de fila
  col_breaks: number[];        // umbrales ascendentes de columna
  values: number[][];          // matriz de multiplicadores
  bonus?: { signal: SignalKey; lte: number; add: number };  // +1 si gold_dd ≤ -0.15
  max: number;
};

type ComboRule = {
  type: "combo";
  conditions: { signal: SignalKey; op: "gt" | "gte" | "lt" | "lte"; value: number }[];
  multi: number;               // se aplica sobre la pólvora acumulada
  cooldown_months: number;
};
```

**API del motor (funciones puras, sin I/O):**

```typescript
evaluateBase(rules, signals): { multi: number; detail: string }
  // cadence 'annual': devuelve la propuesta para el wizard de enero;
  // el multi VIGENTE del año es plan.annual_multiplier (persistido).
evaluateTrigger(rules, signals, lastFiredAt, now): 
  { fired: boolean; blocked: "cooldown" | "stale_signal" | null; detail: string }
effectiveQuota(plan, signals): number   // amount × multi vigente
```

- Cadencia `annual`: el multiplicador vigente es el persistido (`annual_multiplier`); el motor solo calcula la *propuesta* que el wizard de enero muestra y el usuario confirma.
- Cadencia `monthly`: se evalúa on-the-fly con la última señal disponible.
- Cooldown: `fired = false` si `now < lastFiredAt + cooldown_months`.
- Señal manual caducada (>35 días) en un combo → `blocked: "stale_signal"`.

---

## 3. Edge Functions

### `signals-sync` (cron pg_cron diario, 7:00 UTC)

1. Yahoo chart API (sin key): `^VIX`, `DX-Y.NYB`, `IWDA.AS`, `GC=F`, `BTC-USD` → último cierre.
2. FRED API (`FRED_API_KEY` en secrets, gratuita): `DFII10`, `BAMLH0A0HYM2`.
3. Drawdowns: mantiene ATH incremental en una fila `*_ath` interna (o lo recalcula del histórico propio); seed inicial del histórico completo vía Stooq CSV (`btcusd`, `^spx`…) en el script de seed, no en cada sync.
4. `btc_p200w`: precio / media móvil de 200 semanas calculada sobre el histórico acumulado en `market_signals` (señal `btc_price` diaria).
5. Upsert en `market_signals` con `source='auto'`. Error en una fuente → registra y continúa con el resto (sync parcial mejor que nada).

### `routine-summary` (GET, autenticación por service key)

Devuelve JSON para el aviso Telegram: por estrategia activa → cuota base, multi vigente, cuota efectiva, señales relevantes con valor y estado, disparos pendientes, señales manuales caducadas. Un cron de OpenClaw (último viernes del mes 9:00 + 1 de enero) la consulta y formatea el mensaje. La configuración del cron OpenClaw se hace fuera de este repo.

---

## 4. UI — `/planning` rediseñada

La página crece; se trocea en componentes bajo `src/components/planning/`:

1. **Tarjetas de estrategia** (sustituyen las cards actuales): nombre + activo, cuota base → multi vigente → **cuota efectiva del mes**, barra de pólvora (saldo, feed mensual) y semáforo de señales (verde nada, ámbar cooldown/caducada, rojo disparo activo). Planes simples se renderizan como hasta ahora.
2. **Rutina del mes**: checklist generado dinámicamente de las estrategias activas (estilo hoja RUTINA: confirmar compra X €, transferir feed pólvora, revisar señales — ya evaluadas —, registrar). Cada paso de compra abre el registro de aportación inline: importe (precalculado = cuota efectiva, editable) + precio → unidades automáticas. Estado en `routine_logs`. Si un trigger dispara, el checklist inserta el paso extraordinario "Soltar pólvora (N €)".
3. **Wizard de enero** (visible en enero o si `annual_multiplier_year < año actual`): muestra señal por estrategia anual (DD MSCI, matriz TIPS×DXY, DD BTC), propone multiplicadores, el usuario confirma → persiste `annual_multiplier(_year)` y crea el `routine_logs` anual. Incluye paso "comprar BTC del año de golpe (cuota × 12 × multi)".
4. **LOG**: tabla por estrategia (mes | aportado | precio | unidades | multi | señal) + precio medio ponderado + rentabilidad vs precio actual de mercado.
5. **Panel de señales**: tabla con valor, fecha, fuente y botón de edición para las manuales (badge "caducada" >35 días). Vive en `/planning` (pestaña o sección colapsable).
6. **Proyección**: se mantiene la actual de 3 escenarios sin cambios.

---

## 5. Seed — estrategias del Excel

Fuente de verdad: hoja 🎛️ CONTEXTO (ante discrepancias con 📐 PARÁMETROS, gana CONTEXTO). Script `scripts/seed-strategies.ts` (idempotente, corre con las claves del usuario) crea:

| Estrategia | asset_class | Cuota base | Regla base | Trigger | Pólvora |
|---|---|---|---|---|---|
| RV Core (MSCI World) | rv_core | 200 €/mes | ladder anual `msci_dd`: ≤−10%→2, ≤−20%→3 | — | — |
| RV Oportunista (S&P) | rv_opp | 100 €/mes | — | vix>50 ∧ insiders_ratio≥0.5 → x4, cooldown 3m | 3000 €, feed 33 €/mes |
| Oro (IGLN) | gold | 100 €/mes | matrix anual TIPS×DXY (ver abajo), bonus +1 si gold_dd≤−15%, max 6 | tips<0.5 ∧ dxy>110 ∧ gold_dd≤−5% → x6, cooldown 6m | 1000 €, feed 50 €/mes |
| BTC (Criptan) | btc | 50 €/mes | ladder anual `btc_dd` (a 31 dic): ≤−30%→2, ≤−50%→3, ≤−70%→4 | btc_dd<−50% ∧ btc_mvrv<0 ∧ btc_p200w<1.2 ∧ btc_puell<0.5 → x4, cooldown 6m | 1000 €, feed 0 |
| Renta Fija (HY) | rf | 0 €/mes (inactiva hasta sep-2027) | ladder mensual `hy_spread`: >5→2, >7→3, >10→4 | — | — |

Matriz oro (filas TIPS, columnas DXY ≤100 / >100 / >110 / >120):
`≥1%: [1,1,2,2] · <1%: [2,2,3,3] · <0.5%: [3,3,4,5] · <0%: [4,4,5,6]`

---

## 6. Archivos a crear/modificar

| Archivo | Acción |
|---|---|
| `supabase/migrations/YYYYMMDD_strategy_engine.sql` | Crear (todo el §1) |
| `supabase/functions/signals-sync/index.ts` | Crear |
| `supabase/functions/routine-summary/index.ts` | Crear |
| `src/lib/strategy-engine.ts` | Crear (motor puro + tipos) |
| `src/lib/strategy-engine.test.ts` | Crear (Vitest) |
| `src/lib/signals-api.ts` | Crear (hooks market_signals + edición manual) |
| `src/lib/planning-api.ts` | Modificar (campos nuevos, routine_logs) |
| `src/lib/planning-calc.ts` | Modificar (cuota efectiva usa el motor) |
| `src/components/planning/*` | Crear (StrategyCard, MonthlyRoutine, JanuaryWizard, ContributionLog, SignalsPanel) |
| `src/routes/planning.tsx` | Modificar (composición de los componentes) |
| `scripts/seed-strategies.ts` | Crear |

---

## 7. Testing y verificación

- **Vitest sobre el motor** (puro, sin mocks de red): matriz oro completa (16 celdas + bonus + max), escalones DD con valores frontera, combos con cooldown activo/expirado, señal manual caducada bloquea disparo, plan simple → multi 1.
- **Verificación contra el Excel**: con las señales de hoy cargadas, los multiplicadores que muestra la app deben coincidir con los que dan las hojas del Excel (RV x1, Oro x2, BTC x1 según RUTINA actual).
- **signals-sync**: invocación manual post-deploy y comprobación de filas en `market_signals`; tolerancia a fallo parcial de fuentes.
- **E2E manual**: completar una rutina mensual entera (checklist → aportación con precio → LOG actualizado → precio medio recalculado).

## 8. Dependencias y riesgos

- Requiere desbloquear el despliegue de Edge Functions (`supabase login` — mismo bloqueo detectado en Open Banking) y una `FRED_API_KEY` gratuita como secret.
- Yahoo Finance no es API oficial: si rompe, el panel de señales muestra la fecha del último dato y todo es corregible a mano (degradación elegante por diseño).
- Los dos bugfixes pendientes de commit (dashboard-data, movements-api) deben commitearse antes de empezar.
