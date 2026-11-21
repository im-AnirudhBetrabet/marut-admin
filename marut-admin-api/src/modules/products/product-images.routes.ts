import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { requireAdmin, requirePermission } from '../../middleware/require-admin.js';
import { HttpError, sendError } from '../../utils/http.js';

export const productImagesRouter = Router({ mergeParams: true });

const BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const idSchema = z.string().uuid();
const altTextSchema = z.string().trim().max(500).nullable();

type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

type ProductImageRecord = {
    id: string;
    product_id: string;
    storage_object_path: string;
    is_primary: boolean;
    alt_text: string | null;
    created_at: string;
    created_by: string | null;
};

const imageSelect =
    'id,product_id,storage_object_path,is_primary,alt_text,created_at,created_by' as const;

function parseId(value: string | string[] | undefined, label: string): string {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) {
        throw new HttpError(
            400,
            `A valid ${label} is required.`,
            `INVALID_${label.toUpperCase().replaceAll(' ', '_')}`,
        );
    }
    return parsed.data;
}

function mapImageError(error: { code?: string; message?: string }): never {
    const message = error.message ?? '';

    const mappings: Array<[string, number, string, string]> = [
        ['ADMIN_NOT_FOUND', 403, 'ADMIN_NOT_FOUND', 'The acting admin account could not be verified.'],
        ['ADMIN_INACTIVE', 403, 'ADMIN_INACTIVE', 'The acting admin account is inactive.'],
        ['INSUFFICIENT_PERMISSION', 403, 'INSUFFICIENT_PERMISSION', 'You do not have permission to manage product images.'],
        ['ENTITY_NOT_FOUND', 404, 'ENTITY_NOT_FOUND', 'The requested product or image was not found.'],
        ['PRODUCT_NOT_FOUND', 404, 'PRODUCT_NOT_FOUND', 'Product not found.'],
        ['IMAGE_NOT_FOUND', 404, 'IMAGE_NOT_FOUND', 'Product image not found.'],
        ['PRODUCT_ARCHIVED', 409, 'PRODUCT_ARCHIVED', 'Archived products cannot receive new images or image-detail changes.'],
        ['PRODUCT_IMAGE_LIMIT_REACHED', 409, 'PRODUCT_IMAGE_LIMIT_REACHED', 'A product can have at most 10 images.'],
        ['IMAGE_PATH_REQUIRED', 400, 'IMAGE_PATH_REQUIRED', 'A valid image storage path is required.'],
        ['ENTITY_NOT_FOUND_OR_PRODUCT_ARCHIVED', 409, 'ENTITY_NOT_FOUND_OR_PRODUCT_ARCHIVED', 'The image was not found or the product is archived.'],
        ['DUPLICATE_RECORD', 409, 'IMAGE_ALREADY_EXISTS', 'This image is already associated with the product.'],
        ['REASON_REQUIRED', 400, 'REASON_REQUIRED', 'A reason is required for this change.'],
        ['INVALID_IMAGE', 400, 'INVALID_IMAGE', 'The uploaded file is not a supported image.'],
    ];

    for (const [token, status, code, publicMessage] of mappings) {
        if (message.includes(token)) {
            throw new HttpError(status, publicMessage, code);
        }
    }

    throw new Error(message || 'Product image operation failed.');
}

function detectImageMime(buffer: Buffer): ImageMime | null {
    // JPEG signature
    if (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return 'image/jpeg';
    }

    // PNG signature
    if (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
        return 'image/png';
    }

    // WebP: RIFF....WEBP
    if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return 'image/webp';
    }

    return null;
}

function extensionForMime(mime: ImageMime): string {
    switch (mime) {
        case 'image/jpeg': return 'jpg';
        case 'image/png': return 'png';
        case 'image/webp': return 'webp';
    }
}

function publicUrlFor(path: string): string {
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

async function getProduct(productId: string): Promise<{ id: string; status: string }> {
    const { data, error } = await supabaseAdmin
        .from('products')
        .select('id,status')
        .eq('id', productId)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    return data;
}

async function getProductImage(productId: string, imageId: string): Promise<ProductImageRecord> {
    const { data, error } = await supabaseAdmin
        .from('product_images')
        .select(imageSelect)
        .eq('product_id', productId)
        .eq('id', imageId)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new HttpError(404, 'Product image not found for this product.', 'IMAGE_NOT_FOUND');
    return data as ProductImageRecord;
}

function withPublicUrl(image: ProductImageRecord) {
    return {
        ...image,
        public_url: publicUrlFor(image.storage_object_path),
    };
}

// List image associations. Storage objects are public-read; no signed URL is needed.
productImagesRouter.get('/', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'view');
        const productId = parseId(req.params.productId, 'product ID');
        await getProduct(productId);

        const { data, error } = await supabaseAdmin
            .from('product_images')
            .select(imageSelect)
            .eq('product_id', productId)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true });

        if (error) throw error;

        return res.json({
            images: ((data ?? []) as ProductImageRecord[]).map(withPublicUrl),
        });
    } catch (error) {
        return sendError(res, error);
    }
});

