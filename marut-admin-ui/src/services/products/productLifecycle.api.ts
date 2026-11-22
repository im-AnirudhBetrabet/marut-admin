import { apiRequest } from "../api/client";
import type { ProductRecord, ProductStatus } from "./products.types";

export type ProductLifecycleStatus = Extract<ProductStatus, "active" | "inactive" | "archived">;

export interface ProductStatusUpdatePayload {
    status: ProductLifecycleStatus;
    reason: string;
}

/** Changes lifecycle status through the Express API; never writes directly to Supabase. */
export async function updateProductStatus(
    accessToken: string,
    productId: string,
    payload: ProductStatusUpdatePayload,
): Promise<ProductRecord> {
    const response = await apiRequest<{ product?: ProductRecord } | ProductRecord>(
        `/products/${encodeURIComponent(productId)}/status`,
        { method: "PATCH", body: JSON.stringify(payload) },
        accessToken,
    );
    return "product" in response && response.product ? response.product : response as ProductRecord;
}
