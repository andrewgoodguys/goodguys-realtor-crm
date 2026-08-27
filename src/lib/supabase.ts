import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** The only address domain allowed to sign in. Mirrors public.is_goodguys(). */
export const ALLOWED_DOMAIN = "goodguysserve.com";

export function isAllowedEmail(email: string | undefined | null): boolean {
  return (email ?? "").toLowerCase().trim().endsWith(`@${ALLOWED_DOMAIN}`);
}
