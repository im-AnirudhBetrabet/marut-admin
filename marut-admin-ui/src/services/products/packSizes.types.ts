export type PackSizeStatus = "active" | "inactive";

export interface ProductPackSize {
    id: string;
    product_id: string;
    weight_grams: number;
    status: PackSizeStatus;
    created_at?: string;
    updated_at?: string;
}

export interface ProductPackSizesResponse {
    pack_sizes: ProductPackSize[];
}

export interface CreatePackSizeRequest {
    weight_grams: number;
}

export interface PackSizeStatusRequest {
    status: PackSizeStatus;
    reason: string;
}

export interface DeletePackSizeRequest {
    reason: string;
}
