"""Selective fallback. Missing EXIF is not a reason to spend a frontier model."""

from orientation import read_exif_orientation

ROTATED_EXIF = {6, 8}
HARD_KINDS = {"map", "document"}


def escalation_reasons(jpeg_bytes, cheap_visual=None, review=None):
    review = review or {}
    cheap_visual = cheap_visual or {}
    reasons = []
    tag = read_exif_orientation(jpeg_bytes)
    if tag in ROTATED_EXIF:
        reasons.append("exif_rotated")
    if review.get("sideways") is True:
        reasons.append("reviewed_sideways")
    kind = cheap_visual.get("image_kind") or review.get("image_kind")
    if kind in HARD_KINDS:
        reasons.append("kind_" + kind)
    return reasons


def should_escalate(jpeg_bytes, cheap_visual=None, review=None):
    return bool(escalation_reasons(jpeg_bytes, cheap_visual, review))
