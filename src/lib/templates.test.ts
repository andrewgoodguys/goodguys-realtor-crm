import { describe, expect, it } from "vitest";
import {
  DEFAULT_COPY,
  callScript,
  clientRole,
  direction,
  emailMessage,
  firstName,
  render,
  textMessage,
  type Copy,
} from "./templates";
import { dialable, fmtPhone, isPlaceholder, priorityTone } from "./format";

describe("voice", () => {
  it("uses the first name, and a safe fallback", () => {
    expect(firstName("Dana Reed")).toBe("Dana");
    expect(firstName("  BONNEAU ANSLEY III ")).toBe("BONNEAU");
    expect(firstName(null)).toBe("there");
    expect(firstName("   ")).toBe("there");
  });

  it("maps the agent's side to the client they represented", () => {
    // Listing agent represented the seller, who moved OUT.
    expect(clientRole("listing")).toBe("seller");
    expect(direction("listing")).toBe("out of");
    // Buying agent represented the buyer, who moved IN.
    expect(clientRole("buying")).toBe("buyer");
    expect(direction("buying")).toBe("into");
  });

  it("names the client and the side in the text", () => {
    const msg = textMessage("Dana Reed", "Lyle Maurer", "101 Henderson Street", "listing");
    expect(msg).toContain("Hi Dana");
    expect(msg).toContain("your seller Lyle Maurer out of 101 Henderson Street");
    expect(msg).not.toContain("undefined");
  });

  it("builds a subject that reads like a memory, not a mailshot", () => {
    const { subject, body } = emailMessage("Dana Reed", [
      { client_name: "Lyle Maurer", address: "101 Henderson Street", side: "buying" },
    ]);
    expect(subject).toBe("We moved your buyer Lyle Maurer");
    expect(body).toContain("Andrew Johnson");
  });

  it("counts repeat clients in the call script", () => {
    const clients = [
      { client_name: "A", address: "1 Oak St", side: "listing" as const },
      { client_name: "B", address: "2 Oak St", side: "listing" as const },
      { client_name: "C", address: "3 Oak St", side: "listing" as const },
    ];
    expect(callScript("Dana", clients).join(" ")).toContain("third client of yours");
    // A single client gets no repeat-count beat at all.
    expect(callScript("Dana", clients.slice(0, 1)).join(" ")).not.toContain("client of yours we");
  });
});

describe("phones", () => {
  it("dials 10-digit numbers and strips a leading country code", () => {
    expect(dialable("678-618-0398")).toBe("6786180398");
    expect(dialable("(404) 555-0100")).toBe("4045550100");
    expect(dialable("16786180398")).toBe("6786180398");
  });

  it("refuses anything that is not a real number", () => {
    // "TBD — lookup" is the pipeline's honest answer; it must never dial.
    expect(dialable("TBD — lookup")).toBeNull();
    expect(dialable("")).toBeNull();
    expect(dialable(null)).toBeNull();
    expect(dialable("555-0100")).toBeNull();
  });

  it("formats for display without inventing digits", () => {
    expect(fmtPhone("6786180398")).toBe("(678) 618-0398");
    expect(fmtPhone("TBD — lookup")).toBe("TBD — lookup");
    expect(fmtPhone(null)).toBe("—");
  });

  it("recognises placeholders", () => {
    expect(isPlaceholder("TBD — lookup")).toBe(true);
    expect(isPlaceholder("tbd")).toBe(true);
    expect(isPlaceholder(null)).toBe(true);
    expect(isPlaceholder("dana@compass.com")).toBe(false);
  });
});

describe("priority", () => {
  it("bands the score", () => {
    // Priority tops out at 90 in practice (30+25+25+10), not 100.
    expect(priorityTone(79.8)).toBe("high");
    expect(priorityTone(50)).toBe("medium");
    expect(priorityTone(20)).toBe("low");
  });
});

describe("editable copy", () => {
  it("substitutes placeholders and leaves unknown ones visible", () => {
    // Silently dropping a typo would make it look like the field saved fine.
    expect(render("Hi {{first_name}}, re {{nope}}", { first_name: "Dana" })).toBe(
      "Hi Dana, re {{nope}}",
    );
  });

  it("uses copy from settings in place of the built-in wording", () => {
    const copy: Copy = {
      ...DEFAULT_COPY,
      text_template: "{{first_name}}: we moved your {{client_role}} to {{address}}.",
    };
    expect(textMessage("Dana Reed", "the Whitfields", "412 Ashwood Ln", "listing", copy)).toBe(
      "Dana: we moved your seller to 412 Ashwood Ln.",
    );
  });

  it("closes a rewritten email with the configured signature", () => {
    const copy: Copy = {
      ...DEFAULT_COPY,
      email_body: "Hi {{first_name}}.\n\n{{signature}}",
      signature: "Avery",
    };
    const { body } = emailMessage(
      "Dana Reed",
      [{ client_name: "the Whitfields", address: "412 Ashwood Ln", side: "buying" }],
      copy,
    );
    expect(body).toBe("Hi Dana.\n\nAvery");
  });

  it("keeps the repeat-client beat in fourth place after a rewrite", () => {
    const copy: Copy = { ...DEFAULT_COPY, call_script: "one\ntwo\nthree\nfour" };
    const clients = [
      { client_name: "A", address: "1 St", side: "listing" as const },
      { client_name: "B", address: "2 St", side: "listing" as const },
    ];
    const beats = callScript("Dana Reed", clients, copy);
    expect(beats[3]).toBe("That's actually the second client of yours we've moved now.");
    expect(beats[4]).toBe("four");
  });

  it("drops blank lines so a stray newline does not become an empty beat", () => {
    const copy: Copy = { ...DEFAULT_COPY, call_script: "one\n\n  \ntwo\n" };
    expect(
      callScript("Dana", [{ client_name: "A", address: "1 St", side: null }], copy),
    ).toEqual(["one", "two"]);
  });
});
