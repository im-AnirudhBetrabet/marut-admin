-- MARUT Admin — Products Management
-- Migration 0006: foundational schema for product management.
-- Prerequisites: migrations 0001–0005; Supabase `extensions` schema exists.
-- Controlled mutation RPCs and permission enforcement follow in a later migration.

begin;

create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

-- 1. SKU prefix: nullable for proposed/preparation-stage verticals.
alter table public.business_verticals add column if not exists sku_prefix text;
update public.business_verticals set sku_prefix = 'MIC' where code = 'MICRO' and sku_prefix is null;
create unique index if not exists business_verticals_sku_prefix_uidx
  on public.business_verticals (sku_prefix) where sku_prefix is not null;
alter table public.business_verticals drop constraint if exists business_verticals_sku_prefix_format;
alter table public.business_verticals add constraint business_verticals_sku_prefix_format
  check (sku_prefix is null or sku_prefix ~ '^[A-Z][A-Z0-9]{1,7}$');

-- Preserve the existing Vertical Management rules while adding prefix rules.
create or replace function public.guard_business_vertical_write()
returns trigger language plpgsql set search_path = public as $function$
declare
  v_reason text;
  v_actor_id uuid;
  v_actor_active boolean;
  v_audited_fields_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.name := btrim(new.name);
    new.code := upper(btrim(new.code));
    if new.sku_prefix is not null then new.sku_prefix := upper(btrim(new.sku_prefix)); end if;
    if new.status = 'closed' then raise exception 'VERTICAL_CANNOT_BE_CREATED_CLOSED'; end if;
    if new.status = 'operational' and new.sku_prefix is null then
      raise exception 'VERTICAL_SKU_PREFIX_REQUIRED_FOR_OPERATIONAL';
    end if;
    return new;
  end if;

  if new.code is distinct from old.code then raise exception 'VERTICAL_CODE_IMMUTABLE'; end if;
  new.name := btrim(new.name);
  if new.sku_prefix is not null then new.sku_prefix := upper(btrim(new.sku_prefix)); end if;
  if old.sku_prefix is not null and new.sku_prefix is distinct from old.sku_prefix then
    raise exception 'VERTICAL_SKU_PREFIX_IMMUTABLE';
  end if;
  if new.status = 'operational' and new.sku_prefix is null then
    raise exception 'VERTICAL_SKU_PREFIX_REQUIRED_FOR_OPERATIONAL';
  end if;

  v_audited_fields_changed :=
    new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.status is distinct from old.status
    or new.sku_prefix is distinct from old.sku_prefix;

  if v_audited_fields_changed then
    if nullif(current_setting('marut.vertical_actor_id', true), '') is null then
      raise exception 'VERTICAL_ACTOR_CONTEXT_REQUIRED';
    end if;
    begin
      v_actor_id := current_setting('marut.vertical_actor_id', true)::uuid;
    exception when invalid_text_representation then
      raise exception 'VERTICAL_ACTOR_CONTEXT_INVALID';
    end;
    select is_active into v_actor_active from public.admin_users where id = v_actor_id;
    if not found or not v_actor_active then raise exception 'VERTICAL_ACTOR_NOT_ACTIVE'; end if;
    new.updated_by := v_actor_id;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'closed' then raise exception 'CLOSED_VERTICAL_CANNOT_BE_REOPENED'; end if;
    if not (
      (old.status = 'proposed' and new.status in ('under_planning', 'closed'))
      or (old.status = 'under_planning' and new.status in ('proposed', 'setup_in_progress', 'closed'))
      or (old.status = 'setup_in_progress' and new.status in ('under_planning', 'operational', 'closed'))
      or (old.status = 'operational' and new.status in ('temporarily_suspended', 'closed'))
      or (old.status = 'temporarily_suspended' and new.status in ('operational', 'closed'))
    ) then raise exception 'INVALID_VERTICAL_STATUS_TRANSITION'; end if;
    v_reason := nullif(btrim(current_setting('marut.vertical_status_reason', true)), '');
    if v_reason is null then raise exception 'VERTICAL_STATUS_CHANGE_REASON_REQUIRED'; end if;
  end if;
  return new;
