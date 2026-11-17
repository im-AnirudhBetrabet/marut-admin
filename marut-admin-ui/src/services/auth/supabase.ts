import { createClient } from "@supabase/supabase-js";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase             = createClient(supabaseUrl || "https://missing-project.supabase.co", supabaseAnonKey || "missing-anon-key", {
    auth: {
      persistSession    : true,
      autoRefreshToken  : true,
      detectSessionInUrl: true,
      flowType          : "pkce",
    },
  },
);

// Capture recovery events as soon as the client emits them. This marker lets
// /reset-password safely survive a refresh without treating ordinary sessions
// as password-recovery sessions.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session) {
      window.sessionStorage.setItem("marut-password-recovery-session", "true");
    } else if (event === "SIGNED_OUT") {
      window.sessionStorage.removeItem("marut-password-recovery-session");
    }
  });
}
