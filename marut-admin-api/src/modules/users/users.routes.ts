import { Router }                          from 'express';
import { z }                               from 'zod';
import { env }                             from '../../config/env.js';
import { supabaseAdmin }                   from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError }            from '../../utils/http.js';
import type { ModuleKey, PermissionLevel } from '../../types.js';

export const usersRouter = Router();
const moduleKeys         = ['users', 'verticals', 'products', 'pricing', 'catalogue', 'leads', 'analytics'] as const;
const permissionSchema   = z.array(z.object(
    {
        module_key: z.enum(moduleKeys),
        level     : z.enum(['view', 'manage']),
    }
)).max(moduleKeys.length);

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
    try {
        await requirePermission(req, 'users', 'manage');
        const { data: invitation, error } = await supabaseAdmin.from('admin_invitations').select('id,email,role,status,auth_user_id').eq('id', req.params.id).maybeSingle();
        if (error) {
            throw error;
        }
        if (!invitation) {
            throw new HttpError(404, 'Invitation not found.', 'INVITATION_NOT_FOUND');
        }
        if (invitation.status === 'accepted') {
            throw new HttpError(409, 'This invitation has already been accepted.', 'INVITATION_ALREADY_ACCEPTED');
        }
        if (invitation.role === 'owner' && req.admin!.role !== 'owner') {
            throw new HttpError(403, 'Only an owner can resend an owner invitation.', 'OWNER_REQUIRED');
        }

        // Supabase native invitation expiry is configured at project level (60 minutes).
        // Re-invite the same unconfirmed auth user through the Auth Admin API.
        const { error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(invitation.email, {
            redirectTo: `${env.FRONTEND_URL.replace(/\/$/, '')}/accept-invite`,
            data: { marut_invitation_id: invitation.id },
        });
        if (authError) {
            throw new HttpError(502, `Supabase could not resend the invitation: ${authError.message}`, 'INVITATION_RESEND_FAILED');
        }
        const expires = new Date(Date.now() + 3600000).toISOString();
        const { error: updateError } = await supabaseAdmin.from('admin_invitations')
            .update({ status: 'pending', expires_at: expires }).eq('id', invitation.id);
        if (updateError) throw updateError;
        res.json({ invitation_id: invitation.id, status: 'pending', expires_at: expires });
    } catch (e) { sendError(res, e); }
});

