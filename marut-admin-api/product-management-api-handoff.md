# MARUT Admin V2 — Products Management
## Frontend Engineering Handoff v1.0

**Module:** Products Management  
**Backend:** Express 5 + TypeScript + Supabase  
**API prefix:** `/api/v1`  
**Status:** Backend implementation build-validated; frontend integration pending  
**Database:** Migration 0006 and Migration 0007 executed; Migration 0008 category partial-update refinement executed.

---

# 1. Purpose of this handoff

This document defines how the frontend should integrate with the Products Management backend.

It covers six modules:

1. Product Categories
2. Product Master and SKU Management
3. Pack Sizes
4. Product Images
5. Standard Pricing
6. Minimum Price Floors

It also describes the recommended screen structure, API call sequence, state management, permissions, validation, error handling and important business rules.

The frontend should use the Express API as its only interface for catalogue mutations. It must not write directly to the underlying Supabase tables.

## 1.1 Backend status

| Module | Backend status | Frontend status |
|---|---|---|
| Categories | Implemented | Pending |
| Product Master / SKU | Implemented | Pending |
| Pack Sizes | Implemented | Pending |
| Product Images | Implemented | Pending |
| Standard Pricing | Implemented | Pending |
| Minimum Price Floors | Implemented | Pending |

TypeScript typecheck and production build have passed.

Live image-upload testing and full end-to-end integration testing remain TODOs.

---

# 2. API conventions

## 2.1 Base URL

Use the configured API base URL from the frontend environment.

```env
VITE_API_BASE_URL=https://your-api-domain.example.com
```

The example domain above is a placeholder; use the actual deployed backend URL.

All requests must include the authenticated Supabase access token:

```http
Authorization: Bearer <access_token>
```

For JSON requests:

```http
Content-Type: application/json
```

Do not send the Supabase service-role key to the browser.

## 2.2 Standard error response

The Express error handler returns:

```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product not found."
  }
}
```

Validation failures can additionally include a `details` field.

The frontend should use the stable `error.code` for UI behaviour and display the message to the user where appropriate.

Recommended handling:

| HTTP status | Frontend behaviour |
|---|---|
| 400 | Show field validation errors |
| 401 | Refresh or re-establish the Supabase session |
| 403 | Show permission restriction |
| 404 | Show not-found state |
| 409 | Show business-rule conflict; preserve entered data |
| 413 | Show file-size error |
| 415 | Show unsupported image/file error |
| 500 | Show generic error and retain form state |
| 502 | Show Storage upload failure and allow retry |

## 2.3 Permissions

The backend enforces module permissions.

| Action | Required permission |
|---|---|
| View categories | `products.view` |
| Manage categories | `products.manage` |
| View products | `products.view` |
| Manage products | `products.manage` |
| Manage pack sizes | `products.manage` |
| Manage product images | `products.manage` |
| View standard prices | `pricing.view` |
| Manage standard prices | `pricing.manage` |
| View minimum floors | `pricing.view` |
| Manage minimum floors | `pricing.manage` + Owner role |
| Reassign category to another vertical | `products.manage` + `verticals.manage` |
| Reassign product to another category | `products.manage` + `verticals.manage` |

Owners have all permissions implicitly.

Staff members must have the required module permission explicitly assigned.

**Frontend instruction:** Use the current admin profile and module permission data to decide whether to show or disable actions. However, never treat frontend permission checks as security enforcement. The backend remains authoritative.

---

# 3. Recommended UI structure

Keep Products Management as one cohesive workspace rather than six disconnected pages.

Recommended navigation:

- Overview
- Categories
- Products
- Pricing
- Minimum Price Floors (Owner-only management)

The product detail page should contain tabs:

1. Overview
2. Pack Sizes
3. Images
4. Pricing
5. History

The category detail page should contain:

1. Category Details
2. Products
3. History

The frontend developer may adapt the layout to the existing MARUT Admin design system, but should preserve the functional separation.

---

# 4. Workflow A — Initial setup and category management

## 4.1 Load initial data

When the Products Management workspace opens:

1. Fetch current admin profile and permissions if not already in application state.
2. Fetch verticals.
3. Fetch categories.
4. Fetch products if the product list is the landing screen.

