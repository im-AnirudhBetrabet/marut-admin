import { apiRequest } from "../api/client";
import type {
  CreateProductRequest,
  ProductCategoriesResponse,
  ProductListFilters,
  ProductListResponse,
  ProductRecord,
  ProductVerticalsResponse,
} from "./products.types";

function toQueryString(filters: ProductListFilters = {}) {
  const query = new URLSearchParams();
  if (filters.category_id) query.set("category_id", filters.category_id);
  if (filters.vertical_id) query.set("vertical_id", filters.vertical_id);
  if (filters.status) query.set("status", filters.status);
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  const value = query.toString();
  return value ? `?${value}` : "";
}

/** Loads verticals for product/category selection. */
export function getProductVerticals(accessToken: string) {
  return apiRequest<ProductVerticalsResponse>("/verticals", {}, accessToken);
}

/** Loads categories; only active categories in operational verticals are selectable for creation. */
export function getProductCategories(accessToken: string) {
  return apiRequest<ProductCategoriesResponse>("/products/categories", {}, accessToken);
}

/** Loads the catalogue using the backend's supported server-side filters. */
export function getProducts(accessToken: string, filters: ProductListFilters = {}) {
  return apiRequest<ProductListResponse>(`/products${toQueryString(filters)}`, {}, accessToken);
}

/**
 * Creates a Draft product and its initial pack sizes in one backend operation.
 * The returned record contains the permanently allocated SKU; no preview is used.
 */
export async function createProduct(accessToken: string, payload: CreateProductRequest): Promise<ProductRecord> {
  const response = await apiRequest<{ product: ProductRecord }>(
    "/products",
    { method: "POST", body: JSON.stringify(payload) },
    accessToken,
  );
  return response.product;
}

export async function getProduct(accessToken: string, productId: string): Promise<ProductRecord> {
  const response = await apiRequest<{ product: ProductRecord }>(
    `/products/${encodeURIComponent(productId)}`,
    {},
    accessToken,
  );
  return response.product;
}
