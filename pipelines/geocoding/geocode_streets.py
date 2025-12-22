#!/usr/bin/env python3
"""
Geocode street names from MTL Archives manifest using Mapbox Geocoding API.

Usage:
    python geocode_streets.py [--dry-run] [--limit N]

Environment:
    MAP_BOX_TOKEN: Mapbox API access token
"""

import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

# Montreal bounding box (SW lng, SW lat, NE lng, NE lat)
MONTREAL_BBOX = "-73.98,45.40,-73.47,45.70"

# Rate limiting: Mapbox free tier allows 100k requests/month
# We'll do ~10 requests/second to be safe
REQUESTS_PER_SECOND = 10
REQUEST_DELAY = 1.0 / REQUESTS_PER_SECOND

# Patterns to extract street names (case insensitive)
STREET_PATTERNS = [
    # "Rue Saint-Antoine", "Avenue du Parc", "Boulevard Saint-Laurent" - at start
    r"^(Rue|Avenue|Boulevard|Chemin|Place|Square|Côte|Allée)\s+[\w\-\'\u00C0-\u017F\s]+",
    # Parks: "Parc Lafontaine", "Parc Mont-Royal", "parc La Fontaine"
    r"\b[Pp]arc\s+[\w\-\'\u00C0-\u017F\s]+",
    # Named places: "Marché Bonsecours", "Place Jacques-Cartier", "Square d'Youville"
    r"\b(Marché|Place|Square|Quai|Gare|Église|Université)\s+[\w\-\'\u00C0-\u017F\s]+",
    # Street mentions anywhere: "(1086, rue Osborne...)", "rue Moreau", "rue Frontenac"
    r"\b(rue|avenue|boulevard)\s+[\w\-\'\u00C0-\u017F]+",
]

# Patterns for extracting location from complex names
LOCATION_PATTERNS = [
    # "coin des rues X et Y" or "coin rue X et avenue Y"
    r"coin\s+(?:des\s+rues?\s+)?([\w\-\'\u00C0-\u017F]+)\s+et\s+([\w\-\'\u00C0-\u017F]+)",
    # "(angle des rues X et Y)"
    r"angle\s+des\s+rues\s+([\w\-\'\u00C0-\u017F]+)\s+et\s+([\w\-\'\u00C0-\u017F]+)",
    # "intersection de X et Y"
    r"intersection\s+(?:de\s+)?(?:la\s+)?(rue|avenue|boulevard)\s+([\w\-\'\u00C0-\u017F]+)\s+et\s+(?:la\s+|l')?(rue|avenue|boulevard)?\s*([\w\-\'\u00C0-\u017F]+)",
    # Address: "1086, rue Osborne"
    r"\d+[,\s]+(?:de la\s+|de l')?(rue|avenue|boulevard)\s+([\w\-\'\u00C0-\u017F]+)",
    # "situé à l'intersection de"
    r"situé\s+à\s+l'intersection\s+(?:de\s+)?(?:la\s+)?(rue|avenue|boulevard)?\s*([\w\-\'\u00C0-\u017F]+)",
]

def extract_street_from_text(text: str) -> str | None:
    """Extract a street name from any text field."""
    if not text:
        return None

    text = text.strip()

    # Skip pure filenames/codes
    if re.match(r'^[A-Z]{2,}\d+[\-_,]', text) or (text.endswith('.jpg') and 'rue' not in text.lower()):
        return None

    # Try location patterns first (more specific)
    for pattern in LOCATION_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            groups = [g for g in match.groups() if g and g.lower() not in ['rue', 'avenue', 'boulevard']]
            if groups:
                # Build query like "rue X et rue Y" or just "X Montreal"
                if len(groups) >= 2:
                    return f"rue {groups[0]} et rue {groups[1]}, Montreal"
                else:
                    return f"rue {groups[0]}, Montreal"

    # Try to extract street patterns
    for pattern in STREET_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            query = match.group(0).strip()
            # Clean up "coin" intersections for better geocoding
            query = re.sub(r'\s+coin\s+', ' et ', query, flags=re.IGNORECASE)
            query = re.sub(r'\s+angle\s+(des\s+rues\s+)?', ' et ', query, flags=re.IGNORECASE)
            # Remove trailing words that aren't part of the street name
            query = re.sub(r'\s+(devenu|devenue|aujourd\'hui|situé|vers|et\s+au|\.|\,).*$', '', query, flags=re.IGNORECASE)
            if len(query) > 5:  # Minimum reasonable length
                return query

    # If text looks like a street address, use it directly
    if re.match(r'^[\d]+\s+(Rue|Avenue|Boulevard)', text, re.IGNORECASE):
        return text

    # Try the whole text if it's short and contains street keywords
    if len(text) < 80 and any(kw in text.lower() for kw in ['rue', 'avenue', 'boulevard', 'parc', 'place', 'square']):
        # Remove parenthetical notes and trailing info
        clean = re.sub(r'\([^)]+\)', '', text).strip()
        clean = re.sub(r'\s*[-/].*$', '', clean).strip()
        if clean and len(clean) > 5:
            return clean

    return None


