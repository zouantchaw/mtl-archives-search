import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from core import digest
from orientation import (
    VERSION,
    derive_upright,
    read_exif_orientation,
    reviewed_rotate,
    stage_cache_key,
    write_derived,
)


def jpeg_with_exif(orientation, size=(48, 32)):
    image = Image.new("RGB", size, (20, 40, 80))
    ImageDraw.Draw(image).rectangle([0, 0, size[0], 6], fill=(255, 0, 0))
    exif = image.getexif()
    if orientation is not None:
        exif[274] = orientation
    buf = io.BytesIO()
    kwargs = {"format": "JPEG", "quality": 95}
    if orientation is not None:
        kwargs["exif"] = exif
    image.save(buf, **kwargs)
    return buf.getvalue()


class Orientation(unittest.TestCase):
    def test_exif_tags_and_identity_keeps_bytes(self):
        upright = jpeg_with_exif(1)
        derived, rec = derive_upright(upright)
        self.assertEqual(read_exif_orientation(upright), 1)
        self.assertEqual(derived, upright)
        self.assertEqual(rec["degrees"], 0)
        self.assertEqual(rec["derived_sha256"], rec["original_sha256"])
        self.assertEqual(rec["version"], VERSION)

    def test_90_180_270_change_bytes_and_not_original(self):
        for tag, degrees in [(6, 90), (3, 180), (8, 270)]:
            original = jpeg_with_exif(tag, size=(40, 24))
            derived, rec = derive_upright(original)
            self.assertIsNotNone(derived)
            self.assertNotEqual(derived, original)
            self.assertEqual(rec["degrees"], degrees)
            self.assertNotEqual(rec["derived_sha256"], rec["original_sha256"])

    def test_missing_exif_abstains(self):
        original = jpeg_with_exif(None)
        derived, rec = derive_upright(original)
        self.assertIsNone(derived)
        self.assertEqual(rec["review_state"], "abstain")
        self.assertIsNone(rec["degrees"])

    def test_reencode_control_identity_does_not_resave(self):
        original = jpeg_with_exif(1)
        resaved = io.BytesIO()
        Image.open(io.BytesIO(original)).save(resaved, format="JPEG", quality=95)
        self.assertNotEqual(resaved.getvalue(), original)
        derived, rec = derive_upright(original)
        self.assertEqual(derived, original)
        self.assertEqual(rec["method"], "exif")

    def test_reviewed_rotate_and_stage_cache_do_not_overwrite_source(self):
        original = jpeg_with_exif(None, size=(36, 20))
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "original.jpg"
            source.write_bytes(original)
            derived, rec = reviewed_rotate(original, 90)
            dest = write_derived(source, derived, Path(temp) / "derived")
            self.assertEqual(source.read_bytes(), original)
            self.assertNotEqual(dest.read_bytes(), original)
            self.assertEqual(rec["degrees"], 90)
            self.assertEqual(
                stage_cache_key(digest(original)),
                dest.stem,
            )


if __name__ == "__main__":
    unittest.main()