Relevant endpoints:

```http
GET /api/v1/auth/me
GET /api/v1/verticals
GET /api/v1/products/categories
GET /api/v1/products
```

The category response includes its associated vertical, including:

- Vertical ID
- Vertical name
- Vertical code
- SKU prefix
- Vertical status

Use the vertical data to populate category filters and selection controls.

## 4.2 Category list screen

Endpoint:

```http
GET /api/v1/products/categories
```

Optional query parameters:

```http
?vertical_id=<uuid>&status=active
```

Suggested columns:

| Column | Source |
|---|---|
| Category name | `name` |
| Vertical | `vertical.name` |
| Description | `description` |
| Status | `status` |
| Updated | `updated_at` |

Display inactive categories too when the user chooses the appropriate filter.

Inactive categories should not be offered when creating a new product.

## 4.3 Create category

Endpoint:

```http
POST /api/v1/products/categories
```

Request:

```json
{
  "vertical_id": "VERTICAL_UUID",
  "name": "Broccoli",
  "description": "Broccoli microgreens"
}
```

Recommended UI sequence:

1. User opens Create Category.
2. Fetch or use cached verticals.
3. Show only Operational verticals as selectable options.
4. User enters name and optional description.
5. Submit request.
6. On success, insert the returned category into the category list.
7. Close the dialog and show success feedback.

The database verifies the vertical is Operational.

## 4.4 Edit category

Endpoint:

```http
PATCH /api/v1/products/categories/:id
```

Request examples:

Name and description:

```json
{
  "name": "Broccoli Microgreens",
  "description": "Fresh broccoli microgreens",
  "reason": "Clarified catalogue naming"
}
```

Description only:

```json
{
  "description": "Updated category description"
}
```

Important:

- This is a partial update.
- Omitted fields remain unchanged.
- Name changes require a reason.
- Description-only changes do not require a reason.
- The database performs the update atomically.

Do not send `null` for a field merely because it was not changed. Omit it.

## 4.5 Reassign category to another vertical

Endpoint:

```http
PATCH /api/v1/products/categories/:id/vertical
```

Request:

```json
{
  "vertical_id": "NEW_VERTICAL_UUID",
  "reason": "Category classification correction"
}
```

The user must have both:

- `products.manage`
- `verticals.manage`

Only Operational target verticals are accepted.

The UI should:

1. Show the current vertical.
2. Allow selection of another Operational vertical.
3. Display a confirmation dialog explaining that future product classification changes, but historical transactions are not rewritten.
4. Require a reason.
5. Submit and refresh the category.

## 4.6 Activate or deactivate category

Endpoint:

```http
PATCH /api/v1/products/categories/:id/status
```

Request:

```json
{
  "status": "inactive",
  "reason": "Seasonal category pause"
}
```

Only Active ↔ Inactive is supported.

Important behaviour:

- Deactivating a category does not change product statuses.
- Active products under an inactive category become unavailable for new orders.
- Reactivating the category restores eligibility only if its vertical is Operational.

The UI should communicate this impact before confirmation.

## 4.7 Delete category

Endpoint:

```http
DELETE /api/v1/products/categories/:id
```

Request body:

```json
{
  "reason": "Created in error"
}
```

A category can be deleted only if it has never been referenced by a product or historical record.

If referenced, show the backend conflict and recommend deactivation instead.

## 4.8 Category history

```http
GET /api/v1/products/categories/:id/history
```

Display the returned audit events in descending chronological order.

Useful columns:

- Action
- Previous values
- New values
- Reason
- Actor
- Timestamp

---

# 5. Workflow B — Product creation and SKU generation

This is the most important frontend workflow.

Product creation should be a guided process, not a single form with every possible field.

## 5.1 Recommended product creation wizard

**Step 1 — Product identity**

Collect:

- Product name
- Category
- Optional description
- Optional growing duration in calendar days

Category is mandatory, including for Draft products.

Only Active categories should be offered for new products.

The selected category must belong to an Operational vertical with an assigned SKU prefix.

**Step 2 — SKU preview**

Endpoint:

```http
POST /api/v1/products/sku-preview
```

Request:

```json
{
  "category_id": "CATEGORY_UUID",
  "name": "Broccoli",
  "product_abbreviation": "BROC"
}
```

