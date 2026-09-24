# /// script
# requires-python = ">=3.11"
# dependencies = ["skia-python==144.0.post2", "numpy>=2", "segno>=1.6"]
# ///
"""Stage title slide: a still dandelion clock at dusk with one seed drifting past.

Renders a seamless loop (the drifting seed is off-screen at both ends of it), then
stream-copies that loop end to end into a long H.264 MP4 for iPhone Photos, which
does not loop videos. Everything but the seed is rendered once.

    uv run demo/tools/title-slide.py --url https://example.com/whim-beta
    uv run demo/tools/title-slide.py --url ... --still   # PNG frames only, no video

Output lands in demo/out/stage-title/ (gitignored).
"""

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import segno
import skia

REPO = Path(__file__).resolve().parents[2]
FONTS = REPO / "assets" / "fonts"
OUT = REPO / "demo" / "out" / "stage-title"

W, H = 1920, 1080
FPS = 30
LOOP_S = 45  # one seed crossing plus a quiet gap; the loop seam falls in the gap

# Brand (release/assets/brand.json, icon-foreground.svg).
INDIGO = (0x3F, 0x3D, 0x8F)
PAPER = (0xFB, 0xFA, 0xF8)
W_PATH = [(362, 390), (437, 650), (512, 490), (587, 650), (662, 390)]  # in a 1024 box
W_STROKE = 52


def color(rgb, a=1.0):
    return skia.Color4f(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, a)


def stroke(rgb, width, a=1.0):
    p = skia.Paint(AntiAlias=True, Style=skia.Paint.kStroke_Style, StrokeWidth=width,
                   StrokeCap=skia.Paint.kRound_Cap, StrokeJoin=skia.Paint.kRound_Join)
    p.setColor4f(color(rgb, a))
    return p


def fill(rgb, a=1.0):
    p = skia.Paint(AntiAlias=True)
    p.setColor4f(color(rgb, a))
    return p


def font(name, size):
    return skia.Font(skia.Typeface.MakeFromFile(str(FONTS / name)), size)


# --- the dandelion ------------------------------------------------------------------

def basis(d):
    """Two unit vectors perpendicular to d and to each other."""
    a = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(d, a)
    u /= np.linalg.norm(u)
    return u, np.cross(d, u)


def seed_strokes(d, scale, rng, filaments=16, spin=0.0, achene_alpha=0.22,
                 spread_deg=(58, 74), pappus_alpha=0.40):
    """Line segments for one seed pointing along unit 3D vector d, from the receptacle out.

    Returns [(p0, p1, ctrl_or_None, width, alpha, z)], in units of `scale` around the
    origin (x right, y down, z toward the viewer).
    """
    u, v = basis(d)
    achene0, achene1, tip = 0.10 * scale, 0.20 * scale, 0.60 * scale
    segs = [
        (d * achene0, d * achene1, None, 0.018 * scale, achene_alpha),
        (d * achene1, d * tip, None, 0.0055 * scale, 0.5),
    ]
    t = d * tip
    for k in range(filaments):
        th = spin + 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / filaments
        spread = math.radians(rng.uniform(*spread_deg))
        f = d * math.cos(spread) + (u * math.cos(th) + v * math.sin(th)) * math.sin(spread)
        length = 0.34 * scale * rng.uniform(0.9, 1.05)
        end = t + f * length
        # Filaments curve outward: bend the midpoint away from the seed's axis.
        ctrl = t + f * length * 0.5 - d * length * 0.10
        segs.append((t, end, ctrl, 0.005 * scale, pappus_alpha))
    return [(a, b, c, w, al, float((a[2] + b[2]) / 2)) for a, b, c, w, al in segs]


def draw_segs(canvas, segs, center, depth_scale, tint=PAPER, alpha=1.0, rot=None):
    """Orthographic projection, back to front, alpha falling off with depth."""
    cx, cy = center
    segs = sorted(segs, key=lambda s: s[5])
    for a, b, c, w, al, z in segs:
        if rot is not None:
            a, b = rot @ a, rot @ b
            c = rot @ c if c is not None else None
        depth = 0.5 + 0.5 * max(-1.0, min(1.0, z / depth_scale))
        paint = stroke(tint, w, alpha * al * (0.35 + 0.65 * depth))
        if c is None:
            canvas.drawLine(cx + a[0], cy + a[1], cx + b[0], cy + b[1], paint)
        else:
            path = skia.Path()
            path.moveTo(cx + a[0], cy + a[1])
            path.quadTo(cx + c[0], cy + c[1], cx + b[0], cy + b[1])
            canvas.drawPath(path, paint)


