#!/usr/bin/env python3
"""Apply the docs/screenshots house treatment to a raw VHS capture.

The treatment (mesh gradient, window chrome, shadow) is specified in the repo
CLAUDE.md under "README Screenshots". This is the executable copy of it, so the
numbers here and the numbers there have to move together.

    python3 frame.py raw.png  out.png            # static capture
    python3 frame.py raw.gif  out.gif --width 1200

VHS captures at a 2x pixel ratio, so `s` is 2 unless told otherwise.
"""

import argparse
import math
from PIL import Image, ImageDraw, ImageFilter

# --- the gradient ----------------------------------------------------------
BASE = (10, 11, 24)
# x, y, radius (fractions of the canvas), colour
BLOBS = [
    (0.08, 0.06, 0.62, (79, 70, 229)),
    (0.92, 0.10, 0.55, (124, 58, 237)),
    (0.78, 0.95, 0.60, (16, 132, 129)),
    (0.20, 0.98, 0.52, (37, 39, 96)),
    (0.50, 0.45, 0.40, (30, 27, 75)),
]
# Evaluating per-pixel at full size is slow and bands; compute small and upscale.
GRADIENT_SAMPLE_WIDTH = 128
GRADIENT_BLUR = 2

# --- the window ------------------------------------------------------------
TITLE_BAR = 38
HAIRLINE = 1
CORNER_RADIUS = 14
EDGE_WIDTH = 1
EDGE_ALPHA = 0.15
LIGHT_SIZE = 12
LIGHT_X = (20, 40, 60)
LIGHT_COLORS = ("#ff5f57", "#febc2e", "#28c840")
BAR_FILL = (26, 26, 32)
HAIRLINE_FILL = (46, 46, 54)
SHADOW_TOP = 10
SHADOW_BOTTOM = 22
SHADOW_ALPHA = 0.59
SHADOW_BLUR = 26
PADDING = 64


def mesh_gradient(width, height):
    """Five blobs blended over a dark base, in order, with smoothstep falloff."""
    sw = GRADIENT_SAMPLE_WIDTH
    sh = max(1, round(height * sw / width))
    aspect = width / height
    small = Image.new("RGB", (sw, sh))
    px = small.load()

    for yi in range(sh):
        fy = (yi + 0.5) / sh
        for xi in range(sw):
            fx = (xi + 0.5) / sw
            r, g, b = BASE
            for bx, by, radius, (br, bg, bb) in BLOBS:
                dx = (fx - bx) * aspect
                dy = fy - by
                t = 1.0 - math.hypot(dx, dy) / (radius * aspect)
                if t <= 0:
                    continue
                t = t * t * (3 - 2 * t)
                r += (br - r) * t
                g += (bg - g) * t
                b += (bb - b) * t
            px[xi, yi] = (round(r), round(g), round(b))

    return small.resize((width, height), Image.LANCZOS).filter(
        ImageFilter.GaussianBlur(GRADIENT_BLUR)
    )


