-- MARUT Admin V2 — Products Management
-- Migration 0007: controlled mutation/read RPCs for the schema created by 0006.
-- Prerequisites: migrations 0001–0006 (including 0006 reviewed v3).
-- Staff module permissions are enforced by Express. These RPCs independently
-- validate active admin identity and enforce Owner-only pricing/floor controls.

begin;
set local search_path = public, extensions;

-- Keep the audit vocabulary finite and aligned with the RPCs in this migration.
alter table public.catalogue_audit_history
  drop constraint if exists catalogue_audit_history_action_allowed;
alter table public.catalogue_audit_history
  add constraint catalogue_audit_history_action_allowed check (action in (
    'created','created_with_product','sku_allocated','details_updated',
    'vertical_reassigned','category_reassigned','status_changed','deleted',
    'added','primary_changed','removed','scheduled_price_updated',
    'scheduled_floor_updated','cancelled'
  ));

-- ---------------------------------------------------------------------------
-- 0. Internal authorization, audit and formatting helpers
-- ---------------------------------------------------------------------------

create or replace function public._catalogue_assert_actor(
  p_actor_id uuid,
  p_module public.admin_module,
  p_owner_only boolean default false
)
returns public.admin_users
language plpgsql
security definer
set search_path = public
as $function$
declare v_actor public.admin_users%rowtype;
begin
  if p_actor_id is null then raise exception 'ADMIN_NOT_FOUND'; end if;
  select * into v_actor from public.admin_users where id = p_actor_id for share;
  if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
  if not v_actor.is_active then raise exception 'ADMIN_INACTIVE'; end if;
  if p_owner_only then
    if v_actor.role <> 'owner' then raise exception 'OWNER_REQUIRED'; end if;
  elsif v_actor.role <> 'owner' and not exists (
    select 1 from public.admin_user_permissions
    where admin_user_id = p_actor_id and module_key = p_module and level = 'manage'
  ) then
    raise exception 'INSUFFICIENT_PERMISSION';
  end if;
  return v_actor;
end;
$function$;

