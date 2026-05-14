#!/usr/bin/env python3
"""Generate placeholder PNG icons + a viz picker thumbnail for Better Map.

These are intentionally simple SVG-flavored placeholders. The Phase 7 release
will swap in proper designed assets, but these are enough to ship a
functional app today and to satisfy Splunk's Manage Apps UI.

Run from the repo root: python3 scripts/gen_placeholder_icons.py
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO_ROOT = Path(__file__).resolve().parents[1]
STATIC = REPO_ROOT / "better_map" / "appserver" / "static"
VIZ_STATIC = STATIC / "visualizations" / "better_map"

# Better Map brand palette - vibrant teal accent on a dark navy backdrop.
BG = (16, 32, 53)
FG = (76, 217, 196)
HI = (255, 255, 255)


def _font(size: int) -> ImageFont.ImageFont:
    """Return a TrueType font if we can find one; otherwise PIL's default."""
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _round_rect(draw: ImageDraw.ImageDraw, xy, radius: int, fill) -> None:
    """Rounded-rectangle wrapper that works on older Pillow versions too."""
    if hasattr(draw, "rounded_rectangle"):
        draw.rounded_rectangle(xy, radius=radius, fill=fill)
    else:
        draw.rectangle(xy, fill=fill)


def make_app_icon(size: int) -> Image.Image:
    """Square Better Map app icon (used by Manage Apps and the launcher)."""
    img = Image.new("RGBA", (size, size), BG + (255,))
    d = ImageDraw.Draw(img)

    margin = size // 8
    _round_rect(
        d,
        (margin, margin, size - margin, size - margin),
        radius=max(2, size // 6),
        fill=FG + (255,),
    )

    # Simple "B" mark for Better Map.
    font = _font(int(size * 0.55))
    text = "B"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(
        ((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]),
        text,
        fill=BG + (255,),
        font=font,
    )
    return img


def make_app_logo(width: int, height: int) -> Image.Image:
    """Wide Better Map app logo for the Splunk app launcher row."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Square brand mark on the left.
    pad = max(2, height // 8)
    mark_size = height - 2 * pad
    _round_rect(
        d,
        (pad, pad, pad + mark_size, pad + mark_size),
        radius=max(2, height // 6),
        fill=FG + (255,),
    )

    mark_font = _font(int(mark_size * 0.7))
    mark_text = "B"
    mb = d.textbbox((0, 0), mark_text, font=mark_font)
    mw, mh = mb[2] - mb[0], mb[3] - mb[1]
    d.text(
        (pad + (mark_size - mw) / 2 - mb[0], pad + (mark_size - mh) / 2 - mb[1]),
        mark_text,
        fill=BG + (255,),
        font=mark_font,
    )

    # Wordmark to the right of the mark.
    word_font = _font(int(height * 0.5))
    word = "Better Map"
    wb = d.textbbox((0, 0), word, font=word_font)
    word_w, word_h = wb[2] - wb[0], wb[3] - wb[1]
    word_x = pad + mark_size + max(6, height // 4)
    word_y = (height - word_h) / 2 - wb[1]
    d.text((word_x, word_y), word, fill=HI + (255,), font=word_font)
    return img


def make_viz_preview(width: int = 320, height: int = 200) -> Image.Image:
    """Thumbnail that surfaces in the Dashboard Studio visualization picker."""
    img = Image.new("RGBA", (width, height), BG + (255,))
    d = ImageDraw.Draw(img)

    # Mock-map graticule.
    for x in range(0, width, 32):
        d.line([(x, 0), (x, height)], fill=(28, 49, 78), width=1)
    for y in range(0, height, 32):
        d.line([(0, y), (width, y)], fill=(28, 49, 78), width=1)

    # Mock heatmap blobs.
    for cx, cy, r in [(80, 130, 36), (170, 70, 28), (240, 140, 40)]:
        for ring in range(r, 0, -4):
            alpha = int(255 * (1 - ring / r) * 0.7)
            d.ellipse(
                (cx - ring, cy - ring, cx + ring, cy + ring),
                fill=FG + (alpha,),
            )

    # Mock marker dots.
    for x, y in [(60, 60), (130, 110), (220, 90), (270, 160)]:
        d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=HI + (255,))
        d.ellipse(
            (x - 2, y - 2, x + 2, y + 2),
            fill=BG + (255,),
        )

    # Caption.
    cap_font = _font(18)
    cap = "Better Map"
    cb = d.textbbox((0, 0), cap, font=cap_font)
    cw, ch = cb[2] - cb[0], cb[3] - cb[1]
    d.rectangle(
        (8, height - ch - 16, 8 + cw + 16, height - 4),
        fill=BG + (220,),
    )
    d.text(
        (16 - cb[0], height - ch - 12 - cb[1]),
        cap,
        fill=FG + (255,),
        font=cap_font,
    )
    return img


def main() -> None:
    STATIC.mkdir(parents=True, exist_ok=True)
    VIZ_STATIC.mkdir(parents=True, exist_ok=True)

    make_app_icon(36).save(STATIC / "appIcon.png")
    make_app_icon(72).save(STATIC / "appIcon_2x.png")
    make_app_logo(160, 40).save(STATIC / "appLogo.png")
    make_app_logo(320, 80).save(STATIC / "appLogo_2x.png")
    make_viz_preview(320, 200).save(VIZ_STATIC / "preview.png")

    # visualizations.conf references core.icon = icon.png as well, so ship one.
    make_app_icon(48).save(VIZ_STATIC / "icon.png")

    print("Generated:")
    for p in [
        STATIC / "appIcon.png",
        STATIC / "appIcon_2x.png",
        STATIC / "appLogo.png",
        STATIC / "appLogo_2x.png",
        VIZ_STATIC / "preview.png",
        VIZ_STATIC / "icon.png",
    ]:
        size = p.stat().st_size if p.exists() else 0
        print(f"  {p.relative_to(REPO_ROOT)} ({size} bytes)")


if __name__ == "__main__":
    main()
