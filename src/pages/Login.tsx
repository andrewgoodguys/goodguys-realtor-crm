import { useState, type FormEvent } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ALLOWED_DOMAIN } from "@/lib/supabase";
import { Button, Card, Field, Input } from "@/components/ui";

export default function Login() {
  const { signInWithOtp, verifyOtp } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const onRequest = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await signInWithOtp(email);
      setSent(true);
    });
  };

  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    void run(() => verifyOtp(email, code));
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="text-lg font-semibold">GoodGuys Realtor CRM</h1>
          <p className="muted mt-1 text-sm">
            Sign in with your @{ALLOWED_DOMAIN} email
          </p>
        </div>

        {!sent ? (
          <form onSubmit={onRequest} className="space-y-4">
            <Field label="Work email">
              <Input
                type="email"
                autoComplete="email"
                required
                placeholder={`you@${ALLOWED_DOMAIN}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              <Mail className="size-4" />
              Email me a sign-in code
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <p className="text-sm">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it below — or
              just click the link in the email.
            </p>
            <Field label="Sign-in code">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Sign in
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setSent(false);
                setCode("");
              }}
            >
              Use a different email
            </Button>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
