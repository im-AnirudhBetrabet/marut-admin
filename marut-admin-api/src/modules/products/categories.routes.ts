import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError } from '../../utils/http.js';

export const categoriesRouter = Router();

const idSchema     = z.string().uuid();
const statusSchema = z.enum(['active', 'inactive']);

const createCategorySchema = z.object({
    vertical_id: idSchema,
    name       : z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
}).strict();

const updateCategorySchema = z.object({
    name       : z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    reason     : z.string().trim().min(1).max(1000).optional(),
}).strict().refine(
    (data) =>
        data.name !== undefined || data.description !== undefined,
    {
        message: 'At least one field must be provided.',
    }
);

const reassignCategorySchema = z.object({
    vertical_id: idSchema,
    reason     : z.string().trim().min(1).max(1000),
}).strict();

const transitionCategorySchema = z.object({
    status: statusSchema,
    reason: z.string().trim().min(1).max(1000),
}).strict();

const deleteCategorySchema = z.object({
    reason: z.string().trim().min(1).max(1000),
}).strict();

const CATEGORY_SELECT = 'id,vertical_id,name,description,status,created_at,updated_at,created_by,updated_by,vertical:business_verticals(id,name,code,sku_prefix,status)' as const;

function parseId(value: string | string[] | undefined): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) {
        throw new HttpError(400, 'A valid category ID is required.', 'INVALID_CATEGORY_ID');
    }
    return parsed.data;
}

function mapCategoryError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';

    if (message.includes('ADMIN_NOT_FOUND')) {
        throw new HttpError(403, 'The acting admin account could not be verified.', 'ADMIN_NOT_FOUND');
    }
    if (message.includes('ADMIN_INACTIVE')) {
        throw new HttpError(403, 'The acting admin account is inactive.', 'ADMIN_INACTIVE');
    }
    if (message.includes('INSUFFICIENT_PERMISSION')) {
        throw new HttpError(403, 'You do not have the required permission for this operation.', 'INSUFFICIENT_PERMISSION');
    }
    if (message.includes('CATEGORY_NAME_REQUIRED')) {
        throw new HttpError(400, 'A category name is required.', 'CATEGORY_NAME_REQUIRED');
    }
    if (message.includes('VERTICAL_NOT_OPERATIONAL')) {
        throw new HttpError(409, 'The selected vertical must be Operational.', 'VERTICAL_NOT_OPERATIONAL');
    }
    if (message.includes('INVALID_STATUS_TRANSITION')) {
        throw new HttpError(409, 'That category status transition is not allowed.', 'INVALID_STATUS_TRANSITION');
    }
    if (message.includes('HISTORICAL_REFERENCE_EXISTS')) {
        throw new HttpError(409, 'This category has been referenced by a product or historical record and cannot be deleted.', 'CATEGORY_IN_USE');
    }
    if (message.includes('ENTITY_NOT_FOUND')) {
        throw new HttpError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
    }
    if (message.includes('REASON_REQUIRED')) {
        throw new HttpError(400, 'A reason is required for this change.', 'REASON_REQUIRED');
    }
    if (message.includes('DUPLICATE_RECORD') || error.code === '23505') {
        throw new HttpError(409, 'A category with this name already exists in the selected vertical.', 'CATEGORY_NAME_ALREADY_EXISTS');
    }
    if (message.includes('CATEGORY_UPDATE_FIELDS_REQUIRED')) {
        throw new HttpError(400, 'At least one of name or description must be supplied.', 'CATEGORY_UPDATE_FIELDS_REQUIRED');
    }
    if (error.code === '23503') {
        throw new HttpError(409, 'This category is still referenced and cannot be deleted.', 'CATEGORY_IN_USE');
    }

    throw new Error(message || 'Category database operation failed.');
}

type VerticalSummary = {
    id        : string;
    name      : string;
    code      : string;
    sku_prefix: string | null;
    status    : string;
};

type CategoryRecord = {
    id         : string;
    vertical_id: string;
    name       : string;
    description: string | null;
    status     : 'active' | 'inactive';
    created_at : string;
    updated_at : string;
    created_by : string | null;
    updated_by : string | null;
    vertical   : VerticalSummary | null;
};

type CategoryQueryRow = Omit<CategoryRecord, 'vertical'> & {
    vertical: VerticalSummary | VerticalSummary[] | null;
};

async function getCategory(id: string): Promise<CategoryRecord> {
    const { data, error } = await supabaseAdmin
        .from('product_categories')
        .select(CATEGORY_SELECT)
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new HttpError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
    }

    const row = data as unknown as CategoryQueryRow;

    return {
        ...row,
        vertical: Array.isArray(row.vertical) ? (row.vertical[0] ?? null) : (row.vertical ?? null)
    };
}

