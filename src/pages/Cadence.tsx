import { Link } from "react-router-dom";
import {
  CircleCheck,
  Hand,
  Mail,
  Mailbox,
  MessageSquare,
  PhoneCall,
  StickyNote,
  Users,
} from "lucide-react";
import { useOutreachSteps, useSettings } from "@/hooks/useData";
import {
  CADENCE_RULES,
  NO_RESPONSE_PAUSE_DAYS,
  channelVerb,
  describeSequence,
  stepDay,
  type CadenceNumbers,
} from "@/lib/cadence";
import type { Channel, OutreachStep } from "@/lib/types";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Spinner } from "@/components/ui";

const CHANNEL_ICON: Record<Channel, typeof PhoneCall> = {
  call: PhoneCall,
  text: MessageSquare,
  email: Mail,
  letter: Mailbox,
  note: StickyNote,
  meeting: Users,
};

export default function Cadence() {
  const stepsQ = useOutreachSteps();
  const settingsQ = useSettings();

  if (stepsQ.isLoading || settingsQ.isLoading) return <Spinner label="Loading the cadence…" />;
  if (stepsQ.error) return <ErrorState error={stepsQ.error} />;
  if (settingsQ.error) return <ErrorState error={settingsQ.error} />;

  const steps = (stepsQ.data ?? []).filter((s) => s.active);
  const numbers: CadenceNumbers = {
    followUpDays: settingsQ.data?.follow_up_days ?? 30,
    dueWindowDays: settingsQ.data?.due_window_days ?? 7,
    noResponsePauseDays:
      settingsQ.data?.no_response_pause_days ?? NO_RESPONSE_PAUSE_DAYS,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">The outreach cadence</h1>
        <p className="muted text-sm">
          How we work an agent, from the first text to the point we stop.
        </p>
      </div>

      <Card>
        <CardHeader
          title="The intro sequence"
          subtitle={
            steps.length ? describeSequence(steps) : "No steps configured yet"
          }
        />
        {steps.length === 0 ? (
          <EmptyState
            title="No steps"
            description="public.outreach_steps is empty. Migration 0006 seeds the three intro steps."
          />
        ) : (
          <ol className="divide-y divide-[var(--border)]">
            {steps.map((step, i) => (
              <Step key={step.step_number} step={step} previous={steps[i - 1]} />
            ))}
          </ol>
        )}
        <p className="muted border-t border-[var(--border)] px-4 py-3 text-sm">
          Once per agent, ever — not once per move. The wording for each channel
          lives in{" "}
          <Link to="/settings" className="text-brand-600 hover:underline">
            Settings → Templates
          </Link>
          , in one place, so a step never carries its own copy.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="The rules"
          subtitle="From the bottom of the workbook's Outreach Tracker sheet"
        />
        <ol className="divide-y divide-[var(--border)]">
          {CADENCE_RULES.map((rule) => (
            <li key={rule.n} className="flex gap-3 px-4 py-3">
              <span className="muted nums mt-0.5 w-5 shrink-0 text-sm font-semibold">
                {rule.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{rule.title}</span>
                  {rule.enforcement.kind === "automatic" ? (
                    <Badge tone="brand">
                      <CircleCheck className="mr-1 inline size-3" />
                      Automatic
                    </Badge>
                  ) : (
                    <Badge tone="warn">
                      <Hand className="mr-1 inline size-3" />
                      On you
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm">{rule.body(numbers)}</p>
                <p className="muted mt-1 text-xs">
                  {rule.enforcement.kind === "automatic" ? "Enforced by " : "Recorded in "}
                  <code>{rule.enforcement.where}</code>
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="muted border-t border-[var(--border)] px-4 py-3 text-sm">
          <strong>Automatic</strong> means the database or the call list already
          holds you to it. <strong>On you</strong> means nothing does — the rule
          is real, but only because you follow it.
        </p>
      </Card>

      <Card>
        <CardHeader title="The numbers behind it" subtitle="Live, from Settings → Cadence" />
        <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
          <Number
            label="Cool-off after any touch"
            value={`${numbers.followUpDays} days`}
            hint="How long before an agent comes back around"
          />
          <Number
            label="Call-list look-ahead"
            value={`${numbers.dueWindowDays} ${numbers.dueWindowDays === 1 ? "day" : "days"}`}
            hint="How far past today the list reaches"
          />
          <Number
            label="Rest after no response"
            value={`${numbers.noResponsePauseDays} days`}
            hint="Rule 2, once a whole sequence goes unanswered"
          />
        </dl>
      </Card>
    </div>
  );
}

function Step({ step, previous }: { step: OutreachStep; previous?: OutreachStep }) {
  const Icon = step.channel ? CHANNEL_ICON[step.channel] : StickyNote;
  const gap = previous ? step.day_offset - previous.day_offset : 0;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{channelVerb(step.channel)}</span>
          <Badge tone="neutral">Day {stepDay(step)}</Badge>
          {gap > 0 && (
            <span className="muted text-xs">
              {gap} {gap === 1 ? "day" : "days"} after the last step
            </span>
          )}
        </div>
        <p className="muted mt-0.5 text-sm">{step.label}</p>
      </div>
    </li>
  );
}

function Number({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="muted text-xs font-medium uppercase tracking-wide">{label}</dt>
      <dd className="nums mt-0.5 text-lg font-semibold">{value}</dd>
      <p className="muted text-xs">{hint}</p>
    </div>
  );
}
