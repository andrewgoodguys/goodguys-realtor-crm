import { createClient } from "@supabase/supabase-js";
import { cleanEnv } from "./env";

const url = cleanEnv("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
const anonKey = cleanEnv("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY);

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
