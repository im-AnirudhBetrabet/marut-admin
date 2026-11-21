import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRightLeft, Check, ChevronRight, FolderTree, History, Plus, RefreshCw, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { ApiError } from "../../services/api/client";
import { createCategory, deleteCategory, getCategories, getCategoryHistory, getOperationalVerticals, reassignCategory, updateCategory, updateCategoryStatus } from "../../services/products/categories.api";
import type { CategoryHistoryEvent } from "../../services/products/categories.types";
import type { ProductCategory, ProductVertical } from "../../services/products/products.types";

type DialogMode = "create" | "edit" | "reassign" | "status" | "delete" | null;
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const errorMessage = (error: unknown) => {
    if (error instanceof ApiError) {
        const body = error.details as { error?: { code?: string } } | undefined;
        const code = body?.error?.code;
        if (code === "CATEGORY_NAME_ALREADY_EXISTS") return "A category with this name already exists for that vertical.";
        if (code === "CATEGORY_IN_USE") return "This category has historical product references and cannot be deleted. Deactivate it instead.";
        if (code === "VERTICAL_NOT_OPERATIONAL") return "Choose an Operational vertical.";
        if (code === "INSUFFICIENT_PERMISSION") return "You don't have permission to perform this action.";
        if (code === "REASON_REQUIRED") return "Please provide a reason for this change.";
        return error.message;
    }
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
};

