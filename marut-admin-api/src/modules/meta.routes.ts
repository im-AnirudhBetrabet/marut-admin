
import { Router }                         from 'express';
import {ADMIN_MODULES, PERMISSION_LEVELS} from '../config/permissions.js';
import { requireAdmin }                   from '../middleware/require-admin.js';
import { supabaseAdmin }                  from '../config/supabase.js';
import { sendError }                      from '../utils/http.js';

export const metaRouter = Router();

metaRouter.get('/modules', requireAdmin, async (req, res) => {
  try {
    // Owners have implicit access to every module.
    if (req.admin!.role === 'owner') {
      return res.json({
        modules: ADMIN_MODULES.map((module) => ({
          ...module,
          permissions: [...PERMISSION_LEVELS],
        })),
      });
    }

    // Staff can only grant permissions they themselves possess.
    const { data, error } = await supabaseAdmin
      .from('admin_user_permissions')
      .select('module_key, level')
      .eq('admin_user_id', req.admin!.id);

    if (error) throw error;

    const permissions = new Map(
      (data ?? []).map((permission) => [
        permission.module_key,
        permission.level,
      ]),
    );

    const modules = ADMIN_MODULES
      .filter((module) => permissions.has(module.key))
      .map((module) => ({
        ...module,
        permissions:
          permissions.get(module.key) === 'manage'
            ? ['view', 'manage']
            : ['view'],
      }));

    return res.json({ modules });
  } catch (error) {
    return sendError(res, error);
  }
});
