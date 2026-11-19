import { Router }                          from 'express';
import { z }                               from 'zod';
import { supabaseAdmin }                   from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError }            from '../../utils/http.js';

export const verticalsRouter = Router();

const idSchema     = z.string().uuid();
const createSchema = z.object(
    {
        name       : z.string().trim().min(1).max(120),
        code       : z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
        description: z.string().trim().max(1000).nullable().optional(),
    }
).strict();
const detailsSchema = z.object(
    {
        name       : z.string().trim().min(1).max(120),
        description: z.string().trim().max(1000).nullable().optional(),
    }
).strict();
const statusSchema  = z.object({
    status: z.enum(['proposed', 'under_planning', 'setup_in_progress', 'operational', 'temporarily_suspended', 'closed']),
    reason: z.string().trim().min(1).max(1000),
}).strict();

const VERTICAL_COLUMNS = 'id,name,code,description,status,created_at,created_by,updated_at,updated_by';

function parseId(value: string | string[] | undefined): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, 'A valid vertical ID is required.', 'INVALID_VERTICAL_ID');
    return parsed.data;
}

async function getVertical(id: string) {
    const { data, error } = await supabaseAdmin.from('business_verticals').select(VERTICAL_COLUMNS).eq('id', id).maybeSingle();
    if (error) {
        throw error;
    }
    if (!data) { 
        throw new HttpError(404, 'Vertical not found.', 'VERTICAL_NOT_FOUND');
    }
    return data;
}

function mapVerticalError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';
    if (message.includes('VERTICAL_CODE_IMMUTABLE')) {
        throw new HttpError(409, 'A vertical code cannot be changed after creation.', 'VERTICAL_CODE_IMMUTABLE');
    }
    if (message.includes('VERTICAL_ACTOR_NOT_ACTIVE') || message.includes('VERTICAL_ACTOR_CONTEXT_REQUIRED')) {
        throw new HttpError(403, 'The acting admin is not authorised to make this change.', 'VERTICAL_ACTOR_INVALID');
    }
    if (message.includes('VERTICAL_STATUS_CHANGE_REASON_REQUIRED')) {
        throw new HttpError(400, 'A reason is required for a status change.', 'STATUS_REASON_REQUIRED');
    }
    if (message.includes('INVALID_VERTICAL_STATUS_TRANSITION')) {
        throw new HttpError(409, 'That status transition is not allowed.', 'INVALID_STATUS_TRANSITION');
    }
    if (message.includes('CLOSED_VERTICAL_CANNOT_BE_REOPENED')) {
        throw new HttpError(409, 'A closed vertical cannot be reopened.', 'VERTICAL_ALREADY_CLOSED');
    }
    if (message.includes('VERTICAL_NOT_FOUND')) {
        throw new HttpError(404, 'Vertical not found.', 'VERTICAL_NOT_FOUND');
    }
    if (error.code === '23505') {
        throw new HttpError(409, 'A vertical with this code already exists.', 'VERTICAL_CODE_ALREADY_EXISTS');
    }
    if (error.code === '23503') {
        throw new HttpError(409, 'This vertical is still referenced and cannot be deleted.', 'VERTICAL_IN_USE');
    }
    throw new Error(message || 'Vertical database operation failed.');
}

verticalsRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'view');
        const { data, error } = await supabaseAdmin.from('business_verticals').select(VERTICAL_COLUMNS).order('created_at', { ascending: true });
        if (error) {
            throw error;
        }
        return res.json({ verticals: data ?? [] });
    } catch (error) { 
        return sendError(res, error); 
    }
});

verticalsRouter.get('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'view');
        return res.json({ vertical: await getVertical(parseId(req.params.id)) });
    } catch (error) { 
        return sendError(res, error); 
    }
});

// New verticals always begin in Proposed; activation happens through the lifecycle endpoint.
verticalsRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'manage');
        const body = createSchema.parse(req.body);
        const actor = req.admin!;
        const { data, error } = await supabaseAdmin.from('business_verticals').insert({
            name       : body.name,
            code       : body.code,
            description: body.description ?? null,
            status     : 'proposed',
            created_by : actor.id,
            updated_by : actor.id,
        }).select(VERTICAL_COLUMNS).single();
        if (error) {
            mapVerticalError(error);
        }
        return res.status(201).json({ vertical: data });
    } catch (error) { 
        return sendError(res, error); 
    }
});

// Name and description edits are Owner-only and audited by the database RPC.
verticalsRouter.patch('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'manage');
        if (req.admin!.role !== 'owner') throw new HttpError(403, 'Only an Owner can edit a vertical name or description.', 'OWNER_REQUIRED');
        const id      = parseId(req.params.id);
        const body    = detailsSchema.parse(req.body);
        const current = await getVertical(id);
        const { data, error } = await supabaseAdmin.rpc('update_business_vertical_details', {
            p_vertical_id: id,
            p_name       : body.name,
            p_description: body.description === undefined ? current.description : body.description,
            p_actor_id   : req.admin!.id,
        });
        if (error) {
            mapVerticalError(error);
        }
        return res.json({ vertical: data });
    } catch (error) { 
        return sendError(res, error); 
    }
});

verticalsRouter.patch('/:id/status', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'manage');
        const id   = parseId(req.params.id);
        const body = statusSchema.parse(req.body);
        // Product reassignment/deactivation cannot yet be checked because the Products module is not implemented.
        if (body.status === 'closed') {
            throw new HttpError(409, 'A vertical cannot be closed until product reassignment and deactivation checks are available.', 'VERTICAL_CLOSURE_CHECK_UNAVAILABLE');
        }
        const { data, error } = await supabaseAdmin.rpc('transition_business_vertical', {
            p_vertical_id: id,
            p_new_status : body.status,
            p_reason     : body.reason,
            p_actor_id   : req.admin!.id,
        });
        if (error) {
            mapVerticalError(error);
        }
        return res.json({ vertical: data });
    } catch (error) { 
        return sendError(res, error); 
    }
});

verticalsRouter.get('/:id/history', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'view');
        const id = parseId(req.params.id);
        await getVertical(id);
        const [statusResult, nameResult] = await Promise.all([
            supabaseAdmin.from('business_vertical_status_history').select('id,vertical_id,vertical_code_snapshot,vertical_name_snapshot,previous_status,new_status,reason,changed_by,changed_at').eq('vertical_id', id).order('changed_at', { ascending: false }),
            supabaseAdmin.from('business_vertical_name_history').select('id,vertical_id,vertical_code_snapshot,previous_name,new_name,changed_by,changed_at').eq('vertical_id', id).order('changed_at', { ascending: false }),
        ]);
        if (statusResult.error) {
            throw statusResult.error;
        }
        if (nameResult.error) {
            throw nameResult.error;
        }
        const history = [
            ...(statusResult.data ?? []).map(item => ({ ...item, event_type: 'status' as const })),
            ...(nameResult.data ?? []).map(item => ({ ...item, event_type: 'name' as const })),
        ].sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
        return res.json({ history });
    } catch (error) { 
        return sendError(res, error); 
    }
});

verticalsRouter.delete('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'verticals', 'manage');
        const id = parseId(req.params.id);
        await getVertical(id);
        const { error } = await supabaseAdmin.from('business_verticals').delete().eq('id', id);
        if (error) {
            mapVerticalError(error);
        }
        return res.status(204).send();
    } catch (error) { 
        return sendError(res, error); 
    }
});