# Additional patterns for French descriptions
DESCRIPTION_PATTERNS = [
    # "à l'angle de la rue X" or "angle des rues X et Y"
    r"(?:à l')?angle\s+(?:de la |des rues?\s+)?((?:rue|avenue|boulevard)\s+[\w\-\'\s]+)",
    # "à partir de la rue X"
    r"à partir de (?:la |l')?((?:rue|avenue|boulevard)\s+[\w\-\'\s]+)",
    # "sur la rue X" or "de la rue X"
    r"(?:sur|de) (?:la |l')?((?:rue|avenue|boulevard)\s+[\w\-\'\s]+)",
    # "coin rue X et avenue Y"
    r"coin\s+((?:rue|avenue|boulevard)\s+[\w\-\'\s]+(?:\s+et\s+[\w\-\'\s]+)?)",
    # Intersections: "rue X / avenue Y" or "rue X et avenue Y"
    r"((?:rue|avenue|boulevard)\s+[\w\-\']+)\s*(?:/|et)\s*((?:rue|avenue|boulevard)\s+[\w\-\']+)",
]


def extract_from_description(description: str) -> str | None:
    """Extract street names from French archival descriptions."""
    if not description:
        return None

    for pattern in DESCRIPTION_PATTERNS:
        match = re.search(pattern, description, re.IGNORECASE)
        if match:
            # Get all captured groups and join them
            groups = [g for g in match.groups() if g]
            if groups:
                query = ' et '.join(groups)
                # Clean up
                query = re.sub(r'\s+', ' ', query).strip()
                # Remove trailing punctuation
                query = re.sub(r'[.,;:!?]+$', '', query)
                return query

    return None


def extract_street_query(record: dict) -> tuple[str | None, str]:
    """Extract a geocodable street query from a record. Returns (query, source)."""

    # Try name field first (often has clean street names)
    name = record.get('name', '')
    query = extract_street_from_text(name)
    if query:
        return query, 'name'

    # Try portal_description_clean
    desc = record.get('portal_description_clean', '')
    query = extract_from_description(desc)
    if query:
        return query, 'portal_description'

    # Try raw_description
    raw_desc = record.get('raw_description', '')
    query = extract_from_description(raw_desc)
    if query:
        return query, 'raw_description'

    # Try portal_record.Description
    portal = record.get('portal_record', {})
    if isinstance(portal, dict):
        portal_desc = portal.get('Description', '')
        query = extract_from_description(portal_desc)
        if query:
            return query, 'portal_record'

    return None, 'none'

