/**
 * Outreach copy.
 *
 * The wording now lives in public.settings so it can be edited from the
 * Settings page, but every function here still works without it: DEFAULT_COPY
 * reproduces exactly what this module hardcoded before, which is what
 * templates.test.ts pins and what pipeline/messages.py mirrors.
 *
 * GoodGuys voice: warm, confident, human, short sentences, no jargon, never
 * salesy. Always name whether the client was their seller or their buyer —
 * that's what makes it land as a real memory, not a mailshot.
 */
import type { AgentRole } from "./types";

/** The editable half of a message. A row of public.settings supplies it. */
export interface Copy {
  signature: string;
  text_template: string;
  email_subject: string;
  email_body: string;
  /** One spoken beat per line. */
  call_script: string;
  /** Extra beat, used only when the agent has sent more than one client. */
  call_script_repeat: string;
}

export const SIGNATURE = "Andrew Johnson\nCo-Founder, GoodGuys Concierge Moving & Storage";

export const DEFAULT_COPY: Copy = {
  signature: SIGNATURE,

  text_template:
    "Hi {{first_name}} — Andrew with GoodGuys Concierge Moving & Storage in " +
    "Atlanta. We just moved your {{client_role}} {{client_name}} {{direction}} " +
    "{{address}}. Good day, happy client. If you ever need a mover you can " +
    "hand off without worrying, we'd like to be that for you.",

  email_subject: "We moved your {{client_role}} {{client_name}}",

  email_body:
    "Hi {{first_name}},\n\n" +
    "We recently moved your {{client_role}} {{client_name}} {{direction}} " +
    "{{address}}. They finished the day happy.\n\n" +
    "I'll keep this short. When a move goes badly, it lands back on the " +
    "agent who recommended the mover. We'd like to be the one you can " +
    "refer with confidence — the crew shows up when we say, the price " +
    "holds, and your client thanks you afterward.\n\n" +
    "If that's useful, I'm easy to reach and happy to be a resource " +
    "whether or not it turns into anything.\n\n" +
    "{{signature}}",

  call_script: [
    "Hi {{first_name}}, this is Andrew with GoodGuys Concierge Moving and " +
      "Storage here in Atlanta.",
    "Quick call. We just moved your {{client_role}} {{client_name}} " +
      "{{direction}} {{address}}.",
    "The day went smoothly and they were happy at the end of it. That's the " +
      "part I care about.",
    "I'm calling because you're the reason that move happened, and we'd like " +
      "to be the mover you can hand to your next client without thinking twice.",
    "We make you look good. That's the whole pitch.",
    "Can I send you our direct line, so you have it when you need it?",
  ].join("\n"),

  call_script_repeat: "That's actually the {{ordinal}} client of yours we've moved now.",
};

/** Every placeholder a template may use, for the Settings page to list. */
export const PLACEHOLDERS = [
  "{{first_name}}",
  "{{client_name}}",
  "{{client_role}}",
  "{{direction}}",
  "{{address}}",
  "{{signature}}",
] as const;

/** Substitutes {{name}} tokens. An unknown token is left as-is, so a typo in
 *  the Settings page shows up in the preview instead of silently vanishing. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole,
  );
}

export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(" ")[0] || "there";
}

/** Listing agent represented the seller (client moved OUT).
 *  Buying agent represented the buyer (client moved IN). */
export function clientRole(side: AgentRole | null | undefined): "seller" | "buyer" {
  return side === "listing" ? "seller" : "buyer";
}

export function direction(side: AgentRole | null | undefined): "out of" | "into" {
  return side === "listing" ? "out of" : "into";
}

export interface ClientRef {
  client_name: string;
  address: string;
  side: AgentRole | null;
}

function clientVars(agentName: string | null, c: ClientRef): Record<string, string> {
  return {
    first_name: firstName(agentName),
    client_name: c.client_name,
    client_role: clientRole(c.side),
    direction: direction(c.side),
    address: c.address,
  };
}

export function textMessage(
  agentName: string | null,
  clientName: string,
  address: string,
  side: AgentRole | null,
  copy: Copy = DEFAULT_COPY,
): string {
  return render(
    copy.text_template,
    clientVars(agentName, { client_name: clientName, address, side }),
  );
}

export function emailMessage(
  agentName: string | null,
  clients: ClientRef[],
  copy: Copy = DEFAULT_COPY,
): { subject: string; body: string } {
  const vars = clientVars(agentName, clients[0]);
  return {
    subject: render(copy.email_subject, vars),
    body: render(copy.email_body, { ...vars, signature: copy.signature }),
  };
}

const ORDINALS: Record<number, string> = {
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
};

function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}

/** Spoken beats for a call — short sentences, natural pauses, one question.
 *  The repeat beat lands after the third, where it did when this was inline. */
export function callScript(
  agentName: string | null,
  clients: ClientRef[],
  copy: Copy = DEFAULT_COPY,
): string[] {
  const vars = clientVars(agentName, clients[0]);
  const beats = copy.call_script
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => render(line, vars));

  if (clients.length > 1) {
    beats.splice(3, 0, render(copy.call_script_repeat, {
      ...vars,
      ordinal: ordinal(clients.length),
    }));
  }
  return beats;
}