// List categories. Optional filters are intentionally limited to the approved
// category master dimensions; product availability is derived from category
// and vertical status rather than copied into this record.
categoriesRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');

        const querySchema = z.object(
            {
                vertical_id: idSchema.optional(),
                status     : statusSchema.optional(),
            }
        ).strict();
        const query = querySchema.parse(req.query);

        let request = supabaseAdmin.from('product_categories').select(CATEGORY_SELECT).order('name', { ascending: true });

        if (query.vertical_id) {
            request = request.eq('vertical_id', query.vertical_id);
        }
        if (query.status) {
            request = request.eq('status', query.status);
        }

        const { data, error } = await request;
        if (error) {
            throw error;
        }
        const categories = (data ?? []).map((item) => {
        const row = item as unknown as CategoryQueryRow;

        return {
            ...row,
            vertical: Array.isArray(row.vertical)
                ? (row.vertical[0] ?? null)
                : (row.vertical ?? null),
        };
    });

    return res.json({ categories });
    } catch (error) {
        return sendError(res, error);
    }
});

// Retrieve the category's unified catalogue audit trail.
categoriesRouter.get('/:id/history', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');
        const id = parseId(req.params.id);

        // Verify the category still exists. Deleted category audit rows remain
        // in catalogue_audit_history, but are not exposed through this route.
        await getCategory(id);

        const { data, error } = await supabaseAdmin
            .from('catalogue_audit_history')
            .select('id,entity_type,entity_id,action,previous_values,new_values,reason,actor_id,created_at,actor:admin_users(id,display_name,email)')
            .eq('entity_type', 'category')
            .eq('entity_id', id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        return res.json({ history: data ?? [] });
    } catch (error) {
        return sendError(res, error);
    }
});

// Retrieve one category with its current vertical classification.
categoriesRouter.get('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');
        return res.json({ category: await getCategory(parseId(req.params.id)) });
    } catch (error) {
        return sendError(res, error);
    }
});

// New categories are created Active only through the database RPC, which
// verifies that the selected vertical is Operational and records the audit.
categoriesRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const body = createCategorySchema.parse(req.body ?? {});

        const { data, error } = await supabaseAdmin.rpc('create_product_category', {
            p_actor_id   : req.admin!.id,
            p_vertical_id: body.vertical_id,
            p_name       : body.name,
            p_description: body.description ?? null,
        });

        if (error) mapCategoryError(error);

        const categoryId = (data as { id?: string } | null)?.id;
        if (!categoryId) {
            throw new HttpError(500, 'The category was created but its identifier was not returned.', 'CATEGORY_CREATE_RESPONSE_INVALID');
        }

        return res.status(201).json({ category: await getCategory(categoryId) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Category name changes require a reason. Description-only edits do not.
// Omitted description preserves the existing description.
categoriesRouter.patch('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');

        const id = parseId(req.params.id);
        const body = updateCategorySchema.parse(req.body ?? {});

        const updateName = body.name !== undefined;
        const updateDescription = body.description !== undefined;

        const { error } = await supabaseAdmin.rpc(
            'update_product_category_details',
            {
                p_actor_id: req.admin!.id,
                p_category_id: id,
                p_name: body.name ?? null,
                p_description: body.description ?? null,
                p_reason: body.reason ?? null,
                p_update_name: updateName,
                p_update_description: updateDescription,
            }
        );

        if (error) mapCategoryError(error);
        return res.json({ category: await getCategory(id) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Moving a category between verticals requires both products.manage and
// verticals.manage. The RPC verifies the target vertical is Operational.
// Product SKUs and historical transaction snapshots are not rewritten.
categoriesRouter.patch('/:id/vertical', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        await requirePermission(req, 'verticals', 'manage');

        const id   = parseId(req.params.id);
        const body = reassignCategorySchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('reassign_product_category_vertical', {
            p_actor_id       : req.admin!.id,
            p_category_id    : id,
            p_new_vertical_id: body.vertical_id,
            p_reason         : body.reason,
        });

        if (error) {
            mapCategoryError(error);
        }
        return res.json({ category: await getCategory(id) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Deactivation does not change product status. It makes products ineligible
// for new orders until the category is reactivated and its vertical is Operational.
categoriesRouter.patch('/:id/status', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');

        const id = parseId(req.params.id);
        const body = transitionCategorySchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('transition_product_category_status', {
            p_actor_id   : req.admin!.id,
            p_category_id: id,
            p_new_status : body.status,
            p_reason     : body.reason,
        });

        if (error) {
            mapCategoryError(error);
        }
        return res.json({ category: await getCategory(id) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Deletion is permitted only if the category has never been referenced by a
// product or historical product audit snapshot. The database RPC enforces this.
categoriesRouter.delete('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');

        const id   = parseId(req.params.id);
        const body = deleteCategorySchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('delete_product_category', {
            p_actor_id   : req.admin!.id,
            p_category_id: id,
            p_reason     : body.reason,
        });

        if (error) mapCategoryError(error);
        return res.status(204).send();
    } catch (error) {
        return sendError(res, error);
    }
});
