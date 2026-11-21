import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, CheckCircle2, CircleDollarSign, History, Leaf, LoaderCircle, LockKeyhole, Pencil, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { ApiError } from "../../services/api/client";
import { getProduct } from "../../services/products/products.api";
import type { ProductRecord } from "../../services/products/products.types";
import { getGlobalMinimumFloors } from "../../services/pricing/globalMinimumFloors.api";
import type { GlobalMinimumFloor } from "../../services/pricing/globalMinimumFloors.types";
import { cancelProductMinimumFloor, createProductMinimumFloor, getEffectiveProductMinimumFloor, getProductMinimumFloors, updateProductMinimumFloor } from "../../services/pricing/productMinimumFloors.api";
import type { ProductMinimumFloor } from "../../services/pricing/productMinimumFloors.types";
import { cancelProductPrice, createProductPrice, getEffectiveProductPrice, getProductPrices, updateProductPrice } from "../../services/pricing/productPrices.api";
import type { ProductPriceRecord } from "../../services/pricing/productPrices.types";
import "../../styles/products.css";
import "../../styles/product-pricing.css";

type Tab = "overview" | "pricing";
type FloorDialog = "create" | "edit" | "cancel" | null;
type PriceDialog = "create" | "edit" | "cancel";
const priceStatus = (price: ProductPriceRecord) => price.period_status ?? price.status ?? "unknown";
const packPrice = (perGram: number, grams: number) => {
    const scaled = Math.round((perGram + Number.EPSILON) * 10000);
    const paise = Math.floor((scaled * grams) / 100 + 0.5);
    return `₹${(paise / 100).toFixed(2)}`;
};
const money = (value: number | string | null | undefined) => value == null ? "—" : `₹${Number(value).toFixed(4)}`;
const floorStatus = (floor: ProductMinimumFloor) => floor.period_status ?? floor.status ?? "unknown";
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value)) : "Open-ended";
const dateInput = (value?: string | null) => {
    if (!value) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};
const toIstIso = (value: string) => {
    if (!value) return null;
    const normalized = value.length === 16 ? `${value}:00` : value;
    return `${normalized}+05:30`;
};
const errorText = (error: unknown) => {
    if (error instanceof ApiError) {
        const payload = error.details as { error?: { code?: string } } | undefined;
        const code = (error as ApiError & { code?: string }).code ?? payload?.error?.code;
        if (code === "OWNER_REQUIRED" || code === "INSUFFICIENT_PERMISSION") return "Only an Owner can manage minimum price floors.";
        if (code === "INVALID_FLOOR_PERIOD_OR_AMOUNT") return "Enter a floor greater than ₹0.0000/g and a valid future effective date.";
        if (code === "FLOOR_PERIOD_OVERLAP") return "This floor period overlaps another active or scheduled floor period.";
        if (code === "FLOOR_IMMUTABLE") return "An effective or cancelled floor cannot be edited or cancelled.";
        if (code === "INVALID_PRICE_PERIOD_OR_AMOUNT") return "Enter a positive price and a valid future effective date.";
        if (code === "PRICE_PERIOD_OVERLAP") return "This price period overlaps another active or scheduled price period.";
        if (code === "PRICE_IMMUTABLE") return "An effective or cancelled price cannot be edited or cancelled.";
        if (code === "PRODUCT_ARCHIVED") return "Archived products cannot receive pricing or floor changes.";
        if (code === "REASON_REQUIRED") return "Please provide a reason for this change.";
        return error.message;
    }
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
};

