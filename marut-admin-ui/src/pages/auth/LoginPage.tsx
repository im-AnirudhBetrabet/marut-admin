import { useState, type FormEvent }                           from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Sprout } from "lucide-react";
import { Link, useLocation, useNavigate }                     from "react-router-dom";
import { ApiError, apiRequest }                               from "../../services/api/client";
import { isSupabaseConfigured, supabase }                     from "../../services/auth/supabase";
import { useAuth }                                            from "../../app/useAuth";

type CheckEmailResponse = { authorised: boolean; can_login: boolean };

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "password">("email");
  const [showPassword, setShowPassword] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshAdmin } = useAuth();

  const checkEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email address to continue.");
      return;
    }
    setCheckingEmail(true);
    try {
      const result = await apiRequest<CheckEmailResponse>("/auth/check-email", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail }),
      });
      if (result.authorised && result.can_login) {
        setEmail(normalizedEmail);
        setStep("password");
      } else {
        setError("We couldn't verify access for this email. Check the address or contact your MARUT administrator.");
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError("We couldn't verify access for this email. Check the address or contact your MARUT administrator.");
      } else {
        setError("We couldn't verify your access right now. Please try again.");
      }
    } finally {
      setCheckingEmail(false);
    }
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Add the project URL and anon key to your environment file.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;
      if (!data.session) throw new Error("Supabase did not return an active session.");

      try {
        await refreshAdmin(data.session);
      } catch (cause) {
        await supabase.auth.signOut();
        if (cause instanceof ApiError && cause.status === 403) {
          throw new Error("Your account is not currently authorised to access MARUT Admin.");
        }
        throw new Error("We couldn't verify your administrator profile. Please try again.");
      }
      const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(destination && destination !== "/login" ? destination : "/dashboard", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-desktop-card" aria-label="MARUT Admin sign in">
        <div className="auth-visual">
          <img src="/assets/greenhouse-microgreens.webp" alt="Fresh microgreens growing in trays beside a greenhouse" />
        </div>
        <div className="auth-form-panel">
          <div className="auth-brand">
            <img className="auth-logo" src="/assets/marut-logo-gold.webp" alt="MARUT" />
            <p className="auth-subtitle">Admin Portal</p>
            <p className="auth-tagline">Farm <span>•</span> Orders <span>•</span> Customers <span>•</span> Operations</p>
          </div>

          <form className="auth-form" onSubmit={step === "email" ? checkEmail : signIn}>
            {step === "email" ? (
              <label className="auth-input-wrap">
                <Mail size={19} aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </label>
            ) : (
              <>
                <div className="auth-identity-row">
                  <span className="auth-identity-label">Signing in as</span>
                  <strong>{email}</strong>
                  <button type="button" className="auth-text-button" onClick={() => { setStep("email"); setPassword(""); setError(""); }}>Change</button>
                </div>
                <label className="auth-input-wrap">
                  <LockKeyhole size={19} aria-hidden="true" />
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoFocus
                  />
                  <button className="auth-visibility" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </label>
              </>
            )}

            {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
            {notice && <p className="auth-message" role="status">{notice}</p>}

            <button className="auth-submit" type="submit" disabled={checkingEmail || submitting}>
              {checkingEmail || submitting ? "Please wait…" : step === "email" ? "Continue" : "Sign In"}
              <ArrowRight size={18} />
            </button>
          </form>

          <div className="auth-links">
            {step === "password" && <Link to="/forgot-password">Forgot password?</Link>}
            {step === "email" && <span className="auth-secure-note"><Sprout size={14} /> Restricted to authorised MARUT administrators</span>}
          </div>
          <img className="auth-wave" src="/assets/botanical-wave.webp" alt="" aria-hidden="true" />
        </div>
      </section>
      <section className="auth-mobile-card" aria-label="MARUT Admin sign in">
        <div className="auth-mobile-brand">
          <img className="auth-logo" src="/assets/marut-logo-gold.webp" alt="MARUT" />
          <p className="auth-subtitle">Admin Portal</p>
          <p className="auth-tagline">Farm <span>•</span> Orders <span>•</span> Customers <span>•</span> Operations</p>
        </div>
        <form className="auth-form" onSubmit={step === "email" ? checkEmail : signIn}>
          {step === "email" ? (
            <label className="auth-input-wrap">
              <Mail size={19} aria-hidden="true" />
              <input type="email" autoComplete="username" placeholder="Enter your email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
          ) : (
            <>
              <div className="auth-identity-row">
                <span className="auth-identity-label">Signing in as</span>
                <strong>{email}</strong>
                <button type="button" className="auth-text-button" onClick={() => { setStep("email"); setPassword(""); setError(""); }}>Change</button>
              </div>
              <label className="auth-input-wrap">
                <LockKeyhole size={19} aria-hidden="true" />
                <input type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                <button className="auth-visibility" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </label>
            </>
          )}
          {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={checkingEmail || submitting}>
            {checkingEmail || submitting ? "Please wait…" : step === "email" ? "Continue" : "Sign In"} <ArrowRight size={18} />
          </button>
        </form>
        <div className="auth-links">
          {step === "password" && <Link to="/forgot-password">Forgot password?</Link>}
          {step === "email" && <span className="auth-secure-note"><Sprout size={14} /> Restricted to authorised MARUT administrators</span>}
        </div>
        <div className="auth-mobile-illustration">
          <img src="/assets/greenhouse-microgreens.webp" alt="Microgreens growing in trays inside a greenhouse" />
        </div>
        <img className="auth-wave auth-wave--mobile" src="/assets/botanical-wave.webp" alt="" aria-hidden="true" />
      </section>
    </main>
  );
}
