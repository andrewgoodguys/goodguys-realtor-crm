"""Split a brokerage string into brand and office.

TWO COPIES. This file and goodguys-pipeline/pipeline/brokerages.py are the same
module and must stay identical — this repo needs it to import the workbook and
to fix up rows already stored, and the pipeline needs it to write agents to the
CRM directly. Same arrangement as src/lib/templates.ts and pipeline/messages.py.

This repo has no Python test harness, so the check lives in the other one:
goodguys-pipeline/tests/test_brokerages.py loads *this* file and runs both
copies over one case list. Change one, change the other, then run that.

The workbook has one free-text field where two things live. Sometimes it is
purely a firm — "Dorsey Alston Realtors". Sometimes the branch is welded onto
the front brand — "Keller Williams Realty Peachtree Rd." is the Peachtree Rd.
market center of Keller Williams. Sometimes it carries a co-brand behind a pipe
— "Ansley Real Estate | Christie's International". Sometimes a city in
parentheses — "Ware Jones, REALTORS (Memphis, TN)".

Splitting matters twice over:

  * the CRM groups agents by brokerage and then by office, so "Keller Williams
    Realty Atlanta Partners" and "Keller Williams North Atlanta" have to land
    under one Keller Williams with two offices, not as two brokerages;
  * owner_for_brokerage() hashes this field, so what counts as the brokerage
    decides whose call list an agent is on.

Deliberately conservative. A tail is only treated as an office when the string
opens with a franchise brand we recognise; otherwise office stays null and the
whole string stays the brokerage. Guessing that the last word of "Candler Real
Estate Group, LLC" is a branch would be worse than knowing nothing.
"""
from __future__ import annotations

import re

# (prefix to match, brand to record). Longest prefix first: "Keller Williams
# Realty" has to win over "Keller Williams", or every market center keeps a
# stray "Realty" on the front. Both spellings record the same brand, because
# "Keller Williams Realty Atlanta Partners" and "Keller Williams North Atlanta"
# are two market centers of one company, not two companies. "Keller Knapp" is a
# different firm entirely and matches neither.
FRANCHISES = (
    ("Better Homes and Gardens Real Estate", "Better Homes and Gardens"),
    ("Berkshire Hathaway HomeServices", "Berkshire Hathaway HomeServices"),
    ("Keller Williams Realty", "Keller Williams"),
    ("Keller Williams", "Keller Williams"),
    ("Realty One Group", "Realty One Group"),
    ("Coldwell Banker", "Coldwell Banker"),
    ("Century 21", "Century 21"),
    ("BHGRE", "Better Homes and Gardens"),
    ("RE/MAX", "RE/MAX"),
)

# A tail that is only a category word is the brand's own suffix, not a branch.
# "Coldwell Banker Realty" is Coldwell Banker; it is not the Realty office.
GENERIC_TAILS = {
    "",
    "realty",
    "realtors",
    "real estate",
    "residential real estate",
    "properties",
    "group",
    "inc",
    "inc.",
    "llc",
    "llc.",
}

_WS = re.compile(r"\s+")
_PARENTHETICAL = re.compile(r"^(.*?)\s*\(([^()]+)\)\s*$")
# Virtual Properties Realty, .com and .Biz are one firm with three spellings.
_DOMAIN_SUFFIX = re.compile(r"\.(com|biz|net)\b\.?\s*$", re.IGNORECASE)


def tidy(value: str) -> str:
    """Collapse whitespace and fold the spellings that are plainly the same."""
    s = _WS.sub(" ", (value or "").strip())
    s = s.replace(" & ", " and ")
    s = _DOMAIN_SUFFIX.sub("", s)
    return s.strip(" .,")


def office_name(tail: str) -> str:
    """Market center names, spelled one way. "Atl North" is "Atlanta North"."""
    return re.sub(r"\bAtl\b", "Atlanta", tail)


def split_brokerage(value: str | None) -> tuple[str | None, str | None]:
    """(brokerage, office). Either may be None; office usually is.

    >>> split_brokerage("Keller Williams Realty Peachtree Rd.")
    ('Keller Williams', 'Peachtree Rd')
    >>> split_brokerage("Coldwell Banker Realty")
    ('Coldwell Banker', None)
    >>> split_brokerage("Ansley Real Estate | Christie's International")
    ('Ansley Real Estate', None)
    >>> split_brokerage("Ware Jones, REALTORS (Memphis, TN)")
    ('Ware Jones, REALTORS', 'Memphis, TN')
    >>> split_brokerage("Dorsey Alston Realtors")
    ('Dorsey Alston Realtors', None)
    """
    if not value or not value.strip():
        return None, None

    # A co-brand is not an office. Keep the firm we actually deal with.
    head = value.split("|")[0]
    clean = tidy(head)

    office = None
    m = _PARENTHETICAL.match(clean)
    if m:
        clean, office = tidy(m.group(1)), tidy(m.group(2))

    for prefix, brand in FRANCHISES:
        if clean.lower().startswith(prefix.lower()):
            tail = tidy(clean[len(prefix) :])
            if tail.lower() in GENERIC_TAILS:
                return brand, office
            return brand, office or office_name(tail)

    return clean or None, office
