import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError } from '../../utils/http.js';

export const minimumPriceFloorsRouter = Router({ mergeParams: true });
export const globalPriceFloorsRouter = Router();

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const reasonSchema = z.string().trim().min(1).max(1000);
const globalFloorAmountSchema = z.number().min(0).max(99999999.9999).refine(
    value => Number.isFinite(value) && Number(value.toFixed(4)) === value,
    'Floor must have no more than four decimal places.',
);
const productFloorAmountSchema = z.number().positive().max(99999999.9999).refine(
    value => Number.isFinite(value) && Number(value.toFixed(4)) === value,
    'Floor must have no more than four decimal places.',
);
const cancelSchema = z.object({ reason: reasonSchema }).strict();

function parseId(value: string | string[] | undefined, label: string): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, `A valid ${label} is required.`, `INVALID_${label.toUpperCase().replaceAll(' ', '_')}`);
    return parsed.data;
}

function normalizeRpcRow<T>(data: unknown): T | null {
    const value = Array.isArray(data) ? data[0] : data;
    return value && typeof value === 'object' ? value as T : null;
}

function requireOwnerRole(admin: { role?: string } | undefined): void {
    if (admin?.role !== 'owner') {
        throw new HttpError(403, 'Only an Owner can manage minimum price floors.', 'OWNER_REQUIRED');
    }
}

function periodStatus(row: { effective_from: string; effective_until: string | null; cancelled_at: string | null }, now = Date.now()) {
    if (row.cancelled_at) return 'cancelled' as const;
    if (Date.parse(row.effective_from) > now) return 'scheduled' as const;
    if (!row.effective_until || Date.parse(row.effective_until) > now) return 'effective' as const;
    return 'expired' as const;
}

function mapFloorError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';
    const mappings: Array<[string, number, string, string]> = [
        ['ADMIN_NOT_FOUND', 403, 'ADMIN_NOT_FOUND', 'The acting admin account could not be verified.'],
        ['ADMIN_INACTIVE', 403, 'ADMIN_INACTIVE', 'The acting admin account is inactive.'],
        ['OWNER_REQUIRED', 403, 'OWNER_REQUIRED', 'Only an Owner can manage minimum price floors.'],
        ['INSUFFICIENT_PERMISSION', 403, 'INSUFFICIENT_PERMISSION', 'You do not have pricing management permission.'],
        ['ENTITY_NOT_FOUND', 404, 'FLOOR_NOT_FOUND', 'The requested floor record or product was not found.'],
        ['PRODUCT_ARCHIVED', 409, 'PRODUCT_ARCHIVED', 'Archived products cannot receive product-specific floor changes.'],
        ['REASON_REQUIRED', 400, 'REASON_REQUIRED', 'A reason is required for this change.'],
        ['INVALID_FLOOR_PERIOD_OR_AMOUNT', 400, 'INVALID_FLOOR_PERIOD_OR_AMOUNT', 'Enter a valid floor amount and effective period.'],
        ['FLOOR_PERIOD_OVERLAP', 409, 'FLOOR_PERIOD_OVERLAP', 'This floor period overlaps another non-cancelled period.'],
        ['EFFECTIVE_OR_CANCELLED_FLOOR_IMMUTABLE', 409, 'FLOOR_IMMUTABLE', 'An effective or cancelled floor cannot be changed or cancelled.'],
        ['GLOBAL_FLOOR_INTERVAL_NOT_FOUND', 409, 'GLOBAL_FLOOR_INTERVAL_NOT_FOUND', 'The global floor timeline could not be updated at that date.'],
        ['FLOOR_DATE_CONFLICTS_WITH_NEXT_PERIOD', 409, 'FLOOR_DATE_CONFLICTS_WITH_NEXT_PERIOD', 'The new effective date conflicts with the next floor period.'],
        ['FLOOR_DATE_CONFLICTS_WITH_PREVIOUS_PERIOD', 409, 'FLOOR_DATE_CONFLICTS_WITH_PREVIOUS_PERIOD', 'The new effective date conflicts with the previous floor period.'],
        ['GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR', 409, 'GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR', 'The global floor timeline needs administrative review.'],
    ];
    for (const [token, status, code, publicMessage] of mappings) {
        if (message.includes(token)) throw new HttpError(status, publicMessage, code);
    }
    throw new Error(message || 'Minimum price floor operation failed.');
}

