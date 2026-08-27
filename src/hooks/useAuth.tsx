import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isAllowedEmail, ALLOWED_DOMAIN } from "@/lib/supabase";
import type { Owner } from "@/lib/types";

interface AuthValue {
  session: Session | null;
  user: User | null;
  email: string | null;
  /** Which half of the Andrew/Avery split this user owns, if any. */
  owner: Owner | null;
  loading: boolean;
  signInWithOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

function ownerFromEmail(email: string | null): Owner | null {
  if (!email) return null;
  const local = email.split("@")[0].toLowerCase();
  if (local.startsWith("andrew")) return "Andrew";
  if (local.startsWith("avery")) return "Avery";
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signInWithOtp = useCallback(async (email: string) => {
    const trimmed = email.trim().toLowerCase();
    // Checked here for a fast, clear error; enforced for real by RLS
    // (public.is_goodguys) so a crafted request can't get past it.
    if (!isAllowedEmail(trimmed)) {
      throw new Error(`Use your @${ALLOWED_DOMAIN} email address.`);
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: "email",
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(() => {
    const email = session?.user?.email ?? null;
    return {
      session,
      user: session?.user ?? null,
      email,
      owner: ownerFromEmail(email),
      loading,
      signInWithOtp,
      verifyOtp,
      signOut,
    };
  }, [session, loading, signInWithOtp, verifyOtp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
