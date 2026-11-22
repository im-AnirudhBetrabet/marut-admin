import { useCallback, useEffect, useState } from "react";
import { History, LoaderCircle, RefreshCw } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { ApiError } from "../../services/api/client";
import { getProductHistory } from "../../services/products/productHistory.api";
import type { ProductHistoryEvent } from "../../services/products/productHistory.types";

interface Props { productId: string; }
const first = (event: ProductHistoryEvent, keys: string[]) => { for (const key of keys) { const value = event[key]; if (value !== undefined && value !== null && value !== "") return value; } return undefined; };
const display = (value: unknown) => { if (value === undefined || value === null || value === "") return "—"; if (typeof value === "object") { try { return JSON.stringify(value); } catch { return "[Structured value]"; } } return String(value); };
const actorDetails = (event: ProductHistoryEvent) => {
    const raw = first(event, ["actor", "performed_by", "user", "created_by"]);
    const actor = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const name = first(event, ["actor_name", "performed_by_name"]) ?? first(actor as ProductHistoryEvent, ["name", "full_name", "display_name"]) ?? (typeof raw === "string" && !raw.includes("-") ? raw : undefined);
    const email = first(event, ["actor_email", "performed_by_email", "created_by_email"]) ?? first(actor as ProductHistoryEvent, ["email", "email_address"]);
    return { name: display(name), email: display(email) };
};
const formatDate = (value: unknown) => { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); };
function message(error: unknown) { if (error instanceof ApiError) return error.message; return error instanceof Error ? error.message : "Unable to load product history."; }
export function ProductHistoryPanel({ productId }: Props) {
    const { session } = useAuth(); const token = session?.access_token; const [events, setEvents] = useState<ProductHistoryEvent[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
    const load = useCallback(async () => { if (!token) return; setLoading(true); setError(""); try { setEvents(await getProductHistory(token, productId)); } catch (cause) { setError(message(cause)); } finally { setLoading(false); } }, [token, productId]);
    useEffect(() => { void load(); }, [load]);
    const sorted = [...events].sort((a, b) => new Date(String(first(b, ["created_at", "timestamp"]) ?? 0)).getTime() - new Date(String(first(a, ["created_at", "timestamp"]) ?? 0)).getTime());
    return <section className="product-history-panel"><div className="product-media-heading"><div><span className="product-pricing-eyebrow">AUDIT TRAIL</span><h2>Product history</h2><p>Review recorded product changes, including previous and new values, who made the change, reasons and timestamps.</p></div><button type="button" className="product-icon-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh product history"><RefreshCw className={loading ? "spin" : ""} size={16} /></button></div>
        {error && <div className="product-media-alert" role="alert">{error}</div>}
        {loading ? <div className="product-pricing-loading"><LoaderCircle className="spin" size={18} /> Loading product history…</div> : sorted.length === 0 ? <div className="product-pricing-empty"><History size={22} /><strong>No product history available</strong><p>Product audit events will appear here when recorded by the backend.</p></div> : <ol className="product-history-timeline">{sorted.map((event, index) => { const action = display(first(event, ["event_type", "action", "event", "type"]) ?? "Product updated"); const actor = actorDetails(event); const reason = display(first(event, ["reason", "change_reason"])); const field = display(first(event, ["field_name", "field", "attribute"])); const previous = first(event, ["previous_value", "old_value", "before"]); const next = first(event, ["new_value", "after", "current_value"]); const timestamp = first(event, ["created_at", "timestamp", "occurred_at"]); return <li key={String(event.id ?? `${timestamp ?? "event"}-${index}`)}><div className="product-history-marker" /><article className="product-history-event"><header><div><span className="product-history-action">{action.replaceAll("_", " ")}</span>{field !== "—" && <span className="product-history-field">{field}</span>}</div><time>{formatDate(timestamp)}</time></header><div className="product-history-values"><div><small>Previous value</small><p>{display(previous)}</p></div><div><small>New value</small><p>{display(next)}</p></div></div><footer><span>By <strong>{actor.name}</strong>{actor.email !== "—" && <> · <span>{actor.email}</span></>}</span>{reason !== "—" && <span>Reason: {reason}</span>}</footer></article></li>; })}</ol>}
    </section>;
}