The abbreviation is optional. If omitted, the system derives it from the product name.

Response:

```json
{
  "sku": "MIC-BROC-###"
}
```

The preview does not consume the global sequence.

Frontend behaviour:

- Display the suggested SKU.
- Allow the user to edit the product abbreviation.
- Update the preview when the name, category or abbreviation changes.
- Do not allow the user to edit the vertical prefix or sequence.
- Treat the preview as provisional; the actual SKU is allocated during creation.

**Step 3 — Pack sizes**

The user must select at least one pack size.

Example:

```json
[50, 100, 250, 500]
```

All values are integer grams.

Prevent duplicate weights in the UI.

**Step 4 — Review**

Show:

- Product name
- Category
- Vertical
- SKU preview
- Description
- Growing duration
- Selected pack sizes

The user should understand that the product will initially be created as Draft.

**Step 5 — Create**

Endpoint:

```http
POST /api/v1/products
```

Request:

```json
{
  "category_id": "CATEGORY_UUID",
  "name": "Broccoli",
  "product_abbreviation": "BROC",
  "description": "Fresh broccoli microgreens",
  "growing_duration_days": 10,
  "pack_sizes_grams": [50, 100, 250, 500]
}
```

On success:

- The database allocates the actual SKU.
- The product is created as Draft.
- Initial pack sizes are created atomically.
- The SKU is permanently reserved.
- The catalogue audit entry is created.
- The API returns the complete product record.

Use the returned SKU, not the earlier preview.

Do not create pack sizes through separate requests immediately after product creation. The initial pack sizes are already included in the atomic creation operation.

---

# 6. Workflow C — Product list and detail

## 6.1 Product list

Endpoint:

```http
GET /api/v1/products
```

Supported query parameters:

- `category_id`
- `vertical_id`
- `status`
- `search`

Example:

```http
GET /api/v1/products?vertical_id=VERTICAL_UUID&status=active&search=broccoli
```

Recommended columns:

| Column | Source |
|---|---|
| Product | `name` |
| SKU | `sku` |
| Category | `category.name` |
| Vertical | `category.vertical.name` |
| Pack sizes | `pack_sizes` |
| Status | `status` |
| Growing duration | `growing_duration_days` |

Use server-side filtering rather than downloading all records and filtering locally.

## 6.2 Product detail

```http
GET /api/v1/products/:id
```

The product response includes category, vertical and pack-size summaries.

Use this as the primary data source when opening a product detail page.

Then load images, prices and floors using their dedicated endpoints.

## 6.3 Edit product details

```http
PUT /api/v1/products/:id/details
```

This endpoint expects a complete detail payload, not a partial PATCH.

Request:

```json
{
  "name": "Broccoli Microgreens",
  "description": "Freshly harvested broccoli microgreens",
  "growing_duration_days": 10,
  "reason": "Updated product naming"
}
```

The `reason` is required when changing the product name. It may be omitted for description or growing-duration-only changes.

Important:

- SKU cannot be edited after creation.
- Category cannot be changed through this endpoint.
- Category reassignment has a dedicated endpoint.
- Archived products cannot be edited.
- Historical order snapshots are not modified.

The frontend should send all three detail fields each time, including `null` for an intentionally empty description or growing duration.

## 6.4 Change product category

```http
PATCH /api/v1/products/:id/category
```

Request:

```json
{
  "category_id": "NEW_CATEGORY_UUID",
  "reason": "Product classification correction"
}
```

Requires both `products.manage` and `verticals.manage`.

Only Active target categories belonging to Operational verticals are eligible.

The SKU remains unchanged.

This affects future order attribution only. Historical order and invoice snapshots remain unchanged.

## 6.5 Product lifecycle

```http
PATCH /api/v1/products/:id/status
```

Request:

```json
{
  "status": "active",
  "reason": "Product ready for catalogue launch"
}
```

Supported transitions:

| Current status | Allowed next status |
|---|---|
| Draft | Active, Archived |
| Active | Inactive, Archived |
| Inactive | Active, Archived |
| Archived | None |

Activation has prerequisites:

