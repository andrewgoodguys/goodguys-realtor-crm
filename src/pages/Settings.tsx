import { useEffect, useMemo, useState } from "react";
import { Check, Plus, RotateCcw } from "lucide-react";
import {
  useAddPerson,
  usePeople,
  useSettings,
  useUpdatePerson,
  useUpdateSettings,
} from "@/hooks/useData";
import {
  DEFAULT_COPY,
  PLACEHOLDERS,
  callScript,
  emailMessage,
  textMessage,
  type Copy,
} from "@/lib/templates";
import type { Settings as SettingsRow } from "@/lib/types";
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

type Section = "branding" | "cadence" | "templates" | "people";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "branding", label: "Branding" },
  { key: "cadence", label: "Cadence" },
  { key: "templates", label: "Templates" },
  { key: "people", label: "People" },
];

/** A sample agent, so the template preview shows real sentences rather than
 *  a wall of {{placeholders}}. */
const SAMPLE = {
  agentName: "Dana Reed",
  clients: [
    { client_name: "the Whitfields", address: "412 Ashwood Ln", side: "listing" as const },
  ],
};

export default function Settings() {
  const settingsQ = useSettings();
  const [section, setSection] = useState<Section>("branding");

  if (settingsQ.isLoading) return <Spinner label="Loading settings…" />;
  if (settingsQ.error) return <ErrorState error={settingsQ.error} />;
  const settings = settingsQ.data!;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="muted text-sm">
          Changes apply to everyone, immediately. Last saved{" "}
          {new Date(settings.updated_at).toLocaleString()}.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium " +
              (section === s.key
                ? "border-brand-600 text-brand-700 dark:text-brand-300"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]")
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "branding" && <Branding settings={settings} />}
      {section === "cadence" && <Cadence settings={settings} />}
      {section === "templates" && <Templates settings={settings} />}
      {section === "people" && <People />}
    </div>
  );
}

/** Tracks edits against the saved row, so Save is enabled only when something
 *  actually differs and a save by someone else resets a field you left alone. */
function useDraft<K extends keyof SettingsRow>(settings: SettingsRow, keys: K[]) {
  const saved = useMemo(() => {
    const out = {} as Pick<SettingsRow, K>;
    for (const k of keys) out[k] = settings[k];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, ...keys]);

  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  const dirty = keys.some((k) => draft[k] !== saved[k]);
  const set = <T extends K>(key: T, value: SettingsRow[T]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return { draft, set, dirty, saved, reset: () => setDraft(saved) };
}

function SaveBar({
  dirty,
  busy,
  onSave,
  onReset,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-3">
      <Button variant="primary" disabled={!dirty} loading={busy} onClick={onSave}>
        <Check className="size-4" />
        Save
      </Button>
      {dirty && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="size-4" />
          Discard
        </Button>
      )}
      {!dirty && <span className="muted text-sm">No unsaved changes</span>}
    </div>
  );
}

/* --------------------------------------------------------------- branding */

function Branding({ settings }: { settings: SettingsRow }) {
  const update = useUpdateSettings();
  const { draft, set, dirty, reset } = useDraft(settings, [
    "app_name",
    "logo_url",
    "accent_color",
    "login_blurb",
  ]);

  return (
    <Card>
      <CardHeader
        title="Branding"
        subtitle="The name, mark and colour this CRM wears."
      />
      <div className="space-y-4 p-4">
        <Field label="App name" hint="Shown in the header and the browser tab.">
          <Input value={draft.app_name} onChange={(e) => set("app_name", e.target.value)} />
        </Field>

        <Field label="Logo URL" hint="Optional. Leave empty for the shield mark.">
          <Input
            placeholder="https://…"
            value={draft.logo_url ?? ""}
            onChange={(e) => set("logo_url", e.target.value || null)}
          />
        </Field>

        <Field label="Accent colour" hint="Buttons, links and the active nav item.">
          <div className="flex items-center gap-3">
            <input
              type="color"
              className="size-10 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent"
              value={draft.accent_color}
              onChange={(e) => set("accent_color", e.target.value)}
            />
            <Input
              className="font-mono"
              value={draft.accent_color}
              onChange={(e) => set("accent_color", e.target.value)}
            />
          </div>
        </Field>

        <Field label="Sign-in blurb" hint="The line under the title on the login screen.">
          <Input
            value={draft.login_blurb}
            onChange={(e) => set("login_blurb", e.target.value)}
          />
        </Field>
      </div>
      <SaveBar
        dirty={dirty}
        busy={update.isPending}
        onReset={reset}
        onSave={() => update.mutate(draft)}
      />
    </Card>
  );
}

