# MARUT Admin V2 — Category Management
## Frontend API Engineering Handoff v1.0

**Module:** Products → Categories  
**Backend:** Express 5 + TypeScript + Supabase  
**Database:** PostgreSQL / Supabase  
**API prefix:** `/api/v1`  
**Permission module:** `products`  
**Status:** Backend implementation prepared; frontend integration and end-to-end testing pending.

---

## 1. Purpose

Category Management allows authorised MARUT administrators to organise products under business verticals.

The hierarchy is:

Business Vertical → Product Category → Product

Every category belongs to exactly one business vertical. Every product belongs to exactly one category. A product's vertical is derived through its category.

Categories are not independent business entities and must not be treated as product groups that can span multiple verticals.

## 2. API authentication and permissions

All endpoints require an authenticated admin session.

Include the Supabase access token in every request:

`Authorization: Bearer <access_token>`

`Content-Type: application/json` should be included for requests with JSON bodies.

### Permissions

| Operation | Required permission |
|---|---|
| List categories | `products.view` |
| View category | `products.view` |
| View category history | `products.view` |
| Create category | `products.manage` |
| Edit category | `products.manage` |
| Change category status | `products.manage` |
| Delete category | `products.manage` |
| Reassign category to another vertical | `products.manage` AND `verticals.manage` |

Owners have all permissions implicitly. Staff permissions are checked by the Express middleware.

The backend also validates that the acting admin is active through the database functions.

---

## 3. API endpoints

### 3.1 List categories

`GET /api/v1/categories`

Returns categories ordered alphabetically by name.

**Optional query parameters**

| Parameter | Type | Description |
|---|---|---|
| `vertical_id` | UUID | Filter by business vertical |
| `status` | `active` / `inactive` | Filter by category status |

Example:

`GET /api/v1/categories?vertical_id=<UUID>&status=active`

**Response**

```json
{
  "categories": [
    {
      "id": "category-uuid",
      "vertical_id": "vertical-uuid",
      "name": "Leafy Greens",
      "description": "Leafy microgreens",
      "status": "active",
      "created_at": "2026-11-20T10:00:00Z",
      "updated_at": "2026-11-20T10:00:00Z",
      "created_by": "admin-uuid",
      "updated_by": "admin-uuid",
      "vertical": {
        "id": "vertical-uuid",
        "name": "Microgreens",
        "code": "MICRO",
        "sku_prefix": "MIC",
        "status": "operational"
      }
    }
  ]
}
```

The `vertical` object is embedded in the category response. Do not make an additional request for each category to retrieve its vertical.

### 3.2 Get category details

`GET /api/v1/categories/:id`

Returns one category, including its associated vertical.

**Response**

```json
{
  "category": {
    "id": "category-uuid",
    "vertical_id": "vertical-uuid",
    "name": "Leafy Greens",
    "description": "Leafy microgreens",
    "status": "active",
    "created_at": "2026-11-20T10:00:00Z",
    "updated_at": "2026-11-20T10:00:00Z",
    "created_by": "admin-uuid",
    "updated_by": "admin-uuid",
    "vertical": {
      "id": "vertical-uuid",
      "name": "Microgreens",
      "code": "MICRO",
      "sku_prefix": "MIC",
      "status": "operational"
    }
  }
}
```

### 3.3 Create category

`POST /api/v1/categories`

**Permission:** `products.manage`

**Request**

```json
{
  "vertical_id": "vertical-uuid",
  "name": "Leafy Greens",
  "description": "Leafy microgreens"
}
```

`description` is optional and can be `null`.

**Response:** `201 Created`

```json
{
  "category": {
    "id": "new-category-uuid",
    "vertical_id": "vertical-uuid",
    "name": "Leafy Greens",
    "description": "Leafy microgreens",
    "status": "active",
    "vertical": {
      "id": "vertical-uuid",
      "name": "Microgreens",
      "code": "MICRO",
      "sku_prefix": "MIC",
      "status": "operational"
    }
  }
}
```

