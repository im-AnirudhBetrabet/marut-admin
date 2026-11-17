import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Mail, Sprout } from "lucide-react";
import { Link } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../../services/auth/supabase";
import { AuthUtilityLayout } from "../../components/auth/AuthUtilityLayout";

export function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        if (!isSupabaseConfigured) {
            setError("Password recovery is not configured. Please contact your administrator.");
            return;
        }
        setSubmitting(true);
        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo: `${window.location.origin}/reset-password`,
            });
            if (resetError) throw resetError;
            setSent(true);
        } catch {
            // Keep the response generic to avoid revealing whether an email is registered.
            setSent(true);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthUtilityLayout>

            {!sent ? (
                <>
                    <div className="auth-utility-heading">
                        <h1>Reset your password</h1>
                        <p>Enter the email address associated with your MARUT Admin account. If an eligible account exists, we'll send a reset link.</p>
                    </div>
                    <form className="auth-form" onSubmit={submit}>
                        <label className="auth-input-wrap">
                            <Mail size={19} aria-hidden="true" />
                            <input type="email" autoComplete="email" placeholder="Enter your email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
                        </label>
                        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
                        <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send reset link"} <ArrowRight size={18} /></button>
                    </form>
                </>
            ) : (
                <div className="auth-success" role="status">
                    <span className="auth-success-icon"><Mail size={22} /></span>
                    <h1>Check your inbox</h1>
                    <p>If an account is associated with that email, you'll receive a password reset link shortly. Please also check your spam folder.</p>
                    <button className="auth-submit" type="button" onClick={() => { setSent(false); setError(""); }}>Try another email <ArrowRight size={18} /></button>
                </div>
            )}
            <Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
            <span className="auth-secure-note"><Sprout size={14} /> Secure access for MARUT administrators</span>
        </AuthUtilityLayout>
    );
}
