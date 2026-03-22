"""Weekday theme schedule and editorial briefs for the local social fallback."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class ThemeSpec:
    key: str
    label: str
    description: str
    editorial_brief: str


THEME_SCHEDULE: dict[str, ThemeSpec] = {
    "monday": ThemeSpec(
        key="mystery",
        label="Secret/Mystery",
        description="Hidden, forgotten, or unresolved Montreal stories.",
        editorial_brief=(
            "Lead with a visible clue, but keep the named Montreal subject primary. "
            "The theme is a light lens, not a thriller costume. Sound like an archivist "
            "reading a city carefully, not like a noir narrator. Teach one concrete thing "
            "early. If the metadata is thin, make the uncertainty elegant and local."
        ),
    ),
    "tuesday": ThemeSpec(
        key="erased history",
        label="Erased History",
        description="What was displaced, demolished, or overwritten in Montreal.",
        editorial_brief=(
            "Frame the image around what was sacrificed, displaced, or rewritten. "
            "Use concrete Montreal change over time, not abstract loss. Start from the "
            "named place or institution, then explain what changed in the territory."
        ),
    ),
    "wednesday": ThemeSpec(
        key="beauty",
        label="Beautiful Archive",
        description="A striking archive image carried by atmosphere, composition, and place.",
        editorial_brief=(
            "Let the image lead. Prioritize atmosphere, composition, and a concrete Montreal "
            "anchor. Teach one thing the viewer may have missed, but keep the tone elegant, "
            "precise, and warm rather than dramatic."
        ),
    ),
    "thursday": ThemeSpec(
        key="detective",
        label="Detective",
        description="Read Montreal through visible clues, architecture, and urban tension.",
        editorial_brief=(
            "Read the image like a smart local investigator. Use scale, signage, vantage point, "
            "street details, and architectural contrast. Keep the story Montreal-first, "
            "subject-first, and evidence-bound."
        ),
    ),
    "friday": ThemeSpec(
        key="nostalgia",
        label="Nostalgia",
        description="Neighborhood life, lived memory, and everyday Montreal rhythms.",
        editorial_brief=(
            "Write for memory and lived experience. Lead with the place, the visible anchor, "
            "and the rhythm of neighborhood life. This should feel inhabited: parks, pools, "
            "balconies, triplexes, sidewalks, seasonality, and how the city was actually used."
        ),
    ),
    "saturday": ThemeSpec(
        key="weekend archive",
        label="Weekend Archive",
        description="A slower weekend look at a Montreal place, landmark, or streetscape.",
        editorial_brief=(
            "Use a lighter weekend tone without losing precision. Stay place-first and image-led. "
            "Teach one concrete detail, then widen to what the archive reveals about the city."
        ),
    ),
    "sunday": ThemeSpec(
        key="civic memory",
        label="Civic Memory",
        description="Institutions, landmarks, and places that shaped Montreal's civic memory.",
        editorial_brief=(
            "Treat the image as civic memory. Focus on the role the place played in the city, "
            "what remains visible, and what kind of Montreal life or public function it anchored."
        ),
    ),
}


def get_theme_for_date(run_date: date) -> ThemeSpec:
    return THEME_SCHEDULE[run_date.strftime("%A").lower()]


def resolve_theme(theme: str | None, run_date: date) -> ThemeSpec:
    if not theme:
        return get_theme_for_date(run_date)

    lowered = theme.strip().lower()
    if lowered in THEME_SCHEDULE:
        return THEME_SCHEDULE[lowered]

    for spec in THEME_SCHEDULE.values():
        if lowered == spec.key or lowered == spec.label.lower():
            return spec

    return ThemeSpec(
        key=lowered,
        label=theme.strip(),
        description="Manual theme override.",
        editorial_brief="Use the provided theme as a light editorial lens and stay in the MTL Archives house voice.",
    )
