import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError } from '../../utils/http.js';

export const packSizesRouter = Router({ mergeParams: true });

const idSchema = z.string().uuid();
const packSizeStatusSchema = z.enum(['active', 'inactive']);

const createPackSizeSchema = z.object({
    weight_grams: z.number().int().positive(),
}).strict();

const transitionPackSizeSchema = z.object({
    status: packSizeStatusSchema,
    reason: z.string().trim().min(1).max(1000),
}).strict();

const deletePackSizeSchema = z.object({
    reason: z.string().trim().min(1).max(1000),
}).strict();

type PackSizeRecord = {
    id: string;
    product_id: string;
    weight_grams: number;
    status: 'active' | 'inactive';
    created_at: string;
    updated_at: string;
    created_by: string | null;
    updated_by: string | null;
};

function parseId(value: string | string[] | undefined, label: string): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) {
        throw new HttpError(400, `A valid ${label} is required.`, `INVALID_${label.toUpperCase().replaceAll(' ', '_')}`);
    }
    return parsed.data;
}

function mapPackSizeError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';

    const mappings: Array<[string, number, string, string]> = [
        ['ADMIN_NOT_FOUND', 403, 'ADMIN_NOT_FOUND', 'The acting admin account could not be verified.'],
        ['ADMIN_INACTIVE', 403, 'ADMIN_INACTIVE', 'The acting admin account is inactive.'],
        ['INSUFFICIENT_PERMISSION', 403, 'INSUFFICIENT_PERMISSION', 'You do not have the required permission for this operation.'],
        ['ENTITY_NOT_FOUND', 404, 'PACK_SIZE_NOT_FOUND', 'The requested product or pack size was not found.'],
        ['INVALID_PACK_SIZE', 400, 'INVALID_PACK_SIZE', 'Pack size must be a positive whole number of grams.'],
        ['DUPLICATE_RECORD', 409, 'PACK_SIZE_ALREADY_EXISTS', 'This pack size already exists for the product, including inactive pack sizes.'],
        ['INVALID_STATUS_TRANSITION', 409, 'INVALID_STATUS_TRANSITION', 'That pack-size status transition is not allowed.'],
        ['PRODUCT_NOT_ACTIVE', 409, 'PRODUCT_NOT_ACTIVE', 'The product must be Active before a pack size can be reactivated.'],
        ['PRODUCT_NOT_ORDER_ELIGIBLE', 409, 'PRODUCT_NOT_ORDER_ELIGIBLE', 'The product category must be Active and its vertical Operational before reactivation.'],
        ['PRODUCT_ARCHIVED', 409, 'PRODUCT_ARCHIVED', 'Archived products cannot be modified.'],
        ['REASON_REQUIRED', 400, 'REASON_REQUIRED', 'A reason is required for this change.'],
        ['HISTORICAL_REFERENCE_EXISTS', 409, 'PACK_SIZE_HAS_HISTORY', 'This pack size is referenced by historical records and cannot be deleted.'],
    ];

    for (const [token, status, code, publicMessage] of mappings) {
        if (message.includes(token)) {
            throw new HttpError(status, publicMessage, code);
        }
    }

    if (error.code === '23503') {
        throw new HttpError(409, 'This pack size is referenced and cannot be deleted.', 'PACK_SIZE_HAS_HISTORY');
    }

    throw new Error(message || 'Pack-size database operation failed.');
}

async function getProductPackSizes(productId: string): Promise<PackSizeRecord[]> {
    const { data, error } = await supabaseAdmin
        .from('product_pack_sizes')
        .select('id,product_id,weight_grams,status,created_at,updated_at,created_by,updated_by')
        .eq('product_id', productId)
        .order('weight_grams', { ascending: true });

    if (error) throw error;
    return (data ?? []) as PackSizeRecord[];
}

async function getPackSize(productId: string, packSizeId: string): Promise<PackSizeRecord> {
    const { data, error } = await supabaseAdmin
        .from('product_pack_sizes')
        .select('id,product_id,weight_grams,status,created_at,updated_at,created_by,updated_by')
        .eq('product_id', productId)
        .eq('id', packSizeId)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        throw new HttpError(404, 'Pack size not found for this product.', 'PACK_SIZE_NOT_FOUND');
    }
    return data as PackSizeRecord;
}

// List all pack sizes, including inactive options, for one product.
packSizesRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');
        const productId = parseId(req.params.productId, 'product ID');

        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id')
            .eq('id', productId)
            .maybeSingle();

        if (productError) throw productError;
        if (!product) {
            throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
        }

        return res.json({ pack_sizes: await getProductPackSizes(productId) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Add a pack size. Weight is immutable after creation; create a new option
// rather than editing an existing weight.
packSizesRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const body = createPackSizeSchema.parse(req.body ?? {});

        const { data, error } = await supabaseAdmin.rpc('create_product_pack_size', {
            p_actor_id: req.admin!.id,
            p_product_id: productId,
            p_weight_grams: body.weight_grams,
        });

        if (error) mapPackSizeError(error);

        const createdValue = Array.isArray(data) ? data[0] : data;
        const created = createdValue as { id?: string } | null;
        if (!created?.id) {
            throw new HttpError(500, 'The pack size was created but its identifier was not returned.', 'PACK_SIZE_CREATE_RESPONSE_INVALID');
        }

        return res.status(201).json({ pack_size: await getPackSize(productId, created.id) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Only Active <-> Inactive is supported. Reactivation eligibility is enforced
// inside the database RPC; deactivation remains allowed for referenced sizes.
packSizesRouter.patch('/:packSizeId/status', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const packSizeId = parseId(req.params.packSizeId, 'pack size ID');
        const body = transitionPackSizeSchema.parse(req.body ?? {});

        // Verify ownership before mutation. Without this pre-check, a caller
        // could supply Product A's URL with Product B's pack-size ID.
        await getPackSize(productId, packSizeId);

        const { error } = await supabaseAdmin.rpc('transition_product_pack_size_status', {
            p_actor_id: req.admin!.id,
            p_pack_size_id: packSizeId,
            p_new_status: body.status,
            p_reason: body.reason,
        });

        if (error) mapPackSizeError(error);
        return res.json({ pack_size: await getPackSize(productId, packSizeId) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Physical deletion is permitted only when no historical transaction references
// the pack size. The database RPC performs the authoritative FK check and audit.
packSizesRouter.delete('/:packSizeId', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const packSizeId = parseId(req.params.packSizeId, 'pack size ID');
        const body = deletePackSizeSchema.parse(req.body ?? {});

        // Confirm the pack size belongs to the product in the URL before calling
        // the ID-based database function.
        await getPackSize(productId, packSizeId);

        const { error } = await supabaseAdmin.rpc('delete_product_pack_size', {
            p_actor_id: req.admin!.id,
            p_pack_size_id: packSizeId,
            p_reason: body.reason,
        });

        if (error) mapPackSizeError(error);
        return res.status(204).send();
    } catch (error) {
        return sendError(res, error);
    }
});