const globalSelect = 'id,minimum_price_per_gram,effective_from,effective_until,created_at,created_by,updated_at,updated_by,reason,cancelled_at,cancelled_by,cancellation_reason' as const;
const productSelect = 'id,product_id,minimum_price_per_gram,effective_from,effective_until,created_at,created_by,updated_at,updated_by,reason,cancelled_at,cancelled_by,cancellation_reason' as const;

const globalCreateSchema = z.object({
    minimum_price_per_gram: globalFloorAmountSchema,
    effective_from: timestampSchema,
    reason: reasonSchema,
}).strict();

const globalUpdateSchema = z.object({
    minimum_price_per_gram: globalFloorAmountSchema,
    effective_from: timestampSchema,
    reason: reasonSchema,
}).strict();

const productCreateSchema = z.object({
    minimum_price_per_gram: productFloorAmountSchema,
    effective_from: timestampSchema.nullable().optional(),
    effective_until: timestampSchema.nullable().optional(),
    reason: reasonSchema,
}).strict();

const productUpdateSchema = z.object({
    minimum_price_per_gram: productFloorAmountSchema,
    effective_from: timestampSchema,
    effective_until: timestampSchema.nullable(),
    reason: reasonSchema,
}).strict();

// Resolve the applicable floor: MAX(global floor, product-specific floor).
minimumPriceFloorsRouter.get('/effective', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'view');
        const productId = parseId(req.params.productId, 'product ID');
        const { data: product, error: productError } = await supabaseAdmin
            .from('products').select('id').eq('id', productId).maybeSingle();
        if (productError) throw productError;
        if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');

        const at = req.query.at === undefined ? null : timestampSchema.parse(req.query.at);
        const { data, error } = await supabaseAdmin.rpc('get_effective_product_minimum_price_floor', {
            p_product_id: productId, ...(at ? { p_at: at } : {}),
        });
        if (error) throw error;
        return res.json({
            minimum_price_per_gram: data === null ? null : Number(data),
            effective_at: at ?? 'database_now',
        });
    } catch (error) { return sendError(res, error); }
});

// Product-specific floors. Owner-only is enforced inside the database RPC;
// Express also checks the general pricing module permission.
minimumPriceFloorsRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'view');
        const productId = parseId(req.params.productId, 'product ID');
        const { data: product, error: productError } = await supabaseAdmin
            .from('products').select('id').eq('id', productId).maybeSingle();
        if (productError) throw productError;
        if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');

        const { data, error } = await supabaseAdmin.from('product_minimum_price_floors')
            .select(productSelect).eq('product_id', productId).order('effective_from', { ascending: false });
        if (error) throw error;
        const now = Date.now();
        return res.json({
            floors: (data ?? []).map(row => ({ ...row, period_status: periodStatus(row, now) })),
        });
    } catch (error) { return sendError(res, error); }
});

minimumPriceFloorsRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        requireOwnerRole(req.admin);
        const productId = parseId(req.params.productId, 'product ID');
        const body = productCreateSchema.parse(req.body ?? {});
        const { data, error } = await supabaseAdmin.rpc('create_product_minimum_price_floor', {
            p_actor_id: req.admin!.id, p_product_id: productId,
            p_minimum_price_per_gram: body.minimum_price_per_gram,
            p_effective_from: body.effective_from ?? null,
            p_effective_until: body.effective_until ?? null,
            p_reason: body.reason,
        });
        if (error) mapFloorError(error);
        const floor = normalizeRpcRow<Record<string, unknown>>(data);
        if (!floor) throw new HttpError(500, 'The floor was created but no record was returned.', 'FLOOR_CREATE_RESPONSE_INVALID');
        return res.status(201).json({ floor: { ...floor, period_status: periodStatus(floor as never) } });
    } catch (error) { return sendError(res, error); }
});

minimumPriceFloorsRouter.patch('/:floorId', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        requireOwnerRole(req.admin);
        const productId = parseId(req.params.productId, 'product ID');
        const floorId = parseId(req.params.floorId, 'floor ID');
        const body = productUpdateSchema.parse(req.body ?? {});
        const { data: existing, error: existingError } = await supabaseAdmin.from('product_minimum_price_floors')
            .select('id').eq('id', floorId).eq('product_id', productId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) throw new HttpError(404, 'Floor record not found for this product.', 'FLOOR_NOT_FOUND');

        const { data, error } = await supabaseAdmin.rpc('update_scheduled_product_minimum_price_floor', {
            p_actor_id: req.admin!.id, p_floor_id: floorId,
            p_minimum_price_per_gram: body.minimum_price_per_gram,
            p_effective_from: body.effective_from,
            p_effective_until: body.effective_until,
            p_reason: body.reason,
        });
        if (error) mapFloorError(error);
        const floor = normalizeRpcRow<Record<string, unknown>>(data);
        if (!floor) throw new HttpError(500, 'The floor was updated but no record was returned.', 'FLOOR_UPDATE_RESPONSE_INVALID');
        return res.json({ floor: { ...floor, period_status: periodStatus(floor as never) } });
    } catch (error) { return sendError(res, error); }
});

