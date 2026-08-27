#!/usr/bin/env python3
"""One-time import: GoodGuys Realtor Referral Pipeline.xlsx -> Supabase.

Reads the existing workbook and loads it into the CRM tables. Safe to re-run:
every table is upserted on a natural key, so a second run updates rather than
duplicates.

    set SUPABASE_URL=https://<ref>.supabase.co
    set SUPABASE_SERVICE_KEY=<service_role key>
    python scripts/import_workbook.py [--dry-run]

The service_role key bypasses RLS, which is what a bulk import needs. Keep it
out of the app and out of git — it is not the anon key the browser uses.

Excel tab            -> table
  Data               -> jobs
  Agent Outreach     -> leads
  Outreach Tracker   -> agents  (+ touches, from the human-owned columns)
  Run Log            -> runs
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("pip install openpyxl")

WORKBOOK = Path(
    os.environ.get(
        "GG_WORKBOOK",
        r"C:\Users\andre\OneDrive\Documents\Sales\Realtor Outreach"
        r"\GoodGuys Realtor Referral Pipeline.xlsx",
    )
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

OWNERS = ("Andrew", "Avery")
BATCH = 200


# --------------------------------------------------------------- owner split
# Ported verbatim from goodguys-pipeline/pipeline/owners.py. md5, not hash(),
# because CPython salts hash() per process and the split must be stable.
_SUFFIXES = re.compile(
    r"\b(realty|realtors|real estate|llc|inc|co|company|group|"
    r"the|of|and|intown|atlanta|georgia|ga)\b"
)


def normalize_brokerage(name: str) -> str:
    if not name:
        return ""
    s = re.sub(r"[^a-z0-9 ]+", " ", name.lower())
    s = _SUFFIXES.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def owner_for_brokerage(brokerage: str) -> str:
    key = normalize_brokerage(brokerage or "")
    if not key:
        return OWNERS[0]
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return OWNERS[int(digest, 16) % len(OWNERS)]


# ------------------------------------------------------------ address key
_PUNCT = re.compile(r"[.,#]+")
_WS = re.compile(r"\s+")
_ABBR = {
    "street": "ST", "st": "ST", "avenue": "AVE", "ave": "AVE",
    "road": "RD", "rd": "RD", "drive": "DR", "dr": "DR",
    "lane": "LN", "ln": "LN", "court": "CT", "ct": "CT",
    "circle": "CIR", "cir": "CIR", "place": "PL", "pl": "PL",
    "boulevard": "BLVD", "blvd": "BLVD", "terrace": "TER", "ter": "TER",
    "parkway": "PKWY", "pkwy": "PKWY", "trail": "TRL", "trl": "TRL",
    "way": "WAY", "highway": "HWY", "hwy": "HWY",
    "northeast": "NE", "northwest": "NW", "southeast": "SE",
    "southwest": "SW", "north": "N", "south": "S", "east": "E", "west": "W",
}


def normalize_address(addr) -> str:
    if not addr:
        return ""
    s = _PUNCT.sub(" ", str(addr)).lower()
    s = _WS.sub(" ", s).strip()
    return _WS.sub(" ", " ".join(_ABBR.get(p, p) for p in s.split(" "))).upper().strip()


# ----------------------------------------------------------------- helpers
def clean(value):
    """Excel cells arrive with mojibake em-dashes and stray whitespace."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.replace("\ufffd", "—").strip()
        return s or None
    return value


def as_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str) and value.strip():
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
            try:
                return datetime.strptime(value.strip(), fmt).date().isoformat()
            except ValueError:
                continue
    return None


def as_num(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value):
    n = as_num(value)
    return int(n) if n is not None else None


def name_key(name: str) -> str:
    return _WS.sub(" ", (name or "").strip().lower())


def phone_type_of(phone, office_hint=None) -> str:
    p = (phone or "").strip().lower()
    if not p or p.startswith("tbd"):
        return "unknown"
    if office_hint and "office" in str(office_hint).lower():
        return "office"
    return "direct"


def role_of(raw) -> str | None:
    s = (raw or "").strip().lower()
    if "listing" in s:
        return "listing"
    if "buying" in s or "buyer" in s:
        return "buying"
    return None


def read_tab(wb, title: str) -> list[dict]:
    if title not in wb.sheetnames:
        print(f"  ! tab '{title}' not found, skipping")
        return []
    ws = wb[title]
    rows = ws.iter_rows(values_only=True)
    headers = [clean(h) for h in next(rows)]
    out = []
    for row in rows:
        record = {h: clean(v) for h, v in zip(headers, row) if h}
        if any(v is not None for v in record.values()):
            out.append(record)
    return out


