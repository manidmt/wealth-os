# Supabase Migration Design — Lovable → Propio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrar todos los datos del proyecto Supabase de Lovable al proyecto propio del usuario, sin pérdida de datos y con zero downtime (la app vieja sigue funcionando hasta el cutover final).

**Architecture:** Script TypeScript one-shot que autentica en ambos proyectos, exporta los datos del viejo, sustituye el user_id, e inserta en el nuevo. El schema se aplica manualmente vía SQL Editor antes de correr el script.

**Tech Stack:** TypeScript + @supabase/supabase-js, tsx (runner), Supabase SQL Editor para schema.

---

## Datos a migrar

| Tabla | Descripción |
|---|---|
| `movements` | Ingresos y gastos (la tabla más importante) |
| `portfolio_positions` | Posiciones de inversión actuales |
| `monthly_snapshots` | Cierres mensuales históricos |
| `profiles` | Perfil del usuario |
| `user_roles` | Rol del usuario (admin/user) |

Tablas **solo en nuevo proyecto** (no existen en el viejo):
- `investment_plans` — DCA y estrategias de inversión
- `plan_contributions` — Aportaciones registradas por plan

## Constraint clave

Solo se dispone de la **anon key** del proyecto viejo (no service_role). El script autentica como el usuario (`manidmt5@gmail.com`) para leer sus datos vía RLS. Esto es suficiente porque es una app monousuario y todas las tablas tienen RLS `user_id = auth.uid()`.

El **user_id UUID cambia** entre proyectos (Supabase genera UUIDs distintos). El script detecta ambos UUIDs y sustituye en todos los registros.

---

## Schema SQL para el nuevo proyecto

### Enums

```sql
create type public.movement_type as enum ('income', 'expense');
create type public.asset_type as enum ('etf', 'stock', 'crypto', 'fund', 'bond', 'broker_cash', 'other');
create type public.app_role as enum ('admin', 'user');
```

### Tablas

```sql
-- profiles (espejo de auth.users, se crea via trigger)
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

-- investment_plans (nuevo, no existe en viejo)
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

-- plan_contributions (nuevo, no existe en viejo)
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
```

### RLS Policies

```sql
-- Habilitar RLS en todas las tablas
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.movements enable row level security;
alter table public.portfolio_positions enable row level security;
alter table public.monthly_snapshots enable row level security;
alter table public.investment_plans enable row level security;
alter table public.plan_contributions enable row level security;

-- profiles
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- user_roles
create policy "Users can view own role" on public.user_roles for select using (auth.uid() = user_id);

-- movements
create policy "Users manage own movements" on public.movements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- portfolio_positions
create policy "Users manage own positions" on public.portfolio_positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- monthly_snapshots
create policy "Users manage own snapshots" on public.monthly_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- investment_plans
create policy "Users manage own plans" on public.investment_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- plan_contributions
create policy "Users manage own contributions" on public.plan_contributions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### Función has_role + trigger de profiles

```sql
-- Función has_role
create or replace function public.has_role(_role public.app_role, _user_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- Trigger: crear perfil automáticamente al registrarse
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

---

## Script de migración

Archivo: `scripts/migrate-supabase.ts`

Lógica:
1. Leer credenciales de env vars (`OLD_URL`, `OLD_ANON_KEY`, `NEW_URL`, `NEW_ANON_KEY`, `USER_EMAIL`, `USER_PASSWORD`)
2. `signInWithPassword` en proyecto viejo → obtener `oldUserId`
3. Exportar todas las tablas filtrando por `user_id = oldUserId`
4. `signInWithPassword` en proyecto nuevo → obtener `newUserId`
5. Sustituir `oldUserId` → `newUserId` en todos los registros
6. Insertar en este orden: `profiles` → `user_roles` → `movements` → `portfolio_positions` → `monthly_snapshots`
7. Imprimir resumen con conteo por tabla

El script es idempotente: usa `upsert` en vez de `insert`, por si hay que re-ejecutarlo.

---

## Cutover

Una vez verificados los datos en el nuevo proyecto:
1. Cambiar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env`
2. `npm run build`
3. `systemctl --user restart wealth-navigator`
4. Verificar login y datos en producción

---

## Archivos afectados

| Archivo | Acción |
|---|---|
| `scripts/migrate-supabase.ts` | Crear (script one-shot) |
| `.env` | Modificar (nuevas credenciales al final) |
| SQL Editor Supabase nuevo proyecto | Aplicar schema manualmente |