1. Category is Active.
2. Vertical is Operational.
3. At least one pack size is Active.
4. An effective standard price exists.
5. An effective global minimum floor exists.
6. Effective standard price is not below the applicable minimum floor.

The backend is authoritative for all checks.

**Recommended activation UX:**

Before submitting, fetch the current product, pack sizes, effective standard price and effective floor. Display a readiness checklist.

If activation fails, use the backend error code to identify the missing prerequisite and direct the user to the relevant tab.

Do not optimistically mark the product Active before the API confirms success.

## 6.6 Delete or archive product

```http
DELETE /api/v1/products/:id
```

Request:

```json
{
  "reason": "Duplicate product created accidentally"
}
```

Physical deletion is permitted only if no historical references prevent it.

If a product has pricing or transaction history, the backend rejects physical deletion. The UI should recommend archiving instead.

Archiving is performed through the lifecycle endpoint.

Archived products cannot be reactivated.

## 6.7 Product history

```http
GET /api/v1/products/:id/history
```

Display the returned audit events with previous/new values, actor, reason and timestamp.

---

# 7. Workflow D — Pack-size management

Pack sizes belong to a product.

Endpoint base:

```text
/api/v1/products/:productId/pack-sizes
```

## 7.1 Load pack sizes

```http
GET /api/v1/products/:productId/pack-sizes
```

Display Active and Inactive pack sizes.

Suggested presentation:

- Weight
- Status
- Created date
- Last updated

## 7.2 Add pack size

```http
POST /api/v1/products/:productId/pack-sizes
```

Request:

```json
{
  "weight_grams": 250
}
```

On success, refresh the pack-size list.

Rules:

- Weight must be a positive integer.
- Duplicate weights are prohibited, including inactive options.
- Weight is immutable after creation.
- If a weight is wrong and the record is not historically referenced, delete and recreate it.

## 7.3 Deactivate or reactivate

```http
PATCH /api/v1/products/:productId/pack-sizes/:packSizeId/status
```

Request:

```json
{
  "status": "inactive",
  "reason": "Temporarily unavailable pack size"
}
```

Only Active ↔ Inactive is supported.

A referenced pack size can be deactivated, but cannot be physically deleted.

Reactivation requires an eligible Active product and Active category under an Operational vertical.

## 7.4 Delete pack size

```http
DELETE /api/v1/products/:productId/pack-sizes/:packSizeId
```

Request:

```json
{
  "reason": "Incorrect pack size configuration"
}
```

If historical references exist, the backend rejects deletion.

---

# 8. Workflow E — Product images

Bucket:

```text
product-images
```

The bucket is public-read. The frontend must use the `public_url` returned by the API.

Do not construct Storage object paths yourself.

## 8.1 Load images

```http
GET /api/v1/products/:productId/images
```

Response shape:

```json
{
  "images": [
    {
      "id": "IMAGE_UUID",
      "product_id": "PRODUCT_UUID",
      "storage_object_path": "PRODUCT_UUID/IMAGE_UUID.jpg",
      "is_primary": true,
      "alt_text": "Fresh broccoli microgreens",
      "created_at": "2026-11-20T10:00:00Z",
      "created_by": "ADMIN_UUID",
      "public_url": "https://..."
    }
  ]
}
```

Use `public_url` directly in the image component.

The list is ordered with the primary image first.

## 8.2 Upload image

```http
POST /api/v1/products/:productId/images
```

This endpoint accepts raw binary bytes, not `multipart/form-data` and not JSON.

Requirements:

- JPEG, PNG or WebP.
- Maximum 5 MB.
- Maximum 10 images per product.
- The browser should send the file itself as the request body.

Example:

```typescript
await fetch(
  `${API_BASE_URL}/api/v1/products/${productId}/images`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type,
      'X-Image-Alt-Text': altText ?? '',
    },
    body: file,
  }
);
```

Use the same authenticated API client where possible, with a binary-body method that does not serialize the file as JSON.

Do not manually set a multipart boundary.

On success, append the returned image to the gallery.

The first image becomes primary automatically. When a new image is added later, it becomes primary and the previous primary becomes secondary.

## 8.3 Set primary image

```http
PATCH /api/v1/products/:productId/images/:imageId/primary
```

No request body is required.

On success, refresh the gallery or update local state using the returned image and the previously primary image.

