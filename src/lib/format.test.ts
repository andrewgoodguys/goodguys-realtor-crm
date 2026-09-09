import { describe, expect, it } from "vitest";
import { smartMovingLink } from "./format";

// The real pair, read out of the app on 2026-09-09 by searching job 1981-1.
// The two GUIDs are different records: the first addresses the opportunity,
// the second picks the job within it.
const OPPORTUNITY = "b1ae0797-3125-44c3-ae33-b48a0118f15a";
const JOB = "c27dfdca-45bb-4603-a967-b48a0118f162";

describe("smartMovingLink", () => {
  it("builds the opportunity URL with the job selected", () => {
    expect(smartMovingLink(OPPORTUNITY, JOB)).toBe(
      `https://app.smartmoving.com/opportunities/${OPPORTUNITY}/sales?jobId=${JOB}`,
    );
  });

  it("drops the jobId when there isn't one", () => {
    expect(smartMovingLink(OPPORTUNITY, null)).toBe(
      `https://app.smartmoving.com/opportunities/${OPPORTUNITY}/sales`,
    );
    expect(smartMovingLink(OPPORTUNITY)).toBe(
      `https://app.smartmoving.com/opportunities/${OPPORTUNITY}/sales`,
    );
  });

  // Every job starts with sm_opportunity_id null and stays that way until the
  // backfill resolves its quote. A guessed link lands on "The specified
  // opportunity was not found", so there must be no link at all.
  it("returns null without an opportunity id", () => {
    expect(smartMovingLink(null, JOB)).toBeNull();
    expect(smartMovingLink(undefined, JOB)).toBeNull();
    expect(smartMovingLink("", JOB)).toBeNull();
    expect(smartMovingLink("   ", JOB)).toBeNull();
  });

  it("trims and escapes rather than trusting the column", () => {
    expect(smartMovingLink(` ${OPPORTUNITY} `, ` ${JOB} `)).toBe(
      `https://app.smartmoving.com/opportunities/${OPPORTUNITY}/sales?jobId=${JOB}`,
    );
    expect(smartMovingLink("a/b", "c d")).toBe(
      "https://app.smartmoving.com/opportunities/a%2Fb/sales?jobId=c%20d",
    );
  });
});
