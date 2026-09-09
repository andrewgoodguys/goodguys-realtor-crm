import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export function fmtDate(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return fallback;
  }
}

export function fmtRelative(value: string | null | undefined, fallback = "never"): string {
  if (!value) return fallback;
  try {
    return `${formatDistanceToNowStrict(parseISO(value))} ago`;
  } catch {
    return fallback;
  }
}

export function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** A phone we can actually dial, or null. "TBD — lookup" is not a phone. */
export function dialable(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  // SmartMoving sometimes stores a leading country code.
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

export function fmtPhone(phone: string | null | undefined): string {
  const d = dialable(phone);
  if (!d) return phone?.trim() || "—";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isPlaceholder(value: string | null | undefined): boolean {
  return !value || value.trim().toLowerCase().startsWith("tbd");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Priority tops out at 90 in practice (30+25+25+10), not 100. */
export function priorityTone(priority: number): "high" | "medium" | "low" {
  if (priority >= 70) return "high";
  if (priority >= 45) return "medium";
  return "low";
}

/** The SmartMoving page for a job, or null.
 *
 *  Needs both ids: the opportunity GUID is the path, the job GUID is the
 *  `jobId` parameter that picks the right job within it. The export only ever
 *  had the second, so `sm_opportunity_id` is null until
 *  scripts/backfill_sm_opportunity_ids.py has resolved that job's quote —
 *  hence null rather than a link that lands on "opportunity was not found".
 */
export function smartMovingLink(
  opportunityId: string | null | undefined,
  jobId?: string | null,
): string | null {
  if (!opportunityId?.trim()) return null;
  const base = `https://app.smartmoving.com/opportunities/${encodeURIComponent(
    opportunityId.trim(),
  )}/sales`;
  return jobId?.trim() ? `${base}?jobId=${encodeURIComponent(jobId.trim())}` : base;
}
