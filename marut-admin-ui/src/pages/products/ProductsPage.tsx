import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Leaf, LoaderCircle, PackagePlus, Search } from "lucide-react";
import { useAuth } from "../../app/useAuth";
import { getProductCategories, getProductVerticals, getProducts } from "../../services/products/products.api";
import type { ProductCategory, ProductRecord, ProductStatus, ProductVertical } from "../../services/products/products.types";
import "../../styles/products.css";

const statusOptions: Array<{ label: string; value: ProductStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "Archived", value: "archived" },
];

export function ProductsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [verticals, setVerticals] = useState<ProductVertical[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProductStatus | "all">("all");
  const [verticalId, setVerticalId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([getProductVerticals(token), getProductCategories(token)])
      .then(([verticalResponse, categoryResponse]) => {
        if (!active) return;
        setVerticals(verticalResponse.verticals ?? []);
        setCategories(categoryResponse.categories ?? []);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load catalogue filters."); })
      .finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      getProducts(token, {
        ...(status === "all" ? {} : { status }),
        ...(verticalId ? { vertical_id: verticalId } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      })
        .then((response) => { if (active) setProducts(response.products ?? []); })
        .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load products."); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [token, status, verticalId, categoryId, search]);

  const availableCategories = useMemo(
    () => categories.filter((category) => !verticalId || category.vertical_id === verticalId),
    [categories, verticalId],
  );

  function openProduct(productId: string) {
    navigate(`/products/${encodeURIComponent(productId)}`);
  }

  return <div className="products-workspace">
    <div className="products-page-heading"><div><div className="product-heading-mark"><Leaf size={16} /><span>CATALOGUE MANAGEMENT</span></div><h1>Products</h1><p>Manage the products offered across your MARUT verticals.</p></div><button type="button" className="product-button product-button-primary" onClick={() => navigate("/products/new")}><PackagePlus size={17} /> Add Product</button></div>
    <div className="products-list-card">
      <div className="products-list-toolbar"><div><h2>Products catalogue</h2><span>{loading ? "Updating…" : `${products.length} products`}</span></div><label className="products-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU" /></label></div>
      <div className="products-filter-bar" aria-label="Product filters">
        <div className="products-status-filters" role="group" aria-label="Filter by status">{statusOptions.map((option) => <button type="button" key={option.value} className={status === option.value ? "is-active" : ""} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div>
        <div className="products-select-filters">
          <label><span>Vertical</span><select value={verticalId} onChange={(event) => { setVerticalId(event.target.value); setCategoryId(""); }} disabled={loadingOptions}><option value="">All verticals</option>{verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.name}</option>)}</select></label>
          <label><span>Category</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={loadingOptions || !availableCategories.length}><option value="">All categories</option>{availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        </div>
      </div>
      {loading ? <div className="products-empty-state"><LoaderCircle className="spin" /> Loading products…</div> : error ? <div className="products-empty-state products-empty-error">{error}</div> : products.length === 0 ? <div className="products-empty-state"><PackagePlus size={26} /><strong>{search || status !== "all" || verticalId || categoryId ? "No matching products" : "Your catalogue is ready to grow"}</strong><span>{search || status !== "all" || verticalId || categoryId ? "Try adjusting your search or filters." : "Create your first product to get started."}</span>{!search && status === "all" && !verticalId && !categoryId && <button type="button" className="product-button product-button-secondary" onClick={() => navigate("/products/new")}>Create your first product <ArrowRight size={16} /></button>}</div> : <div className="products-table-wrap"><table className="products-table"><thead><tr><th>Product</th><th>SKU</th><th>Category / Vertical</th><th>Pack sizes</th><th>Status</th></tr></thead><tbody>{products.map((product) => <tr key={product.id} onClick={() => openProduct(product.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openProduct(product.id); } }} tabIndex={0} aria-label={`Open ${product.name} workspace`}><td><button type="button" className="product-name-link" onClick={(event) => { event.stopPropagation(); openProduct(product.id); }}><strong>{product.name}</strong></button><small>{product.description || "No description"}</small></td><td className="product-sku-cell">{product.sku}</td><td>{product.category?.name ?? "—"}<small>{product.category?.vertical?.name ?? "—"}</small></td><td>{[...(product.pack_sizes ?? [])].filter((pack) => pack.status === "active").sort((a, b) => a.weight_grams - b.weight_grams).map((pack) => `${pack.weight_grams}g`).join(", ") || "—"}</td><td><span className={`product-status-pill status-${product.status}`}>{product.status}</span></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}