**Business rules**

- New categories are created with `active` status.
- The selected vertical must be `operational`.
- Category names are trimmed and unique within a vertical, case-insensitively.
- Inactive categories also participate in uniqueness checks.
- Maximum category name length: 120 characters.
- Maximum description length: 1,000 characters.

The backend performs creation and audit logging through the database RPC.

### 3.4 Edit category details

`PATCH /api/v1/categories/:id`

**Permission:** `products.manage`

This endpoint supports partial updates.

**Name-only update**

```json
{
  "name": "Fresh Leafy Greens",
  "reason": "Category naming standardisation"
}
```

**Description-only update**

```json
{
  "description": "Updated category description"
}
```

**Update both**

```json
{
  "name": "Fresh Leafy Greens",
  "description": "Updated category description",
  "reason": "Category naming standardisation"
}
```

**Important behaviour**

- Name changes require a reason.
- Description-only changes do not require a reason.
- An omitted field remains unchanged.
- Sending `description: null` explicitly clears the description.
- At least one of `name` or `description` must be provided.
- The database locks the category row and updates only the supplied fields. This prevents concurrent partial updates from overwriting one another.

**Response:** `200 OK`

```json
{
  "category": {
    "id": "category-uuid",
    "vertical_id": "vertical-uuid",
    "name": "Fresh Leafy Greens",
    "description": "Updated category description",
    "status": "active",
    "vertical": {
      "id": "vertical-uuid",
      "name": "Microgreens",
      "code": "MICRO",
      "sku_prefix": "MIC",
      "status": "operational"
    }
  }
}
```

### 3.5 Reassign category to another vertical

`PATCH /api/v1/categories/:id/vertical`

**Permissions:**
- `products.manage`
- `verticals.manage`

Both permissions are required.

**Request**

```json
{
  "vertical_id": "target-vertical-uuid",
  "reason": "Business classification restructuring"
}
```

**Business rules**

- Target vertical must be operational.
- The category's name must not conflict with another category in the target vertical.
- Reason is mandatory.
- Existing product SKUs do not change.
- Historical transaction attribution is not rewritten.
- The category's new vertical classification applies to future product/order activity.

**Response:** `200 OK`

```json
{
  "category": {
    "id": "category-uuid",
    "vertical_id": "target-vertical-uuid",
    "name": "Leafy Greens",
    "description": "Leafy microgreens",
    "status": "active",
    "vertical": {
      "id": "target-vertical-uuid",
      "name": "Hydroponic Farm",
      "code": "HYDRO",
      "sku_prefix": "HYD",
      "status": "operational"
    }
  }
}
```

### 3.6 Change category status

`PATCH /api/v1/categories/:id/status`

**Permission:** `products.manage`

**Request — deactivate**

```json
{
  "status": "inactive",
  "reason": "Category temporarily discontinued"
}
```

**Request — reactivate**

```json
{
  "status": "active",
  "reason": "Category resumed"
}
```

**Business rules**

- Only `active` and `inactive` statuses are supported.
- Active → Inactive is allowed.
- Inactive → Active is allowed.
- Reactivation requires the associated vertical to be operational.
- Reason is mandatory.
- Deactivating a category does not change the status of its products.
- Products under inactive categories become unavailable for new orders.
- Reactivation restores eligibility, provided the vertical is operational.

**Response:** `200 OK`

Returns the updated category object.

### 3.7 View category history

`GET /api/v1/categories/:id/history`

**Permission:** `products.view`

Returns the latest 100 audit records for the category, newest first.

**Response**

```json
{
  "history": [
    {
      "id": "audit-uuid",
      "entity_type": "category",
      "entity_id": "category-uuid",
      "action": "details_updated",
      "previous_values": {},
      "new_values": {},
      "reason": "Category naming standardisation",
      "actor_id": "admin-uuid",
      "created_at": "2026-11-20T10:00:00Z",
      "actor": {
        "id": "admin-uuid",
        "display_name": "Admin Name",
        "email": "admin@example.com"
      }
    }
  ]
}
```

