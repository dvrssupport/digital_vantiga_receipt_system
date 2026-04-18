do $$
begin
  alter type public.app_role add value if not exists 'admin';
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists username text,
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (
        username is null
        or username ~ '^[A-Za-z0-9_.-]{3,30}$'
      );
  end if;
end $$;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_identifier text := lower(trim(coalesce(p_identifier, '')));
  v_email text;
begin
  if v_identifier = '' then
    return null;
  end if;

  if position('@' in v_identifier) > 0 then
    return v_identifier;
  end if;

  select u.email
    into v_email
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where lower(p.username) = v_identifier
    and coalesce(p.is_active, true) = true
  limit 1;

  return v_email;
end;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated, service_role;
