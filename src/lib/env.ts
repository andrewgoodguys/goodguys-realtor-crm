/**
 * Env values come from `.env` locally and from GitHub Actions secrets in CI.
 * A secret pasted out of a bordered terminal can carry stray spaces or box
 * characters along with it. Those end up in the `apikey` header, where a
 * non-Latin-1 character makes fetch throw "String contains non ISO-8859-1
 * code point" — an error that names nothing useful. Trim the ends, and say
 * plainly what is wrong when something is still in there.
 */
export function cleanEnv(name: string, raw: string | undefined): string {
  const value = (raw ?? "").replace(/^[^\x21-\x7e]+|[^\x21-\x7e]+$/g, "");
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  const bad = value.match(/[^\x21-\x7e]/);
  if (bad) {
    const point = bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    throw new Error(
      `${name} contains ${JSON.stringify(bad[0])} (U+${point}), which cannot be sent ` +
        `in an HTTP header. It was most likely copied along with surrounding terminal ` +
        `output. Re-copy the value on its own and set it again.`,
    );
  }
  return value;
}