create or replace function public._catalogue_audit(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_previous jsonb,
  p_new jsonb,
  p_reason text,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.catalogue_audit_history(
    entity_type, entity_id, action, previous_values, new_values, reason, actor_id
  ) values (
    p_entity_type, p_entity_id, p_action, p_previous, p_new, nullif(btrim(p_reason), ''), p_actor_id
  );
end;
$function$;

create or replace function public._catalogue_require_reason(p_reason text)
returns text language plpgsql immutable set search_path = public as $function$
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
  return btrim(p_reason);
end;
$function$;

-- unaccent is not assumed installed. Replace the helper above with a portable
-- ASCII-only normalizer; non-ASCII characters are stripped rather than guessed.
create or replace function public._catalogue_product_abbreviation(p_name text)
returns text language plpgsql immutable set search_path = public as $function$
declare v text;
begin
  v := upper(regexp_replace(coalesce(p_name,''), '[^A-Za-z0-9]+', '', 'g'));
  if length(v) < 2 then raise exception 'PRODUCT_ABBREVIATION_CANNOT_BE_GENERATED'; end if;
  return substr(v,1,8);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------------

create or replace function public.create_product_category(
  p_actor_id uuid, p_vertical_id uuid, p_name text, p_description text default null
)
returns public.product_categories
language plpgsql security definer set search_path = public
as $function$
declare v public.product_categories%rowtype;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  if nullif(btrim(p_name),'') is null then raise exception 'CATEGORY_NAME_REQUIRED'; end if;
  perform 1 from public.business_verticals where id=p_vertical_id and status='operational' for share;
  if not found then raise exception 'VERTICAL_NOT_OPERATIONAL'; end if;
  insert into public.product_categories(vertical_id,name,description,status,created_by,updated_by)
  values(p_vertical_id,btrim(p_name),p_description,'active',p_actor_id,p_actor_id) returning * into v;
  perform public._catalogue_audit('category',v.id,'created',null,to_jsonb(v),null,p_actor_id);
  return v;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.update_product_category_details(
  p_actor_id uuid,p_category_id uuid,p_name text,p_description text,p_reason text
)
returns public.product_categories
language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_categories%rowtype; v_new public.product_categories%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  if nullif(btrim(p_name),'') is null then raise exception 'CATEGORY_NAME_REQUIRED'; end if;
  select * into v_old from public.product_categories where id=p_category_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  v_reason:=case when btrim(p_name) is distinct from v_old.name then public._catalogue_require_reason(p_reason) else null end;
  update public.product_categories set name=btrim(p_name),description=p_description,updated_by=p_actor_id
  where id=p_category_id returning * into v_new;
  perform public._catalogue_audit('category',v_new.id,'details_updated',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.reassign_product_category_vertical(
  p_actor_id uuid,p_category_id uuid,p_new_vertical_id uuid,p_reason text
)
returns public.product_categories
language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_categories%rowtype; v_new public.product_categories%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  perform public._catalogue_assert_actor(p_actor_id,'verticals',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.product_categories where id=p_category_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  perform 1 from public.business_verticals where id=p_new_vertical_id and status='operational' for share;
  if not found then raise exception 'VERTICAL_NOT_OPERATIONAL'; end if;
  update public.product_categories set vertical_id=p_new_vertical_id,updated_by=p_actor_id
  where id=p_category_id returning * into v_new;
  perform public._catalogue_audit('category',v_new.id,'vertical_reassigned',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.transition_product_category_status(
  p_actor_id uuid,p_category_id uuid,p_new_status public.product_category_status,p_reason text
)
returns public.product_categories
language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_categories%rowtype; v_new public.product_categories%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.product_categories where id=p_category_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.status=p_new_status or not ((v_old.status='active' and p_new_status='inactive') or (v_old.status='inactive' and p_new_status='active')) then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;
  if p_new_status='active' and not exists(select 1 from public.business_verticals where id=v_old.vertical_id and status='operational') then
    raise exception 'VERTICAL_NOT_OPERATIONAL';
  end if;
  update public.product_categories set status=p_new_status,updated_by=p_actor_id where id=p_category_id returning * into v_new;
  perform public._catalogue_audit('category',v_new.id,'status_changed',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.delete_product_category(p_actor_id uuid,p_category_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_categories%rowtype; v_reason text; v_ever_used boolean;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.product_categories where id=p_category_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select exists(select 1 from public.products where category_id=p_category_id)
    or exists(select 1 from public.catalogue_audit_history a
      where a.entity_type='product' and (
        a.previous_values->>'category_id'=p_category_id::text or
        a.new_values->>'category_id'=p_category_id::text
      )) into v_ever_used;
  if v_ever_used then raise exception 'HISTORICAL_REFERENCE_EXISTS'; end if;
  perform public._catalogue_audit('category',p_category_id,'deleted',to_jsonb(v_old),null,v_reason,p_actor_id);
  delete from public.product_categories where id=p_category_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. SKU preview and atomic product creation
-- ---------------------------------------------------------------------------

-- Preview is advisory only: it never calls nextval(); the final sequence is
-- allocated atomically by create_product when the product is saved.
create or replace function public.preview_product_sku(
  p_actor_id uuid,p_category_id uuid,p_product_name text,p_product_abbreviation text default null
)
returns text language plpgsql security definer set search_path = public
as $function$
declare v_prefix text; v_abbr text; v_seq bigint;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  select bv.sku_prefix into v_prefix from public.product_categories c
  join public.business_verticals bv on bv.id=c.vertical_id where c.id=p_category_id;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_prefix is null then raise exception 'VERTICAL_SKU_PREFIX_REQUIRED'; end if;
  v_abbr:=coalesce(nullif(upper(btrim(p_product_abbreviation)),''),public._catalogue_product_abbreviation(p_product_name));
  if v_abbr !~ '^[A-Z0-9]{2,8}$' then raise exception 'INVALID_PRODUCT_ABBREVIATION'; end if;
  select case when is_called then last_value+1 else 1 end into v_seq
  from public.product_sku_sequence;
  -- Minimum width is three digits; never truncate sequence values >= 1000.
  return v_prefix||'-'||v_abbr||'-'||
    case when v_seq < 1000 then lpad(v_seq::text,3,'0') else v_seq::text end;
end;
$function$;

create or replace function public.create_product(
  p_actor_id uuid,p_category_id uuid,p_name text,p_product_abbreviation text,
  p_description text,p_growing_duration_days integer,p_pack_sizes_grams integer[]
)
returns public.products language plpgsql security definer set search_path = public
as $function$
declare v_category public.product_categories%rowtype; v_prefix text; v_abbr text; v_seq bigint; v_sku text;
        v_product public.products%rowtype; v_weight integer;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  if nullif(btrim(p_name),'') is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
  if p_growing_duration_days is not null and p_growing_duration_days<=0 then raise exception 'INVALID_GROWING_DURATION'; end if;
  if coalesce(array_length(p_pack_sizes_grams,1),0)<1 then raise exception 'AT_LEAST_ONE_PACK_SIZE_REQUIRED'; end if;
  if exists(select 1 from unnest(p_pack_sizes_grams) x where x is null or x<=0)
     or (select count(*) from unnest(p_pack_sizes_grams))<>(select count(distinct x) from unnest(p_pack_sizes_grams) x) then
    raise exception 'INVALID_OR_DUPLICATE_PACK_SIZE';
  end if;
  select * into v_category from public.product_categories where id=p_category_id for share;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_category.status<>'active' then raise exception 'CATEGORY_INACTIVE'; end if;
  select sku_prefix into v_prefix from public.business_verticals where id=v_category.vertical_id and status='operational' for share;
  if not found or v_prefix is null then raise exception 'VERTICAL_NOT_OPERATIONAL_OR_PREFIX_MISSING'; end if;
  v_abbr:=coalesce(nullif(upper(btrim(p_product_abbreviation)),''),public._catalogue_product_abbreviation(p_name));
  if v_abbr !~ '^[A-Z0-9]{2,8}$' then raise exception 'INVALID_PRODUCT_ABBREVIATION'; end if;
  v_seq:=nextval('public.product_sku_sequence');
  -- Minimum width is three digits; sequence values expand naturally beyond 999.
  v_sku:=v_prefix||'-'||v_abbr||'-'||
    case when v_seq < 1000 then lpad(v_seq::text,3,'0') else v_seq::text end;
  insert into public.products(category_id,sku,name,description,status,growing_duration_days,created_by,updated_by)
  values(p_category_id,v_sku,btrim(p_name),p_description,'draft',p_growing_duration_days,p_actor_id,p_actor_id)
  returning * into v_product;
  insert into public.sku_registry(sku,product_id,allocated_by) values(v_sku,v_product.id,p_actor_id);
  foreach v_weight in array p_pack_sizes_grams loop
    insert into public.product_pack_sizes(product_id,weight_grams,status,created_by,updated_by)
    values(v_product.id,v_weight,'active',p_actor_id,p_actor_id);
    perform public._catalogue_audit('pack_size',
      (select id from public.product_pack_sizes where product_id=v_product.id and weight_grams=v_weight),
      'created_with_product',null,jsonb_build_object('product_id',v_product.id,'weight_grams',v_weight,'status','active'),null,p_actor_id);
  end loop;
  perform public._catalogue_audit('product',v_product.id,'created',null,
    to_jsonb(v_product)||jsonb_build_object('pack_sizes_grams',p_pack_sizes_grams,'sku',v_sku),null,p_actor_id);
  perform public._catalogue_audit('product',v_product.id,'sku_allocated',null,jsonb_build_object('sku',v_sku,'sequence',v_seq),null,p_actor_id);
  return v_product;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Product details, lifecycle, category reassignment and deletion
-- ---------------------------------------------------------------------------

create or replace function public.update_product_details(
  p_actor_id uuid,p_product_id uuid,p_name text,p_description text,
  p_growing_duration_days integer,p_reason text default null
)
returns public.products language plpgsql security definer set search_path = public
as $function$
declare v_old public.products%rowtype; v_new public.products%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  select * into v_old from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
  if p_growing_duration_days is not null and p_growing_duration_days<=0 then raise exception 'INVALID_GROWING_DURATION'; end if;
  v_reason:=null;
  if btrim(p_name) is distinct from v_old.name then v_reason:=public._catalogue_require_reason(p_reason); end if;
  update public.products set name=btrim(p_name),description=p_description,growing_duration_days=p_growing_duration_days,updated_by=p_actor_id
  where id=p_product_id returning * into v_new;
  perform public._catalogue_audit('product',v_new.id,'details_updated',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.transition_product_status(
  p_actor_id uuid,p_product_id uuid,p_new_status public.product_status,p_reason text
)
returns public.products language plpgsql security definer set search_path = public
as $function$
declare v_old public.products%rowtype; v_new public.products%rowtype; v_reason text; v_cat public.product_categories%rowtype;
        v_price numeric; v_floor numeric;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if not (
    (v_old.status='draft' and p_new_status in ('active','archived')) or
    (v_old.status='active' and p_new_status in ('inactive','archived')) or
    (v_old.status='inactive' and p_new_status in ('active','archived'))
  ) then raise exception 'INVALID_STATUS_TRANSITION'; end if;
  if p_new_status='active' then
    select * into v_cat from public.product_categories where id=v_old.category_id;
    if not found or v_cat.status<>'active' then raise exception 'CATEGORY_INACTIVE'; end if;
    if not exists(select 1 from public.business_verticals where id=v_cat.vertical_id and status='operational' and sku_prefix is not null) then raise exception 'VERTICAL_NOT_OPERATIONAL'; end if;
    if not exists(select 1 from public.product_pack_sizes where product_id=p_product_id and status='active') then raise exception 'ACTIVE_PACK_SIZE_REQUIRED'; end if;
    select price_per_gram into v_price from public.product_prices
      where product_id=p_product_id and cancelled_at is null and effective_from<=now() and (effective_until is null or effective_until>now()) limit 1;
    if v_price is null then raise exception 'EFFECTIVE_STANDARD_PRICE_REQUIRED'; end if;
    select minimum_price_per_gram into v_floor from public.global_minimum_price_floors
      where cancelled_at is null and effective_from<=now() and (effective_until is null or effective_until>now()) limit 1;
    if v_floor is null then raise exception 'EFFECTIVE_GLOBAL_PRICE_FLOOR_REQUIRED'; end if;
    select greatest(v_floor,coalesce((select minimum_price_per_gram from public.product_minimum_price_floors
      where product_id=p_product_id and cancelled_at is null and effective_from<=now() and (effective_until is null or effective_until>now()) limit 1),0)) into v_floor;
    if v_price<v_floor then raise exception 'PRODUCT_PRICE_BELOW_MINIMUM_FLOOR'; end if;
  end if;
  update public.products set status=p_new_status,updated_by=p_actor_id where id=p_product_id returning * into v_new;
  perform public._catalogue_audit('product',v_new.id,'status_changed',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.reassign_product_category(
  p_actor_id uuid,p_product_id uuid,p_new_category_id uuid,p_reason text
)
returns public.products language plpgsql security definer set search_path = public
as $function$
declare v_old public.products%rowtype; v_new public.products%rowtype; v_cat public.product_categories%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  perform public._catalogue_assert_actor(p_actor_id,'verticals',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  select * into v_cat from public.product_categories where id=p_new_category_id for share;
  if not found or v_cat.status<>'active' then raise exception 'CATEGORY_INACTIVE'; end if;
  if not exists(select 1 from public.business_verticals where id=v_cat.vertical_id and status='operational') then raise exception 'VERTICAL_NOT_OPERATIONAL'; end if;
  -- Deliberately preserve products.sku: category/vertical reassignment changes
  -- future classification only and never rewrites the originally assigned prefix.
  update public.products set category_id=p_new_category_id,updated_by=p_actor_id where id=p_product_id returning * into v_new;
  perform public._catalogue_audit('product',v_new.id,'category_reassigned',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.delete_product(p_actor_id uuid,p_product_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_old public.products%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if exists(select 1 from public.product_prices where product_id=p_product_id)
     or exists(select 1 from public.product_minimum_price_floors where product_id=p_product_id) then
    raise exception 'HISTORICAL_REFERENCE_EXISTS';
  end if;
  -- Future order/dispatch/invoice FKs use ON DELETE RESTRICT; a violation below
  -- is translated to a stable domain error. The SKU reservation is retired first.
  update public.sku_registry set product_id=null,retired_at=now() where product_id=p_product_id;
  if not found then raise exception 'SKU_REGISTRY_ENTRY_MISSING'; end if;
  perform public._catalogue_audit('product',p_product_id,'deleted',to_jsonb(v_old),null,v_reason,p_actor_id);
  delete from public.products where id=p_product_id;
exception when foreign_key_violation then raise exception 'HISTORICAL_REFERENCE_EXISTS';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Pack-size lifecycle. Weight is immutable: no update RPC is exposed.
-- ---------------------------------------------------------------------------

create or replace function public.create_product_pack_size(p_actor_id uuid,p_product_id uuid,p_weight_grams integer)
returns public.product_pack_sizes language plpgsql security definer set search_path = public
as $function$
declare v_product public.products%rowtype; v_row public.product_pack_sizes%rowtype;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_product.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  if p_weight_grams is null or p_weight_grams<=0 then raise exception 'INVALID_PACK_SIZE'; end if;
  insert into public.product_pack_sizes(product_id,weight_grams,status,created_by,updated_by)
  values(p_product_id,p_weight_grams,'active',p_actor_id,p_actor_id) returning * into v_row;
  perform public._catalogue_audit('pack_size',v_row.id,'created',null,to_jsonb(v_row),null,p_actor_id);
  return v_row;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.transition_product_pack_size_status(
  p_actor_id uuid,p_pack_size_id uuid,p_new_status public.pack_size_status,p_reason text
)
returns public.product_pack_sizes language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_pack_sizes%rowtype; v_new public.product_pack_sizes%rowtype; v_product public.products%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.product_pack_sizes where id=p_pack_size_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if not ((v_old.status='active' and p_new_status='inactive') or (v_old.status='inactive' and p_new_status='active')) then raise exception 'INVALID_STATUS_TRANSITION'; end if;
  if p_new_status='active' then
    select * into v_product from public.products where id=v_old.product_id;
    if v_product.status<>'active' then raise exception 'PRODUCT_NOT_ACTIVE'; end if;
    if not exists(select 1 from public.product_categories c join public.business_verticals v on v.id=c.vertical_id
      where c.id=v_product.category_id and c.status='active' and v.status='operational') then raise exception 'PRODUCT_NOT_ORDER_ELIGIBLE'; end if;
  end if;
  update public.product_pack_sizes set status=p_new_status,updated_by=p_actor_id where id=p_pack_size_id returning * into v_new;
  perform public._catalogue_audit('pack_size',v_new.id,'status_changed',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.delete_product_pack_size(p_actor_id uuid,p_pack_size_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_pack_sizes%rowtype; v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select * into v_old from public.product_pack_sizes where id=p_pack_size_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  perform public._catalogue_audit('pack_size',v_old.id,'deleted',to_jsonb(v_old),null,v_reason,p_actor_id);
  delete from public.product_pack_sizes where id=p_pack_size_id;
exception when foreign_key_violation then raise exception 'HISTORICAL_REFERENCE_EXISTS';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Product images. Storage objects are never deleted by these RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.add_product_image(
  p_actor_id uuid,p_product_id uuid,p_storage_object_path text,p_alt_text text default null
)
returns public.product_images language plpgsql security definer set search_path = public
as $function$
declare v_product public.products%rowtype; v_row public.product_images%rowtype; v_count integer;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_product.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  if nullif(btrim(p_storage_object_path),'') is null then raise exception 'IMAGE_PATH_REQUIRED'; end if;
  select count(*) into v_count from public.product_images where product_id=p_product_id;
  if v_count>=10 then raise exception 'PRODUCT_IMAGE_LIMIT_REACHED'; end if;
  -- Only the first image becomes primary; later uploads remain secondary.
  insert into public.product_images(product_id,storage_object_path,is_primary,alt_text,created_by)
  values(p_product_id,btrim(p_storage_object_path),(v_count=0),p_alt_text,p_actor_id) returning * into v_row;
  perform public._catalogue_audit('product_image',v_row.id,'added',null,to_jsonb(v_row),null,p_actor_id);
  return v_row;
exception when unique_violation then raise exception 'DUPLICATE_RECORD';
end;
$function$;

create or replace function public.set_primary_product_image(p_actor_id uuid,p_product_id uuid,p_image_id uuid)
returns public.product_images language plpgsql security definer set search_path = public
as $function$
declare v_product public.products%rowtype; v_old public.product_images%rowtype; v_new public.product_images%rowtype;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_product.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  select * into v_new from public.product_images where id=p_image_id and product_id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select * into v_old from public.product_images where product_id=p_product_id and is_primary for update;
  update public.product_images set is_primary=false where product_id=p_product_id and is_primary;
  update public.product_images set is_primary=true where id=p_image_id returning * into v_new;
  perform public._catalogue_audit('product_image',p_image_id,'primary_changed',to_jsonb(v_old),to_jsonb(v_new),null,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.update_product_image_details(p_actor_id uuid,p_image_id uuid,p_alt_text text)
returns public.product_images language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_images%rowtype; v_new public.product_images%rowtype;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  select i.* into v_old from public.product_images i join public.products p on p.id=i.product_id
    where i.id=p_image_id and p.status<>'archived' for update of i;
  if not found then raise exception 'ENTITY_NOT_FOUND_OR_PRODUCT_ARCHIVED'; end if;
  update public.product_images set alt_text=p_alt_text where id=p_image_id returning * into v_new;
  perform public._catalogue_audit('product_image',p_image_id,'details_updated',to_jsonb(v_old),to_jsonb(v_new),null,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.remove_product_image(p_actor_id uuid,p_product_id uuid,p_image_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_images%rowtype; v_reason text; v_promote uuid;
begin
  perform public._catalogue_assert_actor(p_actor_id,'products',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select * into v_old from public.product_images where id=p_image_id and product_id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  delete from public.product_images where id=p_image_id;
  if v_old.is_primary then
    select id into v_promote from public.product_images where product_id=p_product_id order by created_at,id limit 1 for update;
    if v_promote is not null then update public.product_images set is_primary=true where id=v_promote; end if;
  end if;
  perform public._catalogue_audit('product_image',p_image_id,'removed',to_jsonb(v_old),
    jsonb_build_object('storage_object_path',v_old.storage_object_path,'storage_object_deleted',false),v_reason,p_actor_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Standard product pricing
-- ---------------------------------------------------------------------------

create or replace function public.create_product_price(
  p_actor_id uuid,p_product_id uuid,p_price_per_gram numeric,
  p_effective_from timestamptz,p_effective_until timestamptz,p_reason text
)
returns public.product_prices language plpgsql security definer set search_path = public
as $function$
declare v_product public.products%rowtype; v_row public.product_prices%rowtype; v_reason text; v_effective_from timestamptz;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  -- NULL means effective immediately; PostgreSQL supplies the authoritative timestamp.
  v_effective_from:=coalesce(p_effective_from,now());
  if p_price_per_gram<=0
     or (p_effective_from is not null and p_effective_from<now())
     or (p_effective_until is not null and p_effective_until<=v_effective_from) then
    raise exception 'INVALID_PRICE_PERIOD_OR_AMOUNT';
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_product.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  insert into public.product_prices(product_id,price_per_gram,effective_from,effective_until,reason,created_by,updated_by)
  values(p_product_id,p_price_per_gram,v_effective_from,p_effective_until,v_reason,p_actor_id,p_actor_id) returning * into v_row;
  perform public._catalogue_audit('product_price',v_row.id,'created',null,to_jsonb(v_row),v_reason,p_actor_id);
  return v_row;
exception when exclusion_violation then raise exception 'PRICE_PERIOD_OVERLAP';
end;
$function$;

create or replace function public.update_scheduled_product_price(
  p_actor_id uuid,p_price_id uuid,p_price_per_gram numeric,
  p_effective_from timestamptz,p_effective_until timestamptz,p_reason text
)
returns public.product_prices language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_prices%rowtype; v_new public.product_prices%rowtype; v_reason text; v_product_id uuid;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select product_id into v_product_id from public.product_prices where id=p_price_id;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  perform 1 from public.products where id=v_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select * into v_old from public.product_prices where id=p_price_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.cancelled_at is not null or v_old.effective_from<=now() then raise exception 'EFFECTIVE_OR_CANCELLED_PRICE_IMMUTABLE'; end if;
  if p_price_per_gram<=0 or p_effective_from<=now() or (p_effective_until is not null and p_effective_until<=p_effective_from) then raise exception 'INVALID_PRICE_PERIOD_OR_AMOUNT'; end if;
  update public.product_prices set price_per_gram=p_price_per_gram,effective_from=p_effective_from,effective_until=p_effective_until,reason=v_reason,updated_by=p_actor_id
  where id=p_price_id returning * into v_new;
  perform public._catalogue_audit('product_price',p_price_id,'scheduled_price_updated',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when exclusion_violation then raise exception 'PRICE_PERIOD_OVERLAP';
end;
$function$;

create or replace function public.cancel_scheduled_product_price(p_actor_id uuid,p_price_id uuid,p_reason text)
returns public.product_prices language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_prices%rowtype; v_new public.product_prices%rowtype; v_reason text; v_product_id uuid;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',false);
  v_reason:=public._catalogue_require_reason(p_reason);
  select product_id into v_product_id from public.product_prices where id=p_price_id;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  perform 1 from public.products where id=v_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select * into v_old from public.product_prices where id=p_price_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.cancelled_at is not null or v_old.effective_from<=now() then raise exception 'EFFECTIVE_OR_CANCELLED_PRICE_IMMUTABLE'; end if;
  update public.product_prices set cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=v_reason,updated_by=p_actor_id
  where id=p_price_id returning * into v_new;
  perform public._catalogue_audit('product_price',p_price_id,'cancelled',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.get_effective_product_price(p_product_id uuid,p_at timestamptz default now())
returns public.product_prices language sql stable security definer set search_path = public
as $function$
  select * from public.product_prices where product_id=p_product_id and cancelled_at is null
    and effective_from<=p_at and (effective_until is null or effective_until>p_at) limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Global and product minimum price floors (Owner only)
-- ---------------------------------------------------------------------------

create or replace function public.create_global_minimum_price_floor(
  p_actor_id uuid,p_minimum_price_per_gram numeric,p_effective_from timestamptz,p_reason text
)
returns public.global_minimum_price_floors language plpgsql security definer set search_path = public
as $function$
declare
  v_row public.global_minimum_price_floors%rowtype;
  v_covering public.global_minimum_price_floors%rowtype;
  v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',true);
  v_reason:=public._catalogue_require_reason(p_reason);
  if p_minimum_price_per_gram<0 or p_effective_from is null or p_effective_from<=now() then
    raise exception 'INVALID_FLOOR_PERIOD_OR_AMOUNT';
  end if;

  -- Serialize all edits to the continuous global-floor timeline.
  perform pg_advisory_xact_lock(hashtext('marut_global_price_floor_chain'));

  -- Insert into any future interval, not only after the current tail.
  -- The new row inherits the covering interval's end, preserving continuity.
  select * into v_covering
  from public.global_minimum_price_floors
  where cancelled_at is null
    and effective_from < p_effective_from
    and (effective_until is null or effective_until > p_effective_from)
  order by effective_from desc
  limit 1
  for update;

  if not found then
    raise exception 'GLOBAL_FLOOR_INTERVAL_NOT_FOUND';
  end if;

  update public.global_minimum_price_floors
  set effective_until=p_effective_from,updated_by=p_actor_id
  where id=v_covering.id;

  insert into public.global_minimum_price_floors(
    minimum_price_per_gram,effective_from,effective_until,reason,created_by,updated_by
  )
  values(
    p_minimum_price_per_gram,p_effective_from,v_covering.effective_until,
    v_reason,p_actor_id,p_actor_id
  )
  returning * into v_row;

  perform public._catalogue_audit(
    'global_price_floor',v_row.id,'created',
    to_jsonb(v_covering),to_jsonb(v_row),v_reason,p_actor_id
  );
  return v_row;
exception when exclusion_violation then
  raise exception 'FLOOR_PERIOD_OVERLAP';
end;
$function$;

create or replace function public.update_scheduled_global_minimum_price_floor(
  p_actor_id uuid,p_floor_id uuid,p_minimum_price_per_gram numeric,p_effective_from timestamptz,p_reason text
)
returns public.global_minimum_price_floors language plpgsql security definer set search_path = public
as $function$
declare
  v_old public.global_minimum_price_floors%rowtype;
  v_new public.global_minimum_price_floors%rowtype;
  v_prev public.global_minimum_price_floors%rowtype;
  v_next public.global_minimum_price_floors%rowtype;
  v_reason text;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',true);
  v_reason:=public._catalogue_require_reason(p_reason);
  if p_minimum_price_per_gram<0 or p_effective_from<=now() then raise exception 'INVALID_FLOOR_PERIOD_OR_AMOUNT'; end if;
  perform pg_advisory_xact_lock(hashtext('marut_global_price_floor_chain'));
  select * into v_old from public.global_minimum_price_floors where id=p_floor_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.cancelled_at is not null or v_old.effective_from<=now() then raise exception 'EFFECTIVE_OR_CANCELLED_FLOOR_IMMUTABLE'; end if;
  select * into v_prev from public.global_minimum_price_floors
    where cancelled_at is null and effective_until=v_old.effective_from for update;
  if not found then raise exception 'GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR'; end if;
  select * into v_next from public.global_minimum_price_floors
    where cancelled_at is null and effective_from=v_old.effective_until for update;
  if v_next.id is not null and p_effective_from>=v_next.effective_from then
    raise exception 'FLOOR_DATE_CONFLICTS_WITH_NEXT_PERIOD';
  end if;
  if p_effective_from<=v_prev.effective_from then raise exception 'FLOOR_DATE_CONFLICTS_WITH_PREVIOUS_PERIOD'; end if;
  if p_effective_from < v_old.effective_from then
    -- Shrink predecessor first, then move this period earlier (no transient overlap).
    update public.global_minimum_price_floors set effective_until=p_effective_from,updated_by=p_actor_id where id=v_prev.id;
    update public.global_minimum_price_floors set minimum_price_per_gram=p_minimum_price_per_gram,
      effective_from=p_effective_from,reason=v_reason,updated_by=p_actor_id
    where id=p_floor_id returning * into v_new;
  else
    -- Move this period later first, then extend predecessor to close the gap.
    update public.global_minimum_price_floors set minimum_price_per_gram=p_minimum_price_per_gram,
      effective_from=p_effective_from,reason=v_reason,updated_by=p_actor_id
    where id=p_floor_id returning * into v_new;
    update public.global_minimum_price_floors set effective_until=p_effective_from,updated_by=p_actor_id where id=v_prev.id;
  end if;
  perform public._catalogue_audit('global_price_floor',p_floor_id,'scheduled_floor_updated',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when exclusion_violation then raise exception 'FLOOR_PERIOD_OVERLAP';
end;
$function$;

create or replace function public.cancel_scheduled_global_minimum_price_floor(p_actor_id uuid,p_floor_id uuid,p_reason text)
returns public.global_minimum_price_floors language plpgsql security definer set search_path = public
as $function$
declare v_old public.global_minimum_price_floors%rowtype; v_new public.global_minimum_price_floors%rowtype; v_reason text; v_prev public.global_minimum_price_floors%rowtype;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',true);
  v_reason:=public._catalogue_require_reason(p_reason);
  perform pg_advisory_xact_lock(hashtext('marut_global_price_floor_chain'));
  select * into v_old from public.global_minimum_price_floors where id=p_floor_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.cancelled_at is not null or v_old.effective_from<=now() then raise exception 'EFFECTIVE_OR_CANCELLED_FLOOR_IMMUTABLE'; end if;
  select * into v_prev from public.global_minimum_price_floors where cancelled_at is null and effective_until=v_old.effective_from for update;
  if not found then raise exception 'GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR'; end if;
  update public.global_minimum_price_floors set cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=v_reason,updated_by=p_actor_id
  where id=p_floor_id returning * into v_new;
  update public.global_minimum_price_floors set effective_until=v_old.effective_until,updated_by=p_actor_id where id=v_prev.id;
  perform public._catalogue_audit('global_price_floor',p_floor_id,'cancelled',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.create_product_minimum_price_floor(
  p_actor_id uuid,p_product_id uuid,p_minimum_price_per_gram numeric,p_effective_from timestamptz,p_effective_until timestamptz,p_reason text
)
returns public.product_minimum_price_floors language plpgsql security definer set search_path = public
as $function$
declare v_product public.products%rowtype; v_row public.product_minimum_price_floors%rowtype; v_reason text; v_effective_from timestamptz;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',true);
  v_reason:=public._catalogue_require_reason(p_reason);
  -- NULL means effective immediately; PostgreSQL supplies the authoritative timestamp.
  v_effective_from:=coalesce(p_effective_from,now());
  if p_minimum_price_per_gram<=0
     or (p_effective_from is not null and p_effective_from<now())
     or (p_effective_until is not null and p_effective_until<=v_effective_from) then
    raise exception 'INVALID_FLOOR_PERIOD_OR_AMOUNT';
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_product.status='archived' then raise exception 'PRODUCT_ARCHIVED'; end if;
  insert into public.product_minimum_price_floors(product_id,minimum_price_per_gram,effective_from,effective_until,reason,created_by,updated_by)
  values(p_product_id,p_minimum_price_per_gram,v_effective_from,p_effective_until,v_reason,p_actor_id,p_actor_id) returning * into v_row;
  perform public._catalogue_audit('product_price_floor',v_row.id,'created',null,to_jsonb(v_row),v_reason,p_actor_id);
  return v_row;
exception when exclusion_violation then raise exception 'FLOOR_PERIOD_OVERLAP';
end;
$function$;

create or replace function public.update_scheduled_product_minimum_price_floor(
  p_actor_id uuid,p_floor_id uuid,p_minimum_price_per_gram numeric,p_effective_from timestamptz,p_effective_until timestamptz,p_reason text
)
returns public.product_minimum_price_floors language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_minimum_price_floors%rowtype; v_new public.product_minimum_price_floors%rowtype; v_reason text; v_product_id uuid;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',true);
  v_reason:=public._catalogue_require_reason(p_reason);
  select product_id into v_product_id from public.product_minimum_price_floors where id=p_floor_id;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  perform 1 from public.products where id=v_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select * into v_old from public.product_minimum_price_floors where id=p_floor_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.cancelled_at is not null or v_old.effective_from<=now() then raise exception 'EFFECTIVE_OR_CANCELLED_FLOOR_IMMUTABLE'; end if;
  if p_minimum_price_per_gram<=0 or p_effective_from<=now() or (p_effective_until is not null and p_effective_until<=p_effective_from) then raise exception 'INVALID_FLOOR_PERIOD_OR_AMOUNT'; end if;
  update public.product_minimum_price_floors set minimum_price_per_gram=p_minimum_price_per_gram,effective_from=p_effective_from,effective_until=p_effective_until,reason=v_reason,updated_by=p_actor_id
  where id=p_floor_id returning * into v_new;
  perform public._catalogue_audit('product_price_floor',p_floor_id,'scheduled_floor_updated',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
exception when exclusion_violation then raise exception 'FLOOR_PERIOD_OVERLAP';
end;
$function$;

create or replace function public.cancel_scheduled_product_minimum_price_floor(p_actor_id uuid,p_floor_id uuid,p_reason text)
returns public.product_minimum_price_floors language plpgsql security definer set search_path = public
as $function$
declare v_old public.product_minimum_price_floors%rowtype; v_new public.product_minimum_price_floors%rowtype; v_reason text; v_product_id uuid;
begin
  perform public._catalogue_assert_actor(p_actor_id,'pricing',true);
  v_reason:=public._catalogue_require_reason(p_reason);
  select product_id into v_product_id from public.product_minimum_price_floors where id=p_floor_id;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  perform 1 from public.products where id=v_product_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  select * into v_old from public.product_minimum_price_floors where id=p_floor_id for update;
  if not found then raise exception 'ENTITY_NOT_FOUND'; end if;
  if v_old.cancelled_at is not null or v_old.effective_from<=now() then raise exception 'EFFECTIVE_OR_CANCELLED_FLOOR_IMMUTABLE'; end if;
  update public.product_minimum_price_floors set cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=v_reason,updated_by=p_actor_id
  where id=p_floor_id returning * into v_new;
  perform public._catalogue_audit('product_price_floor',p_floor_id,'cancelled',to_jsonb(v_old),to_jsonb(v_new),v_reason,p_actor_id);
  return v_new;
end;
$function$;

create or replace function public.get_effective_product_minimum_price_floor(p_product_id uuid,p_at timestamptz default now())
returns numeric language sql stable security definer set search_path = public
as $function$
  select greatest(
    coalesce((select g.minimum_price_per_gram from public.global_minimum_price_floors g
      where g.cancelled_at is null and g.effective_from<=p_at and (g.effective_until is null or g.effective_until>p_at) limit 1),0),
    coalesce((select f.minimum_price_per_gram from public.product_minimum_price_floors f
      where f.product_id=p_product_id and f.cancelled_at is null and f.effective_from<=p_at and (f.effective_until is null or f.effective_until>p_at) limit 1),0)
  );
$function$;

-- ---------------------------------------------------------------------------
-- 8. Function ownership and execution grants
-- ---------------------------------------------------------------------------
-- All RPCs execute as the database owner (postgres). service_role receives
-- EXECUTE only; direct table and sequence writes remain revoked by 0006.

do $grant$
declare r record;
begin
  -- Internal helpers are callable only by the owning SECURITY DEFINER RPCs.
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      '_catalogue_assert_actor','_catalogue_audit','_catalogue_require_reason','_catalogue_product_abbreviation'
    )
  loop
    execute format('alter function %s owner to postgres',r.signature);
    execute format('revoke all on function %s from public, anon, authenticated, service_role',r.signature);
  end loop;

  -- Public API RPCs: service_role EXECUTE only; no direct table/sequence writes.
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_product_category','update_product_category_details','reassign_product_category_vertical',
      'transition_product_category_status','delete_product_category','preview_product_sku','create_product',
      'update_product_details','transition_product_status','reassign_product_category','delete_product',
      'create_product_pack_size','transition_product_pack_size_status','delete_product_pack_size',
      'add_product_image','set_primary_product_image','update_product_image_details','remove_product_image',
      'create_product_price','update_scheduled_product_price','cancel_scheduled_product_price','get_effective_product_price',
      'create_global_minimum_price_floor','update_scheduled_global_minimum_price_floor','cancel_scheduled_global_minimum_price_floor',
      'create_product_minimum_price_floor','update_scheduled_product_minimum_price_floor','cancel_scheduled_product_minimum_price_floor',
      'get_effective_product_minimum_price_floor'
    )
  loop
    execute format('alter function %s owner to postgres',r.signature);
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end;
$grant$;

commit;

-- IMPORTANT REVIEW NOTES (not executable):
-- 1. Express must validate bearer token, admin profile and Staff module permission
--    before invoking RPCs. p_actor_id must come only from the verified session.
-- 2. Image MIME type and 5 MB limit are enforced by Express/Storage upload policy.
-- 3. Future Orders/Dispatch/Invoice migrations must add RESTRICT FKs to products,
--    pack sizes and categories, and capture immutable line snapshots.
-- 4. Global floor chain operations assume one open-ended final period; review
--    scheduled-floor edit/cancel behavior carefully before execution.
