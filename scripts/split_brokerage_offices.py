#!/usr/bin/env python3
"""One-time: split existing agents' brokerage into brokerage + office.

The workbook kept the branch inside the brokerage name, so the CRM has 71
distinct brokerage strings for what is really 49 firms — thirteen of them
Keller Williams market centers filed as thirteen separate companies. This
applies scripts/brokerages.py:split_brokerage() to every agent already in the
database, so the brokerage pages can group by firm and drill into office.

    set SUPABASE_URL=https://<ref>.supabase.co
    set SUPABASE_SERVICE_KEY=<service_role key>
    python scripts/split_brokerage_offices.py --dry-run    # read the report first
    python scripts/split_brokerage_offices.py

**It moves agents between Andrew and Avery.** owner_for_brokerage() hashes the
brokerage, so shortening "Keller Williams Realty Peachtree Rd." to "Keller
Williams" moves that agent to whichever bucket the shorter name hashes into —
and moves every other Keller Williams agent to that same bucket, which is the
point: one firm, one owner. --dry-run prints the before and after counts before
anything is written.

Never overwrites an office that is already set: a value typed into the agent
page beats one derived from a brokerage string.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict

from brokerages import split_brokerage
from import_workbook import owner_for_brokerage

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def sb_get(path: str):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def sb_patch(agent_ids: list[str], patch: dict) -> None:
    ids = ",".join(f'"{i}"' for i in agent_ids)
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/agents?id=in.({ids})",
        data=json.dumps(patch).encode("utf-8"),
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
        sys.exit(f"\nPATCH failed ({e.code}):\n{e.read().decode('utf-8', 'replace')}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Report, write nothing.")
    ap.add_argument(
        "--keep-owners",
        action="store_true",
        help="Split names but leave owner_name alone (no reshuffle).",
    )
    args = ap.parse_args()

    if not (SUPABASE_URL and SERVICE_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")

    agents = sb_get("agents?select=id,name,brokerage,office,owner_name&limit=10000")
    print(f"{len(agents)} agents\n")

    # (brokerage, office, owner) -> ids, so one PATCH covers a whole group.
    groups: dict[tuple, list[str]] = defaultdict(list)
    before_owner, after_owner = Counter(), Counter()
    before_names, after_names = set(), set()
    moved = renamed = 0

    for a in agents:
        old_brokerage = a["brokerage"]
        old_office = a["office"]
        old_owner = a["owner_name"]
        before_owner[old_owner or "unassigned"] += 1
        if old_brokerage:
            before_names.add(old_brokerage)

        brokerage, office = split_brokerage(old_brokerage)
        # A hand-typed office is better information than a parsed one.
        office = old_office or office
        owner = old_owner if args.keep_owners else owner_for_brokerage(brokerage or "")

        after_owner[owner or "unassigned"] += 1
        if brokerage:
            after_names.add(brokerage)
        if brokerage != old_brokerage or office != old_office:
            renamed += 1
        if owner != old_owner:
            moved += 1

        groups[(brokerage, office, owner)].append(a["id"])

    offices = sorted({o for _, o, _ in groups if o})
    print(f"brokerage strings : {len(before_names)} -> {len(after_names)}")
    print(f"offices recorded  : {len(offices)}")
    print(f"rows changing     : {renamed}")
    print(f"owner changing    : {moved}\n")

    width = max(len(k) for k in set(before_owner) | set(after_owner))
    print("owner split")
    for who in sorted(set(before_owner) | set(after_owner)):
        b, a_ = before_owner[who], after_owner[who]
        arrow = "  (unchanged)" if b == a_ else f"  ({a_ - b:+d})"
        print(f"  {who:<{width}}  {b:>4} -> {a_:>4}{arrow}")

    if args.dry_run:
        print("\nDry run — nothing written.")
        print("Offices that would be recorded:")
        for o in offices:
            print(f"  {o}")
        return

    for (brokerage, office, owner), ids in groups.items():
        sb_patch(ids, {"brokerage": brokerage, "office": office, "owner_name": owner})
    print(f"\nDone. {len(groups)} group(s) written.")


if __name__ == "__main__":
    main()
