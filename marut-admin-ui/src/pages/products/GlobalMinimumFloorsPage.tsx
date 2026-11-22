import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, History, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { ApiError } from "../../services/api/client";
import { cancelGlobalMinimumFloor, createGlobalMinimumFloor, getGlobalMinimumFloors, updateGlobalMinimumFloor } from "../../services/pricing/globalMinimumFloors.api";
import type { GlobalMinimumFloor } from "../../services/pricing/globalMinimumFloors.types";

type DialogMode = "create" | "edit" | "cancel" | null;
const currency = (value: number | string) => `₹${Number(value).toFixed(4)}`;
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(value)) : "Open-ended";
const localDateTimeInput = (value?: string | null) => {
    if (!value) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};
const toIso = (value: string) => {
    const normalized = value.length === 16 ? `${value}:00` : value;
    return `${normalized}+05:30`;
};
const floorStatus = (floor: GlobalMinimumFloor): string => {
    const apiStatus = floor.period_status ?? floor.status;
    if (apiStatus) return apiStatus.toLowerCase();
    const now = Date.now();
    if (floor.effective_until && new Date(floor.effective_until).getTime() <= now) return "expired";
    if (new Date(floor.effective_from).getTime() > now) return "scheduled";
    return "effective";
};
const errorMessage = (error: unknown) => {
    if (error instanceof ApiError) {
        const body = error.details as { error?: { code?: string } } | undefined;
        const code = (error as { code?: string }).code ?? body?.error?.code;
        if (code === "OWNER_REQUIRED" || code === "INSUFFICIENT_PERMISSION") {
            return "Only an Owner/Admin with pricing management access can make this change.";
        }
        if (code === "FLOOR_IMMUTABLE") {
            return "An effective or cancelled floor cannot be changed or cancelled. Create a new scheduled floor instead.";
        }
        if (code === "INVALID_FLOOR_PERIOD_OR_AMOUNT") {
            return "Enter a valid floor amount and an effective date in the future.";
        }
        if (
            code === "FLOOR_DATE_CONFLICTS_WITH_NEXT_PERIOD" ||
            code === "FLOOR_DATE_CONFLICTS_WITH_PREVIOUS_PERIOD" ||
            code === "GLOBAL_FLOOR_INTERVAL_NOT_FOUND" ||
            code === "GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR"
        ) {
            return "This change conflicts with the global floor timeline. Refresh the timeline and try again.";
        }
        if (code === "REASON_REQUIRED") {
            return "Please provide a reason for this change.";
        }
        return error.message;
    }
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
};

