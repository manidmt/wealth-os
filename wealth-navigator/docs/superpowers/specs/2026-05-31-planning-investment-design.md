# Planificación de Inversión (DCA) — Wealth Studio

**Date:** 2026-05-31  
**Scope:** Nueva ruta `/planning` para definir planes de inversión DCA/semi-pasiva, hacer seguimiento real vs planificado y visualizar proyecciones a largo plazo.  
**Out of scope:** Planificación económica personal (presupuestos), integración con el agente (segunda iteración), auto-detección de aportaciones desde movimientos.

---

## Objetivo

Permitir a cada usuario definir uno o varios planes de inversión (ej. "DCA MSCI World", "Estrategia semi-pasiva en Oro"), configurar la regla de aportación, registrar lo que realmente aporta cada mes y ver proyecciones a 5/10/20 años con tres escenarios de rentabilidad.

---

## Modelo de datos (Supabase)

Dos tablas nuevas con RLS por `user_id`, portables a cualquier proyecto Supabase mediante `pg_dump`.

### `investment_plans`

| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| name | text | Nombre del plan (ej. "DCA MSCI World") |
| asset_name | text | Activo destino (texto libre, no FK) |
| rule_type | text | `fixed` \| `pct_income` \| `pct_savings` \| `event` |
| amount | numeric nullable | Importe fijo en € (si rule_type = fixed) |
| percentage | numeric nullable | % a aportar (si rule_type = pct_income \| pct_savings) |
| frequency | text | `monthly` \| `quarterly` |
| return_pessimistic | numeric | % anual esperado escenario pesimista (ej. 3) |
| return_base | numeric | % anual esperado escenario base (ej. 7) |
| return_optimistic | numeric | % anual esperado escenario optimista (ej. 10) |
| start_date | date | Inicio del plan |
| active | boolean | Si el plan está activo |
| notes | text nullable | Notas libres |

### `plan_contributions`

| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| plan_id | uuid FK → investment_plans | |
| date | date | Mes de la aportación (primer día del mes) |
| planned_amount | numeric | Calculado en el momento del registro |
| actual_amount | numeric nullable | Lo que realmente se aportó (registro manual) |

---

## Rutas y UI

### Nueva ruta: `/planning`

Añadida al sidebar de `AppShell` entre Portfolio y Asistente.

**Estructura de página:**

```
PageHeader: "Planificación" / eyebrow "Inversión" / action [+ Nuevo plan]

┌── Mis planes ──────────────────────────────────────┐
│  Una card por plan activo:                          │
│  · Nombre + activo destino                          │
│  · Regla: "300 €/mes" | "20% ingresos" | ...       │
│  · Progreso mes actual: planificado vs aportado     │
│  · Botones: [Registrar aportación]  [Editar]        │
└────────────────────────────────────────────────────┘

┌── Proyección ──────────────────────────────────────┐
│  Selector de plan (dropdown si hay varios)          │
│  Gráfica Recharts — 3 curvas:                       │
│    · Pesimista / Base / Optimista                   │
│  Toggle horizonte: 5 / 10 / 20 años                │
└────────────────────────────────────────────────────┘

┌── Historial de aportaciones ───────────────────────┐
│  Tabla: mes | planificado | real | desviación       │
│  Desviación: verde si ≥ 0, rojo si negativo         │
└────────────────────────────────────────────────────┘
```

**Modal "Nuevo plan / Editar plan":** formulario con todos los campos de `investment_plans`.

**Modal "Registrar aportación":** selector de mes + campo importe real → crea/actualiza `plan_contributions`.

---

## Lógica de cálculo (cliente TypeScript)

### Importe planificado por mes según `rule_type`

- `fixed` → `amount`
- `pct_income` → `income_that_month × percentage / 100` (de movimientos Supabase)
- `pct_savings` → `(income − expenses)_that_month × percentage / 100`
- `event` → el usuario introduce el importe al registrar manualmente

### Proyección — interés compuesto con aportaciones periódicas

```
valor[0] = 0
para cada mes hasta horizonte:
  valor[mes] = valor[mes-1] × (1 + tasa_anual/12) + aportacion_mensual
```

Se ejecuta 3 veces (pessimistic / base / optimistic). La `aportacion_mensual` se calcula con la regla del plan; para `pct_income` / `pct_savings` se usa la media de los últimos 6 meses reales como estimación. Para planes trimestrales (`frequency = quarterly`) se usa `amount / 3` como aportación mensual equivalente en la proyección (simplificación razonable para el gráfico).

### Desviación en historial

`desviacion = actual_amount - planned_amount`  
Verde si ≥ 0, rojo si negativo.

---

## Archivos nuevos / modificados

| Archivo | Acción |
|---|---|
| `src/routes/planning.tsx` | Nueva ruta + página completa |
| `src/lib/planning-api.ts` | Hooks Supabase para plans y contributions |
| `src/lib/planning-calc.ts` | Lógica de proyección y cálculo de importes |
| `src/components/app/AppShell.tsx` | Añadir "Planificación" al sidebar |
| Supabase | Crear tablas `investment_plans` y `plan_contributions` con RLS |

---

## Consideraciones de migración

Las tablas son PostgreSQL estándar. Cuando el proyecto Supabase se migre a cuenta propia, basta con `pg_dump --data-only` de estas tablas y reimportar en el nuevo proyecto. El código no cambia — solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env`.
