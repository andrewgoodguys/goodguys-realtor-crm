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

/** True when a query failed because the table, view or column it names is not
 *  in the database yet — PostgREST's PGRST205 and PGRST204, and Postgres's own
 *  42P01 / 42703 underneath them.
 *
 *  Deploys and migrations are separate acts here: Actions ships the app on a
 *  push to main, and the SQL is pasted into the editor by hand, so the app is
 *  briefly ahead of the schema every time. That window should read as "not
 *  applied yet" and leave the rest of the page working, not as a red error
 *  suggesting something is broken. */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST205" || code === "PGRST204" || code === "42P01" || code === "42703";
}

/** The only address domain allowed to sign in. Mirrors public.is_goodguys(). */
export const ALLOWED_DOMAIN = "goodguysserve.com";

export function isAllowedEmail(email: string | undefined | null): boolean {
  return (email ?? "").toLowerCase().trim().endsWith(`@${ALLOWED_DOMAIN}`);
}
