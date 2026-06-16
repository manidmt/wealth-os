# Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar todos los datos del proyecto Supabase de Lovable al proyecto propio del usuario en un único script idempotente, y apuntar la app al nuevo proyecto.

**Architecture:** Script TypeScript one-shot (`scripts/migrate-supabase.ts`) que autentica en ambos proyectos Supabase vía `signInWithPassword`, exporta las 5 tablas del proyecto viejo filtrando por user_id, sustituye el user_id viejo por el nuevo, e inserta vía upsert en el proyecto nuevo. El schema se aplica antes en el SQL Editor del dashboard. Al final se actualiza `.env` y se rebuildeea la app.

**Tech Stack:** TypeScript, @supabase/supabase-js (ya instalado), npx tsx (disponible vía npx).

---

## Archivos

- **Crear:** `scripts/migrate-supabase.ts` — script de migración one-shot
- **Modificar:** `.env` — cambiar URL y anon key al nuevo proyecto

---

### Task 1: Aplicar el schema SQL en el nuevo proyecto Supabase

**Files:** ninguno (acción manual en el dashboard de Supabase)

- [ ] **Step 1: Abrir el SQL Editor del nuevo proyecto**

Ir a `https://supabase.com/dashboard/project/<tu-proyecto>/sql` y ejecutar el siguiente bloque completo de una vez:

```sql
-- Enums
create type public.movement_type as enum ('income', 'expense');
create type public.asset_type as enum ('etf', 'stock', 'crypto', 'fund', 'bond', 'broker_cash', 'other');
create type public.app_role as enum ('admin', 'user');

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- user_roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

-- movements
create table public.movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type public.movement_type not null,
  category text not null,
  amount numeric not null,
  currency text not null default 'EUR',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- portfolio_positions
create table public.portfolio_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_name text not null,
  asset_type public.asset_type not null,
  platform text,
  quantity numeric not null,
  current_price numeric not null,
  avg_cost numeric not null default 0,
  currency text not null default 'EUR',
  isin text,
  ticker text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- monthly_snapshots
create table public.monthly_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  assets numeric not null default 0,
  liabilities numeric not null default 0,
  net_worth numeric not null default 0,
  savings numeric not null default 0,
  portfolio_value numeric not null default 0,
  notes text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, month)
);

-- investment_plans
create table public.investment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  asset_name text not null,
  rule_type text not null check (rule_type in ('fixed', 'pct_income', 'pct_savings', 'event')),
  amount numeric,
  percentage numeric,
  frequency text not null default 'monthly',
  return_pessimistic numeric not null default 3,
  return_base numeric not null default 7,
  return_optimistic numeric not null default 10,
  start_date date not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- plan_contributions
create table public.plan_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.investment_plans(id) on delete cascade,
  date date not null,
  planned_amount numeric not null,
  actual_amount numeric,
  created_at timestamptz not null default now(),
  unique(plan_id, date)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.movements enable row level security;
alter table public.portfolio_positions enable row level security;
alter table public.monthly_snapshots enable row level security;
alter table public.investment_plans enable row level security;
alter table public.plan_contributions enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own roles" on public.user_roles for select using (auth.uid() = user_id);
create policy "own movements" on public.movements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own positions" on public.portfolio_positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own snapshots" on public.monthly_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own plans" on public.investment_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own contributions" on public.plan_contributions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- has_role function
create or replace function public.has_role(_role public.app_role, _user_id uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

-- Trigger: crear perfil al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Verificar que las tablas se han creado**

En el SQL Editor del mismo proyecto, ejecutar:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

Expected output: 7 filas con `investment_plans`, `monthly_snapshots`, `movements`, `plan_contributions`, `portfolio_positions`, `profiles`, `user_roles`.

- [ ] **Step 3: Registrar la cuenta en el nuevo proyecto**

En el nuevo proyecto de Supabase, ir a **Authentication → Users → Invite user** o habilitar "Email signups" en **Authentication → Providers → Email** y registrarse desde `https://<nuevo-proyecto>.supabase.co` (o simplemente apuntar temporalmente la app al nuevo proyecto y hacer signup).

**Alternativa más rápida**: En el SQL Editor del nuevo proyecto:
```sql
-- Esto solo funciona si Email provider está habilitado con confirmación desactivada.
-- Si no, usar el dashboard de Auth → Add user manualmente con email manidmt5@gmail.com
```