def geocode_mapbox(query: str, token: str) -> dict | None:
    """Call Mapbox Geocoding API and return lat/lng."""
    # Always add Montreal for better results
    if 'montreal' not in query.lower() and 'montréal' not in query.lower():
        query = f"{query}, Montreal, Quebec"
    encoded_query = quote(query)
    url = (
        f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded_query}.json"
        f"?access_token={token}"
        f"&bbox={MONTREAL_BBOX}"
        f"&limit=1"
        f"&types=address,poi,neighborhood,locality"
    )

    try:
        req = Request(url, headers={'User-Agent': 'mtl-archives-geocoder/1.0'})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        if data.get('features') and len(data['features']) > 0:
            feature = data['features'][0]
            lng, lat = feature['geometry']['coordinates']
            return {
                'latitude': lat,
                'longitude': lng,
                'geocode_place_name': feature.get('place_name', ''),
                'geocode_confidence': feature.get('relevance', 0),
            }
    except HTTPError as e:
        print(f"  HTTP error {e.code}: {e.reason}", file=sys.stderr)
    except URLError as e:
        print(f"  URL error: {e.reason}", file=sys.stderr)
    except Exception as e:
        print(f"  Error: {e}", file=sys.stderr)

    return None

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Geocode MTL Archives street names')
    parser.add_argument('--dry-run', action='store_true', help='Parse streets without calling API')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records to process')
    parser.add_argument('--offset', type=int, default=0, help='Skip first N records')
    args = parser.parse_args()

    # Load token
    token = os.environ.get('MAP_BOX_TOKEN')
    if not token and not args.dry_run:
        print("Error: MAP_BOX_TOKEN environment variable not set", file=sys.stderr)
        sys.exit(1)

    # Paths
    project_root = Path(__file__).parent.parent.parent
    input_path = project_root / 'data' / 'mtl_archives' / 'manifest_vlm_complete.jsonl'
    output_path = project_root / 'data' / 'mtl_archives' / 'manifest_geocoded.jsonl'

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Read manifest
    print(f"Reading: {input_path}")
    records = []
    with open(input_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    print(f"Loaded {len(records)} records")

    # Apply offset and limit
    if args.offset > 0:
        records = records[args.offset:]
        print(f"Skipped first {args.offset} records")
    if args.limit > 0:
        records = records[:args.limit]
        print(f"Processing {len(records)} records (limit applied)")

    # Stats
    stats = {
        'total': len(records),
        'parseable': 0,
        'geocoded': 0,
        'failed': 0,
        'skipped': 0,
        'sources': {'name': 0, 'portal_description': 0, 'raw_description': 0, 'portal_record': 0},
    }

    # Process records
    geocoded_records = []

    for i, record in enumerate(records):
        name = record.get('name', '')
        query, source = extract_street_query(record)

        if not query:
            stats['skipped'] += 1
            geocoded_records.append(record)
            continue

        stats['parseable'] += 1
        stats['sources'][source] = stats['sources'].get(source, 0) + 1

        if args.dry_run:
            print(f"[{i+1}/{len(records)}] {name[:50]}")
            print(f"  -> Query: {query} (from {source})")
            geocoded_records.append(record)
            continue

        # Rate limit
        time.sleep(REQUEST_DELAY)

        # Geocode
        result = geocode_mapbox(query, token)

        if result:
            stats['geocoded'] += 1
            record.update(result)
            record['geocode_query'] = query
            record['geocode_source'] = source
            print(f"[{i+1}/{len(records)}] {name[:50]}")
            print(f"  -> {result['latitude']:.5f}, {result['longitude']:.5f} ({result['geocode_confidence']:.2f})")
        else:
            stats['failed'] += 1
            record['geocode_failed'] = True
            record['geocode_query'] = query
            print(f"[{i+1}/{len(records)}] {name[:50]} -> FAILED")

        geocoded_records.append(record)

        # Progress every 100
        if (i + 1) % 100 == 0:
            print(f"\n--- Progress: {i+1}/{len(records)} ({stats['geocoded']} geocoded, {stats['failed']} failed) ---\n")

    # Write output
    if not args.dry_run:
        print(f"\nWriting: {output_path}")
        with open(output_path, 'w', encoding='utf-8') as f:
            for record in geocoded_records:
                f.write(json.dumps(record, ensure_ascii=False) + '\n')

    # Print stats
    print("\n" + "="*50)
    print("GEOCODING STATS")
    print("="*50)
    print(f"Total records:     {stats['total']}")
    print(f"Parseable streets: {stats['parseable']} ({100*stats['parseable']/stats['total']:.1f}%)")
    print(f"Geocoded:          {stats['geocoded']} ({100*stats['geocoded']/max(1,stats['parseable']):.1f}% of parseable)")
    print(f"Failed:            {stats['failed']}")
    print(f"Skipped (no street): {stats['skipped']}")
    print(f"\nSources breakdown:")
    for source, count in stats['sources'].items():
        if count > 0:
            print(f"  - {source}: {count}")

    if not args.dry_run:
        print(f"\nOutput: {output_path}")

if __name__ == '__main__':
    main()