/* ---------------------------------------------------------------- cadence */

function Cadence({ settings }: { settings: SettingsRow }) {
  const update = useUpdateSettings();
  const peopleQ = usePeople();
  const { draft, set, dirty, saved, reset } = useDraft(settings, [
    "follow_up_days",
    "due_window_days",
    "default_owner",
  ]);

  const cadenceChanged = draft.follow_up_days !== saved.follow_up_days;

  return (
    <Card>
      <CardHeader
        title="Cadence"
        subtitle="How often an agent comes back around, and who picks them up."
      />
      <div className="space-y-4 p-4">
        <Field
          label="Follow up every"
          hint="Days after a logged touch before the agent is due again. Was fixed at 30."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={365}
              className="w-28"
              value={draft.follow_up_days}
              onChange={(e) => set("follow_up_days", Number(e.target.value))}
            />
            <span className="muted text-sm">days</span>
          </div>
        </Field>

        <Field
          label="&ldquo;Due this week&rdquo; window"
          hint="How far ahead the dashboard and call list look."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={90}
              className="w-28"
              value={draft.due_window_days}
              onChange={(e) => set("due_window_days", Number(e.target.value))}
            />
            <span className="muted text-sm">days ahead</span>
          </div>
        </Field>

        <Field label="Default owner for new agents" hint="Leave unassigned to keep the brokerage split.">
          <Select
            value={draft.default_owner ?? ""}
            onChange={(e) => set("default_owner", e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {(peopleQ.data ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        {cadenceChanged && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Saving will reschedule every open follow-up to {draft.follow_up_days} days
            after its last touch — not just the ones logged from now on.
          </p>
        )}
      </div>
      <SaveBar
        dirty={dirty}
        busy={update.isPending}
        onReset={reset}
        onSave={() => update.mutate(draft)}
      />
    </Card>
  );
}

/* -------------------------------------------------------------- templates */

const TEMPLATE_FIELDS: Array<{
  key: keyof Copy;
  label: string;
  hint: string;
  rows: number;
}> = [
  { key: "signature", label: "Signature", hint: "Closes the email.", rows: 2 },
  { key: "text_template", label: "Text message", hint: "One paragraph, sent from your phone.", rows: 4 },
  { key: "email_subject", label: "Email subject", hint: "", rows: 1 },
  { key: "email_body", label: "Email body", hint: "", rows: 12 },
  { key: "call_script", label: "Call script", hint: "One spoken beat per line.", rows: 8 },
  {
    key: "call_script_repeat",
    label: "Repeat-client beat",
    hint: "Added after the third beat when the agent has sent more than one client.",
    rows: 2,
  },
];

function Templates({ settings }: { settings: SettingsRow }) {
  const update = useUpdateSettings();
  const { draft, set, dirty, reset } = useDraft(settings, [
    "signature",
    "text_template",
    "email_subject",
    "email_body",
    "call_script",
    "call_script_repeat",
  ]);

  const preview = useMemo(() => {
    const copy = draft as Copy;
    const c = SAMPLE.clients[0];
    return {
      text: textMessage(SAMPLE.agentName, c.client_name, c.address, c.side, copy),
      email: emailMessage(SAMPLE.agentName, SAMPLE.clients, copy),
      call: callScript(SAMPLE.agentName, [...SAMPLE.clients, ...SAMPLE.clients], copy),
    };
  }, [draft]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Outreach copy"
          subtitle="The exact words that go out. Edit carefully — this is the whole pitch."
        />
        <div className="space-y-4 p-4">
          <div className="rounded-lg bg-[var(--surface-2)] p-3 text-xs">
            <span className="muted">Placeholders: </span>
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="mr-1.5 font-mono">
                {p}
              </code>
            ))}
          </div>

          {TEMPLATE_FIELDS.map(({ key, label, hint, rows }) => (
            <Field key={key} label={label} hint={hint || undefined}>
              {rows === 1 ? (
                <Input value={draft[key]} onChange={(e) => set(key, e.target.value)} />
              ) : (
                <Textarea
                  rows={rows}
                  className="font-mono text-xs"
                  value={draft[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              )}
            </Field>
          ))}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              for (const { key } of TEMPLATE_FIELDS) set(key, DEFAULT_COPY[key]);
            }}
          >
            <RotateCcw className="size-4" />
            Restore original wording
          </Button>
        </div>
        <SaveBar
          dirty={dirty}
          busy={update.isPending}
          onReset={reset}
          onSave={() => update.mutate(draft)}
        />
      </Card>

      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader
          title="Preview"
          subtitle={`${SAMPLE.agentName}, who sent us two clients`}
        />
        <div className="space-y-4 p-4 text-sm">
          <div>
            <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Text</p>
            <p className="whitespace-pre-wrap rounded-lg bg-[var(--surface-2)] p-3">
              {preview.text}
            </p>
          </div>
          <div>
            <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Email</p>
            <p className="rounded-t-lg bg-[var(--surface-2)] px-3 pt-3 font-medium">
              {preview.email.subject}
            </p>
            <p className="whitespace-pre-wrap rounded-b-lg bg-[var(--surface-2)] px-3 pb-3">
              {preview.email.body}
            </p>
          </div>
          <div>
            <p className="muted mb-1 text-xs font-medium uppercase tracking-wide">Call</p>
            <ol className="space-y-1.5 rounded-lg bg-[var(--surface-2)] p-3">
              {preview.call.map((beat, i) => (
                <li key={i} className="flex gap-2">
                  <span className="muted tabular-nums">{i + 1}.</span>
                  <span>{beat}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- people */

function People() {
  const peopleQ = usePeople(true);
  const addPerson = useAddPerson();
  const updatePerson = useUpdatePerson();
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  if (peopleQ.isLoading) return <Spinner label="Loading people…" />;
  if (peopleQ.error) return <ErrorState error={peopleQ.error} />;
  const people = peopleQ.data ?? [];

  return (
    <Card>
      <CardHeader
        title="People"
        subtitle="Who agents can be assigned to. Signing in is separate — anyone with a GoodGuys address can."
      />
      <ul className="divide-y divide-[var(--border)]">
        {people.map((p) => (
          <li key={p.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {renaming === p.name ? (
              <>
                <Input
                  autoFocus
                  className="max-w-48"
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="primary"
                  loading={updatePerson.isPending}
                  onClick={() => {
                    const name = renameTo.trim();
                    if (name && name !== p.name) {
                      updatePerson.mutate({ name: p.name, patch: { name } });
                    }
                    setRenaming(null);
                  }}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0">
                  <span className={p.active ? "font-medium" : "muted line-through"}>
                    {p.name}
                  </span>
                  {/* Which login this name belongs to. A name with no email is
                      assignable but nobody is signed in as it — usually because
                      they have not opened the app yet, occasionally because
                      their address does not resemble their name. */}
                  <span className="muted block truncate text-xs">
                    {p.email ?? "not signed in yet"}
                  </span>
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenaming(p.name);
                      setRenameTo(p.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updatePerson.mutate({ name: p.name, patch: { active: !p.active } })
                    }
                  >
                    {p.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] p-4">
        <Field label="Add someone">
          <Input
            className="max-w-48"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={!newName.trim()}
          loading={addPerson.isPending}
          onClick={() => {
            addPerson.mutate(
              { name: newName, sortOrder: people.length + 1 },
              { onSuccess: () => setNewName("") },
            );
          }}
        >
          <Plus className="size-4" />
          Add
        </Button>
      </div>

      <p className="muted border-t border-[var(--border)] px-4 py-3 text-sm">
        Anyone with a GoodGuys address is added here the first time they sign in,
        so this list is usually one you read rather than edit — add a name early
        only if you want to assign agents to somebody before they arrive.
        Renaming carries that person&rsquo;s agents with them. Deactivating hides
        them from the assignment picker but leaves history intact — nobody is
        deleted.
      </p>
    </Card>
  );
}
