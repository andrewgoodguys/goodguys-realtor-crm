import { describe, expect, it } from "vitest";
import { cleanEnv } from "./env";

const KEY = "sb_publishable_hWCZGlD42kkyLc4MrvyNIA_RnCuV4rq";

describe("cleanEnv", () => {
  it("passes a clean value straight through", () => {
    expect(cleanEnv("VITE_SUPABASE_ANON_KEY", KEY)).toBe(KEY);
  });

  // What was actually pasted into the GitHub Actions secret on 2026-09-01:
  // a leading space, and a trailing space plus the border of the terminal
  // box the key had been printed inside.
  it("strips terminal spill off the ends", () => {
    expect(cleanEnv("VITE_SUPABASE_ANON_KEY", ` ${KEY} │`)).toBe(KEY);
    expect(cleanEnv("VITE_SUPABASE_URL", "\n  https://x.supabase.co\r\n")).toBe(
      "https://x.supabase.co",
    );
  });

  it("names the offending character when it is in the middle", () => {
    expect(() => cleanEnv("VITE_SUPABASE_ANON_KEY", "sb_pub│lishable_x")).toThrow(
      /U\+2502.*cannot be sent in an HTTP header/s,
    );
  });

  it("reports a missing value as missing, not as a bad character", () => {
    expect(() => cleanEnv("VITE_SUPABASE_URL", undefined)).toThrow(/Missing VITE_SUPABASE_URL/);
    expect(() => cleanEnv("VITE_SUPABASE_URL", "   ")).toThrow(/Missing VITE_SUPABASE_URL/);
  });
});
