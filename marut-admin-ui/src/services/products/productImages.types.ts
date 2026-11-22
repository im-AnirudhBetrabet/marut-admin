export interface ProductImageRecord {
    id: string;
    product_id: string;
    storage_object_path?: string;
    is_primary: boolean;
    alt_text?: string | null;
    created_at?: string;
    created_by?: string | null;
    public_url: string;
}

export interface ProductImagesResponse { images?: ProductImageRecord[]; data?: ProductImageRecord[]; }
export interface ProductImageResponse { image?: ProductImageRecord; data?: ProductImageRecord; }
