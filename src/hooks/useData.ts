import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Agent, DueThisWeekRow, Lead, Run, Touch } from "@/lib/types";
import { useAuth } from "./useAuth";

/** Anything that changes an agent invalidates these. */
function invalidateAgentViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["agents"] });
  qc.invalidateQueries({ queryKey: ["due"] });
  qc.invalidateQueries({ queryKey: ["stats"] });
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}

/* ------------------------------------------------------------------ agents */

export interface AgentFilters {
  search?: string;
  owner?: string;
  status?: string;
  includeDnc?: boolean;
}

export function useAgents(filters: AgentFilters = {}) {
  return useQuery({
    queryKey: ["agents", filters],
    queryFn: async () => {
      let q = supabase.from("agents").select("*").order("priority", { ascending: false });

      if (filters.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        q = q.or(`name.ilike.${term},brokerage.ilike.${term},phone.ilike.${term}`);
      }
      if (filters.owner) q = q.eq("owner_name", filters.owner);
      if (filters.status) q = q.eq("relationship_status", filters.status);
      if (!filters.includeDnc) q = q.eq("do_not_contact", false);

      return unwrap(await q.limit(500)) as Agent[];
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
        .select("*")
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
  splitAndrew: number;
  splitAvery: number;
  leadsFlagged: number;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async (): Promise<DashboardStats> => {
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const count = { count: "exact" as const, head: true };

      const [
        agents,
        due,
        contacted,
        responded,
        touches,
        andrew,
        avery,
        flagged,
      ] = await Promise.all([
        supabase.from("agents").select("*", count).eq("do_not_contact", false),
        supabase.from("due_this_week").select("*", count),
        supabase
          .from("agents")
          .select("*", count)
          .neq("relationship_status", "New — not contacted"),
        supabase.from("touches").select("*", count).eq("got_response", true),
        supabase.from("touches").select("*", count).gte("occurred_at", weekAgo),
        supabase.from("agents").select("*", count).eq("owner_name", "Andrew"),
        supabase.from("agents").select("*", count).eq("owner_name", "Avery"),
        supabase.from("leads").select("*", count).ilike("status", "%manual%"),
      ]);

      return {
        totalAgents: agents.count ?? 0,
        dueCount: due.count ?? 0,
        contactedCount: contacted.count ?? 0,
        respondedCount: responded.count ?? 0,
        touchesThisWeek: touches.count ?? 0,
        splitAndrew: andrew.count ?? 0,
        splitAvery: avery.count ?? 0,
        leadsFlagged: flagged.count ?? 0,
      };
    },
  });
}