There can be only one primary image.

## 8.4 Update alt text

```http
PATCH /api/v1/products/:productId/images/:imageId
```

Request:

```json
{
  "alt_text": "Freshly harvested broccoli microgreens"
}
```

Alt text is optional and may be `null`.

## 8.5 Remove image

```http
DELETE /api/v1/products/:productId/images/:imageId
```

Request:

```json
{
  "reason": "Replacing outdated product photograph"
}
```

The API removes the database association, not the Storage object.

If the removed image was primary, another image is promoted automatically. If it was the only image, the product has no primary image.

Do not attempt to delete the Storage object from the browser.

## 8.6 Image TODOs

These still require live testing after UI integration:

- JPEG, PNG and WebP uploads.
- Public URL rendering.
- First image primary assignment.
- Primary replacement.
- Primary removal and automatic promotion.
- Ten-image limit.
- 5 MB size limit.
- Unsupported MIME type rejection.
- Archived product restrictions.
- Storage cleanup when a database association fails.

---

# 9. Workflow F — Standard pricing

Standard pricing is stored per gram.

The frontend should display pack prices by multiplying the per-gram price by the pack weight.

The database stores four decimal places for the per-gram price. Final pack prices use two decimal places with half-up rounding.

## 9.1 Load price history

```http
GET /api/v1/products/:productId/prices
```

Display all price records, including scheduled, effective, expired and cancelled entries.

The API returns `period_status`, derived from the effective dates and cancellation fields.

Suggested columns:

- Price per gram
- Effective from
- Effective until
- Status
- Reason
- Created by
- Cancellation details

## 9.2 Load effective price

```http
GET /api/v1/products/:productId/prices/effective
```

Optional historical/future timestamp:

```http
GET /api/v1/products/:productId/prices/effective?at=2026-12-01T00:00:00%2B05:30
```

The timestamp should be an ISO-8601 value with timezone offset.

If no effective price exists, the response contains:

```json
{
  "price": null
}
```

## 9.3 Create standard price

```http
POST /api/v1/products/:productId/prices
```

Request:

```json
{
  "price_per_gram": 0.8500,
  "effective_from": null,
  "effective_until": null,
  "reason": "Initial standard price"
}
```

`effective_from: null` and `effective_until: null` are accepted by the route contract. The database function applies its default effective-date behaviour.

A future scheduled price can be submitted with an explicit effective timestamp.

Reason is mandatory, including for initial price creation.

## 9.4 Update scheduled price

```http
PATCH /api/v1/products/:productId/prices/:priceId
```

Request:

```json
{
  "price_per_gram": 0.9000,
  "effective_from": "2026-12-01T00:00:00+05:30",
  "effective_until": null,
  "reason": "Corrected upcoming price"
}
```

Only a scheduled, not-yet-effective price can be edited.

Effective and cancelled price records are immutable.

## 9.5 Cancel scheduled price

```http
POST /api/v1/products/:productId/prices/:priceId/cancel
```

Request:

```json
{
  "reason": "Price revision withdrawn"
}
```

Cancelled records remain in history and cannot be reactivated.

---

# 10. Workflow G — Minimum price floors

Minimum floors protect the minimum permitted selling price.

There are two levels:

1. Global minimum floor.
2. Product-specific minimum floor.

Applicable floor:

```text
MAX(global floor, product-specific floor)
```

A product-specific floor may be lower than the global floor. The global floor still wins.

Only Owners may create, edit or cancel floor records.

## 10.1 Global floor screen

List:

```http
GET /api/v1/pricing/global-minimum-floors
```

Create:

```http
POST /api/v1/pricing/global-minimum-floors
```

Request:

```json
{
  "minimum_price_per_gram": 0.1000,
  "effective_from": "2026-12-01T00:00:00+05:30",
  "reason": "Updated minimum margin policy"
}
```

Edit scheduled floor:

```http
PATCH /api/v1/pricing/global-minimum-floors/:floorId
```

Cancel scheduled floor:

```http
POST /api/v1/pricing/global-minimum-floors/:floorId/cancel
```

Cancellation request:

```json
{
  "reason": "Policy change withdrawn"
}
```

Global floor timeline rules are enforced by the database:

