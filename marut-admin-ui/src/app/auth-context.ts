import { createContext }        from "react";
import type { Session }         from "@supabase/supabase-js";
import type { AdminMeResponse } from "./AuthContext";

type AuthContextValue = {
  session     : Session | null;
  admin       : AdminMeResponse | null;
  loading     : boolean;
  profileError: string | null;
  refreshAdmin: (sessionOverride?: Session) => Promise<AdminMeResponse>;
  signOut     : (options?: { deferStateReset?: boolean }) => Promise<void>;
  finalizeSignOut: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
