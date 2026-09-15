import { describe, expect, it } from "vitest";
import {
  CADENCE_RULES,
  CONTACT_THIS_WEEK_N,
  NO_RESPONSE_PAUSE_DAYS,
  describeSequence,
  stepDay,
  type CadenceNumbers,
} from "./cadence";
import type { OutreachStep } from "./types";

/** The three rows migration 0006 seeds into public.outreach_steps, verbatim.
 *  day_offset counts days after the first touch, so the workbook's day 1/4/7
 *  is stored as 0/3/6 — the off-by-one this file exists to pin down. */
const SEEDED: OutreachStep[] = [
  { step_number: 1, day_offset: 0, channel: "text", label: "Intro text — day 1", body: null, active: true },
  { step_number: 2, day_offset: 3, channel: "call", label: "Intro call — day 4", body: null, active: true },
  { step_number: 3, day_offset: 6, channel: "email", label: "Intro email — day 7", body: null, active: true },
];

const NUMBERS: CadenceNumbers = { followUpDays: 30, dueWindowDays: 7 };

describe("stepDay", () => {
  // Shift this by one and the whole sequence moves a day, silently: no test
  // anywhere else looks at day_offset, and the label is a string nobody reads.
  it("re-indexes day_offset to the day a person would say", () => {
    expect(SEEDED.map(stepDay)).toEqual([1, 4, 7]);
  });
});

describe("describeSequence", () => {
  it("reads back as the workbook wrote it", () => {
    expect(describeSequence(SEEDED)).toBe("Text day 1 → Call day 4 → Email day 7");
  });

  // The workbook was revised on 2026-08-14; an earlier copy ran email first.
  // Order comes from day_offset, not from how the rows arrive.
  it("orders by day, not by the order given", () => {
    const shuffled = [SEEDED[2], SEEDED[0], SEEDED[1]];
    expect(describeSequence(shuffled)).toBe(describeSequence(SEEDED));
  });

  it("leaves out steps that have been turned off", () => {
    const withoutCall = SEEDED.map((s) =>
      s.channel === "call" ? { ...s, active: false } : s,
    );
    expect(describeSequence(withoutCall)).toBe("Text day 1 → Email day 7");
  });

  it("says so rather than rendering an empty line", () => {
    expect(describeSequence([])).toBe("No steps configured.");
  });
});

describe("CADENCE_RULES", () => {
  it("is all seven, numbered as the workbook numbered them", () => {
    expect(CADENCE_RULES.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // The point of rendering the rules from settings is that they cannot drift
  // from the cadence actually running. A hardcoded 30 here would defeat it.
  it("takes its numbers from settings, not from the prose", () => {
    const changed: CadenceNumbers = { followUpDays: 45, dueWindowDays: 1 };
    const rule3 = CADENCE_RULES[2].body(changed);
    expect(rule3).toContain("45 days");
    expect(rule3).not.toContain("30 days");

    const rule7 = CADENCE_RULES[6].body(changed);
    expect(rule7).toContain("1 day");
    expect(rule7).not.toContain("1 days");
  });

  it("states the pause and the weekly slice", () => {
    expect(CADENCE_RULES[1].body(NUMBERS)).toContain(String(NO_RESPONSE_PAUSE_DAYS));
    expect(CADENCE_RULES[6].body(NUMBERS)).toContain(String(CONTACT_THIS_WEEK_N));
  });

  // Rules 1, 2 and 6 are the ones nothing enforces. Marking a rule automatic
  // when it is not is worse than not listing it: it says the system has your
  // back. Rule 1 especially — outreach_steps holds the sequence, but nothing
  // reads it to schedule anything, so the steps are a reference, not a queue.
  // When something does drive them, this list loses the 1.
  it("does not claim a rule is automatic when nothing enforces it", () => {
    const manual = CADENCE_RULES.filter((r) => r.enforcement.kind === "manual");
    expect(manual.map((r) => r.n)).toEqual([1, 2, 6]);
  });
});
