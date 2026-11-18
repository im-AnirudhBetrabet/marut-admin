import { useCallback, useEffect, useMemo, useState, type FormEvent }         from "react";
import { Check, Clock3, MailPlus, RefreshCw, ShieldCheck, Users, X, Pencil } from "lucide-react";
import { EditUserPermissionsDialog }                                         from "./EditUserPermissionsDialog";
import { useAuth }                                                           from "../../app/useAuth";
import { ApiError, apiRequest }                                              from "../../services/api/client";


type PermissionLevel = "view" | "manage";
type Permission      = { module_key: string; level: PermissionLevel };
type ModuleMetadata  = { key: string; label: string; description?: string; permissions: PermissionLevel[] };
type AdminUser       = {
    id             : string; 
    email          : string; 
    display_name   : string; 
    role           : "owner" | "staff";
    is_active      : boolean; 
    created_at     : string; 
    last_sign_in_at: string | null;
};
type Invitation = {
    id?           : string; 
    invitation_id?: string; 
    email         : string; 
    display_name? : string;
    role?         : "owner" | "staff"; 
    status?       : string; 
    expires_at?   : string; 
    created_at?   : string;
};
type Tab = "users" | "invitations";

function formatDate(value?: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function getApiMessage(error: unknown) {
    if (error instanceof ApiError) return error.message;
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function UserManagementPage() {
    const { session, admin } = useAuth();
    const token              = session?.access_token;
    const isOwner            = admin?.role === "owner";
    const currentPermissions = admin?.permissions === "all" ? [] : (admin?.permissions ?? []);
    const canView            = isOwner || currentPermissions.some((item) => item.module_key === "users" && (item.level === "view" || item.level === "manage"));
    const canManage          = isOwner || currentPermissions.some((item) => item.module_key === "users" && item.level === "manage");

    const [tab                , setTab                ] = useState<Tab>("users");
    const [users              , setUsers              ] = useState<AdminUser[]>([]);
    const [invitations        , setInvitations        ] = useState<Invitation[]>([]);
    const [modules            , setModules            ] = useState<ModuleMetadata[]>([]);
    const [loading            , setLoading            ] = useState(true);
    const [error              , setError              ] = useState("");
    const [inviteOpen         , setInviteOpen         ] = useState(false);
    const [saving             , setSaving             ] = useState(false);
    const [success            , setSuccess            ] = useState("");
    const [email              , setEmail              ] = useState("");
    const [displayName        , setDisplayName        ] = useState("");
    const [role               , setRole               ] = useState<"staff" | "owner">("staff");
    const [selectedPermissions, setSelectedPermissions] = useState<Record<string, PermissionLevel | "none">>({});
    const [resendingId        , setResendingId        ] = useState<string | null>(null);
    const [editingUser        , setEditingUser        ] = useState<AdminUser | null>(null);
    const [confirmUser        , setConfirmUser        ] = useState<AdminUser | null>(null);
    const [confirmAction      , setConfirmAction      ] = useState<"activate" | "deactivate" | "promote" | null>(null);
    const [accountActionBusy  , setAccountActionBusy  ] = useState(false);


    const loadData = useCallback(async () => {
        if (!token) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError("");

        const [userResult, invitationResult] = await Promise.allSettled([
            apiRequest<{ users: AdminUser[] }>("/users", {}, token),
            apiRequest<{ invitations: Invitation[] }>("/users/invitations", {}, token),
        ]);

        const errors: string[] = [];

        if (userResult.status === "fulfilled") {
            setUsers(userResult.value.users ?? []);
        } else {
            errors.push(`Users: ${getApiMessage(userResult.reason)}`);
        }

        if (invitationResult.status === "fulfilled") {
            setInvitations(invitationResult.value.invitations ?? []);
        } else {
            errors.push(`Invitations: ${getApiMessage(invitationResult.reason)}`);
        }

        if (errors.length) {
            setError(errors.join(" | "));
        }

        setLoading(false);
    }, [token]);


    const loadModules = useCallback(async () => {
        if (!token) return;
        try {
            const result = await apiRequest<{ modules: ModuleMetadata[] }>("/meta/modules", {}, token);
            setModules(result.modules ?? []);
        } catch (cause) {
            setError(getApiMessage(cause));
        }
    }, [token]);

    useEffect(() => { void loadData(); }, [loadData]);

    const permissionPayload = useMemo<Permission[]>(() => Object.entries(selectedPermissions)
        .filter((entry): entry is [string, PermissionLevel] => entry[1] !== "none")
        .map(([module_key, level]) => ({ module_key, level })), [selectedPermissions]);

    const openInvite = async () => {
        setError(""); setSuccess(""); setEmail(""); setDisplayName(""); setRole("staff");
        setSelectedPermissions({});
        setInviteOpen(true);
        if (modules.length === 0) await loadModules();
    };

    const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!token) return;
        setSaving(true); setError(""); setSuccess("");
        try {
            await apiRequest("/users/invitations", {
                method: "POST",
                body: JSON.stringify({
                    email: email.trim(),
                    display_name: displayName.trim(),
                    role,
                    permissions: role === "owner" ? [] : permissionPayload,
                }),
            }, token);
            setInviteOpen(false);
            setSuccess(`Invitation sent to ${email.trim()}.`);
            setTab("invitations");
            await loadData();
        } catch (cause) {
            setError(getApiMessage(cause));
        } finally {
            setSaving(false);
        }
    };

    const resendInvitation = async (invitation: Invitation) => {
        const id = invitation.invitation_id ?? invitation.id;
        if (!token || !id) {
            setError("This invitation does not include an invitation ID, so it cannot be resent.");
            return;
        }
        setResendingId(id); setError(""); setSuccess("");
        try {
            await apiRequest(`/users/invitations/${encodeURIComponent(id)}/resend`, { method: "POST" }, token);
            setSuccess(`A new invitation email was requested for ${invitation.email}.`);
            await loadData();
        } catch (cause) {
            setError(getApiMessage(cause));
        } finally {
            setResendingId(null);
        }
    };

    const openEditPermissions = async (user: AdminUser) => {
        if (!canManage || user.role !== "staff" || user.id === admin?.user.id) return;

        setError("");
        setSuccess("");

        if (modules.length === 0) {
            await loadModules();
        }

        setEditingUser(user);
    };

    const requestAccountAction = (user: AdminUser, action: "activate" | "deactivate" | "promote") => {
        if (!canManage || user.id === admin?.user.id) return;
        if (user.role === "owner" && action !== "promote") return;
        if (action === "promote" && (!isOwner || user.role !== "staff")) return;
        setError("");
        setSuccess("");
        setConfirmUser(user);
        setConfirmAction(action);
    };

    const executeAccountAction = async () => {
        if (!token || !confirmUser || !confirmAction) return;
        setAccountActionBusy(true);
        setError("");
        setSuccess("");

        try {
            if (confirmAction === "promote") {
                await apiRequest(`/users/${encodeURIComponent(confirmUser.id)}/role`, {
                    method: "PATCH",
                    body: JSON.stringify({ role: "owner" }),
                }, token);
                setSuccess(`${confirmUser.display_name || confirmUser.email} is now an Owner.`);
            } else {
                const is_active = confirmAction === "activate";
                await apiRequest(`/users/${encodeURIComponent(confirmUser.id)}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ is_active }),
                }, token);
                setSuccess(`${confirmUser.display_name || confirmUser.email} has been ${is_active ? "activated" : "deactivated"}.`);
            }

            setConfirmUser(null);
            setConfirmAction(null);
            await loadData();
        } catch (cause) {
            setError(getApiMessage(cause));
        } finally {
            setAccountActionBusy(false);
        }
    };

    if (!canView) {
        return <section className="page-stack"><div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>User management</h1></div></div><div className="um-notice"><ShieldCheck size={20} /><div><strong>Access restricted</strong><p>You don't have permission to view user management.</p></div></div></section>;
    }

    return (
        <section className="page-stack user-management">
            <div className="page-heading um-heading">
                <div><span className="eyebrow">ADMINISTRATION</span><h1>User management</h1><p className="page-description">Manage administrator accounts, invitations and access.</p></div>
                {canManage && <button className="um-primary-button" type="button" onClick={() => void openInvite()}><MailPlus size={16} /> Invite user</button>}
            </div>

            {success && <div className="um-feedback um-feedback--success" role="status"><Check size={16} />{success}<button type="button" aria-label="Dismiss message" onClick={() => setSuccess("")}><X size={15} /></button></div>}
            {error && <div className="um-feedback um-feedback--error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}

            <div className="um-toolbar">
                <div className="um-tabs" role="tablist" aria-label="User management views">
                    <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "is-active" : ""} onClick={() => setTab("users")}>Users <span>{users.length}</span></button>
                    <button type="button" role="tab" aria-selected={tab === "invitations"} className={tab === "invitations" ? "is-active" : ""} onClick={() => setTab("invitations")}>Invitations <span>{invitations.length}</span></button>
                </div>
                <button className="um-refresh" type="button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={14} className={loading ? "um-spinning" : ""} /> Refresh</button>
            </div>

            <div className="um-table-card">
                {loading ?
                    <div className="um-empty">Loading {tab === "users" ? "users" : "invitations"}…</div> :
                    tab === "users" ? (
                        users.length ? <div className="um-table-scroll"><table className="um-table"><thead><tr><th>Administrator</th><th>Role</th><th>Status</th><th>Created</th><th>Last sign-in</th> {canManage && <th>Actions</th>}</tr></thead><tbody>
                            {users.map((user) => <tr key={user.id}><td><div className="um-person"><span className="um-avatar">{(user.display_name || user.email).charAt(0).toUpperCase()}</span><span><strong>{user.display_name || "—"}</strong><small>{user.email}</small></span></div></td><td><span className={`um-role um-role--${user.role}`}>{user.role}</span></td><td><span className={`um-status ${user.is_active ? "is-active" : "is-inactive"}`}><i />{user.is_active ? "Active" : "Inactive"}</span></td><td>{formatDate(user.created_at)}</td><td>{formatDate(user.last_sign_in_at)}</td>{canManage && (
                                <td className="um-action-cell">
                                    {user.id !== admin?.user.id && user.role === "staff" && (
                                        <div className="um-row-actions">
                                            <button
                                                type="button"
                                                className="um-text-button"
                                                onClick={() => void openEditPermissions(user)}
                                                title={`Edit permissions for ${user.display_name}`}
                                            >
                                                <Pencil size={14} />
                                                Permissions
                                            </button>
                                            <button
                                                type="button"
                                                className="um-text-button"
                                                onClick={() => requestAccountAction(user, user.is_active ? "deactivate" : "activate")}
                                            >
                                                {user.is_active ? "Deactivate" : "Activate"}
                                            </button>
                                            {isOwner && (
                                                <button
                                                    type="button"
                                                    className="um-text-button"
                                                    onClick={() => requestAccountAction(user, "promote")}
                                                >
                                                    <ShieldCheck size={14} />
                                                    Make Owner
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </td>
                            )}</tr>)}
                        </tbody></table></div> : <div className="um-empty"><Users size={24} /><strong>No administrator accounts found</strong><span>Invited team members will appear here after their invitations are accepted.</span></div>
                    ) : invitations.length ? <div className="um-table-scroll"><table className="um-table"><thead><tr><th>Invitee</th><th>Role</th><th>Status</th><th>Expires</th>{canManage && <th />}</tr></thead><tbody>
                        {invitations.map((invitation, index) => { const id = invitation.invitation_id ?? invitation.id ?? `${invitation.email}-${index}`; const pending = (invitation.status ?? "pending").toLowerCase() === "pending"; return <tr key={id}><td><div className="um-person"><span className="um-avatar"><MailPlus size={14} /></span><span><strong>{invitation.display_name || invitation.email}</strong><small>{invitation.email}</small></span></div></td><td><span className={`um-role um-role--${invitation.role ?? "staff"}`}>{invitation.role ?? "staff"}</span></td><td><span className={`um-status ${pending ? "is-pending" : "is-inactive"}`}><i />{invitation.status ?? "Pending"}</span></td><td>{formatDate(invitation.expires_at)}</td>{canManage && <td className="um-action-cell">{pending && <button type="button" className="um-text-button" disabled={resendingId === id || !invitation.invitation_id && !invitation.id} onClick={() => void resendInvitation(invitation)}>{resendingId === id ? "Sending…" : "Resend"}</button>}</td>}</tr>; })}
                    </tbody></table></div> : <div className="um-empty"><Clock3 size={24} /><strong>No invitations found</strong><span>Invitations you send will appear here.</span></div>}
            </div>

            {inviteOpen && <div className="um-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setInviteOpen(false); }}>
                <section className="um-modal" role="dialog" aria-modal="true" aria-labelledby="um-invite-title">
                    <header className="um-modal-header"><div><span className="eyebrow">TEAM ACCESS</span><h2 id="um-invite-title">Invite a user</h2><p>Send a secure, one-hour invitation to join MARUT Admin.</p></div><button type="button" className="um-icon-button" aria-label="Close dialog" disabled={saving} onClick={() => setInviteOpen(false)}><X size={18} /></button></header>
                    <form onSubmit={(event) => void submitInvite(event)}>
                        <div className="um-form-grid"><label className="um-field"><span>Full name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Ananya Rao" required maxLength={120} /></label><label className="um-field"><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></label></div>
                        <label className="um-field um-role-field"><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value as "staff" | "owner")}><option value="staff">Staff</option>{isOwner && <option value="owner">Owner</option>}</select></label>
                        {role === "owner" ? <div className="um-owner-note"><ShieldCheck size={17} /><span>Owners receive full access to every module. Individual permissions are not required.</span></div> : <div className="um-permission-section"><div className="um-permission-heading"><strong>Module permissions</strong><span>Select the highest access level to grant.</span></div>{modules.length === 0 ? <p className="um-inline-note">No grantable modules were returned for this account.</p> : <div className="um-permission-list">{modules.map((module) => <label className="um-permission-row" key={module.key}><span><strong>{module.label}</strong>{module.description && <small>{module.description}</small>}</span><select aria-label={`${module.label} permission`} value={selectedPermissions[module.key] ?? "none"} onChange={(event) => setSelectedPermissions((current) => ({ ...current, [module.key]: event.target.value as PermissionLevel | "none" }))}><option value="none">No access</option>{module.permissions.includes("view") && <option value="view">View</option>}{module.permissions.includes("manage") && <option value="manage">Manage</option>}</select></label>)}</div>}</div>}
                        <div className="um-modal-footer"><button type="button" className="um-secondary-button" disabled={saving} onClick={() => setInviteOpen(false)}>Cancel</button><button type="submit" className="um-primary-button" disabled={saving || modules.length === 0 && role === "staff"}>{saving ? "Sending invitation…" : "Send invitation"}<MailPlus size={15} /></button></div>
                    </form>
                </section>
            </div>}
            {editingUser && token && (
                <EditUserPermissionsDialog
                    user={editingUser}
                    token={token}
                    modules={modules}
                    onClose={() => setEditingUser(null)}
                    onSaved={() => {
                        setEditingUser(null);
                        setSuccess(
                            `Permissions updated for ${editingUser.display_name || editingUser.email}.`
                        );
                        void loadData();
                    }}
                />
            )}

            {confirmUser && confirmAction && (
                <div className="um-modal-backdrop" role="presentation" onMouseDown={(event) => {
                    if (event.target === event.currentTarget && !accountActionBusy) {
                        setConfirmUser(null);
                        setConfirmAction(null);
                    }
                }}>
                    <section className="um-modal um-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="um-account-action-title">
                        <header className="um-modal-header">
                            <div>
                                <span className="eyebrow">TEAM ACCESS</span>
                                <h2 id="um-account-action-title">
                                    {confirmAction === "promote" ? "Promote to Owner?" : confirmAction === "deactivate" ? "Deactivate account?" : "Activate account?"}
                                </h2>
                                <p>
                                    {confirmAction === "promote"
                                        ? `${confirmUser.display_name || confirmUser.email} will receive full access to every MARUT Admin module. This change cannot be reversed from this screen.`
                                        : confirmAction === "deactivate"
                                            ? `${confirmUser.display_name || confirmUser.email} will lose access to MARUT Admin. You can reactivate this account later.`
                                            : `${confirmUser.display_name || confirmUser.email} will regain access to MARUT Admin.`}
                                </p>
                            </div>
                            <button type="button" className="um-icon-button" aria-label="Close dialog" disabled={accountActionBusy} onClick={() => { setConfirmUser(null); setConfirmAction(null); }}>
                                <X size={18} />
                            </button>
                        </header>
                        <div className="um-edit-user-identity">
                            <span className="um-avatar">{(confirmUser.display_name || confirmUser.email).charAt(0).toUpperCase()}</span>
                            <span><strong>{confirmUser.display_name || "Staff member"}</strong><small>{confirmUser.email}</small></span>
                            <span className="um-role um-role--staff">Staff</span>
                        </div>
                        {confirmAction === "promote" && (
                            <div className="um-owner-note">
                                <ShieldCheck size={17} />
                                <span>Owner access is unrestricted. Existing Staff permission assignments will be removed.</span>
                            </div>
                        )}
                        <div className="um-modal-footer">
                            <button type="button" className="um-secondary-button" disabled={accountActionBusy} onClick={() => { setConfirmUser(null); setConfirmAction(null); }}>Cancel</button>
                            <button type="button" className="um-primary-button" disabled={accountActionBusy} onClick={() => void executeAccountAction()}>
                                {accountActionBusy ? "Applying…" : confirmAction === "promote" ? "Confirm promotion" : confirmAction === "deactivate" ? "Deactivate account" : "Activate account"}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </section>
    );
}