minimumPriceFloorsRouter.post('/:floorId/cancel', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        requireOwnerRole(req.admin);
        const productId = parseId(req.params.productId, 'product ID');
        const floorId = parseId(req.params.floorId, 'floor ID');
        const body = cancelSchema.parse(req.body ?? {});
        const { data: existing, error: existingError } = await supabaseAdmin.from('product_minimum_price_floors')
            .select('id').eq('id', floorId).eq('product_id', productId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) throw new HttpError(404, 'Floor record not found for this product.', 'FLOOR_NOT_FOUND');

        const { data, error } = await supabaseAdmin.rpc('cancel_scheduled_product_minimum_price_floor', {
            p_actor_id: req.admin!.id, p_floor_id: floorId, p_reason: body.reason,
        });
        if (error) mapFloorError(error);
        const floor = normalizeRpcRow<Record<string, unknown>>(data);
        return res.json({ floor: floor ? { ...floor, period_status: periodStatus(floor as never) } : null });
    } catch (error) { return sendError(res, error); }
});

// Global floor timeline. The database enforces Owner-only access and timeline continuity.
globalPriceFloorsRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'view');
        const { data, error } = await supabaseAdmin.from('global_minimum_price_floors')
            .select(globalSelect).order('effective_from', { ascending: true });
        if (error) throw error;
        const now = Date.now();
        return res.json({ floors: (data ?? []).map(row => ({ ...row, period_status: periodStatus(row, now) })) });
    } catch (error) { return sendError(res, error); }
});

globalPriceFloorsRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        requireOwnerRole(req.admin);
        const body = globalCreateSchema.parse(req.body ?? {});
        const { data, error } = await supabaseAdmin.rpc('create_global_minimum_price_floor', {
            p_actor_id: req.admin!.id,
            p_minimum_price_per_gram: body.minimum_price_per_gram,
            p_effective_from: body.effective_from,
            p_reason: body.reason,
        });
        if (error) mapFloorError(error);
        const floor = normalizeRpcRow<Record<string, unknown>>(data);
        if (!floor) throw new HttpError(500, 'The global floor was created but no record was returned.', 'FLOOR_CREATE_RESPONSE_INVALID');
        return res.status(201).json({ floor: { ...floor, period_status: periodStatus(floor as never) } });
    } catch (error) { return sendError(res, error); }
});

globalPriceFloorsRouter.patch('/:floorId', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        requireOwnerRole(req.admin);
        const floorId = parseId(req.params.floorId, 'floor ID');
        const body = globalUpdateSchema.parse(req.body ?? {});
        const { data, error } = await supabaseAdmin.rpc('update_scheduled_global_minimum_price_floor', {
            p_actor_id: req.admin!.id, p_floor_id: floorId,
            p_minimum_price_per_gram: body.minimum_price_per_gram,
            p_effective_from: body.effective_from, p_reason: body.reason,
        });
        if (error) mapFloorError(error);
        const floor = normalizeRpcRow<Record<string, unknown>>(data);
        if (!floor) throw new HttpError(500, 'The global floor was updated but no record was returned.', 'FLOOR_UPDATE_RESPONSE_INVALID');
        return res.json({ floor: { ...floor, period_status: periodStatus(floor as never) } });
    } catch (error) { return sendError(res, error); }
});

globalPriceFloorsRouter.post('/:floorId/cancel', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        requireOwnerRole(req.admin);
        const floorId = parseId(req.params.floorId, 'floor ID');
        const body = cancelSchema.parse(req.body ?? {});
        const { data, error } = await supabaseAdmin.rpc('cancel_scheduled_global_minimum_price_floor', {
            p_actor_id: req.admin!.id, p_floor_id: floorId, p_reason: body.reason,
        });
        if (error) mapFloorError(error);
        const floor = normalizeRpcRow<Record<string, unknown>>(data);
        return res.json({ floor: floor ? { ...floor, period_status: periodStatus(floor as never) } : null });
    } catch (error) { return sendError(res, error); }
});