end;
$function$;

-- 2. Types and global SKU sequence.
do $$ begin create type public.product_category_status as enum ('active','inactive');
exception when duplicate_object then null; end $$;
do $$ begin create type public.product_status as enum ('draft','active','inactive','archived');
exception when duplicate_object then null; end $$;
do $$ begin create type public.pack_size_status as enum ('active','inactive');
exception when duplicate_object then null; end $$;
create sequence if not exists public.product_sku_sequence as bigint start 1 increment 1 minvalue 1 no maxvalue cache 1;

-- 3. Product categories.
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.business_verticals(id) on delete restrict,
  name text not null,
  description text,
  status public.product_category_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  constraint product_categories_name_nonempty check (length(btrim(name)) > 0)
);
create unique index if not exists product_categories_vertical_name_uidx
  on public.product_categories(vertical_id, lower(btrim(name)));
create index if not exists product_categories_vertical_idx on public.product_categories(vertical_id);
create index if not exists product_categories_status_idx on public.product_categories(status);

-- 4. Products.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.product_categories(id) on delete restrict,
  sku text not null,
  name text not null,
  description text,
  status public.product_status not null default 'draft',
  growing_duration_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  constraint products_sku_format check (sku = upper(btrim(sku))),
  constraint products_name_nonempty check (length(btrim(name)) > 0),
  constraint products_growing_duration_positive check (growing_duration_days is null or growing_duration_days > 0)
);
create unique index if not exists products_sku_uidx on public.products(sku);
create unique index if not exists products_category_name_uidx on public.products(category_id, lower(btrim(name)));
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_status_idx on public.products(status);

-- 5. Permanent SKU registry. Product deletion must retire/detach registry row first.
create table if not exists public.sku_registry (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  product_id uuid unique references public.products(id) on delete restrict,
  allocated_at timestamptz not null default now(),
  allocated_by uuid references public.admin_users(id) on delete set null,
  retired_at timestamptz,
  constraint sku_registry_sku_format check (sku = upper(btrim(sku))),
  constraint sku_registry_retirement_consistency check (
    (product_id is not null and retired_at is null) or
    (product_id is null and retired_at is not null)
  )
);
create unique index if not exists sku_registry_sku_uidx on public.sku_registry(sku);

-- 6. Pack sizes. Historical order references will use RESTRICT FKs when Orders is implemented.
create table if not exists public.product_pack_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  weight_grams integer not null,
  status public.pack_size_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  constraint product_pack_sizes_weight_positive check (weight_grams > 0),
  constraint product_pack_sizes_product_weight_unique unique(product_id, weight_grams)
);
create index if not exists product_pack_sizes_status_idx on public.product_pack_sizes(status);

-- 7. Product images; deleting an association never deletes the Storage object.
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_object_path text not null unique,
  is_primary boolean not null default false,
  alt_text text,
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  constraint product_images_storage_path_nonempty check (length(btrim(storage_object_path)) > 0)
);
create unique index if not exists product_images_one_primary_uidx
  on public.product_images(product_id) where is_primary;
create index if not exists product_images_product_idx on public.product_images(product_id);