// Upload the raw image bytes as the request body.
// Content-Type must be image/jpeg, image/png or image/webp.
// Optional alt text is supplied in the X-Image-Alt-Text header.
productImagesRouter.post(
    '/',
    requireAdmin,
    raw({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        limit: MAX_IMAGE_BYTES,
    }),
    async (req, res) => {
        let uploadedPath: string | null = null;

        try {
            await requirePermission(req, 'products', 'manage');
            const productId = parseId(req.params.productId, 'product ID');
            const product = await getProduct(productId);

            if (product.status === 'archived') {
                throw new HttpError(409, 'Archived products cannot receive new images.', 'PRODUCT_ARCHIVED');
            }

            // Fast-fail when the product is already at the image limit.
            // add_product_image() repeats this check under the product row lock,
            // so this read is only an optimization, never the integrity boundary.
            const { count: existingImageCount, error: countError } = await supabaseAdmin
                .from('product_images')
                .select('id', { count: 'exact', head: true })
                .eq('product_id', productId);

            if (countError) throw countError;
            if ((existingImageCount ?? 0) >= 10) {
                throw new HttpError(409, 'A product can have at most 10 images.', 'PRODUCT_IMAGE_LIMIT_REACHED');
            }

            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                throw new HttpError(
                    400,
                    'Send the image as the raw request body with an image/jpeg, image/png or image/webp Content-Type.',
                    'IMAGE_BODY_REQUIRED',
                );
            }

            if (req.body.length > MAX_IMAGE_BYTES) {
                throw new HttpError(413, 'Images must be 5 MB or smaller.', 'IMAGE_TOO_LARGE');
            }

            const mime = detectImageMime(req.body);
            if (!mime) {
                throw new HttpError(415, 'Only valid JPEG, PNG and WebP images are supported.', 'UNSUPPORTED_IMAGE_TYPE');
            }

            const declaredMime = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
            if (declaredMime !== mime) {
                throw new HttpError(415, 'The Content-Type does not match the uploaded image.', 'IMAGE_MIME_MISMATCH');
            }

            const altTextResult = altTextSchema.safeParse(req.header('x-image-alt-text') ?? null);
            if (!altTextResult.success) {
                throw new HttpError(400, 'Alt text must be 500 characters or fewer.', 'INVALID_ALT_TEXT');
            }

            const imageId = randomUUID();
            const storagePath = `${productId}/${imageId}.${extensionForMime(mime)}`;
            uploadedPath = storagePath;

            const { error: uploadError } = await supabaseAdmin.storage
                .from(BUCKET)
                .upload(storagePath, req.body, {
                    contentType: mime,
                    cacheControl: '31536000',
                    upsert: false,
                });

            if (uploadError) {
                throw new HttpError(502, 'The image could not be uploaded to Storage.', 'STORAGE_UPLOAD_FAILED');
            }

            const { data, error: insertError } = await supabaseAdmin.rpc('add_product_image', {
                p_actor_id: req.admin!.id,
                p_product_id: productId,
                p_storage_object_path: storagePath,
                p_alt_text: altTextResult.data,
            });

            if (insertError) mapImageError(insertError);

            // The RPC returned successfully, so the association is committed.
            // Never delete the object after this point, even if response parsing fails.
            uploadedPath = null;

            const createdValue = Array.isArray(data) ? data[0] : data;
            if (!createdValue || typeof createdValue !== 'object' || !('id' in createdValue)) {
                throw new HttpError(500, 'The image association was not returned after upload.', 'IMAGE_CREATE_RESPONSE_INVALID');
            }

            return res.status(201).json({
                image: withPublicUrl(createdValue as ProductImageRecord),
            });
        } catch (error) {
            // Roll back the Storage upload only when the DB association was not
            // successfully established. Normal image removal never deletes files.
            if (uploadedPath) {
                try {
                    await supabaseAdmin.storage.from(BUCKET).remove([uploadedPath]);
                } catch {
                    // Preserve the original API error. The leftover object can
                    // be identified and removed by the separate orphan cleanup.
                }
            }
            return sendError(res, error);
        }
    },
);

// Set one image as primary. The database function locks the product and swaps
// primary state atomically.
productImagesRouter.patch('/:imageId/primary', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const imageId = parseId(req.params.imageId, 'image ID');
        await getProductImage(productId, imageId);

        const { error } = await supabaseAdmin.rpc('set_primary_product_image', {
            p_actor_id: req.admin!.id,
            p_product_id: productId,
            p_image_id: imageId,
        });

        if (error) mapImageError(error);
        return res.json({ image: withPublicUrl(await getProductImage(productId, imageId)) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Update alt text only. The database function rejects archived products.
productImagesRouter.patch('/:imageId', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const imageId = parseId(req.params.imageId, 'image ID');
        const body = z.object({ alt_text: altTextSchema }).strict().parse(req.body ?? {});
        await getProductImage(productId, imageId);

        const { error } = await supabaseAdmin.rpc('update_product_image_details', {
            p_actor_id: req.admin!.id,
            p_image_id: imageId,
            p_alt_text: body.alt_text,
        });

        if (error) mapImageError(error);
        return res.json({ image: withPublicUrl(await getProductImage(productId, imageId)) });
    } catch (error) {
        return sendError(res, error);
    }
});

// Remove only the database association. The Storage object is intentionally
// retained for separate orphan cleanup, as required by the approved design.
productImagesRouter.delete('/:imageId', requireAdmin, async (req, res) => {
    try {
        await requirePermission(req, 'products', 'manage');
        const productId = parseId(req.params.productId, 'product ID');
        const imageId = parseId(req.params.imageId, 'image ID');
        const body = z.object({ reason: z.string().trim().min(1).max(1000) }).strict().parse(req.body ?? {});
        await getProductImage(productId, imageId);

        const { error } = await supabaseAdmin.rpc('remove_product_image', {
            p_actor_id: req.admin!.id,
            p_product_id: productId,
            p_image_id: imageId,
            p_reason: body.reason,
        });

        if (error) mapImageError(error);
        return res.status(204).send();
    } catch (error) {
        return sendError(res, error);
    }
});