def dandelion_head(radius, rng):
    """All seed strokes of a clock with a wind-blown gap on its upper right."""
    n = 260
    golden = math.pi * (3 - math.sqrt(5))
    stem_axis = np.array([0.08, 1.0, 0.0])
    stem_axis /= np.linalg.norm(stem_axis)
    wind = np.array([0.88, -0.42, 0.10])
    wind /= np.linalg.norm(wind)
    segs = []
    for i in range(n):
        y = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - y * y)
        d = np.array([math.cos(i * golden) * r, y, math.sin(i * golden) * r])
        d += rng.normal(0, 0.05, 3)
        d /= np.linalg.norm(d)
        if math.degrees(math.acos(np.clip(d @ stem_axis, -1, 1))) < 32:
            continue  # the stem joins here; no seeds
        gap = math.degrees(math.acos(np.clip(d @ wind, -1, 1)))
        if gap < 40 or (gap < 56 and rng.random() < (56 - gap) / 16):
            continue
        segs += seed_strokes(d, radius * rng.uniform(0.94, 1.03), rng)
    return segs


# --- static layers ------------------------------------------------------------------

def background(canvas, head):
    """Dusk indigo: a soft glow behind the clock, darker toward the corners."""
    canvas.clear(color(INDIGO))
    glow = skia.Paint(Shader=skia.GradientShader.MakeRadial(
        head, 900, [color((0x5A, 0x57, 0xB4), 0.55).toColor(), color(INDIGO, 0).toColor()]))
    canvas.drawRect(skia.Rect.MakeWH(W, H), glow)
    vignette = skia.Paint(Shader=skia.GradientShader.MakeRadial(
        (W * 0.5, H * 0.45), 1250,
        [color((0x24, 0x22, 0x5E), 0).toColor(), color((0x24, 0x22, 0x5E), 0).toColor(),
         color((0x24, 0x22, 0x5E), 0.75).toColor()], [0.0, 0.55, 1.0]))
    canvas.drawRect(skia.Rect.MakeWH(W, H), vignette)


def draw_dandelion(canvas, head, radius, rng):
    hx, hy = head
    # Stem: from below the frame, leaning a little into the wind, to the receptacle.
    stem = skia.Path()
    stem.moveTo(hx - 70, H + 20)
    stem.cubicTo(hx - 58, H - 90, hx - 6, hy + 160, hx, hy + 0.08 * radius)
    # Seen through the translucent head, the stem fades toward the receptacle.
    paint = stroke((0xE4, 0xE0, 0xEE), 9)
    paint.setShader(skia.GradientShader.MakeLinear(
        [(hx, hy), (hx, hy + 0.85 * radius)],
        [color((0xE4, 0xE0, 0xEE), 0.12).toColor(), color((0xE4, 0xE0, 0xEE), 0.70).toColor()]))
    canvas.drawPath(stem, paint)
    canvas.drawCircle(hx, hy, 0.09 * radius, fill((0xE9, 0xE4, 0xDA), 0.30))
    segs = dandelion_head(radius, rng)
    # A soft bloom under the sharp lines reads as a backlit photograph, not a diagram.
    rec = skia.PictureRecorder()
    draw_segs(rec.beginRecording(skia.Rect.MakeWH(W, H)), segs, head, radius)
    pic = rec.finishRecordingAsPicture()
    bloom = skia.Paint(ImageFilter=skia.ImageFilters.Blur(9, 9), Alpha=150)
    canvas.saveLayer(None, bloom)
    canvas.drawPicture(pic)
    canvas.restore()
    canvas.drawPicture(pic)


def draw_lockup(canvas, x, top, tile):
    """App icon (inverted: paper tile, indigo W) beside the word Whim, tagline below."""
    canvas.drawRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(x, top, tile, tile),
                                           tile * 0.23, tile * 0.23), fill(PAPER))
    # The icon's W sits inside the adaptive-icon safe zone; a launcher mask crops that
    # zone, so on a tile the W is drawn at the size people see on their home screen.
    s = 0.56 * tile / (300 + W_STROKE)
    cx, cy = x + tile / 2 - 512 * s, top + tile / 2 - 520 * s
    w = skia.Path()
    w.moveTo(cx + W_PATH[0][0] * s, cy + W_PATH[0][1] * s)
    for px, py in W_PATH[1:]:
        w.lineTo(cx + px * s, cy + py * s)
    canvas.drawPath(w, stroke(INDIGO, W_STROKE * s))

    word = font("InstrumentSans-SemiBold.ttf", 176)
    cap = word.getMetrics().fCapHeight
    canvas.drawString("Whim", x + tile + 46, top + tile / 2 + cap / 2, word, fill(PAPER))
    tag = font("Newsreader-Italic.ttf", 58)
    canvas.drawString("Small apps you describe.", x + 4, top + tile + 108, tag,
                      fill(PAPER, 0.82))


