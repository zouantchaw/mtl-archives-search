"""Generate Instagram reel video from research + images using ffmpeg."""
import os
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

# Reel specs
WIDTH = 1080
HEIGHT = 1920
FPS = 30
PREP_W = 2160  # 2x for zoom headroom
PREP_H = 3840

# Text card styling
BG_COLOR = (0, 0, 0)
TEXT_COLOR = (255, 255, 255)
FONT_SIZE_LARGE = 72
FONT_SIZE_MEDIUM = 54
FONT_SIZE_SMALL = 42

# Try system fonts
FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _get_font(size: int) -> ImageFont.FreeTypeFont:
    """Load a bold font at the given size."""
    for fp in FONT_PATHS:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Word-wrap text to fit within max_width pixels."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        bbox = font.getbbox(test)
        if bbox[2] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _create_text_card(text: str, output_path: str, font_size: int = FONT_SIZE_LARGE) -> str:
    """Create a black card with centered white text (fallback)."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)
    font = _get_font(font_size)

    lines = _wrap_text(text.upper(), font, WIDTH - 120)

    # Calculate total height
    line_height = font_size + 16
    total_h = len(lines) * line_height
    y_start = (HEIGHT - total_h) // 2

    for i, line in enumerate(lines):
        bbox = font.getbbox(line)
        text_w = bbox[2] - bbox[0]
        x = (WIDTH - text_w) // 2
        draw.text((x, y_start + i * line_height), line, fill=TEXT_COLOR, font=font)

    img.save(output_path, quality=95)
    return output_path


def _create_text_overlay(
    text: str,
    bg_image_path: str,
    output_path: str,
    font_size: int = FONT_SIZE_LARGE,
    darken: float = 0.4,
    blur_radius: int = 8,
) -> str:
    """
    Create text overlay on darkened/blurred background image.
    More engaging than pure black cards - keeps visual continuity.
    """
    # Load and prepare background
    bg = Image.open(bg_image_path)
    w, h = bg.size

    # Crop to 9:16 aspect ratio
    target_aspect = 9 / 16
    current_aspect = w / h
    if current_aspect > target_aspect:
        new_w = int(h * target_aspect)
        left = (w - new_w) // 2
        bg = bg.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_aspect)
        top = (h - new_h) // 2
        bg = bg.crop((0, top, w, top + new_h))

    # Resize to reel dimensions
    bg = bg.resize((WIDTH, HEIGHT), Image.LANCZOS)

    # Apply blur for dreamy effect
    bg = bg.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    # Darken the image
    enhancer = ImageEnhance.Brightness(bg)
    bg = enhancer.enhance(darken)

    # Draw text with shadow for readability
    draw = ImageDraw.Draw(bg)
    font = _get_font(font_size)

    lines = _wrap_text(text.upper(), font, WIDTH - 100)

    line_height = font_size + 20
    total_h = len(lines) * line_height
    y_start = (HEIGHT - total_h) // 2

    for i, line in enumerate(lines):
        bbox = font.getbbox(line)
        text_w = bbox[2] - bbox[0]
        x = (WIDTH - text_w) // 2
        y = y_start + i * line_height

        # Draw shadow (offset by 3px)
        draw.text((x + 3, y + 3), line, fill=(0, 0, 0, 180), font=font)
        # Draw main text
        draw.text((x, y), line, fill=TEXT_COLOR, font=font)

    bg.save(output_path, quality=95)
    return output_path


def _prepare_photo(image_path: str, output_path: str) -> str:
    """Prepare photo for 9:16 reel with 2x zoom headroom."""
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

    img = img.resize((PREP_W, PREP_H), Image.LANCZOS)
    img.save(output_path, quality=95)
    return output_path


def generate_reel(
    research: dict,
    main_image: str,
    grid_images: list[str],
    output_path: str,
    work_dir: str | None = None,
    use_overlay: bool = True,
) -> str:
    """
    Generate a 25-30s Instagram reel from research + images.

    Narrative structure:
    1. Hook (text) - 2.5s
    2. Main photo - 3.5s
    3. Who (text) - 3s
    4. What (text) - 2.5s
    5. Detail photo - 3s
    6. Context (text) - 3s
    7. Detail photo - 3s
    8. Legacy (text) - 3s
    9. Detail photo - 3s
    10. CTA (text) - 2.5s

    Args:
        use_overlay: If True, text cards use blurred image backgrounds.
                     If False, uses plain black backgrounds (legacy).
    """
    if work_dir is None:
        work_dir = tempfile.mkdtemp(prefix="reel_")

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)

    segments = []

    # --- Build text cards ---
    hook_text = research.get("fun_fact", research.get("title", "Did you know?"))
    who_text = research.get("who", "Unknown subject")
    what_text = research.get("what", "A moment in Montreal history")
    context_text = research.get("context", research.get("materials", ""))
    legacy_text = research.get("legacy", "Lost to time")
    cta_text = research.get("cta", "Explorez 13 000+ photos\nlien en bio")

    # Build list of available background images for text cards
    bg_images = [main_image] + [g for g in grid_images if os.path.exists(g)]

    # Text cards with their background image assignments
    # Cycle through available images for visual variety
    text_cards = [
        ("t01_hook.png", hook_text, FONT_SIZE_MEDIUM, bg_images[0 % len(bg_images)]),
        ("t02_who.png", who_text, FONT_SIZE_MEDIUM, bg_images[1 % len(bg_images)]),
        ("t03_what.png", what_text, FONT_SIZE_MEDIUM, bg_images[2 % len(bg_images)]),
        ("t04_context.png", context_text, FONT_SIZE_MEDIUM, bg_images[3 % len(bg_images)]),
        ("t05_legacy.png", legacy_text, FONT_SIZE_MEDIUM, bg_images[0 % len(bg_images)]),
        ("t06_cta.png", cta_text, FONT_SIZE_LARGE, bg_images[1 % len(bg_images)]),
    ]

    for fname, text, size, bg_img in text_cards:
        out_path = str(work / fname)
        if use_overlay and bg_img:
            _create_text_overlay(text, bg_img, out_path, size)
        else:
            _create_text_card(text, out_path, size)

    # --- Prepare photos ---
    photo_main = str(work / "photo_main.jpg")
    _prepare_photo(main_image, photo_main)

    # Pick up to 3 grid images for detail shots
    detail_photos = []
    for i, gp in enumerate(grid_images[:3]):
        if os.path.exists(gp):
            out = str(work / f"photo_detail_{i}.jpg")
            _prepare_photo(gp, out)
            detail_photos.append(out)

    # --- Build video segments ---
    def _text_segment(name: str, png: str, duration: float):
        """Text card with fade in/out."""
        frames = int(duration * FPS)
        fade_out_start = frames - 12
        out = str(work / f"{name}.mp4")
        subprocess.run([
            "ffmpeg", "-y", "-loop", "1", "-t", str(duration), "-i", png,
            "-vf", f"fade=in:0:12,fade=out:{fade_out_start}:12,format=yuv420p",
            "-c:v", "libx264", "-preset", "fast", "-r", str(FPS),
            "-pix_fmt", "yuv420p", out,
        ], capture_output=True, timeout=30)
        return out

    def _photo_segment(name: str, jpg: str, duration: float):
        """Photo with Ken Burns slow zoom."""
        frames = int(duration * FPS)
        zoom_rate = 0.00048 if duration >= 3.5 else 0.00056
        out = str(work / f"{name}.mp4")
        subprocess.run([
            "ffmpeg", "-y", "-i", jpg,
            "-vf", (
                f"zoompan=z='1+on*{zoom_rate}'"
                f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS}"
                ",format=yuv420p"
            ),
            "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", out,
        ], capture_output=True, timeout=60)
        return out

    # Segment timeline
    seg_defs = [
        ("seg_01", "text", "t01_hook.png", 2.5),
        ("seg_02", "photo", photo_main, 3.5),
        ("seg_03", "text", "t02_who.png", 3.0),
        ("seg_04", "text", "t03_what.png", 2.5),
    ]

    # Interleave detail photos with remaining text
    if len(detail_photos) >= 1:
        seg_defs.append(("seg_05", "photo_raw", detail_photos[0], 3.0))
    seg_defs.append(("seg_06", "text", "t04_context.png", 3.0))

    if len(detail_photos) >= 2:
        seg_defs.append(("seg_07", "photo_raw", detail_photos[1], 3.0))

    seg_defs.append(("seg_08", "text", "t05_legacy.png", 3.0))

    if len(detail_photos) >= 3:
        seg_defs.append(("seg_09", "photo_raw", detail_photos[2], 3.0))

    seg_defs.append(("seg_10", "text", "t06_cta.png", 2.5))

    # Build each segment
    for name, stype, src, dur in seg_defs:
        if stype == "text":
            seg = _text_segment(name, str(work / src), dur)
        elif stype == "photo":
            seg = _photo_segment(name, src, dur)
        elif stype == "photo_raw":
            seg = _photo_segment(name, src, dur)
        segments.append(seg)

    # --- Compose with crossfades ---
    if len(segments) < 2:
        raise RuntimeError("Need at least 2 segments to compose a reel")

    # Calculate xfade offsets
    durations = [d for _, _, _, d in seg_defs]
    xfade_dur = 0.5
    inputs = []
    for s in segments:
        inputs.extend(["-i", s])

    # Build xfade filter chain
    filter_parts = []
    running_offset = durations[0] - xfade_dur
    for i in range(1, len(segments)):
        prev = f"[v{i-2:02d}]" if i > 1 else "[0:v]"
        curr = f"[{i}:v]"
        out_label = f"[v{i-1:02d}]" if i < len(segments) - 1 else "[vfinal]"
        filter_parts.append(
            f"{prev}{curr}xfade=transition=fade:duration={xfade_dur}:offset={running_offset:.1f}{out_label}"
        )
        if i < len(segments) - 1:
            running_offset += durations[i] - xfade_dur

    filter_complex = ";\n".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vfinal]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg compose failed:\n{result.stderr[-1000:]}")

    return output_path
