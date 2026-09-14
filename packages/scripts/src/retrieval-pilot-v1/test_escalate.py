import io
import unittest

from PIL import Image, ImageDraw

from escalate import escalation_reasons, should_escalate


def jpeg_with_exif(orientation, size=(32, 24)):
    image = Image.new("RGB", size, (30, 30, 30))
    ImageDraw.Draw(image).rectangle([0, 0, size[0], 4], fill=(200, 0, 0))
    buf = io.BytesIO()
    kwargs = {"format": "JPEG", "quality": 90}
    if orientation is not None:
        exif = image.getexif()
        exif[274] = orientation
        kwargs["exif"] = exif
    image.save(buf, **kwargs)
    return buf.getvalue()


class Escalate(unittest.TestCase):
    def test_missing_exif_street_photo_does_not_escalate(self):
        jpeg = jpeg_with_exif(None)
        self.assertEqual(
            escalation_reasons(
                jpeg,
                {"viewpoint": "ground", "image_kind": "photograph"},
                {},
            ),
            [],
        )
        self.assertFalse(should_escalate(jpeg, {"image_kind": "photograph"}, {}))

    def test_exif_90_and_270_escalate(self):
        self.assertIn("exif_rotated", escalation_reasons(jpeg_with_exif(6)))
        self.assertIn("exif_rotated", escalation_reasons(jpeg_with_exif(8)))
        self.assertEqual(escalation_reasons(jpeg_with_exif(1)), [])

    def test_reviewed_sideways_escalates_without_exif(self):
        jpeg = jpeg_with_exif(None)
        self.assertEqual(
            escalation_reasons(jpeg, {}, {"sideways": True}),
            ["reviewed_sideways"],
        )

    def test_map_or_document_kind_escalates(self):
        jpeg = jpeg_with_exif(1)
        self.assertEqual(
            escalation_reasons(jpeg, {"image_kind": "map"}, {}),
            ["kind_map"],
        )
        self.assertEqual(
            escalation_reasons(jpeg, {}, {"image_kind": "document"}),
            ["kind_document"],
        )


if __name__ == "__main__":
    unittest.main()
