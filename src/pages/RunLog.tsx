import { ScrollText } from "lucide-react";
import { useRuns } from "@/hooks/useData";
import { fmtDate } from "@/lib/format";
import { Card, EmptyState, ErrorState, Spinner } from "@/components/ui";

export default function RunLog() {
  const { data, isLoading, error } = useRuns();

  if (error) return <ErrorState error={error} />;
  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Run log</h1>
        <p className="muted text-sm">Every weekly pipeline run, newest first</p>
      </div>

      {!data?.length ? (
        <Card>
          <EmptyState
            icon={<ScrollText className="size-8" />}
            title="No runs recorded"
            description="Each run of the goodguys-pipeline weekly job appends a row here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-left">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
                  <th>Run date</th>
                  <th>Jobs</th>
                  <th>Addresses</th>
                  <th>New leads</th>
                  <th>New agents</th>
                  <th>Rechecks</th>
                  <th>Flagged</th>
                  <th className="hidden md:table-cell">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.map((r) => (
                  <tr
                    key={r.id}
                    className="[&>td]:px-3 [&>td]:py-2 hover:bg-[var(--surface-2)]"
                  >
                    <td className="whitespace-nowrap font-medium">{fmtDate(r.run_date)}</td>
                    <td className="nums">{r.jobs_in_data ?? "—"}</td>
                    <td className="nums">{r.addresses_processed ?? "—"}</td>
                    <td className="nums">{r.new_leads ?? "—"}</td>
                    <td className="nums">{r.new_agents ?? "—"}</td>
                    <td className="nums">{r.rechecks_resolved ?? "—"}</td>
                    <td className="nums">{r.flagged_for_review ?? "—"}</td>
                    <td className="muted hidden max-w-md truncate md:table-cell">
                      {r.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
