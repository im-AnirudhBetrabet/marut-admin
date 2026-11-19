-- MARUT Admin Release 1 — Vertical Management
-- Migration: 0005_vertical_management.sql

begin;

do $$
begin
  create type public.business_vertical_status as enum (
    'proposed', 'under_planning', 'setup_in_progress',
    'operational', 'temporarily_suspended', 'closed'
  );
exception when duplicate_object then null;
end
$$;

create table if not exists public.business_verticals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  description text,
  status public.business_vertical_status not null default 'proposed',
  created_at timestamptz not null default now(),
  created_by uuid null references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.admin_users(id) on delete set null,
  constraint business_verticals_name_nonempty check (length(btrim(name)) > 0),
  constraint business_verticals_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,31}$')
);

create unique index if not exists business_verticals_code_uidx
  on public.business_verticals(code);
create index if not exists business_verticals_status_idx
  on public.business_verticals(status);

create table if not exists public.business_vertical_status_history (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid null references public.business_verticals(id) on delete set null,
  vertical_code_snapshot text not null,
  vertical_name_snapshot text not null,
  previous_status public.business_vertical_status not null,
  new_status public.business_vertical_status not null,
  reason text not null,
  changed_by uuid null references public.admin_users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint business_vertical_status_history_reason_nonempty check (length(btrim(reason)) > 0),
  constraint business_vertical_status_history_status_changed check (previous_status <> new_status)
);

create index if not exists business_vertical_status_history_vertical_idx
  on public.business_vertical_status_history(vertical_id);
create index if not exists business_vertical_status_history_changed_at_idx
  on public.business_vertical_status_history(changed_at desc);

create table if not exists public.business_vertical_name_history (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid null references public.business_verticals(id) on delete set null,
  vertical_code_snapshot text not null,
  previous_name text not null,
  new_name text not null,
  changed_by uuid null references public.admin_users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint business_vertical_name_history_previous_nonempty check (length(btrim(previous_name)) > 0),
  constraint business_vertical_name_history_new_nonempty check (length(btrim(new_name)) > 0),
  constraint business_vertical_name_history_name_changed check (previous_name <> new_name)
);

create index if not exists business_vertical_name_history_vertical_idx
  on public.business_vertical_name_history(vertical_id);
create index if not exists business_vertical_name_history_changed_at_idx
  on public.business_vertical_name_history(changed_at desc);

-- Normalize names/codes, prevent code changes and enforce the approved transition matrix.
-- A status change requires the transaction-local reason set by the RPC below.
create or replace function public.guard_business_vertical_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_reason text;
  v_actor_id uuid;
  v_actor_active boolean;
  v_audited_fields_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.name := btrim(new.name);
    new.code := upper(btrim(new.code));
    if new.status = 'closed' then
      raise exception 'VERTICAL_CANNOT_BE_CREATED_CLOSED';
    end if;
    return new;
  end if;

  if new.code is distinct from old.code then
    raise exception 'VERTICAL_CODE_IMMUTABLE';
  end if;

  new.name := btrim(new.name);

  v_audited_fields_changed :=
    new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.status is distinct from old.status;

  if v_audited_fields_changed then
    -- Audited changes must come through a backend RPC that sets this
    -- transaction-local actor context from the verified admin identity.
    if nullif(current_setting('marut.vertical_actor_id', true), '') is null then
      raise exception 'VERTICAL_ACTOR_CONTEXT_REQUIRED';
    end if;

    begin
      v_actor_id := current_setting('marut.vertical_actor_id', true)::uuid;
    exception when invalid_text_representation then
      raise exception 'VERTICAL_ACTOR_CONTEXT_INVALID';
    end;

    select is_active
      into v_actor_active
      from public.admin_users
     where id = v_actor_id;

    if not found or not v_actor_active then
      raise exception 'VERTICAL_ACTOR_NOT_ACTIVE';
    end if;

    -- Never trust a possibly stale updated_by value from the row.
    new.updated_by := v_actor_id;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'closed' then
      raise exception 'CLOSED_VERTICAL_CANNOT_BE_REOPENED';
    end if;

    if not (
      (old.status = 'proposed' and new.status in ('under_planning', 'closed'))
      or (old.status = 'under_planning' and new.status in ('proposed', 'setup_in_progress', 'closed'))
      or (old.status = 'setup_in_progress' and new.status in ('under_planning', 'operational', 'closed'))
      or (old.status = 'operational' and new.status in ('temporarily_suspended', 'closed'))
      or (old.status = 'temporarily_suspended' and new.status in ('operational', 'closed'))
    ) then
      raise exception 'INVALID_VERTICAL_STATUS_TRANSITION';
    end if;

    v_reason := nullif(btrim(current_setting('marut.vertical_status_reason', true)), '');
    if v_reason is null then
      raise exception 'VERTICAL_STATUS_CHANGE_REASON_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_business_vertical_write on public.business_verticals;
create trigger trg_guard_business_vertical_write
before insert or update on public.business_verticals
for each row execute function public.guard_business_vertical_write();

-- Reuse public.set_updated_at(), created by migration 0001.
drop trigger if exists trg_business_verticals_updated_at on public.business_verticals;
create trigger trg_business_verticals_updated_at
before update on public.business_verticals
for each row execute function public.set_updated_at();

