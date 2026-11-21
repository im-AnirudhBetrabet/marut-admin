export type GlobalMinimumFloor = {
    id: string;
    minimum_price_per_gram: number | string;
    effective_from: string;
    effective_until?: string | null;
    status?: "scheduled" | "effective" | "expired" | "cancelled" | string;
    period_status?: "scheduled" | "effective" | "expired" | "cancelled" | string;
    reason?: string | null;
    created_at?: string;
    updated_at?: string;
    created_by?: string | null;
    actor_name?: string | null;
};

export type GlobalMinimumFloorsResponse =
    | GlobalMinimumFloor[]
    | { floors: GlobalMinimumFloor[] }
    | { data: GlobalMinimumFloor[] }
    | { records: GlobalMinimumFloor[] };

export type CreateGlobalMinimumFloorRequest = {
    minimum_price_per_gram: number;
    effective_from: string;
    reason: string;
};

export type UpdateGlobalMinimumFloorRequest = Partial<CreateGlobalMinimumFloorRequest>;
