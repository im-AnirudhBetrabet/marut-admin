import { useEffect, useState, type FormEvent }             from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Link, useNavigate }                               from "react-router-dom";
import type { Session }                                    from "@supabase/supabase-js";
import { supabase }                                        from "../../services/auth/supabase";
import { AuthUtilityLayout }                               from "../../components/auth/AuthUtilityLayout";

const RECOVERY_MARKER = "marut-password-recovery-session";

export function ResetPasswordPage() {
    const [recoverySession, setRecoverySession] = useState<Session | null>(null);
    const [checking       , setChecking       ] = useState(true);
    const [password       , setPassword       ] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword   , setShowPassword   ] = useState(false);
    const [showConfirm    , setShowConfirm    ] = useState(false);
    const [submitting     , setSubmitting     ] = useState(false);
    const [success        , setSuccess        ] = useState(false);
    const [error          , setError          ] = useState("");
    const [recoveryError, setRecoveryError    ] = useState("");
    const navigate                              = useNavigate();

    useEffect(() => {
        let active = true;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!active) return;
            if (event === "PASSWORD_RECOVERY" && session) {
                window.sessionStorage.setItem(RECOVERY_MARKER, "true");
                setRecoverySession(session);
                setError("");
            } else if (event === "SIGNED_OUT") {
                window.sessionStorage.removeItem(RECOVERY_MARKER);
                setRecoverySession(null);
            }
        });

        void supabase.auth.getSession().then(({ data, error: sessionError }) => {
            if (!active) return;
            const markerExists = window.sessionStorage.getItem(RECOVERY_MARKER) === "true";
            const callbackParams = new URLSearchParams(`${window.location.search.replace(/^\?/, "")}&${window.location.hash.replace(/^#/, "")}`);
            const hadPkceCode = callbackParams.has("code");
            if (!sessionError && markerExists && data.session) {
                setRecoverySession(data.session);
            } else {
                setRecoverySession(null);
                if (markerExists && !data.session) window.sessionStorage.removeItem(RECOVERY_MARKER);
                const callbackError = callbackParams.get("error_description") || callbackParams.get("error") || callbackParams.get("error_code");
                if (callbackError) setRecoveryError(callbackError.replace(/\+/g, " "));
                else if (sessionError) setRecoveryError(sessionError.message);
                else if (hadPkceCode) setRecoveryError("The reset link reached MARUT Admin, but this browser could not complete its secure sign-in exchange. Request a fresh link and open it in the same browser and device where you requested it.");
            }
            setChecking(false);
        });

        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        if (!recoverySession) return;
        if (password.length < 8) {
            setError("Use at least 8 characters for your new password.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Your passwords don't match. Please try again.");
            return;
        }
        setSubmitting(true);
        try {
            const { error: updateError } = await supabase.auth.updateUser({ password });
            if (updateError) throw updateError;
            setSuccess(true);
            window.sessionStorage.removeItem(RECOVERY_MARKER);
            await supabase.auth.signOut();
            window.setTimeout(() => navigate("/login", { replace: true }), 1600);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "We couldn't update your password. Request a new reset link and try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthUtilityLayout>

            {checking ? (
                <div className="auth-success" role="status"><h1>Verifying reset link…</h1><p>Please wait while we securely validate your recovery session.</p></div>
            ) : success ? (
                <div className="auth-success" role="status"><span className="auth-success-icon"><LockKeyhole size={22} /></span><h1>Password updated</h1><p>Your password has been changed. Redirecting you to sign in…</p></div>
            ) : recoverySession ? (
                <>
                    <div className="auth-utility-heading"><h1>Create a new password</h1><p>Choose a strong password for your MARUT Admin account.</p></div>
                    <form className="auth-form" onSubmit={submit}>
                        <label className="auth-input-wrap">
                            <LockKeyhole size={19} aria-hidden="true" />
                            <input type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="New password (at least 8 characters)" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
                            <button className="auth-visibility" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                        </label>
                        <label className="auth-input-wrap">
                            <LockKeyhole size={19} aria-hidden="true" />
                            <input type={showConfirm ? "text" : "password"} autoComplete="new-password" placeholder="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                            <button className="auth-visibility" type="button" aria-label={showConfirm ? "Hide confirmation password" : "Show confirmation password"} onClick={() => setShowConfirm((value) => !value)}>{showConfirm ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                        </label>
                        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
                        <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Updating…" : "Update password"} <ArrowRight size={18} /></button>
                    </form>
                </>
            ) : (
                <div className="auth-success" role="alert">
                    <span className="auth-success-icon"><LockKeyhole size={22} /></span>
                    <h1>This reset link is invalid or expired</h1>
                    <p>For your security, password reset links can only be used for a limited time. Request a new link to continue.</p>
                    {recoveryError && <p className="auth-message auth-message--error" role="status">{recoveryError}</p>}
                    <Link className="auth-submit auth-submit--link" to="/forgot-password">Request a new reset link <ArrowRight size={18} /></Link>
                </div>
            )}
            <Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
        </AuthUtilityLayout>
    );
}
