#!/usr/bin/env python3
"""
QA Sample Analysis Script
Analyzes a random 50-record sample for OCR and VLM tag quality.
"""

import json
import random
import sys
from pathlib import Path
from collections import Counter
from datetime import datetime

SAMPLE_SIZE = 50
SEED = 42  # Reproducible sample

def load_records(path: Path) -> list[dict]:
    records = []
    with open(path) as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))
    return records

def analyze_ocr(records: list[dict]) -> dict:
    """Analyze OCR quality metrics."""
    stats = {
        'total': len(records),
        'has_ocr': 0,
        'ocr_errors': 0,
        'avg_confidence': 0,
        'avg_word_count': 0,
        'language_distribution': Counter(),
        'error_types': Counter(),
        'samples_with_text': [],
        'samples_with_errors': [],
    }

    confidences = []
    word_counts = []

    for r in records:
        ocr_text = r.get('ocr_text')
        ocr_error = r.get('ocr_error')

        if ocr_error:
            stats['ocr_errors'] += 1
            stats['error_types'][ocr_error] += 1
            stats['samples_with_errors'].append({
                'image': r.get('image_filename'),
                'error': ocr_error
            })
        elif ocr_text and ocr_text.strip():
            stats['has_ocr'] += 1
            conf = r.get('ocr_confidence', 0)
            wc = r.get('ocr_word_count', 0)
            lang = r.get('ocr_language', 'unknown')

            confidences.append(conf)
            word_counts.append(wc)
            stats['language_distribution'][lang] += 1

            # Sample some records with text
            if len(stats['samples_with_text']) < 5:
                stats['samples_with_text'].append({
                    'image': r.get('image_filename'),
                    'text_preview': ocr_text[:200] + '...' if len(ocr_text) > 200 else ocr_text,
                    'confidence': conf,
                    'word_count': wc,
                    'language': lang
                })

    if confidences:
        stats['avg_confidence'] = sum(confidences) / len(confidences)
    if word_counts:
        stats['avg_word_count'] = sum(word_counts) / len(word_counts)

    return stats

def analyze_vlm(records: list[dict]) -> dict:
    """Analyze VLM tag quality metrics."""
    stats = {
        'total': len(records),
        'has_tags': 0,
        'vlm_errors': 0,
        'avg_confidence': 0,
        'error_types': Counter(),
        'tag_field_coverage': Counter(),
        'samples_with_tags': [],
        'samples_with_errors': [],
    }

    confidences = []

    for r in records:
        vlm_tags = r.get('vlm_tags')
        vlm_error = r.get('vlm_tags_error')

        if vlm_error:
            stats['vlm_errors'] += 1
            stats['error_types'][vlm_error] += 1
            if len(stats['samples_with_errors']) < 5:
                stats['samples_with_errors'].append({
                    'image': r.get('image_filename'),
                    'error': vlm_error
                })
        elif vlm_tags and isinstance(vlm_tags, dict):
            stats['has_tags'] += 1
            conf = r.get('vlm_tags_confidence')
            if conf is not None:
                confidences.append(conf)

            # Count which fields are present
            for field in ['subject', 'era', 'location', 'architecture', 'mood', 'weather', 'people', 'vehicles', 'signs']:
                if vlm_tags.get(field):
                    stats['tag_field_coverage'][field] += 1

            # Sample some records with tags
            if len(stats['samples_with_tags']) < 5:
                stats['samples_with_tags'].append({
                    'image': r.get('image_filename'),
                    'tags': vlm_tags,
                    'confidence': conf if conf is not None else 0
                })

    if confidences:
        stats['avg_confidence'] = sum(confidences) / len(confidences)

    return stats

def analyze_trust(records: list[dict]) -> dict:
    """Analyze trust score distribution."""
    scores = [r.get('trust_score', 0) for r in records if r.get('trust_score') is not None]

    if not scores:
        return {'total': len(records), 'with_score': 0}

    return {
        'total': len(records),
        'with_score': len(scores),
        'min': min(scores),
        'max': max(scores),
        'avg': sum(scores) / len(scores),
        'distribution': {
            'high (>0.7)': sum(1 for s in scores if s > 0.7),
            'medium (0.4-0.7)': sum(1 for s in scores if 0.4 <= s <= 0.7),
            'low (<0.4)': sum(1 for s in scores if s < 0.4),
        }
    }

