import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, Plus, Search, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  UNASSIGNED,
  useHiringMeta,
  useHiringPartners,
  usePeople,
  useUpdateHiringPartner,
} from "@/hooks/useData";
import { isMissingSchema } from "@/lib/supabase";
import { fmtDate, fmtPhone } from "@/lib/format";
import { HIRING_TRACKS, type HiringTrack } from "@/lib/types";
import HiringPartnerForm from "@/components/HiringPartnerForm";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
  cn,
} from "@/components/ui";

const MINE = "__mine__";

/** People inside organizations who know people who need work — crew and
 *  management, one tab each, the same way Partners splits its lists. */
export default function HiringPartners() {
  const { owner } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const track: HiringTrack =
    HIRING_TRACKS.find((t) => t.key === params.get("track"))?.key ?? "crew";
  const ownerFilter = params.get("owner") ?? "";
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const people = usePeople().data ?? [];
  const counts = useHiringMeta().data?.counts ?? {};
  const assign = useUpdateHiringPartner();
  const resolvedOwner =
    ownerFilter === MINE ? (owner ?? undefined) : ownerFilter || undefined;
  const { data, isLoading, error } = useHiringPartners({ track, search, owner: resolvedOwner });
  const label = HIRING_TRACKS.find((t) => t.key === track)!.label;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Hiring partners</h1>
          <p className="muted text-sm">
            People in organizations who can send us people looking for work
          </p>
        </div>
        <div className="flex gap-2">
          {owner && ownerFilter !== MINE && (
            <Button size="sm" onClick={() => setParam("owner", MINE)}>
              <Users className="size-4" />
              Mine
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Hiring tracks"
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border)]"
      >
        {HIRING_TRACKS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === track}
            onClick={() => setParam("track", t.key === "crew" ? "" : t.key)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.key === track
                ? "border-brand-600 text-brand-700 dark:text-brand-300"
                : "muted border-transparent hover:text-[var(--text)]",
            )}
          >
            {t.label}
            {counts[t.key] != null && (
              <span className="nums ml-1.5 text-xs opacity-70">{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Search className="muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="Name, organization, kind, city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={ownerFilter} onChange={(e) => setParam("owner", e.target.value)}>
            <option value="">All owners</option>
            {owner && <option value={MINE}>Mine ({owner})</option>}
            <option value={UNASSIGNED}>Unclaimed</option>
            {people
              .filter((p) => p.name !== owner)
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
          </Select>
        </div>
      </Card>

      {assign.error && <ErrorState error={assign.error} />}

      {error ? (
        isMissingSchema(error) ? (
          <Card>
            <EmptyState
              icon={<Briefcase className="size-8" />}
              title="Waiting on migration 0019"
              description="The hiring_partners table isn't in the database yet. Run supabase db push, then reload."
            />
          </Card>
        ) : (
          <ErrorState error={error} />
        )
      ) : isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Briefcase className="size-8" />}
            title={search || ownerFilter ? `No ${label.toLowerCase()} partners match` : `No ${label.toLowerCase()} partners yet`}
            description="Add one with the Add button — name, organization and a phone is enough to start."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {data.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Link to={`/hiring/${h.id}`} className="hover:text-brand-600 hover:underline">
                        {h.person_name}
                      </Link>
                      {h.org_type && (
                        <Badge tone="neutral" className="ml-2 align-middle">
                          {h.org_type}
                        </Badge>
                      )}
                    </p>
                    <p className="muted truncate text-sm">
                      {[h.organization, h.title, h.city].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {owner && !h.owner_name && (
                      <Button
                        size="sm"
                        disabled={assign.isPending}
                        onClick={() => assign.mutate({ ids: [h.id], patch: { owner_name: owner } })}
                      >
                        <UserPlus className="size-4" />
                        Claim
                      </Button>
                    )}
                    <Select
                      aria-label={`Owner of ${h.person_name}`}
                      disabled={assign.isPending}
                      className={cn(
                        "h-8 w-36 text-sm",
                        !h.owner_name && "text-[var(--text-muted)]",
                        h.owner_name === owner && "font-semibold",
                      )}
                      value={h.owner_name ?? ""}
                      onChange={(e) =>
                        assign.mutate({ ids: [h.id], patch: { owner_name: e.target.value || null } })
                      }
                    >
                      <option value="">Unclaimed</option>
                      {people.map((x) => (
                        <option key={x.name} value={x.name}>
                          {x.name}
                        </option>
                      ))}
                      {h.owner_name && !people.some((x) => x.name === h.owner_name) && (
                        <option value={h.owner_name}>{h.owner_name} (inactive)</option>
                      )}
                    </Select>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {h.phone ? (
                    <a href={`tel:${h.phone}`} className="nums text-brand-600 hover:underline">
                      {fmtPhone(h.phone)}
                    </a>
                  ) : (
                    <span className="muted text-xs">no phone</span>
                  )}
                  {h.email && (
                    <a href={`mailto:${h.email}`} className="truncate text-brand-600 hover:underline">
                      {h.email}
                    </a>
                  )}
                  <Badge>{h.relationship_status}</Badge>
                  <span className="muted text-xs">
                    {h.last_touch ? `last touch ${fmtDate(h.last_touch)}` : "never contacted"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && (
        <HiringPartnerForm
          open
          track={track}
          onClose={() => setAdding(false)}
          onSaved={(row) => navigate(`/hiring/${row.id}`)}
        />
      )}
    </div>
  );
}
