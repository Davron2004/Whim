#!/usr/bin/env python3
"""Cut the Whim LinkedIn demo from raw adb screenrecord takes.

Successor to the ad hoc demo/raw/linkedin-cut.py. Everything that decides what
the video looks like lives in SEGMENTS and the constants above it; the rest is
plumbing.

    python3 demo/tools/linkedin-cut.py                 # preview (shots 1-3)
    python3 demo/tools/linkedin-cut.py --out demo/out/linkedin-full.mp4

Why it is shaped this way
-------------------------
* The raw takes are 60 fps VFR. Seeking into them with `-ss` before `-i` lands
  on the wrong frame. So every source is first normalised once into a 30 fps
  CFR, canvas-sized intermediate under WORK/, and all SEGMENTS timestamps refer
  to the ORIGINAL source seconds (the normalise pass is 1:1 in time).
* This ffmpeg build has no `drawtext`. Captions and the end card are rendered
  to full-canvas RGBA PNGs with Pillow and overlaid, which also buys us a
  rounded caption pill and real font control.

Adding shot 4 / shot 5 is appending rows to SEGMENTS (and a SOURCES entry).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
RAW = os.path.join(REPO, "demo", "raw", "2026-09-11")
WORK = os.path.join(REPO, "demo", "out", ".work")

# ---------------------------------------------------------------- format ----
CANVAS_W, CANVAS_H = 1080, 1920          # 9:16
FPS = 30
BG = (0x1c, 0x19, 0x17)                  # flat dark ground behind the phone
PHONE_H = CANVAS_H                       # phone footage is full canvas height
PHONE_W = 862                            # 1080x2404 scaled to 1920 tall
PHONE_X = (CANVAS_W - PHONE_W) // 2
CORNER_RADIUS = 48

FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_BOLD = 1                            # face index of "Bold" inside the .ttc

CAP_SIZE = 46
CAP_MIN_SIZE = 38
CAP_Y = 0.74                             # pill centre, as a fraction of canvas height
CAP_PILL_ALPHA = 217                     # ~85%
CAP_PAD_X, CAP_PAD_Y = 44, 26
CAP_MAX_W = 940                          # pill never wider than this
CAP_FADE = 0.25

END_CARD_SEC = 3.0
CRF = "18"
PRESET = "veryfast"
THREADS = "2"

# ---------------------------------------------------------------- sources ---
SOURCES = {
    # key: path relative to demo/raw/2026-09-11
    # Shot 1 is the RAW take, not the -tight one: the tightener lost the ending.
    # Its timeline has a seam at 340 s (~170 s of static wall time missing);
    # that sits inside the ghost-tile hold, which we cut through anyway.
    "S1": "shot-1/take-1.failed.mp4",
    "S2": "shot-2/take-2-tight.mp4",
    "S3": "shot-3/take-1-tight.mp4",
    # Shot 4 is the RAW take too, for the same reason, and it has TWO hazards:
    # a missing ~170 s of wall time at file time 340 s, and a segment boundary
    # at 510 s. Both sit inside the long build hold; no kept segment may span
    # either, and none does (the last one ends at 502.2).
    "S4": "shot-4/take-4.failed.mp4",
    "S5": "shot-5/take-1.mp4",
}


@dataclass
class Seg:
    src: str                 # key into SOURCES
    t_in: float              # seconds in the ORIGINAL source
    t_out: float
    speed: float = 1.0
    caption: str | None = None
    caption_y: float = CAP_Y  # pill centre as a fraction of canvas height
    # When one caption spans two consecutive rows (a segment split to skip a few
    # frames), drop the fade at the join so the pill does not blink.
    cap_fade_in: bool = True
    cap_fade_out: bool = True
    note: str = ""            # goes in the recipe, not on screen
    path: str = field(default="", repr=False)

    # Timestamps are snapped to source frame boundaries, and the trim window is
    # offset by half a frame so a boundary never lands ambiguously inside one.
    # Without this a segment silently comes out a frame short and the recipe's
    # cumulative timestamps drift away from the file.
    @property
    def f_in(self) -> int:
        return round(self.t_in * FPS)

    @property
    def f_out(self) -> int:
        return round(self.t_out * FPS)

    @property
    def frames(self) -> int:
        """Output frame count."""
        return round((self.f_out - self.f_in) / self.speed)

    @property
    def dur(self) -> float:
        return self.frames / FPS


# ---------------------------------------------------------------- the cut ---
# Landmarks verified against 1 fps contact sheets of each source, not from the
# sidecar alone. Cuts land just AFTER a tap ring finishes (rings run 0.65 s from
# the tap time in take-1.failed.json) so no ring is ever sliced in half.
SEGMENTS: list[Seg] = [
    # --- shot 1: describe it, watch it get built -----------------------------
    Seg("S1", 13.9, 16.4, 1, "Whim. Say what you want. Get an app.",
        caption_y=0.583,
        note="home grid, tap the composer (ring 15.5–16.1); caption raised because "
             "the keyboard is already up by 16.3"),
    Seg("S1", 16.6, 52.0, 8, "Describe it in plain words", caption_y=0.583,
        note="typing the prompt; caption raised clear of the keyboard"),
    Seg("S1", 55.8, 57.4, 1, None,
        note="Continue (ring 56.1) -> 'Thinking about what to ask'"),
    Seg("S1", 106.3, 108.9, 1, "It asks when something's unclear",
        note="'Two quick things' clarify screen, answer tapped (ring 108.0)"),
    Seg("S1", 113.2, 114.6, 1, None,
        note="Continue (ring 113.6) -> plan screen"),
    Seg("S1", 114.6, 121.4, 4, "A plan you can read before it builds",
        note="plan rows drafting in, skeleton -> text"),
    Seg("S1", 166.0, 168.3, 1, None,
        note="finished plan, 'Build it' (ring 167.5)"),
    Seg("S1", 179.9, 182.6, 1, "Building… (5 min, sped up)",
        note="'Leave it running' (ring 180.1) -> home grid with the ghost tile"),
    Seg("S1", 476.6, 480.7, 1, "Done. It's on your home screen.",
        note="ghost tile transmutes into the orange Tea Steeper tile (~477.5)"),

    # --- shot 2: use it ------------------------------------------------------
    Seg("S2", 0.4, 4.2, 1, "Tweak it. Run it.",
        note="grid -> open Tea Steeper -> card, 3:00 saved"),
    Seg("S2", 4.2, 8.4, 1, None,
        note="Adjust Time, drag 3:00 -> 7:20, Done, Start Timer, countdown"),

    # --- shot 3: it survives a force-quit ------------------------------------
    Seg("S3", 11.8, 13.6, 1, "Force-quit. Reopen.",
        note="mid-steep countdown, seconds before the kill"),
    Seg("S3", 16.7, 19.4, 1.5, None,
        note="white splash + cold start. Starts at 16.7, not earlier: the Android "
             "launcher is on screen until 16.2 and cross-fades out through 16.6, "
             "and none of it may appear in the cut"),
    # Split: the card's first two frames (23.234, 23.267) still show the default
    # 3:00 before the saved value hydrates. Cut out to 23.434, past the flash.
    # The caption runs across the join with the fades at the seam suppressed.
    Seg("S3", 20.2, 23.234, 1, "Still there.", cap_fade_out=False,
        note="grid -> tap Tea Steeper (ring 20.4–21.5) -> 'Opening…' (21.6), "
             "out on the last 'Opening…' frame"),
    Seg("S3", 23.434, 25.0, 1, "Still there.", cap_fade_in=False,
        note="card back, reading 7:20 (settled from 23.300)"),

    # --- shot 4: ask for a change, get a v2 ----------------------------------
    Seg("S4", 14.8, 20.4, 3, None,
        note="long-press the Tea Steeper tile (ring 15.3–18.9, a 3.6 s hold, so "
             "3x keeps it visible without stalling the cut) -> action sheet"),
    Seg("S4", 22.7, 25.2, 1, None,
        note="action sheet, 'Prompt again' (ring 23.7)"),
    Seg("S4", 25.2, 50.8, 8, "Change your mind? Just ask again.", caption_y=0.583,
        note="typing the strength-selector prompt; the action sheet fills the "
             "lower half, so this beat carries the caption instead of that one"),
    Seg("S4", 211.2, 213.9, 1, None,
        note="'Here's the change' plan, 'Make the change' (ring 213.0)"),
    Seg("S4", 228.0, 230.3, 1, "Building… (sped up)",
        note="'Leave it running' (ring 228.3) -> grid, tile back in its building state"),
    # Same split: 3:00 flashes on 499.067–499.133 before 7:20 hydrates.
    Seg("S4", 497.4, 499.067, 1, "New feature. Old settings kept.",
        cap_fade_out=False,
        note="tap the tile (ring 497.8) -> 'Opening…', out on its last frame"),
    Seg("S4", 499.267, 502.2, 1, "New feature. Old settings kept.",
        cap_fade_in=False,
        note="v2 card: a Strength row above the steep time, and the steep time "
             "is still 7:20 (settled from 499.167)"),

    # --- shot 5: every version is kept, and forkable -------------------------
    Seg("S5", 22.6, 25.3, 1, "Every version is kept. Fork any of them.",
        note="history list: v2 on top, v1 with 'Where this app began' below"),
    Seg("S5", 33.8, 35.7, 1, None,
        note="'Start a copy here' on the v1 row (ring 34.9)"),
    Seg("S5", 41.7, 44.3, 1, None,
        note="'Start a second app from v1?' -> Make the copy (ring 42.0) -> toast"),
    Seg("S5", 53.4, 57.1, 1, "The copy runs the old version",
        note="two tiles on the grid, open the fork (ring 53.9): no Strength row, "
             "3:00. Checked frame-by-frame at the landing (55.067): no hydration "
             "flash here — 3:00 IS the fork's saved value, so no split"),
    # Same split, one flash frame this time (68.634).
    Seg("S5", 67.6, 68.634, 1, "The original keeps the new one",
        cap_fade_out=False,
        note="open the original (ring 68.0) -> 'Opening…', out on its last frame"),
    Seg("S5", 68.834, 71.0, 1, "The original keeps the new one",
        cap_fade_in=False,
        note="v2 card: Strength row, 7:20 (settled from 68.667)"),
]

END_CARD = ("Whim", "Describe the app you want.")


# ---------------------------------------------------------------- helpers ---
def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"command failed ({proc.returncode}):\n  {' '.join(cmd)}\n{proc.stderr}")


def font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_PATH, size, index=FONT_BOLD)
    except Exception:
        return ImageFont.load_default()


def normalise(key: str) -> str:
    """One decode of the VFR source into a 30 fps, canvas-width CFR file.

    Time is preserved 1:1, so SEGMENTS timestamps stay readable against the
    original take and its sidecar JSON.
    """
    src = os.path.join(RAW, SOURCES[key])
    if not os.path.exists(src):
        sys.exit(f"missing source: {src}")
    dst = os.path.join(WORK, f"{key}.cfr.mp4")
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return dst
    print(f"  normalising {key} <- {SOURCES[key]}")
    run(["ffmpeg", "-v", "error", "-y", "-i", src,
         "-vf", f"fps={FPS},scale={PHONE_W}:{PHONE_H}:flags=bicubic,format=yuv420p",
         "-c:v", "libx264", "-crf", CRF, "-preset", PRESET, "-threads", THREADS,
         "-an", dst])
    return dst


def corner_mask() -> str:
    """Dark plate covering everything except a rounded-rect hole for the phone."""
    dst = os.path.join(WORK, "mask.png")
    if os.path.exists(dst):
        return dst
    s = 4  # supersample, so the corners are not staircases
    img = Image.new("RGBA", (CANVAS_W * s, CANVAS_H * s), BG + (255,))
    ImageDraw.Draw(img).rounded_rectangle(
        [PHONE_X * s, 0, (PHONE_X + PHONE_W) * s - 1, CANVAS_H * s - 1],
        radius=CORNER_RADIUS * s, fill=(0, 0, 0, 0))
    img.resize((CANVAS_W, CANVAS_H), Image.LANCZOS).save(dst)
    return dst


def wrap(text: str, f: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    for w in words:
        trial = f"{cur} {w}".strip()
        if cur and probe.textlength(trial, font=f) > max_w:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def caption_png(text: str, y_frac: float, idx: int) -> str:
    """Full-canvas RGBA overlay: white text in a dark rounded pill."""
    dst = os.path.join(WORK, f"cap{idx:02d}.png")
    max_text_w = CAP_MAX_W - 2 * CAP_PAD_X
    size = CAP_SIZE
    while True:
        f = font(size)
        lines = wrap(text, f, max_text_w)
        if len(lines) <= 2 or size <= CAP_MIN_SIZE:
            break
        size -= 2

    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    line_h = int(size * 1.28)
    text_w = max(probe.textlength(l, font=f) for l in lines)
    pill_w = int(text_w) + 2 * CAP_PAD_X
    pill_h = line_h * len(lines) + 2 * CAP_PAD_Y

    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = CANVAS_W // 2, int(CANVAS_H * y_frac)
    x0, y0 = cx - pill_w // 2, cy - pill_h // 2
    d.rounded_rectangle([x0, y0, x0 + pill_w, y0 + pill_h],
                        radius=pill_h // 2, fill=(20, 18, 17, CAP_PILL_ALPHA))
    ty = y0 + CAP_PAD_Y
    for line in lines:
        lw = probe.textlength(line, font=f)
        d.text((cx - lw / 2, ty), line, font=f, fill=(255, 255, 255, 255))
        ty += line_h
    img.save(dst)
    return dst


def end_card_png() -> str:
    dst = os.path.join(WORK, "endcard.png")
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), BG)
    d = ImageDraw.Draw(img)
    title, sub = END_CARD
    ft, fs = font(148), font(50)
    tw = d.textlength(title, font=ft)
    sw = d.textlength(sub, font=fs)
    d.text(((CANVAS_W - tw) / 2, CANVAS_H * 0.40), title, font=ft, fill=(255, 255, 255))
    d.text(((CANVAS_W - sw) / 2, CANVAS_H * 0.40 + 210), sub, font=fs, fill=(214, 211, 209))
    img.save(dst)
    return dst


def build_segment(seg: Seg, idx: int, cfr: str, mask: str) -> str:
    dst = os.path.join(WORK, f"seg{idx:02d}.mp4")
    dur = seg.dur
    inputs = ["-i", cfr,
              "-loop", "1", "-framerate", str(FPS), "-i", mask]
    chains = [
        f"[0:v]trim=start={(seg.f_in - 0.5) / FPS:.6f}:"
        f"end={(seg.f_out - 0.5) / FPS:.6f},"
        f"setpts=(PTS-STARTPTS)/{seg.speed},fps={FPS},format=rgba[ph]",
        f"color=c=0x{BG[0]:02x}{BG[1]:02x}{BG[2]:02x}:s={CANVAS_W}x{CANVAS_H}:"
        f"r={FPS}:d={dur},format=rgba[bg]",
        f"[bg][ph]overlay=x={PHONE_X}:y=0:shortest=1[v1]",
        "[v1][1:v]overlay=0:0:shortest=1[v2]",
    ]
    last = "v2"
    if seg.caption:
        inputs += ["-loop", "1", "-framerate", str(FPS), "-i",
                   caption_png(seg.caption, seg.caption_y, idx)]
        fades = "format=rgba"
        if seg.cap_fade_in:
            fades += f",fade=in:st=0:d={CAP_FADE}:alpha=1"
        if seg.cap_fade_out:
            fades += f",fade=out:st={round(dur - CAP_FADE, 3)}:d={CAP_FADE}:alpha=1"
        chains += [
            f"[2:v]{fades}[cap]",
            "[v2][cap]overlay=0:0:shortest=1[v3]",
        ]
        last = "v3"
    chains.append(f"[{last}]format=yuv420p[out]")

    run(["ffmpeg", "-v", "error", "-y", *inputs,
         "-filter_complex", ";".join(chains), "-map", "[out]",
         # exact frame count, not "-t seconds": a float duration can truncate a
         # frame, and the recipe's cumulative timestamps have to be the truth
         "-frames:v", str(seg.frames), "-r", str(FPS),
         "-c:v", "libx264", "-crf", CRF, "-preset", PRESET, "-threads", THREADS,
         "-pix_fmt", "yuv420p", "-an", dst])
    seg.path = dst
    return dst


def build_end_card() -> str:
    dst = os.path.join(WORK, "seg-end.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(FPS),
         "-i", end_card_png(), "-frames:v", str(round(END_CARD_SEC * FPS)),
         "-vf", f"fps={FPS},format=yuv420p",
         "-c:v", "libx264", "-crf", CRF, "-preset", PRESET, "-threads", THREADS,
         "-pix_fmt", "yuv420p", "-an", dst])
    return dst


def write_recipe(path: str, out: str, total: float) -> None:
    at = 0.0
    rows = []
    for seg in SEGMENTS:
        rows.append((f"{at:0.2f}", f"`{SOURCES[seg.src]}`",
                     f"{seg.t_in:g}–{seg.t_out:g}", f"{seg.speed:g}x",
                     f"{seg.dur:0.2f}",
                     seg.caption.replace("|", "\\|") if seg.caption else "—",
                     seg.note))
        at += seg.dur
    rows.append((f"{at:0.2f}", "end card", "—", "—", f"{END_CARD_SEC:0.2f}",
                 " / ".join(END_CARD), "static"))

    with open(path, "w") as f:
        f.write(f"# {os.path.basename(out)} — recipe\n\n")
        rel = os.path.relpath(out, REPO)
        f.write(f"Rebuild: `python3 demo/tools/linkedin-cut.py --out {rel}`\n\n")
        f.write(f"{CANVAS_W}x{CANVAS_H} · {FPS} fps · H.264 yuv420p · no audio track · "
                f"total **{total:0.2f} s**\n\n")
        f.write("| at | source | in–out (source s) | speed | len | caption | beat |\n")
        f.write("|---|---|---|---|---|---|---|\n")
        for r in rows:
            f.write("| " + " | ".join(r) + " |\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "demo", "out",
                                                  "linkedin-2026-09-11-preview.mp4"))
    ap.add_argument("--clean", action="store_true",
                    help="drop the intermediate cache first")
    args = ap.parse_args()

    if args.clean and os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    print("normalising sources")
    cfr = {k: normalise(k) for k in sorted({s.src for s in SEGMENTS})}
    mask = corner_mask()

    print("building segments")
    parts = []
    for i, seg in enumerate(SEGMENTS):
        print(f"  {i:02d} {seg.src} {seg.t_in:g}–{seg.t_out:g} @{seg.speed:g}x "
              f"= {seg.dur:0.2f}s  {seg.caption or ''}")
        parts.append(build_segment(seg, i, cfr[seg.src], mask))
    parts.append(build_end_card())

    lst = os.path.join(WORK, "concat.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
         "-c", "copy", "-movflags", "+faststart", args.out])

    total = sum(s.dur for s in SEGMENTS) + END_CARD_SEC
    recipe = args.out.rsplit(".", 1)[0] + ".recipe.md"
    write_recipe(recipe, args.out, total)
    print(f"\nwrote {args.out} ({total:0.2f}s)\n      {recipe}")


if __name__ == "__main__":
    main()
