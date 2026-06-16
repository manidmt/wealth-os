# Logo Manim + Loading Screen + Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renombrar la app a "Wealth OS", generar un logo animado con Manim y reemplazar la pantalla de carga genérica por un componente con el GIF del logo.

**Architecture:** Tres tareas independientes en secuencia: rename global de strings, generación offline del GIF (Python/Manim), e integración del GIF en un componente React de loading que reemplaza el `Cargando…` actual en `AuthGate`.

**Tech Stack:** Manim 0.20.1, React 19, TanStack Router, Tailwind CSS 4.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `scripts/logo_anim.py` | Crear | Script Manim que genera el GIF del logo |
| `public/logo-anim.gif` | Crear | GIF generado por Manim, servido como asset estático |
| `src/components/app/LoadingScreen.tsx` | Crear | Pantalla de carga con GIF + texto "Wealth OS" |
| `src/routes/__root.tsx` | Modificar | Rename + usar LoadingScreen en AuthGate |
| `src/routes/assistant.tsx` | Modificar | Rename "Wealth Studio" → "Wealth OS", "Studio Assistant" → "Asistente" |
| `src/routes/login.tsx` | Modificar | Rename texto visible |
| `src/routes/settings.tsx` | Modificar | Rename filenames de descarga |
| `src/routes/expenses.tsx` | Modificar | Rename title meta |
| `src/routes/net-worth.tsx` | Modificar | Rename title meta |
| `src/routes/portfolio.tsx` | Modificar | Rename title meta |
| `src/routes/index.tsx` | Modificar | Rename title meta |
| `src/routes/balances.tsx` | Modificar | Rename title meta |
| `src/routes/planning.tsx` | Modificar | Rename title meta |
| `src/components/app/AppSidebar.tsx` | Modificar | Rename sidebar header |
| `src/components/app/BrandMark.tsx` | Modificar | Rename comentario JSDoc |
| `src/components/assistant/CommandBar.tsx` | Modificar | Rename referencias |
| `public/manifest.json` | Modificar | Rename name/short_name |

---

### Task 1: Rename global — "Wealth Studio" → "Wealth OS"

**Files:** 12 ficheros listados arriba (todos los Modify del file map excepto LoadingScreen)

- [ ] **Step 1: Rename en `__root.tsx`**

En `src/routes/__root.tsx`, sustituir:
```tsx
// línea ~85
{ title: "Wealth Studio" },
// línea ~92
{ property: "og:title", content: "Wealth Studio" },
// línea ~94 (og:description)
{ property: "og:description", content: "Dashboard personal de patrimonio premium." },
```
Por:
```tsx
{ title: "Wealth OS" },
{ property: "og:title", content: "Wealth OS" },
{ property: "og:description", content: "Dashboard personal de patrimonio, gastos e inversiones." },
```

- [ ] **Step 2: Rename en `AppSidebar.tsx`**

En `src/components/app/AppSidebar.tsx`, línea ~61:
```tsx
// antes:
              Wealth Studio
// después:
              Wealth OS
```

- [ ] **Step 3: Rename en `login.tsx`**

En `src/routes/login.tsx`, línea ~98:
```tsx
// antes:
              Wealth Studio
// después:
              Wealth OS
```

- [ ] **Step 4: Rename en `assistant.tsx`**

En `src/routes/assistant.tsx`:
```tsx
// línea ~22 — antes:
      { title: "Studio Assistant — Wealth Studio" },
// después:
      { title: "Asistente — Wealth OS" },

// línea ~26 — antes:
          "Conversa con el agente del Wealth Studio: revisión mensual, rebalance, stress test y consultas libres.",
// después:
          "Conversa con el agente de Wealth OS: revisión mensual, rebalance, stress test y consultas libres.",

// línea ~140 — antes:
    <AppShell pageEyebrow="Studio Assistant">
// después:
    <AppShell pageEyebrow="Asistente">

// línea ~143 — antes:
        title="Studio Assistant"
// después:
        title="Asistente"

// línea ~144 — antes:
        description="Tu copiloto sobre el Wealth Studio. Pregunta por gastos, allocation, evolución o ejecuta un playbook."
// después:
        description="Tu copiloto de Wealth OS. Pregunta por gastos, allocation, evolución o ejecuta un playbook."
```

