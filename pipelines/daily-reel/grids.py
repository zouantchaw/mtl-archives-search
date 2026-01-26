"""Generate contextual grid crops from a source image."""
from PIL import Image
import os


def generate_grids(image_path: str, output_dir: str, num_grids: int = 5) -> list[str]:
    """
    Generate detail grid crops from a source image.

    Creates:
    - grid01: Full image (cover/system view)
    - grid02-05: Detail crops from different quadrants

    Returns list of output file paths.
    """
    os.makedirs(output_dir, exist_ok=True)
    img = Image.open(image_path)
    w, h = img.size

    outputs = []

    # Grid 1: Cover - full image (square crop from center)
    cover_size = min(w, h)
    left = (w - cover_size) // 2
    top = (h - cover_size) // 2
    cover = img.crop((left, top, left + cover_size, top + cover_size))
    cover = cover.resize((1080, 1080), Image.LANCZOS)
    cover_path = os.path.join(output_dir, "grid01_cover.jpg")
    cover.save(cover_path, quality=92)
    outputs.append(cover_path)

    # Generate detail crops from interesting regions
    # Strategy: divide image into zones and crop the most interesting ones
    crop_regions = _get_crop_regions(w, h, num_grids - 1)

    for i, (x1, y1, x2, y2) in enumerate(crop_regions, start=2):
        crop = img.crop((x1, y1, x2, y2))
        # Resize to square for consistency
        crop = crop.resize((900, 900), Image.LANCZOS)
        crop_path = os.path.join(output_dir, f"grid{i:02d}_detail.jpg")
        crop.save(crop_path, quality=92)
        outputs.append(crop_path)

    return outputs


def _get_crop_regions(w: int, h: int, num_crops: int) -> list[tuple[int, int, int, int]]:
    """
    Generate crop regions that cover interesting parts of the image.
    Uses a strategy of overlapping quadrants + center detail.
    """
    crop_size_w = int(w * 0.45)  # Each crop is ~45% of original width
    crop_size_h = int(h * 0.45)

    regions = []

    if num_crops >= 1:
        # Top-left quadrant
        regions.append((0, 0, crop_size_w, crop_size_h))

    if num_crops >= 2:
        # Top-right quadrant
        regions.append((w - crop_size_w, 0, w, crop_size_h))

    if num_crops >= 3:
        # Bottom-left quadrant
        regions.append((0, h - crop_size_h, crop_size_w, h))

    if num_crops >= 4:
        # Bottom-right quadrant
        regions.append((w - crop_size_w, h - crop_size_h, w, h))

    if num_crops >= 5:
        # Center detail (tighter crop - 30%)
        center_w = int(w * 0.35)
        center_h = int(h * 0.35)
        cx, cy = w // 2, h // 2
        regions.append((cx - center_w // 2, cy - center_h // 2,
                       cx + center_w // 2, cy + center_h // 2))

    return regions[:num_crops]


def prepare_for_reel(image_path: str, output_path: str, target_w: int = 2160, target_h: int = 3840) -> str:
    """Prepare an image for 9:16 reel format with zoom headroom."""
    img = Image.open(image_path)
    w, h = img.size

    target_aspect = 9 / 16
    current_aspect = w / h

    if current_aspect > target_aspect:
        new_w = int(h * target_aspect)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_aspect)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))

    img = img.resize((target_w, target_h), Image.LANCZOS)
    img.save(output_path, quality=95)
    return output_path
