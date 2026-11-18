
-- MARUT Admin Release 1.1
-- Convert module_key columns to the canonical PostgreSQL enum.

begin;

do $$
begin
  create type public.admin_module as enum (
    'users',
    'verticals',
    'products',
    'pricing',
    'catalogue',
    'leads',
    'analytics'
  );
exception
  when duplicate_object then
    null;
end
$$;

-- Remove the original text-based CHECK constraints.
alter table public.admin_user_permissions
  drop constraint if exists admin_user_permissions_module_key_check;

alter table public.admin_invitation_permissions
  drop constraint if exists admin_invitation_permissions_module_key_check;

-- Convert the columns while preserving existing values.
do $$
begin
  if (
    select udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_user_permissions'
      and column_name = 'module_key'
  ) <> 'admin_module' then
    alter table public.admin_user_permissions
      alter column module_key type public.admin_module
      using module_key::public.admin_module;
  end if;

  if (
    select udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_invitation_permissions'
      and column_name = 'module_key'
  ) <> 'admin_module' then
    alter table public.admin_invitation_permissions
      alter column module_key type public.admin_module
      using module_key::public.admin_module;
  end if;
end
$$;

commit;