- At least one effective global floor must exist.
- Global periods remain continuous.
- No gaps or overlaps are allowed.
- Scheduling a new floor adjusts the preceding period.
- Effective floors cannot be edited.
- Cancelled floors remain in history.

The initial baseline floor is ₹0.0000 per gram.

The frontend should display the timeline clearly, including the effective date and status of every record.

## 10.2 Product-specific floor screen

List:

```http
GET /api/v1/products/:productId/minimum-price-floors
```

Effective floor:

```http
GET /api/v1/products/:productId/minimum-price-floors/effective
```

Create:

```http
POST /api/v1/products/:productId/minimum-price-floors
```

Request:

```json
{
  "minimum_price_per_gram": 0.7500,
  "effective_from": null,
  "effective_until": null,
  "reason": "Product-specific minimum margin"
}
```

Edit scheduled floor:

```http
PATCH /api/v1/products/:productId/minimum-price-floors/:floorId
```

Cancel scheduled floor:

```http
POST /api/v1/products/:productId/minimum-price-floors/:floorId/cancel
```

The product-specific floor must be greater than zero.

The UI should show both:

- Product-specific floor
- Effective applicable floor

For example:

```text
Global floor:                 ₹0.50/g
Product-specific floor:       ₹0.75/g
Applicable floor:             ₹0.75/g
```

If the product-specific floor is ₹0.30/g, the applicable floor remains ₹0.50/g.

---

# 11. Critical end-to-end UI orchestration

This section is particularly important. The frontend should follow these flows rather than allowing users to perform dependent actions in arbitrary order.

## 11.1 New product: complete workflow

```text
Open Products
      |
      v
Load categories and verticals
      |
      v
Select an Active category
      |
      v
Enter product name
      |
      v
Call SKU preview
      |
      v
Select one or more pack sizes
      |
      v
Review product details
      |
      v
POST /products
      |
      v
Product created as Draft
      |
      v
Open product detail
      |
      +---------------------+
      |                     |
      v                     v
Upload images          Configure price
(optional)                  |
                            v
                   Ensure global floor exists
                            |
                            v
                   Configure product floor
                       (optional)
                            |
                            v
                   Check activation readiness
                            |
                            v
                   PATCH product status
                       status = active
                            |
                            v
                   Product becomes Active
```

The order of image and pricing configuration is flexible. Images are optional for activation.

The product must have an effective standard price and global floor before activation. If the price is below the applicable floor, activation is rejected.

## 11.2 Activation readiness UI

Before showing the Activate button as enabled, load:

```http
GET /api/v1/products/:id
GET /api/v1/products/:id/pack-sizes
GET /api/v1/products/:id/prices/effective
GET /api/v1/products/:id/minimum-price-floors/effective
```

Also obtain the global floor timeline or current global floor through:

```http
GET /api/v1/pricing/global-minimum-floors
```

Show a checklist:

| Requirement | Ready when |
|---|---|
| Product category | Active |
| Vertical | Operational |
| Active pack size | At least one |
| Standard price | Effective price exists |
| Global floor | Effective global floor exists |
| Price compliance | Standard price is at least the applicable floor |

The UI checklist is advisory. The activation RPC makes the final decision.

If activation fails, preserve the user's data and show the specific backend error.

## 11.3 Price change workflow

When a user opens the Pricing tab:

1. Fetch price history.
2. Fetch the currently effective price.
3. Display scheduled and historical records.
4. Allow creation of a new standard price if the user has `pricing.manage`.
5. Require a reason.
6. If the price is scheduled, offer edit/cancel actions.
7. If the price is effective or expired, do not offer edit/cancel actions.

Do not assume that the frontend's displayed period status is authoritative. The database decides whether a scheduled record is still editable.

## 11.4 Category deactivation workflow

Before deactivating a category:

1. Explain that products under the category will become unavailable for new orders.
2. Clarify that product status will not change.
3. Require a reason.
4. Call the status endpoint.
5. Refresh the category and affected product lists.

Do not automatically mark all associated products Inactive.

## 11.5 Product reclassification workflow

When changing a product category:

