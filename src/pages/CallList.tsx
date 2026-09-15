import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, MailPlus, MessageSquare, PhoneCall, PhoneOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCopy, useDueThisWeek, useOutreachSteps, useSettings } from "@/hooks/useData";
import { dialable, fmtDate, fmtPhone, isPlaceholder, priorityTone } from "@/lib/format";
import { emailMessage, textMessage } from "@/lib/templates";
import { channelVerb, stepDay } from "@/lib/cadence";
import type { DueThisWeekRow, OutreachStep } from "@/lib/types";
import LogTouchDialog from "@/components/LogTouchDialog";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  cn,
} from "@/components/ui";

/** config.py CONTACT_THIS_WEEK_N — the top slice worth working this week. */
const CONTACT_THIS_WEEK_N = 20;

export default function CallList() {
  const { owner } = useAuth();
  const [scope, setScope] = useState<"mine" | "all">(owner ? "mine" : "all");
  const [showAll, setShowAll] = useState(false);
  const [logging, setLogging] = useState<DueThisWeekRow | null>(null);

  const { data, isLoading, error } = useDueThisWeek(scope === "mine" ? owner : null);
  const coolOff = useSettings().data?.follow_up_days ?? 30;
  const steps = useOutreachSteps().data ?? [];

  // agents.next_step_number is maintained by recompute_touch_schedule(); the
  // step's channel and label are looked up here rather than denormalised onto
  // the agent, so editing a step changes the call list with it.
  const stepFor = (agent: DueThisWeekRow): OutreachStep | undefined =>
    agent.next_step_number == null
      ? undefined
      : steps.find((s) => s.step_number === agent.next_step_number);

  const rows = useMemo(() => {
    if (!data) return [];
    return showAll ? data : data.slice(0, CONTACT_THIS_WEEK_N);
  }, [data, showAll]);

  if (isLoading) return <Spinner label="Loading your call list…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Call list</h1>
          <p className="muted text-sm">
            {data?.length ?? 0} due · highest priority first ·{" "}
            <Link to="/cadence" className="text-brand-600 hover:underline">
              the cadence
            </Link>
          </p>
        </div>

        {owner && (
          <div className="flex rounded-lg border border-[var(--border)] p-0.5">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  scope === s ? "bg-brand-600 text-white" : "muted",
                )}
              >
                {s === "mine" ? `Mine (${owner})` : "Everyone"}
              </button>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Check className="size-8" />}
            title="Nobody is due"
            description={
              scope === "mine"
                ? "Your list is clear. Try Everyone to see what the rest of the team has."
                : `Every agent has been touched inside the ${coolOff}-day cool-off.`
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((agent) => (
            <CallCard
              key={agent.id}
              agent={agent}
              step={stepFor(agent)}
              onLog={() => setLogging(agent)}
            />
          ))}
        </div>
      )}

      {!showAll && (data?.length ?? 0) > CONTACT_THIS_WEEK_N && (
        <Button className="w-full" onClick={() => setShowAll(true)}>
          Show all {data?.length} due
        </Button>
      )}

      <LogTouchDialog
        agent={logging}
        open={Boolean(logging)}
        onClose={() => setLogging(null)}
      />
    </div>
  );
}

function CallCard({
  agent,
  step,
  onLog,
}: {
  agent: DueThisWeekRow;
  step?: OutreachStep;
  onLog: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copyText = useCopy();
  const phone = dialable(agent.phone);
  const tone = priorityTone(agent.priority);

  // Rule 4 is one channel per touch, so exactly one button is the primary one.
  // With no step — sequence finished, or a partner who is off it — that's the
  // call, which is what this list did for everybody before.
  const owed = step?.channel ?? "call";

  const message = useMemo(
    () =>
      textMessage(
        agent.name,
        agent.recent_customer ?? "your client",
        agent.recent_address ?? "their new home",
        agent.recent_role,
        copyText,
      ),
    [agent, copyText],
  );

  const email = useMemo(
    () =>
      emailMessage(agent.name, [
        {
          client_name: agent.recent_customer ?? "your client",
          address: agent.recent_address ?? "their new home",
          side: agent.recent_role,
        },
      ], copyText),
    [agent, copyText],
  );

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/agents/${agent.id}`}
            className="font-semibold hover:text-brand-600 hover:underline"
          >
            {agent.name}
          </Link>
          <p className="muted truncate text-sm">{agent.brokerage ?? "Brokerage unknown"}</p>
          {step && (
            <p className="mt-1">
              <Badge tone="brand">
                Step {step.step_number} · {channelVerb(step.channel)} — day {stepDay(step)}
              </Badge>
            </p>
          )}
        </div>
        <Badge tone={tone === "high" ? "brand" : tone === "medium" ? "info" : "neutral"}>
          {Math.round(agent.priority)}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="col-span-2 flex gap-2">
          <dt className="muted shrink-0">Last move</dt>
          <dd className="truncate">
            {agent.recent_customer ?? "—"}
            {agent.recent_address ? ` · ${agent.recent_address}` : ""}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="muted">Jobs</dt>
          <dd className="nums">{agent.lifetime_jobs}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="muted">Last touch</dt>
          <dd>{agent.last_touch ? fmtDate(agent.last_touch) : "never"}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {phone ? (
          <>
            <Button
              variant={owed === "call" ? "primary" : "secondary"}
              size="sm"
              onClick={() => (window.location.href = `tel:${phone}`)}
            >
              <PhoneCall className="size-4" />
              {fmtPhone(agent.phone)}
            </Button>
            <Button
              variant={owed === "text" ? "primary" : "secondary"}
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
            <PhoneOff className="mr-1 inline size-3" />
            {isPlaceholder(agent.phone) ? "Phone TBD — look up" : "No phone"}
          </Badge>
        )}

        <Button size="sm" onClick={() => void copy("text", message)}>
          <Copy className="size-4" />
          {copied === "text" ? "Copied" : "Copy text"}
        </Button>

        {!isPlaceholder(agent.email) && agent.email && (
          <Button
            variant={owed === "email" ? "primary" : "secondary"}
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

        <Button variant="secondary" size="sm" className="ml-auto" onClick={onLog}>
          Log outreach
        </Button>
      </div>
    </Card>
  );
}
