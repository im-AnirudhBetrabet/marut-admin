import { apiRequest } from "../api/client";
import type { CreateProductPriceRequest, EffectiveProductPriceResponse, ProductPriceRecord, ProductPricesResponse, UpdateProductPriceRequest } from "./productPrices.types";

const pathFor = (productId: string) => `/products/${encodeURIComponent(productId)}/prices`;

function unwrap(response: ProductPricesResponse): ProductPriceRecord[] {
    if (Array.isArray(response)) return response;
    if ("prices" in response && Array.isArray(response.prices)) return response.prices;
    if ("records" in response && Array.isArray(response.records)) return response.records;
    if ("data" in response && Array.isArray(response.data)) return response.data;
    return [];
}

export async function getProductPrices(accessToken: string, productId: string) {
    return unwrap(await apiRequest<ProductPricesResponse>(pathFor(productId), {}, accessToken));
}

export async function getEffectiveProductPrice(accessToken: string, productId: string) {
    const response = await apiRequest<EffectiveProductPriceResponse>(`${pathFor(productId)}/effective`, {}, accessToken);
    if (response == null) return null;
    if (typeof response === "object" && "price" in response) {
        const price = response.price;
        if (price == null || typeof price === "number" || typeof price === "string") return price == null ? null : Number(price);
        return price;
    }
    if (typeof response === "number" || typeof response === "string") return Number(response);
    return response;
}

export function createProductPrice(accessToken: string, productId: string, payload: CreateProductPriceRequest) {
    return apiRequest<unknown>(pathFor(productId), { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function updateProductPrice(accessToken: string, productId: string, priceId: string, payload: UpdateProductPriceRequest) {
    return apiRequest<unknown>(`${pathFor(productId)}/${encodeURIComponent(priceId)}`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function cancelProductPrice(accessToken: string, productId: string, priceId: string, reason: string) {
    return apiRequest<unknown>(`${pathFor(productId)}/${encodeURIComponent(priceId)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }, accessToken);
}