export function CategoriesPage() {
    const { session, admin } = useAuth();
    const token = session?.access_token;
    const permissions = admin?.permissions;
    const hasPermission = (module: string, level: string) => admin?.role === "owner" || permissions === "all" || (Array.isArray(permissions) && permissions.some((item) => item.module_key === module && (item.level === level || item.level === "manage")));
    const canManage = hasPermission("products", "manage");
    const canReassign = canManage && hasPermission("verticals", "manage");
    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [verticals, setVerticals] = useState<ProductVertical[]>([]);
    const [selected, setSelected] = useState<ProductCategory | null>(null);
    const [history, setHistory] = useState<CategoryHistoryEvent[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("all");
    const [verticalFilter, setVerticalFilter] = useState("all");
    const [dialog, setDialog] = useState<DialogMode>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [verticalId, setVerticalId] = useState("");
    const [reason, setReason] = useState("");

    const load = useCallback(async () => {
        if (!token) return;
        setLoading(true); setError("");
        try {
            const [items, operational] = await Promise.all([getCategories(token), getOperationalVerticals(token)]);
            setCategories(items); setVerticals(operational);
            setSelected((current) => current ? items.find((item) => item.id === current.id) ?? null : items[0] ?? null);
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setLoading(false); }
    }, [token]);
    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        if (!token || !selected) { setHistory([]); return; }
        let active = true; setHistoryLoading(true);
        getCategoryHistory(token, selected.id).then((items) => { if (active) setHistory(items); }).catch(() => { if (active) setHistory([]); }).finally(() => { if (active) setHistoryLoading(false); });
        return () => { active = false; };
    }, [token, selected?.id]);

    const visible = useMemo(() => categories.filter((item) => {
        const matchesSearch = `${item.name} ${item.vertical?.name ?? ""} ${item.description ?? ""}`.toLowerCase().includes(search.toLowerCase());
        return matchesSearch && (status === "all" || item.status === status) && (verticalFilter === "all" || item.vertical_id === verticalFilter);
    }), [categories, search, status, verticalFilter]);
    const activeCount = categories.filter((item) => item.status === "active").length;
    const inactiveCount = categories.length - activeCount;

    const openDialog = (mode: Exclude<DialogMode, null>, category = selected) => {
        setError(""); setReason("");
        if (mode === "create") { setSelected(category ?? null); setName(""); setDescription(""); setVerticalId(verticals[0]?.id ?? ""); }
        if (mode === "edit" && category) { setSelected(category); setName(category.name); setDescription(category.description ?? ""); }
        if (mode === "reassign" && category) { setSelected(category); setVerticalId(verticals.find((item) => item.id !== category.vertical_id)?.id ?? ""); }
        setDialog(mode);
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault(); if (!token) return;
        setBusy(true); setError(""); setNotice("");
        try {
            if (dialog === "create") {
                const created = await createCategory(token, { vertical_id: verticalId, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
                setNotice(`${created.name} was created.`); setSelected(created);
            } else if (dialog === "edit" && selected) {
                const payload: { name?: string; description?: string | null; reason?: string } = {};
                if (name.trim() !== selected.name) { payload.name = name.trim(); payload.reason = reason.trim(); }
                if (description.trim() !== (selected.description ?? "")) payload.description = description.trim() || null;
                if (!Object.keys(payload).length) { setDialog(null); return; }
                const updated = await updateCategory(token, selected.id, payload); setSelected(updated); setNotice("Category details updated.");
            } else if (dialog === "reassign" && selected) {
                const updated = await reassignCategory(token, selected.id, { vertical_id: verticalId, reason: reason.trim() }); setSelected(updated); setNotice("Category vertical reassigned.");
            } else if (dialog === "status" && selected) {
                const next = selected.status === "active" ? "inactive" : "active";
                const updated = await updateCategoryStatus(token, selected.id, { status: next, reason: reason.trim() }); setSelected(updated); setNotice(`Category ${next === "active" ? "activated" : "deactivated"}.`);
            } else if (dialog === "delete" && selected) {
                await deleteCategory(token, selected.id, reason.trim()); setNotice("Category deleted."); setSelected(null);
            }
            setDialog(null); await load();
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    };

    return <main className="page-shell categories-page">
        <div className="page-heading categories-heading"><div><div className="eyebrow">PRODUCT CATALOGUE</div><h1>Categories</h1><p>Organise products across your business verticals.</p></div><div className="categories-heading-actions"><button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{canManage && <button className="button button--primary" type="button" onClick={() => openDialog("create", null)}><Plus size={16} /> Create category</button>}</div></div>
        {error && !dialog && <div className="categories-alert categories-alert--error"><AlertCircle size={17} />{error}</div>}
        {notice && <div className="categories-alert categories-alert--success"><Check size={17} />{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="categories-metrics"><article><span>Total categories</span><strong>{categories.length}</strong><small>Across all verticals</small></article><article><span>Active</span><strong>{activeCount}</strong><small>Available for catalogue use</small></article><article><span>Inactive</span><strong>{inactiveCount}</strong><small>Retained for history</small></article></section>
        <section className="categories-layout"><div className="categories-list-panel"><div className="categories-toolbar"><label className="categories-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories or verticals" /></label><select aria-label="Filter by vertical" value={verticalFilter} onChange={(event) => setVerticalFilter(event.target.value)}><option value="all">All verticals</option>{verticals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            {loading ? <div className="categories-empty">Loading categories…</div> : visible.length === 0 ? <div className="categories-empty"><FolderTree size={28} /><strong>No categories found</strong><span>Try changing your filters or create a category.</span></div> : <div className="categories-table-wrap"><table className="categories-table"><thead><tr><th>Category</th><th>Vertical</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => setSelected(item)}><td><strong>{item.name}</strong><small>{item.description || "No description"}</small></td><td>{item.vertical?.name ?? "—"}</td><td><span className={`category-status category-status--${item.status}`}>{item.status}</span></td><td>{dateLabel(item.updated_at)}</td><td><ChevronRight size={16} /></td></tr>)}</tbody></table></div>}</div>
            <aside className="category-detail-panel">{selected ? <><div className="category-detail-top"><div><span className="eyebrow">CATEGORY DETAILS</span><h2>{selected.name}</h2></div><span className={`category-status category-status--${selected.status}`}>{selected.status}</span></div><p className="category-detail-description">{selected.description || "No description has been added."}</p><dl className="category-detail-fields"><div><dt>Business vertical</dt><dd>{selected.vertical?.name ?? "—"}</dd></div><div><dt>Vertical status</dt><dd>{selected.vertical?.status?.replaceAll("_", " ") ?? "—"}</dd></div><div><dt>Created</dt><dd>{dateLabel(selected.created_at)}</dd></div><div><dt>Last updated</dt><dd>{dateLabel(selected.updated_at)}</dd></div></dl>
                {canManage && <div className="category-actions"><button type="button" onClick={() => openDialog("edit")} className="button button--secondary">Edit details</button>{canReassign && <button type="button" onClick={() => openDialog("reassign")} className="button button--secondary"><ArrowRightLeft size={15} /> Reassign</button>}<button type="button" onClick={() => openDialog("status")} className="button button--secondary">{selected.status === "active" ? "Deactivate" : "Activate"}</button><button type="button" onClick={() => openDialog("delete")} className="button button--danger"><Trash2 size={15} /> Delete</button></div>}
                <div className="category-history"><h3><History size={16} /> Recent activity</h3>{historyLoading ? <p className="muted">Loading history…</p> : history.length === 0 ? <p className="muted">No history available.</p> : history.slice(0, 6).map((event) => <article key={event.id}><span className="history-dot" /><div><strong>{event.action ?? event.event_type ?? "Category updated"}</strong><p>{event.reason || "No reason recorded"}</p><small>{event.actor_name ?? (typeof event.actor === "string" ? event.actor : event.actor?.display_name) ?? event.changed_by ?? "Administrator"} · {dateLabel(event.changed_at ?? event.created_at)}</small></div></article>)}</div>
            </> : <div className="categories-empty"><FolderTree size={28} /><strong>Select a category</strong><span>Choose a category to view its details and history.</span></div>}</aside></section>
        {dialog && selected !== null && dialog !== "create" && <div className="category-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="category-modal" onSubmit={submit}><div className="category-modal-heading"><div><span className="eyebrow">CATEGORY MANAGEMENT</span><h2>{dialog === "edit" ? "Edit category" : dialog === "reassign" ? "Reassign vertical" : dialog === "status" ? `${selected.status === "active" ? "Deactivate" : "Activate"} category` : "Delete category"}</h2></div><button type="button" className="icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button></div>
            {dialog === "edit" && <><label>Category name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>{name.trim() !== selected.name && <label>Reason for name change<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>}</>}
            {dialog === "reassign" && <><p>Move <strong>{selected.name}</strong> to another Operational vertical. Historical transactions will not be rewritten.</p><label>New vertical<select value={verticalId} onChange={(event) => setVerticalId(event.target.value)} required><option value="">Choose a vertical</option>{verticals.filter((item) => item.id !== selected.vertical_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label></>}
            {dialog === "status" && <><p>{selected.status === "active" ? "Products under this category will become unavailable for new orders. Their product status will remain unchanged." : "This category will become available for new product classification if its vertical is Operational."}</p><label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label></>}
            {dialog === "delete" && <><p className="category-danger-copy"><ShieldAlert size={18} /> Delete <strong>{selected.name}</strong>? This cannot be undone. Categories with historical product references cannot be deleted.</p><label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label></>}
            {error && <div className="categories-alert categories-alert--error"><AlertCircle size={16} />{error}</div>}<div className="category-modal-actions"><button type="button" className="button button--secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" disabled={busy || (dialog === "reassign" && !verticalId)} className={`button ${dialog === "delete" ? "button--danger" : "button--primary"}`}>{busy ? "Saving…" : dialog === "delete" ? "Delete category" : "Save changes"}</button></div>
        </form></div>}
        {dialog === "create" && <div className="category-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="category-modal" onSubmit={submit}><div className="category-modal-heading"><div><span className="eyebrow">PRODUCT CATALOGUE</span><h2>Create category</h2></div><button type="button" className="icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button></div><label>Business vertical<select value={verticalId} onChange={(event) => setVerticalId(event.target.value)} required><option value="">Choose an Operational vertical</option>{verticals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Category name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="e.g. Broccoli" /></label><label>Description <span className="muted">(optional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="A short description of this category" /></label>{error && <div className="categories-alert categories-alert--error"><AlertCircle size={16} />{error}</div>}<div className="category-modal-actions"><button type="button" className="button button--secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" disabled={busy || !verticalId} className="button button--primary">{busy ? "Creating…" : "Create category"}</button></div></form></div>}
    </main>;
}
