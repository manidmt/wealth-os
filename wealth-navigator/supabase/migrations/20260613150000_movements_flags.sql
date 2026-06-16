alter table public.movements
  add column if not exists excluded boolean not null default false,
  add column if not exists duplicate_of uuid references public.movements(id) on delete set null;
