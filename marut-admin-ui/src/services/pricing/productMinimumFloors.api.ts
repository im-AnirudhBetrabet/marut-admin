import { apiRequest } from "../api/client";
import type {
    CreateProductMinimumFloorRequest,
    ProductEffectiveMinimumFloorResponse,
    ProductMinimumFloor,
    ProductMinimumFloorsResponse,
    UpdateProductMinimumFloorRequest,
} from "./productMinimumFloors.types";

const pathFor = (productId: string) => `/products/${encodeURIComponent(productId)}/minimum-price-floors`;

function unwrap(response: ProductMinimumFloorsResponse): ProductMinimumFloor[] {
    if (Array.isArray(response)) return response;
    if ("floors" in response && Array.isArray(response.floors)) return response.floors;
    if ("records" in response && Array.isArray(response.records)) return response.records;
    if ("data" in response && Array.isArray(response.data)) return response.data;
    return [];
}

export async function getProductMinimumFloors(accessToken: string, productId: string) {
    return unwrap(await apiRequest<ProductMinimumFloorsResponse>(pathFor(productId), {}, accessToken));
}

export async function getEffectiveProductMinimumFloor(accessToken: string, productId: string) {
    const response = await apiRequest<ProductEffectiveMinimumFloorResponse | null>(
        `${pathFor(productId)}/effective`, {}, accessToken,
    );
    if (!response) return null;
    return response as ProductEffectiveMinimumFloorResponse;
}

export function createProductMinimumFloor(accessToken: string, productId: string, payload: CreateProductMinimumFloorRequest) {
    return apiRequest<unknown>(pathFor(productId), { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function updateProductMinimumFloor(accessToken: string, productId: string, floorId: string, payload: UpdateProductMinimumFloorRequest) {
    return apiRequest<unknown>(`${pathFor(productId)}/${encodeURIComponent(floorId)}`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function cancelProductMinimumFloor(accessToken: string, productId: string, floorId: string, reason: string) {
    return apiRequest<unknown>(`${pathFor(productId)}/${encodeURIComponent(floorId)}/cancel`, {
        method: "POST", body: JSON.stringify({ reason }),
    }, accessToken);
}
