import { Router }               from 'express';
import { z }                    from 'zod';
import { supabaseAdmin }        from '../../config/supabase.js';
import { requireAdmin }         from '../../middleware/require-admin.js';
import { HttpError, sendError } from '../../utils/http.js';

export const authRouter = Router();

authRouter.post('/check-email', async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email().transform(v => v.trim().toLowerCase()) }).parse(req.body);
    const { data, error } = await supabaseAdmin.from('admin_users').select('id,is_active').eq('email', email).maybeSingle();
    if (error) throw error;
    // Deliberately return no role, permissions, or account metadata.
    res.json({ authorised: Boolean(data?.is_active), can_login: Boolean(data?.is_active) });
  } catch (e) { 
        sendError(res, e); 
    }
});

authRouter.get('/me', requireAdmin, async (req, res) => {
  try {
    const admin = req.admin!;
    const { data: permissions, error } = await supabaseAdmin.from('admin_user_permissions').select('module_key,level').eq('admin_user_id', admin.id);
    if (error) throw error;
    res.json({ user: admin, role: admin.role, permissions: admin.role === 'owner' ? 'all' : permissions ?? [] });
  } catch (e) { 
        sendError(res, e); 
    }
});

authRouter.post('/logout', requireAdmin, async (_req, res) => {
  // Supabase access tokens are client-held. The frontend must also call supabase.auth.signOut().
  res.json({ success: true, message: 'Sign out from the Supabase client to clear the session.' });
});