1. Load available Active categories.
2. Ensure the destination category belongs to an Operational vertical.
3. Require `products.manage` and `verticals.manage`.
4. Show a confirmation explaining that SKU remains unchanged.
5. Explain that the change applies to future orders only.
6. Require a reason.
7. Call the category reassignment endpoint.
8. Refresh the product detail.

Do not attempt to rewrite historical orders or invoices.

---

# 12. Frontend API client recommendations

Create a central API client rather than writing `fetch()` independently in every component.

Suggested structure:

```text
src/
  services/
    api/
      client.ts
      categories.api.ts
      products.api.ts
      pack-sizes.api.ts
      product-images.api.ts
      pricing.api.ts
      minimum-price-floors.api.ts
```

The client should:

- Read the current Supabase session.
- Attach the current access token.
- Handle JSON requests.
- Support binary image upload requests.
- Parse the standard error response.
- Return typed responses.
- Avoid exposing Supabase service-role credentials.

Suggested conceptual interface:

```typescript
type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

type ApiResult<T> = {
  data: T;
  error: null;
} | {
  data: null;
  error: ApiError;
};
```

Use the existing frontend architecture if a shared API client already exists. Do not create a competing authentication/session layer.

---

# 13. UI state and refresh strategy

Avoid excessive full-page reloads.

Recommended state behaviour:

| Operation | Refresh |
|---|---|
| Create category | Category list |
| Update category | Category detail and list |
| Change category vertical | Category detail, category list and product filters |
| Create product | Product list and new product detail |
| Update product | Product detail and product list |
| Change product category | Product detail and relevant filtered lists |
| Add pack size | Pack-size list and product detail |
| Change pack-size status | Pack-size list and activation readiness |
| Upload image | Image gallery |
| Set primary image | Image gallery |
| Remove image | Image gallery |
| Create/update/cancel price | Price history and effective price |
| Create/update/cancel floor | Floor history and effective floor |

For mutations:

- Disable the submit action while the request is in progress.
- Prevent accidental duplicate submissions.
- Preserve user input when the API returns a validation or business-rule error.
- Show success feedback only after the server confirms success.
- Refresh the relevant query after a successful mutation.

---

# 14. Date, currency and rounding rules

Business timezone:

```text
Asia/Kolkata
```

Currency:

```text
INR (₹)
```

Date display:

```text
DD-MM-YYYY
```

Database timestamps use `TIMESTAMPTZ`.

Effective periods use:

```text
[effective_from, effective_until)
```

This means:

- Start timestamp is inclusive.
- End timestamp is exclusive.

Use timezone-aware ISO timestamps in API requests.

Do not send local date strings without a timezone offset.

For price display:

- Per-gram standard price: up to four decimal places.
- Final pack price: two decimal places.
- Rounding: half-up.

Example:

```text
Price per gram: ₹0.8500
Pack size:      100 g
Pack price:     ₹85.00
```

Do not independently implement a different rounding policy in the frontend.

---

# 15. Important business rules the frontend must preserve

1. Each product belongs to exactly one category.
2. Each category belongs to exactly one vertical.
3. Product vertical is derived through its category.
4. SKU is globally unique, immutable after product creation and never reused.
5. SKU preview does not reserve a sequence number.
6. Products are created as Draft.
7. Product creation requires at least one pack size.
8. Pack-size weights are immutable.
9. Inactive pack sizes cannot be offered for new orders.
10. Archived products cannot be reactivated.
11. Product images are optional, with a maximum of ten.
12. Exactly one image is primary whenever images exist.
13. Removing an image association does not delete the Storage object.
14. Standard price changes require a reason.
15. Cancelled price records remain in history.
16. Effective prices cannot be edited or cancelled.
17. Minimum price floor changes are Owner-only.
18. Global floor cannot have gaps or overlaps.
19. Applicable minimum floor is the maximum of global and product-specific floors.
20. Historical product/order/invoice snapshots must never be rewritten by catalogue changes.
21. Category and product reclassification affect future transactions only.
22. Physical deletion is restricted when historical references exist.

---

# 16. Error codes worth handling explicitly

