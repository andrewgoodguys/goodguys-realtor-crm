import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building, Search } from "lucide-react";
import { useBrokerages } from "@/hooks/useData";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, Input, Spinner } from "@/components/ui";

export default function Brokerages() {
  const { data, isLoading, error } = useBrokerages();
  const [search, setSearch] = useState("");

  // Fewer than a hundred rows and no server-side filter on the view, so the
  // search is local and instant.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data ?? [];
    return (data ?? []).filter((b) => b.brokerage.toLowerCase().includes(term));
  }, [data, search]);

  const totalOffices = (data ?? []).reduce((n, b) => n + b.office_count, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Brokerages</h1>
          <p className="muted text-sm">
            {isLoading
              ? "…"
              : `${rows.length} firm${rows.length === 1 ? "" : "s"}, ${totalOffices} office${
                  totalOffices === 1 ? "" : "s"
                } on record`}
          </p>
        </div>
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            placeholder="Keller Williams, Ansley…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState
          icon={<Building className="size-8" />}
          title="No brokerages"
          description="Agents need a brokerage before they can be grouped by one."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="muted border-b border-[var(--border)]">
                <tr>
                  <Th>Brokerage</Th>
                  <Th className="nums">Agents</Th>
                  <Th className="nums hidden sm:table-cell">Offices</Th>
                  <Th className="nums hidden md:table-cell">Due</Th>
                  <Th className="nums hidden lg:table-cell">Jobs</Th>
                  <Th className="nums hidden lg:table-cell">Revenue</Th>
                  <Th className="hidden xl:table-cell">Last job</Th>
                  <Th className="hidden md:table-cell">Owner</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((b) => (
                  <tr key={b.brokerage} className="hover:bg-[var(--surface-2)]">
                    <Td>
                      <Link
                        to={`/brokerages/${encodeURIComponent(b.brokerage)}`}
                        className="font-medium hover:text-brand-600 hover:underline"
                      >
                        {b.brokerage}
                      </Link>
                      {b.dnc_count > 0 && (
                        <Badge tone="neutral" className="ml-2">
                          {b.dnc_count} DNC
                        </Badge>
                      )}
                    </Td>
                    <Td className="nums">{b.agent_count}</Td>
                    <Td className="nums hidden sm:table-cell">
                      {b.office_count || <span className="muted">—</span>}
                    </Td>
                    <Td className="nums hidden md:table-cell">
                      {b.due_count ? (
                        <Badge tone="brand">{b.due_count}</Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </Td>
                    <Td className="nums hidden lg:table-cell">{b.lifetime_jobs}</Td>
                    <Td className="nums hidden lg:table-cell">
                      {fmtMoney(b.lifetime_revenue)}
                    </Td>
                    <Td className="muted hidden whitespace-nowrap text-xs xl:table-cell">
                      {b.most_recent_job ? fmtDate(b.most_recent_job) : "—"}
                    </Td>
                    <Td className="muted hidden text-xs md:table-cell">
                      {b.owners ?? "—"}
                    </Td>
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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${className ?? ""}`}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className ?? ""}`}>{children}</td>;
}
