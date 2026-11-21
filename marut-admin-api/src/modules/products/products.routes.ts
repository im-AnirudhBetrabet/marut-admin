import { Router }                          from 'express';
import { z }                               from 'zod';
import { supabaseAdmin }                   from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError }            from '../../utils/http.js';

export const productsRouter = Router();

const idSchema            = z.string().uuid();
const productStatusSchema = z.enum(['draft', 'active', 'inactive', 'archived']);

const previewSkuSchema = z.object({
    category_id         : idSchema,
    name                : z.string().trim().min(1).max(160),
    product_abbreviation: z.string().trim().min(2).max(8).regex(/^[A-Za-z0-9]+$/).optional(),
}).strict();

const createProductSchema = z.object({
    category_id          : idSchema,
    name                 : z.string().trim().min(1).max(160),
    product_abbreviation : z.string().trim().min(2).max(8).regex(/^[A-Za-z0-9]+$/).optional(),
    description          : z.string().trim().max(10000).nullable().optional(),
    growing_duration_days: z.number().int().positive().nullable().optional(),
    pack_sizes_grams     : z.array(z.number().int().positive()).min(1).max(30),
}).strict().superRefine((value, ctx) => {
    if (new Set(value.pack_sizes_grams).size !== value.pack_sizes_grams.length) {
        ctx.addIssue({
            code: 'custom',
            path: ['pack_sizes_grams'],
            message: 'Pack sizes must be unique.',
        });
    }
});

const updateProductSchema = z.object({
    // This is a full details replacement, not a partial PATCH. The underlying
    // RPC accepts all three mutable detail fields as one atomic update.
    name       : z.string().trim().min(1).max(160),
    description: z.string().trim().max(10000).nullable(),
    growing_duration_days: z.number().int().positive().nullable(),
    reason: z.string().trim().min(1).max(1000).optional(),
}).strict();

const transitionProductSchema = z.object({
    status: productStatusSchema,
    reason: z.string().trim().min(1).max(1000),
}).strict();

const reassignProductSchema = z.object({
    category_id: idSchema,
    reason: z.string().trim().min(1).max(1000),
}).strict();

const deleteProductSchema = z.object({
    reason: z.string().trim().min(1).max(1000),
}).strict();

const PRODUCT_SELECT = 'id,category_id,sku,name,description,status,growing_duration_days,created_at,updated_at,created_by,updated_by, category:product_categories!inner(id,vertical_id,name,status,vertical:business_verticals(id,name,code,sku_prefix,status)),pack_sizes:product_pack_sizes(id,weight_grams,status,created_at,updated_at)' as const;

type VerticalSummary = {
    id: string;
    name: string;
    code: string;
    sku_prefix: string | null;
    status: string;
};

type CategorySummary = {
    id: string;
    vertical_id: string;
    name: string;
    status: string;
    vertical: VerticalSummary | null;
};

type PackSizeSummary = {
    id: string;
    weight_grams: number;
    status: 'active' | 'inactive';
    created_at: string;
    updated_at: string;
};

type ProductRecord = {
    id: string;
    category_id: string;
    sku: string;
    name: string;
    description: string | null;
    status: 'draft' | 'active' | 'inactive' | 'archived';
    growing_duration_days: number | null;
    created_at: string;
    updated_at: string;
    created_by: string | null;
    updated_by: string | null;
    category: CategorySummary | null;
    pack_sizes: PackSizeSummary[];
};

type ProductQueryRow = Omit<ProductRecord, 'category' | 'pack_sizes'> & {
    category: (Omit<CategorySummary, 'vertical'> & {
        vertical: VerticalSummary | VerticalSummary[] | null;
    }) | (Omit<CategorySummary, 'vertical'> & {
        vertical: VerticalSummary | VerticalSummary[] | null;
    })[] | null;
    pack_sizes: PackSizeSummary[] | null;
};

function parseId(value: string | string[] | undefined): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) {
        throw new HttpError(400, 'A valid product ID is required.', 'INVALID_PRODUCT_ID');
    }
    return parsed.data;
}

function normalizeProduct(value: unknown): ProductRecord {
    const row = value as ProductQueryRow;
    let category: CategorySummary | null = null;

    if (Array.isArray(row.category)) {
        const item = row.category[0];
        if (item) {
            category = {
                ...item,
                vertical: Array.isArray(item.vertical) ? (item.vertical[0] ?? null) : (item.vertical ?? null),
            };
        }
    } else if (row.category) {
        category = {
            ...row.category,
            vertical: Array.isArray(row.category.vertical)
                ? (row.category.vertical[0] ?? null)
                : (row.category.vertical ?? null),
        };
    }

    return {
        ...row,
        category,
        pack_sizes: row.pack_sizes ?? [],
    };
}

