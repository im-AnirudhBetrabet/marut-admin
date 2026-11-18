
import { Router }               from 'express';
import { z }                    from 'zod';
import { supabaseAdmin }        from '../../config/supabase.js';
import { HttpError, sendError } from '../../utils/http.js';

export const acceptInviteRouter = Router();

const acceptInvitationSchema = z.object({
    invitation_id: z.string().uuid(),
    display_name : z.string().trim().min(1).optional(),
});

acceptInviteRouter.post('/accept', async (req, res) => {
    try {
        // 1. Verify authenticated invitation session.
        const header = req.header('authorization');

        if (!header?.startsWith('Bearer ')) {
            throw new HttpError(
                401,
                'Authenticated invitation session required.',
                'AUTH_REQUIRED',
            );
        }

        const token = header.slice(7).trim();

        const { data: authData, error: authError } =
            await supabaseAdmin.auth.getUser(token);

        if (authError || !authData.user?.email) {
            throw new HttpError(
                401,
                'Invalid or expired invitation session.',
                'INVALID_SESSION',
            );
        }

        // 2. Validate request body.
        const body = acceptInvitationSchema.parse(req.body);

        // 3. Retrieve invitation.
        const { data: invitation, error } = await supabaseAdmin
            .from('admin_invitations')
            .select(`
                id,
                email,
                role,
                display_name,
                auth_user_id,
                status,
                expires_at
            `)
            .eq('id', body.invitation_id)
            .maybeSingle();

        if (error) throw error;

        if (!invitation) {
            throw new HttpError(
                404,
                'Invitation not found.',
                'INVITATION_NOT_FOUND',
            );
        }

        if (invitation.status !== 'pending') {
            throw new HttpError(
                409,
                'Invitation is not pending.',
                'INVITATION_NOT_PENDING',
            );
        }

        // 4. Check invitation expiry.
        if (new Date(invitation.expires_at).getTime() <= Date.now()) {
            const { error: expiryError } = await supabaseAdmin
                .from('admin_invitations')
                .update({ status: 'expired' })
                .eq('id', invitation.id);

            if (expiryError) throw expiryError;

            throw new HttpError(
                410,
                'Invitation has expired. Ask an administrator to resend it.',
                'INVITATION_EXPIRED',
            );
        }

        // 5. Verify invitation metadata.
        if (
            authData.user.user_metadata?.marut_invitation_id !==
            invitation.id
        ) {
            throw new HttpError(
                403,
                'Invitation metadata does not match this invitation.',
                'INVITATION_METADATA_MISMATCH',
            );
        }

        // 6. Verify authenticated identity.
        if (
            invitation.auth_user_id !== authData.user.id ||
            invitation.email.toLowerCase() !==
                authData.user.email.toLowerCase()
        ) {
            throw new HttpError(
                403,
                'This authenticated account does not match the invitation.',
                'INVITATION_IDENTITY_MISMATCH',
            );
        }

        // 7. Atomically accept invitation.
        const { data: accepted, error: acceptError } =
            await supabaseAdmin.rpc('accept_admin_invitation', {
                p_invitation_id: invitation.id,
                p_auth_user_id: authData.user.id,
                p_email: authData.user.email,
                p_display_name: body.display_name ?? null,
            });

        if (acceptError) {
            const msg = acceptError.message;

            if (msg.includes('INVITATION_NOT_FOUND')) {
                throw new HttpError(
                    404,
                    'Invitation not found.',
                    'INVITATION_NOT_FOUND',
                );
            }

            if (msg.includes('INVITATION_EXPIRED')) {
                throw new HttpError(
                    410,
                    'Invitation has expired. Ask an administrator to resend it.',
                    'INVITATION_EXPIRED',
                );
            }

            if (msg.includes('INVITATION_IDENTITY_MISMATCH')) {
                throw new HttpError(
                    403,
                    'This authenticated account does not match the invitation.',
                    'INVITATION_IDENTITY_MISMATCH',
                );
            }

            if (msg.includes('INVITATION_NOT_PENDING')) {
                throw new HttpError(
                    409,
                    'Invitation is not pending.',
                    'INVITATION_NOT_PENDING',
                );
            }

            throw acceptError;
        }

        // 8. Handle business errors returned as successful RPC data.
        if (accepted?.error === 'INVITATION_EXPIRED') {
            throw new HttpError(
                410,
                'Invitation has expired. Ask an administrator to resend it.',
                'INVITATION_EXPIRED',
            );
        }

        if (!accepted || accepted.error) {
            throw new HttpError(
                500,
                'Invitation acceptance could not be completed.',
                'INVITATION_ACCEPTANCE_FAILED',
            );
        }

        // 9. Return accepted admin profile.
        return res.status(201).json({
            success: true,
            user: accepted,
            next: 'login',
        });

    } catch (error) {
        return sendError(res, error);
    }
});
