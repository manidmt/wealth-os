# Importación bancaria robusta y bank-agnóstica — Design

**Date:** 2026-06-13
**Scope:** Hacer la importación de movimientos (Enable Banking) definitiva y no dependiente del formato de un banco: categorización en dos capas (MCC estándar + LLM de respaldo), exclusión de movimientos que no son gastos, detección de duplicados contra gastos manuales, y aprovechar que los importados ya son editables/borrables y van al mes correcto.
**Out of scope:** autodetección de traspasos internos (solo toggle manual), categorización de inversiones, reglas de categoría editables desde UI.

## Decisiones (brainstorming aprobado)
- Categorizador: **MCC → LLM (gpt-4o-mini) → "Sin categoría"**. Key de OpenAI ya disponible en `/tmp/wealth-agent/.env` (`OPENAI_API_KEY`), se copia a un secret de Supabase.
- Duplicados vs manuales: **marcar para revisión** (nunca borrar solo); excluidos de totales hasta resolver.
- Traspasos internos: **toggle manual "no contabilizar"** (sin autodetección).
- Los 96 importados de la POC: **ya borrados**; `last_synced_at` de BBVA reseteado para reimportar limpio.

---

## 1. Base de datos — `supabase/migrations/20260613150000_movements_flags.sql`

```sql
alter table public.movements
  add column if not exists excluded boolean not null default false,
  add column if not exists duplicate_of uuid references public.movements(id) on delete set null;
```

- `excluded`: el movimiento existe pero **no cuenta** en los totales de gastos/ingresos (traspasos, duplicados pendientes, lo que el usuario marque).
- `duplicate_of`: si un importado parece duplicar un manual, apunta al id del manual sospechoso (para la lista de revisión). Al detectarse, el importado se crea con `excluded = true` (no descuadra).

---

## 2. Mapa MCC — `supabase/functions/_shared/mcc-categories.ts` (puro, testeable)

MCC (ISO 18245, lo da Enable Banking para cualquier banco) → categoría de la app. Devuelve `null` si el MCC es ambiguo o desconocido (cae a la capa LLM).

```typescript
export function categoryFromMcc(mcc: string | null | undefined): string | null;
```

**Mapa (representativo; el completo vive en el fichero):**
| MCC | Categoría |
|---|---|
| 5411, 5422, 5451, 5462, 5499 | Comida |
| 5811, 5812, 5814 | Comer fuera |
| 5813 | Ocio |
| 4111, 4112, 4121, 4131, 4789 | Transporte |
| 5541, 5542, 7523, 7538 | Coche |
| 4511, 7011, 4722, 7512 | Viaje |
| 5912, 8011, 8021, 8062, 8043 | Salud |
| 7997, 7941 | Gimnasio |
| 5940, 5941 | Deporte |
| 5611, 5621, 5651, 5691, 5699 | Ropa |
| 5045, 5732, 5734, 7372 | Tecnología |
| 4899, 5815, 5816, 5817, 5818 | Suscripciones |
| 4814, 4900 | Hogar |
| 7832, 7922, 7929, 7996 | Ocio |
| 8220, 8211, 8241, 8299 | Educación |
| 9311, 9222, 9399 | Impuestos |
| 7230, 7298, 5977 | Cuidado personal |
| 5942 | Educación |
| 5947 | Regalo |

Ambiguos (5999 retail, 6011 cajero, 4829 transferencias, etc.) → `null` → LLM.

---

## 3. Clasificador LLM — `supabase/functions/_shared/llm-classify.ts`

Llama a OpenAI `gpt-4o-mini` **por lotes** (una llamada por sync para todas las pendientes). Función con I/O (no pura); el constructor de prompt y el parser se extraen como helpers puros testeables.

```typescript
// helpers puros (testeables):
export function buildClassifyPrompt(items: { id: string; description: string }[], categories: string[]): string;
export function parseClassifyResponse(raw: string, validCategories: string[], ids: string[]): Record<string, string>;
// (cae a "Sin categoría" cualquier id ausente o categoría inválida)

// con I/O:
export async function classifyBatch(
  items: { id: string; description: string }[],
  categories: string[],
): Promise<Record<string, string>>;
```

**Prompt:** sistema = "Eres un clasificador de gastos. Asigna cada movimiento a EXACTAMENTE una de estas categorías: [lista]. Responde solo JSON `{id: categoria}`. Si dudas, elige la más probable; nunca inventes categorías." Usuario = JSON de `{id, description}`. `response_format: json_object`, `temperature: 0`. Se le pasan las categorías reales (`EXPENSE_CATEGORIES`/`INCOME_CATEGORIES` según el tipo). El parser valida que la categoría devuelta esté en la lista; si no, "Sin categoría".

Secret: `OPENAI_API_KEY`. Si la llamada falla (red/límite), las filas quedan "Sin categoría" (degradación elegante; el usuario las ve y categoriza a mano).

