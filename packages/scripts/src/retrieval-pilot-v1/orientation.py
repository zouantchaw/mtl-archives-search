"""Provenance-preserving orientation. Original bytes are never overwritten."""

import io
from pathlib import Path

from PIL import Image, ImageOps

from core import digest, orientation_provenance

VERSION = "orientation-v1"
EXIF_ORIENTATION = 274
TAG_TO_DEGREES = {1: 0, 3: 180, 6: 90, 8: 270}


def read_exif_orientation(jpeg_bytes):
    image = Image.open(io.BytesIO(jpeg_bytes))
    value = image.getexif().get(EXIF_ORIENTATION)
    if value in TAG_TO_DEGREES:
        return value
    return None


def derive_upright(jpeg_bytes, method="exif"):
    original_sha = digest(jpeg_bytes)
    tag = read_exif_orientation(jpeg_bytes)
    if tag is None:
        return None, orientation_provenance(
            original_sha, None, None, method, VERSION, "abstain"
        )
    degrees = TAG_TO_DEGREES[tag]
    if degrees == 0:
        return jpeg_bytes, orientation_provenance(
            original_sha, original_sha, 0, method, VERSION, "accepted"
        )
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(jpeg_bytes)))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95)
    derived = buf.getvalue()
    return derived, orientation_provenance(
        original_sha, digest(derived), degrees, method, VERSION, "accepted"
    )


def reviewed_rotate(jpeg_bytes, degrees, method="reviewed-rotate"):
    """Explicit human/reviewed rotation. Still writes a new object; never overwrites."""
    original_sha = digest(jpeg_bytes)
    if degrees == 0:
        return jpeg_bytes, orientation_provenance(
            original_sha, original_sha, 0, method, VERSION, "accepted"
        )
    image = Image.open(io.BytesIO(jpeg_bytes)).rotate(degrees, expand=True)
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95)
    derived = buf.getvalue()
    return derived, orientation_provenance(
        original_sha, digest(derived), degrees, method, VERSION, "accepted"
    )


def stage_cache_key(original_sha256):
    return digest({"stage": VERSION, "input": original_sha256})


def write_derived(original_path, derived_bytes, output_dir):
    original_path = Path(original_path)
    original = original_path.read_bytes()
    key = stage_cache_key(digest(original))
    dest = Path(output_dir) / f"{key}.jpg"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(derived_bytes)
    if dest.read_bytes() == original:
        raise ValueError("derived path must not alias original bytes for a transform")
    return dest
