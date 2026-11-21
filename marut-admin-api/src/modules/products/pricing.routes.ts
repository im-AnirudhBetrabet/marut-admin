import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError } from '../../utils/http.js';

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const reasonSchema = z.string().trim().min(1).max(1000);
const pricePerGramSchema = z.number().positive().max(99999999.9999).refine(
    value => Number.isFinite(value) && Number(value.toFixed(4)) === value,
    'Price must have no more than four decimal places.',
);

function parseId(value: string | string[] | undefined, label: string): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) {
        throw new HttpError(400, `A valid ${label} is required.`, `INVALID_${label.toUpperCase().replaceAll(' ', '_')}`);
    }
    return parsed.data;
}

function normalizeRpcRow<T>(data: unknown): T | null {
    const value = Array.isArray(data) ? data[0] : data;
    return value && typeof value === 'object' ? value as T : null;
}

function mapPricingError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';
    const mappings: Array<[string, number, string, string]> = [
        ['ADMIN_NOT_FOUND', 403, 'ADMIN_NOT_FOUND', 'The acting admin account could not be verified.'],
        ['ADMIN_INACTIVE', 403, 'ADMIN_INACTIVE', 'The acting admin account is inactive.'],
        ['OWNER_REQUIRED', 403, 'OWNER_REQUIRED', 'Only an Owner can manage minimum price floors.'],
        ['INSUFFICIENT_PERMISSION', 403, 'INSUFFICIENT_PERMISSION', 'You do not have pricing management permission.'],
        ['ENTITY_NOT_FOUND', 404, 'PRICE_RECORD_NOT_FOUND', 'The requested pricing record or product was not found.'],
        ['PRODUCT_ARCHIVED', 409, 'PRODUCT_ARCHIVED', 'Archived products cannot receive pricing changes.'],
        ['REASON_REQUIRED', 400, 'REASON_REQUIRED', 'A reason is required for this change.'],
        ['INVALID_PRICE_PERIOD_OR_AMOUNT', 400, 'INVALID_PRICE_PERIOD_OR_AMOUNT', 'Enter a positive price and a valid effective period.'],
        ['PRICE_PERIOD_OVERLAP', 409, 'PRICE_PERIOD_OVERLAP', 'This price period overlaps another non-cancelled price period.'],
        ['EFFECTIVE_OR_CANCELLED_PRICE_IMMUTABLE', 409, 'PRICE_IMMUTABLE', 'An effective or cancelled price cannot be changed or cancelled.'],
        ['INVALID_FLOOR_PERIOD_OR_AMOUNT', 400, 'INVALID_FLOOR_PERIOD_OR_AMOUNT', 'Enter a valid floor amount and effective period.'],
        ['FLOOR_PERIOD_OVERLAP', 409, 'FLOOR_PERIOD_OVERLAP', 'This floor period overlaps another non-cancelled floor period.'],
        ['EFFECTIVE_OR_CANCELLED_FLOOR_IMMUTABLE', 409, 'FLOOR_IMMUTABLE', 'An effective or cancelled floor cannot be changed or cancelled.'],
        ['GLOBAL_FLOOR_INTERVAL_NOT_FOUND', 409, 'GLOBAL_FLOOR_INTERVAL_NOT_FOUND', 'The global floor timeline could not be updated at that date.'],
        ['FLOOR_DATE_CONFLICTS_WITH_NEXT_PERIOD', 409, 'FLOOR_DATE_CONFLICTS_WITH_NEXT_PERIOD', 'The new effective date conflicts with the next floor period.'],
        ['FLOOR_DATE_CONFLICTS_WITH_PREVIOUS_PERIOD', 409, 'FLOOR_DATE_CONFLICTS_WITH_PREVIOUS_PERIOD', 'The new effective date conflicts with the previous floor period.'],
        ['GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR', 409, 'GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR', 'The global floor timeline needs administrative review.'],
    ];
    for (const [token, status, code, publicMessage] of mappings) {
        if (message.includes(token)) throw new HttpError(status, publicMessage, code);
    }
    throw new Error(message || 'Pricing database operation failed.');
}

function derivePeriodStatus(row: {
    effective_from: string;
    effective_until: string | null;
    cancelled_at: string | null;
}, now = Date.now()): 'cancelled' | 'scheduled' | 'effective' | 'expired' {
    if (row.cancelled_at) return 'cancelled';
    const start = Date.parse(row.effective_from);
    if (start > now) return 'scheduled';
    if (!row.effective_until) return 'effective';
    return Date.parse(row.effective_until) > now ? 'effective' : 'expired';
}

const priceSelect = 'id,product_id,price_per_gram,effective_from,effective_until,reason,created_at,created_by,updated_at,updated_by,cancelled_at,cancelled_by,cancellation_reason' as const;

const createPriceSchema = z.object({
    price_per_gram: pricePerGramSchema,
    effective_from: timestampSchema.nullable().optional(),
    effective_until: timestampSchema.nullable().optional(),
    reason: reasonSchema,
}).strict();

