/**
 * Outreach copy — a direct port of pipeline/messages.py so the app and the
 * weekly pipeline produce identical wording.
 *
 * GoodGuys voice: warm, confident, human, short sentences, no jargon, never
 * salesy. Always name whether the client was their seller or their buyer —
 * that's what makes it land as a real memory, not a mailshot.
 */
import type { AgentRole } from "./types";

export const SIGNATURE = "Andrew Johnson\nCo-Founder, GoodGuys Concierge Moving & Storage";

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

export function textMessage(
  agentName: string | null,
  clientName: string,
  address: string,
  side: AgentRole | null,
): string {
  return (
    `Hi ${firstName(agentName)} — Andrew with GoodGuys Concierge Moving ` +
    `& Storage in Atlanta. We just moved your ${clientRole(side)} ` +
    `${clientName} ${direction(side)} ${address}. Good day, happy client. ` +
    `If you ever need a mover you can hand off without worrying, ` +
    `we'd like to be that for you.`
  );
}

export function emailMessage(
  agentName: string | null,
  clients: ClientRef[],
): { subject: string; body: string } {
  const c = clients[0];
  const role = clientRole(c.side);
  return {
    subject: `We moved your ${role} ${c.client_name}`,
    body:
      `Hi ${firstName(agentName)},\n\n` +
      `We recently moved your ${role} ${c.client_name} ` +
      `${direction(c.side)} ${c.address}. They finished the day happy.\n\n` +
      `I'll keep this short. When a move goes badly, it lands back on the ` +
      `agent who recommended the mover. We'd like to be the one you can ` +
      `refer with confidence — the crew shows up when we say, the price ` +
      `holds, and your client thanks you afterward.\n\n` +
      `If that's useful, I'm easy to reach and happy to be a resource ` +
      `whether or not it turns into anything.\n\n` +
      SIGNATURE,
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

/** Spoken beats for a call — short sentences, natural pauses, one question. */
export function callScript(agentName: string | null, clients: ClientRef[]): string[] {
  const c = clients[0];
  const role = clientRole(c.side);
  const beats = [
    `Hi ${firstName(agentName)}, this is Andrew with GoodGuys ` +
      `Concierge Moving and Storage here in Atlanta.`,
    `Quick call. We just moved your ${role} ${c.client_name} ` +
      `${direction(c.side)} ${c.address}.`,
    `The day went smoothly and they were happy at the end of it. ` +
      `That's the part I care about.`,
  ];
  if (clients.length > 1) {
    beats.push(
      `That's actually the ${ordinal(clients.length)} client of yours we've moved now.`,
    );
  }
  beats.push(
    `I'm calling because you're the reason that move happened, and ` +
      `we'd like to be the mover you can hand to your next client ` +
      `without thinking twice.`,
    `We make you look good. That's the whole pitch.`,
    `Can I send you our direct line, so you have it when you need it?`,
  );
  return beats;
}
