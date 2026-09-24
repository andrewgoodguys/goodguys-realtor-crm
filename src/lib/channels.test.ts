import { describe, expect, it } from "vitest";
import { channelVerb } from "./cadence";
import { CONTACT_CHANNELS, type Channel } from "./types";

/** Every channel `touches.channel` accepts, as 0015 leaves the constraint.
 *  Kept as a literal rather than derived from the type, so adding a channel in
 *  one place and forgetting the other shows up here. */
const ALL: Channel[] = ["call", "text", "email", "letter", "note", "meeting"];

describe("channels", () => {
  it("says every channel out loud, including letter", () => {
    for (const c of ALL) {
      const said = channelVerb(c);
      expect(said, `${c} has no wording`).not.toBe("Step");
      expect(said.length).toBeGreaterThan(0);
    }
    expect(channelVerb("letter")).toBe("Letter");
  });

  // A note records something; it does not reach anybody. Counting one toward a
  // weekly contact target would let the number be met without contacting a
  // single agent, which is the one way this feature could lie.
  it("counts every channel but note toward a contact target", () => {
    expect(CONTACT_CHANNELS).not.toContain("note");
    for (const c of ALL.filter((x) => x !== "note")) {
      expect(CONTACT_CHANNELS, `${c} should count as a contact`).toContain(c);
    }
  });

  // Mirrors public.is_contact_channel(). If the two ever disagree, the
  // dashboard explains a number the database did not produce.
  it("has one contact channel for each non-note channel, and no extras", () => {
    expect([...CONTACT_CHANNELS].sort()).toEqual(
      ALL.filter((c) => c !== "note").sort(),
    );
  });
});