- [ ] **Step 5: Rename en `CommandBar.tsx`**

En `src/components/assistant/CommandBar.tsx`:
```tsx
// línea ~55 — antes:
        <DialogTitle className="sr-only">Asistente de Wealth Studio</DialogTitle>
// después:
        <DialogTitle className="sr-only">Asistente de Wealth OS</DialogTitle>

// línea ~69 — antes:
            placeholder="Pregúntale al Studio Assistant…"
// después:
            placeholder="Pregúntale al Asistente…"

// línea ~146 — antes:
          <span>Studio Assistant · respuestas simuladas</span>
// después:
          <span>Asistente · respuestas simuladas</span>
```

- [ ] **Step 6: Rename en `BrandMark.tsx`**

En `src/components/app/BrandMark.tsx`, línea ~4:
```tsx
// antes:
 * Wealth Studio brand monogram.
// después:
 * Wealth OS brand monogram.
```

- [ ] **Step 7: Rename en `settings.tsx`**

En `src/routes/settings.tsx`:
```tsx
// línea ~41 — antes:
    a.download = `wealth-studio-${data.latestMonth}.json`;
// después:
    a.download = `wealth-os-${data.latestMonth}.json`;

// línea ~63 — antes:
    a.download = `wealth-studio-series-${data.latestMonth}.csv`;
// después:
    a.download = `wealth-os-series-${data.latestMonth}.csv`;
```

- [ ] **Step 8: Rename en `expenses.tsx`, `net-worth.tsx`, `portfolio.tsx`, `index.tsx`, `balances.tsx`, `planning.tsx`**

En cada uno de estos archivos, cambiar el meta title. Patrón: `— Wealth Studio"` → `— Wealth OS"`:

```tsx
// expenses.tsx
{ title: "Gastos mensuales — Wealth OS" },
// net-worth.tsx
{ title: "Patrimonio — Wealth OS" },
// portfolio.tsx
{ title: "Portfolio — Wealth OS" },
// index.tsx
{ title: "Resumen — Wealth OS" },
// balances.tsx
{ title: "Saldos y cierres — Wealth OS" },
// planning.tsx
{ title: "Planificación — Wealth OS" },
```

- [ ] **Step 9: Rename en `manifest.json`**

En `public/manifest.json`:
```json
{
  "name": "Wealth OS",
  "short_name": "WealthOS",
  ...
}
```

- [ ] **Step 10: Commit rename**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
git add -A
git commit -m "chore: rename Wealth Studio → Wealth OS throughout"
```

---

### Task 2: Manim — generar el logo animado

**Files:**
- Create: `scripts/logo_anim.py`
- Create (generated): `public/logo-anim.gif`

- [ ] **Step 1: Crear el directorio scripts si no existe**

```bash
mkdir -p /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator/scripts
```

- [ ] **Step 2: Crear el script Manim**

Crear `scripts/logo_anim.py`:

```python
from manim import *