---

## 4. Mapeo y pipeline en las Edge Functions

`EbTransaction` (en `bank-mapping.ts`) gana `merchant_category_code?: string | null`. `mapTransaction` deja de usar palabras clave y categoriza **solo por MCC** (síncrono): `category = categoryFromMcc(tx.merchant_category_code) ?? "Sin categoría"`. Se elimina la dependencia de `categorize.ts` (palabras clave) del path de import — fue la causa de los falsos positivos (Uber→Hogar por "ALQUILER").

En `bank-callback` / `bank-sync` / `bank-sync-all`, por conexión:
1. `getAllTransactions` → filtrar `isBooked` + con id.
2. `mapTransaction` (categoría por MCC).
3. **Detección de duplicados**: cargar los movimientos manuales del usuario (`external_id is null`) en el rango de fechas; para cada importado, buscar match (`amount` igual, `type` igual, `|date − date_manual| ≤ 3 días`). Si hay match → `duplicate_of = id_manual`, `excluded = true`.
4. **Capa LLM**: agrupar las filas con `category === "Sin categoría"`, `classifyBatch(...)` con la lista de categorías del tipo correspondiente → asignar.
5. **Upsert** en `movements` (onConflict `external_id`, ignoreDuplicates) con los campos nuevos.
6. **Surfacing de errores**: si el upsert falla, registrar en `bank_connections.error_message` y reflejarlo en la respuesta (arreglar el *swallow* silencioso que ocultó el bug del índice). El contador `inserted` solo cuenta éxitos reales.

---

## 5. Totales — excluir `excluded`

En el cómputo de gastos/ingresos (`src/lib/dashboard-data.ts`, función que agrega por mes) y en cualquier suma de movimientos, **saltarse las filas `excluded = true`**. Las filas excluidas siguen visibles en la lista del mes pero con estilo atenuado y sin sumar.

---

## 6. Frontend

- **`movements-api.ts`**: `MovementRecord` gana `excluded: boolean` y `duplicate_of: string | null`. `useUpdateMovement` admite `excluded`. Las queries de lista incluyen ambos campos.
- **`AddMovementSheet`**: nuevo switch **"No contabilizar"** (bind a `excluded`). El resto (importe, categoría, descripción, fecha, borrar) ya existe.
- **Página de Gastos (`expenses.tsx`)**:
  - Las filas `excluded` se muestran atenuadas con un badge "No cuenta".
  - **Sección/aviso "Revisar duplicados"**: lista las filas importadas con `duplicate_of` no nulo, mostrando el importado vs el manual sospechoso, con acciones: **Borrar importado** (queda el manual), **Borrar manual** (queda el importado y se limpia su flag + `excluded=false`), o **No es duplicado** (limpia `duplicate_of` y pone `excluded=false` → pasa a contar).
- Sin emojis.

---

## 7. Limpieza y reimport
- Los 96 de la POC: borrados (hecho).
- Tras desplegar el sistema nuevo: re-sync de BBVA (con `last_synced_at` ya en null → trae 90 días) y verificar categorización (MCC+LLM), duplicados marcados, totales sin descuadre.

---

## 8. Secrets / prerequisitos
- `OPENAI_API_KEY` (de `/tmp/wealth-agent/.env`) → `npx supabase secrets set OPENAI_API_KEY=...`. (El controlador lo hace sin exponerlo.)
- Redeploy de las 3 funciones de sync tras los cambios.

---

## 9. Testing
- **`categoryFromMcc`** (Vitest): MCCs representativos → categoría; ambiguo/desconocido → null.
- **`buildClassifyPrompt`/`parseClassifyResponse`** (Vitest): el prompt incluye las categorías e ids; el parser valida categorías inexistentes → "Sin categoría", ids faltantes → "Sin categoría", JSON malformado → todo "Sin categoría".
- **Detección de duplicados** (helper puro `findDuplicate(imported, manuals)`): match por importe+tipo+fecha±3d; sin match → null; no casa contra filas con external_id.
- **E2E** (tras deploy): re-sync BBVA → la mayoría categorizada por MCC/LLM, pocos "Sin categoría"; un gasto que ya tenías manual aparece marcado como posible duplicado y excluido de totales; marcar uno "no contabilizar" lo saca del total del mes; editar importe/categoría/fecha de un importado funciona; el mes es correcto.

## 10. Riesgos
- gpt-4o-mini: coste mínimo (lotes), pero depende de red; fallback "Sin categoría".
- `/tmp/wealth-agent/.env` es efímero (/tmp); por eso la key se copia a un secret de Supabase (no se depende del fichero).
- Detección de duplicados por importe+fecha puede dar falsos positivos (dos gastos iguales el mismo día) → por eso solo marca para revisión y excluye temporalmente, nunca borra.
- MCC ausente en transferencias/Bizum/recibos → esos caen al LLM (que es justo donde aporta).
