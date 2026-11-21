export type ProductMinimumFloor = {
  id: string;
  minimum_price_per_gram: number | string;
  effective_from: string;
  effective_until?: string | null;
  period_status?: "scheduled" | "effective" | "expired" | "cancelled" | string;
  status?: string;
  reason?: string | null;
  created_at?: string;
  created_by?: string | null;
  actor_name?: string | null;
};

export type ProductMinimumFloorsResponse =
  | ProductMinimumFloor[]
  | { floors: ProductMinimumFloor[] }
  | { records: ProductMinimumFloor[] }
  | { data: ProductMinimumFloor[] };

export type ProductEffectiveMinimumFloorResponse = {
  minimum_price_per_gram: number | null;
  effective_at: string;
};

export type CreateProductMinimumFloorRequest = {
  minimum_price_per_gram: number;
  effective_from: string | null;
  effective_until: string | null;
  reason: string;
};

export type UpdateProductMinimumFloorRequest = Partial<CreateProductMinimumFloorRequest>;