def main():
    manifest_path = Path(__file__).parent.parent.parent / 'data' / 'mtl_archives' / 'manifest_scored.jsonl'

    if not manifest_path.exists():
        print(f"Error: {manifest_path} not found")
        sys.exit(1)

    print(f"Loading records from {manifest_path}...")
    all_records = load_records(manifest_path)
    print(f"Loaded {len(all_records)} records")

    # Select random sample
    random.seed(SEED)
    sample = random.sample(all_records, min(SAMPLE_SIZE, len(all_records)))
    print(f"Selected {len(sample)} records for QA sample (seed={SEED})")
    print()

    # Analyze OCR
    print("=" * 60)
    print("OCR ANALYSIS")
    print("=" * 60)
    ocr_stats = analyze_ocr(sample)
    print(f"Records with OCR text: {ocr_stats['has_ocr']}/{ocr_stats['total']} ({100*ocr_stats['has_ocr']/ocr_stats['total']:.1f}%)")
    print(f"Records with OCR errors: {ocr_stats['ocr_errors']}/{ocr_stats['total']} ({100*ocr_stats['ocr_errors']/ocr_stats['total']:.1f}%)")
    print(f"Average OCR confidence: {ocr_stats['avg_confidence']:.2f}")
    print(f"Average word count: {ocr_stats['avg_word_count']:.1f}")
    print(f"Language distribution: {dict(ocr_stats['language_distribution'])}")
    if ocr_stats['error_types']:
        print(f"Error types: {dict(ocr_stats['error_types'])}")
    print()

    if ocr_stats['samples_with_text']:
        print("Sample OCR extractions:")
        for i, s in enumerate(ocr_stats['samples_with_text'][:3], 1):
            print(f"  {i}. {s['image']}")
            print(f"     Conf: {s['confidence']:.2f}, Words: {s['word_count']}, Lang: {s['language']}")
            text_clean = s['text_preview'].replace('\n', ' ').strip()
            print(f"     Text: {text_clean[:100]}...")
            print()

    # Analyze VLM
    print("=" * 60)
    print("VLM TAG ANALYSIS")
    print("=" * 60)
    vlm_stats = analyze_vlm(sample)
    print(f"Records with VLM tags: {vlm_stats['has_tags']}/{vlm_stats['total']} ({100*vlm_stats['has_tags']/vlm_stats['total']:.1f}%)")
    print(f"Records with VLM errors: {vlm_stats['vlm_errors']}/{vlm_stats['total']} ({100*vlm_stats['vlm_errors']/vlm_stats['total']:.1f}%)")
    print(f"Average VLM confidence: {vlm_stats['avg_confidence']:.2f}")
    print(f"Tag field coverage (when tags exist):")
    for field, count in sorted(vlm_stats['tag_field_coverage'].items(), key=lambda x: -x[1]):
        pct = 100 * count / vlm_stats['has_tags'] if vlm_stats['has_tags'] > 0 else 0
        print(f"  - {field}: {count}/{vlm_stats['has_tags']} ({pct:.0f}%)")
    if vlm_stats['error_types']:
        print(f"Error types: {dict(vlm_stats['error_types'])}")
    print()

    if vlm_stats['samples_with_tags']:
        print("Sample VLM tags:")
        for i, s in enumerate(vlm_stats['samples_with_tags'][:3], 1):
            print(f"  {i}. {s['image']} (conf: {s['confidence']:.2f})")
            for k, v in s['tags'].items():
                if v:
                    print(f"     {k}: {v}")
            print()

    # Analyze Trust
    print("=" * 60)
    print("TRUST SCORE ANALYSIS")
    print("=" * 60)
    trust_stats = analyze_trust(sample)
    print(f"Records with trust score: {trust_stats['with_score']}/{trust_stats['total']}")
    if trust_stats['with_score'] > 0:
        print(f"Score range: {trust_stats['min']:.2f} - {trust_stats['max']:.2f}")
        print(f"Average score: {trust_stats['avg']:.2f}")
        print(f"Distribution:")
        for bucket, count in trust_stats['distribution'].items():
            pct = 100 * count / trust_stats['with_score']
            print(f"  - {bucket}: {count} ({pct:.0f}%)")
    print()

    # Summary
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    ocr_rate = 100 * ocr_stats['has_ocr'] / ocr_stats['total']
    vlm_rate = 100 * vlm_stats['has_tags'] / vlm_stats['total']
    ocr_err_rate = 100 * ocr_stats['ocr_errors'] / ocr_stats['total']
    vlm_err_rate = 100 * vlm_stats['vlm_errors'] / vlm_stats['total']

    print(f"OCR success rate: {ocr_rate:.1f}% ({ocr_stats['has_ocr']}/{ocr_stats['total']})")
    print(f"VLM success rate: {vlm_rate:.1f}% ({vlm_stats['has_tags']}/{vlm_stats['total']})")
    print(f"OCR error rate: {ocr_err_rate:.1f}%")
    print(f"VLM error rate: {vlm_err_rate:.1f}%")

    # Write detailed report
    report_path = Path(__file__).parent / 'qa_report.json'
    report = {
        'generated_at': datetime.now().isoformat(),
        'sample_size': len(sample),
        'seed': SEED,
        'ocr': ocr_stats,
        'vlm': vlm_stats,
        'trust': trust_stats,
    }
    # Convert Counter objects to dicts for JSON serialization
    report['ocr']['language_distribution'] = dict(report['ocr']['language_distribution'])
    report['ocr']['error_types'] = dict(report['ocr']['error_types'])
    report['vlm']['error_types'] = dict(report['vlm']['error_types'])
    report['vlm']['tag_field_coverage'] = dict(report['vlm']['tag_field_coverage'])

    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f"\nDetailed report written to: {report_path}")

if __name__ == '__main__':
    main()
