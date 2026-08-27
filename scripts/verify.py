#!/usr/bin/env python3
"""Report row counts and a few sanity checks against the CRM database.

    set SUPABASE_URL=https://<ref>.supabase.co
    set SUPABASE_SERVICE_KEY=<service_role key>
    python scripts/verify.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not (URL and KEY):
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")

TABLES = ["jobs", "agents", "leads", "touches", "runs", "profiles"]
VIEWS = ["due_this_week", "agent_summary"]


def get(path: str, count: bool = False):
    req = urllib.request.Request(
        f"{URL}/rest/v1/{path}",
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            **({"Prefer": "count=exact", "Range": "0-0"} if count else {}),
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            total = None
            cr = resp.headers.get("Content-Range")
            if cr and "/" in cr:
                total = cr.split("/")[-1]
            return total, json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        return f"ERR{e.code}", e.read().decode("utf-8", "replace")


print(f"{URL}\n")
print("row counts")
for name in TABLES + VIEWS:
    total, _ = get(f"{name}?select=id", count=True)
    print(f"  {name:<16} {total}")

print("\nowner split")
for owner in ("Andrew", "Avery"):
    total, _ = get(f"agents?select=id&owner_name=eq.{owner}", count=True)
    print(f"  {owner:<16} {total}")

print("\nleads linked to an agent")
linked, _ = get("leads?select=id&agent_id=not.is.null", count=True)
orphan, _ = get("leads?select=id&agent_id=is.null", count=True)
print(f"  linked           {linked}")
print(f"  no agent         {orphan}")

print("\ntop of the call list")
_, rows = get("due_this_week?select=name,brokerage,priority,phone,owner_name"
              "&order=priority.desc&limit=5")
if isinstance(rows, list):
    for r in rows:
        print(f"  {r['priority']:>5}  {r['name'][:24]:<24} "
              f"{(r.get('brokerage') or '')[:22]:<22} {r.get('owner_name')}")

print("\nencoding check (em dash must survive as U+2014)")
_, rows = get("agents?select=relationship_status&limit=1")
if isinstance(rows, list) and rows:
    status = rows[0]["relationship_status"]
    ok = "—" in status or "—" in status
    print(f"  {status!r}  {'OK' if ok else 'MOJIBAKE'}")