-- Record status and name changes atomically with the master-row update.
create or replace function public.record_business_vertical_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if new.status is distinct from old.status then
    v_reason := nullif(btrim(current_setting('marut.vertical_status_reason', true)), '');
    insert into public.business_vertical_status_history (
      vertical_id, vertical_code_snapshot, vertical_name_snapshot,
      previous_status, new_status, reason, changed_by
    ) values (
      new.id, old.code, new.name, old.status, new.status, v_reason, new.updated_by
    );
  end if;

  if new.name is distinct from old.name then
    insert into public.business_vertical_name_history (
      vertical_id, vertical_code_snapshot, previous_name, new_name, changed_by
    ) values (
      new.id, old.code, old.name, new.name, new.updated_by
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_record_business_vertical_changes on public.business_verticals;
create trigger trg_record_business_vertical_changes
after update on public.business_verticals
for each row execute function public.record_business_vertical_changes();

-- The backend must derive p_actor_id from the verified admin session.
create or replace function public.transition_business_vertical(
  p_vertical_id uuid,
  p_new_status public.business_vertical_status,
  p_reason text,
  p_actor_id uuid
)
returns public.business_verticals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_active boolean;
  v_vertical public.business_verticals%rowtype;
begin
  if p_actor_id is null then
    raise exception 'VERTICAL_ACTOR_REQUIRED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'VERTICAL_STATUS_CHANGE_REASON_REQUIRED';
  end if;

  select is_active into v_actor_active
    from public.admin_users where id = p_actor_id;
  if not found or not v_actor_active then
    raise exception 'VERTICAL_ACTOR_NOT_ACTIVE';
  end if;

  perform set_config('marut.vertical_actor_id', p_actor_id::text, true);
  perform set_config('marut.vertical_status_reason', btrim(p_reason), true);

  update public.business_verticals
     set status = p_new_status, updated_by = p_actor_id
   where id = p_vertical_id
   returning * into v_vertical;

  if not found then
    raise exception 'VERTICAL_NOT_FOUND';
  end if;
  return v_vertical;
end;
$$;

revoke all on function public.transition_business_vertical(
  uuid, public.business_vertical_status, text, uuid
) from public, anon, authenticated;
grant execute on function public.transition_business_vertical(
  uuid, public.business_vertical_status, text, uuid
) to service_role;

-- Owner-authorized backend route should call this RPC for name/description edits.
-- Express must validate the caller's verticals:manage permission before calling it.
create or replace function public.update_business_vertical_details(
  p_vertical_id uuid,
  p_name text,
  p_description text,
  p_actor_id uuid
)
returns public.business_verticals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_active boolean;
  v_vertical public.business_verticals%rowtype;
begin
  if p_actor_id is null then
    raise exception 'VERTICAL_ACTOR_REQUIRED';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'VERTICAL_NAME_REQUIRED';
  end if;

  select is_active
    into v_actor_active
    from public.admin_users
   where id = p_actor_id;

  if not found or not v_actor_active then
    raise exception 'VERTICAL_ACTOR_NOT_ACTIVE';
  end if;

  perform set_config('marut.vertical_actor_id', p_actor_id::text, true);

  update public.business_verticals
     set name = btrim(p_name),
         description = p_description,
         updated_by = p_actor_id
   where id = p_vertical_id
   returning * into v_vertical;

  if not found then
    raise exception 'VERTICAL_NOT_FOUND';
  end if;

  return v_vertical;
end;
$$;

revoke all on function public.update_business_vertical_details(
  uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.update_business_vertical_details(
  uuid, text, text, uuid
) to service_role;

-- History payloads are append-only. If a vertical is deleted while it has
-- history, the FK is set to NULL but its immutable code/name snapshots remain.
-- Future Products/Orders/Invoices migrations must add RESTRICT foreign keys
-- from their records to business_verticals so referenced verticals cannot be deleted.

create or replace function public.prevent_business_vertical_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.vertical_id is not null
     and new.vertical_id is null
     and (to_jsonb(new) - 'vertical_id') = (to_jsonb(old) - 'vertical_id')
     and not exists (
       select 1
         from public.business_verticals
        where id = old.vertical_id
     ) then
    return new;
  end if;

  raise exception 'VERTICAL_HISTORY_IS_APPEND_ONLY';
end;
$$;

drop trigger if exists trg_business_vertical_status_history_immutable
  on public.business_vertical_status_history;
create trigger trg_business_vertical_status_history_immutable
before update or delete on public.business_vertical_status_history
for each row execute function public.prevent_business_vertical_history_mutation();

drop trigger if exists trg_business_vertical_name_history_immutable
  on public.business_vertical_name_history;
create trigger trg_business_vertical_name_history_immutable
before update or delete on public.business_vertical_name_history
for each row execute function public.prevent_business_vertical_history_mutation();

-- Initial seed. Conflict is intentionally a no-op.
insert into public.business_verticals(name, code, description, status)
values ('Microgreens', 'MICRO', 'Microgreens cultivation and sales.', 'operational')
on conflict (code) do nothing;

alter table public.business_verticals enable row level security;
alter table public.business_vertical_status_history enable row level security;
alter table public.business_vertical_name_history enable row level security;

revoke all on public.business_verticals from anon, authenticated;
revoke all on public.business_vertical_status_history from anon, authenticated;
revoke all on public.business_vertical_name_history from anon, authenticated;

grant usage on schema public to service_role;
grant all on public.business_verticals to service_role;
grant all on public.business_vertical_status_history to service_role;
grant all on public.business_vertical_name_history to service_role;

do $$
begin
  if not exists (
    select 1 from public.business_verticals
    where code = 'MICRO' and name = 'Microgreens' and status = 'operational'
  ) then
    raise exception 'VERTICAL_SEED_VERIFICATION_FAILED';
  end if;
  if (select count(*) from public.business_verticals where code = 'MICRO') <> 1 then
    raise exception 'VERTICAL_SEED_DUPLICATE';
  end if;
end;
$$;

commit;
