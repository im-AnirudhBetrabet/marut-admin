# MARUT Admin — User & Permission Management
## Frontend Integration Handoff v1.1

**Module:** User Management & Access Control  
**Backend:** Express 5 + TypeScript + Supabase  
**API prefix:** `/api/v1`  
**Status:** Backend implementation complete; frontend integration and end-to-end testing pending.

---

## 1. Integration overview

The frontend must integrate with the existing Express API and Supabase Auth.

### Authentication responsibilities

Supabase Auth handles:
- Login
- Session persistence
- Access-token refresh
- Logout
- Invitation acceptance
- Password setup

Express handles:
- Admin authorization
- User management
- Invitation creation and management
- Permission enforcement
- Role and account-status changes
- Module metadata

Every protected Express API request must include:

`Authorization: Bearer <supabase_access_token>`

Do not use the Supabase service-role key in the frontend.

## 2. User Management APIs

### 2.1 Check email authorization

`POST /api/v1/auth/check-email`

Request:
```json
{
  "email": "admin@example.com"
}
```

Response:
```json
{
  "authorised": true,
  "can_login": true
}
```

Use this during the email-first login flow. Do not expose roles or permissions on this screen.

### 2.2 Get current admin

`GET /api/v1/auth/me`

Response:
```json
{
  "user": {
    "id": "admin-profile-uuid",
    "auth_user_id": "supabase-auth-uuid",
    "email": "admin@example.com",
    "display_name": "Admin Name",
    "role": "owner",
    "is_active": true
  },
  "role": "owner",
  "permissions": "all"
}
```

For Staff, `permissions` is an array:
```json
[
  {
    "module_key": "analytics",
    "level": "view"
  }
]
```

Use this response to initialize the authenticated admin session and determine visible navigation items.

### 2.3 List admin users

`GET /api/v1/users`

Permission required: `users:view`

Response:
```json
{
  "users": [
    {
      "id": "admin-profile-uuid",
      "email": "staff@example.com",
      "display_name": "Staff Member",
      "role": "staff",
      "is_active": true,
      "created_at": "2026-11-18T08:00:00Z",
      "last_sign_in_at": null
    }
  ]
}
```

Display:
- Name
- Email
- Role
- Account status
- Created date
- Last sign-in

### 2.4 Create invitation

`POST /api/v1/users/invitations`

Permission required: `users:manage`

Request:
```json
{
  "email": "staff@example.com",
  "display_name": "Staff Member",
  "role": "staff",
  "permissions": [
    {
      "module_key": "analytics",
      "level": "view"
    },
    {
      "module_key": "products",
      "level": "manage"
    }
  ]
}
```

Response:
```json
{
  "invitation_id": "invitation-uuid",
  "email": "staff@example.com",
  "status": "pending",
  "expires_at": "2026-11-18T09:00:00Z"
}
```

Rules:
- Staff can invite Staff only.
- Owners can invite Staff or Owners.
- Staff can grant only permissions they possess, and only up to their own permission level.
- Owners have implicit access to all modules. Do not submit individual permissions when inviting an Owner.
- Invitation expiry is one hour.

On success, show an invitation-sent confirmation.

### 2.5 Resend invitation

`POST /api/v1/users/invitations/:id/resend`

Permission required: `users:manage`

Response:
```json
{
  "invitation_id": "invitation-uuid",
  "status": "pending",
  "expires_at": "2026-11-18T10:00:00Z"
}
```

Rules:
- Accepted invitations cannot be resent.
- Only Owners can resend Owner invitations.
- The backend currently attempts to send another native Supabase invitation.

**Important: Resend reliability is not yet verified.** Keep this action available in the UI, but display the actual API error if it fails. We will test and finalize this flow during UI integration.

## 3. Permission Management APIs

### 3.1 Get a user's permissions

`GET /api/v1/users/:id/permissions`

Permission required: `users:view`

Staff response:
```json
{
  "user_id": "admin-profile-uuid",
  "role": "staff",
  "permissions": [
    {
      "module_key": "analytics",
      "level": "view"
    }
  ]
}
```

Owner response:
```json
{
  "user_id": "admin-profile-uuid",
  "role": "owner",
  "permissions": "all"
}
```

### 3.2 Replace a user's permissions

`PUT /api/v1/users/:id/permissions`

Permission required: `users:manage`

Request:
```json
{
  "permissions": [
    {
      "module_key": "analytics",
      "level": "manage"
    },
    {
      "module_key": "products",
      "level": "view"
    }
  ]
}
```

Response:
```json
{
  "user_id": "admin-profile-uuid",
  "permissions": [
    {
      "module_key": "analytics",
      "level": "manage"
    },
    {
      "module_key": "products",
      "level": "view"
    }
  ]
}
```

This replaces the entire permission set, rather than adding individual permissions.

Rules:
- Only Staff permissions can be edited.
- Owner permissions are implicit and cannot be edited.
- Staff cannot grant permissions they do not possess.
- A Staff member with `view` cannot grant `manage`.
- Duplicate module assignments are rejected.

Frontend should send the complete desired permission array when saving.

## 4. Account Status API

`PATCH /api/v1/users/:id/status`

Permission required: `users:manage`

