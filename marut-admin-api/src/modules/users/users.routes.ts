import { Router }                          from 'express';
import { z }                               from 'zod';
import { env }                             from '../../config/env.js';
import { supabaseAdmin, supabasePublic }   from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError }            from '../../utils/http.js';
import type { ModuleKey, PermissionLevel } from '../../config/permissions.js';
import { MODULE_KEYS, PERMISSION_LEVELS }  from '../../config/permissions.js';

export const usersRouter = Router();
const permissionSchema   = z
  .array(
    z.object({
      module_key: z.enum(MODULE_KEYS),
      level: z.enum(PERMISSION_LEVELS),
    }),
  )
  .max(MODULE_KEYS.length)
  .superRefine((permissions, ctx) => {
    const seen = new Set<string>();

    permissions.forEach((permission, index) => {
      if (seen.has(permission.module_key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'module_key'],
          message: 'A module can only be assigned once.',
        });
      }

      seen.add(permission.module_key);
    });
  });

async function canGrant(inviterId: string, inviterRole: string, grants: { module_key: ModuleKey; level: PermissionLevel }[]) {
    if (inviterRole === 'owner') return;
    const { data, error } = await supabaseAdmin.from('admin_user_permissions').select('module_key,level').eq('admin_user_id', inviterId);
    if (error) {
        throw error;
    }
    const owned = new Map((data ?? []).map(p => [p.module_key, p.level]));
    for (const grant of grants) {
        const level = owned.get(grant.module_key);
        if (!level || (grant.level === 'manage' && level !== 'manage')) {
            throw new HttpError(403, `You cannot grant ${grant.level} access to ${grant.module_key}.`, 'CANNOT_GRANT_PERMISSION');
        }
    }
}

usersRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'users', 'view');
        const { data, error } = await supabaseAdmin.from('admin_users').select('id,email,display_name,role,is_active,created_at,last_sign_in_at').order('created_at', { ascending: false });
        if (error) {
            throw error;
        }
        res.json({ users: data ?? [] });
    } catch (e) { sendError(res, e); }
});


usersRouter.get('/invitations', requireAdmin, async (req, res) => {
    try {
        const admin = req.admin!;

        // Owners can see every invitation.
        // Staff must have users:manage and can see only invitations
        // that they initiated.
        if (admin.role !== 'owner') {
            await requirePermission(req, 'users', 'manage');
        }

        let query = supabaseAdmin
            .from('admin_invitations')
            .select(`
                id,
                email,
                display_name,
                role,
                status,
                invited_by,
                auth_user_id,
                expires_at,
                accepted_at,
                created_at,
                updated_at
            `)
            .order('created_at', { ascending: false });

        if (admin.role !== 'owner') {
            query = query.eq('invited_by', admin.id);
        }

        const { data, error } = await query;

        if (error) throw error;

        return res.json({
            invitations: data ?? [],
        });
    } catch (error) {
        return sendError(res, error);
    }
});


usersRouter.post('/invitations', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'users', 'manage');
        const body = z.object({
            email       : z.string().email().transform(v => v.trim().toLowerCase()),
            display_name: z.string().trim().max(120).optional(),
            role        : z.enum(['owner', 'staff']).default('staff'),
            permissions : permissionSchema.default([]),
        }).parse(req.body);
        const inviter = req.admin!;
        if (body.role === 'owner' && inviter.role !== 'owner') {
            throw new HttpError(403, 'Only an owner can invite another owner.', 'OWNER_REQUIRED');
        }
        if (body.role === 'owner' && body.permissions.length) {
            throw new HttpError(400, 'Owner permissions are implicit; do not assign individual permissions.', 'OWNER_PERMISSIONS_IMPLICIT');
        }
        if (body.role === 'staff' && inviter.role !== 'owner') {
            await canGrant(inviter.id, inviter.role, body.permissions);
        }

        const { data: existing, error: existingError } = await supabaseAdmin.from('admin_users').select('id').eq('email', body.email).maybeSingle();
        if (existingError) {
            throw existingError;
        }
        if (existing) {
            throw new HttpError(409, 'This email already has a MARUT Admin account.', 'ADMIN_ALREADY_EXISTS');
        }

        const { data: invitation, error: inviteDbError } = await supabaseAdmin.from('admin_invitations')
            .insert({
                email       : body.email, 
                role        : body.role, 
                display_name: body.display_name ?? null,
                invited_by  : inviter.id, 
                status      : 'sending', 
                expires_at  : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            }).select('id').single();
        if (inviteDbError) throw inviteDbError;
        if (body.role === 'staff' && body.permissions.length > 0) {
            const permissionRows = body.permissions.map(permission => ({
                invitation_id: invitation.id,
                module_key: permission.module_key,
                level: permission.level,
            }));

            const { error: permissionError } = await supabaseAdmin
                .from('admin_invitation_permissions')
                .insert(permissionRows);

            if (permissionError) {
                // Do not send an invitation if its permission snapshot
                // could not be persisted.
                await supabaseAdmin
                    .from('admin_invitations')
                    .update({ status: 'failed' })
                    .eq('id', invitation.id);

                throw permissionError;
            }
        }
        const { data: authInvite, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(body.email, {
            redirectTo: `${env.FRONTEND_URL.replace(/\/$/, '')}/accept-invite`,
            data: { marut_invitation_id: invitation.id, display_name: body.display_name ?? '' },
        });
        if (authError || !authInvite.user) {
            await supabaseAdmin.from('admin_invitations').update({ status: 'failed' }).eq('id', invitation.id);
            throw new HttpError(502, authError?.message ?? 'Supabase could not send the invitation.', 'INVITATION_EMAIL_FAILED');
        }

        const { error: bindError } = await supabaseAdmin.from('admin_invitations')
            .update({ auth_user_id: authInvite.user.id, status: 'pending' }).eq('id', invitation.id);
        if (bindError) throw bindError;

        res.status(201).json({ invitation_id: invitation.id, email: body.email, status: 'pending', expires_at: new Date(Date.now() + 3600000).toISOString() });
    } catch (e) { sendError(res, e); }
});



