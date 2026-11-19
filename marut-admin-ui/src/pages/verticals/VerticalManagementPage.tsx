import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Clock3, Eye, History, Plus, 
         RefreshCw    , Pencil    , Trash2, X  , Sprout , Check, 
         ChevronRight }         from "lucide-react";
import { useAuth }              from "../../app/useAuth";
import { ApiError, apiRequest } from "../../services/api/client";

type VerticalStatus = | "proposed" | "under_planning" | "setup_in_progress" | "operational" | "temporarily_suspended" | "closed";

type Vertical = {
  id         : string;
  name       : string;
  code       : string;
  description: string | null;
  status     : VerticalStatus;
  created_at : string;
  created_by : string;
  updated_at : string;
  updated_by : string;
};

type HistoryEvent = {
  id                    : string;
  vertical_id           : string;
  vertical_code_snapshot: string;
  vertical_name_snapshot: string;
  changed_by            : string;
  changed_at            : string;
  event_type            : "status" | "name";
  previous_status?      : VerticalStatus;
  new_status?           : VerticalStatus;
  reason?               : string;
  previous_name?        : string;
  new_name?             : string;
};

type DialogMode    = "create" | "edit";
type ConfirmAction = "transition" | "delete" | null;

const STATUS_LABELS: Record<VerticalStatus, string> = {
  proposed             : "Proposed",
  under_planning       : "Under Planning",
  setup_in_progress    : "Setup in Progress",
  operational          : "Operational",
  temporarily_suspended: "Temporarily Suspended",
  closed               : "Closed",
};

