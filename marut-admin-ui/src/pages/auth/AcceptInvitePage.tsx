import { useEffect, useState, type FormEvent }                           from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Sprout, UserRound } from "lucide-react";
import { Link, useNavigate }                                             from "react-router-dom";
import type { Session, User }                                            from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured }                                from "../../services/auth/supabase";
import { apiRequest }                                                    from "../../services/api/client";
import { AuthUtilityLayout }                                             from "../../components/auth/AuthUtilityLayout";

type AcceptInvitationResponse = {
  success: boolean;
  next?  : "login" | string;
};

const INVITATION_ID_KEY = "marut_invitation_id";

function getCallbackParams() {
  return new URLSearchParams(
    `${window.location.search.replace(/^\?/, "")}&${window.location.hash.replace(/^#/, "")}`,
  );
}

function invitationDetails(user: User) {
  const metadata     = user.user_metadata ?? {};
  const invitationId = typeof metadata[INVITATION_ID_KEY] === "string" ? metadata[INVITATION_ID_KEY] : "";
  const invitedName  = typeof metadata.display_name === "string" ? metadata.display_name : "";

  return { invitationId, invitedName };
}

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [session        , setSession        ] = useState<Session | null>(null);
  const [invitationId   , setInvitationId   ] = useState("");
  const [originalName   , setOriginalName   ] = useState("");
  const [displayName    , setDisplayName    ] = useState("");
  const [email          , setEmail          ] = useState("");
  const [checking       , setChecking       ] = useState(true);
  const [submitting     , setSubmitting     ] = useState(false);
  const [showPassword   , setShowPassword   ] = useState(false);
  const [showConfirm    , setShowConfirm    ] = useState(false);
  const [password       , setPassword       ] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error          , setError          ] = useState("");
  const [success        , setSuccess        ] = useState(false);


  useEffect(() => {
    let active = true;

    const applySession = (nextSession: Session | null) => {
      if (!active || !nextSession?.user) return;

      const details = invitationDetails(nextSession.user);

      if (!details.invitationId) {
        setSession(null);
        setError("This link is not associated with a valid MARUT invitation.");
        setChecking(false);
        return;
      }

      setSession(nextSession);
      setInvitationId(details.invitationId);
      setOriginalName(details.invitedName);
      setDisplayName(details.invitedName);
      setEmail(nextSession.user.email ?? "");
      setError("");
      setChecking(false);
    };

    if (!isSupabaseConfigured) {
      setError("Invitation acceptance is not configured. Please contact your administrator.");
      setChecking(false);
      return;
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        console.log("MARUT AUTH EVENT", {
          event,
          hasSession: Boolean(nextSession),
          email: nextSession?.user?.email,
          invitationId:
            nextSession?.user?.user_metadata?.marut_invitation_id,
        });

        if (nextSession) applySession(nextSession);
      }
    );

    void (async () => {
      try {
        const callbackParams = getCallbackParams();

        const callbackError =
          callbackParams.get("error_description") ??
          callbackParams.get("error") ??
          callbackParams.get("error_code");

        if (callbackError) {
          throw new Error(callbackError.replace(/\+/g, " "));
        }

        // 1. Token-hash invitation callback
        const tokenHash = callbackParams.get("token_hash");

        if (tokenHash) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "invite",
          });

          if (error) throw error;

          if (!data.session) {
            throw new Error("Supabase did not establish an invitation session.");
          }

          applySession(data.session);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
          return;
        }

        // 2. Implicit-flow invitation callback
        const accessToken = callbackParams.get("access_token");
        const refreshToken = callbackParams.get("refresh_token");

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) throw error;

          if (!data.session) {
            throw new Error("Supabase could not establish your invitation session.");
          }

          applySession(data.session);

          // Remove authentication tokens from the visible URL.
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
          return;
        }

        // 3. PKCE callback or an already-established session
        const { data, error } = await supabase.auth.getSession();

        if (error) throw error;

        if (!data.session) {
          throw new Error(
            "No valid invitation session was found. Please open your invitation email again."
          );
        }

        applySession(data.session);

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
      } catch (cause) {
        if (!active) return;

        setError(
          cause instanceof Error
            ? cause.message
            : "We couldn't verify this invitation. Request a fresh invitation link."
        );
        setChecking(false);
      }
    })();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);


  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!session || !invitationId) {
      setError("Your invitation session is no longer valid. Open the invitation link again.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Your passwords don't match. Please try again.");
      return;
    }

    setSubmitting(true);
    try {
      // Password setup is a separate Supabase Auth operation.
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) throw passwordError;

      // Read the current token after the Auth update so the API receives
      // the active invitation session's access token.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Your invitation session expired. Open the invitation link again.");
      }

      const normalizedName = displayName.trim();
      const changedName =
        normalizedName.length > 0 && normalizedName !== originalName.trim();

      const body: { invitation_id: string; display_name?: string } = {
        invitation_id: invitationId,
      };
      if (changedName) body.display_name = normalizedName;

      const result = await apiRequest<AcceptInvitationResponse>(
        "/invitations/accept",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        accessToken,
      );

      if (!result?.success) {
        throw new Error("MARUT could not complete this invitation. Please try again.");
      }

      setSuccess(true);
      await supabase.auth.signOut();
      window.setTimeout(() => navigate("/login", { replace: true }), 1400);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn't complete your invitation. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthUtilityLayout>
      {checking ? (
        <div className="auth-success" role="status">
          <h1>Verifying invitation…</h1>
          <p>Please wait while we securely validate your invitation link.</p>
        </div>
      ) : success ? (
        <div className="auth-success" role="status">
          <span className="auth-success-icon"><Sprout size={22} /></span>
          <h1>You're all set</h1>
          <p>Your MARUT Admin access is ready. Redirecting you to sign in…</p>
        </div>
      ) : session && invitationId ? (
        <>
          <div className="auth-utility-heading">
            <h1>Complete your invitation</h1>
            <p>Confirm your details and create a password to activate your MARUT Admin access.</p>
          </div>

          <div className="auth-identity-row" style={{ marginTop: 18 }}>
            <Mail size={15} aria-hidden="true" />
            <span className="auth-identity-label">Invited email</span>
            <strong>{email}</strong>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label className="auth-input-wrap">
              <UserRound size={19} aria-hidden="true" />
              <input
                type="text"
                autoComplete="name"
                placeholder="Your name (optional)"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={120}
              />
            </label>
            <p className="auth-field-hint">
              Leave your name unchanged to keep the name on the original invitation.
            </p>

            <label className="auth-input-wrap">
              <LockKeyhole size={19} aria-hidden="true" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Create password (at least 8 characters)"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
              <button
                className="auth-visibility"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </label>

            <label className="auth-input-wrap">
              <LockKeyhole size={19} aria-hidden="true" />
              <input
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              <button
                className="auth-visibility"
                type="button"
                aria-label={showConfirm ? "Hide confirmation password" : "Show confirmation password"}
                onClick={() => setShowConfirm((value) => !value)}
              >
                {showConfirm ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </label>

            {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}

            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? "Activating account…" : "Accept invitation"}
              <ArrowRight size={18} />
            </button>
          </form>
        </>
      ) : (
        <div className="auth-success" role="alert">
          <span className="auth-success-icon"><LockKeyhole size={22} /></span>
          <h1>Invitation link unavailable</h1>
          <p>
            This invitation may have expired, already been used, or the link may
            have been opened in a different browser. Ask your MARUT administrator
            for a new invitation.
          </p>
          {error && <p className="auth-message auth-message--error">{error}</p>}
          <Link className="auth-submit auth-submit--link" to="/login">
            Back to sign in <ArrowRight size={18} />
          </Link>
        </div>
      )}
      <Link className="auth-back-link" to="/login">Back to sign in</Link>
    </AuthUtilityLayout>
  );
}