class WealthOSLogo(Scene):
    def construct(self):
        self.camera.background_color = "#0f172a"

        # W construida con 4 segmentos de línea
        # Coordenadas normalizadas: ancho total ~3 unidades, alto ~2
        tl  = np.array([-1.5,  1.0, 0])   # top-left
        bli = np.array([-0.75, -1.0, 0])   # bottom-left-inner
        ct  = np.array([ 0.0,  -0.1, 0])   # center-top
        bri = np.array([ 0.75, -1.0, 0])   # bottom-right-inner
        tr  = np.array([ 1.5,  1.0, 0])    # top-right

        stroke_color = WHITE
        stroke_w = 8

        seg1 = Line(tl,  bli, stroke_color=stroke_color, stroke_width=stroke_w)
        seg2 = Line(bli, ct,  stroke_color=stroke_color, stroke_width=stroke_w)
        seg3 = Line(ct,  bri, stroke_color=stroke_color, stroke_width=stroke_w)
        seg4 = Line(bri, tr,  stroke_color=stroke_color, stroke_width=stroke_w)

        w = VGroup(seg1, seg2, seg3, seg4)
        w.move_to(ORIGIN)

        # Aparece cada segmento en secuencia, rápido y limpio
        self.play(
            AnimationGroup(
                Create(seg1),
                Create(seg2),
                Create(seg3),
                Create(seg4),
                lag_ratio=0.25,
            ),
            run_time=1.5,
        )
        self.wait(0.4)
```

- [ ] **Step 3: Renderizar el GIF**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
python3 -m manim -ql --format gif scripts/logo_anim.py WealthOSLogo 2>&1 | tail -10
```

Esperado: `File ready at media/videos/logo_anim/480p15/WealthOSLogo.gif` (o ruta similar).

- [ ] **Step 4: Copiar GIF a public/**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
GIF=$(find media -name "WealthOSLogo.gif" | head -1)
echo "Found: $GIF"
cp "$GIF" public/logo-anim.gif
ls -lh public/logo-anim.gif
```

Esperado: archivo copiado, tamaño razonable (< 500KB).

- [ ] **Step 5: Commit script y GIF**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
git add scripts/logo_anim.py public/logo-anim.gif
git commit -m "feat: add Manim logo animation script and generated GIF"
```

---

### Task 3: LoadingScreen component

**Files:**
- Create: `src/components/app/LoadingScreen.tsx`
- Modify: `src/routes/__root.tsx` (AuthGate)

- [ ] **Step 1: Crear el componente**

Crear `src/components/app/LoadingScreen.tsx`:

```tsx
export function LoadingScreen() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4"
      style={{ backgroundColor: "#0f172a" }}
    >
      <img
        src="/logo-anim.gif"
        alt="Wealth OS"
        width={96}
        height={96}
        className="animate-in fade-in duration-300"
        onError={(e) => {
          // fallback: ocultar imagen rota
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span
        className="animate-in fade-in duration-700 delay-300 text-[13px] uppercase tracking-[0.22em] text-white/40"
        style={{ animationFillMode: "both" }}
      >
        Wealth OS
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Integrar en `__root.tsx`**

En `src/routes/__root.tsx`:

1. Añadir el import al inicio del archivo (junto al resto de imports de componentes):
```tsx
import { LoadingScreen } from "@/components/app/LoadingScreen";
```

2. En la función `AuthGate`, reemplazar el div con "Cargando…":
```tsx
// antes:
  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
          Cargando…
        </div>
      </div>
    );
  }

// después:
  if (loading || !session) {
    return <LoadingScreen />;
  }
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npx tsc --noEmit 2>&1 | grep -E "error|LoadingScreen" | head -10
```

Esperado: sin errores.

- [ ] **Step 4: Commit loading screen**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
git add src/components/app/LoadingScreen.tsx src/routes/__root.tsx
git commit -m "feat: add LoadingScreen with Manim logo GIF"
```

---

### Task 4: Build y deploy

- [ ] **Step 1: Build de producción**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npm run build 2>&1 | tail -10
```

Esperado: `✓ built in XX.XXs` sin errores.

- [ ] **Step 2: Verificar que el GIF se sirve**

```bash
systemctl --user restart wealth-navigator
sleep 4
curl -s -o /dev/null -w "%{http_code}" https://wealthos.manidmt.es/logo-anim.gif
```

Esperado: `200`.

- [ ] **Step 3: Verificar rename en producción**

```bash
curl -s https://wealthos.manidmt.es | grep -o "Wealth OS\|Wealth Studio" | head -5
```

Esperado: solo aparece `Wealth OS`, nunca `Wealth Studio`.
