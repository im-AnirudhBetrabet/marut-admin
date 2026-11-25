import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth }                       from "../../app/useAuth";

export function RequireAuth() {
  const { session, admin, loading, profileError, refreshAdmin } = useAuth();
  const location = useLocation();

  if (loading || (session && !admin && !profileError)) {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <span className="auth-loading-mark">M</span>
        <span>Preparing your workspace…</span>
      </div>
    );
  }

  if (session && profileError) {
    return (
      <div className="auth-loading auth-loading--error">
        <div>
          <strong>We couldn't verify your admin access.</strong>
          <p>{profileError}</p>
          <div style={{display: "flex", flexDirection: "column", gap: "1rem"}}>
            <button type="button" className="product-button product-button-secondary" onClick={() => void refreshAdmin()}>Try again</button>
            <button type="button" className="product-button product-button-primary" onClick={() => window.location.assign("/login")}>Back to sign in</button>
          </div>
        </div>
      </div>
    );
  }

  if (!session || !admin) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
