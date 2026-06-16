# Logo Manim + Loading Screen + Rename — Wealth OS

**Date:** 2026-05-31  
**Scope:** Tres partes encadenadas: renombrar la app a "Wealth OS", generar el logo animado con Manim, y reemplazar la pantalla de carga genérica por un componente con el logo.

---

## Parte 1 — Rename: Wealth Studio → Wealth OS

Sustituir todas las apariciones de "Wealth Studio" / "Studio Assistant" por "Wealth OS" / "OS Assistant" en:

- `src/routes/__root.tsx` — títulos meta, og:title, manifest title
- `src/routes/assistant.tsx` — título de página (`Studio Assistant — Wealth Studio` → `Asistente — Wealth OS`), descripción, cabecera ("Studio Assistant" → "Asistente")
- `src/routes/expenses.tsx`, `net-worth.tsx`, `portfolio.tsx`, `index.tsx`, `settings.tsx`, `balances.tsx`, `planning.tsx` — `<title>` de cada ruta
- `src/routes/login.tsx` — texto "Wealth Studio" visible
- `src/components/app/AppSidebar.tsx` — nombre en la cabecera del sidebar
- `src/components/assistant/CommandBar.tsx` — sr-only title
- `src/components/app/BrandMark.tsx` — comentario JSDoc
- `public/manifest.json` — `name` y `short_name`
- `src/routes/settings.tsx` — nombres de archivo de descarga (`wealth-studio-` → `wealth-os-`)

---

## Parte 2 — Logo animado con Manim

### Script: `scripts/logo_anim.py`

- **Fondo**: `#0f172a` (mismo que el tema oscuro de la app)
- **Elemento**: "W" blanca dibujada como trazos SVG con la animación `Create` de Manim
- **Duración**: 2 segundos, sin música, sin texto adicional
- **Calidad**: `-ql` (low quality, suficiente para web) — resolución 512×512 o similar
- **Output**: `media/logo_anim/` → copiado a `public/logo-anim.gif`

### Icono estático actualizado

El frame final de la animación sirve de referencia visual para `public/icons/icon.svg` (ya existe, se mantiene tal cual — la animación es el complemento dinámico).

---

## Parte 3 — Loading Screen

### Componente: `src/components/app/LoadingScreen.tsx`

```
┌─ pantalla completa (min-h-screen), bg #0f172a ─────┐
│                                                     │
│   <img src="/logo-anim.gif" width=96 height=96 />  │
│   "Wealth OS"  (texto, fade-in con delay 0.3s)     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- Si el GIF falla o no ha cargado: fallback con el monograma "W" en CSS pulse (mismo div que el BrandMark actual)
- El componente se exporta y reemplaza el div "Cargando…" en `__root.tsx → AuthGate`

### Cuándo se muestra

- Mientras `loading === true` en `useAuth()` (sesión cargando desde Supabase)
- **No** durante la carga de datos del dashboard (esos tienen sus propios skeleton states)

---

## Archivos nuevos / modificados

| Archivo | Acción |
|---|---|
| `scripts/logo_anim.py` | Crear — script Manim |
| `public/logo-anim.gif` | Crear — output del script |
| `src/components/app/LoadingScreen.tsx` | Crear — componente loading |
| `src/routes/__root.tsx` | Modificar — usar LoadingScreen + rename |
| `public/manifest.json` | Modificar — rename |
| `src/routes/*.tsx` (8 archivos) | Modificar — rename en títulos |
| `src/components/app/AppSidebar.tsx` | Modificar — rename |
| `src/components/assistant/CommandBar.tsx` | Modificar — rename |
| `src/components/app/BrandMark.tsx` | Modificar — rename comentario |

---

## Notas de implementación

- Manim v0.20.1 está instalado en el sistema
- El GIF se genera una sola vez y se sube como asset estático a `public/`
- El script queda en `scripts/` para poder regenerar el logo en el futuro
- La animación de la "W" usa `VMobject` con puntos Bézier para reproducir el trazo exacto del carácter