Ir a **Authentication → Users → Add user** en el dashboard, introducir `manidmt5@gmail.com` y la contraseña, y guardar. El trigger creará automáticamente el perfil y el rol.

---

### Task 2: Escribir el script de migración

**Files:**
- Crear: `scripts/migrate-supabase.ts`

- [ ] **Step 1: Crear el script**

```typescript
// scripts/migrate-supabase.ts
// One-shot migration: Lovable Supabase → propio Supabase
// Run: OLD_URL=... OLD_KEY=... NEW_URL=... NEW_KEY=... EMAIL=... PASS=... npx tsx scripts/migrate-supabase.ts

import { createClient } from "@supabase/supabase-js";

const OLD_URL = process.env.OLD_URL!;
const OLD_KEY = process.env.OLD_KEY!;
const NEW_URL = process.env.NEW_URL!;
const NEW_KEY = process.env.NEW_KEY!;
const EMAIL = process.env.EMAIL!;
const PASS = process.env.PASS!;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY || !EMAIL || !PASS) {
  console.error("Missing env vars: OLD_URL OLD_KEY NEW_URL NEW_KEY EMAIL PASS");
  process.exit(1);
}

const oldClient = createClient(OLD_URL, OLD_KEY);
const newClient = createClient(NEW_URL, NEW_KEY);

async function signIn(client: ReturnType<typeof createClient>, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth failed: ${error.message}`);
  return data.user!.id;
}

async function fetchTable(client: ReturnType<typeof createClient>, table: string, userId: string) {
  const { data, error } = await (client as any).from(table).select("*").eq("user_id", userId);
  if (error) throw new Error(`Fetch ${table} failed: ${error.message}`);
  return data ?? [];
}

async function fetchProfiles(client: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await (client as any).from("profiles").select("*").eq("id", userId);
  if (error) throw new Error(`Fetch profiles failed: ${error.message}`);
  return data ?? [];
}

function substituteUserId<T extends Record<string, unknown>>(
  rows: T[],
  oldId: string,
  newId: string,
): T[] {
  return rows.map((row) => {
    const updated = { ...row };
    for (const key of Object.keys(updated)) {
      if (updated[key] === oldId) updated[key] = newId as unknown as T[typeof key];
    }
    return updated;
  });
}

async function upsertTable(
  client: ReturnType<typeof createClient>,
  table: string,
  rows: Record<string, unknown>[],
  conflictCol = "id",
) {
  if (rows.length === 0) { console.log(`  ${table}: 0 rows (skip)`); return; }
  const { error } = await (client as any).from(table).upsert(rows, { onConflict: conflictCol });
  if (error) throw new Error(`Upsert ${table} failed: ${error.message}`);
  console.log(`  ${table}: ${rows.length} rows ✓`);
}

