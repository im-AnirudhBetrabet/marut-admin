import { apiRequest } from "../api/client";
import type { ProductImageRecord, ProductImagesResponse, ProductImageResponse } from "./productImages.types";

const base = (productId: string) => `/products/${encodeURIComponent(productId)}/images`;
const unwrapList = (response: ProductImagesResponse | ProductImageRecord[]) => Array.isArray(response) ? response : response.images ?? response.data ?? [];
const unwrapOne = (response: ProductImageResponse | ProductImageRecord) => ("image" in response ? response.image : "data" in response ? response.data : response) as ProductImageRecord;

export async function getProductImages(token: string, productId: string): Promise<ProductImageRecord[]> {
    return unwrapList(await apiRequest<ProductImagesResponse | ProductImageRecord[]>(base(productId), {}, token));
}

export async function uploadProductImage(token: string, productId: string, file: File, altText: string): Promise<ProductImageRecord> {
    const asciiAlt                        = altText.replace(/[^\x20-\x7E]/g, "").trim();
    const headers: Record<string, string> = { "Content-Type": file.type };
    if (asciiAlt) headers["X-Image-Alt-Text"] = asciiAlt;
    const response = await apiRequest<ProductImageResponse | ProductImageRecord>(base(productId), {
        method: "POST",
        headers: headers,
        body: file,
    }, token);
    return unwrapOne(response);
}

export async function setPrimaryProductImage(token: string, productId: string, imageId: string): Promise<ProductImageRecord> {
    const response = await apiRequest<ProductImageResponse | ProductImageRecord>(`${base(productId)}/${encodeURIComponent(imageId)}/primary`, { method: "PATCH" }, token);
    return unwrapOne(response);
}

export async function updateProductImageAltText(token: string, productId: string, imageId: string, altText: string | null): Promise<ProductImageRecord> {
    const response = await apiRequest<ProductImageResponse | ProductImageRecord>(`${base(productId)}/${encodeURIComponent(imageId)}`, { method: "PATCH", body: JSON.stringify({ alt_text: altText }) }, token);
    return unwrapOne(response);
}

export function deleteProductImage(token: string, productId: string, imageId: string, reason: string) {
    return apiRequest<{ success?: boolean }>(`${base(productId)}/${encodeURIComponent(imageId)}`, { method: "DELETE", body: JSON.stringify({ reason }) }, token);
}
