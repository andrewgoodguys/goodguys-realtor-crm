import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_COPY, type Copy } from "@/lib/templates";
import type {
  Agent,
  Branding,
  BrokerageSummary,
  DueThisWeekRow,
  Lead,
  OutreachStep,
  OwnerWorkload,
  Person,
  Run,
  Settings,
  Touch,
} from "@/lib/types";
import { useAuth } from "./useAuth";

/** Anything that changes an agent invalidates these. */
function invalidateAgentViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["agents"] });
  qc.invalidateQueries({ queryKey: ["due"] });
  qc.invalidateQueries({ queryKey: ["stats"] });
  qc.invalidateQueries({ queryKey: ["workload"] });
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

/* ------------------------------------------------------------------ agents */

/** `owner` is a person's name, or this — nobody. Kept distinct from undefined,
 *  which means "any owner", because an agent with no owner is the one state
 *  worth going looking for: nobody is calling them. */
export const UNASSIGNED = "__unassigned__";

export interface AgentFilters {
  search?: string;
  owner?: string;
  status?: string;
  brokerage?: string;
  includeDnc?: boolean;
}

export function useAgents(filters: AgentFilters = {}) {
  return useQuery({
    queryKey: ["agents", filters],
    queryFn: async () => {
      let q = supabase.from("agents").select("*").order("priority", { ascending: false });

      if (filters.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        q = q.or(
          `name.ilike.${term},brokerage.ilike.${term},office.ilike.${term},phone.ilike.${term}`,
        );
      }
      if (filters.brokerage) q = q.eq("brokerage", filters.brokerage);
      if (filters.owner === UNASSIGNED) q = q.is("owner_name", null);
      else if (filters.owner) q = q.eq("owner_name", filters.owner);
      if (filters.status) q = q.eq("relationship_status", filters.status);
      if (!filters.includeDnc) q = q.eq("do_not_contact", false);

      return unwrap(await q.limit(500)) as Agent[];
    },
  });
}

/** Hand a batch of agents to somebody, or to nobody. One statement, because
 *  taking twenty agents off the unassigned list should be one decision and one
 *  undo, not twenty rows arriving one at a time.
 *
 *  Who did it and when is stamped by a trigger (0010), not sent from here — a
 *  reassignment made from a script should leave the same trail as this one. */
export function useAssignAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner }: { ids: string[]; owner: string | null }) => {
      if (ids.length === 0) return [] as Agent[];
      return unwrap(
        await supabase.from("agents").update({ owner_name: owner }).in("id", ids).select(),
      ) as Agent[];
    },
    onSuccess: (agents) => {
      invalidateAgentViews(qc);
      for (const a of agents) qc.invalidateQueries({ queryKey: ["agents", "one", a.id] });
    },
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["agents", "one", id],
    queryFn: async () =>
      unwrap(await supabase.from("agents").select("*").eq("id", id!).single()) as Agent,
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Agent> }) =>
      unwrap(
        await supabase.from("agents").update(patch).eq("id", id).select().single(),
      ) as Agent,
    onSuccess: (agent) => {
      invalidateAgentViews(qc);
      qc.invalidateQueries({ queryKey: ["agents", "one", agent.id] });
    },
  });
}

/* -------------------------------------------------------------------- due */

export function useDueThisWeek(owner?: string | null) {
  return useQuery({
    queryKey: ["due", owner ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("due_this_week")
        .select("*")
        .order("priority", { ascending: false });
      if (owner) q = q.eq("owner_name", owner);
      return unwrap(await q.limit(200)) as DueThisWeekRow[];
    },
  });
}

/* ------------------------------------------------------------------- leads */