usersRouter.post('/invitations/:id/resend', requireAdmin, async (req, res) => {
    let invitationId: string | null = null;
    let claimedByThisRequest = false;

    try {
        await requirePermission(req, 'users', 'manage');

        const parsedId = z.string().uuid().safeParse(req.params.id);

        if (!parsedId.success) {
            throw new HttpError(
                400,
                'Invalid invitation ID.',
                'INVALID_INVITATION_ID',
            );
        }

        invitationId = parsedId.data;

        const { data: invitation, error } = await supabaseAdmin
            .from('admin_invitations')
            .select(`
                id,
                email,
                display_name,
                role,
                status,
                auth_user_id,
                invited_by
            `)
            .eq('id', invitationId)
            .maybeSingle();

        if (error) throw error;

        if (!invitation) {
            throw new HttpError(
                404,
                'Invitation not found.',
                'INVITATION_NOT_FOUND',
            );
        }

        if (invitation.status === 'accepted') {
            throw new HttpError(
                409,
                'This invitation has already been accepted.',
                'INVITATION_ALREADY_ACCEPTED',
            );
        }

        if (invitation.status === 'sending') {
            throw new HttpError(
                409,
                'This invitation is already being processed.',
                'INVITATION_ALREADY_SENDING',
            );
        }

        const actor = req.admin!;

        // Staff can resend only invitations they initiated.
        if (
            actor.role !== 'owner' &&
            invitation.invited_by !== actor.id
        ) {
            throw new HttpError(
                403,
                'You can only resend invitations you initiated.',
                'INVITATION_ACCESS_DENIED',
            );
        }

        if (
            invitation.role === 'owner' &&
            actor.role !== 'owner'
        ) {
            throw new HttpError(
                403,
                'Only an owner can resend an owner invitation.',
                'OWNER_REQUIRED',
            );
        }

        // Claim the invitation to prevent concurrent resend attempts.
        const { data: claimed, error: claimError } =
            await supabaseAdmin
                .from('admin_invitations')
                .update({ status: 'sending' })
                .eq('id', invitation.id)
                .eq('status', invitation.status)
                .select('id')
                .maybeSingle();

        if (claimError) throw claimError;

        if (!claimed) {
            throw new HttpError(
                409,
                'The invitation was modified by another request. Please retry.',
                'INVITATION_STATE_CHANGED',
            );
        }

        claimedByThisRequest = true;

        const redirectTo =
            `${env.FRONTEND_URL.replace(/\/$/, '')}/accept-invite`;

        // -----------------------------------------------------------------
        // Find and validate the existing Auth identity.
        // -----------------------------------------------------------------

        let existingAuthUser: Awaited<
            ReturnType<typeof supabaseAdmin.auth.admin.getUserById>
        >['data']['user'] = null;

        if (invitation.auth_user_id) {
            const { data: authData, error: authLookupError } =
                await supabaseAdmin.auth.admin.getUserById(
                    invitation.auth_user_id,
                );

            if (authLookupError) {
                const userMissing =
                    authLookupError.status === 404 ||
                    authLookupError.code === 'user_not_found';

                if (!userMissing) throw authLookupError;
            } else {
                existingAuthUser = authData.user;
            }
        }

        if (existingAuthUser) {
            // Verify that this identity belongs to this exact invitation.
            if (
                existingAuthUser.email?.toLowerCase() !==
                    invitation.email.toLowerCase() ||
                existingAuthUser.user_metadata?.marut_invitation_id !==
                    invitation.id
            ) {
                throw new HttpError(
                    409,
                    'The existing Auth account does not match this invitation. Manual review is required.',
                    'AUTH_IDENTITY_MISMATCH',
                );
            }

            // Never delete an identity that already has a MARUT profile.
            const { data: existingAdmin, error: adminLookupError } =
                await supabaseAdmin
                    .from('admin_users')
                    .select('id')
                    .eq('auth_user_id', existingAuthUser.id)
                    .maybeSingle();

            if (adminLookupError) throw adminLookupError;

            if (existingAdmin) {
                throw new HttpError(
                    409,
                    'This Auth identity already has a MARUT admin profile.',
                    'ADMIN_ALREADY_EXISTS',
                );
            }

            const isEmailVerified = Boolean(
                existingAuthUser.email_confirmed_at ||
                existingAuthUser.confirmed_at,
            );

            // =============================================================
            // PATH A: EMAIL ALREADY VERIFIED
            // Send a password-recovery email using Supabase.
            // The existing Auth identity and metadata remain untouched.
            // =============================================================

            if (isEmailVerified) {
                const { error: recoveryError } =
                    await supabasePublic.auth.resetPasswordForEmail(
                        invitation.email,
                        {
                            redirectTo,
                        },
                    );

                if (recoveryError) {
                    throw new HttpError(
                        502,
                        `Supabase could not send the onboarding recovery email: ${recoveryError.message}`,
                        'INVITATION_RECOVERY_EMAIL_FAILED',
                    );
                }

                const expires = new Date(
                    Date.now() + 60 * 60 * 1000,
                ).toISOString();

                const { error: updateError } = await supabaseAdmin
                    .from('admin_invitations')
                    .update({
                        status: 'pending',
                        expires_at: expires,
                    })
                    .eq('id', invitation.id)
                    .eq('status', 'sending');

                if (updateError) throw updateError;

                claimedByThisRequest = false;

                return res.json({
                    invitation_id: invitation.id,
                    email: invitation.email,
                    status: 'pending',
                    action: 'resume_onboarding',
                    expires_at: expires,
                    message: 'A secure onboarding recovery link has been sent.',
                });
            }

            // =============================================================
            // PATH B: EMAIL NOT VERIFIED
            // Delete only the unconfirmed identity belonging to this
            // invitation, then issue a fresh native Supabase invitation.
            // =============================================================

            const { error: deleteError } =
                await supabaseAdmin.auth.admin.deleteUser(
                    existingAuthUser.id,
                    false,
                );

            if (deleteError) throw deleteError;
        }

        // =============================================================
        // PATH C: NO EXISTING AUTH IDENTITY
        // Also used after successfully deleting an unconfirmed identity.
        // =============================================================

        const { data: authInvite, error: inviteError } =
            await supabaseAdmin.auth.admin.inviteUserByEmail(
                invitation.email,
                {
                    redirectTo,
                    data: {
                        marut_invitation_id: invitation.id,
                        display_name: invitation.display_name ?? '',
                    },
                },
            );

        if (inviteError || !authInvite.user) {
            throw new HttpError(
                502,
                `Supabase could not send the replacement invitation: ${
                    inviteError?.message ?? 'No Auth user returned.'
                }`,
                'INVITATION_RESEND_FAILED',
            );
        }

        const expires = new Date(
            Date.now() + 60 * 60 * 1000,
        ).toISOString();

        const { error: updateError } = await supabaseAdmin
            .from('admin_invitations')
            .update({
                auth_user_id: authInvite.user.id,
                status: 'pending',
                expires_at: expires,
            })
            .eq('id', invitation.id)
            .eq('status', 'sending');

        if (updateError) throw updateError;

        claimedByThisRequest = false;

        return res.json({
            invitation_id: invitation.id,
            email: invitation.email,
            status: 'pending',
            action: 'invitation_resent',
            expires_at: expires,
            message: 'A replacement invitation has been sent.',
        });

    } catch (error) {
        // Only modify status if this request successfully claimed it.
        if (invitationId && claimedByThisRequest) {
            await supabaseAdmin
                .from('admin_invitations')
                .update({ status: 'failed' })
                .eq('id', invitationId)
                .eq('status', 'sending');
        }

        return sendError(res, error);
    }
});