export function GlobalMinimumFloorsPage() {
    const { session, admin } = useAuth();
    const token = session?.access_token;
    const isOwner = admin?.role === "owner";
    const hasViewPermission = isOwner || admin?.permissions === "all" || (Array.isArray(admin?.permissions) && admin.permissions.some((item) => item.module_key === "pricing" && (item.level === "view" || item.level === "manage")));
    const canManage = isOwner;
    const [floors, setFloors] = useState<GlobalMinimumFloor[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [dialog, setDialog] = useState<DialogMode>(null);
    const [amount, setAmount] = useState("");
    const [effectiveFrom, setEffectiveFrom] = useState("");
    const [reason, setReason] = useState("");

    const load = useCallback(async () => {
        if (!token) return;
        setLoading(true); setError("");
        try {
            const records = await getGlobalMinimumFloors(token);
            const ordered = [...records].sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime());
            setFloors(ordered);
            setSelectedId((current) => current && ordered.some((item) => item.id === current) ? current : ordered.find((item) => floorStatus(item) === "effective")?.id ?? ordered[0]?.id ?? null);
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setLoading(false); }
    }, [token]);

    useEffect(() => { if (hasViewPermission) void load(); else setLoading(false); }, [load, hasViewPermission]);

    const selected = useMemo(() => floors.find((item) => item.id === selectedId) ?? null, [floors, selectedId]);
    const currentFloor = floors.find((item) => floorStatus(item) === "effective");
    const scheduledCount = floors.filter((item) => floorStatus(item) === "scheduled").length;
    const historyCount = floors.filter((item) => ["expired", "cancelled"].includes(floorStatus(item))).length;

    const openDialog = (mode: Exclude<DialogMode, null>, floor = selected) => {
        setError(""); setReason("");
        if (mode === "create") { setAmount(""); setEffectiveFrom(""); }
        if (mode === "edit" && floor) { setAmount(String(floor.minimum_price_per_gram)); setEffectiveFrom(localDateTimeInput(floor.effective_from)); }
        setDialog(mode);
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault(); if (!token) return;
        setBusy(true); setError(""); setNotice("");
        try {
            if (dialog === "create") {
                await createGlobalMinimumFloor(token, { minimum_price_per_gram: Number(amount), effective_from: toIso(effectiveFrom), reason: reason.trim() });
                setNotice("New global minimum floor scheduled.");
            } else if (dialog === "edit" && selected) {
                await updateGlobalMinimumFloor(token, selected.id, { minimum_price_per_gram: Number(amount), effective_from: toIso(effectiveFrom), reason: reason.trim() });
                setNotice("Scheduled floor updated.");
            } else if (dialog === "cancel" && selected) {
                await cancelGlobalMinimumFloor(token, selected.id, reason.trim());
                setNotice("Scheduled floor cancelled. It remains in the timeline history.");
            }
            setDialog(null); await load();
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    };

    if (!hasViewPermission) return <main className="page-shell global-floors-page"><section className="global-floors-access"><ShieldCheck size={28} /><h1>Pricing access required</h1><p>You need pricing view access to inspect the global minimum floor timeline. Only Owners can create, edit or cancel floor records.</p></section></main>;

    return <main className="page-shell global-floors-page">
        <div className="page-heading global-floors-heading"><div><div className="eyebrow">PRODUCT CATALOGUE · PRICING POLICY</div><h1>Global Minimum Price Floors</h1><p>Set the minimum permitted selling price per gram across the catalogue.</p></div><div className="global-floors-heading-actions"><button type="button" className="button button--secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{canManage && <button type="button" className="button button--primary" onClick={() => openDialog("create")}><Plus size={15} /> Schedule floor</button>}</div></div>
        {notice && <div className="global-floors-alert global-floors-alert--success"><CheckCircle2 size={16} />{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={14} /></button></div>}
        {error && !dialog && <div className="global-floors-alert global-floors-alert--error"><AlertCircle size={16} />{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
        <section className="global-floors-metrics" aria-label="Floor overview">
            <article className="global-floors-current"><span className="metric-label">CURRENT GLOBAL FLOOR</span><strong>{currentFloor ? currency(currentFloor.minimum_price_per_gram) : loading ? "Loading…" : "—"}<small>/g</small></strong><span className="metric-foot">{currentFloor ? `Effective from ${dateTime(currentFloor.effective_from)}` : "No effective record returned"}</span></article>
            <article><span className="metric-label">SCHEDULED CHANGES</span><strong>{loading ? "—" : scheduledCount}</strong><span className="metric-foot">Upcoming policy changes</span></article>
            <article><span className="metric-label">HISTORICAL RECORDS</span><strong>{loading ? "—" : historyCount}</strong><span className="metric-foot">Expired and cancelled periods</span></article>
        </section>
        <section className="global-floors-layout">
            <div className="global-floors-list-panel"><div className="global-floors-panel-heading"><div><span className="eyebrow">POLICY TIMELINE</span><h2>Floor history</h2></div><span className="global-floors-count">{floors.length} records</span></div>
                {loading ? <div className="global-floors-empty">Loading floor timeline…</div> : floors.length === 0 ? <div className="global-floors-empty"><CalendarClock size={26} /><strong>No floor records found</strong><span>The backend should provide the baseline floor before a new policy is scheduled.</span></div> : <div className="global-floors-timeline">{floors.map((floor) => { const status = floorStatus(floor); return <button type="button" key={floor.id} onClick={() => setSelectedId(floor.id)} className={`global-floor-row${selectedId === floor.id ? " is-selected" : ""}`}><span className={`global-floor-marker global-floor-marker--${status}`} /><span className="global-floor-main"><span className="global-floor-topline"><strong>{currency(floor.minimum_price_per_gram)} <small>/ gram</small></strong><span className={`global-floor-status global-floor-status--${status}`}>{status}</span></span><span className="global-floor-dates">{dateTime(floor.effective_from)} <span>→</span> {dateTime(floor.effective_until)}</span><span className="global-floor-reason">{floor.reason || "No reason recorded"}</span></span></button>; })}</div>}
            </div>
            <aside className="global-floor-detail-panel">{selected ? <><div className="global-floor-detail-heading"><div><span className="eyebrow">SELECTED RECORD</span><h2>{currency(selected.minimum_price_per_gram)}<small> / gram</small></h2></div><span className={`global-floor-status global-floor-status--${floorStatus(selected)}`}>{floorStatus(selected)}</span></div><dl className="global-floor-detail-fields"><div><dt>Effective from</dt><dd>{dateTime(selected.effective_from)}</dd></div><div><dt>Effective until</dt><dd>{dateTime(selected.effective_until)}</dd></div><div><dt>Reason</dt><dd>{selected.reason || "No reason recorded"}</dd></div><div><dt>Created</dt><dd>{dateTime(selected.created_at)}</dd></div><div><dt>Recorded by</dt><dd>{selected.actor_name || selected.created_by || "—"}</dd></div></dl>
                {canManage && floorStatus(selected) === "scheduled" && <div className="global-floor-actions"><button type="button" className="button button--secondary" onClick={() => openDialog("edit", selected)}>Edit scheduled floor</button><button type="button" className="button button--danger" onClick={() => openDialog("cancel", selected)}>Cancel schedule</button></div>}
                <div className="global-floor-immutability-note"><History size={15} /><p>Effective and cancelled records are immutable. Scheduled records can be edited or cancelled until they take effect.</p></div>
            </> : <div className="global-floors-empty"><Clock3 size={26} /><strong>Select a floor record</strong><span>Choose a timeline entry to inspect its details.</span></div>}</aside>
        </section>
        <div className="global-floors-policy-note"><ShieldCheck size={17} /><p><strong>Timeline integrity is enforced by the backend.</strong> At least one effective floor must exist, and global periods remain continuous without gaps or overlaps. The applicable product floor is the higher of the global and product-specific floors.</p></div>

        {dialog && <div className="global-floor-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="global-floor-modal" onSubmit={submit}><div className="global-floor-modal-heading"><div><span className="eyebrow">GLOBAL PRICING POLICY</span><h2>{dialog === "create" ? "Schedule a new floor" : dialog === "edit" ? "Edit scheduled floor" : "Cancel scheduled floor"}</h2></div><button type="button" className="icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button></div>
            {dialog === "cancel" ? <><p>Cancel the scheduled floor of <strong>{selected ? currency(selected.minimum_price_per_gram) : ""}/g</strong>? The record will remain visible in history.</p><label>Reason for cancellation<input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} /></label></> : <><p className="global-floor-modal-copy">The backend will maintain a continuous timeline and adjust the preceding period when this schedule is accepted.</p><label>Minimum price per gram <span className="muted">(INR)</span><div className="global-floor-amount-input"><span>₹</span><input type="number" inputMode="decimal" min="0" step="0.0001" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="0.0000" /></div></label><label>Effective from<input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /></label><label>Reason for change<input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} placeholder="e.g. Updated minimum margin policy" /></label></>}
            {error && <div className="global-floors-alert global-floors-alert--error"><AlertCircle size={16} />{error}</div>}<div className="global-floor-modal-actions"><button type="button" className="button button--secondary" onClick={() => setDialog(null)}>Back</button><button type="submit" disabled={busy || (dialog !== "cancel" && (!amount || Number(amount) < 0 || !effectiveFrom))} className={`button ${dialog === "cancel" ? "button--danger" : "button--primary"}`}>{busy ? "Saving…" : dialog === "create" ? "Schedule floor" : dialog === "edit" ? "Save changes" : "Cancel scheduled floor"}</button></div>
        </form></div>}
    </main>;
}