-- 8. Standard product prices. Periods are [effective_from, effective_until).
create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  price_per_gram numeric(12,4) not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.admin_users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.admin_users(id) on delete set null,
  cancellation_reason text,
  constraint product_prices_amount_positive check (price_per_gram > 0),
  constraint product_prices_period_valid check (effective_until is null or effective_until > effective_from),
  constraint product_prices_reason_nonempty check (length(btrim(reason)) > 0),
  constraint product_prices_cancellation_consistency check (
    (cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (cancelled_at is not null and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  ),
  constraint product_prices_no_overlapping_periods
    exclude using gist (product_id with =, tstzrange(effective_from,effective_until,'[)') with &&)
    where (cancelled_at is null)
);
create index if not exists product_prices_product_effective_idx on public.product_prices(product_id,effective_from desc);

-- 9. Global minimum floor. Zero is the approved initial baseline.
create table if not exists public.global_minimum_price_floors (
  id uuid primary key default gen_random_uuid(),
  minimum_price_per_gram numeric(12,4) not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.admin_users(id) on delete set null,
  reason text not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.admin_users(id) on delete set null,
  cancellation_reason text,
  constraint global_minimum_price_floors_amount_nonnegative check (minimum_price_per_gram >= 0),
  constraint global_minimum_price_floors_period_valid check (effective_until is null or effective_until > effective_from),
  constraint global_minimum_price_floors_reason_nonempty check (length(btrim(reason)) > 0),
  constraint global_minimum_price_floors_cancellation_consistency check (
    (cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (cancelled_at is not null and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  ),
  constraint global_minimum_price_floors_no_overlapping_periods
    exclude using gist (tstzrange(effective_from,effective_until,'[)') with &&)
    where (cancelled_at is null)
);
create index if not exists global_minimum_price_floors_effective_idx
  on public.global_minimum_price_floors(effective_from desc);

-- 10. Product-specific minimum floors. Runtime floor is MAX(global, product).
create table if not exists public.product_minimum_price_floors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  minimum_price_per_gram numeric(12,4) not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.admin_users(id) on delete set null,
  reason text not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.admin_users(id) on delete set null,
  cancellation_reason text,
  constraint product_minimum_price_floors_amount_positive check (minimum_price_per_gram > 0),
  constraint product_minimum_price_floors_period_valid check (effective_until is null or effective_until > effective_from),
  constraint product_minimum_price_floors_reason_nonempty check (length(btrim(reason)) > 0),
  constraint product_minimum_price_floors_cancellation_consistency check (
    (cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (cancelled_at is not null and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  ),
  constraint product_minimum_price_floors_no_overlapping_periods
    exclude using gist (product_id with =, tstzrange(effective_from,effective_until,'[)') with &&)
    where (cancelled_at is null)
);
create index if not exists product_minimum_price_floors_product_effective_idx
  on public.product_minimum_price_floors(product_id,effective_from desc);

-- 11. Append-only audit payloads; entity_id deliberately has no FK.
create table if not exists public.catalogue_audit_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  actor_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint catalogue_audit_history_entity_type_check check (entity_type in (
    'product','category','pack_size','product_image','product_price',
    'global_price_floor','product_price_floor'
  )),
  constraint catalogue_audit_history_action_nonempty check (length(btrim(action)) > 0)
);
create index if not exists catalogue_audit_history_entity_idx
  on public.catalogue_audit_history(entity_type,entity_id,created_at desc);
create index if not exists catalogue_audit_history_actor_idx
  on public.catalogue_audit_history(actor_id,created_at desc);

-- Protect permanent SKU reservations. Active rows may undergo exactly one
-- mutation: the controlled transition to retired. Retired rows are immutable.
create or replace function public.guard_sku_registry_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'SKU_REGISTRY_DELETE_PROHIBITED';
  end if;

  if old.retired_at is not null then
    raise exception 'RETIRED_SKU_REGISTRY_ROW_IMMUTABLE';
  end if;

  -- The only permitted update is active -> retired. SKU and allocation
  -- identity/metadata must remain unchanged during this transition.
  if old.product_id is not null
     and old.retired_at is null
     and new.product_id is null
     and new.retired_at is not null
     and (to_jsonb(new) - 'product_id' - 'retired_at')
         = (to_jsonb(old) - 'product_id' - 'retired_at') then
    return new;
  end if;

  raise exception 'SKU_REGISTRY_UPDATE_PROHIBITED';
end;
$function$;

drop trigger if exists trg_sku_registry_no_delete on public.sku_registry;
drop trigger if exists trg_sku_registry_retirement_guard on public.sku_registry;
create trigger trg_sku_registry_retirement_guard
before update or delete on public.sku_registry
for each row execute function public.guard_sku_registry_mutation();

-- Keep audit history append-only. The only permitted update is the FK's
-- ON DELETE SET NULL cleanup of actor_id after the referenced admin is gone.
create or replace function public.prevent_catalogue_audit_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'UPDATE'
     and old.actor_id is not null
     and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id')
     and not exists (
       select 1 from public.admin_users where id = old.actor_id
     ) then
    return new;
  end if;

  raise exception 'CATALOGUE_AUDIT_HISTORY_APPEND_ONLY';
end;
$function$;

drop trigger if exists trg_catalogue_audit_history_immutable
  on public.catalogue_audit_history;
create trigger trg_catalogue_audit_history_immutable
before update or delete on public.catalogue_audit_history
for each row execute function public.prevent_catalogue_audit_history_mutation();

-- 12. Reuse public.set_updated_at(), created by migration 0001.
do $$
declare t text;
begin
  foreach t in array array[
    'product_categories','products','product_pack_sizes','product_prices',
    'global_minimum_price_floors','product_minimum_price_floors'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'trg_'||t||'_updated_at', t);
  end loop;
end;
$$;

-- 13. Seed an open-ended baseline floor only when no active floor exists.
insert into public.global_minimum_price_floors(minimum_price_per_gram,effective_from,effective_until,reason)
select 0.0000, now(), null, 'Initial baseline floor'
where not exists (select 1 from public.global_minimum_price_floors where cancelled_at is null);

-- 14. RLS and read-only service-role table access. No client policies are created.
-- Mutations will be exposed only through SECURITY DEFINER RPCs in migration 0007.
-- Migration 0007 must create/own these RPCs as postgres (table owner),
-- then explicitly GRANT EXECUTE to service_role; do not make service_role
-- the function owner and do not grant it direct table/sequence write access.
do $$
declare t text;
begin
  foreach t in array array[
    'product_categories','products','sku_registry','product_pack_sizes','product_images',
    'product_prices','global_minimum_price_floors','product_minimum_price_floors','catalogue_audit_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
end;
$$;
revoke all on sequence public.product_sku_sequence from public, anon, authenticated, service_role;

-- 15. Verification assertions.
do $$
begin
  if not exists (select 1 from public.business_verticals where code='MICRO' and sku_prefix='MIC' and status='operational') then
    raise exception 'MICRO_VERTICAL_SKU_PREFIX_VERIFICATION_FAILED';
  end if;
  if not exists (select 1 from public.global_minimum_price_floors
    where effective_from <= now()
      and (effective_until is null or effective_until > now())
      and cancelled_at is null) then
    raise exception 'ACTIVE_GLOBAL_PRICE_FLOOR_VERIFICATION_FAILED';
  end if;
  if not exists (select 1 from pg_extension where extname='btree_gist') then
    raise exception 'BTREE_GIST_EXTENSION_VERIFICATION_FAILED';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.sku_registry'::regclass
      and tgname = 'trg_sku_registry_retirement_guard'
      and not tgisinternal
      and (tgtype & 16) = 16 -- UPDATE
      and (tgtype & 8) = 8   -- DELETE
  ) then
    raise exception 'SKU_REGISTRY_RETIREMENT_GUARD_VERIFICATION_FAILED';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.catalogue_audit_history'::regclass
      and tgname = 'trg_catalogue_audit_history_immutable'
      and not tgisinternal
  ) then
    raise exception 'CATALOGUE_AUDIT_GUARD_VERIFICATION_FAILED';
  end if;
end;
$$;

commit;
