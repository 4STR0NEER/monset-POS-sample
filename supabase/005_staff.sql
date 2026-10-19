-- =====================================================================
-- 005  Staff management. Safe to re-run.
-- Accounts are created by the server function api/staff.js (it holds
-- the service-role key); this patch covers what the browser needs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. staff_list (admin only): everyone with their login email and when
-- they last signed in. Emails live in auth.users, which the browser
-- can't read directly.
-- ---------------------------------------------------------------------
create or replace function public.staff_list()
returns table (id uuid, email text, full_name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage staff';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.created_at, u.last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by case p.role when 'admin' then 0 when 'staff' then 1 else 2 end, p.full_name;
end $$;

revoke all on function public.staff_list() from public, anon;
grant execute on function public.staff_list() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Never lose the last admin: refuse any change that would leave the
-- gym with no admin to manage it.
-- ---------------------------------------------------------------------
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'There must always be at least one admin';
  end if;
  return new;
end $$;

drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin
  before update of role on public.profiles
  for each row execute function public.keep_one_admin();

-- ---------------------------------------------------------------------
-- 3. Admins edit names and roles only, nothing else on a profile.
-- ---------------------------------------------------------------------
revoke update on public.profiles from authenticated, anon;
grant update (full_name, role) on public.profiles to authenticated;

-- Tell the Supabase API about new or changed functions right away.
notify pgrst, 'reload schema';
