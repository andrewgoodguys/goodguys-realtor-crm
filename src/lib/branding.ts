/**
 * Applies the accent colour from Settings over the brand scale in index.css.
 *
 * The stylesheet defines --color-brand-50 … 900 as a hand-tuned green ramp.
 * Rather than ask anyone to pick ten colours, we take the one they picked as
 * the 600 step and rebuild the rest around it with color-mix, at roughly the
 * ratios the original ramp uses. Close enough to look deliberate, and it keeps
 * every existing `bg-brand-100` / `text-brand-700` class working untouched.
 */

/** Percentage of the accent in each step; the remainder is white above the
 *  600 step and black below it. 600 is the accent itself. */
const RAMP: Array<[step: number, pct: number, toward: "white" | "black"]> = [
  [50, 6, "white"],
  [100, 16, "white"],
  [200, 34, "white"],
  [300, 55, "white"],
  [400, 76, "white"],
  [500, 90, "white"],
  [600, 100, "white"],
  [700, 85, "black"],
  [800, 70, "black"],
  [900, 58, "black"],
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function applyAccent(accent: string | null | undefined): void {
  const root = document.documentElement;

  // A malformed value would otherwise poison every brand colour at once.
  if (!accent || !HEX.test(accent)) {
    for (const [step] of RAMP) root.style.removeProperty(`--color-brand-${step}`);
    return;
  }

  for (const [step, pct, toward] of RAMP) {
    root.style.setProperty(
      `--color-brand-${step}`,
      pct === 100 ? accent : `color-mix(in srgb, ${accent} ${pct}%, ${toward})`,
    );
  }
}
