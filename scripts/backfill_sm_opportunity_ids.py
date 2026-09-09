#!/usr/bin/env python3
"""Fill jobs.sm_opportunity_id from the SmartMoving Open API.

A SmartMoving deep link needs two ids:

    https://app.smartmoving.com/opportunities/{opportunityId}/sales?jobId={jobId}

The All Jobs export gives us the second (jobs.sm_job_id) and cannot give us the
first. This fetches it, keyed on the quote number: job_number is "{quote}-{seq}",
so "1981-1" asks the API for quote 1981.

    set SUPABASE_URL=https://<ref>.supabase.co
    set SUPABASE_SERVICE_KEY=<service_role key>
    set SMARTMOVING_API_KEY=<key from Settings > Integrations > SmartMoving API>
    python scripts/backfill_sm_opportunity_ids.py --probe        # check creds
    python scripts/backfill_sm_opportunity_ids.py --limit 5      # small run
    python scripts/backfill_sm_opportunity_ids.py

Resumable and idempotent: it only asks about jobs whose sm_opportunity_id is
still null, so a rerun picks up where an interrupted run stopped. One request
per *quote*, not per job, and every job sharing that quote is written at once.

Keys come from the environment and are never written anywhere. The service_role
key bypasses RLS, which a bulk update needs; it is not the anon key.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict


def clean_key(name: str, value: str) -> str:
    """A credential, or exit saying what is wrong with it.

    Keys arrive by copy-paste and by shell expression, and both go wrong in
    ways that surface far from the cause - a key that is really four keys
    joined by spaces reaches urllib as a 500-character header and dies inside
    the latin-1 encoder. src/lib/env.ts does the same job for the browser.
    """
    v = (value or "").strip().strip("|│")
    if not v:
        return ""
    if any(c.isspace() for c in v):
        sys.exit(
            f"{name} contains whitespace, so it is not one key. A shell "
            "expression that selects several rows will do this - re-set it and "
            "check the length before rerunning."
        )
    if not v.isascii():
        sys.exit(f"{name} has non-ASCII characters in it - it picked up terminal spill.")
    return v


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = clean_key("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_KEY", ""))

SM_API_KEY = clean_key("SMARTMOVING_API_KEY", os.environ.get("SMARTMOVING_API_KEY", ""))
# Only some tenants are issued one. Sent when present, omitted when not.
SM_SUBSCRIPTION_KEY = clean_key(
    "SMARTMOVING_SUBSCRIPTION_KEY", os.environ.get("SMARTMOVING_SUBSCRIPTION_KEY", "")
)
SM_BASE_URL = os.environ.get(
    "SMARTMOVING_BASE_URL", "https://api-public.smartmoving.com/v1"
).rstrip("/")

# Courtesy gap between calls. The API is not documented as rate limited, but a
# few hundred sequential requests deserve one anyway.
SLEEP_SECONDS = 0.15


# --------------------------------------------------------------- supabase
def sb_get(path: str):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def sb_patch(job_ids: list[str], opportunity_id: str) -> None:
    """Set sm_opportunity_id on every job of one quote, in one request."""
    ids = ",".join(f'"{i}"' for i in job_ids)
    url = f"{SUPABASE_URL}/rest/v1/jobs?id=in.({ids})"
    req = urllib.request.Request(
        url,
        data=json.dumps({"sm_opportunity_id": opportunity_id}).encode("utf-8"),
        method="PATCH",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"\nWriting opportunity {opportunity_id} failed ({e.code}):\n{body}")


# ------------------------------------------------------------ smartmoving
class NotFound(Exception):
    """The API answered, and has no such quote."""


def sm_headers() -> dict[str, str]:
    headers = {"x-api-key": SM_API_KEY, "Content-Type": "application/json"}
    if SM_SUBSCRIPTION_KEY:
        headers["Ocp-Apim-Subscription-Key"] = SM_SUBSCRIPTION_KEY
    return headers


def fetch_opportunity(quote: str) -> dict:
    """GET /api/opportunities/quote/{n}. Raises NotFound on a 404."""
    url = f"{SM_BASE_URL}/api/opportunities/quote/{urllib.parse.quote(quote)}"
    req = urllib.request.Request(url, headers=sm_headers())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        if e.code == 404:
            raise NotFound(body) from e
        if e.code in (401, 403):
            sys.exit(
                f"\nSmartMoving rejected the key ({e.code}) on {url}\n{body}\n\n"
                "Check SMARTMOVING_API_KEY, and whether this tenant also needs\n"
                "SMARTMOVING_SUBSCRIPTION_KEY or a different SMARTMOVING_BASE_URL."
            )
        raise


def quote_of(job_number: str) -> str | None:
    """Turn "1981-1" into "1981". None if it is not shaped like a job number."""
    head = (job_number or "").split("-")[0].strip()
    return head if head.isdigit() else None


# ------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--probe",
        action="store_true",
        help="Resolve one quote, print what came back, write nothing.",
    )
    ap.add_argument("--limit", type=int, help="Stop after this many quotes.")
    ap.add_argument(
        "--dry-run", action="store_true", help="Fetch, report, write nothing."
    )
    args = ap.parse_args()

    if not (SUPABASE_URL and SERVICE_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    if not SM_API_KEY:
        sys.exit(
            "Set SMARTMOVING_API_KEY. Get one from SmartMoving:\n"
            "  Settings > Integrations > SmartMoving API > toggle on."
        )

    rows = sb_get(
        "jobs?select=id,job_number,sm_job_id"
        "&sm_opportunity_id=is.null&job_number=not.is.null"
        "&order=job_number.desc&limit=100000"
    )

    by_quote: dict[str, list[dict]] = defaultdict(list)
    unparseable = 0
    for r in rows:
        q = quote_of(r["job_number"])
        if q is None:
            unparseable += 1
            continue
        by_quote[q].append(r)

    print(f"{len(rows)} job(s) without an opportunity id -> {len(by_quote)} quote(s)")
    if unparseable:
        print(f"  {unparseable} skipped: job_number is not '<quote>-<seq>'")
    if not by_quote:
        print("Nothing to do.")
        return

    quotes = sorted(by_quote, key=int, reverse=True)
    if args.probe:
        quotes = quotes[:1]
    elif args.limit:
        quotes = quotes[: args.limit]

    print(f"Asking SmartMoving about {len(quotes)} quote(s) at {SM_BASE_URL}\n")

    resolved = missing = mismatched = 0
    for n, quote in enumerate(quotes, start=1):
        jobs = by_quote[quote]
        try:
            opp = fetch_opportunity(quote)
        except NotFound:
            missing += 1
            print(f"  {quote:<8} no such quote - left null")
            time.sleep(SLEEP_SECONDS)
            continue

        opportunity_id = opp.get("id")
        if not opportunity_id:
            missing += 1
            print(f"  {quote:<8} response had no id - left null")
            time.sleep(SLEEP_SECONDS)
            continue

        if args.probe:
            customer = (opp.get("customer") or {}).get("name")
            print(f"  quote {quote} -> opportunity {opportunity_id}")
            print(f"  customer: {customer}")
            print(f"  jobs on the opportunity: {len(opp.get('jobs') or [])}")
            print("\n  Links this would produce:")
            for j in jobs:
                print(
                    f"    {j['job_number']}  ->  https://app.smartmoving.com"
                    f"/opportunities/{opportunity_id}/sales?jobId={j['sm_job_id']}"
                )
            print("\nProbe only - nothing written.")
            return

        # The export's Job Id should be one of the opportunity's jobs. When it
        # is not, the quote number still resolved but we would be pointing at
        # the wrong record, so say so rather than write it quietly.
        sm_job_ids = {
            (j or {}).get("id") for j in (opp.get("jobs") or []) if isinstance(j, dict)
        }
        ours = {j["sm_job_id"] for j in jobs if j["sm_job_id"]}
        if sm_job_ids and ours and not (ours & sm_job_ids):
            mismatched += 1
            print(f"  {quote:<8} job ids do not match the opportunity - left null")
            time.sleep(SLEEP_SECONDS)
            continue

        if not args.dry_run:
            sb_patch([j["id"] for j in jobs], opportunity_id)
        resolved += 1
        if n % 25 == 0 or n == len(quotes):
            print(f"  {n}/{len(quotes)} quotes - {resolved} resolved")
        time.sleep(SLEEP_SECONDS)

    print(
        f"\nDone. {resolved} quote(s) resolved, {missing} not found"
        + (f", {mismatched} mismatched" if mismatched else "")
        + (" (dry run - nothing written)" if args.dry_run else "")
    )


if __name__ == "__main__":
    main()
