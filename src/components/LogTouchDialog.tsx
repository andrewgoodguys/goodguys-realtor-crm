import { useState, type FormEvent } from "react";
import { useLogTouch } from "@/hooks/useData";
import { CALL_OUTCOMES, type Agent, type Channel } from "@/lib/types";
import { Button, Dialog, Field, Select, Textarea, cn } from "@/components/ui";

const CHANNELS: Array<{ value: Channel; label: string }> = [
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
];

export default function LogTouchDialog({
  agent,
  open,
  onClose,
  defaultChannel = "call",
}: {
  agent: Pick<Agent, "id" | "name"> | null;
  open: boolean;
  onClose: () => void;
  defaultChannel?: Channel;
}) {
  const logTouch = useLogTouch();
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [outcome, setOutcome] = useState<string>("");
  const [gotResponse, setGotResponse] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setChannel(defaultChannel);
    setOutcome("");
    setGotResponse(false);
    setNotes("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setError(null);
    try {
      await logTouch.mutateAsync({
        agent_id: agent.id,
        channel,
        outcome: outcome || null,
        got_response: gotResponse,
        notes: notes.trim() || null,
      });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={agent ? `Log outreach — ${agent.name}` : "Log outreach"}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium">Channel</span>
          <div className="grid grid-cols-5 gap-1.5">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setChannel(c.value)}
                className={cn(
                  "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                  channel === c.value
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-[var(--border)] hover:bg-[var(--surface-2)]",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {channel === "call" && (
          <Field label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">— select —</option>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-brand-600)]"
            checked={gotResponse}
            onChange={(e) => setGotResponse(e.target.checked)}
          />
          They responded
        </label>

        <Field label="Notes" hint="What was said, what to do next.">
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Asked me to follow up after the Peachtree closing…"
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            loading={logTouch.isPending}
          >
            Save
          </Button>
        </div>

        <p className="muted text-xs">
          Saving sets the last touch and schedules the next one 30 days out.
        </p>
      </form>
    </Dialog>
  );
}