export function ProductWorkspacePage() {
    const { productId = "" } = useParams();
    const { session, admin } = useAuth();
    const navigate = useNavigate();
    const token = session?.access_token;
    const isOwner = admin?.role === "owner";
    const permissions = admin?.permissions;
    const canViewPricing = isOwner || permissions === "all" || (Array.isArray(permissions) && permissions.some((item) => item.module_key === "pricing" && (item.level === "view" || item.level === "manage")));
    const [product, setProduct] = useState<ProductRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<Tab>("overview");
    const [floors, setFloors] = useState<ProductMinimumFloor[]>([]);
    const [prices, setPrices] = useState<ProductPriceRecord[]>([]);
    const [effectivePrice, setEffectivePrice] = useState<ProductPriceRecord | number | null>(null);
    const [effectiveApplicableFloor, setEffectiveApplicableFloor] = useState<number | null>(null);
    const activeProductFloor = floors.find((item) => floorStatus(item) === "effective") ?? null;
    const [globalFloor, setGlobalFloor] = useState<GlobalMinimumFloor | null>(null);
    const [pricingLoading, setPricingLoading] = useState(false);
    const [pricingError, setPricingError] = useState("");
    const [notice, setNotice] = useState("");
    const [dialog, setDialog] = useState<FloorDialog>(null);
    const [selectedFloor, setSelectedFloor] = useState<ProductMinimumFloor | null>(null);
    const [amount, setAmount] = useState("");
    const [effectiveFrom, setEffectiveFrom] = useState("");
    const [effectiveUntil, setEffectiveUntil] = useState("");
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [priceDialog, setPriceDialog] = useState<PriceDialog>("create");
    const [selectedPrice, setSelectedPrice] = useState<ProductPriceRecord | null>(null);
    const [priceAmount, setPriceAmount] = useState("");
    const [priceEffectiveFrom, setPriceEffectiveFrom] = useState("");
    const [priceEffectiveUntil, setPriceEffectiveUntil] = useState("");
    const [priceReason, setPriceReason] = useState("");
    const [priceSaving, setPriceSaving] = useState(false);
    const [priceError, setPriceError] = useState("");
    const [priceNotice, setPriceNotice] = useState("");

    useEffect(() => {
        if (!productId) { setLoading(false); setProduct(null); return; }
        if (!token) return;
        let active = true;
        setLoading(true); setError("");
        getProduct(token, productId)
            .then((record) => { if (active) setProduct(record); })
            .catch((cause) => { if (active) setError(errorText(cause)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [token, productId]);

    const loadPricing = useCallback(async () => {
        if (!token || !productId || !canViewPricing) return;
        setPricingLoading(true); setPricingError(""); setNotice(""); setPriceNotice("");
        try {
            const [history, effective, globalHistory, priceHistory, currentPrice] = await Promise.all([
                getProductMinimumFloors(token, productId),
                getEffectiveProductMinimumFloor(token, productId),
                getGlobalMinimumFloors(token),
                getProductPrices(token, productId),
                getEffectiveProductPrice(token, productId),
            ]);
            setFloors(history);
            setEffectiveApplicableFloor(effective?.minimum_price_per_gram == null ? null : Number(effective.minimum_price_per_gram));
            setGlobalFloor(globalHistory.find((item) => (item.period_status ?? item.status) === "effective") ?? null);
            setPrices(priceHistory);
            const historyEffective = priceHistory.find((item) => priceStatus(item) === "effective") ?? null;
            setEffectivePrice((currentPrice as ProductPriceRecord | number | null) ?? historyEffective);
        } catch (cause) { setPricingError(errorText(cause)); }
        finally { setPricingLoading(false); }
    }, [token, productId, canViewPricing]);

    useEffect(() => { if (tab === "pricing") void loadPricing(); }, [tab, loadPricing]);

    const sortedPackSizes = [...(product?.pack_sizes ?? [])].sort((a, b) => a.weight_grams - b.weight_grams);
    const applicableFloor = effectiveApplicableFloor;

    const openDialog = (mode: Exclude<FloorDialog, null>, floor?: ProductMinimumFloor) => {
        setPricingError(""); setReason(""); setSelectedFloor(floor ?? null);
        if (mode === "create") { setAmount(""); setEffectiveFrom(""); setEffectiveUntil(""); }
        if (mode === "edit" && floor) { setAmount(String(floor.minimum_price_per_gram)); setEffectiveFrom(dateInput(floor.effective_from)); setEffectiveUntil(dateInput(floor.effective_until)); setReason(floor.reason ?? ""); }
        setDialog(mode);
    };

    const submitFloor = async (event: FormEvent) => {
        event.preventDefault(); if (!token || !productId || !isOwner) return;
        const value = Number(amount);
        if (dialog !== "cancel" && (!Number.isFinite(value) || value <= 0)) { setPricingError("Enter a floor greater than ₹0.0000 per gram."); return; }
        if (dialog === "edit" && !effectiveFrom) { setPricingError("An effective-from date is required when editing a scheduled floor."); return; }
        if (effectiveFrom && effectiveUntil && effectiveUntil <= effectiveFrom) { setPricingError("Effective until must be later than effective from."); return; }
        if (!reason.trim()) { setPricingError("A reason is required."); return; }
        setSaving(true); setPricingError(""); setNotice("");
        try {
            if (dialog === "create") {
                await createProductMinimumFloor(token, productId, { minimum_price_per_gram: value, effective_from: toIstIso(effectiveFrom), effective_until: toIstIso(effectiveUntil), reason: reason.trim() });
                setNotice("Product-specific minimum floor created.");
            } else if (dialog === "edit" && selectedFloor) {
                await updateProductMinimumFloor(token, productId, selectedFloor.id, { minimum_price_per_gram: value, effective_from: toIstIso(effectiveFrom), effective_until: toIstIso(effectiveUntil), reason: reason.trim() });
                setNotice("Scheduled minimum floor updated.");
            } else if (dialog === "cancel" && selectedFloor) {
                await cancelProductMinimumFloor(token, productId, selectedFloor.id, reason.trim());
                setNotice("Scheduled minimum floor cancelled.");
            }
            setDialog(null); await loadPricing();
        } catch (cause) { setPricingError(errorText(cause)); }
        finally { setSaving(false); }
    };

    const openPriceForm = (mode: Exclude<PriceDialog, null>, price?: ProductPriceRecord) => {
        setPriceError(""); setPriceNotice(""); setSelectedPrice(price ?? null);
        if (mode === "create") { setPriceAmount(""); setPriceEffectiveFrom(""); setPriceEffectiveUntil(""); setPriceReason(""); }
        if (mode === "edit" && price) { setPriceAmount(String(price.price_per_gram)); setPriceEffectiveFrom(dateInput(price.effective_from)); setPriceEffectiveUntil(dateInput(price.effective_until)); setPriceReason(price.reason ?? ""); }
        if (mode === "cancel" && price) { setPriceReason(""); }
        setPriceDialog(mode);
    };

    const submitPrice = async (event: FormEvent) => {
        event.preventDefault();
        if (!token || !productId || !canManagePricing) return;
        const value = Number(priceAmount);
        if (priceDialog !== "cancel" && (!Number.isFinite(value) || value <= 0 || !/^\d+(\.\d{1,4})?$/.test(priceAmount))) { setPriceError("Enter a price greater than ₹0 with up to four decimal places."); return; }
        if (priceDialog === "edit" && !priceEffectiveFrom) { setPriceError("An effective-from date is required when editing a scheduled price."); return; }
        if (priceDialog !== "cancel" && priceEffectiveFrom && priceEffectiveUntil && priceEffectiveUntil <= priceEffectiveFrom) { setPriceError("Effective until must be later than effective from."); return; }
        if (!priceReason.trim()) { setPriceError("A reason is required."); return; }
        setPriceSaving(true); setPriceError(""); setPriceNotice("");
        try {
            if (priceDialog === "create") {
                await createProductPrice(token, productId, { price_per_gram: value, effective_from: toIstIso(priceEffectiveFrom), effective_until: toIstIso(priceEffectiveUntil), reason: priceReason.trim() });
                setPriceNotice("Standard price created.");
            } else if (priceDialog === "edit" && selectedPrice) {
                await updateProductPrice(token, productId, selectedPrice.id, { price_per_gram: value, effective_from: toIstIso(priceEffectiveFrom), effective_until: toIstIso(priceEffectiveUntil), reason: priceReason.trim() });
                setPriceNotice("Scheduled price updated.");
            } else if (priceDialog === "cancel" && selectedPrice) {
                await cancelProductPrice(token, productId, selectedPrice.id, priceReason.trim());
                setPriceNotice("Scheduled price cancelled.");
            }
            setPriceDialog("create"); setSelectedPrice(null); setPriceAmount(""); setPriceEffectiveFrom(""); setPriceEffectiveUntil(""); setPriceReason(""); await loadPricing();
        } catch (cause) { setPriceError(errorText(cause)); }
        finally { setPriceSaving(false); }
    };

    const canManagePricing = isOwner || permissions === "all" || (Array.isArray(permissions) && permissions.some((item) => item.module_key === "pricing" && item.level === "manage"));
    const effectivePricePerGram = typeof effectivePrice === "number" ? effectivePrice : effectivePrice?.price_per_gram == null ? null : Number(effectivePrice.price_per_gram);
    const enteredPrice = Number(priceAmount);
    const previewPricePerGram = priceDialog !== "cancel" && priceAmount.trim() !== "" && Number.isFinite(enteredPrice) && enteredPrice > 0 ? enteredPrice : effectivePricePerGram;

    if (loading) return <div className="products-empty-state"><LoaderCircle className="spin" /> Loading product workspace…</div>;
    if (error || !product) return <div className="products-empty-state products-empty-error">{error || "Product not found."}<button className="product-button product-button-secondary" onClick={() => navigate("/products")}>Back to Products</button></div>;

    return <div className="products-workspace">
        <button className="product-back-link" onClick={() => navigate("/products")}><ArrowLeft size={16} /> Products</button>
        <div className="products-page-heading"><div><div className="product-heading-mark"><Leaf size={16} /><span>PRODUCT WORKSPACE</span></div><h1>{product.name}</h1><p>{product.category?.vertical?.name} · {product.category?.name} · <span className="product-workspace-sku">{product.sku}</span></p></div><span className={`product-status-pill status-${product.status}`}>{product.status}</span></div>
        <nav className="product-workspace-tabs" aria-label="Product workspace sections">
            <button type="button" className={tab === "overview" ? "is-active" : ""} onClick={() => setTab("overview")}>Overview</button>
            <button type="button" className={tab === "pricing" ? "is-active" : ""} onClick={() => setTab("pricing")}><CircleDollarSign size={15} /> Pricing</button>
        </nav>

        {tab === "overview" ? <section className="product-form-card"><div className="product-section-heading"><span className="product-section-index">SKU</span><div><h2>{product.sku}</h2><p>Product identity and pack configuration.</p></div></div><div className="product-review-block"><h3>Product details</h3><dl><dt>Status</dt><dd>{product.status}</dd><dt>Description</dt><dd>{product.description || "—"}</dd><dt>Growing duration</dt><dd>{product.growing_duration_days ? `${product.growing_duration_days} days` : "—"}</dd><dt>Pack sizes</dt><dd>{sortedPackSizes.map((pack) => `${pack.weight_grams}g (${pack.status})`).join(", ") || "—"}</dd></dl></div><button className="product-button product-button-secondary" onClick={() => navigate("/products")}>Return to Products</button></section> : <section className="product-pricing-workspace">
            {!canViewPricing ? <div className="product-pricing-notice"><LockKeyhole size={19} /><div><strong>Pricing access required</strong><p>You need pricing view permission to inspect product prices and minimum floors.</p></div></div> : <>
                <section className="product-standard-pricing">
                    <div className="product-standard-pricing-heading"><div><div className="product-heading-mark"><CircleDollarSign size={15} /><span>STANDARD PRICING</span></div><h2>Price per gram</h2><p>Set the standard selling price. Pack prices are calculated from each configured pack weight.</p></div>{canManagePricing && <button type="button" className="product-button product-button-primary" onClick={() => openPriceForm("create")}><Plus size={16} /> New price</button>}</div>
                    <div className="product-standard-pricing-layout">
                        <div className="product-standard-price-overview">
                            <span className="product-pricing-eyebrow">CURRENT EFFECTIVE PRICE</span>
                            <strong>{effectivePricePerGram == null ? "Not set" : `${money(effectivePricePerGram)}/g`}</strong>
                            <p>{effectivePrice && typeof effectivePrice === "object" && "effective_from" in effectivePrice ? `Effective from ${dateTime(effectivePrice.effective_from)}` : "No effective standard price is currently configured."}</p>
                            <div className="product-pack-price-preview"><div className="product-pack-price-preview-heading"><div><h3>Pack-price preview</h3><p>{previewPricePerGram !== effectivePricePerGram ? "Based on the price being entered · rounded to 2 decimals" : "All configured pack sizes · rounded to 2 decimals"}</p></div><span>INR</span></div>
                                {sortedPackSizes.length ? <div className="product-pack-price-grid">{sortedPackSizes.map((pack) => <div className="product-pack-price-item" key={pack.id}><span>{pack.weight_grams} g <small>{pack.status}</small></span><strong>{previewPricePerGram == null ? "—" : packPrice(previewPricePerGram, pack.weight_grams)}</strong></div>)}</div> : <div className="product-pricing-empty"><strong>No pack sizes configured</strong><p>Add pack sizes before reviewing pack-price calculations.</p></div>}
                            </div>
                        </div>
                        {canManagePricing ? <form className="product-standard-price-form" onSubmit={submitPrice}>
                            <div><span className="product-pricing-eyebrow">PRICE MANAGEMENT</span><h3>{priceDialog === "edit" ? "Edit scheduled price" : priceDialog === "cancel" ? "Cancel scheduled price" : "Add a new price"}</h3><p>{priceDialog === "cancel" ? "This scheduled price will remain in history as cancelled and cannot be reactivated." : "Create an immediate price or schedule a future change."}</p></div>
                            {priceDialog === "cancel" && selectedPrice && <div className="product-pricing-notice product-price-cancel-target" role="status"><ShieldCheck size={17} /><span>You are cancelling the scheduled price of <strong>{money(selectedPrice.price_per_gram)}/g</strong>, effective from <strong>{dateTime(selectedPrice.effective_from)}</strong>. Please verify this is the intended record.</span></div>}
                            {priceDialog === "cancel" ? null : <><label className="product-pricing-field"><span>Standard price per gram (₹)</span><input type="number" min="0.0001" step="0.0001" required value={priceAmount} onChange={(event) => setPriceAmount(event.target.value)} placeholder="0.8500" /><small>Up to four decimal places. Pack prices update automatically in the preview.</small></label><label className="product-pricing-field"><span>Effective from <em>IST · optional</em></span><input type="datetime-local" value={priceEffectiveFrom} onChange={(event) => setPriceEffectiveFrom(event.target.value)} required={priceDialog === "edit"} /><small>Leave blank on creation to use the backend default effective date.</small></label><label className="product-pricing-field"><span>Effective until <em>IST · optional</em></span><input type="datetime-local" value={priceEffectiveUntil} onChange={(event) => setPriceEffectiveUntil(event.target.value)} /><small>Leave blank for an open-ended price period.</small></label></>}
                            <label className="product-pricing-field"><span>Reason</span><textarea required rows={3} maxLength={500} value={priceReason} onChange={(event) => setPriceReason(event.target.value)} placeholder="Explain this price change." /></label>
                            {priceError && <div className="product-pricing-alert" role="alert">{priceError}</div>}
                            <div className="product-standard-price-form-actions"><button type="button" className="product-button product-button-secondary" onClick={() => openPriceForm("create")} disabled={priceSaving}>Reset</button><button type="submit" className={`product-button ${priceDialog === "cancel" ? "product-button-danger" : "product-button-primary"}`} disabled={priceSaving}>{priceSaving ? "Saving…" : priceDialog === "edit" ? "Save changes" : priceDialog === "cancel" ? "Cancel price" : "Create price"}</button></div>
                        </form> : <div className="product-pricing-notice"><LockKeyhole size={17} /><span>View only. You need pricing manage permission to change standard prices.</span></div>}
                    </div>
                    {priceNotice && <div className="product-pricing-success" role="status"><CheckCircle2 size={16} />{priceNotice}</div>}
                </section>
                <div className="product-floor-history-card"><div className="product-floor-history-heading"><div><h3><History size={17} /> Standard price history</h3><p>All scheduled, effective, expired and cancelled price records.</p></div><button type="button" className="product-icon-refresh" onClick={() => void loadPricing()} disabled={pricingLoading} aria-label="Refresh pricing history" title="Refresh"><RefreshCw size={16} className={pricingLoading ? "spin" : ""} /></button></div>
                    {pricingLoading ? <div className="product-pricing-loading"><LoaderCircle className="spin" size={18} /> Loading price history…</div> : prices.length === 0 ? <div className="product-pricing-empty"><CalendarClock size={22} /><strong>No standard price history</strong><p>Create the first standard price to calculate pack prices.</p></div> : <div className="product-floor-table-wrap"><table className="product-floor-table"><thead><tr><th>Price / gram</th><th>Effective from</th><th>Effective until</th><th>Status</th><th>Reason</th><th>Created by</th><th>Cancellation details</th><th>Actions</th></tr></thead><tbody>{[...prices].sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime()).map((price) => { const status = priceStatus(price); const editable = canManagePricing && status === "scheduled"; return <tr key={price.id}><td className="product-floor-amount">{money(price.price_per_gram)}</td><td>{dateTime(price.effective_from)}</td><td>{dateTime(price.effective_until)}</td><td><span className={`product-floor-status status-${status}`}>{status}</span></td><td className="product-floor-reason">{price.reason || "—"}</td><td>{price.actor_name || price.created_by || "—"}</td><td className="product-floor-reason">{price.cancellation_reason || (price.cancelled_at ? `Cancelled ${dateTime(price.cancelled_at)}` : "—")}</td><td>{editable ? <div className="product-floor-actions"><button type="button" onClick={() => openPriceForm("edit", price)} aria-label="Edit scheduled price" title="Edit scheduled price"><Pencil size={14} /></button><button type="button" onClick={() => openPriceForm("cancel", price)} aria-label="Cancel scheduled price" title="Cancel scheduled price"><X size={15} /></button></div> : <span className="product-floor-immutable">{status === "effective" || status === "expired" || status === "cancelled" ? "Immutable" : "—"}</span>}</td></tr>; })}</tbody></table></div>}
                </div>
                <div className="product-pricing-intro"><div><div className="product-heading-mark"><ShieldCheck size={15} /><span>MINIMUM PRICE PROTECTION</span></div><h2>Minimum price floor</h2><p>Protect this product's minimum permitted selling price. The applicable floor is always the higher of the global and product-specific floors.</p></div>{isOwner && canManagePricing && <button type="button" className="product-button product-button-primary" onClick={() => openDialog("create")}><Plus size={16} /> Set product floor</button>}</div>
                {pricingError && !dialog && <div className="product-pricing-alert" role="alert">{pricingError}</div>}
                {notice && <div className="product-pricing-success" role="status"><CheckCircle2 size={16} />{notice}</div>}
                <div className="product-floor-summary-grid">
                    <article className="product-floor-summary"><span>Global floor</span><strong>{money(globalFloor?.minimum_price_per_gram ?? 0)}<small>/g</small></strong><p>{globalFloor ? `Effective from ${dateTime(globalFloor.effective_from)}` : "Baseline global floor"}</p></article>
                    <article className="product-floor-summary"><span>Product-specific floor</span><strong>{money(activeProductFloor?.minimum_price_per_gram ?? null)}<small>/g</small></strong><p>{activeProductFloor ? `Effective from ${dateTime(activeProductFloor.effective_from)}` : "No effective product floor"}</p></article>
                    <article className="product-floor-summary product-floor-summary--applicable"><span>Applicable floor</span><strong>{money(applicableFloor)}<small>/g</small></strong><p>Backend-calculated applicable floor</p></article>
                </div>
                {!isOwner && <div className="product-pricing-notice"><LockKeyhole size={17} /><span>View only. Only Owners can create, edit or cancel minimum floor records.</span></div>}
                <div className="product-floor-history-card"><div className="product-floor-history-heading"><div><h3><History size={17} /> Floor history</h3><p>Scheduled, effective, expired and cancelled product-specific floor records.</p></div><button type="button" className="product-icon-refresh" onClick={() => void loadPricing()} disabled={pricingLoading} aria-label="Refresh floor history" title="Refresh"><RefreshCw size={16} className={pricingLoading ? "spin" : ""} /></button></div>
                    {pricingLoading ? <div className="product-pricing-loading"><LoaderCircle className="spin" size={18} /> Loading floor history…</div> : floors.length === 0 ? <div className="product-pricing-empty"><CalendarClock size={22} /><strong>No product-specific floor history</strong><p>The global floor remains the applicable minimum until a product-specific floor is created.</p></div> : <div className="product-floor-table-wrap"><table className="product-floor-table"><thead><tr><th>Minimum / gram</th><th>Effective from</th><th>Effective until</th><th>Status</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{[...floors].sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime()).map((floor) => { const status = floorStatus(floor); const editable = isOwner && status === "scheduled"; return <tr key={floor.id}><td className="product-floor-amount">{money(floor.minimum_price_per_gram)}</td><td>{dateTime(floor.effective_from)}</td><td>{dateTime(floor.effective_until)}</td><td><span className={`product-floor-status status-${status}`}>{status}</span></td><td className="product-floor-reason">{floor.reason || "—"}</td><td>{editable ? <div className="product-floor-actions"><button type="button" onClick={() => openDialog("edit", floor)} aria-label="Edit scheduled floor" title="Edit scheduled floor"><Pencil size={14} /></button><button type="button" onClick={() => openDialog("cancel", floor)} aria-label="Cancel scheduled floor" title="Cancel scheduled floor"><X size={15} /></button></div> : <span className="product-floor-immutable">{status === "effective" || status === "expired" || status === "cancelled" ? "Immutable" : "—"}</span>}</td></tr>; })}</tbody></table></div>}
                </div>
            </>}
        </section>}

        {dialog && <div className="product-pricing-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialog(null); }}><form className="product-pricing-modal" onSubmit={submitFloor} role="dialog" aria-modal="true" aria-labelledby="product-floor-dialog-title"><div className="product-pricing-modal-heading"><div><span className="product-heading-mark">PRODUCT MINIMUM FLOOR</span><h2 id="product-floor-dialog-title">{dialog === "create" ? "Set a product floor" : dialog === "edit" ? "Edit scheduled floor" : "Cancel scheduled floor"}</h2></div><button type="button" onClick={() => setDialog(null)} disabled={saving} aria-label="Close"><X size={18} /></button></div>
            {dialog === "cancel" ? <p className="product-pricing-modal-copy">This scheduled floor will remain in history as cancelled and cannot be reactivated.</p> : <><label className="product-pricing-field"><span>Minimum price per gram (₹)</span><input type="number" min="0.0001" step="0.0001" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.7500" /><small>Must be greater than ₹0.0000/g. The global floor may still take precedence.</small></label><label className="product-pricing-field"><span>Effective from <em>IST</em></span><input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required={dialog === "edit"} /><small>{dialog === "edit" ? "Required for scheduled floor updates." : "Leave blank to use the backend's default effective-date behavior."}</small></label><label className="product-pricing-field"><span>Effective until <em>IST · optional</em></span><input type="datetime-local" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} /><small>Leave blank for an open-ended product floor.</small></label></>}
            <label className="product-pricing-field"><span>Reason</span><textarea required rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this floor is being changed." /></label>
            {pricingError && <div className="product-pricing-alert" role="alert">{pricingError}</div>}
            <div className="product-pricing-modal-actions"><button type="button" className="product-button product-button-secondary" onClick={() => setDialog(null)} disabled={saving}>Keep as is</button><button type="submit" className={`product-button ${dialog === "cancel" ? "product-button-danger" : "product-button-primary"}`} disabled={saving}>{saving ? "Saving…" : dialog === "create" ? "Create floor" : dialog === "edit" ? "Save changes" : "Cancel floor"}</button></div>
        </form></div>}
    </div>;
}