export function useLeads(opts: { agentId?: string; status?: string; search?: string } = {}) {
  return useQuery({
    queryKey: ["leads", opts],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        // The SmartMoving link needs both of the job's ids, and leads holds
        // neither — only the FK to jobs. One embed beats a second round trip.
        .select("*, job:jobs(sm_job_id, sm_opportunity_id)")
        .order("job_date", { ascending: false, nullsFirst: false });
      if (opts.agentId) q = q.eq("agent_id", opts.agentId);
      if (opts.status) q = q.eq("status", opts.status);
      if (opts.search?.trim()) {
        const term = `%${opts.search.trim()}%`;
        q = q.or(
          `house_address.ilike.${term},customer_name.ilike.${term},job_number.ilike.${term}`,
        );
      }
      return unwrap(await q.limit(500)) as Lead[];
    },
  });
}

/* ----------------------------------------------------------------- touches */

export function useTouches(agentId: string | undefined) {
  return useQuery({
    enabled: Boolean(agentId),
    queryKey: ["touches", agentId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("touches")
          .select("*")
          .eq("agent_id", agentId!)
          .order("occurred_at", { ascending: false }),
      ) as Touch[],
  });
}

export function useRecentTouches(limit = 25) {
  return useQuery({
    queryKey: ["touches", "recent", limit],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("touches")
          .select("*")
          .order("occurred_at", { ascending: false })
          .limit(limit),
      ) as Touch[],
  });
}

export function useLogTouch() {
  const qc = useQueryClient();
  const { user, email } = useAuth();
  return useMutation({
    mutationFn: async (touch: Partial<Touch>) =>
      unwrap(
        await supabase
          .from("touches")
          .insert({ ...touch, created_by: user?.id ?? null, created_by_email: email })
          .select()
          .single(),
      ) as Touch,
    onSuccess: (touch) => {
      invalidateAgentViews(qc);
      qc.invalidateQueries({ queryKey: ["touches"] });
      qc.invalidateQueries({ queryKey: ["agents", "one", touch.agent_id] });
    },
  });
}

/* -------------------------------------------------------------------- runs */

export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: async () =>
      unwrap(
        await supabase.from("runs").select("*").order("run_date", { ascending: false }),
      ) as Run[],
  });
}

/* ------------------------------------------------------------------- stats */

export interface DashboardStats {
  totalAgents: number;
  dueCount: number;
  contactedCount: number;
  respondedCount: number;
  touchesThisWeek: number;
  /** Active agents nobody owns. Was structurally impossible while the md5
   *  split covered everyone; now that agents can be handed back, it is the
   *  number that says work is falling through. */
  unassignedCount: number;
  leadsFlagged: number;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async (): Promise<DashboardStats> => {
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const count = { count: "exact" as const, head: true };

      const [agents, due, contacted, responded, touches, unassigned, flagged] =
        await Promise.all([
          supabase.from("agents").select("*", count).eq("do_not_contact", false),
          supabase.from("due_this_week").select("*", count),
          supabase
            .from("agents")
            .select("*", count)
            .neq("relationship_status", "New — not contacted"),
          supabase.from("touches").select("*", count).eq("got_response", true),
          supabase.from("touches").select("*", count).gte("occurred_at", weekAgo),
          supabase
            .from("agents")
            .select("*", count)
            .is("owner_name", null)
            .eq("do_not_contact", false),
          supabase.from("leads").select("*", count).ilike("status", "%manual%"),
        ]);

      return {
        totalAgents: agents.count ?? 0,
        dueCount: due.count ?? 0,
        contactedCount: contacted.count ?? 0,
        respondedCount: responded.count ?? 0,
        touchesThisWeek: touches.count ?? 0,
        unassignedCount: unassigned.count ?? 0,
        leadsFlagged: flagged.count ?? 0,
      };
    },
  });
}

/* ---------------------------------------------------------------- settings */

