import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, Handshake, Search, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  UNASSIGNED,
  useAssignPartners,
  usePartnerCounts,
  usePartners,
  usePeople,
  useReferralTotals,
  useUnlinkedReferrers,
} from "@/hooks/useData";
import { isMissingSchema } from "@/lib/supabase";
import { fmtDate, fmtMoney, fmtPhone } from "@/lib/format";
import {
  PARTNER_TYPES,
  type Partner,
  type PartnerType,
  type Person,
  type ReferralTotal,
} from "@/lib/types";
import { ReferredCell } from "@/components/Referred";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
  cn,
} from "@/components/ui";

const MINE = "__mine__";
const REFERRED = "referred";
type Tab = PartnerType | typeof REFERRED;

/** Lenders, organizers, insurance agents and the rest — one page, one tab per
 *  list. A nav item each would not fit the phone bar (see NAV in App.tsx), and
 *  the four are worked the same way, so they share a table. */
export default function Partners() {
  const { owner } = useAuth();
  // Tab and owner in the URL, so a link can land on "my organizers".
  const [params, setParams] = useSearchParams();
  // "Referred us" is first and the default: partners who have actually sent us
  // a job, of any type. The researched lists follow.
  const tab: Tab =
    PARTNER_TYPES.find((t) => t.key === params.get("type"))?.key ?? REFERRED;
  const ownerFilter = params.get("owner") ?? "";
  const [search, setSearch] = useState("");

  const people = usePeople().data ?? [];
  const counts = usePartnerCounts().data ?? {};
  const referrals = useReferralTotals().data;
  const assign = useAssignPartners();

  const resolvedOwner =
    ownerFilter === MINE ? (owner ?? undefined) : ownerFilter || undefined;
  const referredIds = referrals ? [...referrals.byPartner.keys()] : [];
  const { data, isLoading, error } = usePartners(
    tab === REFERRED
      ? { ids: referredIds, search, owner: resolvedOwner }
      : { type: tab, search, owner: resolvedOwner },
  );
  const rows =
    tab === REFERRED
      ? [...(data ?? [])].sort(
          (a, b) =>
            (referrals?.byPartner.get(b.id)?.referred_revenue ?? 0) -
            (referrals?.byPartner.get(a.id)?.referred_revenue ?? 0),
        )
      : (data ?? []);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const tabs = [
    { key: REFERRED, label: "Referred us", short: "Referred", count: referrals?.byPartner.size },
    ...PARTNER_TYPES.map((t) => ({ ...t, count: counts[t.key] })),
  ];
  const label = tabs.find((t) => t.key === tab)!.label;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Partners</h1>
          <p className="muted text-sm">
            {tab === REFERRED
              ? "Partners who have sent us moves · from SmartMoving's Affiliate Name · most revenue first"
              : "Researched referral sources outside real estate · ranked by volume, then reviews"}
          </p>
        </div>
        {owner && ownerFilter !== MINE && (
          <Button size="sm" onClick={() => setParam("owner", MINE)}>
            <Users className="size-4" />
            Mine
          </Button>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Partner lists"
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--border)]"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tab}
            onClick={() => setParam("type", t.key === REFERRED ? "" : t.key)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.key === tab
                ? "border-brand-600 text-brand-700 dark:text-brand-300"
                : "muted border-transparent hover:text-[var(--text)]",
            )}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
            {t.count != null && (
              <span className="nums ml-1.5 text-xs opacity-70">{t.count}</span>
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
              placeholder="Name, company, city, phone…"
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
              icon={<Handshake className="size-8" />}
              title="Waiting on migration 0017"
              description="The partners table isn't in the database yet. Run supabase db push, then reload."
            />
          </Card>
        ) : (
          <ErrorState error={error} />
        )
      ) : isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Handshake className="size-8" />}
            title={tab === REFERRED ? "No partner referrals yet" : `No ${label.toLowerCase()} match`}
            description={
              tab === REFERRED
                ? "A partner shows here once a SmartMoving job names them as its Affiliate."
                : "Clear the filters, or load the researched list with scripts/load_partners.py."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((p) => (
              <PartnerRow
                key={p.id}
                partner={p}
                referral={referrals?.byPartner.get(p.id)}
                showType={tab === REFERRED}
                people={people}
                me={owner}
                busy={assign.isPending}
                onAssign={(to) => assign.mutate({ ids: [p.id], owner: to })}
              />
            ))}
          </ul>
        </Card>
      )}

      {tab === REFERRED && <UnlinkedReferrers />}
    </div>
  );
}