The actual audit snapshots contain the previous and new category values. The frontend should render the changed fields rather than displaying raw JSON as the primary presentation.

The endpoint verifies that the category still exists before returning its history.

### 3.8 Delete category

`DELETE /api/v1/categories/:id`

**Permission:** `products.manage`

**Request**

```json
{
  "reason": "Category created in error"
}
```

**Response:** `204 No Content`

**Business rules**

- Reason is mandatory.
- A category can only be deleted if it has never been referenced by a product or historical product record.
- This includes products that were subsequently deleted.
- The database enforces this restriction.
- If the category has ever been referenced, deletion is rejected.

**Frontend behaviour**

Before deletion, show a confirmation dialog requiring the administrator to enter a reason.

Do not assume that an inactive category is eligible for deletion.

---

## 4. Recommended UI implementation flow

### Screen A — Category listing

On page load:

1. Call `GET /api/v1/categories`.
2. Display the category list.
3. Show category name, vertical, description and status.
4. Provide vertical and status filters.
5. Show actions according to the current admin's permissions.

Recommended columns:

| Column | Display |
|---|---|
| Category | Category name |
| Business vertical | Vertical name |
| Description | Description |
| Status | Active / Inactive |
| Updated | Last updated date |
| Actions | View / Edit / Manage |

Use a status badge for Active and Inactive.

### Screen B — Create category

1. Open the creation dialog.
2. Fetch available verticals using `GET /api/v1/verticals?status=operational` if that filter is supported by the Vertical Management API.
3. Only allow Operational verticals to be selected.
4. Enter category name and optional description.
5. Submit `POST /api/v1/categories`.
6. On success, close the dialog and refresh the listing.

Do not allow the frontend to assign a category to a Proposed, Suspended or Closed vertical.

### Screen C — Edit category

1. Load category details using `GET /api/v1/categories/:id`.
2. Allow name and description edits.
3. If the name changes, require a reason.
4. Submit only the fields being changed using `PATCH /api/v1/categories/:id`.
5. Refresh the category details after success.

The frontend must not send an omitted field as `null`, because `null` has a specific meaning for the description: clear it.

### Screen D — Reassign vertical

1. Open the reassignment dialog.
2. Fetch Operational verticals.
3. Show the current vertical.
4. Allow selection of a different vertical.
5. Require a reason.
6. Submit `PATCH /api/v1/categories/:id/vertical`.
7. Refresh the category and relevant product views.

Only show this action if the admin has both required permissions.

### Screen E — Activate / deactivate

1. Show the current status.
2. Allow the opposite status as the available action.
3. Require a reason.
4. Submit `PATCH /api/v1/categories/:id/status`.
5. Refresh the category listing.

When deactivating, show a warning that products under the category will become unavailable for new orders, even though their product status will remain unchanged.

### Screen F — Category history

1. Open the category's history panel.
2. Call `GET /api/v1/categories/:id/history`.
3. Display the action, actor, timestamp, reason and changed values.
4. Show old and new values in a readable comparison.

### Screen G — Delete category

1. Show a destructive confirmation dialog.
2. Require a reason.
3. Submit `DELETE /api/v1/categories/:id`.
4. On `204`, remove the category from the listing.
5. If the API returns `CATEGORY_IN_USE`, explain that the category has historical product references and cannot be deleted.

---

## 5. Error handling

The backend uses the common API error response structure. The frontend should use the returned error code for UI decisions rather than relying on message text.

Important category error codes:

