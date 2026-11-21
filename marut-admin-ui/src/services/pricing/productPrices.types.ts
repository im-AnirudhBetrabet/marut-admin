export type ProductPriceStatus = "scheduled" | "effective" | "expired" | "cancelled" | string;

export interface ProductPriceRecord {
    id: string;
    price_per_gram: number | string;
    effective_from: string;
    effective_until?: string | null;
    period_status?: ProductPriceStatus;
    status?: ProductPriceStatus;
    reason?: string | null;
    created_at?: string | null;
    created_by?: string | null;
    actor_name?: string | null;
    cancelled_at?: string | null;
    cancelled_by?: string | null;
    cancellation_reason?: string | null;
}

export type ProductPricesResponse = ProductPriceRecord[] | { prices: ProductPriceRecord[] } | { records: ProductPriceRecord[] } | { data: ProductPriceRecord[] };
export type EffectiveProductPriceResponse = { price: ProductPriceRecord | number | string | null } | ProductPriceRecord | null;

export interface CreateProductPriceRequest {
    price_per_gram: number;
    effective_from: string | null;
    effective_until: string | null;
    reason: string;
}
export type UpdateProductPriceRequest = Partial<CreateProductPriceRequest>;
