import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Globe, MailPlus, MessageSquare, PhoneCall } from "lucide-react";
import {
  usePartner,
  useReferralTotals,
  useReferredJobs,
  useSubjectTouches,
  useUpdatePartner,
} from "@/hooks/useData";
import { ReferredJobsCard } from "@/components/Referred";
import { ProfileTabs, Row, TouchHistory, WorkControls } from "@/components/ContactProfile";
import LogTouchDialog from "@/components/LogTouchDialog";
import { dialable, fmtDate, fmtMoney, fmtPhone } from "@/lib/format";
import { PARTNER_TYPES } from "@/lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Spinner } from "@/components/ui";

const TABS = ["overview", "history"] as const;

/** A partner's profile — the same shape as an agent's, minus the moves we did
 *  on their sales (partners have none) and the scripted intro sequence. */
export default function PartnerDetail() {
  const { id } = useParams<{ id: string }>();
  const partnerQ = usePartner(id);
  const touchesQ = useSubjectTouches(id ? { partner_id: id } : undefined);
  const referredQ = useReferredJobs({ partnerId: id });
  const referral = useReferralTotals().data?.byPartner.get(id ?? "");
  const update = useUpdatePartner();

  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const [logging, setLogging] = useState(false);

  if (partnerQ.isLoading) return <Spinner />;
  if (partnerQ.error) return <ErrorState error={partnerQ.error} />;
  const p = partnerQ.data!;

  const name = p.person_name ?? p.company ?? "—";
  const type = PARTNER_TYPES.find((t) => t.key === p.type);
  const phone = dialable(p.phone);

  return (
    <div className="space-y-4">
      <Link
        to={`/partners?type=${p.type}`}
        className="muted inline-flex items-center gap-1.5 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" />
        {type?.label ?? "Partners"}
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{name}</h1>
            <p className="muted text-sm">
              {[p.person_name ? p.company : null, p.title, p.city].filter(Boolean).join(" · ") ||
                type?.label}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="info">{type?.short ?? p.type}</Badge>
              {p.subtype && <Badge>{p.subtype}</Badge>}
              {referral && referral.referred_jobs > 0 && (
                <Badge tone="brand">
                  Referred us {referral.referred_jobs} · {fmtMoney(referral.referred_revenue)}
                </Badge>
              )}
              {referral?.pays_fee && <Badge tone="warn">Referral fee</Badge>}
              {p.owner_name && <Badge tone="info">{p.owner_name}</Badge>}
              <Badge>{p.relationship_status}</Badge>
              {p.do_not_contact && <Badge tone="danger">DO NOT CONTACT</Badge>}
            </div>
          </div>
          <Button variant="primary" onClick={() => setLogging(true)}>
            Log outreach
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {phone ? (
            <>
              <Button size="sm" onClick={() => (window.location.href = `tel:${phone}`)}>
                <PhoneCall className="size-4" />
                {fmtPhone(p.phone)}
              </Button>
              <Button size="sm" onClick={() => (window.location.href = `sms:${phone}`)}>
                <MessageSquare className="size-4" />
                Text
              </Button>
            </>
          ) : (
            <Badge tone="warn">No phone</Badge>
          )}
          {p.email && (
            <Button size="sm" onClick={() => (window.location.href = `mailto:${p.email}`)}>
              <MailPlus className="size-4" />
              Email
            </Button>
          )}
          {p.website && (
            <Button size="sm" onClick={() => window.open(p.website!, "_blank", "noreferrer")}>
              <Globe className="size-4" />
              Website
            </Button>
          )}
        </div>
      </Card>

      <ProfileTabs tabs={TABS} tab={tab} onTab={setTab} historyCount={touchesQ.data?.length} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Record" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <Row label="Last touch" value={p.last_touch ? fmtDate(p.last_touch) : "never"} />
              <Row label="Next touch due" value={p.next_touch_due ? fmtDate(p.next_touch_due) : "—"} />
              <Row label="Email" value={p.email ?? "—"} />
              <Row label="City" value={p.city ?? "—"} />
              {p.license && <Row label="License" value={p.license} />}
              {p.volume && <Row label="Volume" value={p.volume} />}
              {p.review_count != null && (
                <Row
                  label="Reviews"
                  value={`${p.review_count}${p.rating != null ? ` · ${p.rating}★` : ""}`}
                />
              )}
              {p.rank != null && <Row label="Research rank" value={`#${p.rank}`} />}
            </dl>
            {(p.rank_basis || p.source_urls.length > 0) && (
              <div className="space-y-1 border-t border-[var(--border)] px-4 py-3 text-xs">
                {p.rank_basis && <p className="muted">{p.rank_basis}</p>}
                {p.source_urls.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 truncate text-brand-600 hover:underline"
                  >
                    {u.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink className="size-3 shrink-0" />
                  </a>
                ))}
              </div>
            )}
            <WorkControls row={p} onPatch={(patch) => update.mutate({ id: p.id, patch })} />
          </Card>

          <ReferredJobsCard jobs={referredQ.data} loading={referredQ.isLoading} total={referral} />
        </div>
      )}

      {tab === "history" && <TouchHistory touches={touchesQ.data} loading={touchesQ.isLoading} />}

      {update.error && <ErrorState error={update.error} />}

      <LogTouchDialog
        subject={{ touch: { partner_id: p.id }, name }}
        open={logging}
        onClose={() => setLogging(false)}
      />
    </div>
  );
}
