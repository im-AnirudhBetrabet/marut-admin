
begin;

-- Remove the old signature to avoid overloaded RPC ambiguity.
drop function if exists public.accept_admin_invitation(
  uuid,
  uuid,
  text
);

create or replace function public.accept_admin_invitation(
  p_invitation_id uuid,
  p_auth_user_id uuid,
  p_email text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.admin_invitations%rowtype;
  created_admin public.admin_users%rowtype;
  v_display_name text;
begin
  -- Lock and retrieve invitation.
  select *
    into inv
    from public.admin_invitations
   where id = p_invitation_id
   for update;

  if not found then
    raise exception 'INVITATION_NOT_FOUND';
  end if;

  if inv.status <> 'pending' then
    raise exception 'INVITATION_NOT_PENDING';
  end if;

  if inv.expires_at <= now() then
    update public.admin_invitations
       set status = 'expired'
     where id = inv.id;

    return jsonb_build_object('error', 'INVITATION_EXPIRED');
  end if;

  -- Validate authenticated identity.
  if inv.auth_user_id is distinct from p_auth_user_id
     or lower(inv.email) <> lower(p_email) then
    raise exception 'INVITATION_IDENTITY_MISMATCH';
  end if;

  -- Use the invitee's updated name when supplied.
  -- Otherwise retain the name originally provided by the inviter.
  v_display_name := coalesce(
    nullif(btrim(p_display_name), ''),
    inv.display_name
  );

  if v_display_name is null then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;

  -- Create admin profile.
  insert into public.admin_users (
    auth_user_id,
    email,
    display_name,
    role,
    is_active
  )
  values (
    p_auth_user_id,
    lower(inv.email),
    v_display_name,
    inv.role,
    true
  )
  returning * into created_admin;

  -- Copy the approved permission snapshot for Staff.
  if inv.role = 'staff' then
    insert into public.admin_user_permissions (
      admin_user_id,
      module_key,
      level
    )
    select
      created_admin.id,
      module_key,
      level
    from public.admin_invitation_permissions
    where invitation_id = inv.id;
  end if;

  -- Finalize invitation.
  update public.admin_invitations
     set status = 'accepted',
         accepted_at = now()
   where id = inv.id;

  return jsonb_build_object(
    'id', created_admin.id,
    'email', created_admin.email,
    'display_name', created_admin.display_name,
    'role', created_admin.role,
    'is_active', created_admin.is_active
  );
end;
$$;

-- Restrict execution to the backend service role.
revoke all on function public.accept_admin_invitation(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.accept_admin_invitation(
  uuid, uuid, text, text
) to service_role;

commit;