def draw_qr(canvas, url, label, right, center_y, size):
    qr = segno.make(url, error="m", micro=False)
    matrix = [list(row) for row in qr.matrix]
    n = len(matrix)
    quiet = 4
    module = size // (n + 2 * quiet)  # whole pixels per module: crisp edges survive H.264
    code = module * (n + 2 * quiet)
    lab = font("InstrumentSans-SemiBold.ttf", 70)
    gap = 44
    total = lab.getMetrics().fCapHeight + gap + code
    left = right - code
    top = center_y - total / 2 + lab.getMetrics().fCapHeight + gap
    canvas.drawRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(left, top, code, code), 34, 34),
                     fill(PAPER))
    ink = skia.Paint(AntiAlias=False)
    ink.setColor4f(color(INDIGO))
    for r, row in enumerate(matrix):
        for c, on in enumerate(row):
            if on:
                canvas.drawRect(skia.Rect.MakeXYWH(left + (c + quiet) * module,
                                                   top + (r + quiet) * module, module, module), ink)
    lw = lab.measureText(label)
    canvas.drawString(label, left + (code - lw) / 2, top - gap, lab, fill(PAPER))
    return qr.version, n, module, (left, top, code)


def static_frame(url, label):
    rng = np.random.default_rng(7)
    surface = skia.Surface.MakeRaster(skia.ImageInfo.Make(
        W, H, skia.ColorType.kRGBA_8888_ColorType, skia.AlphaType.kPremul_AlphaType))
    canvas = surface.getCanvas()
    head, radius = (770, 836), 285
    background(canvas, head)
    draw_dandelion(canvas, head, radius, rng)
    draw_lockup(canvas, 150, 176, 150)
    qr_info = draw_qr(canvas, url, label, right=W - 130, center_y=H / 2 + 6, size=660)
    arr = surface.makeImageSnapshot().toarray().copy()
    # Fixed grain, identical every frame: breaks gradient banding, costs nothing to encode.
    noise = np.random.default_rng(1).normal(0, 1.1, (H, W, 1))
    arr[..., :3] = np.clip(arr[..., :3].astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return skia.Image.fromarray(arr, colorType=skia.ColorType.kRGBA_8888_ColorType), qr_info


# --- the drifting seed --------------------------------------------------------------

# An updraft path: in from the left, low and level, rising more steeply past the clock
# and out through the top, clear of the QR code.
PATH = [(-120, 770), (240, 700), (560, 585), (870, 485), (1030, 320), (1090, 110), (1110, -160)]
TRAVEL_S = 37


def catmull(points, s):
    """Point on a Catmull-Rom spline through `points` at s in [0, 1]."""
    n = len(points) - 1
    i = min(int(s * n), n - 1)
    t = s * n - i
    p0, p1, p2, p3 = (np.array(points[max(0, min(n, j))], float) for j in (i - 1, i, i + 1, i + 2))
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def arc_table(points, samples=4000):
    pts = np.array([catmull(points, i / samples) for i in range(samples + 1)])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return np.concatenate([[0], np.cumsum(seg)]) / seg.sum()


def seed_pose(t, table):
    """Position, lean and spin of the drifting seed at loop time t, or None off-screen."""
    if t > TRAVEL_S:
        return None
    u = t / TRAVEL_S
    # Ease in and out a touch: the air picks it up, then carries it.
    u = u + 0.035 * math.sin(2 * math.pi * u)
    s = float(np.interp(u, table, np.linspace(0, 1, len(table))))
    x, y = catmull(PATH, s)
    x += 5 * math.sin(2 * math.pi * t / 7.3)
    y += 7 * math.sin(2 * math.pi * t / 6.1) + 3 * math.sin(2 * math.pi * t / 3.7 + 1.0)
    lean = math.radians(9 * math.sin(2 * math.pi * t / 5.2 + 0.4) + 5)
    spin = 2 * math.pi * t / 13.0
    return x, y, lean, spin


def drifting_seed(scale, spin):
    # Pappus up, achene hanging below: d points up the screen.
    d = np.array([0.0, -1.0, 0.0])
    segs = seed_strokes(d, scale, np.random.default_rng(3), filaments=24, spin=spin,
                        achene_alpha=0.8, spread_deg=(72, 84), pappus_alpha=0.62)
    # Re-centre on the achene–pappus midpoint so rotation looks like a hanging parachute.
    shift = d * 0.42 * scale
    return [(a - shift, b - shift, None if c is None else c - shift, w, al, z)
            for a, b, c, w, al, z in segs]


def rotate_z(angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def draw_seed(canvas, pose):
    x, y, lean, spin = pose
    tilt = np.array([[1, 0, 0], [0, math.cos(0.35), -math.sin(0.35)],
                     [0, math.sin(0.35), math.cos(0.35)]])  # seen a little from below
    segs = drifting_seed(150, spin)
    rot = rotate_z(lean) @ tilt
    # It is nearer the lens than the clock: slightly out of focus, slightly brighter.
    canvas.saveLayer(None, skia.Paint(ImageFilter=skia.ImageFilters.Blur(0.9, 0.9)))
    draw_segs(canvas, segs, (x, y), 60, alpha=1.0, rot=rot)
    canvas.restore()


# --- output ---------------------------------------------------------------------------

def render_frames(base, seconds):
    table = arc_table(PATH)
    surface = skia.Surface.MakeRaster(skia.ImageInfo.Make(
        W, H, skia.ColorType.kRGBA_8888_ColorType, skia.AlphaType.kPremul_AlphaType))
    canvas = surface.getCanvas()
    for i in range(int(seconds * FPS)):
        canvas.drawImage(base, 0, 0)
        pose = seed_pose(i / FPS, table)
        if pose is not None:
            draw_seed(canvas, pose)
        yield surface.makeImageSnapshot().tobytes()


def save_png(base, t, path):
    surface = skia.Surface(W, H)
    canvas = surface.getCanvas()
    canvas.drawImage(base, 0, 0)
    pose = seed_pose(t, arc_table(PATH))
    if pose is not None:
        draw_seed(canvas, pose)
    surface.makeImageSnapshot().save(str(path), skia.kPNG)


def encode(base, out, minutes):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("ffmpeg not found (brew install ffmpeg)")
    frames = LOOP_S * FPS
    with tempfile.TemporaryDirectory() as tmp:
        loop = Path(tmp) / "loop.mp4"
        cmd = [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
               "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
               "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
               "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-profile:v", "high",
               "-level", "4.2",
               # One keyframe per loop, no scene cuts: a still image must not pulse at
               # keyframes, and every loop copy starts on its own IDR.
               # Colour tags go in the bitstream (VUI), which survives the stream copy.
               "-x264-params", f"keyint={frames}:min-keyint={frames}:scenecut=0:"
                               "zones=0,0,q=4:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
               "-an", str(loop)]
        enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for k, buf in enumerate(render_frames(base, LOOP_S)):
            enc.stdin.write(buf)
            if k % FPS == 0:
                print(f"\r  rendering {k // FPS:>2}/{LOOP_S} s", end="", flush=True)
        enc.stdin.close()
        if enc.wait():
            sys.exit("ffmpeg failed encoding the loop")
        print()
        copies = math.ceil(minutes * 60 / LOOP_S)
        lst = Path(tmp) / "list.txt"
        lst.write_text("".join(f"file '{loop}'\n" for _ in range(copies)))
        subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "concat", "-safe", "0",
                        "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(out)],
                       check=True)
    return copies * LOOP_S


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", required=True, help="where the QR code points")
    ap.add_argument("--label", default="Get early access", help="line above the QR code")
    ap.add_argument("--minutes", type=float, default=5, help="video length (default 5)")
    ap.add_argument("--still", action="store_true", help="write PNG stills only")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    base, (version, n, module, _) = static_frame(args.url, args.label)
    print(f"QR: version {version}, {n}x{n} modules at {module}px each -> {args.url}")
    for t in (0, 12, 19):
        save_png(base, t, OUT / f"still-{t:02d}s.png")
    print(f"stills: {OUT}/still-*.png")
    if args.still:
        return
    out = OUT / "whim-title.mp4"
    total = encode(base, out, args.minutes)
    print(f"video: {out} ({total // 60} min {total % 60} s, {LOOP_S} s seamless loop, "
          f"{out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
