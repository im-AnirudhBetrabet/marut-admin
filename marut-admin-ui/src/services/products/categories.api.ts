import { apiRequest } from "../api/client";
import type { CategoriesResponse, CategoryHistoryResponse, CategoryResponse, CategoryHistoryEvent, VerticalsResponse } from "./categories.types";

const BASE = "/products/categories";

export type CategoryFilters = { vertical_id?: string; status?: "active" | "inactive" };
function queryString(filters: CategoryFilters) {
    const query = new URLSearchParams();
    if (filters.vertical_id) query.set("vertical_id", filters.vertical_id);
    if (filters.status) query.set("status", filters.status);
    const value = query.toString();
    return value ? `?${value}` : "";
}

export async function getCategories(token: string, filters: CategoryFilters = {}) {
    const result = await apiRequest<CategoriesResponse>(`${BASE}${queryString(filters)}`, {}, token);
    return result.categories ?? [];
}
export async function getOperationalVerticals(token: string) {
    const result = await apiRequest<VerticalsResponse>("/verticals", {}, token);
    return (result.verticals ?? []).filter((vertical) => vertical.status === "operational");
}
export async function getCategory(token: string, id: string) {
    const result = await apiRequest<CategoryResponse>(`${BASE}/${encodeURIComponent(id)}`, {}, token);
    return result.category;
}
export async function createCategory(token: string, payload: { vertical_id: string; name: string; description?: string }) {
    const result = await apiRequest<CategoryResponse>(BASE, { method: "POST", body: JSON.stringify(payload) }, token);
    return result.category;
}
export async function updateCategory(token: string, id: string, payload: { name?: string; description?: string | null; reason?: string }) {
    const result = await apiRequest<CategoryResponse>(`${BASE}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
    return result.category;
}
export async function reassignCategory(token: string, id: string, payload: { vertical_id: string; reason: string }) {
    const result = await apiRequest<CategoryResponse>(`${BASE}/${encodeURIComponent(id)}/vertical`, { method: "PATCH", body: JSON.stringify(payload) }, token);
    return result.category;
}
export async function updateCategoryStatus(token: string, id: string, payload: { status: "active" | "inactive"; reason: string }) {
    const result = await apiRequest<CategoryResponse>(`${BASE}/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify(payload) }, token);
    return result.category;
}
export async function getCategoryHistory(token: string, id: string): Promise<CategoryHistoryEvent[]> {
    const result = await apiRequest<CategoryHistoryResponse>(`${BASE}/${encodeURIComponent(id)}/history`, {}, token);
    return result.history ?? [];
}
export async function deleteCategory(token: string, id: string, reason: string) {
    return apiRequest<void>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ reason }) }, token);
}
