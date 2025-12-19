#!/usr/bin/env python3
"""
Date Normalization Script for MTL Archives

Extracts and normalizes dates from attributes_map.Date to date_value.

Input formats handled:
- "1947-1949" (year range)
- "1966" (single year)
- "Décennie 1930" (French decade)
- "26-mars-36" (French day-month-year)
- "24 juin 1925" (French full date)
- "1er avril 1936" (French with ordinal)
- "08-avr.-36" (French abbreviated month)

Output format:
- Single year: "1947"
- Year range: "1947-1949"
- Decade: "1930s"
"""

import argparse
import json
import re
import sys
from pathlib import Path

# French month mappings
FRENCH_MONTHS = {
    'janvier': '01', 'jan': '01', 'janv': '01',
    'février': '02', 'fevrier': '02', 'fév': '02', 'fev': '02',
    'mars': '03', 'mar': '03',
    'avril': '04', 'avr': '04',
    'mai': '05',
    'juin': '06', 'jun': '06',
    'juillet': '07', 'juil': '07', 'jul': '07',
    'août': '08', 'aout': '08', 'aoû': '08',
    'septembre': '09', 'sept': '09', 'sep': '09',
    'octobre': '10', 'oct': '10',
    'novembre': '11', 'nov': '11',
    'décembre': '12', 'decembre': '12', 'déc': '12', 'dec': '12',
}


def normalize_year(year_str: str) -> str | None:
    """Convert 2-digit or 4-digit year to 4-digit."""
    year_str = year_str.strip()
    if not year_str:
        return None

    try:
        year = int(year_str)
        if year < 100:
            # Assume 1900s for 2-digit years (these are historical photos)
            year = 1900 + year
        if 1800 <= year <= 2100:
            return str(year)
    except ValueError:
        pass
    return None


def parse_date(date_str: str) -> str | None:
    """
    Parse various date formats and return normalized form.

    Returns:
        - "YYYY" for single year
        - "YYYY-YYYY" for year range
        - "YYYYs" for decade
        - None if unparseable
    """
    if not date_str:
        return None

    date_str = date_str.strip()

    # Pattern: "Décennie 1930" or "Décennie 1920"
    decade_match = re.match(r'[Dd]écennie\s+(\d{4})', date_str)
    if decade_match:
        return f"{decade_match.group(1)}s"

    # Pattern: "1947-1949" (year range)
    range_match = re.match(r'^(\d{4})\s*[-–]\s*(\d{4})$', date_str)
    if range_match:
        return f"{range_match.group(1)}-{range_match.group(2)}"

    # Pattern: "1925-1935" (year range, alternate)
    range_match2 = re.match(r'^(\d{4})\s*[-–]\s*(\d{2,4})$', date_str)
    if range_match2:
        start = range_match2.group(1)
        end = range_match2.group(2)
        if len(end) == 2:
            end = start[:2] + end
        return f"{start}-{end}"

    # Pattern: Single year "1966"
    year_match = re.match(r'^(\d{4})$', date_str)
    if year_match:
        return year_match.group(1)

    # Pattern: "26-mars-36" or "08-avr.-36"
    french_dmy = re.match(r'^(\d{1,2})[-\s]([a-zéûô]+)\.?[-\s](\d{2,4})$', date_str, re.IGNORECASE)
    if french_dmy:
        day = french_dmy.group(1).zfill(2)
        month_str = french_dmy.group(2).lower().rstrip('.')
        year_str = french_dmy.group(3)

        month = FRENCH_MONTHS.get(month_str)
        year = normalize_year(year_str)

        if month and year:
            return year  # Return just the year for simplicity

    # Pattern: "24 juin 1925" or "1er avril 1936"
    french_full = re.match(r'^(\d{1,2})(?:er|e|ème)?\s+([a-zéûô]+)\s+(\d{4})$', date_str, re.IGNORECASE)
    if french_full:
        year = french_full.group(3)
        return year  # Return just the year

    # Pattern: "avril 1936" (month year)
    month_year = re.match(r'^([a-zéûô]+)\s+(\d{4})$', date_str, re.IGNORECASE)
    if month_year:
        return month_year.group(2)  # Return just the year

    # Pattern: Complex string with date at end: "... - 2 mai 1964"
    end_date = re.search(r'[-–]\s*(\d{1,2})\s+([a-zéûô]+)\s+(\d{4})\s*$', date_str, re.IGNORECASE)
    if end_date:
        return end_date.group(3)  # Return just the year

    # Pattern: Just month-year at end: "avr.-25"
    abbrev_month_year = re.match(r'^([a-zéûô]+)\.?[-\s](\d{2})$', date_str, re.IGNORECASE)
    if abbrev_month_year:
        year = normalize_year(abbrev_month_year.group(2))
        if year:
            return year

    # Last resort: extract any 4-digit year
    year_anywhere = re.search(r'(\d{4})', date_str)
    if year_anywhere:
        year = int(year_anywhere.group(1))
        if 1800 <= year <= 2100:
            return str(year)

    return None


def main():
    parser = argparse.ArgumentParser(description='Normalize dates in manifest')
    parser.add_argument('--input', '-i', required=True, help='Input JSONL file')
    parser.add_argument('--output', '-o', required=True, help='Output JSONL file')
    parser.add_argument('--dry-run', action='store_true', help='Print stats without writing')
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading from: {input_path}")

    records = []
    with open(input_path, 'r') as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    print(f"Total records: {len(records)}")

    # Stats
    already_has_date = 0
    extracted_date = 0
    no_date_source = 0
    parse_failed = 0
    failed_examples = []

    for record in records:
        # Check if already has date_value
        if record.get('date_value'):
            already_has_date += 1
            continue

        # Try to extract from attributes_map.Date
        raw_date = None
        if record.get('attributes_map') and record['attributes_map'].get('Date'):
            raw_date = record['attributes_map']['Date']
        elif record.get('portal_date'):
            raw_date = record['portal_date']

        if not raw_date:
            no_date_source += 1
            continue

        # Parse and normalize
        normalized = parse_date(raw_date)

        if normalized:
            record['date_value'] = normalized
            extracted_date += 1
        else:
            parse_failed += 1
            if len(failed_examples) < 10:
                failed_examples.append(raw_date)

    print(f"\n=== Results ===")
    print(f"Already had date_value: {already_has_date}")
    print(f"Extracted and normalized: {extracted_date}")
    print(f"No date source: {no_date_source}")
    print(f"Parse failed: {parse_failed}")

    if failed_examples:
        print(f"\nFailed to parse examples:")
        for ex in failed_examples:
            print(f"  - {ex}")

    # Sample of extracted dates
    print(f"\nSample of extracted dates:")
    count = 0
    for r in records:
        if r.get('date_value') and count < 10:
            raw = r.get('attributes_map', {}).get('Date', 'N/A')
            print(f"  {raw} → {r['date_value']}")
            count += 1

    if args.dry_run:
        print("\n[Dry run - no files written]")
        return

    # Write output
    with open(output_path, 'w') as f:
        for record in records:
            f.write(json.dumps(record) + '\n')

    print(f"\nWrote {len(records)} records to {output_path}")


if __name__ == '__main__':
    main()
