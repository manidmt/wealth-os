
-- Fix set_updated_at search_path
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Lock down SECURITY DEFINER functions: only triggers / postgres should call them
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.set_updated_at() from anon, authenticated, public;
revoke execute on function public.has_role(uuid, public.app_role) from anon, public;
-- has_role still callable by authenticated users (used by future RLS policies)