/** Affiliate names in SmartMoving that are not linked to anyone yet, so their
 *  referrals are counted nowhere. The weekly run links what it can; this is
 *  what is left for a person to say who it is. */
function UnlinkedReferrers() {
  const { data } = useUnlinkedReferrers();
  if (!data?.length) return null;
  return (
    <Card>
      <CardHeader
        title="Not linked to anyone yet"
        subtitle="SmartMoving referrers the CRM can't match to an agent or partner. Their moves aren't counted until they are."
      />
      <ul className="divide-y divide-[var(--border)]">
        {data.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <span>
              {r.name.replace(/^\*/, "")}
              {r.name.startsWith("*") && (
                <Badge tone="warn" className="ml-2">
                  fee
                </Badge>
              )}
            </span>
            <span className="nums muted text-xs">
              {r.moves} moves · {fmtMoney(r.revenue)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PartnerRow({
  partner: p,
  referral,
  showType,
  people,
  me,
  busy,
  onAssign,
}: {
  partner: Partner;
  referral: ReferralTotal | undefined;
  /** On "Referred us", which list they came from instead of a rank on it. */
  showType: boolean;
  people: Person[];
  me: string | null;
  busy: boolean;
  onAssign: (owner: string | null) => void;
}) {
  // A person's name leads when there is one; otherwise the business does.
  const headline = p.person_name ?? p.company ?? "—";
  const sub = [p.person_name ? p.company : null, p.title, p.city].filter(Boolean).join(" · ");
  const known = people.some((x) => x.name === p.owner_name);
  const site = p.website ? p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {!showType && (
            <span className="nums muted w-8 shrink-0 pt-0.5 text-right text-sm">
              {p.rank ?? "—"}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-medium">
              <Link to={`/partners/${p.id}`} className="hover:text-brand-600 hover:underline">
                {headline}
              </Link>
              {showType && (
                <Badge tone="info" className="ml-2 align-middle">
                  {PARTNER_TYPES.find((t) => t.key === p.type)?.short ?? p.type}
                </Badge>
              )}
              {p.subtype && (
                <Badge tone="neutral" className="ml-2 align-middle">
                  {p.subtype}
                </Badge>
              )}
              {referral?.pays_fee && (
                <Badge tone="warn" className="ml-2 align-middle">
                  fee
                </Badge>
              )}
            </p>
            {sub && <p className="muted truncate text-sm">{sub}</p>}
            {referral && (
              <p className="mt-1 text-sm">
                <ReferredCell total={referral} />
                {referral.last_referral && (
                  <span className="muted ml-2 text-xs">last {fmtDate(referral.last_referral)}</span>
                )}
              </p>
            )}
            {!showType && p.rank_basis && <p className="muted mt-1 text-xs">{p.rank_basis}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {me && !p.owner_name && (
            <Button size="sm" disabled={busy} onClick={() => onAssign(me)}>
              <UserPlus className="size-4" />
              Claim
            </Button>
          )}
          <Select
            aria-label={`Owner of ${headline}`}
            disabled={busy}
            className={cn(
              "h-8 w-36 text-sm",
              !p.owner_name && "text-[var(--text-muted)]",
              p.owner_name === me && "font-semibold",
            )}
            value={p.owner_name ?? ""}
            onChange={(e) => onAssign(e.target.value || null)}
          >
            <option value="">Unclaimed</option>
            {people.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
            {p.owner_name && !known && (
              <option value={p.owner_name}>{p.owner_name} (inactive)</option>
            )}
          </Select>
        </div>
      </div>

      <div
        className={cn(
          "mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm",
          !showType && "pl-11",
        )}
      >
        {p.phone ? (
          <a href={`tel:${p.phone}`} className="nums text-brand-600 hover:underline">
            {fmtPhone(p.phone)}
          </a>
        ) : (
          <span className="muted text-xs">no phone</span>
        )}
        {p.email && (
          <a href={`mailto:${p.email}`} className="truncate text-brand-600 hover:underline">
            {p.email}
          </a>
        )}
        {site && (
          <a
            href={p.website!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 truncate text-brand-600 hover:underline"
          >
            {site} <ExternalLink className="size-3" />
          </a>
        )}
        {p.license && <span className="muted text-xs">#{p.license}</span>}
        <span className="muted text-xs">
          {p.last_touch ? `last touch ${fmtDate(p.last_touch)}` : "never contacted"}
        </span>
      </div>
    </li>
  );
}