const updatePriceSchema = z.object({
    price_per_gram: pricePerGramSchema,
    effective_from: timestampSchema,
    effective_until: timestampSchema.nullable(),
    reason: reasonSchema,
}).strict();

const cancelSchema = z.object({ reason: reasonSchema }).strict();

export const pricingRouter = Router({ mergeParams: true });

// GET /api/v1/products/:productId/prices/effective?at=<ISO timestamp>
// Resolves the price active at the supplied instant (defaults to database now).
pricingRouter.get('/effective', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'view');
        const productId = parseId(req.params.productId, 'product ID');
        const { data: product, error: productError } = await supabaseAdmin
            .from('products').select('id').eq('id', productId).maybeSingle();
        if (productError) throw productError;
        if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');

        const at = req.query.at === undefined ? null : timestampSchema.parse(req.query.at);
        const { data, error } = await supabaseAdmin.rpc('get_effective_product_price', {
            p_product_id: productId, ...(at ? { p_at: at } : {}),
        });
        if (error) throw error;
        const rawPrice = normalizeRpcRow<Record<string, unknown>>(data);
        const price = rawPrice && typeof rawPrice.id === 'string' ? rawPrice : null;
        return res.json({
            price: price ? { ...price, period_status: derivePeriodStatus(price as never) } : null,
        });
    } catch (error) { return sendError(res, error); }
});

// GET /api/v1/products/:productId/prices
pricingRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'view');
        const productId = parseId(req.params.productId, 'product ID');
        const { data: product, error: productError } = await supabaseAdmin
            .from('products').select('id').eq('id', productId).maybeSingle();
        if (productError) throw productError;
        if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');

        const { data, error } = await supabaseAdmin
            .from('product_prices').select(priceSelect).eq('product_id', productId)
            .order('effective_from', { ascending: false });
        if (error) throw error;
        const now = Date.now();
        return res.json({
            prices: (data ?? []).map(row => ({
                ...row,
                period_status: derivePeriodStatus(row, now),
            })),
        });
    } catch (error) { return sendError(res, error); }
});

// POST /api/v1/products/:productId/prices
pricingRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const body = createPriceSchema.parse(req.body ?? {});
        const { data, error } = await supabaseAdmin.rpc('create_product_price', {
            p_actor_id: req.admin!.id,
            p_product_id: productId,
            p_price_per_gram: body.price_per_gram,
            p_effective_from: body.effective_from ?? null,
            p_effective_until: body.effective_until ?? null,
            p_reason: body.reason,
        });
        if (error) mapPricingError(error);
        const price = normalizeRpcRow<Record<string, unknown>>(data);
        if (!price) throw new HttpError(500, 'The price was created but no record was returned.', 'PRICE_CREATE_RESPONSE_INVALID');
        return res.status(201).json({ price: { ...price, period_status: derivePeriodStatus(price as never) } });
    } catch (error) { return sendError(res, error); }
});

// PATCH /api/v1/products/:productId/prices/:priceId — scheduled records only.
pricingRouter.patch('/:priceId', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const priceId = parseId(req.params.priceId, 'price ID');
        const body = updatePriceSchema.parse(req.body ?? {});
        const { data: existing, error: existingError } = await supabaseAdmin
            .from('product_prices').select('id,product_id').eq('id', priceId).eq('product_id', productId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) throw new HttpError(404, 'Price record not found for this product.', 'PRICE_RECORD_NOT_FOUND');

        const { data, error } = await supabaseAdmin.rpc('update_scheduled_product_price', {
            p_actor_id: req.admin!.id, p_price_id: priceId,
            p_price_per_gram: body.price_per_gram,
            p_effective_from: body.effective_from,
            p_effective_until: body.effective_until,
            p_reason: body.reason,
        });
        if (error) mapPricingError(error);
        const price = normalizeRpcRow<Record<string, unknown>>(data);
        if (!price) throw new HttpError(500, 'The price was updated but no record was returned.', 'PRICE_UPDATE_RESPONSE_INVALID');
        return res.json({ price: { ...price, period_status: derivePeriodStatus(price as never) } });
    } catch (error) { return sendError(res, error); }
});

// POST /api/v1/products/:productId/prices/:priceId/cancel
pricingRouter.post('/:priceId/cancel', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'pricing', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const priceId = parseId(req.params.priceId, 'price ID');
        const body = cancelSchema.parse(req.body ?? {});
        const { data: existing, error: existingError } = await supabaseAdmin
            .from('product_prices').select('id').eq('id', priceId).eq('product_id', productId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) throw new HttpError(404, 'Price record not found for this product.', 'PRICE_RECORD_NOT_FOUND');

        const { data, error } = await supabaseAdmin.rpc('cancel_scheduled_product_price', {
            p_actor_id: req.admin!.id, p_price_id: priceId, p_reason: body.reason,
        });
        if (error) mapPricingError(error);
        const price = normalizeRpcRow<Record<string, unknown>>(data);
        return res.json({ price: price ? { ...price, period_status: derivePeriodStatus(price as never) } : null });
    } catch (error) { return sendError(res, error); }
});
