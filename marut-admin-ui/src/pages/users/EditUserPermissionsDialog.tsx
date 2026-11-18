import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, LoaderCircle, ShieldCheck, X }          from "lucide-react";
import { ApiError, apiRequest }                         from "../../services/api/client";

type PermissionLevel = "view" | "manage";
type Permission      = { module_key: string; level: PermissionLevel };
type ModuleMetadata  = {
    key         : string;
    label       : string;
    description?: string;
    permissions : PermissionLevel[];
};
type StaffUser = {
    id          : string;
    display_name: string;
    email       : string;
    role        : "owner" | "staff";
};

type Props = {
    user   : StaffUser;
    token  : string;
    modules: ModuleMetadata[];
    onClose: () => void;
    onSaved: () => void;
};

function apiMessage(error: unknown) {
    if (error instanceof ApiError) return error.message;
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function EditUserPermissionsDialog({user, token, modules, onClose, onSaved, }: Props) {
    const [selected, setSelected] = useState<Record<string, PermissionLevel | "none">>({});
    const [loading , setLoading ] = useState(true);
    const [saving  , setSaving  ] = useState(false);
    const [error   , setError   ] = useState("");
    const [success , setSuccess ] = useState(false);

    useEffect(() => {
        let active = true;

        void (async () => {
            try {
                const result = await apiRequest<{
                    user_id: string;
                    role: "staff" | "owner";
                    permissions: Permission[] | "all";
                }>(`/users/${encodeURIComponent(user.id)}/permissions`, {}, token);

                if (!active) return;

                if (result.role === "owner" || result.permissions === "all") {
                    throw new Error("Owner permissions are implicit and cannot be edited.");
                }

                const next: Record<string, PermissionLevel | "none"> = {};
                for (const permission of result.permissions) {
                    next[permission.module_key] = permission.level;
                }
                setSelected(next);
            } catch (cause) {
                if (active) setError(apiMessage(cause));
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [token, user.id]);

    const payload = useMemo<Permission[]>(
        () =>
            Object.entries(selected)
                .filter((entry): entry is [string, PermissionLevel] => entry[1] !== "none")
                .map(([module_key, level]) => ({ module_key, level })),
        [selected],
    );

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setError("");

        try {
            await apiRequest(
                `/users/${encodeURIComponent(user.id)}/permissions`,
                {
                    method: "PUT",
                    body: JSON.stringify({ permissions: payload }),
                },
                token,
            );

            setSuccess(true);
            onSaved();
        } catch (cause) {
            setError(apiMessage(cause));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="um-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !saving) onClose();
            }}
        >
            <section
                className="um-modal um-edit-permissions-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="um-edit-permissions-title"
            >
                <header className="um-modal-header">
                    <div>
                        <span className="eyebrow">TEAM ACCESS</span>
                        <h2 id="um-edit-permissions-title">Edit permissions</h2>
                        <p>
                            Update module access for {user.display_name || user.email}.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="um-icon-button"
                        aria-label="Close dialog"
                        disabled={saving}
                        onClick={onClose}
                    >
                        <X size={18} />
                    </button>
                </header>

                <div className="um-edit-user-identity">
                    <span className="um-avatar">
                        {(user.display_name || user.email).charAt(0).toUpperCase()}
                    </span>
                    <span>
                        <strong>{user.display_name || "Staff member"}</strong>
                        <small>{user.email}</small>
                    </span>
                    <span className="um-role um-role--staff">Staff</span>
                </div>

                {loading ? (
                    <div className="um-edit-loading" role="status">
                        <LoaderCircle size={18} className="um-spinning" />
                        Loading current permissions…
                    </div>
                ) : (
                    <form onSubmit={(event) => void submit(event)}>
                        <div className="um-permission-section">
                            <div className="um-permission-heading">
                                <strong>Module permissions</strong>
                                <span>Choose the highest access level for each module.</span>
                            </div>

                            {modules.length === 0 ? (
                                <p className="um-inline-note">
                                    No grantable modules were returned for your account.
                                </p>
                            ) : (
                                <div className="um-permission-list">
                                    {modules.map((module) => (
                                        <label className="um-permission-row" key={module.key}>
                                            <span>
                                                <strong>{module.label}</strong>
                                                {module.description && <small>{module.description}</small>}
                                            </span>
                                            <select
                                                aria-label={`${module.label} permission`}
                                                value={selected[module.key] ?? "none"}
                                                disabled={saving}
                                                onChange={(event) =>
                                                    setSelected((current) => ({
                                                        ...current,
                                                        [module.key]: event.target.value as PermissionLevel | "none",
                                                    }))
                                                }
                                            >
                                                <option value="none">No access</option>
                                                {module.permissions.includes("view") && (
                                                    <option value="view">View</option>
                                                )}
                                                {module.permissions.includes("manage") && (
                                                    <option value="manage">Manage</option>
                                                )}
                                            </select>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="um-edit-permission-note">
                            <ShieldCheck size={16} />
                            <span>
                                Changes replace this staff member&apos;s complete permission set.
                                Your own access limits what you can grant.
                            </span>
                        </div>

                        {error && (
                            <p className="auth-message auth-message--error" role="alert">
                                {error}
                            </p>
                        )}
                        {success && (
                            <p className="um-feedback um-feedback--success" role="status">
                                <Check size={15} /> Permissions updated.
                            </p>
                        )}

                        <div className="um-modal-footer">
                            <button
                                type="button"
                                className="um-secondary-button"
                                disabled={saving}
                                onClick={onClose}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="um-primary-button"
                                disabled={saving || loading || modules.length === 0}
                            >
                                {saving ? "Saving…" : "Save permissions"}
                                <Check size={15} />
                            </button>
                        </div>
                    </form>
                )}

                {loading && (
                    <div className="um-modal-footer">
                        <button type="button" className="um-secondary-button" onClick={onClose}>
                            Close
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
