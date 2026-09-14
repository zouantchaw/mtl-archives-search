"""Frozen onboarding policy. The agent cannot rewrite it."""

from types import MappingProxyType

REVIEW_REASONS = frozenset(
    {"missing_rights", "conflict", "quality_failure", "over_budget"}
)
ROUTINE = "auto"
REVIEW = "review"

POLICY = MappingProxyType(
    {
        "budget_usd": 0.05,
        "usd_per_record": 0.006,
        "release": "private_candidate",
        "production": False,
        "review_reasons": REVIEW_REASONS,
    }
)


def classify_record(record, *, duplicate_ids, failed_ids, estimate_usd):
    reasons = []
    if not (record.get("canonical") or {}).get("attribution"):
        reasons.append("missing_rights")
    if record["id"] in duplicate_ids:
        reasons.append("conflict")
    if record["id"] in failed_ids:
        reasons.append("quality_failure")
    if estimate_usd > POLICY["budget_usd"]:
        reasons.append("over_budget")
    action = REVIEW if set(reasons) & POLICY["review_reasons"] else ROUTINE
    return {"id": record["id"], "action": action, "reasons": reasons}


def review_scope(reason, cote=None, record_id=None):
    """Rights approval for a cote does not cover a conflict on the same cote."""
    return f"{reason}:{cote or record_id}"
