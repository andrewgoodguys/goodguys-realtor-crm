import { ExternalLink } from "lucide-react";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { ReferralTotal, ReferredJob } from "@/lib/types";
import { Badge, Card, CardHeader, EmptyState, Spinner } from "@/components/ui";

/** Moves they sent us and what they were worth. Blank, not "0", for anyone who
 *  never has: in a list, the referrers should be what stands out. */
export function ReferredCell({ total }: { total: ReferralTotal | undefined }) {
  if (!total || (!total.referred_jobs && !total.upcoming_jobs)) {
    return <span className="muted">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone="brand" className="nums">
        {total.referred_jobs} · {fmtMoney(total.referred_revenue)}
      </Badge>
      {total.upcoming_jobs > 0 && (
        <span className="muted nums text-xs">+{total.upcoming_jobs} booked</span>
      )}
    </span>
  );
}

const STATUS_TONE: Record<string, "brand" | "info" | "neutral" | "danger"> = {
  Closed: "brand",
  Completed: "brand",
  Booked: "info",
  Lost: "neutral",
  Cancelled: "neutral",
};

/** The jobs one agent or partner sent us. Lost and cancelled are listed too —
 *  they are part of the relationship — but only Closed/Completed count. */
export function ReferredJobsCard({
  jobs,
  loading,
  total,
}: {
  jobs: ReferredJob[] | undefined;
  loading: boolean;
  total: ReferralTotal | undefined;
}) {
  const name = jobs?.[0]?.affiliate_name;
  return (
    <Card>
      <CardHeader
        title="Moves they referred to us"
        subtitle={
          total
            ? `${total.referred_jobs} done · ${fmtMoney(total.referred_revenue)}${
                total.upcoming_jobs ? ` · ${total.upcoming_jobs} booked` : ""
              }${name ? ` · in SmartMoving as “${name.replace(/^\*/, "")}”` : ""}`
            : "None yet"
        }
      />
      {loading ? (
        <Spinner />
      ) : !jobs?.length ? (
        <EmptyState
          icon={<ExternalLink className="size-6" />}
          title="No referrals on record"
          description="Jobs count here when SmartMoving's Affiliate Name is this person."
        />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {jobs.map((j) => (
            <li key={j.job_id} className="flex items-start justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{j.customer_name ?? "—"}</p>
                <p className="muted text-xs">
                  {j.job_number ?? "—"} · {fmtDate(j.job_date)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Badge tone={STATUS_TONE[j.opportunity_status ?? ""] ?? "neutral"}>
                  {j.opportunity_status ?? "—"}
                </Badge>
                <p className="nums muted mt-1 text-xs">{fmtMoney(j.revenue)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
