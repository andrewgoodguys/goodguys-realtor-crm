import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Users } from "lucide-react";
import { useAgents, type AgentFilters } from "@/hooks/useData";
import { fmtDate, fmtMoney, fmtPhone, priorityTone } from "@/lib/format";
import { RELATIONSHIP_STATUSES } from "@/lib/types";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
} from "@/components/ui";

export default function Agents() {
  const [filters, setFilters] = useState<AgentFilters>({ includeDnc: false });
  const { data, isLoading, error } = useAgents(filters);

  const set = (patch: Partial<AgentFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agents</h1>
          <p className="muted text-sm">
            {isLoading ? "…" : `${data?.length ?? 0} shown`}
          </p>
        </div>
      </div>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="Name, brokerage, phone…"
              value={filters.search ?? ""}
              onChange={(e) => set({ search: e.target.value })}
            />
          </div>
          <Select
            value={filters.owner ?? ""}
            onChange={(e) => set({ owner: e.target.value || undefined })}
          >
            <option value="">All owners</option>
            <option value="Andrew">Andrew</option>
            <option value="Avery">Avery</option>
          </Select>
          <Select
            value={filters.status ?? ""}
            onChange={(e) => set({ status: e.target.value || undefined })}
          >
            <option value="">All statuses</option>
            {RELATIONSHIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 px-1 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-brand-600)]"
              checked={filters.includeDnc ?? false}
              onChange={(e) => set({ includeDnc: e.target.checked })}
            />
            Include do-not-contact
          </label>
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Users className="size-8" />}
            title="No agents match"
            description="Clear the filters, or import the workbook to populate the CRM."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-left">
                <tr>
                  <Th className="w-16">Pri</Th>
                  <Th>Agent</Th>
                  <Th className="hidden md:table-cell">Brokerage</Th>
                  <Th>Phone</Th>
                  <Th className="hidden lg:table-cell">Jobs</Th>
                  <Th className="hidden lg:table-cell">Revenue</Th>
                  <Th className="hidden sm:table-cell">Status</Th>
                  <Th className="hidden xl:table-cell">Last touch</Th>
                  <Th className="hidden md:table-cell">Owner</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.map((a) => {
                  const tone = priorityTone(a.priority);
                  return (
                    <tr key={a.id} className="hover:bg-[var(--surface-2)]">
                      <Td>
                        <Badge
                          tone={
                            tone === "high" ? "brand" : tone === "medium" ? "info" : "neutral"
                          }
                        >
                          {Math.round(a.priority)}
                        </Badge>
                      </Td>
                      <Td>
                        <Link
                          to={`/agents/${a.id}`}
                          className="font-medium hover:text-brand-600 hover:underline"
                        >
                          {a.name}
                        </Link>
                        {a.do_not_contact && (
                          <Badge tone="danger" className="ml-2">
                            DNC
                          </Badge>
                        )}
                      </Td>
                      <Td className="muted hidden max-w-48 md:table-cell">
                        <div className="truncate">{a.brokerage ?? "—"}</div>
                        {a.office && (
                          <div className="truncate text-xs opacity-70">{a.office}</div>
                        )}
                      </Td>
                      <Td className="nums whitespace-nowrap">{fmtPhone(a.phone)}</Td>
                      <Td className="nums hidden lg:table-cell">{a.lifetime_jobs}</Td>
                      <Td className="nums hidden lg:table-cell">
                        {fmtMoney(a.lifetime_revenue)}
                      </Td>
                      <Td className="hidden sm:table-cell">
                        <span className="muted text-xs">{a.relationship_status}</span>
                      </Td>
                      <Td className="muted hidden whitespace-nowrap text-xs xl:table-cell">
                        {a.last_touch ? fmtDate(a.last_touch) : "never"}
                      </Td>
                      <Td className="hidden md:table-cell">
                        {a.owner_name && (
                          <Badge tone={a.owner_name === "Andrew" ? "brand" : "info"}>
                            {a.owner_name}
                          </Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
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
