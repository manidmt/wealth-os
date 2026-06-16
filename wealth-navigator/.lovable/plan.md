## Contexto

Tu zip contiene una app **Next.js 15 + App Router** (`app/`, `app/api/*/route.ts`, lectura/escritura de JSON en `data/`) con ~4.200 LOC. Lovable funciona sobre **TanStack Start + Vite + Cloudflare Workers**, por lo que **no puedo ejecutar Next.js tal cual** en este proyecto: ni el runtime de Next, ni `fs` para persistir en `data/dashboard-data.json` funcionan aquí.

Para cumplir tu objetivo (rediseño premium **preservando rutas, secciones y estructura de datos**, sin reconstruir desde cero), hay que **portar** tu app al stack de Lovable. La lógica, los tipos, los stores y la UI se conservan; cambia solo la "carcasa" (router, endpoints, persistencia).

## Mapeo 1:1 Next → TanStack Start

```
app/page.tsx                  → src/routes/index.tsx              (Resumen / Home)
app/expenses/page.tsx         → src/routes/expenses.tsx           (Gastos mensuales)
app/portfolio/page.tsx        → src/routes/portfolio.tsx          (Portfolio)
app/net-worth/page.tsx        → src/routes/net-worth.tsx          (Patrimonio)
app/balances/page.tsx         → src/routes/balances.tsx           (Saldos y cierres)
app/settings/page.tsx         → src/routes/settings.tsx           (Configuración)

app/api/*/route.ts            → src/routes/api/*.ts               (server routes TanStack)
                              → o src/lib/*.functions.ts (createServerFn) según lo que llame el cliente

lib/*-store.ts                → src/lib/stores/*.server.ts        (mismos tipos y funciones)
lib/dashboard-data.ts         → src/lib/dashboard-data.ts         (idéntico, importa el JSON)
components/ui.tsx             → src/components/ui-legacy.tsx      (se reemplaza por shadcn equivalente)
components/plotly-charts.tsx  → src/components/charts/*.tsx       (recharts en lugar de plotly, ver abajo)
data/dashboard-data.json      → src/data/dashboard-data.json      (semilla, lectura)
```

Se conservan: nombres de rutas, props, tipos (`DashboardData`, `Holding`, etc.), nombres de campos del JSON, lógica de cálculos en `lib/`, helpers (`euro`, `euro1`), y la jerarquía de secciones de cada pantalla.

## Persistencia

Tus stores actuales escriben en `data/*.json` con `fs`. En Cloudflare Workers eso no funciona. Dos caminos:

- **A. Solo lectura (rápido, ideal para el rediseño visual):** la app lee `src/data/dashboard-data.json` como está hoy. Botones de "añadir gasto / movimiento" quedan deshabilitados o muestran un modal "demo". Sirve perfectamente para portfolio-worthy.
- **B. Lovable Cloud (recomendado para que vuelva a ser editable):** activo Lovable Cloud y migro `accounts`, `expenses`, `recurring_expenses`, `movements`, `portfolio_holdings`, `snapshots`, `fx_settings` a tablas con RLS. Reescribo los stores como funciones server contra Cloud. La forma de los datos no cambia.

## Librería de gráficos

`react-plotly.js` pesa mucho y no encaja bien en Workers/SSR. Lo sustituyo por **recharts** (ya instalable, ligero, SSR-friendly) replicando los mismos charts: serie temporal de patrimonio, barras de gastos por mes, donut de allocation, donut de plataformas, barras de categorías. Misma información, mejor estética.

## Sistema de diseño (visual upgrade)

Tokens en `src/styles.css` (oklch) + componentes shadcn. Dirección estética: **wealth dashboard premium, alto contraste medido, denso pero respirado**, tipografía editorial para titulares + sans neutra para datos, acentos de color reservados para deltas (verde/rojo) y categorías. Componentes compartidos:

- `AppShell` con sidebar shadcn colapsable + header con periodo, owner, FX
- `KpiCard` (label, valor, delta, sparkline opcional)
- `DeltaBadge` (+/- %, signo, color semántico)
- `SectionCard` (título, descripción, acciones, contenido)
- `CompactTable` (tabular-nums, zebra sutil, sticky header)
- `Donut`, `BarSeries`, `LineArea` sobre recharts
- `MoneyCell`, `MonthPicker`, `EmptyState`, `Toolbar`

Todo consumido vía tokens semánticos (`bg-card`, `text-muted-foreground`, `--chart-1..5`), nunca colores literales en componentes.

## Orden de ejecución (alineado con tu prioridad)

1. **Shell + design system + tokens + componentes compartidos + recharts** + sidebar con las 6 rutas.
2. **Port de `lib/` y datos** (tipos, helpers, JSON semilla, stores como `*.server.ts`).
3. **Resumen / Home** (`/`) — KPIs, serie patrimonio, allocation, últimos movimientos.
4. **Gastos mensuales** (`/expenses`) — selector de mes, totales, categorías, recurrentes, tabla.
5. **Portfolio** (`/portfolio`) — holdings, by platform, by category, refresh prices (en modo A: deshabilitado).
6. **Patrimonio** (`/net-worth`) — histórico, snapshots, composición.
7. **Saldos y cierres** (`/balances`) — cuentas, movimientos, cierre mensual.
8. **Configuración** (`/settings`) — FX, owner, preferencias.

Cada pantalla se entrega ya rediseñada (no hay paso "estructura primero, estilo después").

## Qué necesito decidir contigo antes de tocar código

1. **Persistencia: A (solo lectura, demo) o B (Lovable Cloud, editable)?**
2. **Rutas en inglés (como están: `/expenses`, `/portfolio`, `/net-worth`, `/balances`, `/settings`) o castellanizar (`/gastos`, `/patrimonio`, `/saldos`, `/configuracion`)?** Por defecto las dejo en inglés para no romper nada.
3. **Charts: confirmas recharts en lugar de plotly?**

Cuando me confirmes esos 3 puntos arranco con el shell + design system y voy entregando pantalla a pantalla en el orden de arriba.