| Error code | Expected frontend behaviour |
|---|---|
| `INVALID_CATEGORY_ID` | Show invalid request |
| `CATEGORY_NOT_FOUND` | Show not found and return to listing |
| `CATEGORY_NAME_REQUIRED` | Show validation error |
| `CATEGORY_NAME_ALREADY_EXISTS` | Show duplicate name validation |
| `VERTICAL_NOT_OPERATIONAL` | Ask user to select an Operational vertical |
| `INVALID_STATUS_TRANSITION` | Explain that the status change is not allowed |
| `CATEGORY_IN_USE` | Explain that historical references prevent deletion |
| `REASON_REQUIRED` | Require a reason |
| `CATEGORY_UPDATE_FIELDS_REQUIRED` | Require at least one editable field |
| `INSUFFICIENT_PERMISSION` | Show access denied |
| `ADMIN_INACTIVE` | End the admin session / show access denied |

HTTP status conventions:

- `400` — validation error
- `401` — unauthenticated
- `403` — permission denied or inactive admin
- `404` — category not found
- `409` — duplicate, invalid state or historical reference conflict
- `500` — unexpected server error

---

## 6. Frontend data and behaviour rules

1. Always use `category.id` as the stable identifier.
2. Do not use category names as identifiers.
3. Do not hardcode vertical names or IDs.
4. Fetch vertical data from the Vertical Management API.
5. Do not assume every vertical is Operational.
6. Keep inactive categories visible in management screens.
7. Filter to Active categories when selecting a category for a new product.
8. Do not change product status when a category is deactivated.
9. Do not attempt to delete a category just because it has no currently active products.
10. Refresh category data after every successful mutation.
11. Use the audit history endpoint for the category activity panel.
12. Do not directly access Supabase tables from the frontend; use the Express API.

## 7. Suggested frontend service structure

Suggested file:

`src/services/categories.service.ts`

Suggested methods:

```ts
getCategories(params?)
getCategory(id)
createCategory(payload)
updateCategory(id, payload)
reassignCategoryVertical(id, payload)
updateCategoryStatus(id, payload)
getCategoryHistory(id)
deleteCategory(id, payload)
```

Suggested UI structure:

```text
Products
├── Product Catalogue
└── Categories
    ├── Category List
    ├── Create Category Dialog
    ├── Edit Category Dialog
    ├── Reassign Vertical Dialog
    ├── Status Confirmation Dialog
    ├── Delete Confirmation Dialog
    └── Category History Panel
```

## 8. Integration checklist

- [ ] Category list loads successfully.
- [ ] Vertical and status filters work.
- [ ] Category details load with embedded vertical information.
- [ ] Category creation works.
- [ ] Duplicate category names are handled.
- [ ] Name-only update works with mandatory reason.
- [ ] Description-only update works without a reason.
- [ ] Description can be explicitly cleared.
- [ ] Concurrent partial updates do not overwrite omitted fields.
- [ ] Vertical reassignment checks both permissions.
- [ ] Non-Operational verticals cannot be selected.
- [ ] Category deactivation and reactivation work.
- [ ] Category deactivation does not alter product status.
- [ ] History displays actor and field-level changes.
- [ ] Referenced categories cannot be deleted.
- [ ] Successful deletion removes the category from the list.
- [ ] Staff without `products.manage` cannot mutate categories.
- [ ] Staff without `verticals.manage` cannot reassign categories.

## 9. Backend dependencies and implementation notes

The category router uses the following database functions:

- `create_product_category`
- `update_product_category_details`
- `reassign_product_category_vertical`
- `transition_product_category_status`
- `delete_product_category`

The update function uses the Migration 0008 signature:

`update_product_category_details(uuid, uuid, text, text, text, boolean, boolean)`

The two boolean arguments control whether the name and description are updated. This is important for atomic partial updates.

The router also reads from:

- `product_categories`
- `business_verticals`
- `catalogue_audit_history`
- `admin_users`

Database mutations and audit records are handled by the database functions. The frontend must not write directly to these tables.

---

**Handover status:** The category API contract and frontend interaction flow are documented. UI integration, API integration tests and end-to-end validation remain pending.