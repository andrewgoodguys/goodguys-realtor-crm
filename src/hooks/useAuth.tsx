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
  /** This user's row in public.people — the name their agents are assigned
   *  to. Created on first sign-in, so everyone on the domain has one. */
  owner: Owner | null;
  loading: boolean;
  signInWithOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

/** Last resort only. Until 0010 this *was* the identity, which is why a third
 *  employee had none; it stays as the fallback for the window where the app is
 *  deployed and the migration has not been run, so Andrew and Avery keep a
 *  working call list instead of the page going blank. */
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
  const [owner, setOwner] = useState<Owner | null>(null);

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

  // Who this user is, according to the database rather than the shape of their
  // address. ensure_my_person() creates and links the row on first call and is
  // a no-op after that, so running it on every sign-in is how a new employee
  // gets a name without anybody administering one.
  const authEmail = session?.user?.email ?? null;
  useEffect(() => {
    if (!authEmail) {
      setOwner(null);
      return;
    }
    let cancelled = false;
    void supabase
      .rpc("ensure_my_person")
      .then(({ data, error }) => {
        if (cancelled) return;
        // A failure here is the migration not being applied yet, not a broken
        // session. Fall back rather than leaving the call list ownerless.
        if (error) {
          console.warn("ensure_my_person failed, falling back to email", error);
          setOwner(ownerFromEmail(authEmail));
          return;
        }
        setOwner((data as string | null) ?? ownerFromEmail(authEmail));
      });
    return () => {
      cancelled = true;
    };
  }, [authEmail]);

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

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      email: session?.user?.email ?? null,
      owner,
      loading,
      signInWithOtp,
      verifyOtp,
      signOut,
    }),
    [session, owner, loading, signInWithOtp, verifyOtp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
