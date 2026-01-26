"""Generate Instagram caption from research output."""


HASHTAGS = [
    "#montreal", "#mtl", "#montrealhistory", "#montréal",
    "#oldmontreal", "#vintagemontreal", "#throwbackmtl",
    "#montrealnostalgia", "#514", "#quebec", "#archives",
    "#histoiredemontreal", "#patrimoine", "#portdemontreal",
]


def generate_caption(research: dict, extra_tags: list[str] | None = None) -> str:
    """
    Generate a bilingual (FR/EN) Instagram caption from research.

    Format:
    - Hook line (FR)
    - Hook line (EN)
    - Blank line
    - 2-3 facts (bilingual)
    - Blank line
    - CTA
    - Blank line
    - Hashtags
    """
    title = research.get("title", "Montreal Archives")
    era = research.get("era", "")
    who = research.get("who", "")
    what = research.get("what", "")
    context = research.get("context", "")
    legacy = research.get("legacy", "")
    fun_fact = research.get("fun_fact", "")
    location = research.get("location", "Montreal")

    lines = []

    # Hook - bilingual
    if era:
        lines.append(f"📍 {location}, {era}")
    else:
        lines.append(f"📍 {location}")
    lines.append("")

    # Main content
    if who:
        lines.append(who)
    if what:
        lines.append(what)
    lines.append("")

    if context:
        lines.append(context)
    if legacy:
        lines.append(legacy)
    lines.append("")

    if fun_fact:
        lines.append(f"💡 {fun_fact}")
        lines.append("")

    # CTA
    lines.append("📖 Suivez @mtlarchives pour l'histoire quotidienne de Montréal")
    lines.append("📖 Follow @mtlarchives for daily Montreal history")
    lines.append("")

    # Hashtags
    tags = list(HASHTAGS)
    if extra_tags:
        tags.extend(extra_tags)
    # Add research-derived tags
    for t in research.get("tags", []):
        tag = f"#{t.lower().replace(' ', '').replace('-', '')}"
        if tag not in tags:
            tags.append(tag)

    lines.append(" ".join(tags[:30]))  # IG limit ~30 hashtags

    return "\n".join(lines)
