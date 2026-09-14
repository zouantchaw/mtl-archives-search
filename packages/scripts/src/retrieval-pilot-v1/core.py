"""Pure pilot contracts. Unknown evidence never satisfies a hard constraint."""

import hashlib
import json
import math
import re

VIEWPOINTS = (
    "ground",
    "aerial_oblique",
    "aerial_nadir",
    "interior",
    "document",
    "unknown",
)
FEATURES = (
    "storefronts",
    "signs",
    "church_exterior",
    "church_interior",
    "helicopter",
    "people_beside_helicopter",
    "flying_helicopter",
    "trees",
    "water",
)


def digest(value):
    return hashlib.sha256(
        value
        if isinstance(value, bytes)
        else json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def validate_enrichment(x):
    if not isinstance(x, dict) or set(x) != {
        "description",
        "viewpoint",
        "features",
        "uncertainties",
    }:
        raise ValueError("enrichment schema")
    if not isinstance(x["description"], str) or not 10 <= len(x["description"]) <= 1600:
        raise ValueError("description")
    if x["viewpoint"] not in VIEWPOINTS:
        raise ValueError("viewpoint")
    if not isinstance(x["features"], dict) or set(x["features"]) != set(FEATURES):
        raise ValueError("features")
    if any(v not in ("present", "absent", "unknown") for v in x["features"].values()):
        raise ValueError("feature state")
    if not isinstance(x["uncertainties"], list) or any(
        not isinstance(v, str) for v in x["uncertainties"]
    ):
        raise ValueError("uncertainties")
    return x


def validate_plan(x, query):
    if isinstance(x, dict) and "original_query" in x:
        if x["original_query"] != query:
            raise ValueError("provider changed original query")
        x = {k: v for k, v in x.items() if k != "original_query"}
    if not isinstance(x, dict) or set(x) != {"variants", "constraints", "unsupported"}:
        raise ValueError("plan schema")
    if (
        not isinstance(x["variants"], list)
        or len(x["variants"]) > 2
        or any(not isinstance(v, str) or not 1 <= len(v) <= 500 for v in x["variants"])
    ):
        raise ValueError("variants")
    if not isinstance(x["unsupported"], bool):
        raise TypeError("unsupported")
    if not isinstance(x["constraints"], list) or len(x["constraints"]) > 12:
        raise ValueError("constraints")
    for c in x["constraints"]:
        if set(c) != {"field", "value", "evidence"} or c["field"] not in (
            "viewpoint",
            *FEATURES,
        ):
            raise ValueError("constraint field")
        if c["value"] not in (
            VIEWPOINTS if c["field"] == "viewpoint" else ("present", "absent")
        ):
            raise ValueError("constraint value")
        if (
            not isinstance(c["evidence"], str)
            or not c["evidence"]
            or c["evidence"] not in query
        ):
            raise ValueError("constraint not grounded in request")
    x = {
        **x,
        "original_query": query,
        "variants": list(dict.fromkeys([query, *x["variants"]]))[:3],
    }
    return x


def retain_constraints(previous, current):
    # A follow-up cannot silently replace prior constraints. Conflicts require clarification.
    merged = list(previous)
    for c in current:
        if any(p["field"] == c["field"] and p["value"] != c["value"] for p in merged):
            return {
                "status": "clarification_required",
                "constraints": merged,
                "conflict": c,
            }
        if not any(
            p["field"] == c["field"] and p["value"] == c["value"] for p in merged
        ):
            merged.append(c)
    return {"status": "ok", "constraints": merged}


def constraint_status(record, constraints):
    unknown = False
    for c in constraints:
        value = (
            record.get("viewpoint", "unknown")
            if c["field"] == "viewpoint"
            else record.get("features", {}).get(c["field"], "unknown")
        )
        if value == "unknown":
            unknown = True
        elif value != c["value"]:
            return "rejected"
    return "unknown" if unknown else "eligible"


def fuse(rankings, limit=36):
    scores = {}
    for ranking in rankings:
        for rank, key in enumerate(dict.fromkeys(ranking)):
            scores[key] = scores.get(key, 0) + 1 / (60 + rank + 1)
    return sorted(scores, key=lambda k: (-scores[k], k))[:limit]


def cosine(a, b):
    if len(a) != len(b) or not a or any(not math.isfinite(x) for x in [*a, *b]):
        raise ValueError("invalid vectors")
    norm = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / norm if norm else 0


def lexical(query, documents):
    terms = set(re.findall(r"\w+", query.lower()))
    return sorted(
        documents,
        key=lambda k: (-len(terms & set(re.findall(r"\w+", documents[k].lower()))), k),
    )


def metrics(ids, case):
    pos = set(case["positive_ids"])
    pool = set(case["reviewed_pool_ids"])
    top = list(dict.fromkeys(ids))[:6]
    judged = [k for k in top if k in pool]
    return {
        "returned": len(ids),
        "judged_at_6": len(judged),
        "coverage_at_6": len(judged) / len(top) if top else 0,
        "precision_at_6": sum(k in pos for k in judged) / len(judged)
        if judged
        else None,
        "recall_at_36": len(set(ids[:36]) & pos) / len(pos) if pos else None,
    }


def promotion(gates):
    return promotion_receipt(gates)["promotable"]


# Deliberately bounded bilingual grammar, not a general natural-language verifier.
# Unconsumed content abstains; the verbatim request always travels with candidates.
def concrete_plan(query):
    text = query.lower()
    constraints = []
    spans = []
    phrases = []
    rules = [
        (
            "viewpoint",
            "ground",
            r"ground[- ]level|street[- ](?:level|view)|from the ground|au niveau du sol|depuis le trottoir|vue de la rue",
            "ground level street",
        ),
        (
            "viewpoint",
            "aerial_nadir",
            r"looking straight down|nadir|directly above",
            "aerial nadir",
        ),
        ("viewpoint", "aerial_oblique", r"oblique", "aerial oblique"),
        (
            "storefronts",
            "present",
            r"storefronts?|shopfronts?|businesses|commerces|devantures",
            "storefronts",
        ),
        ("signs", "present", r"signs?|brands|enseignes", "shop signs"),
        (
            "church_interior",
            "present",
            r"inside a church|church interior|intérieur d.une église",
            "church interior",
        ),
        (
            "church_exterior",
            "present",
            r"church facade|façade extérieure|facade église",
            "church facade",
        ),
        (
            "people_beside_helicopter",
            "present",
            r"people beside|personnes debout à côté|personnes à côté",
            "people beside",
        ),
        (
            "flying_helicopter",
            "present",
            r"helicopter flying|flying helicopter",
            "flying helicopter",
        ),
        ("helicopter", "present", r"helicopter|hélicoptère", "helicopter"),
        ("trees", "present", r"trees|arbres", "trees"),
        ("water", "present", r"water|eau", "water"),
    ]
    unsupported = bool(
        re.search(
            r"why|changed|disappeared|before|after|pourquoi|avant|après|women|femmes|purple|elephant",
            text,
        )
    )
    # Preserve explicit aerial exclusions as a ground constraint only when ground is stated.
    exclusions = [
        (r"not aerial views|pas de vues aériennes", None),
        (r"no exterior facades", ("church_exterior", "absent")),
    ]
    masked = text
    for pattern, constraint in exclusions:
        for m in re.finditer(pattern, text):
            spans.append(m.span())
            masked = (
                masked[: m.start()] + " " * (m.end() - m.start()) + masked[m.end() :]
            )
            if constraint:
                constraints.append(
                    {
                        "field": constraint[0],
                        "value": constraint[1],
                        "evidence": query[m.start() : m.end()],
                    }
                )
    for field, value, pattern, phrase in rules:
        for m in re.finditer(r"\b(?:" + pattern + r")\b", masked):
            if re.search(r"\b(no|not|without|sans)\s+$", masked[: m.start()]):
                unsupported = True
                continue
            if not any(
                c["field"] == field and c["value"] == value for c in constraints
            ):
                constraints.append(
                    {
                        "field": field,
                        "value": value,
                        "evidence": query[m.start() : m.end()],
                    }
                )
                phrases.append(phrase)
            spans.append(m.span())
    if any(
        c["field"] == "church_interior" and c["value"] == "present" for c in constraints
    ):
        constraints.append(
            {
                "field": "viewpoint",
                "value": "interior",
                "evidence": next(
                    c["evidence"]
                    for c in constraints
                    if c["field"] == "church_interior" and c["value"] == "present"
                ),
            }
        )
    if any(
        c["field"] == "church_exterior" and c["value"] == "present" for c in constraints
    ) and not any(c["field"] == "viewpoint" for c in constraints):
        unsupported = True
    # A subject being above ground says nothing about the camera viewpoint.
    if re.search(r"above the ground", text):
        spans.extend(m.span() for m in re.finditer("above the ground", text))
    if re.search(r"not aerial|pas de vues aériennes", text) and not any(
        c["field"] == "viewpoint" and c["value"] == "ground" for c in constraints
    ):
        unsupported = True
    if len({c["value"] for c in constraints if c["field"] == "viewpoint"}) > 1:
        unsupported = True
    remainder = list(text)
    for start, end in spans:
        remainder[start:end] = " " * (end - start)
    stop = {
        "viewed",
        "church",
        "église",
        "a",
        "an",
        "the",
        "of",
        "with",
        "and",
        "or",
        "photographs",
        "photograph",
        "photos",
        "photo",
        "images",
        "image",
        "showing",
        "show",
        "me",
        "find",
        "looking",
        "photographed",
        "taken",
        "streets",
        "street",
        "city",
        "buildings",
        "on",
        "at",
        "from",
        "view",
        "views",
        "des",
        "de",
        "du",
        "la",
        "le",
        "les",
        "une",
        "un",
        "avec",
        "et",
        "photographies",
        "photographie",
        "prises",
        "depuis",
        "au",
        "niveau",
        "sol",
        "rue",
        "shop",
        "beside",
        "to",
        "à",
        "côté",
        "d",
        "en",
        "aerial",
    }
    residual = set(re.findall(r"\w+", "".join(remainder))) - stop
    unsupported = unsupported or bool(residual) or not constraints
    if re.search(r"trees beside water|arbres à côté", text):
        unsupported = True  # Co-occurrence does not verify adjacency.
    concise = " ".join(dict.fromkeys(phrases))
    # Conjunctions/relationships stay in the original; variant is candidate generation only.
    return {
        "original_query": query,
        "variants": list(dict.fromkeys([query, concise])) if concise else [query],
        "constraints": constraints,
        "unsupported": unsupported,
        "unverified_terms": sorted(residual),
        "planner": "bounded_cpu_v1",
    }


REQUIRED_GATES = (
    "caption_review",
    "constraint_violations",
    "constraint_retention",
    "heldout_precision",
    "heldout_recall",
    "completion",
    "search_latency",
    "research_latency",
    "cost",
    "worst_slice_regression",
    "full_corpus_coverage",
    "rollback_verified",
)


def promotion_receipt(gates):
    missing = [k for k in REQUIRED_GATES if gates.get(k) is not True]
    return {
        "promotable": not missing,
        "blocked_gates": missing,
        "production_active": False,
    }
