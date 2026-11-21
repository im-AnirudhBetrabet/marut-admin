import type { ProductCategory, ProductVertical } from "./products.types";

export type CategoryHistoryEvent = {
    id: string;
    action?: string;
    event_type?: string;
    actor?: { display_name?: string; email?: string } | string;
    actor_name?: string;
    changed_by?: string;
    changed_at?: string;
    created_at?: string;
    reason?: string | null;
    previous_values?: Record<string, unknown> | null;
    new_values?: Record<string, unknown> | null;
};

export type CategoriesResponse = { categories: ProductCategory[] };
export type CategoryResponse = { category: ProductCategory };
export type VerticalsResponse = { verticals: ProductVertical[] };
export type CategoryHistoryResponse = { history: CategoryHistoryEvent[] };
