import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session }                                                      from "@supabase/supabase-js";
import { ApiError, apiRequest }                                              from "../services/api/client";
import { supabase }                                                          from "../services/auth/supabase";
import { AuthContext }                                                       from "./auth-context";

export type AdminProfile = {
  id          : string;
  auth_user_id: string;
  email       : string;
  display_name: string;
  role        : "owner" | "staff" | string;
  is_active   : boolean;
};

export type AdminMeResponse = {
  user       : AdminProfile;
  role       : string;
  permissions: Array<{ module_key: string; level: string }> | "all";
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session       , setSession       ] = useState<Session | null>(null);
  const [admin         , setAdmin         ] = useState<AdminMeResponse | null>(null);
  const [loading       , setLoading       ] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError  , setProfileError  ] = useState<string | null>(null);
  const deferSignOutStateRef = useRef(false);

  const refreshAdmin = useCallback(async (sessionOverride?: Session) => {
    const activeSession = sessionOverride ?? session;
    if (!activeSession?.access_token) throw new Error("No active session.");
    setProfileLoading(true);
    setProfileError(null);
    try {
      const result = await apiRequest<AdminMeResponse>("/auth/me", {}, activeSession.access_token);
      setAdmin(result);
      return result;
    } catch (error) {
      setAdmin(null);
      setProfileError(error instanceof Error ? error.message : "Unable to verify administrator access.");
      throw error;
    } finally {
      setProfileLoading(false);
    }
  }, [session]);

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      // Keep the protected layout mounted while the logout transition is visible.
      // AppLayout clears local auth state after the exit animation completes.
      if (event === "SIGNED_OUT" && deferSignOutStateRef.current) return;
      setSession(nextSession);
      if (!nextSession) {
        setAdmin(null);
        setProfileLoading(false);
        setProfileError(null);
      }
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setSession(null);
      } else {
        setSession(data.session);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (loading || !session) return;

    // Password-recovery sessions are deliberately limited to changing the
    // password. Do not send them through the administrator profile check:
    // /auth/me may reject the recovery token and sign the user out before
    // the reset page can call supabase.auth.updateUser().
    
    const isRecoverySession =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem("marut-password-recovery-session") === "true";

    // Invitation sessions must not be sent to /auth/me before acceptance.
    // The invitee does not have an active MARUT admin profile yet.
    // Keep the Supabase session alive so AcceptInvitePage can update the password
    // and submit the invitation to the backend.
    const isInvitationAcceptanceRoute =
      typeof window !== "undefined" &&
      window.location.pathname.replace(/\/+$/, "") === "/accept-invite";

    if (isRecoverySession || isInvitationAcceptanceRoute) {
      setAdmin(null);
      setProfileError(null);
      setProfileLoading(false);
      return;
    }

    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    void apiRequest<AdminMeResponse>("/auth/me", {}, session.access_token)
      .then((result) => {
        if (active) {
          setAdmin(result);
          setProfileError(null);
          setProfileLoading(false);
        }
      })
      .catch(async (error: unknown) => {
        if (!active) return;
        setAdmin(null);
        if (error instanceof ApiError && error.status === 403) {
          await supabase.auth.signOut();
        } else {
          setProfileError(error instanceof Error ? error.message : "Unable to verify administrator access.");
        }
        setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loading, session]);

  const clearLocalAuthState = useCallback(() => {
    deferSignOutStateRef.current = false;
    setSession(null);
    setAdmin(null);
    setProfileLoading(false);
    setProfileError(null);
  }, []);

  const signOut = useCallback(async (options?: { deferStateReset?: boolean }) => {
    deferSignOutStateRef.current = options?.deferStateReset === true;

    const { error } = await supabase.auth.signOut();
    if (error) {
      deferSignOutStateRef.current = false;
      throw error;
    }

    if (!options?.deferStateReset) {
      clearLocalAuthState();
    }
  }, [clearLocalAuthState]);

  const finalizeSignOut = useCallback(() => {
    clearLocalAuthState();
  }, [clearLocalAuthState]);

  const value = useMemo(
    () => ({ session, admin, loading: loading || profileLoading, profileError, refreshAdmin, signOut, finalizeSignOut }),
    [session, admin, loading, profileLoading, profileError, refreshAdmin, signOut, finalizeSignOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
