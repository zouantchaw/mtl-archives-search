"""Prepare a byte-verified, unreviewed image candidate set with blind local views.

Consumes an existing immutable study/import in the isolated local study ledger.
It downloads only private hash references and never calls a model or production
write API. Selection is engineering preparation; blank worksheets are not labels.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
from html import escape
import io
import json
import os
from pathlib import Path
import shutil
import sys
import time

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'research_platform'))
from storage import Cloud, Store, atomic_new, encoded, load, verify_file
import workflow as w


def worksheet(path, columns, rows):
    text = io.StringIO()
    writer = csv.DictWriter(text, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)
    atomic_new(path, text.getvalue().encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--import-receipt', type=Path, required=True)
    parser.add_argument('--target', type=int, default=100)
    parser.add_argument('--seed', type=int, default=20261003)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--max-download-bytes', type=int, default=2*1024**3)
    args = parser.parse_args()
    if args.target != 100 or args.max_download_bytes <= 0:
        raise ValueError('this preparation protocol targets 100 records with a positive byte cap')
    started = time.monotonic()
    store = Store(args.root/'registry')
    imported = load(args.import_receipt)
    study = store.entity(imported['study_id'], 'study')['data']
    assert study['key'] == 'caption-feedback-visual-retrieval-v1' and study['stage'] == 'preparation'
    policy = dict(key='caption-feedback-unreviewed-candidates-20261003',
                  purpose='engineering', seed=args.seed, max_records=args.target,
                  required_roles=['legacy_delivery', 'research_thumbnail'],
                  partitions={'corpus': 1.0})
    atomic_new(args.root/'candidate-policy.json', encoded(policy))
    snapshot = w.freeze(store, imported['study_id'], imported['import_id'], policy)
    rows = w.selected_rows(store, snapshot)
    refs = {row['version']['sha256']: row['version'] for row in rows}
    for row in rows:
        for asset in row['assets']:
            refs[asset['blob']['sha256']] = asset['blob']
    byte_budget = sum(ref['size_bytes'] for ref in refs.values())
    if byte_budget > args.max_download_bytes:
        raise ValueError('selected bytes exceed preparation download cap')
    if shutil.disk_usage(args.root).free < byte_budget + 1024**3:
        raise ValueError('insufficient disk space for fixed preparation inputs')

    def retrieve(ref):
        dest = store.blobs/ref['sha256']
        if dest.exists():
            verify_file(dest, ref)
        else:
            Cloud().get(ref, dest)
        return ref['size_bytes']

    completed, verified_bytes = 0, 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(retrieve, ref) for ref in refs.values()]
        for future in as_completed(futures):
            verified_bytes += future.result()
            completed += 1
            if completed % 25 == 0 or completed == len(futures):
                print(json.dumps(dict(verified=completed, total=len(futures),
                                      selected_records=len(rows))), flush=True)
    verification = w.verify_snapshot(store, snapshot)
    coverage = w.coverage(store, snapshot)
    atomic_new(args.root/'candidate-coverage.json', encoded(coverage))
    review = args.root/'review'
    images = review/'images'
    images.mkdir(parents=True, exist_ok=True)
    items, cards, tiles = [], [], []
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 15)
    for index, row in enumerate(rows, 1):
        sample = f'{index:03}'
        assets = {a['role']: a for a in row['assets']}
        preview = assets['research_thumbnail']['blob']
        delivery = assets['legacy_delivery']['blob']
        for suffix, ref in [('preview', preview), ('full', delivery)]:
            path = images/(sample+'-'+suffix+'.jpg')
            source = store.path(ref)
            if not path.exists():
                os.link(source, path)
            verify_file(path, ref)
        with Image.open(store.path(preview)) as image:
            image.load()
            tile = Image.new('RGB', (320, 255), '#ffffff')
            shown = image.convert('RGB')
            shown.thumbnail((310, 220))
            tile.paste(shown, ((320-shown.width)//2, 5+(220-shown.height)//2))
            ImageDraw.Draw(tile).text((10, 234), 'Candidate '+sample, fill='#26333b', font=font)
            tiles.append(tile)
        # Only sample IDs and image bytes appear in the human-facing view.
        cards.append(f'<article><a href="images/{sample}-full.jpg"><img loading="lazy" src="images/{sample}-preview.jpg" alt="Unreviewed candidate {sample}"></a><div>Candidate {sample} <a href="images/{sample}-full.jpg">Open full image</a></div></article>')
        items.append(dict(sample_id=sample, record_id=row['record_id'],
                          record_version=row['version'], provisional_byte_group=row['group'],
                          preview=preview, delivery=delivery))
    for start in range(0, len(tiles), 20):
        batch = tiles[start:start+20]
        sheet = Image.new('RGB', (4*320, 5*255), '#e7ece9')
        for index, tile in enumerate(batch):
            sheet.paste(tile, ((index % 4)*320, (index//4)*255))
        path = review/f'contact-sheet-{start//20+1:02}.jpg'
        data = io.BytesIO();sheet.save(data, 'JPEG', quality=92)
        atomic_new(path, data.getvalue())
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MTL Archives - Unreviewed pilot candidates</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#26333b;background:#f6f8f6;margin:32px}main{max-width:1400px;margin:auto}h1{color:#286655}a{color:#286655}.notice{background:#e9f0eb;padding:18px;border-left:4px solid #286655}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-top:24px}article{background:white;border:1px solid #dae1dc;padding:10px}img{width:100%;height:240px;object-fit:contain}article div{display:flex;justify-content:space-between;gap:12px}</style><main><h1>MTL Archives: pilot candidate review</h1><p class="notice"><strong>Unreviewed preparation set.</strong> Review image type, usable visual detail and related photographic families. Captions, archive titles and dates are hidden. This page contains no suggested judgments or benchmark results.</p><p>Use <a href="family-review-template.csv">the blank family/quality worksheet</a>. Click an image to inspect the verified delivery pixels. Write independent French/English queries in <a href="development-query-template.csv">the blank query worksheet</a> after the corpus review.</p><section class="grid">''' + ''.join(cards) + '</section></main></html>'
    atomic_new(review/'index.html', html.encode())
    worksheet(review/'family-review-template.csv',
              ['sample_id', 'record_id', 'reviewer', 'family_key', 'representative',
               'image_type', 'visible_text', 'usable_for_visual_queries', 'uncertain', 'note'],
              [dict(sample_id=item['sample_id'], record_id=item['record_id']) for item in items])
    worksheet(review/'development-query-template.csv',
              ['intent_id', 'author', 'fr', 'en', 'visible_relevance_criterion',
               'related_intent_cluster', 'bilingual_reviewer', 'equivalent_wording', 'note'],
              [dict(intent_id=f'dev-{i:02}') for i in range(1, 13)])
    packet = dict(schema='mtl-caption-feedback-candidate-review-v1',
                  snapshot=snapshot, purpose='preparation', review_status='unreviewed',
                  items=items, benchmark_eligible=False, labels=[],
                  independent_query_intents_pending=True)
    atomic_new(args.root/'candidate-review.json', encoded(packet))
    receipt = dict(schema='mtl-caption-feedback-pilot-preparation-v1',
                   study_id=imported['study_id'], import_id=imported['import_id'],
                   snapshot_id=snapshot, actual_records=len(rows),
                   candidate_groups=len({row['group'] for row in rows}),
                   metadata_and_image_bytes_verified=verified_bytes,
                   verification=verification, review_status='unreviewed',
                   benchmark_eligible=False, model_calls=0, human_labels=0,
                   independent_query_intents=0, preparation_byte_cap=args.max_download_bytes,
                   wall_seconds=time.monotonic()-started,
                   code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   packet_sha256=hashlib.sha256((args.root/'candidate-review.json').read_bytes()).hexdigest(),
                   pending=['human family/quality review', 'fixed family representatives',
                            'independent paired development queries', 'render/runtime profiling',
                            'protected heldout reference and final protocol'])
    atomic_new(args.root/'preparation-receipt.json', encoded(receipt))
    print(json.dumps(receipt, indent=2), flush=True)


if __name__ == '__main__':
    main()
