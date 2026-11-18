import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate }                      from "react-router-dom";
import { Bell, Menu, Moon, Search, Sun }            from "lucide-react";
import { Sidebar }                                  from "./Sidebar";
import { useAuth }                                  from "../app/useAuth";
import { MarutTransition }                          from "../components/branding/MarutTransition";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem("marut-admin-theme");
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AppLayout() {
  const [mobileNavOpen   , setMobileNavOpen   ] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("marut-admin-sidebar-collapsed") === "true",
  );
  const [theme                , setTheme                ] = useState<Theme>(getInitialTheme);
  const [showLogoutTransition , setShowLogoutTransition ] = useState(false);
  const [logoutTransitionReady, setLogoutTransitionReady] = useState(false);
  const [logoutError         , setLogoutError           ] = useState("");
  const logoutInProgressRef = useRef(false);

  const { signOut, finalizeSignOut } = useAuth();
  const navigate                     = useNavigate();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("marut-admin-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("marut-admin-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const toggleTheme = () => {
    setTheme((current) => current === "light" ? "dark" : "light");
  };

  const beginLogout = async () => {
    if (logoutInProgressRef.current) return;

    logoutInProgressRef.current = true;
    setLogoutError("");
    setMobileNavOpen(false);
    setLogoutTransitionReady(false);
    setShowLogoutTransition(true);

    try {
      // Supabase sign-out starts while the MARUT typing animation is running.
      // Keep the local session until the animation's exit phase has completed.
      await signOut({ deferStateReset: true });
      setLogoutTransitionReady(true);
    } catch (cause) {
      logoutInProgressRef.current = false;
      setShowLogoutTransition(false);
      setLogoutTransitionReady(false);
      setLogoutError(cause instanceof Error ? cause.message : "Unable to sign out. Please try again.");
    }
  };

  const completeLogout = useCallback(() => {
    finalizeSignOut();
    navigate("/login", { replace: true });
  }, [finalizeSignOut, navigate]);

  return (
    <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <Sidebar
        open={mobileNavOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setMobileNavOpen(false)}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        onLogout={beginLogout}
      />
      {mobileNavOpen && (
        <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
      )}
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
            <Menu size={19} />
          </button>
          <div className="topbar-context">
            <span className="topbar-eyebrow">MARUT WORKSPACE</span>
            <span className="topbar-title">Operations</span>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" type="button" aria-label="Search (coming soon)">
              <Search size={16} />
              <span>Search</span>
            </button>
            <button
              className="icon-button theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="icon-button" type="button" aria-label="Notifications (coming soon)">
              <Bell size={18} />
            </button>
            <div className="avatar" aria-label="User profile">M</div>
          </div>
        </header>
        {logoutError && <p className="app-logout-error" role="alert">{logoutError}</p>}
        <main className="workspace">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>MARUT Admin</span>
          <span>V2 · Foundation</span>
        </footer>
      </div>
      {showLogoutTransition && (
        <MarutTransition mode="logout" ready={logoutTransitionReady} onComplete={completeLogout} />
      )}
    </div>
  );
}
