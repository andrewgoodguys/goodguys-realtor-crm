import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, UserPlus, Users, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  UNASSIGNED,
  useAgents,
  useAssignAgents,
  usePeople,
  type AgentFilters,
} from "@/hooks/useData";
import { fmtDate, fmtMoney, fmtPhone, priorityTone } from "@/lib/format";
import { RELATIONSHIP_STATUSES } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
} from "@/components/ui";

/** The owner filter's own value for "whoever I am". Resolved to a name before
 *  it reaches the query, so the URL-ish filter state does not go stale the
 *  moment somebody is renamed in Settings. */
const MINE = "__mine__";

export default function Agents() {
  const { owner } = useAuth();
  // In the URL rather than in state, so "12 agents have no owner" on the
  // dashboard can link straight to the twelve of them.
  const [params, setParams] = useSearchParams();
  const ownerFilter = params.get("owner") ?? "";
  const [filters, setFilters] = useState<AgentFilters>({ includeDnc: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const people = usePeople().data ?? [];
  const assign = useAssignAgents();

  function setOwnerFilter(next: string) {
    setParams(next ? { owner: next } : {}, { replace: true });
    setSelected(new Set());
  }

  const resolvedOwner =
    ownerFilter === MINE ? (owner ?? undefined) : ownerFilter || undefined;
  const { data, isLoading, error } = useAgents({ ...filters, owner: resolvedOwner });

  const set = (patch: Partial<AgentFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(new Set());
  };

  const rows = data ?? [];
  const allSelected = rows.length > 0 && rows.every((a) => selected.has(a.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((a) => a.id)));
  }

  function handOver(to: string | null) {
    assign.mutate(
      { ids: [...selected], owner: to },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agents</h1>
          <p className="muted text-sm">{isLoading ? "…" : `${rows.length} shown`}</p>
        </div>
        {owner && ownerFilter !== MINE && (
          <Button size="sm" onClick={() => setOwnerFilter(MINE)}>
            <Users className="size-4" />
            My agents
          </Button>
        )}
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
          <Select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="">All owners</option>
            {owner && <option value={MINE}>Mine ({owner})</option>}
            <option value={UNASSIGNED}>Unassigned</option>
            {people
              .filter((p) => p.name !== owner)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
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

      {/* Appears only with a selection, so the table is not permanently wearing
          a toolbar for something you do occasionally. */}
      {selectedCount > 0 && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>

          {owner && (
            <Button
              variant="primary"
              size="sm"
              loading={assign.isPending}
              onClick={() => handOver(owner)}
            >
              <UserPlus className="size-4" />
              Assign to me
            </Button>
          )}

          <Select
            className="h-8 max-w-44 text-sm"
            value=""
            disabled={assign.isPending}
            onChange={(e) => {
              if (e.target.value) handOver(e.target.value);
            }}
          >
            <option value="">Assign to…</option>
            {people.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>

          <Button size="sm" loading={assign.isPending} onClick={() => handOver(null)}>
            Unassign
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <X className="size-4" />
            Clear
          </Button>
        </Card>
      )}

      {assign.error && <ErrorState error={assign.error} />}

      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="size-8" />}
            title={
              ownerFilter === UNASSIGNED ? "Every agent has an owner" : "No agents match"
            }
            description={
              ownerFilter === UNASSIGNED
                ? "Nobody is falling through — every active agent is assigned to someone."
                : "Clear the filters, or import the workbook to populate the CRM."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-left">
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      className="size-4 accent-[var(--color-brand-600)]"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </Th>
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
                {rows.map((a) => {
                  const tone = priorityTone(a.priority);
                  const isMine = Boolean(owner) && a.owner_name === owner;
                  return (
                    <tr
                      key={a.id}
                      className={
                        selected.has(a.id)
                          ? "bg-brand-50 dark:bg-brand-950"
                          : "hover:bg-[var(--surface-2)]"
                      }
                    >
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.name}`}
                          className="size-4 accent-[var(--color-brand-600)]"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                        />
                      </Td>
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
                        {a.owner_name ? (
                          <Badge tone={isMine ? "brand" : "info"}>{a.owner_name}</Badge>
                        ) : (
                          <Badge tone="warn">Unassigned</Badge>
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
