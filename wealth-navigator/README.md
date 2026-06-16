# wealth-navigator

Frontend del sistema **Wealth OS** — UI de patrimonio personal construida con TanStack Start + Vite + shadcn/ui + recharts.

Este repo se usa junto con [wealth-dashboard](https://github.com/manidmt/wealth-dashboard) (el backend).

---

## Estructura del monorepo

Ambos repos deben vivir dentro de una carpeta `wealth-os/`:

```
wealth-os/
├── wealth-dashboard/    ← backend (Next.js + SQLite)
└── wealth-navigator/    ← este repo (frontend)
```

```bash
mkdir wealth-os && cd wealth-os
git clone https://github.com/manidmt/wealth-dashboard
git clone https://github.com/manidmt/wealth-navigator
```

---

## Requisitos

- Node.js ≥ 18
- npm
- El backend `wealth-dashboard` corriendo en puerto 3333

---

## Setup

```bash
cd wealth-os/wealth-navigator

# 1. Instalar dependencias
npm install

# 2. Configurar la URL del backend
echo 'VITE_API_BASE_URL=http://localhost:3333' > .env

# 3. Arrancar
npm run dev
```

Abre `http://localhost:8080` (o el puerto que indique Vite si el 8080 está ocupado).

---

## Cómo se conecta con el backend

Al arrancar, el frontend llama a `GET /api/dashboard-snapshot` en el backend y provee los datos a toda la app vía `DashboardContext`. Los datos se refrescan cada 60 segundos.

Si el backend no está corriendo, la app sigue funcionando con los datos demo del fichero `src/data/dashboard-data.json`.

---

## Vistas

| Ruta | Descripción |
|---|---|
| `/` | Resumen ejecutivo — KPIs, allocation, gastos del mes |
| `/net-worth` | Evolución mensual del patrimonio |
| `/expenses` | Gastos e ingresos por mes y categoría |
| `/balances` | Saldos por cuenta |
| `/portfolio` | Posiciones de inversión |
| `/settings` | Configuración y exportación de datos |

---

## Workflow para cambios de Lovable

Este proyecto se edita también desde [Lovable](https://lovable.dev) (conectado a este repo vía GitHub). Después de hacer cambios en Lovable:

```bash
cd wealth-os/wealth-navigator
git pull
```

Si Lovable añade nuevas rutas que usan `import { data }` estático, el ajuste necesario es:
1. Quitar `data` del import de `@/lib/dashboard-data`
2. Añadir `import { useDashboard } from "@/hooks/use-dashboard"`
3. Añadir `const data = useDashboard()` como primera línea del componente

---

## Stack técnico

- **TanStack Start** — framework SSR/Vite
- **TanStack Router** — routing basado en ficheros
- **TanStack Query** — fetching y caché de datos
- **shadcn/ui + Radix UI** — componentes
- **recharts** — gráficos
- **Tailwind CSS** — estilos