class Framer:
    """Precomputes everything that does not change between frames.

    The gradient and the shadow blur are the expensive steps and depend only on
    the capture's dimensions, so an animation pays for them once.
    """

    def __init__(self, capture_size, s=2):
        cw, ch = capture_size
        self.s = s
        self.bar = TITLE_BAR * s
        self.radius = CORNER_RADIUS * s
        self.pad = PADDING * s
        self.win_w = cw
        self.win_h = ch + self.bar
        self.capture_size = capture_size

        canvas = (self.win_w + 2 * self.pad, self.win_h + 2 * self.pad)

        # Gradient with the shadow already composited over it.
        backdrop = mesh_gradient(*canvas).convert("RGBA")
        shadow = Image.new("RGBA", canvas, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [
                self.pad,
                self.pad + SHADOW_TOP * s,
                self.pad + self.win_w - 1,
                self.pad + self.win_h - 1 + SHADOW_BOTTOM * s,
            ],
            radius=self.radius,
            fill=(0, 0, 0, round(255 * SHADOW_ALPHA)),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR * s))
        self.backdrop = Image.alpha_composite(backdrop, shadow)

        # Rounded-corner alpha mask over the whole window, bar included.
        self.mask = Image.new("L", (self.win_w, self.win_h), 0)
        ImageDraw.Draw(self.mask).rounded_rectangle(
            [0, 0, self.win_w - 1, self.win_h - 1], radius=self.radius, fill=255
        )

        # Title bar and the 1px edge, drawn once and reused per frame.
        self.bar_img = Image.new("RGB", (self.win_w, self.bar), BAR_FILL)
        bd = ImageDraw.Draw(self.bar_img)
        bd.rectangle(
            [0, self.bar - HAIRLINE * s, self.win_w, self.bar - 1], fill=HAIRLINE_FILL
        )
        dot = LIGHT_SIZE * s
        cy = self.bar / 2
        for x, color in zip(LIGHT_X, LIGHT_COLORS):
            cx = x * s
            bd.ellipse(
                [cx - dot / 2, cy - dot / 2, cx + dot / 2, cy + dot / 2], fill=color
            )

        self.edge = Image.new("RGBA", (self.win_w, self.win_h), (0, 0, 0, 0))
        ImageDraw.Draw(self.edge).rounded_rectangle(
            [0, 0, self.win_w - 1, self.win_h - 1],
            radius=self.radius,
            outline=(255, 255, 255, round(255 * EDGE_ALPHA)),
            width=EDGE_WIDTH * s,
        )

    def render(self, capture, width=None):
        win = Image.new("RGB", (self.win_w, self.win_h))
        win.paste(self.bar_img, (0, 0))
        win.paste(capture.convert("RGB"), (0, self.bar))
        win = Image.alpha_composite(win.convert("RGBA"), self.edge)

        out = self.backdrop.copy()
        out.paste(win, (self.pad, self.pad), self.mask)
        out = out.convert("RGB")

        if width and width != out.width:
            height = round(out.height * width / out.width)
            out = out.resize((width, height), Image.LANCZOS)
        return out


def process_png(src, dst, width, s):
    capture = Image.open(src).convert("RGB")
    Framer(capture.size, s).render(capture, width).save(dst, optimize=True)
    return Image.open(dst).size


def process_gif(src, dst, width, s):
    src_im = Image.open(src)
    framer = Framer(src_im.size, s)

    frames, durations = [], []
    for i in range(src_im.n_frames):
        src_im.seek(i)
        durations.append(src_im.info.get("duration", 40))
        frames.append(framer.render(src_im.convert("RGB"), width))

    # One palette for every frame, so the static gradient is bit-identical
    # between them and the delta encoder has almost nothing to store.
    step = max(1, len(frames) // 8)
    sample = frames[::step][:8]
    w, h = sample[0].size

    # The traffic lights are three ~20px dots on a mostly-text screen, so
    # median-cut drops them and they come back grey. Give the chrome colours a
    # block of their own so they survive into the palette.
    swatch_h = 60
    swatch = Image.new("RGB", (w, swatch_h))
    sd = ImageDraw.Draw(swatch)
    chrome = list(LIGHT_COLORS) + [BAR_FILL, HAIRLINE_FILL]
    band = w / len(chrome)
    for i, color in enumerate(chrome):
        sd.rectangle([round(i * band), 0, round((i + 1) * band), swatch_h], fill=color)

    montage = Image.new("RGB", (w, h * len(sample) + swatch_h))
    for i, f in enumerate(sample):
        montage.paste(f, (0, h * i))
    montage.paste(swatch, (0, h * len(sample)))
    palette = montage.quantize(colors=256, method=Image.Quantize.MEDIANCUT)

    quantized = [
        f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames
    ]
    quantized[0].save(
        dst,
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    return frames[0].size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=None, help="final width in px")
    ap.add_argument("--scale", type=int, default=2, help="capture pixel ratio")
    args = ap.parse_args()

    if args.src.lower().endswith(".gif"):
        size = process_gif(args.src, args.dst, args.width or 1200, args.scale)
    else:
        size = process_png(args.src, args.dst, args.width or 2000, args.scale)
    print(f"{args.dst}  {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
