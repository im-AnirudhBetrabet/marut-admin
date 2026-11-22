export interface ProductHistoryEvent {
    id?: string;
    event_type?: string;
    action?: string;
    event?: string;
    entity_type?: string;
    field_name?: string;
    previous_value?: unknown;
    old_value?: unknown;
    new_value?: unknown;
    actor_name?: string;
    actor?: string;
    created_by?: string;
    reason?: string | null;
    created_at?: string;
    timestamp?: string;
    [key: string]: unknown;
}
export type ProductHistoryResponse = ProductHistoryEvent[] | { history?: ProductHistoryEvent[]; events?: ProductHistoryEvent[]; data?: ProductHistoryEvent[] };
