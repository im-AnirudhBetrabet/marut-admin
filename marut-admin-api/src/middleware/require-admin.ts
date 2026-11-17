import type { NextFunction, Request, Response }       from 'express';
import { supabaseAdmin }                              from '../config/supabase.js';
import { HttpError }                                  from '../utils/http.js';
import type { AdminUser, ModuleKey, PermissionLevel } from '../types.js';

declare global {
  namespace Express {
    interface Request {
      admin?      : AdminUser;
      bearerToken?: string;
    }
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
    }
    const token = header.slice(7).trim();
    
    if (!token) {
        throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) {
        throw new HttpError(401, 'Invalid or expired session.', 'INVALID_SESSION');
    }

    const { data: admin, error } = await supabaseAdmin.from('admin_users').select('id, auth_user_id, email, display_name, role, is_active').eq('auth_user_id', authData.user.id).maybeSingle();

    if (error) throw error;
    if (!admin || !admin.is_active || admin.email.toLowerCase() !== (authData.user.email ?? '').toLowerCase()) {
      throw new HttpError(403, 'This account is not authorised for MARUT Admin.', 'ADMIN_ACCESS_DENIED');
    }
    req.admin       = admin as AdminUser;
    req.bearerToken = token;
    next();
  } catch (error) { next(error); }
}

export async function requirePermission(req: Request, moduleKey: ModuleKey, minimum: PermissionLevel = 'view') {
    const admin = req.admin;
    if (!admin) {
        throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
    }
    if (admin.role === 'owner') return;
    const { data, error } = await supabaseAdmin.from('admin_user_permissions').select('level').eq('admin_user_id', admin.id).eq('module_key', moduleKey).maybeSingle();
    if (error) throw error;
    const allowed = data?.level === 'manage' || (minimum === 'view' && data?.level === 'view');
    if (!allowed) {
        throw new HttpError(403, `You do not have ${minimum} permission for ${moduleKey}.`, 'INSUFFICIENT_PERMISSION');
    }
}
