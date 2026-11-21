import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Leaf, LoaderCircle, Plus, X } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { ApiError } from "../../services/api/client";
import { createProduct, getProductCategories, getProductVerticals } from "../../services/products/products.api";
import type { ProductCategory, ProductRecord, ProductVertical } from "../../services/products/products.types";
import "../../styles/products.css";

type Step = 0 | 1 | 2;
type FormState = { verticalId: string; categoryId: string; name: string; description: string; growingDays: string; packSizes: number[] };
const initialForm: FormState = { verticalId: "", categoryId: "", name: "", description: "", growingDays: "", packSizes: [] };
const quickSizes = [50, 100, 250, 500];

function messageFrom(error: unknown) {
    if (error instanceof ApiError) return error.message;
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function ProductCreationWizard() {
    const { session } = useAuth();
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>(0);
    const [form, setForm] = useState<FormState>(initialForm);
    const [verticals, setVerticals] = useState<ProductVertical[]>([]);
    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [loadingOptions, setLoadingOptions] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [customSize, setCustomSize] = useState("");
    const [created, setCreated] = useState<ProductRecord | null>(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    useEffect(() => {
        if (!session?.access_token) return;
        let active = true;
        setLoadingOptions(true);
        Promise.all([getProductVerticals(session.access_token), getProductCategories(session.access_token)])
            .then(([verticalResponse, categoryResponse]) => {
                if (!active) return;
                setVerticals(verticalResponse.verticals ?? []);
                setCategories(categoryResponse.categories ?? []);
            })
            .catch((cause) => { if (active) setError(messageFrom(cause)); })
            .finally(() => { if (active) setLoadingOptions(false); });
        return () => { active = false; };
    }, [session?.access_token]);

    const operationalVerticals = useMemo(() => verticals.filter((item) => item.status === "operational"), [verticals]);
    const availableCategories = useMemo(() => categories.filter((item) => item.status === "active" && item.vertical_id === form.verticalId), [categories, form.verticalId]);
    const selectedVertical = operationalVerticals.find((item) => item.id === form.verticalId);
    const selectedCategory = availableCategories.find((item) => item.id === form.categoryId);
    const isDirty = Boolean(form.verticalId || form.categoryId || form.name || form.description || form.growingDays || form.packSizes.length);

    function update<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((current) => ({ ...current, [key]: value }));
        setError("");
    }

    function validateIdentity() {
        if (!form.verticalId) return "Choose an operational vertical.";
        if (!form.categoryId || !selectedCategory) return "Choose an active category.";
        if (!form.name.trim()) return "Enter a product name.";
        if (form.growingDays && (!/^\d+$/.test(form.growingDays) || Number(form.growingDays) <= 0)) return "Growing duration must be a positive whole number of days.";
        return "";
    }

    function continueStep() {
        setError("");
        if (step === 0) {
            const issue = validateIdentity();
            if (issue) { setError(issue); return; }
        }
        if (step === 1 && form.packSizes.length === 0) { setError("Add at least one pack size to continue."); return; }
        setStep((current) => Math.min(2, current + 1) as Step);
    }

    function addSize(value: number) {
        if (!Number.isInteger(value) || value <= 0) {
            setError("Enter a positive whole-number pack size.");
            return false;
        }
        if (form.packSizes.includes(value)) {
            setError(`${value}g is already selected.`);
            return false;
        }
        update("packSizes", [...form.packSizes, value].sort((a, b) => a - b));
        return true;
    }

    async function submitProduct() {
        if (!session?.access_token || submitting) return;
        setSubmitting(true);
        setError("");
        try {
            const product = await createProduct(session.access_token, {
                category_id: form.categoryId,
                name: form.name.trim(),
                description: form.description.trim() || null,
                growing_duration_days: form.growingDays ? Number(form.growingDays) : null,
                pack_sizes_grams: form.packSizes,
            });
            setCreated(product);
        } catch (cause) {
            setError(messageFrom(cause));
        } finally {
            setSubmitting(false);
        }
    }

    function leaveWizard() {
        if (isDirty && !created) setShowExitConfirm(true);
        else navigate("/products");
    }

    if (created) {
        return <div className="product-wizard-page"><div className="product-success-card">
            <div className="product-success-icon"><CheckCircle2 size={30} /></div>
            <p className="product-eyebrow">PRODUCT CREATED</p>
            <h1>Your product is ready for setup.</h1>
            <p className="product-intro">{created.name} has been added to your catalogue as a Draft.</p>
            <div className="product-created-summary"><div><span>Assigned SKU</span><strong>{created.sku}</strong></div><span className="product-status-pill">Draft</span></div>
            <div className="product-next-steps"><h2>What happens next?</h2>
                <div><CheckCircle2 size={17} /><span><strong>Product details saved</strong><small>Your product and initial pack sizes were created.</small></span></div>
                <div><Leaf size={17} /><span><strong>Add product images <em>Optional</em></strong><small>Give your catalogue a visual identity.</small></span></div>
                <div><CircleAlert size={17} /><span><strong>Configure standard pricing</strong><small>Required before the product can be activated.</small></span></div>
                <div><CircleAlert size={17} /><span><strong>Review activation readiness</strong><small>The backend checks all activation requirements.</small></span></div>
            </div>
            <div className="product-success-actions"><button type="button" className="product-button product-button-primary" onClick={() => navigate(`/products/${created.id}`)}>Open Product Workspace <ArrowRight size={17} /></button><button type="button" className="product-button product-button-secondary" onClick={() => { setCreated(null); setForm(initialForm); setStep(0); }}>Create Another Product</button><button type="button" className="product-text-button" onClick={() => navigate("/products")}>Return to Products</button></div>
        </div></div>;
    }

    return <div className="product-wizard-page">
        <div className="product-wizard-topline"><button type="button" className="product-back-link" onClick={leaveWizard}><ArrowLeft size={16} /> Products</button><span className="product-eyebrow">CATALOGUE MANAGEMENT</span></div>
        <div className="product-wizard-heading"><div><div className="product-heading-mark"><Leaf size={17} /><span>GROW WITH MARUT</span></div><h1>Create a new product</h1><p className="product-intro">Add a product to your catalogue, one step at a time.</p></div><div className="product-botanical-mark" aria-hidden="true"><Leaf size={38} /></div></div>
        <div className="product-stepper" aria-label="Creation progress">{["Product identity", "Pack sizes", "Review"].map((label, index) => <button type="button" key={label} className={`product-step${step === index ? " is-current" : ""}${step > index ? " is-complete" : ""}`} onClick={() => index < step && setStep(index as Step)} disabled={index > step}><span>{step > index ? <Check size={14} /> : index + 1}</span><small>{label}</small></button>)}</div>
        {loadingOptions ? <div className="product-loading-options"><LoaderCircle className="spin" size={20} /> Loading catalogue options…</div> : <>
            <section className="product-form-card">
                {step === 0 && <>
                    <div className="product-section-heading"><span className="product-section-index">01</span><div><h2>Product identity</h2><p>Start with the essentials. You can refine the details later.</p></div></div>
                    <div className="product-form-grid">
                        <label className="product-field"><span>Vertical <b>*</b></span><select value={form.verticalId} onChange={(event) => setForm((current) => ({ ...current, verticalId: event.target.value, categoryId: "" }))}><option value="">Select a vertical</option>{operationalVerticals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Only operational verticals are available.</small></label>
                        <label className="product-field"><span>Category <b>*</b></span><select value={form.categoryId} onChange={(event) => update("categoryId", event.target.value)} disabled={!form.verticalId}><option value="">{form.verticalId ? "Select a category" : "Choose a vertical first"}</option>{availableCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{selectedVertical ? `Categories under ${selectedVertical.name}` : "Choose the vertical to see its categories."}</small></label>
                        <label className="product-field product-field-wide"><span>Product name <b>*</b></span><input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Broccoli Microgreens" maxLength={120} /></label>
                        <label className="product-field product-field-wide"><span>Description <em>Optional</em></span><textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="A short description of this product…" rows={3} maxLength={1000} /></label>
                        <label className="product-field"><span>Growing duration <em>Optional</em></span><div className="product-input-suffix"><input inputMode="numeric" value={form.growingDays} onChange={(event) => update("growingDays", event.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 10" /><span>days</span></div><small>Enter a positive whole number.</small></label>
                    </div>
                </>}
                {step === 1 && <>
                    <div className="product-section-heading"><span className="product-section-index">02</span><div><h2>Choose pack sizes</h2><p>Select the weights in which this product will be offered.</p></div></div>
                    <div className="product-quick-size-grid">{quickSizes.map((size) => <button type="button" key={size} className={`product-size-option${form.packSizes.includes(size) ? " is-selected" : ""}`} onClick={() => form.packSizes.includes(size) ? update("packSizes", form.packSizes.filter((item) => item !== size)) : addSize(size)}><span>{size}g</span><small>{form.packSizes.includes(size) ? "Selected" : "Add pack size"}</small>{form.packSizes.includes(size) && <Check size={15} />}</button>)}</div>
                    <div className="product-custom-size"><label className="product-field"><span>Custom pack size</span><div className="product-custom-size-row"><div className="product-input-suffix"><input inputMode="numeric" value={customSize} onChange={(event) => setCustomSize(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (addSize(Number(customSize))) setCustomSize(""); } }} placeholder="Enter grams" /><span>g</span></div><button type="button" className="product-button product-button-secondary" onClick={() => { if (addSize(Number(customSize))) setCustomSize(""); }} disabled={!customSize || Number(customSize) <= 0 || form.packSizes.includes(Number(customSize))}><Plus size={16} /> Add</button></div></label></div>
                    <div className="product-selected-sizes"><div><strong>Selected pack sizes</strong><span>{form.packSizes.length} selected</span></div>{form.packSizes.length ? <div className="product-size-chips">{form.packSizes.map((size) => <span key={size}>{size}g<button type="button" aria-label={`Remove ${size} grams`} onClick={() => update("packSizes", form.packSizes.filter((item) => item !== size))}><X size={13} /></button></span>)}</div> : <p>No pack sizes selected yet.</p>}</div>
                </>}
                {step === 2 && <>
                    <div className="product-section-heading"><span className="product-section-index">03</span><div><h2>Review your product</h2><p>Take a moment to check everything before creating it.</p></div></div>
                    <div className="product-review-block"><div><h3>Product identity</h3><button type="button" onClick={() => setStep(0)}>Edit</button></div><dl><dt>Product name</dt><dd>{form.name.trim()}</dd><dt>Vertical</dt><dd>{selectedVertical?.name}</dd><dt>Category</dt><dd>{selectedCategory?.name}</dd><dt>Description</dt><dd>{form.description.trim() || "—"}</dd><dt>Growing duration</dt><dd>{form.growingDays ? `${form.growingDays} days` : "—"}</dd></dl></div>
                    <div className="product-review-block"><div><h3>Pack sizes</h3><button type="button" onClick={() => setStep(1)}>Edit</button></div><div className="product-size-chips">{form.packSizes.map((size) => <span key={size}>{size}g</span>)}</div></div>
                    <div className="product-draft-note"><Leaf size={18} /><p><strong>This product will be created as a Draft.</strong><br />The backend will assign its permanent SKU. You can add images and configure pricing after creation, then review activation readiness.</p></div>
                </>}
                {error && <div className="product-form-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
                <div className="product-wizard-actions"><button type="button" className="product-button product-button-secondary" onClick={() => step === 0 ? leaveWizard() : setStep((current) => (current - 1) as Step)}>{step === 0 ? "Cancel" : <><ArrowLeft size={16} /> Back</>}</button>{step < 2 ? <button type="button" className="product-button product-button-primary" onClick={continueStep}>Continue <ArrowRight size={16} /></button> : <button type="button" className="product-button product-button-primary" onClick={submitProduct} disabled={submitting}>{submitting ? <><LoaderCircle className="spin" size={17} /> Creating your product…</> : <>Create Product <Check size={17} /></>}</button>}</div>
            </section>
            <p className="product-wizard-footnote"><Leaf size={13} /> Thoughtfully grown. Carefully catalogued.</p>
        </>}
        {showExitConfirm && <div className="product-modal-backdrop" role="presentation"><div className="product-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title"><h2 id="exit-title">Leave product creation?</h2><p>Your progress in this wizard will be lost if you leave now.</p><div><button type="button" className="product-button product-button-secondary" onClick={() => setShowExitConfirm(false)}>Keep editing</button><button type="button" className="product-button product-button-danger" onClick={() => navigate("/products")}>Leave wizard</button></div></div></div>}
    </div>;
}
