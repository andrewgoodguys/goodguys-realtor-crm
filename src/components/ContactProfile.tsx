import { useState } from "react";
import { Ban } from "lucide-react";
import { usePeople } from "@/hooks/useData";
import { fmtDate, fmtRelative } from "@/lib/format";
import { OWNERS, RELATIONSHIP_STATUSES, type Touch } from "@/lib/types";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Select,
  Spinner,
  Textarea,
  Button,
} from "@/components/ui";

/** The fields every workable contact shares — agents, partners and hiring
 *  partners are all claimed, given a status, noted and can be shut off. */
export interface Workable {
  owner_name: string | null;
  owner_assigned_at: string | null;
  owner_assigned_by: string | null;
  relationship_status: string;
  do_not_contact: boolean;
  notes: string | null;
}

/** Owner, status, notes and do-not-contact, saved as they change. */
export function WorkControls({
  row,
  onPatch,
}: {
  row: Workable;
  onPatch: (patch: Partial<Workable>) => void;
}) {
  const people = usePeople().data;
  const [notes, setNotes] = useState<string | null>(null);

  return (
    <div className="space-y-3 border-t border-[var(--border)] p-4">
      <div className="space-y-1.5">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Assigned to</span>
          <Select
            value={row.owner_name ?? ""}
            onChange={(e) => onPatch({ owner_name: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {(people?.map((p) => p.name) ?? OWNERS).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {row.owner_name && !(people ?? []).some((p) => p.name === row.owner_name) && (
              <option value={row.owner_name}>{row.owner_name} (inactive)</option>
            )}
          </Select>
        </label>
        {row.owner_assigned_at && (
          <p className="muted text-xs">
            Taken {fmtRelative(row.owner_assigned_at)}
            {row.owner_assigned_by ? ` by ${row.owner_assigned_by.split("@")[0]}` : ""}
          </p>
        )}
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Relationship status</span>
        <Select
          value={row.relationship_status}
          onChange={(e) => onPatch({ relationship_status: e.target.value })}
        >
          {RELATIONSHIP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Notes</span>
        <Textarea
          rows={3}
          value={notes ?? row.notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== null && notes !== (row.notes ?? "")) onPatch({ notes });
          }}
          placeholder="Anything worth remembering before the next call…"
        />
      </label>

      <Button
        variant={row.do_not_contact ? "secondary" : "danger"}
        size="sm"
        onClick={() => onPatch({ do_not_contact: !row.do_not_contact })}
      >
        <Ban className="size-4" />
        {row.do_not_contact ? "Allow contact again" : "Mark do-not-contact"}
      </Button>
    </div>
  );
}

/** The outreach log for one contact, newest first. */
export function TouchHistory({
  touches,
  loading,
}: {
  touches: Touch[] | undefined;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Outreach history" />
      {loading ? (
        <Spinner />
      ) : !touches?.length ? (
        <EmptyState
          title="No outreach logged"
          description="Log a call, text or email and it lands here."
        />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {touches.map((t) => (
            <li key={t.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={t.got_response ? "brand" : "neutral"}>{t.channel}</Badge>
                {t.outcome && <span className="font-medium">{t.outcome}</span>}
                {t.got_response && <Badge tone="brand">responded</Badge>}
                <span className="muted ml-auto text-xs">
                  {t.created_by_email?.split("@")[0]} · {fmtDate(t.occurred_at)}
                </span>
              </div>
              {t.notes && <p className="muted mt-1.5 whitespace-pre-wrap">{t.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Overview / history tab strip, with the history count. */
export function ProfileTabs<T extends string>({
  tabs,
  tab,
  onTab,
  historyCount,
}: {
  tabs: readonly T[];
  tab: T;
  onTab: (t: T) => void;
  historyCount?: number;
}) {
  return (
    <div className="flex gap-1 border-b border-[var(--border)]">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onTab(t)}
          className={
            "-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors " +
            (tab === t
              ? "border-brand-600 text-brand-700 dark:text-brand-300"
              : "muted border-transparent hover:text-[var(--text)]")
          }
        >
          {t}
          {t === "history" && historyCount ? ` (${historyCount})` : ""}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