# ---------------------------------------------------------------- PostgREST
def post(table: str, rows: list[dict], on_conflict: str | None = None) -> int:
    """Upsert rows in batches. Returns the number sent."""
    if not rows:
        return 0
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        if on_conflict:
            url += f"?on_conflict={on_conflict}"
        req = urllib.request.Request(
            url,
            data=json.dumps(chunk).encode("utf-8"),
            method="POST",
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
            sent += len(chunk)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            sys.exit(f"\n{table} batch {i // BATCH + 1} failed ({e.code}):\n{body}")
    return sent


def fetch_agent_ids() -> dict[str, str]:
    """name_key -> uuid, so leads and touches can be linked after the fact."""
    url = f"{SUPABASE_URL}/rest/v1/agents?select=id,name_key&limit=10000"
    req = urllib.request.Request(
        url, headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    )
    with urllib.request.urlopen(req) as resp:
        return {r["name_key"]: r["id"] for r in json.loads(resp.read())}


# -------------------------------------------------------------------- build
def build_jobs(rows) -> list[dict]:
    out = []
    for r in rows:
        job_id = r.get("Job Id")
        if not job_id:
            continue
        out.append(
            {
                "sm_job_id": str(job_id),
                "job_number": r.get("Job Number"),
                "opportunity_status": r.get("Opportunity Status"),
                "job_date": as_date(r.get("Job Date")),
                "job_type": r.get("Job Type"),
                "opportunity_type": r.get("Opportunity Type"),
                "customer_name": r.get("Customer Name"),
                "customer_phone": r.get("Customer Phone"),
                "customer_email": r.get("Customer Email"),
                "branch_name": r.get("Branch Name"),
                "sales_person": r.get("Sales Person Name"),
                "referral_source": r.get("Referral Source"),
                # Actual if the job is closed out, else the estimate.
                "revenue": as_num(r.get("Total Actual Cost"))
                or as_num(r.get("Total Estimated Cost")),
                "origin_address": r.get("Origin Address"),
                "destination_address": r.get("Destination Address"),
            }
        )
    return out


def build_agents(tracker, summary) -> list[dict]:
    """Outreach Tracker is authoritative; Agent Summary adds revenue."""
    revenue_by_key = {
        name_key(r.get("Agent Name", "")): as_num(r.get("Revenue (full credit)")) or 0
        for r in summary
        if r.get("Agent Name")
    }

    out, seen = [], set()
    for r in tracker:
        name = r.get("Agent Name")
        if not name:
            continue
        key = name_key(name)
        if key in seen:  # one row per agent, forever
            continue
        seen.add(key)

        office = r.get("Office")
        status = r.get("Relationship Status") or "New — not contacted"
        dnc = "do not contact" in status.lower()

        out.append(
            {
                "name": name,
                "name_key": key,
                "brokerage": office,
                "phone": r.get("Phone"),
                "phone_type": phone_type_of(r.get("Phone"), office),
                "email": r.get("Email"),
                "owner_name": owner_for_brokerage(office or ""),
                "lifetime_jobs": as_int(r.get("# Jobs (lifetime)")) or 0,
                "lifetime_revenue": revenue_by_key.get(key, 0),
                "most_recent_job": as_date(r.get("Most Recent Job")),
                "relationship_status": status,
                "priority": as_num(r.get("Priority")) or 0,
                "do_not_contact": dnc,
                "last_touch": as_date(r.get("Last Touch")),
                "next_touch_due": as_date(r.get("Next Touch Due")),
                "notes": r.get("Notes"),
            }
        )
    return out


def build_leads(rows, agent_ids) -> list[dict]:
    out, seen = [], set()
    for r in rows:
        address = r.get("House Address")
        addr_key = normalize_address(address)
        role = role_of(r.get("Agent Role"))
        # The DB has a unique index on (address_key, agent_role); collapse
        # duplicates here so the upsert has one row per pair.
        dedupe = (addr_key, role)
        if addr_key and role:
            if dedupe in seen:
                continue
            seen.add(dedupe)

        agent_name = r.get("Agent Name")
        out.append(
            {
                "week_added": r.get("Week Added"),
                "job_number": r.get("Job #"),
                "job_date": as_date(r.get("Job Date")),
                "customer_name": r.get("Customer Name"),
                "house_address": address,
                "address_key": addr_key or None,
                "agent_role": role,
                "agent_id": agent_ids.get(name_key(agent_name)) if agent_name else None,
                "sale_date": as_date(r.get("Sale Date (Redfin)")),
                "status": r.get("Status") or "New",
                "job_revenue": as_num(r.get("Job Revenue")),
                "redfin_link": r.get("Redfin Link"),
            }
        )
    return out


def build_touches(tracker, agent_ids) -> list[dict]:
    """The six human-owned columns become activity-log rows.

    Anything Andrew or Avery typed into Email Sent / Text Sent / Call Made is
    real outreach history and must survive the migration.
    """
    channels = [("Email Sent", "email"), ("Text Sent", "text"), ("Call Made", "call")]
    out = []
    for r in tracker:
        name = r.get("Agent Name")
        agent_id = agent_ids.get(name_key(name or ""))
        if not agent_id:
            continue

        outcome = r.get("Call Outcome")
        response = r.get("Response?")
        got_response = bool(response) and str(response).strip().lower() not in {
            "no", "none", "n", "false", "-",
        }

        for column, channel in channels:
            marker = r.get(column)
            if not marker:
                continue
            when = as_date(marker) or as_date(r.get("Last Touch"))
            out.append(
                {
                    "agent_id": agent_id,
                    "channel": channel,
                    "outcome": outcome if channel == "call" else None,
                    "got_response": got_response,
                    "notes": f"Imported from workbook ({column}: {marker})",
                    "occurred_at": f"{when}T12:00:00Z" if when else None,
                    "created_by_email": "import@goodguysserve.com",
                }
            )
    return [t for t in out if t["occurred_at"]]


def build_runs(rows) -> list[dict]:
    out = []
    for r in rows:
        run_date = as_date(r.get("Run Date"))
        if not run_date:
            continue
        out.append(
            {
                "run_date": run_date,
                "jobs_in_data": as_int(r.get("Jobs in Data tab")),
                "addresses_processed": as_int(r.get("Addresses processed")),
                "new_leads": as_int(r.get("New leads (agent rows)")),
                "new_agents": as_int(r.get("New agents added")),
                "rechecks_resolved": as_int(r.get("Rechecks resolved")),
                "flagged_for_review": as_int(r.get("Flagged for review")),
                "notes": r.get("Notes"),
            }
        )
    return out


# --------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="parse only, write nothing")
    ap.add_argument("--workbook", type=Path, default=WORKBOOK)
    args = ap.parse_args()

    if not args.workbook.exists():
        sys.exit(f"Workbook not found: {args.workbook}")
    if not args.dry_run and not (SUPABASE_URL and SERVICE_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or pass --dry-run).")

    print(f"Reading {args.workbook.name}")
    wb = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)

    data = read_tab(wb, "Data")
    outreach = read_tab(wb, "Agent Outreach")
    tracker = read_tab(wb, "Outreach Tracker")
    summary = read_tab(wb, "Agent Summary")
    run_log = read_tab(wb, "Run Log")

    jobs = build_jobs(data)
    agents = build_agents(tracker, summary)
    runs = build_runs(run_log)

    print(f"  Data            {len(data):>4} rows -> {len(jobs)} jobs")
    print(f"  Outreach Tracker{len(tracker):>4} rows -> {len(agents)} agents")
    print(f"  Agent Outreach  {len(outreach):>4} rows")
    print(f"  Run Log         {len(run_log):>4} rows -> {len(runs)} runs")

    split = {o: sum(1 for a in agents if a["owner_name"] == o) for o in OWNERS}
    print(f"  Split: {split}")

    if args.dry_run:
        print("\nDry run — nothing written.")
        for a in agents[:3]:
            print(f"    {a['name']:<28} {a['brokerage']} -> {a['owner_name']}")
        return

    print("\nWriting…")
    print(f"  jobs   {post('jobs', jobs, on_conflict='sm_job_id')}")
    print(f"  agents {post('agents', agents, on_conflict='name_key')}")
    print(f"  runs   {post('runs', runs)}")

    # Leads and touches need agent UUIDs, so they go after agents land.
    agent_ids = fetch_agent_ids()
    print(f"  resolved {len(agent_ids)} agent ids")

    leads = build_leads(outreach, agent_ids)
    print(f"  leads  {post('leads', leads, on_conflict='address_key,agent_role')}")

    touches = build_touches(tracker, agent_ids)
    print(f"  touches{post('touches', touches):>4}")

    linked = sum(1 for lead in leads if lead["agent_id"])
    print(f"\nDone. {linked}/{len(leads)} leads linked to an agent.")


if __name__ == "__main__":
    main()
