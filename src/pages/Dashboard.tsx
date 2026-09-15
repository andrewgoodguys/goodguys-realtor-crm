import { Link } from "react-router-dom";
import { ArrowRight, ListChecks, PhoneCall } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  UNASSIGNED,
  useDashboardStats,
  useDistributeUnassigned,
  useOwnerWorkload,
  usePeople,
  useRecentTouches,
  useRuns,
} from "@/hooks/useData";
import { fmtDate, fmtRelative } from "@/lib/format";
import { isMissingSchema } from "@/lib/supabase";
import type { OwnerWorkload } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Spinner,
  Stat,
} from "@/components/ui";

export default function Dashboard() {
  const { owner } = useAuth();
  const stats = useDashboardStats();
  const workload = useOwnerWorkload();
  const touches = useRecentTouches(12);
  const runs = useRuns();
  const people = usePeople(true).data ?? [];
  const distribute = useDistributeUnassigned();

  // Touches record the email that logged them. Now that people carry their
  // login, show the name instead — "sy" and "Sy Lovingood" are the same
  // person, and only one of them is how anyone refers to him.
  const nameFor = (email: string | null) => {
    if (!email) return "—";
    const person = people.find((p) => p.email === email.toLowerCase());
    return person?.name ?? email.split("@")[0];
  };

  if (stats.isLoading) return <Spinner label="Loading dashboard…" />;
  if (stats.error) return <ErrorState error={stats.error} />;

  const s = stats.data!;
  const lastRun = runs.data?.[0];
  const responseRate =
    s.contactedCount > 0 ? Math.round((s.respondedCount / s.contactedCount) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/cadence"
            className="muted inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-2)]"
          >
            <ListChecks className="size-4" />
            Cadence
          </Link>
          <Link
            to="/calls"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <PhoneCall className="size-4" />
            Work the call list
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Due now" value={s.dueCount} hint="uncontacted or past cool-off" />
        <Stat label="Active agents" value={s.totalAgents} hint="excludes do-not-contact" />
        <Stat
          label="Touches this week"
          value={s.touchesThisWeek}
          hint={s.touchesThisWeek === 0 ? "nothing logged yet" : "logged by the team"}
          tone={s.touchesThisWeek === 0 ? "warn" : "brand"}
        />
        <Stat
          label="Response rate"
          value={`${responseRate}%`}
          hint={`${s.respondedCount} of ${s.contactedCount} contacted`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Who has what"
            subtitle="Split by brokerage to begin with, then whatever anyone has taken since"
          />
          <div className="space-y-3 p-4">
            {workload.isLoading ? (
              <Spinner />
            ) : isMissingSchema(workload.error) ? (
              <p className="muted text-sm">
                Waiting on migration <code>0010_anyone_can_own</code> — run it and
                this fills in.
              </p>
            ) : workload.error ? (
              <ErrorState error={workload.error} />
            ) : (
              <Workload
                rows={workload.data ?? []}
                me={owner}
                unassigned={s.unassignedCount}
                onDistribute={() => distribute.mutate()}
                distributing={distribute.isPending}
              />
            )}
            {distribute.error && <ErrorState error={distribute.error} />}
            {s.leadsFlagged > 0 && (
              <p className="text-sm">
                <Badge tone="warn">{s.leadsFlagged} leads</Badge>{" "}
                <span className="muted">flagged for manual review</span>{" "}
                <Link to="/leads" className="text-brand-600 hover:underline">
                  review them
                </Link>
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Last pipeline run"
            subtitle={lastRun ? fmtDate(lastRun.run_date) : "no runs recorded yet"}
          />
          {lastRun ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <Row label="Jobs in report" value={lastRun.jobs_in_data} />
              <Row label="Addresses processed" value={lastRun.addresses_processed} />
              <Row label="New leads" value={lastRun.new_leads} />
              <Row label="New agents" value={lastRun.new_agents} />
              <Row label="Rechecks resolved" value={lastRun.rechecks_resolved} />
              <Row label="Flagged" value={lastRun.flagged_for_review} />
            </dl>
          ) : (
            <EmptyState
              title="No pipeline runs yet"
              description="Run the weekly pipeline in goodguys-pipeline to populate this."
            />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent outreach" subtitle="Everything the team has logged" />
        {touches.isLoading ? (
          <Spinner />
        ) : !touches.data?.length ? (
          <EmptyState
            title="Nothing logged yet"
            description="Outreach you log from the call list shows up here."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {touches.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Badge tone={t.got_response ? "brand" : "neutral"}>{t.channel}</Badge>
                <Link
                  to={`/agents/${t.agent_id}`}
                  className="truncate font-medium hover:text-brand-600 hover:underline"
                >
                  {t.outcome ?? t.notes ?? "Logged"}
                </Link>
                <span className="muted ml-auto whitespace-nowrap text-xs">
                  {nameFor(t.created_by_email)} · {fmtRelative(t.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="nums font-medium">{value ?? "—"}</dd>
    </div>
  );
}

/** A bar each, rather than one bar in two segments.
 *
 *  The old version took two numbers and drew two colours, which was honest
 *  while the split was Andrew and Avery and became a lie the moment it was not.
 *  This takes however many people there are — including whoever has nothing
 *  yet, because a row reading 0 is the one that asks to be acted on. */
function Workload({
  rows,
  me,
  unassigned,
  onDistribute,
  distributing,
}: {
  rows: OwnerWorkload[];
  me: string | null;
  unassigned: number;
  onDistribute: () => void;
  distributing: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="muted text-sm">
        Nobody in <Link to="/settings" className="text-brand-600 hover:underline">Settings → People</Link> yet.
      </p>
    );
  }

  // Scaled against the largest holding, not the total: with five people the
  // share-of-total bars all collapse to slivers and stop being readable.
  const most = Math.max(1, ...rows.map((r) => r.agent_count));

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const mine = r.owner_name === me;
        return (
          <Link
            key={r.owner_name}
            to={`/agents?owner=${encodeURIComponent(r.owner_name)}`}
            className="block rounded-lg px-1 py-1 hover:bg-[var(--surface-2)]"
          >
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={mine ? "font-semibold" : ""}>
                {r.owner_name}
                {mine && <span className="muted text-xs"> · you</span>}
              </span>
              <span className="nums muted text-xs">
                {r.agent_count} agents
                {r.due_count > 0 && ` · ${r.due_count} due`}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className={mine ? "h-full bg-brand-600" : "h-full bg-sky-500"}
                style={{ width: `${(r.agent_count / most) * 100}%` }}
              />
            </div>
          </Link>
        );
      })}

      {unassigned > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2 text-sm">
          <Link
            to={`/agents?owner=${encodeURIComponent(UNASSIGNED)}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--surface-2)]"
          >
            <Badge tone="warn">{unassigned}</Badge>
            <span className="muted truncate">
              active {unassigned === 1 ? "agent has" : "agents have"} no owner
            </span>
            <ArrowRight className="muted ml-auto size-4 shrink-0" />
          </Link>
          <Button size="sm" loading={distributing} onClick={onDistribute}>
            Deal them out
          </Button>
        </div>
      )}
    </div>
  );
}