async function main() {
  console.log("=== Wealth OS Supabase Migration ===\n");

  console.log("1. Authenticating in old project...");
  const oldUserId = await signIn(oldClient, EMAIL, PASS);
  console.log(`   Old user_id: ${oldUserId}`);

  console.log("\n2. Exporting data from old project...");
  const [profiles, roles, movements, positions, snapshots] = await Promise.all([
    fetchProfiles(oldClient, oldUserId),
    fetchTable(oldClient, "user_roles", oldUserId),
    fetchTable(oldClient, "movements", oldUserId),
    fetchTable(oldClient, "portfolio_positions", oldUserId),
    fetchTable(oldClient, "monthly_snapshots", oldUserId),
  ]);
  console.log(`   profiles: ${profiles.length}, roles: ${roles.length}, movements: ${movements.length}, positions: ${positions.length}, snapshots: ${snapshots.length}`);

  console.log("\n3. Authenticating in new project...");
  const newUserId = await signIn(newClient, EMAIL, PASS);
  console.log(`   New user_id: ${newUserId}`);

  console.log("\n4. Substituting user_id and inserting...");

  // profiles: conflict on id (= user_id for profiles)
  const newProfiles = substituteUserId(profiles as Record<string, unknown>[], oldUserId, newUserId).map(p => ({ ...p, id: newUserId }));
  await upsertTable(newClient, "profiles", newProfiles, "id");

  // user_roles: conflict on id
  await upsertTable(newClient, "user_roles", substituteUserId(roles as Record<string, unknown>[], oldUserId, newUserId), "id");

  // movements: conflict on id
  await upsertTable(newClient, "movements", substituteUserId(movements as Record<string, unknown>[], oldUserId, newUserId), "id");

  // portfolio_positions: conflict on id
  await upsertTable(newClient, "portfolio_positions", substituteUserId(positions as Record<string, unknown>[], oldUserId, newUserId), "id");

  // monthly_snapshots: conflict on (user_id, month)
  await upsertTable(newClient, "monthly_snapshots", substituteUserId(snapshots as Record<string, unknown>[], oldUserId, newUserId), "id");

  console.log("\n=== Migration complete ===");
  console.log(`Total: ${movements.length} movements, ${positions.length} positions, ${snapshots.length} snapshots`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit el script**

```bash
git add scripts/migrate-supabase.ts
git commit -m "feat: add one-shot Supabase migration script"
```

---

### Task 3: Ejecutar la migración

**Files:** ninguno (ejecución)

- [ ] **Step 1: Obtener credenciales del nuevo proyecto**

En el dashboard de Supabase del nuevo proyecto → **Settings → API**:
- `Project URL` → valor para `NEW_URL`
- `anon public` → valor para `NEW_KEY`

Credenciales del viejo (ya en `.env`):
- `OLD_URL=https://jywkkbmurlohupuyakmu.supabase.co`
- `OLD_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5d2trYm11cmxvaHVwdXlha211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkyMDQsImV4cCI6MjA5NDM0NTIwNH0.p6cWYG8MAsI1Xc2jfEkkB8hPVsBMMiOcU2J_yk2Asns`

- [ ] **Step 2: Correr el script**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator

OLD_URL="https://jywkkbmurlohupuyakmu.supabase.co" \
OLD_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5d2trYm11cmxvaHVwdXlha211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkyMDQsImV4cCI6MjA5NDM0NTIwNH0.p6cWYG8MAsI1Xc2jfEkkB8hPVsBMMiOcU2J_yk2Asns" \
NEW_URL="<PEGAR_AQUI>" \
NEW_KEY="<PEGAR_AQUI>" \
EMAIL="manidmt5@gmail.com" \
PASS="<TU_PASSWORD>" \
npx tsx scripts/migrate-supabase.ts
```

Expected output:
```
=== Wealth OS Supabase Migration ===

1. Authenticating in old project...
   Old user_id: <uuid-viejo>

2. Exporting data from old project...
   profiles: 1, roles: 1, movements: N, positions: M, snapshots: K

3. Authenticating in new project...
   New user_id: <uuid-nuevo>

4. Substituting user_id and inserting...
  profiles: 1 rows ✓
  user_roles: 1 rows ✓
  movements: N rows ✓
  portfolio_positions: M rows ✓
  monthly_snapshots: K rows ✓

=== Migration complete ===
Total: N movements, M positions, K snapshots
```

- [ ] **Step 3: Verificar datos en el nuevo proyecto**

En el SQL Editor del nuevo proyecto:

```sql
select
  (select count(*) from movements) as movements,
  (select count(*) from portfolio_positions) as positions,
  (select count(*) from monthly_snapshots) as snapshots,
  (select count(*) from profiles) as profiles;
```

Los conteos deben coincidir con el output del script.

---

### Task 4: Cutover — apuntar la app al nuevo proyecto

**Files:**
- Modificar: `.env`

- [ ] **Step 1: Actualizar `.env`**

Reemplazar en `.env`:
```
VITE_SUPABASE_URL="<NEW_URL>"
VITE_SUPABASE_PUBLISHABLE_KEY="<NEW_ANON_KEY>"
```

- [ ] **Step 2: Build y restart**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npm run build 2>&1 | tail -5
systemctl --user restart wealth-navigator
sleep 3
curl -sI http://localhost:8090/ | head -3
```

Expected: `HTTP/1.1 200`

- [ ] **Step 3: Verificar login y datos en producción**

Abrir `https://wealthos.manidmt.es` en el navegador:
1. Login con `manidmt5@gmail.com`
2. Verificar que aparecen los movimientos históricos
3. Verificar que el portfolio tiene las posiciones correctas
4. Verificar que el dashboard muestra el patrimonio correcto

- [ ] **Step 4: Commit final**

```bash
git add .env
git commit -m "chore: switch to own Supabase project"
```
