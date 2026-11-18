
-- MARUT Admin V2
-- Migration: 0003_admin_user_management.sql
--
-- Adds atomic permission replacement and Staff-to-Owner promotion.

-- ---------------------------------------------------------------------------
-- Replace a Staff user's complete permission set atomically.
-- ---------------------------------------------------------------------------

create or replace function public.replace_admin_user_permissions(
  p_admin_user_id uuid,
  p_permissions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role public.admin_role;
  v_permission_count integer;
  v_distinct_count integer;
begin
  if jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'INVALID_PERMISSIONS';
  end if;

  select role
    into v_target_role
    from public.admin_users
   where id = p_admin_user_id
   for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_target_role = 'owner' then
    raise exception 'OWNER_PERMISSIONS_IMPLICIT';
  end if;

  select count(*), count(distinct item->>'module_key')
    into v_permission_count, v_distinct_count
    from jsonb_array_elements(p_permissions) as item;

  if v_permission_count <> v_distinct_count then
    raise exception 'DUPLICATE_PERMISSION_MODULE';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_permissions) as item
     where coalesce(item->>'module_key', '') = ''
        or coalesce(item->>'level', '') not in ('view', 'manage')
  ) then
    raise exception 'INVALID_PERMISSION_VALUE';
  end if;

  -- The enum cast also rejects module keys outside the approved registry.
  delete from public.admin_user_permissions
   where admin_user_id = p_admin_user_id;

  insert into public.admin_user_permissions (
    admin_user_id,
    module_key,
    level
  )
  select
    p_admin_user_id,
    (item->>'module_key')::public.admin_module,
    (item->>'level')::public.admin_permission_level
  from jsonb_array_elements(p_permissions) as item;
end;
$$;


-- ---------------------------------------------------------------------------
-- Promote a Staff account to Owner atomically.
-- Owner permissions are implicit, so remove any residual permission rows.
-- ---------------------------------------------------------------------------

create or replace function public.promote_admin_user_to_owner(
  p_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role public.admin_role;
begin
  select role
    into v_target_role
    from public.admin_users
   where id = p_admin_user_id
   for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_target_role = 'owner' then
    raise exception 'USER_ALREADY_OWNER';
  end if;

  delete from public.admin_user_permissions
   where admin_user_id = p_admin_user_id;

  update public.admin_users
     set role = 'owner'
   where id = p_admin_user_id;
end;
$$;


-- Only the backend service role may execute these functions.
revoke all on function public.replace_admin_user_permissions(uuid, jsonb)
  from public, anon, authenticated;

revoke all on function public.promote_admin_user_to_owner(uuid)
  from public, anon, authenticated;

grant execute on function public.replace_admin_user_permissions(uuid, jsonb)
  to service_role;

grant execute on function public.promote_admin_user_to_owner(uuid)
  to service_role;
