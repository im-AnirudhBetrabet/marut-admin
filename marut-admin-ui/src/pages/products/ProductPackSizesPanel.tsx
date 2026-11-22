import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { ApiError } from "../../services/api/client";
import { createProductPackSize, deleteProductPackSize, getProductPackSizes, updateProductPackSizeStatus } from "../../services/products/packSizes.api";
import type { ProductPackSize } from "../../services/products/packSizes.types";
import "../../styles/product-pack-sizes.css";

interface Props { productId: string; canManage: boolean; isArchived?: boolean; onPacksChanged?: () => void | Promise<void>; }
type PackAction = "deactivate" | "reactivate" | "delete";
type ActionTarget = { pack: ProductPackSize; action: PackAction } | null;

function messageFor(error: unknown) {
    if (error instanceof ApiError) {
        const payload = error.details as { error?: { code?: string } } | undefined;
        const code = (error as ApiError & { code?: string }).code ?? payload?.error?.code;
        if (code === "PACK_SIZE_DUPLICATE" || code === "DUPLICATE_PACK_SIZE") return "This pack size already exists, including among inactive pack sizes.";
        if (code === "PACK_SIZE_REFERENCED" || code === "PACK_SIZE_IN_USE") return "This pack size is referenced by historical records. Deactivate it instead of deleting it.";
        if (code === "PRODUCT_NOT_ELIGIBLE" || code === "PACK_SIZE_REACTIVATION_NOT_ALLOWED") return "This pack size cannot be reactivated until the product, category and vertical are eligible.";
        if (code === "PRODUCT_ARCHIVED") return "Archived products cannot have pack sizes changed.";
        return error.message;
    }
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatDate(value?: string) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function ProductPackSizesPanel({ productId, canManage, isArchived = false, onPacksChanged }: Props) {
    const { session } = useAuth();
    const token = session?.access_token;
    const [packs, setPacks] = useState<ProductPackSize[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [weight, setWeight] = useState("");
    const [reason, setReason] = useState("");
    const [target, setTarget] = useState<ActionTarget>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const load = useCallback(async () => {
        if (!token || !productId) return;
        setLoading(true); setError("");
        try { setPacks(await getProductPackSizes(token, productId)); }
        catch (cause) { setError(messageFor(cause)); }
        finally { setLoading(false); }
    }, [token, productId]);

    useEffect(() => { void load(); }, [load]);

    const addPack = async (event: FormEvent) => {
        event.preventDefault();
        if (!token || !canManage) return;
        const grams = Number(weight);
        if (!Number.isInteger(grams) || grams <= 0) { setError("Enter a positive whole-number weight in grams."); return; }
        if (packs.some((pack) => pack.weight_grams === grams)) { setError("This weight already exists. Inactive pack sizes also count as duplicates."); return; }
        setSaving(true); setError(""); setNotice("");
        try {
            await createProductPackSize(token, productId, { weight_grams: grams });
            setWeight(""); setNotice(`${grams} g pack size added.`); await load(); await onPacksChanged?.();
        } catch (cause) { setError(messageFor(cause)); }
        finally { setSaving(false); }
    };

    const submitAction = async (event: FormEvent) => {
        event.preventDefault();
        if (!token || !target || !canManage || !reason.trim()) return;
        setSaving(true); setError(""); setNotice("");
        try {
            if (target.action === "delete") {
                await deleteProductPackSize(token, productId, target.pack.id, { reason: reason.trim() });
                setNotice(`${target.pack.weight_grams} g pack size deleted.`);
            } else {
                const status = target.action === "deactivate" ? "inactive" : "active";
                await updateProductPackSizeStatus(token, productId, target.pack.id, { status, reason: reason.trim() });
                setNotice(`${target.pack.weight_grams} g pack size ${status === "active" ? "reactivated" : "deactivated"}.`);
            }
            setTarget(null); setReason(""); await load(); await onPacksChanged?.();
        } catch (cause) { setError(messageFor(cause)); }
        finally { setSaving(false); }
    };

    const openAction = (pack: ProductPackSize, action: PackAction) => { setError(""); setReason(""); setTarget({ pack, action }); };

    const sorted = [...packs].sort((a, b) => a.weight_grams - b.weight_grams);
    const activeCount = packs.filter((pack) => pack.status === "active").length;

    return <section className="product-pack-sizes-panel">
        <div className="product-pack-sizes-heading"><div><span className="product-pricing-eyebrow">PRODUCT CONFIGURATION</span><h2>Pack sizes</h2><p>Manage the sellable weights available for this product. Pack weights cannot be edited after creation.</p></div><button type="button" className="product-icon-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh pack sizes"><RefreshCw size={16} className={loading ? "spin" : ""} /></button></div>
        <div className="product-pack-size-stats"><article><span>Total pack sizes</span><strong>{packs.length}</strong></article><article><span>Active</span><strong>{activeCount}</strong></article><article><span>Inactive</span><strong>{packs.length - activeCount}</strong></article></div>
        {error && !target && <div className="product-pack-size-alert" role="alert"><AlertCircle size={16} />{error}</div>}
        {notice && <div className="product-pack-size-success" role="status"><CheckCircle2 size={16} />{notice}</div>}
        {isArchived && <div className="product-pricing-notice" role="status">Archived products cannot have pack sizes changed.</div>}
        {canManage && !isArchived && <form className="product-pack-size-add" onSubmit={addPack}><label><span>Add pack size</span><div><input type="number" min="1" step="1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="e.g. 250" required /><b>grams</b></div></label><button type="submit" className="product-button product-button-primary" disabled={saving}><Plus size={16} /> Add pack size</button></form>}
        <div className="product-pack-size-list-heading"><div><h3>Configured weights</h3><p>Active and inactive pack sizes, including their audit timestamps.</p></div></div>
        {loading ? <div className="product-pricing-loading"><LoaderCircle className="spin" size={18} /> Loading pack sizes…</div> : sorted.length === 0 ? <div className="product-pricing-empty"><strong>No pack sizes configured</strong><p>Add the first pack size to make this product available in pack-based pricing.</p></div> : <div className="product-pack-size-table-wrap"><table className="product-pack-size-table"><thead><tr><th>Pack weight</th><th>Status</th><th>Created</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>{sorted.map((pack) => <tr key={pack.id}><td><strong>{pack.weight_grams} g</strong></td><td><span className={`product-floor-status status-${pack.status}`}>{pack.status}</span></td><td>{formatDate(pack.created_at)}</td><td>{formatDate(pack.updated_at)}</td><td>{canManage && !isArchived ? <div className="product-floor-actions">{pack.status === "active" ? <button type="button" title="Deactivate pack size" aria-label={`Deactivate ${pack.weight_grams} gram pack`} onClick={() => openAction(pack, "deactivate")}><X size={15} /></button> : <button type="button" title="Reactivate pack size" aria-label={`Reactivate ${pack.weight_grams} gram pack`} onClick={() => openAction(pack, "reactivate")}><RefreshCw size={14} /></button>}<button type="button" title="Delete pack size" aria-label={`Delete ${pack.weight_grams} gram pack`} onClick={() => openAction(pack, "delete")}><Trash2 size={14} /></button></div> : <span className="product-floor-immutable">View only</span>}</td></tr>)}</tbody></table></div>}
        {!canManage && !isArchived && <div className="product-pricing-notice">View only. You need products manage permission to change pack sizes.</div>}
        {target && <div className="product-pricing-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setTarget(null); }}><form className="product-pricing-modal" onSubmit={submitAction} role="dialog" aria-modal="true" aria-labelledby="pack-size-action-title"><div className="product-pricing-modal-heading"><div><span className="product-pricing-eyebrow">PACK SIZE · {target.pack.weight_grams} G</span><h2 id="pack-size-action-title">{target.action === "delete" ? "Delete pack size?" : target.action === "deactivate" ? "Deactivate pack size?" : "Reactivate pack size?"}</h2></div><button type="button" onClick={() => setTarget(null)} disabled={saving} aria-label="Close"><X size={18} /></button></div><p className="product-pricing-modal-copy">{target.action === "delete" ? "Deletion is allowed only when no historical records reference this pack size. If it is already in use, the backend will reject deletion; deactivate it instead." : target.action === "deactivate" ? "This pack size will no longer be available for new catalogue orders. Existing historical references remain intact." : "Reactivation is allowed only when the product, category and vertical meet the backend eligibility rules."}</p><label className="product-pricing-field"><span>Reason</span><textarea rows={3} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain this change." /></label>{error && <div className="product-pack-size-alert" role="alert">{error}</div>}<div className="product-pricing-modal-actions"><button type="button" className="product-button product-button-secondary" onClick={() => setTarget(null)} disabled={saving}>Keep as is</button><button type="submit" className={`product-button ${target.action === "delete" ? "product-button-danger" : "product-button-primary"}`} disabled={saving}>{saving ? "Saving…" : target.action === "delete" ? "Delete pack size" : target.action === "deactivate" ? "Deactivate" : "Reactivate"}</button></div></form></div>}
    </section>;
}
