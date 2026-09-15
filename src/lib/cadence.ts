/** The outreach cadence, as something the app can show you.
 *
 *  These seven rules started as footnotes typed into the `Agent Name` column at
 *  the bottom of the workbook's Outreach Tracker sheet — which is how eight of
 *  them ended up in `public.agents` looking like realtors until 0006 moved them
 *  out. Rule 1 became three rows in `public.outreach_steps`. Rules 2-7 are
 *  policy, not a sequence, and they became a comment in that migration and a
 *  section of the README: both places you have to already know about.
 *
 *  So they live here too, where the people following them can read them. The
 *  wording is the workbook's; the numbers are not baked in — they are read from
 *  `public.settings` and `public.outreach_steps` at render time, so a rule
 *  cannot quietly disagree with the cadence the database is running.
 */
import type { OutreachStep } from "./types";

/** config.py CONTACT_THIS_WEEK_N — the top slice worth working this week. */
export const CONTACT_THIS_WEEK_N = 20;

/** Rule 2's pause after a sequence goes unanswered. Unlike follow_up_days this
 *  is not in `public.settings` and nothing enforces it — `sync_agent_touch()`
 *  schedules every agent the same way regardless of how the last sequence
 *  ended. Stated here as the number to hold yourself to, and flagged on the
 *  page as manual, rather than implied to be automatic. */
export const NO_RESPONSE_PAUSE_DAYS = 90;

export interface CadenceNumbers {
  /** settings.follow_up_days — the gap before an agent comes back around. */
  followUpDays: number;
  /** settings.due_window_days — how far ahead the call list looks. */
  dueWindowDays: number;
}

export type Enforcement =
  | { kind: "automatic"; where: string }
  | { kind: "manual"; where: string };

export interface CadenceRule {
  n: number;
  title: string;
  body: (v: CadenceNumbers) => string;
  enforcement: Enforcement;
}

export const CADENCE_RULES: CadenceRule[] = [
  {
    n: 1,
    title: "Intro sequence, once ever",
    body: (v) =>
      "Every new agent gets one introduction: a text, then a call, then an " +
      "email, on the schedule below. Once per agent, for as long as they are " +
      "an agent — not once per move. Track it yourself for now: the call list " +
      `schedules every agent the same ${v.followUpDays} days out and does not ` +
      "yet know which step of the sequence anyone is on.",
    // The steps are data, but nothing reads them to decide when an agent is
    // next due — sync_agent_touch() applies follow_up_days to everybody alike.
    // Calling this automatic would be the worst kind of wrong: it would say
    // the system is walking you through a sequence you are actually carrying.
    enforcement: { kind: "manual", where: "public.outreach_steps" },
  },
  {
    n: 2,
    title: "No response ends the sequence",
    body: () =>
      `If the full sequence goes unanswered, set the agent to "Attempted — no ` +
      `response" and leave them alone for ${NO_RESPONSE_PAUSE_DAYS} days ` +
      `before any new touch.`,
    enforcement: { kind: "manual", where: "nothing schedules this pause" },
  },
  {
    n: 3,
    title: "A new closed job earns one touch",
    body: (v) =>
      "When an agent turns up on a newly closed job, that is worth one " +
      "congratulatory touch — and only if the last touch was at least " +
      `${v.followUpDays} days ago.`,
    enforcement: { kind: "automatic", where: "settings.follow_up_days" },
  },
  {
    n: 4,
    title: "One channel per touch",
    body: () =>
      "Never call, text and email the same agent on the same day. Pick the " +
      "channel the step calls for and log it.",
    enforcement: { kind: "automatic", where: "one touches row per contact" },
  },
  {
    n: 5,
    title: "DO NOT CONTACT is permanent",
    body: () =>
      "An agent marked do-not-contact stays that way. Weekly runs skip them " +
      "and they never appear on a call list.",
    enforcement: { kind: "automatic", where: "agents.do_not_contact" },
  },
  {
    n: 6,
    title: "Partners get no templates",
    body: () =>
      "Agents in conversation, and referral partners, are relationship-driven. " +
      "Write to them as yourself — the templates are for introductions.",
    enforcement: { kind: "manual", where: "agents.relationship_status" },
  },
  {
    n: 7,
    title: "The week is the top slice",
    body: (v) =>
      `Priority is set by the weekly run. The call list is the top ` +
      `${CONTACT_THIS_WEEK_N} uncontacted agents, due now or within ` +
      `${v.dueWindowDays} ${v.dueWindowDays === 1 ? "day" : "days"}.`,
    enforcement: { kind: "automatic", where: "agents.priority, due_this_week" },
  },
];

/** "Day 1" as a person counts it. `day_offset` counts days *after* the first
 *  touch, so the workbook's day 1 / 4 / 7 is stored as 0 / 3 / 6. One place
 *  does the re-indexing, because getting it wrong shifts the whole sequence by
 *  a day and nothing would complain. */
export function stepDay(step: Pick<OutreachStep, "day_offset">): number {
  return step.day_offset + 1;
}

/** "Text day 1 → Call day 4 → Email day 7" — the sequence in one line, built
 *  from the rows rather than restated, so editing a step changes this too. */
export function describeSequence(steps: OutreachStep[]): string {
  const active = steps.filter((s) => s.active).sort((a, b) => a.day_offset - b.day_offset);
  if (active.length === 0) return "No steps configured.";
  return active
    .map((s) => `${channelVerb(s.channel)} day ${stepDay(s)}`)
    .join(" → ");
}

/** The channel as you would say it out loud. A step with no channel is a
 *  reminder rather than a message, and says so. */
export function channelVerb(channel: OutreachStep["channel"]): string {
  switch (channel) {
    case "text":
      return "Text";
    case "call":
      return "Call";
    case "email":
      return "Email";
    case "meeting":
      return "Meet";
    case "note":
      return "Note";
    default:
      return "Step";
  }
}
