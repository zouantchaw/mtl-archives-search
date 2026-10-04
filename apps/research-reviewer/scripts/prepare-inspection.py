"""Render bounded inspection inputs from verified pilot bytes; never edit sources.

Requires Pillow 12.1.0. Outputs content-addressed JPEGs and a manifest. These are
reviewer assistance inputs, not OCR/caption experiment artifacts or gold labels.
"""
import argparse, hashlib, io, json
from pathlib import Path
import PIL
from PIL import Image, ImageOps

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--cache', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
args = p.parse_args()
if PIL.__version__ != '12.1.0':
    raise ValueError('Use pinned Pillow 12.1.0 for this render recipe')
app = Path(__file__).resolve().parents[1]
pilot = json.loads((app/'src/pilot.json').read_text())
args.out.mkdir(parents=True, exist_ok=True)
recipe = dict(version='inspection-jpeg-v1', pillow=PIL.__version__, exif_transpose=True,
              mode='RGB', max_edge=6000, resample='LANCZOS', jpeg_quality=92,
              subsampling=0, optimize=True, enhancements=False)
items = []
for item in pilot['items']:
    ref = item['delivery']
    data = (args.cache/ref['sha256']).read_bytes()
    if len(data) != ref['size_bytes'] or hashlib.sha256(data).hexdigest() != ref['sha256']:
        raise ValueError('Source verification failed: '+item['sample_id'])
    with Image.open(io.BytesIO(data)) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        original_size = list(image.size)
        image.thumbnail((6000, 6000), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=92, subsampling=0, optimize=True)
        rendered = output.getvalue()
        if len(rendered) >= 20*1024**2:
            raise ValueError('Inspection render exceeds native Images limit')
        digest = hashlib.sha256(rendered).hexdigest()
        (args.out/digest).write_bytes(rendered)
        items.append(dict(id=item['sample_id'], sourceSha256=ref['sha256'],
                          sha256=digest, key='inspection/v1/'+digest+'.jpg',
                          size=len(rendered), width=image.width, height=image.height,
                          originalWidth=original_size[0], originalHeight=original_size[1]))
manifest = dict(schema='mtl-inspection-manifest-v1', snapshot=pilot['snapshot'],
                purpose='assisted_preparation_only', recipe=recipe, items=items)
(args.out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(dict(items=len(items), bytes=sum(x['size'] for x in items),
                      largest=max(x['size'] for x in items))))
