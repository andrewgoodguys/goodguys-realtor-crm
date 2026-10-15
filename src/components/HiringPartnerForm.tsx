import { useState, type FormEvent } from "react";
import { useAddHiringPartner, useHiringMeta, useUpdateHiringPartner } from "@/hooks/useData";
import { HIRING_TRACKS, type HiringPartner, type HiringTrack } from "@/lib/types";
import { Button, Dialog, Field, Input, Textarea, cn } from "@/components/ui";

type Draft = Pick<
  HiringPartner,
  "track" | "person_name" | "title" | "organization" | "org_type" | "phone" | "email" | "website" | "city" | "notes"
>;

const blank = (track: HiringTrack): Draft => ({
  track,
  person_name: "",
  title: null,
  organization: null,
  org_type: null,
  phone: null,
  email: null,
  website: null,
  city: null,
  notes: null,
});

/** Add a hiring partner, or — given `existing` — fix one's details. Hiring
 *  partners are entered one at a time by hand, so typos need a way back out. */
export default function HiringPartnerForm({
  open,
  onClose,
  track,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  track: HiringTrack;
  existing?: HiringPartner;
  onSaved?: (row: HiringPartner) => void;
}) {
  const add = useAddHiringPartner();
  const edit = useUpdateHiringPartner();
  const orgTypes = useHiringMeta().data?.orgTypes ?? [];
  const [draft, setDraft] = useState<Draft>(existing ?? blank(track));
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: key === "person_name" || key === "track" ? value : value || null }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Trimmed here so " Church" and "Church" are one org type, not two.
    const clean = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]),
    ) as Draft;
    if (!clean.person_name) {
      setError("A name is required.");
      return;
    }
    try {
      const row = existing
        ? (await edit.mutateAsync({ ids: [existing.id], patch: clean }))[0]
        : await add.mutateAsync(clean);
      if (!existing) setDraft(blank(draft.track));
      onSaved?.(row);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? `Edit — ${existing.person_name}` : "Add a hiring partner"}
      wide
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium">Track</span>
          <div className="grid grid-cols-2 gap-1.5">
            {HIRING_TRACKS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => set("track", t.key)}
                className={cn(
                  "rounded-lg border px-2 py-2 text-sm font-medium transition-colors",
                  draft.track === t.key
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-[var(--border)] hover:bg-[var(--surface-2)]",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input
              required
              autoFocus
              value={draft.person_name}
              onChange={(e) => set("person_name", e.target.value)}
              placeholder="Jane Smith"
            />
          </Field>
          <Field label="Title">
            <Input
              value={draft.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Workforce coordinator"
            />
          </Field>
          <Field label="Organization">
            <Input
              value={draft.organization ?? ""}
              onChange={(e) => set("organization", e.target.value)}
              placeholder="WorkSource Atlanta"
            />
          </Field>
          <Field label="Kind of organization">
            <Input
              list="hiring-org-types"
              value={draft.org_type ?? ""}
              onChange={(e) => set("org_type", e.target.value)}
              placeholder="Workforce board, church, veteran program…"
            />
            <datalist id="hiring-org-types">
              {orgTypes.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              value={draft.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={draft.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Website">
            <Input
              type="url"
              value={draft.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://"
            />
          </Field>
          <Field label="City">
            <Input value={draft.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </Field>
        </div>

        {!existing && (
          <Field label="Notes" hint="How you found them, who introduced you.">
            <Textarea
              rows={2}
              value={draft.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            loading={add.isPending || edit.isPending}
          >
            {existing ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
