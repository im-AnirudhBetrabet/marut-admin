import { apiRequest } from "../api/client";
import type { ProductHistoryEvent, ProductHistoryResponse } from "./productHistory.types";

export async function getProductHistory(token: string, productId: string): Promise<ProductHistoryEvent[]> {
    const response = await apiRequest<ProductHistoryResponse>(`/products/${encodeURIComponent(productId)}/history`, {}, token);
    if (Array.isArray(response)) return response;
    return response.history ?? response.events ?? response.data ?? [];
}
