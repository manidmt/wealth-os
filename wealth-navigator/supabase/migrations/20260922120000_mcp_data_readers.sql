-- Lectores autorizados: permiten dar acceso de SOLO LECTURA a los datos de un usuario
-- sin compartir su sesión (que sí puede escribir y borrar). Lo usa el servidor MCP.

create table public.data_readers (
  reader_id  uuid not null references auth.users(id) on delete cascade,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  label      text,
  created_at timestamptz not null default now(),
  primary key (reader_id, owner_id)
);

alter table public.data_readers enable row level security;

-- El lector necesita poder leer sus propias concesiones: las políticas de abajo
-- consultan esta tabla con su propia sesión, así que RLS también se les aplica.
create policy "Data readers: reader can view own grants"
  on public.data_readers for select to authenticated
  using (auth.uid() = reader_id);

-- Políticas SOLO de lectura. Al no crear insert/update/delete para el lector,
-- RLS (que deniega por defecto) le impide escribir. Las políticas son permisivas
-- y se combinan con OR: las del dueño siguen intactas.
create policy "Movements: granted readers can view"
  on public.movements for select to authenticated
  using (exists (
    select 1 from public.data_readers r
    where r.reader_id = auth.uid() and r.owner_id = movements.user_id
  ));

create policy "Portfolio positions: granted readers can view"
  on public.portfolio_positions for select to authenticated
  using (exists (
    select 1 from public.data_readers r
    where r.reader_id = auth.uid() and r.owner_id = portfolio_positions.user_id
  ));