const TRANSITIONS: Record<VerticalStatus, VerticalStatus[]> = {
  proposed             : ["under_planning"],
  under_planning       : ["proposed", "setup_in_progress"],
  setup_in_progress    : ["under_planning", "operational"],
  operational          : ["temporarily_suspended"],
  temporarily_suspended: ["operational"],
  closed               : [],
};

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function apiMessage(error: unknown) {
  if (error instanceof ApiError) {
    const payload = error.details as { error?: { code?: string } } | undefined;
    if (payload?.error?.code === "VERTICAL_IN_USE") {
      return "This vertical is still linked to products or transactions, so it cannot be deleted.";
    }
    if (payload?.error?.code === "VERTICAL_CLOSURE_CHECK_UNAVAILABLE") {
      return "Closing is unavailable until product reassignment and deactivation checks are implemented.";
    }
    if (payload?.error?.code === "VERTICAL_CODE_ALREADY_EXISTS") {
      return "That vertical code is already in use. Choose a different code.";
    }
    if (payload?.error?.code === "INVALID_STATUS_TRANSITION") {
      return "That lifecycle transition is no longer valid. The latest status has been refreshed.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function StatusBadge({ status }: { status: VerticalStatus }) {
  return <span className={`vm-status vm-status--${status}`}><i />{STATUS_LABELS[status]}</span>;
}

export function VerticalManagementPage() {
  const { session, admin } = useAuth();
  const token              = session?.access_token;
  const isOwner            = admin?.role === "owner";
  const permissions        = admin?.permissions === "all" ? [] : (admin?.permissions ?? []);
  const canView            = isOwner || permissions.some((p) => p.module_key === "verticals" && (p.level === "view" || p.level === "manage"));
  const canManage          = isOwner || permissions.some((p) => p.module_key === "verticals" && p.level === "manage");

  const [verticals     , setVerticals     ] = useState<Vertical[]>([]);
  const [loading       , setLoading       ] = useState(true);
  const [error         , setError         ] = useState("");
  const [success       , setSuccess       ] = useState("");
  const [dialogMode    , setDialogMode    ] = useState<DialogMode | null>(null);
  const [selected      , setSelected      ] = useState<Vertical | null>(null);
  const [detail        , setDetail        ] = useState<Vertical | null>(null);
  const [history       , setHistory       ] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [name          , setName          ] = useState("");
  const [code          , setCode          ] = useState("");
  const [description   , setDescription   ] = useState("");
  const [saving        , setSaving        ] = useState(false);
  const [nextStatus    , setNextStatus    ] = useState<VerticalStatus | "">("");
  const [reason        , setReason        ] = useState("");
  const [confirmAction , setConfirmAction ] = useState<ConfirmAction>(null);
  const [actionBusy    , setActionBusy    ] = useState(false);

  const loadVerticals = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ verticals: Vertical[] }>("/verticals", {}, token);
      setVerticals(result.verticals ?? []);
    } catch (cause) {
      setError(apiMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);

  const loadHistory = useCallback(async (verticalId: string) => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const result = await apiRequest<{ history: HistoryEvent[] }>(
        `/verticals/${encodeURIComponent(verticalId)}/history`, {}, token,
      );
      setHistory(result.history ?? []);
    } catch (cause) {
      setError(apiMessage(cause));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  const openDetails = async (vertical: Vertical) => {
    setError("");
    setDetail(vertical);
    setHistory([]);
    await loadHistory(vertical.id);
  };

  const openCreate = () => {
    setSelected(null);
    setName("");
    setCode("");
    setDescription("");
    setDialogMode("create");
    setError("");
  };

  const openEdit = (vertical: Vertical) => {
    if (!isOwner) return;
    setSelected(vertical);
    setName(vertical.name);
    setDescription(vertical.description ?? "");
    setDialogMode("edit");
    setError("");
  };

  const saveVertical = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (dialogMode === "create") {
        await apiRequest("/verticals", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            code: code.trim().toUpperCase(),
            description: description.trim() || null,
          }),
        }, token);
        setSuccess(`${name.trim()} was created with Proposed status.`);
      } else if (dialogMode === "edit" && selected) {
        await apiRequest(`/verticals/${encodeURIComponent(selected.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
        }, token);
        setSuccess(`${name.trim()} was updated.`);
      }
      setDialogMode(null);
      await loadVerticals();
    } catch (cause) {
      setError(apiMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const requestTransition = (vertical: Vertical) => {
    const available = TRANSITIONS[vertical.status];
    setSelected(vertical);
    setNextStatus(available[0] ?? "");
    setReason("");
    setConfirmAction("transition");
    setError("");
  };

  const executeAction = async () => {
    if (!token || !selected || !confirmAction) return;
    setActionBusy(true);
    setError("");
    setSuccess("");
    try {
      if (confirmAction === "transition") {
        if (!nextStatus || !reason.trim()) return;
        await apiRequest(`/verticals/${encodeURIComponent(selected.id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus, reason: reason.trim() }),
        }, token);
        setSuccess(`${selected.name} moved to ${STATUS_LABELS[nextStatus]}.`);
      } else if (confirmAction === "delete") {
        await apiRequest(`/verticals/${encodeURIComponent(selected.id)}`, { method: "DELETE" }, token);
        setSuccess(`${selected.name} was deleted.`);
        setDetail(null);
      }
      setConfirmAction(null);
      await loadVerticals();
      if (confirmAction === "transition" && detail?.id === selected.id) {
        const refreshed = await apiRequest<{ vertical: Vertical }>(`/verticals/${encodeURIComponent(selected.id)}`, {}, token);
        setDetail(refreshed.vertical);
        await loadHistory(selected.id);
      }
    } catch (cause) {
      setError(apiMessage(cause));
      if (confirmAction === "transition" && selected) {
        try {
          const refreshed = await apiRequest<{ vertical: Vertical }>(`/verticals/${encodeURIComponent(selected.id)}`, {}, token);
          if (detail?.id === selected.id) setDetail(refreshed.vertical);
        } catch { /* Keep the original API error visible. */ }
      }
    } finally {
      setActionBusy(false);
    }
  };

  const availableTransitions = useMemo(
    () => selected ? TRANSITIONS[selected.status] : [],
    [selected],
  );

  if (!canView) {
    return (
        <section className="page-stack">
            <div className="page-heading">
                <div>
                    <span className="eyebrow">ADMINISTRATION</span>
                    <h1>Vertical management</h1>
                </div>
            </div>
            <div className="vm-restricted">
                <AlertTriangle size={20} />
                <div>
                    <strong>Access restricted</strong>
                    <p>You don't have permission to view Vertical Management.</p>
                </div>
            </div>
        </section>
    );
  }

    return (
        <section className="page-stack vertical-management">
            <div className="page-heading vm-heading">
                <div>
                    <span className="eyebrow">ADMINISTRATION</span>
                    <h1>Vertical management</h1>
                    <p className="page-description">Manage MARUT business lines, lifecycle and history.</p>
                </div>
                <div className="vm-heading-actions">
                    <button className="vm-secondary-button" type="button" onClick={() => void loadVerticals()} disabled={loading}>
                        <RefreshCw size={14} className={loading ? "vm-spin" : ""} /> Refresh
                    </button>
                    {canManage && <button className="vm-primary-button" type="button" onClick={openCreate}><Plus size={16} /> Add vertical</button>}
                </div>
            </div>

            {success && <div className="vm-feedback vm-feedback--success" role="status"><Check size={16} />{success}<button type="button" onClick={() => setSuccess("")} aria-label="Dismiss"><X size={15} /></button></div>}
            {error && <div className="vm-feedback vm-feedback--error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}

            <div className="vm-summary-row">
                <div><span className="vm-summary-label">Total verticals</span><strong>{verticals.length}</strong></div>
                <div><span className="vm-summary-label">Operational</span><strong>{verticals.filter((v) => v.status === "operational").length}</strong></div>
                <div><span className="vm-summary-label">In progress</span><strong>{verticals.filter((v) => ["proposed", "under_planning", "setup_in_progress"].includes(v.status)).length}</strong></div>
            </div>

            <div className="vm-list-card">
                <div className="vm-list-heading"><div><h2>Business verticals</h2><p>Each vertical represents a distinct MARUT business line.</p></div><span>{verticals.length} {verticals.length === 1 ? "vertical" : "verticals"}</span></div>
                {loading ? <div className="vm-empty"><RefreshCw size={18} className="vm-spin" />Loading verticals…</div> :
                    verticals.length === 0 ? <div className="vm-empty"><Sprout size={24} /><strong>No verticals yet</strong><p>Create your first business vertical to begin organising products and reporting.</p></div> :
                        <div className="vm-table-scroll"><table className="vm-table"><thead><tr><th>Vertical</th><th>Code</th><th>Description</th><th>Lifecycle</th><th>Created</th><th>Actions</th></tr></thead><tbody>
                            {verticals.map((vertical) => <tr key={vertical.id}>
                                <td><div className="vm-name-cell"><span className="vm-mark"><Sprout size={16} /></span><span><strong>{vertical.name}</strong><small>Business vertical</small></span></div></td>
                                <td><code className="vm-code">{vertical.code}</code></td>
                                <td className="vm-description-cell">{vertical.description || "—"}</td>
                                <td><StatusBadge status={vertical.status} /></td>
                                <td>{formatDate(vertical.created_at)}</td>
                                <td><div className="vm-row-actions">
                                    <button type="button" className="vm-icon-action" onClick={() => void openDetails(vertical)} title="View details and history" aria-label={`View ${vertical.name}`}><Eye size={15} /></button>
                                    {canManage && vertical.status !== "closed" && <button type="button" className="vm-icon-action" onClick={() => requestTransition(vertical)} title="Change lifecycle status" aria-label={`Change status for ${vertical.name}`}><ArrowRight size={15} /></button>}
                                    {isOwner && <button type="button" className="vm-icon-action" onClick={() => openEdit(vertical)} title="Edit vertical details" aria-label={`Edit ${vertical.name}`}><Pencil size={15} /></button>}
                                    {canManage && <button type="button" className="vm-icon-action vm-icon-action--danger" onClick={() => { setSelected(vertical); setConfirmAction("delete"); setError(""); }} title="Delete vertical" aria-label={`Delete ${vertical.name}`}><Trash2 size={15} /></button>}
                                </div></td>
                            </tr>)}
                        </tbody></table></div>}
            </div>

            {dialogMode && (
                <div className="vm-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setDialogMode(null); }}>
                    <section className="vm-dialog" role="dialog" aria-modal="true" aria-labelledby="vm-form-title">
                        <header className="vm-dialog-header"><div><span className="eyebrow">VERTICAL DETAILS</span><h2 id="vm-form-title">{dialogMode === "create" ? "Create a vertical" : "Edit vertical"}</h2><p>{dialogMode === "create" ? "Add a new business line to MARUT." : "Update the name or description. The code remains permanent."}</p></div><button className="vm-close" type="button" onClick={() => setDialogMode(null)} disabled={saving} aria-label="Close"><X size={18} /></button></header>
                        <form onSubmit={saveVertical}>
                            <label className="vm-field"><span>Vertical name <b>*</b></span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Sprouts" /></label>
                            {dialogMode === "create" ? <label className="vm-field"><span>Vertical code <b>*</b></span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} minLength={2} maxLength={32} pattern="[A-Z][A-Z0-9_]{1,31}" required placeholder="e.g. SPROUTS" /><small>2–32 characters. Starts with a letter; uppercase letters, numbers and underscores only. This code cannot be changed later.</small></label> : <div className="vm-field"><span>Immutable code</span><div className="vm-readonly-code">{selected?.code}</div><small>Vertical codes cannot be changed after creation.</small></div>}
                            <label className="vm-field"><span>Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4} placeholder="Describe this business line…" /></label>
                            {dialogMode === "create" && <div className="vm-info-note"><Clock3 size={16} /><span>New verticals are always created with <strong>Proposed</strong> status. You can move them through the lifecycle after creation.</span></div>}
                            <footer className="vm-dialog-footer"><button className="vm-secondary-button" type="button" onClick={() => setDialogMode(null)} disabled={saving}>Cancel</button><button className="vm-primary-button" type="submit" disabled={saving || !name.trim() || (dialogMode === "create" && !code.trim())}>{saving ? "Saving…" : dialogMode === "create" ? "Create vertical" : "Save changes"}</button></footer>
                        </form>
                    </section>
                </div>
            )}

            {confirmAction && selected && (
                <div className="vm-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !actionBusy) setConfirmAction(null); }}>
                    <section className="vm-dialog vm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="vm-confirm-title">
                        <header className="vm-dialog-header"><div><span className="eyebrow">{confirmAction === "delete" ? "PERMANENT ACTION" : "LIFECYCLE UPDATE"}</span><h2 id="vm-confirm-title">{confirmAction === "delete" ? "Delete this vertical?" : "Confirm status change"}</h2><p>{confirmAction === "delete" ? `You are about to permanently delete ${selected.name} (${selected.code}). The database will prevent deletion if it is still referenced.` : `Move ${selected.name} from ${STATUS_LABELS[selected.status]} to ${nextStatus ? STATUS_LABELS[nextStatus] : "—"}.`}</p></div><button className="vm-close" type="button" onClick={() => setConfirmAction(null)} disabled={actionBusy} aria-label="Close"><X size={18} /></button></header>
                        {confirmAction === "transition" ? <>
                            <div className="vm-transition-path"><StatusBadge status={selected.status} /><ChevronRight size={16} /><StatusBadge status={nextStatus || selected.status} /></div>
                            <label className="vm-field"><span>New status <b>*</b></span><select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as VerticalStatus)} required>{availableTransitions.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
                            <label className="vm-field"><span>Reason for change <b>*</b></span><textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={1} maxLength={1000} rows={3} required placeholder="Explain why this lifecycle change is being made…" /></label>
                            <div className="vm-warning-note"><AlertTriangle size={16} /><span>Closing a vertical is currently unavailable until product reassignment and deactivation checks are implemented.</span></div>
                        </> : <div className="vm-warning-note"><AlertTriangle size={17} /><span>Deletion is permanent. If this vertical is referenced by products or transactions, the database will reject the request and the vertical will remain unchanged.</span></div>}
                        <footer className="vm-dialog-footer"><button className="vm-secondary-button" type="button" onClick={() => setConfirmAction(null)} disabled={actionBusy}>Cancel</button><button className={confirmAction === "delete" ? "vm-danger-button" : "vm-primary-button"} type="button" onClick={() => void executeAction()} disabled={actionBusy || (confirmAction === "transition" && (!nextStatus || !reason.trim()))}>{actionBusy ? "Applying…" : confirmAction === "delete" ? "Delete permanently" : "Confirm transition"}</button></footer>
                    </section>
                </div>
            )}

            {detail && (
                <div className="vm-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
                    <section className="vm-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="vm-detail-title">
                        <header className="vm-dialog-header"><div><span className="eyebrow">BUSINESS VERTICAL</span><h2 id="vm-detail-title">{detail.name}</h2><p><code className="vm-code">{detail.code}</code></p></div><button className="vm-close" type="button" onClick={() => setDetail(null)} aria-label="Close"><X size={18} /></button></header>
                        <div className="vm-detail-status"><StatusBadge status={detail.status} /><span>Created {formatDate(detail.created_at)}</span></div>
                        <p className="vm-detail-description">{detail.description || "No description has been added."}</p>
                        <div className="vm-detail-meta"><div><span>Last updated</span><strong>{formatDate(detail.updated_at, true)}</strong></div><div><span>Vertical code</span><strong>{detail.code} · Immutable</strong></div></div>
                        <div className="vm-history-heading"><History size={16} /><h3>Activity history</h3></div>
                        {historyLoading ? <div className="vm-history-empty">Loading history…</div> : history.length === 0 ? <div className="vm-history-empty">No changes recorded yet.</div> :
                            <ol className="vm-timeline">{history.map((event) => <li key={`${event.event_type}-${event.id}`}><span className={`vm-timeline-dot vm-timeline-dot--${event.event_type}`} /><div className="vm-timeline-content">
                                <strong>{event.event_type === "status" ? `${event.previous_status ? STATUS_LABELS[event.previous_status] : "—"} → ${event.new_status ? STATUS_LABELS[event.new_status] : "—"}` : `${event.previous_name ?? "—"} → ${event.new_name ?? "—"}`}</strong>
                                {event.event_type === "status" && event.reason && <p>{event.reason}</p>}
                                <small>{formatDate(event.changed_at, true)} · Admin ID {event.changed_by}</small>
                            </div></li>)}</ol>}
                        <footer className="vm-dialog-footer"><button className="vm-secondary-button" type="button" onClick={() => setDetail(null)}>Close</button></footer>
                    </section>
                </div>
            )}
        </section>
    );
}