Request:
```json
{
  "is_active": false
}
```

Response:
```json
{
  "user": {
    "id": "admin-profile-uuid",
    "email": "staff@example.com",
    "display_name": "Staff Member",
    "role": "staff",
    "is_active": false
  }
}
```

Rules:
- `true` activates an account.
- `false` deactivates an account.
- Self-deactivation is blocked.
- Staff cannot change an Owner's status.
- The last active Owner cannot be deactivated.

Show a confirmation dialog before deactivating an account.

## 5. Role Management API

`PATCH /api/v1/users/:id/role`

Owner only.

Request:
```json
{
  "role": "owner"
}
```

Response:
```json
{
  "user_id": "admin-profile-uuid",
  "role": "owner"
}
```

Rules:
- Only Owners can promote Staff to Owner.
- Owner demotion is not supported.
- Owner permissions are implicit.
- Existing Staff permission rows are removed during promotion.

Show a confirmation dialog because promotion grants full administrative access.

## 6. Module Metadata API

`GET /api/v1/meta/modules`

Returns the modules the authenticated admin can grant, including their available permission levels.

Example Owner response:
```json
{
  "modules": [
    {
      "key": "users",
      "label": "User Management",
      "description": "Manage admin accounts and invitations.",
      "permissions": ["view", "manage"]
    },
    {
      "key": "analytics",
      "label": "Analytics",
      "description": "View business analytics.",
      "permissions": ["view", "manage"]
    }
  ]
}
```

Staff receives only modules they possess.

Use this endpoint to render the permission-assignment interface dynamically. Do not hardcode module definitions in the frontend.

### Current module registry

- `users` — User Management
- `verticals` — Verticals
- `products` — Products
- `pricing` — Pricing
- `catalogue` — Catalogue
- `leads` — Marketing Leads
- `analytics` — Analytics

Permission levels:
- `view`
- `manage`

`manage` includes viewing and management capabilities.

## 7. Invitation Acceptance

The invitation link redirects to:

`/accept-invite`

Frontend responsibilities:
1. Read and process the Supabase invitation session.
2. Verify the authenticated session.
3. Allow the invitee to set their password if required by the invitation flow.
4. Call the backend acceptance endpoint.

Request:

`POST /api/v1/invitations/accept`

Headers:
`Authorization: Bearer <invitation_access_token>`

Body:
```json
{
  "invitation_id": "invitation-uuid"
}
```

Successful response:
```json
{
  "success": true,
  "user": {},
  "next": "login"
}
```

After successful acceptance:
- Sign out using the Supabase client.
- Redirect to the login screen.
- Do not automatically establish a normal authenticated admin session.

The backend validates the invitation ID, authenticated identity, invitation metadata, status and expiry before accepting it.

## 8. Logout

The frontend must call:

`supabase.auth.signOut()`

The Express endpoint `POST /api/v1/auth/logout` is informational; it does not clear the browser's Supabase session.

## 9. Frontend permission behaviour

Use the following rules for navigation and actions:

| Role / Permission | UI behaviour |
|---|---|
| Owner | All modules and actions available |
| Staff with view | Module visible; read-only actions |
| Staff with manage | Module visible; management actions available |
| Staff without permission | Hide module from navigation |

Important: hiding UI elements is not authorization. Every protected API request is independently validated by Express.

## 10. Error handling

The backend uses a consistent error response:

```json
{
  "error": {
    "code": "INSUFFICIENT_PERMISSION",
    "message": "You do not have manage permission for products."
  }
}
```

Common HTTP statuses:
- `400` — Validation error
- `401` — Missing, invalid or expired session
- `403` — Unauthorized role or permission
- `404` — Resource not found
- `409` — Conflict, duplicate account or invalid state transition
- `410` — Expired invitation
- `502` — Supabase invitation email failure
- `500` — Unexpected server error

Always display the backend's `error.message` where appropriate. Do not treat a failed request as successful.

## 11. Recommended UI screens

1. User Management listing
2. Invite Staff / Owner dialog
3. Permission assignment interface
4. User details / permissions view
5. Edit permissions dialog
6. Activate / deactivate confirmation
7. Promote to Owner confirmation
8. Invitation sent / failed feedback
9. Invitation acceptance and password setup
10. Login and session-expiry handling

## 12. Integration and testing checklist

- [ ] Login with the initial Owner account
- [ ] Load `/auth/me`
- [ ] Load `/meta/modules`
- [ ] Display User Management listing
- [ ] Invite a Staff account
- [ ] Receive invitation email
- [ ] Resend the same invitation
- [ ] Verify second invitation email delivery
- [ ] Accept invitation and set password
- [ ] Sign in as Staff
- [ ] Verify Staff navigation restrictions
- [ ] Update Staff permissions
- [ ] Verify permissions take effect in API requests
- [ ] Deactivate and reactivate Staff
- [ ] Promote Staff to Owner
- [ ] Verify Owner access
- [ ] Verify unauthorized requests return the expected errors

**Integration rule:** Do not create frontend-specific permission rules that conflict with this backend contract. The backend remains the source of truth for authorization.

**Current handoff status:** Ready for frontend integration. Invitation resend remains an explicit end-to-end testing item.