/** The one settings row. Cached hard: it changes about once a month, and
 *  everything from branding to outreach copy reads through it. */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      unwrap(await supabase.from("settings").select("*").eq("id", true).single()) as Settings,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const next = unwrap(
        await supabase
          .from("settings")
          .update({ ...patch, updated_by: user?.id ?? null })
          .eq("id", true)
          .select()
          .single(),
      ) as Settings;

      // A new cadence should move every open follow-up, not just the next one
      // logged against an agent.
      if (patch.follow_up_days !== undefined) {
        const { error } = await supabase.rpc("reschedule_follow_ups");
        if (error) throw error;
      }
      return next;
    },
    onSuccess: (_next, patch) => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      if (patch.follow_up_days !== undefined || patch.due_window_days !== undefined) {
        invalidateAgentViews(qc);
      }
    },
  });
}

/* ------------------------------------------------------------------ people */

export function usePeople(includeInactive = false) {
  return useQuery({
    queryKey: ["people", includeInactive],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from("people").select("*").order("sort_order");
      if (!includeInactive) q = q.eq("active", true);
      return unwrap(await q) as Person[];
    },
  });
}

/** One row per person, with what they are carrying. Everyone is listed,
 *  including whoever owns nothing yet — that is the row worth acting on. */
export function useOwnerWorkload() {
  return useQuery({
    queryKey: ["workload"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("owner_workload")
          .select("*")
          .eq("active", true)
          .order("sort_order"),
      ) as OwnerWorkload[],
  });
}

export function useAddPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, sortOrder }: { name: string; sortOrder: number }) =>
      unwrap(
        await supabase
          .from("people")
          .insert({ name: name.trim(), sort_order: sortOrder })
          .select()
          .single(),
      ) as Person,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, patch }: { name: string; patch: Partial<Person> }) =>
      unwrap(
        await supabase.from("people").update(patch).eq("name", name).select().single(),
      ) as Person,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people"] });
      // Renaming cascades to agents.owner_name, so those views are now stale.
      invalidateAgentViews(qc);
    },
  });
}

/* ----------------------------------------------------------------- cadence */

/** The intro sequence. Three rows since 0006, and until now nothing read
 *  them — the cadence was recorded in the database and driving nothing. */
export function useOutreachSteps() {
  return useQuery({
    queryKey: ["outreach_steps"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      unwrap(
        await supabase.from("outreach_steps").select("*").order("day_offset"),
      ) as OutreachStep[],
  });
}

/* ---------------------------------------------------------------- branding */

/** Reads the anon-visible view, so the login screen is branded too. Failure is
 *  not an error worth showing: the app falls back to its built-in look. */
export function useBranding() {
  return useQuery({
    queryKey: ["branding"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data } = await supabase.from("branding").select("*").maybeSingle();
      return (data as Branding | null) ?? null;
    },
  });
}

/** The outreach wording every message screen should use. Falls back to the
 *  built-in copy while the settings query is in flight, so a message is never
 *  rendered half-empty. */
export function useCopy(): Copy {
  const { data } = useSettings();
  if (!data) return DEFAULT_COPY;
  return {
    signature: data.signature,
    text_template: data.text_template,
    email_subject: data.email_subject,
    email_body: data.email_body,
    call_script: data.call_script,
    call_script_repeat: data.call_script_repeat,
  };
}

/* ------------------------------------------------------------- brokerages */

/** Every firm, biggest first. Reads the roll-up view, not agents, so the page
 *  does not pull 186 rows to count them. */
export function useBrokerages() {
  return useQuery({
    queryKey: ["brokerages"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("brokerage_summary")
          .select("*")
          .order("agent_count", { ascending: false })
          .limit(500),
      ) as BrokerageSummary[],
  });
}

/* ----------------------------------------------------------------- offices */

/** Offices already recorded at this brokerage, to suggest in the picker.
 *  Free text with suggestions rather than a lookup table: brokerage itself is
 *  free text, and a table would be one more thing to keep tidy. */
export function useOfficesForBrokerage(brokerage: string | null | undefined) {
  return useQuery({
    queryKey: ["offices", brokerage ?? ""],
    enabled: !!brokerage,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("offices_for_brokerage", {
        brokerage_name: brokerage,
      });
      if (error) throw error;
      return ((data ?? []) as Array<{ office: string }>).map((r) => r.office);
    },
  });
}
