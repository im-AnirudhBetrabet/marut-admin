import { createContext }        from "react";
import type { Session }         from "@supabase/supabase-js";
import type { AdminMeResponse } from "./AuthContext";

type AuthContextValue = {
  session     : Session | null;
  admin       : AdminMeResponse | null;
  loading     : boolean;
  profileError: string | null;
  refreshAdmin: (sessionOverride?: Session) => Promise<AdminMeResponse>;
  signOut     : () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