| Error code | Recommended UI response |
|---|---|
| `CATEGORY_NAME_ALREADY_EXISTS` | Highlight category name |
| `VERTICAL_NOT_OPERATIONAL` | Ask user to select an Operational vertical |
| `CATEGORY_IN_USE` | Suggest deactivation instead of deletion |
| `DUPLICATE_RECORD` | Explain product name/SKU conflict |
| `VERTICAL_NOT_READY_FOR_PRODUCTS` | Explain that the vertical needs an SKU prefix |
| `ACTIVE_PACK_SIZE_REQUIRED` | Direct user to Pack Sizes |
| `EFFECTIVE_STANDARD_PRICE_REQUIRED` | Direct user to Pricing |
| `EFFECTIVE_GLOBAL_PRICE_FLOOR_REQUIRED` | Direct Owner to global floor setup |
| `PRODUCT_PRICE_BELOW_MINIMUM_FLOOR` | Explain price compliance issue |
| `PRODUCT_ARCHIVED` | Explain that archived products are immutable |
| `PRODUCT_HAS_HISTORICAL_REFERENCES` | Recommend archiving |
| `PACK_SIZE_ALREADY_EXISTS` | Highlight duplicate weight |
| `PACK_SIZE_HAS_HISTORY` | Explain why deletion is blocked |
| `PRODUCT_IMAGE_LIMIT_REACHED` | Explain ten-image maximum |
| `IMAGE_TOO_LARGE` | Explain 5 MB limit |
| `UNSUPPORTED_IMAGE_TYPE` | Accept only JPEG, PNG or WebP |
| `PRICE_PERIOD_OVERLAP` | Ask user to adjust the effective period |
| `PRICE_IMMUTABLE` | Explain that effective/cancelled prices cannot be changed |
| `OWNER_REQUIRED` | Show Owner-only restriction |
| `GLOBAL_FLOOR_CHAIN_INTEGRITY_ERROR` | Stop the operation and contact an Owner/admin |

---

# 17. Suggested frontend integration sequence

Implement in this order:

**Phase 1 — Catalogue foundation**
1. Categories list and CRUD.
2. Product list, filters and detail.
3. Product creation wizard and SKU preview.
4. Product detail editing and lifecycle.

**Phase 2 — Product configuration**
5. Pack-size management.
6. Product image gallery and upload.

**Phase 3 — Pricing**
7. Standard pricing history and creation.
8. Scheduled price editing/cancellation.
9. Global minimum floor management.
10. Product-specific minimum floor management.

**Phase 4 — Readiness and validation**
11. Product activation checklist.
12. Error handling and permission-based visibility.
13. Audit history presentation.
14. End-to-end testing.

Do not begin by implementing all six modules simultaneously. Complete each phase and validate its interactions before moving on.

---

# 18. Outstanding TODOs and known limitations

These are not to be represented as completed:

- Live Product Images API and Supabase Storage integration tests.
- Full frontend-to-backend end-to-end testing.
- Verification of all permission combinations using real Owner and Staff accounts.
- Visual validation of the product activation checklist.
- Confirm deployed backend URL and environment configuration.
- Confirm frontend API client handles raw binary image uploads correctly.

The backend has passed TypeScript typecheck and build validation, but this does not establish that every endpoint has passed live integration testing.

---

# 19. Handover acceptance criteria

The frontend integration can be considered complete when:

- Categories can be created, edited, reassigned, activated/deactivated and viewed with history.
- Products can be created with generated SKU and initial pack sizes.
- Product details and lifecycle can be managed.
- Pack sizes can be created, deactivated/reactivated and safely deleted when eligible.
- Product images can be uploaded, displayed, promoted and removed.
- Standard prices can be created and scheduled changes managed.
- Global and product-specific floors can be managed by Owners.
- Product activation readiness is communicated clearly.
- Staff permissions are respected in the UI and by the backend.
- Historical catalogue and transaction information remains unchanged.
- Error states preserve form data and give actionable feedback.
- The complete flow works against the deployed API and Supabase project.

---

# 20. Final implementation note

The backend is designed around controlled database functions for catalogue mutations, audit history and pricing integrity.

The frontend should focus on:

- Good user workflows.
- Clear validation.
- Permission-aware controls.
- Predictable loading and error states.
- Accurate presentation of product, pricing and lifecycle information.

It should not duplicate database business logic or attempt to bypass the Express API.

**When in doubt, the API response and database-enforced business rules are authoritative.**