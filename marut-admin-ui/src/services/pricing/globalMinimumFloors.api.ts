import { apiRequest } from "../api/client";
import type {
    CreateGlobalMinimumFloorRequest,
    GlobalMinimumFloor,
    GlobalMinimumFloorsResponse,
    UpdateGlobalMinimumFloorRequest,
} from "./globalMinimumFloors.types";

const endpoint = "/pricing/global-minimum-floors";

function unwrapFloors(response: GlobalMinimumFloorsResponse): GlobalMinimumFloor[] {
    if (Array.isArray(response)) return response;
    if ("floors" in response && Array.isArray(response.floors)) return response.floors;
    if ("records" in response && Array.isArray(response.records)) return response.records;
    if ("data" in response && Array.isArray(response.data)) return response.data;
    return [];
}

export async function getGlobalMinimumFloors(accessToken: string): Promise<GlobalMinimumFloor[]> {
    return unwrapFloors(await apiRequest<GlobalMinimumFloorsResponse>(endpoint, {}, accessToken));
}

export function createGlobalMinimumFloor(accessToken: string, payload: CreateGlobalMinimumFloorRequest) {
    return apiRequest<{ floor?: GlobalMinimumFloor; data?: GlobalMinimumFloor } | GlobalMinimumFloor>(
        endpoint,
        { method: "POST", body: JSON.stringify(payload) },
        accessToken,
    );
}

export function updateGlobalMinimumFloor(accessToken: string, floorId: string, payload: UpdateGlobalMinimumFloorRequest) {
    return apiRequest<{ floor?: GlobalMinimumFloor; data?: GlobalMinimumFloor } | GlobalMinimumFloor>(
        `${endpoint}/${encodeURIComponent(floorId)}`,
        { method: "PATCH", body: JSON.stringify(payload) },
        accessToken,
    );
}

export function cancelGlobalMinimumFloor(accessToken: string, floorId: string, reason: string) {
    return apiRequest<unknown>(
        `${endpoint}/${encodeURIComponent(floorId)}/cancel`,
        { method: "POST", body: JSON.stringify({ reason }) },
        accessToken,
    );
}
