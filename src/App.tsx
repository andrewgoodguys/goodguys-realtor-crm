import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  BarChart3,
  Building2,
  LogOut,
  MapPinned,
  PhoneCall,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useData";
import { applyAccent } from "@/lib/branding";
import { isAllowedEmail, ALLOWED_DOMAIN } from "@/lib/supabase";
import { Button, Spinner, cn } from "@/components/ui";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import CallList from "@/pages/CallList";
import Agents from "@/pages/Agents";
import AgentDetail from "@/pages/AgentDetail";
import Leads from "@/pages/Leads";
import RunLog from "@/pages/RunLog";
import Settings from "@/pages/Settings";

const NAV = [
  { to: "/", label: "Dashboard", icon: BarChart3, end: true },
  { to: "/calls", label: "Call list", icon: PhoneCall, end: false },
  { to: "/agents", label: "Agents", icon: Building2, end: false },
  { to: "/leads", label: "Leads", icon: MapPinned, end: false },
  { to: "/runs", label: "Run log", icon: ScrollText, end: false },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal, end: false },
];

export default function App() {
  const { session, email, loading, signOut } = useAuth();
  const branding = useBranding().data;

  // Ahead of the session check: the login screen is branded too.
  useEffect(() => {
    applyAccent(branding?.accent_color);
    document.title = branding?.app_name ?? "GoodGuys Realtor CRM";
  }, [branding?.accent_color, branding?.app_name]);

  if (loading) return <Spinner label="Loading…" />;
  if (!session) return <Login />;

  // A non-GoodGuys address can obtain a session but RLS returns nothing, which
  // would look like an empty app. Say why instead.
  if (!isAllowedEmail(email)) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold">Not a GoodGuys account</h1>
        <p className="muted text-sm">
          {email} isn&rsquo;t on the {ALLOWED_DOMAIN} domain, so this CRM has nothing to
          show you.
        </p>
        <Button onClick={signOut}>Sign out</Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <span className="flex items-center gap-2 font-semibold tracking-tight whitespace-nowrap">
            {branding?.logo_url && (
              <img src={branding.logo_url} alt="" className="size-6 rounded object-contain" />
            )}
            {branding?.app_name ?? (
              <>
                GoodGuys <span className="text-brand-600">Realtor CRM</span>
              </>
            )}
          </span>

          <nav className="ml-4 hidden gap-1 md:flex">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100"
                      : "muted hover:bg-[var(--surface-2)]",
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="muted hidden text-sm sm:inline">{email}</span>
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-4 pb-24 md:pb-4">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calls" element={<CallList />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/:id" element={<AgentDetail />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/runs" element={<RunLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Bottom bar on phones — this app gets used standing in a driveway. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                isActive ? "text-brand-600" : "muted",
              )
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