function mapProductError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';

    const mappings: Array<[string, number, string, string]> = [
        ['ADMIN_NOT_FOUND', 403, 'ADMIN_NOT_FOUND', 'The acting admin account could not be verified.'],
        ['ADMIN_INACTIVE', 403, 'ADMIN_INACTIVE', 'The acting admin account is inactive.'],
        ['INSUFFICIENT_PERMISSION', 403, 'INSUFFICIENT_PERMISSION', 'You do not have the required permission for this operation.'],
        ['ENTITY_NOT_FOUND', 404, 'PRODUCT_OR_CATEGORY_NOT_FOUND', 'The requested product or category was not found.'],
        ['PRODUCT_NAME_REQUIRED', 400, 'PRODUCT_NAME_REQUIRED', 'A product name is required.'],
        ['INVALID_PRODUCT_ABBREVIATION', 400, 'INVALID_PRODUCT_ABBREVIATION', 'The product abbreviation must contain 2–8 letters or numbers.'],
        ['CATEGORY_INACTIVE', 409, 'CATEGORY_INACTIVE', 'The selected category is inactive.'],
        ['VERTICAL_NOT_OPERATIONAL', 409, 'VERTICAL_NOT_OPERATIONAL', 'The category vertical must be Operational.'],
        ['VERTICAL_NOT_OPERATIONAL_OR_PREFIX_MISSING', 409, 'VERTICAL_NOT_READY_FOR_PRODUCTS', 'The category vertical must be Operational and have an SKU prefix.'],
        ['VERTICAL_SKU_PREFIX_REQUIRED', 409, 'VERTICAL_SKU_PREFIX_REQUIRED', 'The category vertical does not have an SKU prefix.'],
        ['INVALID_OR_DUPLICATE_PACK_SIZE', 400, 'INVALID_OR_DUPLICATE_PACK_SIZE', 'Pack sizes must be unique positive integer gram values.'],
        ['AT_LEAST_ONE_PACK_SIZE_REQUIRED', 400, 'AT_LEAST_ONE_PACK_SIZE_REQUIRED', 'At least one pack size is required.'],
        ['INVALID_GROWING_DURATION', 400, 'INVALID_GROWING_DURATION', 'Growing duration must be a positive number of calendar days.'],
        ['PRODUCT_ARCHIVED', 409, 'PRODUCT_ARCHIVED', 'Archived products cannot be modified.'],
        ['INVALID_STATUS_TRANSITION', 409, 'INVALID_STATUS_TRANSITION', 'That product status transition is not allowed.'],
        ['ACTIVE_PACK_SIZE_REQUIRED', 409, 'ACTIVE_PACK_SIZE_REQUIRED', 'At least one active pack size is required before activation.'],
        ['EFFECTIVE_STANDARD_PRICE_REQUIRED', 409, 'EFFECTIVE_STANDARD_PRICE_REQUIRED', 'An effective standard price is required before activation.'],
        ['EFFECTIVE_GLOBAL_PRICE_FLOOR_REQUIRED', 409, 'EFFECTIVE_GLOBAL_PRICE_FLOOR_REQUIRED', 'An effective global minimum price floor is required before activation.'],
        ['PRODUCT_PRICE_BELOW_MINIMUM_FLOOR', 409, 'PRODUCT_PRICE_BELOW_MINIMUM_FLOOR', 'The effective standard price is below the applicable minimum floor.'],
        ['HISTORICAL_REFERENCE_EXISTS', 409, 'PRODUCT_HAS_HISTORICAL_REFERENCES', 'This product has pricing or transaction history and cannot be physically deleted. Archive it instead.'],
        ['SKU_REGISTRY_ENTRY_MISSING', 500, 'SKU_REGISTRY_ENTRY_MISSING', 'The permanent SKU registry entry is missing. Contact an administrator.'],
        ['REASON_REQUIRED', 400, 'REASON_REQUIRED', 'A reason is required for this change.'],
        ['DUPLICATE_RECORD', 409, 'DUPLICATE_RECORD', 'A product with this name already exists in the selected category, or the SKU conflicts.'],
    ];

    for (const [token, status, code, userMessage] of mappings) {
        if (message.includes(token)) {
            throw new HttpError(status, userMessage, code);
        }
    }

    if (error.code === '23503') {
        throw new HttpError(409, 'The product is referenced by another record and cannot be deleted.', 'PRODUCT_HAS_HISTORICAL_REFERENCES');
    }

    throw new Error(message || 'Product database operation failed.');
}

async function getProduct(id: string): Promise<ProductRecord> {
    const { data, error } = await supabaseAdmin
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');

    return normalizeProduct(data);
}

productsRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');

        const query = z.object({
            category_id: idSchema.optional(),
            vertical_id: idSchema.optional(),
            status: productStatusSchema.optional(),
            search: z.string().trim().min(1).max(100).optional(),
        }).strict().parse(req.query);

        let request = supabaseAdmin
            .from('products')
            .select(PRODUCT_SELECT)
            .order('created_at', { ascending: false });

        if (query.category_id) request = request.eq('category_id', query.category_id);
        if (query.vertical_id) request = request.eq('category.vertical_id', query.vertical_id);
        if (query.status) request = request.eq('status', query.status);
        if (query.search) {
            // Remove PostgREST OR-filter delimiters and wildcard characters so
            // user input is treated as a literal substring in either field.
            const escaped = query.search.replace(/[,%()_*\\]/g, ' ').trim();

            // Inputs consisting only of stripped characters must not degrade
            // into an empty "match everything" pattern.
            if (escaped.length > 0) {
                request = request.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%`);
            } else {
                return res.json({ products: [] });
            }
        }

        const { data, error } = await request;
        if (error) throw error;

        return res.json({ products: (data ?? []).map(normalizeProduct) });
    } catch (error) {
        return sendError(res, error);
    }
});

productsRouter.get('/:id/history', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');
        const id = parseId(req.params.id);
        await getProduct(id);

        const { data, error } = await supabaseAdmin
            .from('catalogue_audit_history')
            .select('id,entity_type,entity_id,action,previous_values,new_values,reason,actor_id,created_at,actor:admin_users(id,display_name,email)')
            .eq('entity_type', 'product')
            .eq('entity_id', id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        return res.json({ history: data ?? [] });
    } catch (error) {
        return sendError(res, error);
    }
});

productsRouter.get('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');
        return res.json({ product: await getProduct(parseId(req.params.id)) });
    } catch (error) {
        return sendError(res, error);
    }
});

// SKU preview is read-only and does not consume the global sequence.
productsRouter.post('/sku-preview', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const body = previewSkuSchema.parse(req.body ?? {});

        const { data, error } = await supabaseAdmin.rpc('preview_product_sku', {
            p_actor_id: req.admin!.id,
            p_category_id: body.category_id,
            p_product_name: body.name,
            p_product_abbreviation: body.product_abbreviation ?? null,
        });

        if (error) mapProductError(error);
        if (typeof data !== 'string' || !data) {
            throw new HttpError(500, 'SKU preview did not return a valid SKU.', 'SKU_PREVIEW_RESPONSE_INVALID');
        }

        return res.json({ sku: data });
    } catch (error) {
        return sendError(res, error);
    }
});

productsRouter.post('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const body = createProductSchema.parse(req.body ?? {});

        const { data, error } = await supabaseAdmin.rpc('create_product', {
            p_actor_id: req.admin!.id,
            p_category_id: body.category_id,
            p_name: body.name,
            p_product_abbreviation: body.product_abbreviation ?? null,
            p_description: body.description ?? null,
            p_growing_duration_days: body.growing_duration_days ?? null,
            p_pack_sizes_grams: body.pack_sizes_grams,
        });

        if (error) mapProductError(error);

        const createdValue = Array.isArray(data) ? data[0] : data;
        const created = createdValue as { id?: string } | null;
        if (!created?.id) {
            throw new HttpError(500, 'Product creation did not return a product identifier.', 'PRODUCT_CREATE_RESPONSE_INVALID');
        }

        return res.status(201).json({ product: await getProduct(created.id) });
    } catch (error) {
        return sendError(res, error);
    }
});

// The database RPC updates all three detail fields atomically. This endpoint
// intentionally requires a complete detail payload to avoid a read/modify/write race.
productsRouter.put('/:id/details', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const id = parseId(req.params.id);
        const body = updateProductSchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('update_product_details', {
            p_actor_id: req.admin!.id,
            p_product_id: id,
            p_name: body.name,
            p_description: body.description,
            p_growing_duration_days: body.growing_duration_days,
            p_reason: body.reason ?? null,
        });

        if (error) mapProductError(error);
        return res.json({ product: await getProduct(id) });
    } catch (error) {
        return sendError(res, error);
    }
});

productsRouter.patch('/:id/status', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const id = parseId(req.params.id);
        const body = transitionProductSchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('transition_product_status', {
            p_actor_id: req.admin!.id,
            p_product_id: id,
            p_new_status: body.status,
            p_reason: body.reason,
        });

        if (error) mapProductError(error);
        return res.json({ product: await getProduct(id) });
    } catch (error) {
        return sendError(res, error);
    }
});

productsRouter.patch('/:id/category', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        await requirePermission(req, 'verticals', 'manage');
        const id = parseId(req.params.id);
        const body = reassignProductSchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('reassign_product_category', {
            p_actor_id: req.admin!.id,
            p_product_id: id,
            p_new_category_id: body.category_id,
            p_reason: body.reason,
        });

        if (error) mapProductError(error);
        return res.json({ product: await getProduct(id) });
    } catch (error) {
        return sendError(res, error);
    }
});

productsRouter.delete('/:id', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const id = parseId(req.params.id);
        const body = deleteProductSchema.parse(req.body ?? {});

        const { error } = await supabaseAdmin.rpc('delete_product', {
            p_actor_id: req.admin!.id,
            p_product_id: id,
            p_reason: body.reason,
        });

        if (error) mapProductError(error);
        return res.status(204).send();
    } catch (error) {
        return sendError(res, error);
    }
});
