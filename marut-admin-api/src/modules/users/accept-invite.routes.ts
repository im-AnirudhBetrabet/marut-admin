import { Router }               from 'express';
import { z }                    from 'zod';
import { supabaseAdmin }        from '../../config/supabase.js';
import { HttpError, sendError } from '../../utils/http.js';

export const acceptInviteRouter = Router();

acceptInviteRouter.post('/accept', async (req, res) => {
    try {
        const header = req.header('authorization');
        if (!header?.startsWith('Bearer ')) {
            throw new HttpError(401, 'Authenticated invitation session required.', 'AUTH_REQUIRED');
        }
        const token = header.slice(7).trim();
        const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !authData.user?.email) {
            throw new HttpError(401, 'Invalid or expired invitation session.', 'INVALID_SESSION');
        }

        const body = z.object({ invitation_id: z.string().uuid() }).parse(req.body);
        const { data: invitation, error } = await supabaseAdmin.from('admin_invitations').select('id,email,role,display_name,auth_user_id,status,expires_at').eq('id', body.invitation_id).maybeSingle();
        if (error) throw error;
        if (!invitation) throw new HttpError(404, 'Invitation not found.', 'INVITATION_NOT_FOUND');
        if (invitation.status !== 'pending') throw new HttpError(409, 'Invitation is not pending.', 'INVITATION_NOT_PENDING');
        if (new Date(invitation.expires_at).getTime() < Date.now()) {
            await supabaseAdmin.from('admin_invitations').update({ status: 'expired' }).eq('id', invitation.id);
            throw new HttpError(410, 'Invitation has expired. Ask an administrator to resend it.', 'INVITATION_EXPIRED');
        }
        if (authData.user.user_metadata?.marut_invitation_id !== invitation.id) {
            throw new HttpError(403, 'Invitation metadata does not match this invitation.', 'INVITATION_METADATA_MISMATCH');
        }
        if (invitation.auth_user_id !== authData.user.id ||
            invitation.email.toLowerCase() !== authData.user.email.toLowerCase()) {
            throw new HttpError(403, 'This authenticated account does not match the invitation.', 'INVITATION_IDENTITY_MISMATCH');
        }

        const { data: accepted, error: acceptError } = await supabaseAdmin.rpc('accept_admin_invitation', {
            p_invitation_id: invitation.id,
            p_auth_user_id: authData.user.id,
            p_email: authData.user.email,
        });
        if (acceptError) {
            const msg = acceptError.message;
            if (msg.includes('INVITATION_EXPIRED')) {
                throw new HttpError(410, 'Invitation has expired. Ask an administrator to resend it.', 'INVITATION_EXPIRED');
            }
            if (msg.includes('INVITATION_IDENTITY_MISMATCH')) {
                throw new HttpError(403, 'This authenticated account does not match the invitation.', 'INVITATION_IDENTITY_MISMATCH');
            }
            if (msg.includes('INVITATION_NOT_PENDING')) {
                throw new HttpError(409, 'Invitation is not pending.', 'INVITATION_NOT_PENDING');
            }
            throw acceptError;
        }
        res.status(201).json({ 
            success: true, 
            user   : accepted, 
            next   : 'login' 
        });
    } catch (e) { 
        sendError(res, e); 
    }
});
