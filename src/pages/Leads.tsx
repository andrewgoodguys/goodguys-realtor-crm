import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, MapPinned, Search } from "lucide-react";
import { useLeads } from "@/hooks/useData";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
} from "@/components/ui";

/** Statuses the pipeline writes — see the realtor-pipeline skill, step 7. */
const STATUSES = [
  "Agents found",
  "Sold — buyer's agent not reported",
  "Sold — agents not reported (check manually)",
  "Active listing — recheck next week",
  "Not found on Redfin — recheck next week",
  "No recent sale on record",
  "Address incomplete — manual review",
];

function statusTone(status: string): "brand" | "warn" | "danger" | "neutral" {
  const s = status.toLowerCase();
  if (s.includes("agents found")) return "brand";
  if (s.includes("manual") || s.includes("incomplete")) return "danger";
  if (s.includes("recheck")) return "warn";
  return "neutral";
}

export default function Leads() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { data, isLoading, error } = useLeads({ search, status: status || undefined });

  const needsWork = useMemo(
    () => (data ?? []).filter((l) => /recheck|manual|incomplete/i.test(l.status)).length,
    [data],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="muted text-sm">
          {isLoading ? "…" : `${data?.length ?? 0} addresses`}
          {needsWork > 0 && ` · ${needsWork} need another look`}
        </p>
      </div>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Search className="muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="Address, customer, job #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<MapPinned className="size-8" />}
            title="No leads yet"
            description="The weekly pipeline populates this from closed SmartMoving jobs."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {data.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.house_address ?? "—"}</p>
                    <p className="muted text-sm">
                      {l.customer_name ?? "—"} · {l.job_number ?? "—"} · moved{" "}
                      {fmtDate(l.job_date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {l.agent_role && (
                      <Badge tone={l.agent_role === "listing" ? "brand" : "info"}>
                        {l.agent_role}
                      </Badge>
                    )}
                    <span className="nums muted text-sm">{fmtMoney(l.job_revenue)}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                  {l.sale_date && <span className="muted">sold {fmtDate(l.sale_date)}</span>}
                  {l.agent_id && (
                    <Link
                      to={`/agents/${l.agent_id}`}
                      className="text-brand-600 hover:underline"
                    >
                      view agent
                    </Link>
                  )}
                  {l.redfin_link && (
                    <a
                      href={l.redfin_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-brand-600 hover:underline"
                    >
                      Redfin <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
