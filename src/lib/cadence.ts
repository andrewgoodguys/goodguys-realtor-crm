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
 *
 *  `enforcement` is the honest part. Five of these are applied by the database
 *  as of 0011 — `recompute_touch_schedule()` walks the sequence and applies
 *  rule 2's pause. Rule 6 is not, and says so: nothing stops you sending a
 *  partner a template, it just isn't scheduled. Marking a rule automatic when
 *  it is not is worse than leaving it out, because it tells you the system has
 *  your back on something you are personally carrying.
 */
import type { OutreachStep } from "./types";

/** config.py CONTACT_THIS_WEEK_N — the top slice worth working this week. */
export const CONTACT_THIS_WEEK_N = 20;

/** Rule 2's pause, as a fallback only. It lives in
 *  `settings.no_response_pause_days` since 0011 and is applied by
 *  `recompute_touch_schedule()`; this is what to show while that query is in
 *  flight, so the page never renders the rule with a blank in it. */
export const NO_RESPONSE_PAUSE_DAYS = 90;

export interface CadenceNumbers {
  /** settings.follow_up_days — the gap before an agent comes back around. */
  followUpDays: number;
  /** settings.due_window_days — how far ahead the call list looks. */
  dueWindowDays: number;
  /** settings.no_response_pause_days — rule 2's rest. */
  noResponsePauseDays: number;
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
    body: () =>
      "Every new agent gets one introduction: a text, then a call, then an " +
      "email, on the schedule below. Once per agent, for as long as they are " +
      "an agent — not once per move. The call list names the step that's owed " +
      "and dates it from the first touch, so a late call doesn't push the " +
      "email out behind it.",
    enforcement: { kind: "automatic", where: "recompute_touch_schedule()" },
  },
  {
    n: 2,
    title: "No response ends the sequence",
    body: (v) =>
      `When the full sequence goes out and nothing comes back, the agent is ` +
      `set to "Attempted — no response" and rests ${v.noResponsePauseDays} ` +
      `days. If they answer later they come straight back out of it — the ` +
      `pause is a pause, not a verdict.`,
    enforcement: { kind: "automatic", where: "settings.no_response_pause_days" },
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
    // The statuses in_intro_sequence() excludes. Nothing stops you sending a
    // partner a template by hand — but nothing schedules one either.
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
    case "letter":
      return "Letter";
    case "meeting":
      return "Meet";
    case "note":
      return "Note";
    default:
      return "Step";
  }
}
