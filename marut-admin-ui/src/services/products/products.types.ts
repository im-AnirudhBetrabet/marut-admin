/** Product catalogue API types. */

export type VerticalStatus = | "proposed" | "under_planning" | "setup_in_progress" | "operational" | "temporarily_suspended" | "closed";
export type CategoryStatus = "active" | "inactive";
export type ProductStatus  = "draft" | "active" | "inactive" | "archived";

export interface ProductVertical {
  id        : string;
  name      : string;
  code      : string;
  sku_prefix: string;
  status    : VerticalStatus;
}

export interface ProductCategory {
  id         : string;
  vertical_id: string;
  name       : string;
  description: string | null;
  status     : CategoryStatus;
  vertical   : ProductVertical;
  created_at?: string;
  updated_at?: string;
}

export interface ProductPackSizeSummary {
  id          : string;
  weight_grams: number;
  status      : "active" | "inactive";
  created_at ?: string;
  updated_at ?: string;
}

export interface ProductRecord {
  id                   : string;
  sku                  : string;
  name                 : string;
  category_id          : string;
  category             : ProductCategory;
  description          : string | null;
  growing_duration_days: number | null;
  status               : ProductStatus;
  pack_sizes           : ProductPackSizeSummary[];
  created_at           : string;
  updated_at           : string;
}

export interface CreateProductRequest {
  category_id           : string;
  name                  : string;
  description          ?: string | null;
  growing_duration_days?: number | null;
  pack_sizes_grams      : number[];
}

export interface ProductListFilters {
  category_id?: string;
  vertical_id?: string;
  status     ?: ProductStatus;
  search     ?: string;
}

export interface ProductListResponse {
  products: ProductRecord[];
}

export interface ProductCategoriesResponse {
  categories: ProductCategory[];
}

export interface ProductVerticalsResponse {
  verticals: ProductVertical[];
}
