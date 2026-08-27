import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Copy,
  ExternalLink,
  MailPlus,
  MessageSquare,
  PhoneCall,
} from "lucide-react";
import { useAgent, useLeads, useTouches, useUpdateAgent } from "@/hooks/useData";
import { dialable, fmtDate, fmtMoney, fmtPhone, isPlaceholder } from "@/lib/format";
import { callScript, emailMessage, textMessage, type ClientRef } from "@/lib/templates";
import { RELATIONSHIP_STATUSES } from "@/lib/types";
import LogTouchDialog from "@/components/LogTouchDialog";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  Textarea,
  cn,
} from "@/components/ui";

type Tab = "overview" | "script" | "history";

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const agentQ = useAgent(id);
  const leadsQ = useLeads({ agentId: id });
  const touchesQ = useTouches(id);
  const update = useUpdateAgent();

  const [tab, setTab] = useState<Tab>("overview");
  const [logging, setLogging] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const clients = useMemo<ClientRef[]>(
    () =>
      (leadsQ.data ?? []).map((l) => ({
        client_name: l.customer_name ?? "your client",
        address: l.house_address ?? "their new home",
        side: l.agent_role,
      })),
    [leadsQ.data],
  );

  if (agentQ.isLoading) return <Spinner />;
  if (agentQ.error) return <ErrorState error={agentQ.error} />;
  const agent = agentQ.data!;

  const phone = dialable(agent.phone);
  const primary = clients[0] ?? {
    client_name: "your client",
    address: "their new home",
    side: null,
  };
  const message = textMessage(agent.name, primary.client_name, primary.address, primary.side);
  const email = emailMessage(agent.name, [primary]);

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="space-y-4">
      <Link to="/agents" className="muted inline-flex items-center gap-1.5 text-sm hover:underline">
        <ArrowLeft className="size-4" />
        All agents
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{agent.name}</h1>
            <p className="muted text-sm">{agent.brokerage ?? "Brokerage unknown"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="brand">Priority {Math.round(agent.priority)}</Badge>
              {agent.owner_name && <Badge tone="info">{agent.owner_name}</Badge>}
              <Badge>{agent.relationship_status}</Badge>
              {agent.do_not_contact && <Badge tone="danger">DO NOT CONTACT</Badge>}
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
                {fmtPhone(agent.phone)}
                <span className="muted ml-1 text-xs">({agent.phone_type})</span>
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  (window.location.href = `sms:${phone}?&body=${encodeURIComponent(message)}`)
                }
              >
                <MessageSquare className="size-4" />
                Text
              </Button>
            </>
          ) : (
            <Badge tone="warn">
              {isPlaceholder(agent.phone) ? "Phone TBD — look up on GeorgiaMLS" : "No phone"}
            </Badge>
          )}
          {agent.email && !isPlaceholder(agent.email) && (
            <Button
              size="sm"
              onClick={() =>
                (window.location.href = `mailto:${agent.email}?subject=${encodeURIComponent(
                  email.subject,
                )}&body=${encodeURIComponent(email.body)}`)
              }
            >
              <MailPlus className="size-4" />
              Email
            </Button>
          )}
        </div>
      </Card>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["overview", "script", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "border-brand-600 text-brand-700 dark:text-brand-300"
                : "muted border-transparent hover:text-[var(--text)]",
            )}
          >
            {t}
            {t === "history" && touchesQ.data?.length ? ` (${touchesQ.data.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Record" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <Row label="Lifetime jobs" value={String(agent.lifetime_jobs)} />
              <Row label="Lifetime revenue" value={fmtMoney(agent.lifetime_revenue)} />
              <Row label="Most recent job" value={fmtDate(agent.most_recent_job)} />
              <Row label="Last touch" value={agent.last_touch ? fmtDate(agent.last_touch) : "never"} />
              <Row label="Next touch due" value={fmtDate(agent.next_touch_due)} />
              <Row label="Email" value={agent.email ?? "—"} />
            </dl>
            <div className="space-y-3 border-t border-[var(--border)] p-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Relationship status</span>
                <Select
                  value={agent.relationship_status}
                  onChange={(e) =>
                    update.mutate({ id: agent.id, patch: { relationship_status: e.target.value } })
                  }
                >
                  {RELATIONSHIP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Notes</span>
                <Textarea
                  rows={3}
                  value={notes ?? agent.notes ?? ""}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => {
                    if (notes !== null && notes !== (agent.notes ?? "")) {
                      update.mutate({ id: agent.id, patch: { notes } });
                    }
                  }}
                  placeholder="Anything worth remembering before the next call…"
                />
              </label>

              <Button
                variant={agent.do_not_contact ? "secondary" : "danger"}
                size="sm"
                onClick={() =>
                  update.mutate({
                    id: agent.id,
                    patch: { do_not_contact: !agent.do_not_contact },
                  })
                }
              >
                <Ban className="size-4" />
                {agent.do_not_contact ? "Allow contact again" : "Mark do-not-contact"}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Their moves we did"
              subtitle={`${leadsQ.data?.length ?? 0} on record`}
            />
            {leadsQ.isLoading ? (
              <Spinner />
            ) : !leadsQ.data?.length ? (
              <EmptyState title="No linked jobs" />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {leadsQ.data.map((l) => (
                  <li key={l.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{l.customer_name ?? "—"}</p>
                        <p className="muted truncate">{l.house_address ?? "—"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={l.agent_role === "listing" ? "brand" : "info"}>
                          {l.agent_role === "listing" ? "seller" : "buyer"}
                        </Badge>
                        <p className="nums muted mt-1 text-xs">{fmtMoney(l.job_revenue)}</p>
                      </div>
                    </div>
                    <p className="muted mt-1 flex items-center gap-2 text-xs">
                      {l.job_number} · moved {fmtDate(l.job_date)} · sold {fmtDate(l.sale_date)}
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
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "script" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Call script"
              action={
                <Button size="sm" onClick={() => void copy("call", callScript(agent.name, clients.length ? clients : [primary]).join("\n\n"))}>
                  <Copy className="size-4" />
                  {copied === "call" ? "Copied" : "Copy"}
                </Button>
              }
            />
            <ol className="space-y-3 p-4 text-sm">
              {callScript(agent.name, clients.length ? clients : [primary]).map((beat, i) => (
                <li key={i} className="flex gap-3">
                  <span className="muted nums shrink-0 tabular-nums">{i + 1}.</span>
                  <span>{beat}</span>
                </li>
              ))}
            </ol>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Text"
                action={
                  <Button size="sm" onClick={() => void copy("text", message)}>
                    <Copy className="size-4" />
                    {copied === "text" ? "Copied" : "Copy"}
                  </Button>
                }
              />
              <p className="p-4 text-sm">{message}</p>
            </Card>

            <Card>
              <CardHeader
                title="Email"
                subtitle={email.subject}
                action={
                  <Button size="sm" onClick={() => void copy("email", email.body)}>
                    <Copy className="size-4" />
                    {copied === "email" ? "Copied" : "Copy"}
                  </Button>
                }
              />
              <p className="whitespace-pre-wrap p-4 text-sm">{email.body}</p>
            </Card>
          </div>
        </div>
      )}

      {tab === "history" && (
        <Card>
          <CardHeader title="Outreach history" />
          {touchesQ.isLoading ? (
            <Spinner />
          ) : !touchesQ.data?.length ? (
            <EmptyState
              title="No outreach logged"
              description="Log a call, text or email and it lands here."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {touchesQ.data.map((t) => (
                <li key={t.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={t.got_response ? "brand" : "neutral"}>{t.channel}</Badge>
                    {t.outcome && <span className="font-medium">{t.outcome}</span>}
                    {t.got_response && <Badge tone="brand">responded</Badge>}
                    <span className="muted ml-auto text-xs">
                      {t.created_by_email?.split("@")[0]} · {fmtDate(t.occurred_at)}
                    </span>
                  </div>
                  {t.notes && <p className="muted mt-1.5 whitespace-pre-wrap">{t.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <LogTouchDialog
        agent={agent}
        open={logging}
        onClose={() => setLogging(false)}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