// -----------------------------------------------------------------------------
// Shared helper
// -----------------------------------------------------------------------------


async function getTargetAdmin(userId: string | string[] | undefined) {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new HttpError(
      400,
      'A valid user ID is required.',
      'INVALID_USER_ID',
    );
  }

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id,email,display_name,role,is_active')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new HttpError(
      404,
      'Admin user not found.',
      'USER_NOT_FOUND',
    );
  }

  return data;
}


// -----------------------------------------------------------------------------
// GET /api/v1/users/:id/permissions
// -----------------------------------------------------------------------------

usersRouter.get('/:id/permissions', requireAdmin, async (req, res) => {
  try {
    await requirePermission(req, 'users', 'view');

    const target = await getTargetAdmin(req.params.id);

    if (target.role === 'owner') {
      return res.json({
        user_id: target.id,
        role: target.role,
        permissions: 'all',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('admin_user_permissions')
      .select('module_key,level')
      .eq('admin_user_id', target.id)
      .order('module_key');

    if (error) throw error;

    return res.json({
      user_id: target.id,
      role: target.role,
      permissions: data ?? [],
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// -----------------------------------------------------------------------------
// PUT /api/v1/users/:id/permissions
// Replaces the complete permission set for a Staff account.
// -----------------------------------------------------------------------------

usersRouter.put('/:id/permissions', requireAdmin, async (req, res) => {
  try {
    await requirePermission(req, 'users', 'manage');

    const target = await getTargetAdmin(req.params.id);

    if (target.role === 'owner') {
      throw new HttpError(
        409,
        'Owner permissions are implicit and cannot be edited.',
        'OWNER_PERMISSIONS_IMPLICIT',
      );
    }

    const body = z.object({
      permissions: permissionSchema,
    }).parse(req.body);

    if (req.admin!.role !== 'owner') {
      await canGrant(req.admin!.id, req.admin!.role, body.permissions);
    }

    const { error } = await supabaseAdmin.rpc(
      'replace_admin_user_permissions',
      {
        p_admin_user_id: target.id,
        p_permissions: body.permissions,
      },
    );

    if (error) throw error;

    return res.json({
      user_id: target.id,
      permissions: body.permissions,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// -----------------------------------------------------------------------------
// PATCH /api/v1/users/:id/status
// -----------------------------------------------------------------------------

usersRouter.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    await requirePermission(req, 'users', 'manage');

    const body = z.object({
      is_active: z.boolean(),
    }).parse(req.body);

    const target = await getTargetAdmin(req.params.id);
    const actor = req.admin!;

    if (target.id === actor.id && body.is_active === false) {
      throw new HttpError(
        400,
        'You cannot deactivate your own account.',
        'SELF_DEACTIVATION_NOT_ALLOWED',
      );
    }

    if (target.role === 'owner' && actor.role !== 'owner') {
      throw new HttpError(
        403,
        'Only an owner can change another owner’s account status.',
        'OWNER_REQUIRED',
      );
    }

    const { data, error } = await supabaseAdmin
      .from('admin_users')
      .update({ is_active: body.is_active })
      .eq('id', target.id)
      .select('id,email,display_name,role,is_active')
      .single();

    if (error) {
      // The database owner-protection trigger may reject this operation.
      if (error.message.includes('LAST_ACTIVE_OWNER')) {
        throw new HttpError(
          409,
          'The last active owner cannot be deactivated.',
          'LAST_ACTIVE_OWNER',
        );
      }
      throw error;
    }

    return res.json({ user: data });
  } catch (error) {
    return sendError(res, error);
  }
});

// -----------------------------------------------------------------------------
// PATCH /api/v1/users/:id/role
// Owner-only promotion: Staff -> Owner.
// Owner demotion is intentionally not supported.
// -----------------------------------------------------------------------------

usersRouter.patch('/:id/role', requireAdmin, async (req, res) => {
  try {
    if (req.admin!.role !== 'owner') {
      throw new HttpError(
        403,
        'Only an owner can promote a Staff account to Owner.',
        'OWNER_REQUIRED',
      );
    }

    const body = z.object({
      role: z.literal('owner'),
    }).parse(req.body);

    const target = await getTargetAdmin(req.params.id);

    if (target.role === 'owner') {
      throw new HttpError(
        409,
        'This account is already an owner.',
        'USER_ALREADY_OWNER',
      );
    }

    const { error } = await supabaseAdmin.rpc(
      'promote_admin_user_to_owner',
      {
        p_admin_user_id: target.id,
      },
    );

    if (error) throw error;

    return res.json({
      user_id: target.id,
      role: body.role,
    });
  } catch (error) {
    return sendError(res, error);
  }
});
