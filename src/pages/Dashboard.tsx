import { Link } from "react-router-dom";
import { ArrowRight, PhoneCall } from "lucide-react";
import { useDashboardStats, useRecentTouches, useRuns } from "@/hooks/useData";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Spinner, Stat } from "@/components/ui";

export default function Dashboard() {
  const stats = useDashboardStats();
  const touches = useRecentTouches(12);
  const runs = useRuns();

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
        <Link
          to="/calls"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <PhoneCall className="size-4" />
          Work the call list
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Due now" value={s.dueCount} hint="uncontacted or past cool-off" />
        <Stat label="Active agents" value={s.totalAgents} hint="excludes do-not-contact" />
        <Stat
          label="Touches this week"
          value={s.touchesThisWeek}
          hint={s.touchesThisWeek === 0 ? "nothing logged yet" : "logged by you and Avery"}
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
            title="The split"
            subtitle="Assigned by brokerage, stable across every pipeline run"
          />
          <div className="space-y-3 p-4">
            <SplitBar andrew={s.splitAndrew} avery={s.splitAvery} />
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
        <CardHeader title="Recent outreach" subtitle="Everything you and Avery have logged" />
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
                  {t.created_by_email?.split("@")[0]} · {fmtRelative(t.occurred_at)}
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

function SplitBar({ andrew, avery }: { andrew: number; avery: number }) {
  const total = Math.max(1, andrew + avery);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="bg-brand-600"
          style={{ width: `${(andrew / total) * 100}%` }}
          aria-label={`Andrew ${andrew}`}
        />
        <div
          className="bg-sky-500"
          style={{ width: `${(avery / total) * 100}%` }}
          aria-label={`Avery ${avery}`}
        />
      </div>
      <div className="mt-2 flex justify-between text-sm">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-brand-600" />
          Andrew <span className="nums muted">{andrew}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-sky-500" />
          Avery <span className="nums muted">{avery}</span>
        </span>
      </div>
    </div>
  );
}
