import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Globe, MailPlus, MessageSquare, Pencil, PhoneCall } from "lucide-react";
import { useHiringPartner, useSubjectTouches, useUpdateHiringPartner } from "@/hooks/useData";
import { ProfileTabs, Row, TouchHistory, WorkControls } from "@/components/ContactProfile";
import HiringPartnerForm from "@/components/HiringPartnerForm";
import LogTouchDialog from "@/components/LogTouchDialog";
import { dialable, fmtDate, fmtPhone } from "@/lib/format";
import { HIRING_TRACKS } from "@/lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Spinner } from "@/components/ui";

const TABS = ["overview", "history"] as const;

export default function HiringPartnerDetail() {
  const { id } = useParams<{ id: string }>();
  const hQ = useHiringPartner(id);
  const touchesQ = useSubjectTouches(id ? { hiring_partner_id: id } : undefined);
  const update = useUpdateHiringPartner();

  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState(false);

  if (hQ.isLoading) return <Spinner />;
  if (hQ.error) return <ErrorState error={hQ.error} />;
  const h = hQ.data!;

  const track = HIRING_TRACKS.find((t) => t.key === h.track);
  const phone = dialable(h.phone);

  return (
    <div className="space-y-4">
      <Link
        to={`/hiring${h.track === "crew" ? "" : `?track=${h.track}`}`}
        className="muted inline-flex items-center gap-1.5 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" />
        {track?.label ?? "Hiring partners"}
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{h.person_name}</h1>
            <p className="muted text-sm">
              {[h.title, h.organization, h.city].filter(Boolean).join(" · ") || "—"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="info">{track?.label ?? h.track}</Badge>
              {h.org_type && <Badge>{h.org_type}</Badge>}
              {h.owner_name && <Badge tone="info">{h.owner_name}</Badge>}
              <Badge>{h.relationship_status}</Badge>
              {h.do_not_contact && <Badge tone="danger">DO NOT CONTACT</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button variant="primary" onClick={() => setLogging(true)}>
              Log outreach
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {phone ? (
            <>
              <Button size="sm" onClick={() => (window.location.href = `tel:${phone}`)}>
                <PhoneCall className="size-4" />
                {fmtPhone(h.phone)}
              </Button>
              <Button size="sm" onClick={() => (window.location.href = `sms:${phone}`)}>
                <MessageSquare className="size-4" />
                Text
              </Button>
            </>
          ) : (
            <Badge tone="warn">No phone</Badge>
          )}
          {h.email && (
            <Button size="sm" onClick={() => (window.location.href = `mailto:${h.email}`)}>
              <MailPlus className="size-4" />
              Email
            </Button>
          )}
          {h.website && (
            <Button size="sm" onClick={() => window.open(h.website!, "_blank", "noreferrer")}>
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
              <Row label="Last touch" value={h.last_touch ? fmtDate(h.last_touch) : "never"} />
              <Row label="Next touch due" value={h.next_touch_due ? fmtDate(h.next_touch_due) : "—"} />
              <Row label="Email" value={h.email ?? "—"} />
              <Row label="City" value={h.city ?? "—"} />
              <Row
                label="Added"
                value={`${fmtDate(h.created_at)}${
                  h.created_by_email ? ` · ${h.created_by_email.split("@")[0]}` : ""
                }`}
              />
            </dl>
            <WorkControls
              row={h}
              onPatch={(patch) => update.mutate({ ids: [h.id], patch })}
            />
          </Card>

          <TouchHistory touches={touchesQ.data?.slice(0, 5)} loading={touchesQ.isLoading} />
        </div>
      )}

      {tab === "history" && <TouchHistory touches={touchesQ.data} loading={touchesQ.isLoading} />}

      {update.error && <ErrorState error={update.error} />}

      <LogTouchDialog
        subject={{ touch: { hiring_partner_id: h.id }, name: h.person_name }}
        open={logging}
        onClose={() => setLogging(false)}
      />
      {editing && (
        <HiringPartnerForm open track={h.track} existing={h} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
