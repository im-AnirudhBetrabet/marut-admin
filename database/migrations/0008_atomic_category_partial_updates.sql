-- MARUT Admin V2 — Migration 0008
-- Atomic partial updates for product categories.
--
-- Purpose:
--   Prevent concurrent PATCH requests from overwriting a category field that
--   was omitted by the caller. The database locks the category row first and
--   updates only the explicitly selected fields.
--
-- Dependencies:
--   Migration 0006 (product_categories, catalogue_audit_history)
--   Migration 0007 (catalogue helper functions and category RPC)
--
-- Execution:
--   Run once in Supabase SQL Editor after Migration 0007 has been executed.
--   This migration does not modify existing category data.

begin;

-- Remove the original all-fields update signature. The replacement has two
-- explicit field-selection flags and is called by the updated Express route.
drop function if exists public.update_product_category_details(
  uuid, uuid, text, text, text
);

create function public.update_product_category_details(
  p_actor_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_reason text,
  p_update_name boolean,
  p_update_description boolean
)
returns public.product_categories
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old public.product_categories%rowtype;
  v_new public.product_categories%rowtype;
  v_reason text;
  v_name text;
begin
  perform public._catalogue_assert_actor(p_actor_id, 'products', false);

  if coalesce(p_update_name, false) = false
     and coalesce(p_update_description, false) = false then
    raise exception 'CATEGORY_UPDATE_FIELDS_REQUIRED';
  end if;

  if p_update_name then
    v_name := nullif(btrim(p_name), '');
    if v_name is null then
      raise exception 'CATEGORY_NAME_REQUIRED';
    end if;
  end if;

  -- Serialize all category edits. Values for omitted fields are taken from
  -- this locked row, never from an earlier Express-side read.
  select *
    into v_old
    from public.product_categories
   where id = p_category_id
   for update;

  if not found then
    raise exception 'ENTITY_NOT_FOUND';
  end if;

  v_reason := case
    when p_update_name and v_name is distinct from v_old.name
      then public._catalogue_require_reason(p_reason)
    else null
  end;

  update public.product_categories
     set name = case when p_update_name then v_name else v_old.name end,
         description = case
           when p_update_description then p_description
           else v_old.description
         end,
         updated_by = p_actor_id
   where id = p_category_id
   returning * into v_new;

  perform public._catalogue_audit(
    'category',
    v_new.id,
    'details_updated',
    to_jsonb(v_old),
    to_jsonb(v_new),
    v_reason,
    p_actor_id
  );

  return v_new;

exception
  when unique_violation then
    raise exception 'DUPLICATE_RECORD';
end;
$function$;

alter function public.update_product_category_details(
  uuid, uuid, text, text, text, boolean, boolean
) owner to postgres;

revoke all on function public.update_product_category_details(
  uuid, uuid, text, text, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.update_product_category_details(
  uuid, uuid, text, text, text, boolean, boolean
) to service_role;

commit;

-- Post-migration contract:
--   * name-only PATCH: p_update_name=true, p_update_description=false
--   * description-only PATCH: p_update_name=false, p_update_description=true
--   * both fields: both flags true
--   * p_description=NULL with p_update_description=true intentionally clears it
--   * p_update_description=false preserves the locked row's current description
--   * name changes still require a reason; description-only changes do not
