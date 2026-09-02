/** Free text now that public.people is the list; see OWNERS for the seed. */
export type Owner = string;
export type PhoneType = "direct" | "office" | "unknown";
export type AgentRole = "listing" | "buying";
export type Channel = "call" | "text" | "email" | "note" | "meeting";

export interface Agent {
  id: string;
  name: string;
  name_key: string;
  brokerage: string | null;
  phone: string | null;
  phone_type: PhoneType;
  email: string | null;
  owner_name: Owner | null;
  lifetime_jobs: number;
  lifetime_revenue: number;
  most_recent_job: string | null;
  relationship_status: string;
  priority: number;
  do_not_contact: boolean;
  last_touch: string | null;
  next_touch_due: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DueThisWeekRow extends Agent {
  recent_address: string | null;
  recent_customer: string | null;
  recent_role: AgentRole | null;
}

export interface Lead {
  id: string;
  week_added: string | null;
  job_id: string | null;
  job_number: string | null;
  job_date: string | null;
  customer_name: string | null;
  house_address: string | null;
  address_key: string | null;
  agent_role: AgentRole | null;
  agent_id: string | null;
  sale_date: string | null;
  status: string;
  job_revenue: number | null;
  redfin_link: string | null;
  created_at: string;
}

export interface Touch {
  id: string;
  agent_id: string;
  lead_id: string | null;
  channel: Channel;
  outcome: string | null;
  got_response: boolean;
  notes: string | null;
  occurred_at: string;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  sm_job_id: string | null;
  job_number: string | null;
  opportunity_status: string | null;
  job_date: string | null;
  job_type: string | null;
  opportunity_type: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  branch_name: string | null;
  sales_person: string | null;
  referral_source: string | null;
  revenue: number | null;
  origin_address: string | null;
  destination_address: string | null;
  imported_at: string;
}

export interface Run {
  id: string;
  run_date: string;
  jobs_in_data: number | null;
  addresses_processed: number | null;
  new_leads: number | null;
  new_agents: number | null;
  rechecks_resolved: number | null;
  flagged_for_review: number | null;
  notes: string | null;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  owner_name: Owner | null;
}

/** Outcomes offered when logging a call. */
export const CALL_OUTCOMES = [
  "Connected",
  "Voicemail",
  "No answer",
  "Wrong number",
  "Not interested",
  "Call back later",
  "Referral promised",
] as const;

/** Seed of public.people, kept as the fallback when that query has not
 *  resolved yet. Mirrors OWNERS in pipeline/config.py. */
export const OWNERS: Owner[] = ["Andrew", "Avery"];

export const RELATIONSHIP_STATUSES = [
  "New — not contacted",
  "Contacted",
  "Engaged",
  "Referral partner",
  "Not interested",
  "DO NOT CONTACT",
] as const;

export interface Person {
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

/** The single row of public.settings. */
export interface Settings {
  id: boolean;

  app_name: string;
  logo_url: string | null;
  accent_color: string;
  login_blurb: string;

  follow_up_days: number;
  due_window_days: number;
  default_owner: string | null;

  signature: string;
  text_template: string;
  email_subject: string;
  email_body: string;
  call_script: string;
  call_script_repeat: string;

  updated_at: string;
  updated_by: string | null;
}

/** The cosmetic subset of settings, readable before sign-in via public.branding. */
export interface Branding {
  app_name: string;
  logo_url: string | null;
  accent_color: string;
  login_blurb: string;
}
