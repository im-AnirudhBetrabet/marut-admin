-- MARUT Admin Release 1 — Authentication + User Management
-- This migration is designed for a NEW/EMPTY MARUT Supabase project.
-- It does not create Auth users.

begin;
create extension if not exists pgcrypto;

do $$ begin create type public.admin_role as enum ('owner','staff');
exception when duplicate_object then null; end $$;
do $$ begin create type public.admin_permission_level as enum ('view','manage');
exception when duplicate_object then null; end $$;
do $$ begin create type public.admin_invitation_status as enum ('sending','pending','accepted','expired','failed','revoked');
exception when duplicate_object then null; end $$;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null unique,
  display_name text,
  role public.admin_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create table if not exists public.admin_user_permissions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  module_key text not null check (module_key in ('users','verticals','products','pricing','catalogue','leads','analytics')),
  level public.admin_permission_level not null,
  created_at timestamptz not null default now(),
  unique (admin_user_id,module_key)
);

create table if not exists public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text,
  role public.admin_role not null default 'staff',
  invited_by uuid references public.admin_users(id) on delete set null,
  status public.admin_invitation_status not null default 'sending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_invitations_email_status_idx on public.admin_invitations(lower(email),status);
create index if not exists admin_invitations_expiry_idx on public.admin_invitations(expires_at) where status='pending';

create table if not exists public.admin_invitation_permissions (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.admin_invitations(id) on delete cascade,
  module_key text not null check (module_key in ('users','verticals','products','pricing','catalogue','leads','analytics')),
  level public.admin_permission_level not null,
  created_at timestamptz not null default now(),
  unique (invitation_id,module_key)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at before update on public.admin_users
for each row execute function public.set_updated_at();
drop trigger if exists trg_admin_invitations_updated_at on public.admin_invitations;
create trigger trg_admin_invitations_updated_at before update on public.admin_invitations
for each row execute function public.set_updated_at();

-- Serialize owner status changes so concurrent updates cannot remove the last active owner.
create or replace function public.guard_last_active_owner()
returns trigger language plpgsql security definer set search_path=public as $$
declare remaining integer;
begin
  perform pg_advisory_xact_lock(hashtext('marut_admin_active_owner_guard'));
  if tg_op='DELETE' then
    if old.role='owner' and old.is_active then
      select count(*) into remaining from public.admin_users
      where role='owner' and is_active and id<>old.id;
      if remaining=0 then raise exception 'LAST_ACTIVE_OWNER'; end if;
    end if;
    return old;
  end if;

  if old.role='owner' and old.is_active and (new.role<>'owner' or not new.is_active) then
    select count(*) into remaining from public.admin_users
    where role='owner' and is_active and id<>old.id;
    if remaining=0 then raise exception 'LAST_ACTIVE_OWNER'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_last_active_owner_update on public.admin_users;
create trigger trg_guard_last_active_owner_update before update of is_active,role on public.admin_users
for each row execute function public.guard_last_active_owner();
drop trigger if exists trg_guard_last_active_owner_delete on public.admin_users;
create trigger trg_guard_last_active_owner_delete before delete on public.admin_users
for each row execute function public.guard_last_active_owner();

-- One-time first-owner bootstrap. This function succeeds only while admin_users is empty.
-- It validates the supplied identity against auth.users and serializes concurrent attempts.
create or replace function public.bootstrap_first_admin_owner(
  p_auth_user_id uuid,
  p_email text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare auth_email text;
        created_admin public.admin_users%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('marut_admin_first_owner_bootstrap'));
  if exists (select 1 from public.admin_users) then
    raise exception 'INITIAL_OWNER_ALREADY_BOOTSTRAPPED';
  end if;

  select lower(email) into auth_email
  from auth.users
  where id = p_auth_user_id;

  if auth_email is null or auth_email <> lower(trim(p_email)) then
    raise exception 'AUTH_USER_ID_EMAIL_MISMATCH';
  end if;

  insert into public.admin_users(auth_user_id,email,display_name,role,is_active)
  values(p_auth_user_id,auth_email,nullif(trim(p_display_name),''),'owner',true)
  returning * into created_admin;

  return jsonb_build_object(
    'id',created_admin.id,
    'auth_user_id',created_admin.auth_user_id,
    'email',created_admin.email,
    'display_name',created_admin.display_name,
    'role',created_admin.role,
    'is_active',created_admin.is_active
  );
end $$;

revoke all on function public.bootstrap_first_admin_owner(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_first_admin_owner(uuid,text,text) to service_role;

-- Atomically create the active profile, copy immutable invitation grants, and accept invitation.
-- Express must first verify the Supabase access token via auth.getUser and pass the verified identity.
create or replace function public.accept_admin_invitation(p_invitation_id uuid,p_auth_user_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare inv public.admin_invitations%rowtype;
        created_admin public.admin_users%rowtype;
begin
  select * into inv from public.admin_invitations where id=p_invitation_id for update;
  if not found then raise exception 'INVITATION_NOT_FOUND'; end if;
  if inv.status<>'pending' then raise exception 'INVITATION_NOT_PENDING'; end if;
  if inv.expires_at<=now() then
    update public.admin_invitations set status='expired' where id=inv.id;
    return jsonb_build_object('error','INVITATION_EXPIRED');
  end if;
  if inv.auth_user_id is distinct from p_auth_user_id or lower(inv.email)<>lower(p_email) then
    raise exception 'INVITATION_IDENTITY_MISMATCH';
  end if;

  insert into public.admin_users(auth_user_id,email,display_name,role,is_active)
  values(p_auth_user_id,lower(inv.email),inv.display_name,inv.role,true)
  returning * into created_admin;

  if inv.role='staff' then
    insert into public.admin_user_permissions(admin_user_id,module_key,level)
    select created_admin.id,module_key,level from public.admin_invitation_permissions
    where invitation_id=inv.id;
  end if;
  update public.admin_invitations set status='accepted',accepted_at=now() where id=inv.id;
  return jsonb_build_object('id',created_admin.id,'email',created_admin.email,
    'display_name',created_admin.display_name,'role',created_admin.role,'is_active',created_admin.is_active);
end $$;

revoke all on function public.accept_admin_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_admin_invitation(uuid,uuid,text) to service_role;

alter table public.admin_users enable row level security;
alter table public.admin_user_permissions enable row level security;
alter table public.admin_invitations enable row level security;
alter table public.admin_invitation_permissions enable row level security;
revoke all on public.admin_users from anon,authenticated;
revoke all on public.admin_user_permissions from anon,authenticated;
revoke all on public.admin_invitations from anon,authenticated;
revoke all on public.admin_invitation_permissions from anon,authenticated;
grant usage on schema public to service_role;
grant all on public.admin_users,public.admin_user_permissions,public.admin_invitations,public.admin_invitation_permissions to service_role;
commit;
