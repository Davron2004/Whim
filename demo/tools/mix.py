#!/usr/bin/env python3
"""Mix voiceover + music onto the silent Whim LinkedIn demo cut.

Stdlib only. Post-step after linkedin-cut.py (video) and eleven.py (voice
mp3s / music bed) — this script never touches either of those.

    python3 demo/tools/mix.py \
        --video demo/out/linkedin-2026-09-11.mp4 \
        --vo-dir demo/out/.work/vo \
        --music demo/out/.work/music/standin.mp3

Filter graph, in order:
  * each cue's mp3 is `adelay`-ed to its (possibly nudged) start, `apad`-ed
    and `atrim`-ed to the video's duration, then all cues are summed with
    `amix normalize=0` (they don't overlap, so summing needs no headroom
    loss) and passed through `loudnorm` -> the voice bus.
  * the music bed is infinite-looped and `atrim`-ed to the video's exact
    duration (this trims a long bed and loops a short one with the same
    line of code), faded in/out, ducked with `sidechaincompress` keyed off
    the voice bus, then given its static `volume` — the music bus.
  * voice + music are summed (`amix normalize=0` again) and capped with
    `alimiter` at -1 dBTP.
Video stream is `-c:v copy` throughout; only the audio side is touched.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_CUES = os.path.join(REPO, "demo", "tools", "voiceover.cues.json")
DEFAULT_VIDEO = os.path.join(REPO, "demo", "out", "linkedin-2026-09-11.mp4")
DEFAULT_OUT = os.path.join(REPO, "demo", "out", "linkedin-2026-09-11-sound.mp4")

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

MIN_GAP = 0.15          # seconds inserted between a pushed clip and the one before it
VOICE_LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
MUSIC_FADE_IN = 0.8
MUSIC_FADE_OUT = 2.5
LIMITER_TP_DB = -1.0    # alimiter target, dBTP

# sidechaincompress ducking: threshold fixed; ratio is picked from an
# empirical (measured reduction dB -> ratio) calibration table rather than
# the textbook overshoot*(1-1/ratio) formula. That formula undershoots badly
# here: with detection=rms and a -30 dB threshold, a loudnorm(-16 LUFS)
# speech bus (measured ~-14 dBFS average, but with consonant peaks much
# louder) drives far more gain reduction than its average-RMS overshoot
# predicts, because the envelope follower tracks the louder transients. The
# table below was measured directly (dry-run TTS voice bus, cue 12, this
# script's own sidechaincompress graph) and is interpolated at runtime; it
# will drift for voice material with a different crest factor than
# macOS `say`, so re-measure (mix.py's own verification block reports the
# achieved duck) if the real ElevenLabs voice sounds off.
SC_THRESHOLD_DB = -30.0
SC_ATTACK_MS = 50
SC_RELEASE_MS = 700
SC_DUCK_CALIBRATION = [   # (measured reduction dB, ratio) pairs, ratio ascending
    (0.0, 1.0),
    (2.7, 1.15),
    (4.8, 1.3),
    (6.9, 1.5),
    (9.2, 1.8),
    (11.7, 2.2857),
    (12.5, 2.5),
    (13.8, 3.0),
    (18.6, 10.0),
]


def ratio_for_duck(duck_db: float) -> float:
    """Interpolate SC_DUCK_CALIBRATION for the ratio hitting ~duck_db of
    reduction; clamps to the table's ends (and to ffmpeg's [1, 20] range)."""
    pts = SC_DUCK_CALIBRATION
    if duck_db <= pts[0][0]:
        return pts[0][1]
    if duck_db >= pts[-1][0]:
        return pts[-1][1]
    for (d0, r0), (d1, r1) in zip(pts, pts[1:]):
        if d0 <= duck_db <= d1:
            frac = (duck_db - d0) / (d1 - d0)
            return min(max(r0 + frac * (r1 - r0), 1.0), 20.0)
    return pts[-1][1]


def db_to_lin(db: float) -> float:
    return 10 ** (db / 20.0)


def run(cmd: list, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        sys.exit(f"command failed ({proc.returncode}):\n  {' '.join(cmd)}\n{proc.stderr}")
    return proc


def ffprobe_duration(path: str) -> float:
    p = run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path])
    return float(p.stdout.strip())


def ffprobe_streams(path: str) -> list:
    p = run([FFPROBE, "-v", "error", "-show_entries",
             "stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames",
             "-of", "json", path])
    return json.loads(p.stdout)["streams"]


def measure_rms(path: str, start: float, window: float = 0.5):
    """RMS level (dBFS) of `path`'s audio in [start, start+window]. None if unmeasurable."""
    start = max(start, 0.0)
    p = run([FFMPEG, "-hide_banner", "-v", "info", "-ss", f"{start:.3f}", "-t", f"{window:.3f}",
             "-i", path, "-vn", "-af", "astats=measure_perchannel=none:measure_overall=RMS_level",
             "-f", "null", "-"], check=False)
    for line in p.stderr.splitlines():
        if "RMS level dB" in line:
            try:
                return float(line.rsplit(":", 1)[-1].strip())
            except ValueError:
                return None
    return None


def measure_integrated_loudness(path: str):
    p = run([FFMPEG, "-hide_banner", "-i", path, "-af",
             f"{VOICE_LOUDNORM}:print_format=json", "-f", "null", "-"], check=False)
    text = p.stderr
    start, end = text.rfind("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def load_cues(cues_path: str) -> list:
    with open(cues_path) as f:
        return json.load(f)["cues"]


def place_voice_clips(cues: list, vo_dir: str) -> list:
    """Sequential placement: nudge a cue's start past the previous clip's end
    (+MIN_GAP) rather than overlap it. Returns cues in order with duration,
    the actual start used, and the shift (0 if none)."""
    missing = [c["id"] for c in cues if not os.path.exists(os.path.join(vo_dir, f"{c['id']}.mp3"))]
    if missing:
        sys.exit(f"missing vo clip(s) in {vo_dir}: {missing}")

    placements = []
    prev_end = -math.inf
    for cue in cues:
        path = os.path.join(vo_dir, f"{cue['id']}.mp3")
        dur = ffprobe_duration(path)
        start = cue["at"]
        shift = 0.0
        if start < prev_end:
            new_start = prev_end + MIN_GAP
            shift = new_start - start
            print(f"WARN cue {cue['id']}: would overlap previous clip "
                  f"(starts {start:.3f}, previous ends {prev_end:.3f}); "
                  f"shifted +{shift:.3f}s to {new_start:.3f}")
            start = new_start
        prev_end = start + dur
        placements.append({"cue": cue, "path": path, "duration": dur,
                            "start": start, "shift": shift})
    return placements


def build_filter(placements: list, total_dur: float, args: argparse.Namespace):
    """Returns (input_args, filter_complex, out_label)."""
    input_args = ["-i", args.video]
    chains = []

    have_voice = not args.no_vo
    have_music = not args.no_music

    voice_labels = []
    if have_voice:
        for i, p in enumerate(placements):
            input_args += ["-i", p["path"]]
            delay_ms = round(p["start"] * 1000)
            label = f"vc{i}"
            chains.append(
                f"[{i + 1}:a]adelay={delay_ms}|{delay_ms},apad,"
                f"atrim=0:{total_dur:.6f},asetpts=PTS-STARTPTS[{label}]"
            )
            voice_labels.append(label)
        mixed_in = "".join(f"[{l}]" for l in voice_labels)
        chains.append(f"{mixed_in}amix=inputs={len(voice_labels)}:duration=longest:normalize=0[voice_raw]")
        chains.append(f"[voice_raw]{VOICE_LOUDNORM}[voice]")
        if have_music:
            # [voice] is consumed twice below (sidechain key + final mix);
            # ffmpeg's filtergraph parser needs an explicit split for that.
            chains.append("[voice]asplit=2[voice_key][voice_out]")

    if have_music:
        music_idx = len(voice_labels) + 1
        input_args += ["-stream_loop", "-1", "-i", args.music]
        fade_out_st = max(total_dur - MUSIC_FADE_OUT, 0.0)
        chains.append(
            f"[{music_idx}:a]atrim=0:{total_dur:.6f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={MUSIC_FADE_IN},"
            f"afade=t=out:st={fade_out_st:.6f}:d={MUSIC_FADE_OUT}[music_faded]"
        )
        if have_voice:
            ratio = ratio_for_duck(args.duck_db)
            thr_lin = db_to_lin(SC_THRESHOLD_DB)
            chains.append(
                f"[music_faded][voice_key]sidechaincompress=threshold={thr_lin:.6f}:"
                f"ratio={ratio:.4f}:attack={SC_ATTACK_MS}:release={SC_RELEASE_MS}:"
                f"makeup=1[music_ducked]"
            )
            music_src = "music_ducked"
        else:
            music_src = "music_faded"
        chains.append(f"[{music_src}]volume={args.music_db}dB[music_final]")

    if have_voice and have_music:
        chains.append("[voice_out][music_final]amix=inputs=2:duration=longest:normalize=0[mixed]")
        mixed = "mixed"
    elif have_voice:
        mixed = "voice"
    elif have_music:
        mixed = "music_final"
    else:
        sys.exit("nothing to mix: both --no-vo and --no-music were given")

    chains.append(f"[{mixed}]alimiter=limit={db_to_lin(LIMITER_TP_DB):.6f}[outa]")
    return input_args, ";".join(chains), "[outa]"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", default=DEFAULT_VIDEO)
    ap.add_argument("--vo-dir", default=None)
    ap.add_argument("--music", default=None)
    ap.add_argument("--cues", default=DEFAULT_CUES)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--music-db", type=float, default=-12.0)
    ap.add_argument("--duck-db", type=float, default=9.0)
    ap.add_argument("--no-music", action="store_true")
    ap.add_argument("--no-vo", action="store_true")
    args = ap.parse_args()

    if not args.no_vo and not args.vo_dir:
        sys.exit("--vo-dir is required unless --no-vo")
    if not args.no_music and not args.music:
        sys.exit("--music is required unless --no-music")
    if args.no_vo and args.no_music:
        sys.exit("nothing to mix: both --no-vo and --no-music were given")

    if not os.path.exists(args.video):
        sys.exit(f"no such video: {args.video}")
    total_dur = ffprobe_duration(args.video)

    cues = load_cues(args.cues)
    placements = [] if args.no_vo else place_voice_clips(cues, args.vo_dir)

    input_args, filter_complex, out_label = build_filter(placements, total_dur, args)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    cmd = [FFMPEG, "-y", *input_args, "-filter_complex", filter_complex,
           "-map", "0:v", "-map", out_label,
           "-c:v", "copy",
           "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
           "-shortest", "-movflags", "+faststart", args.out]

    print("ffmpeg command:")
    print("  " + " ".join(cmd))
    run(cmd)

    # ---------------------------------------------------------- verification
    print("\n--- verification ---")
    out_dur = ffprobe_duration(args.out)
    print(f"output duration: {out_dur:.3f}s (video was {total_dur:.3f}s)")

    streams = ffprobe_streams(args.out)
    kinds = [s["codec_type"] for s in streams]
    print(f"streams: {kinds}")
    vstream = next((s for s in streams if s["codec_type"] == "video"), None)
    astream = next((s for s in streams if s["codec_type"] == "audio"), None)
    if astream:
        print(f"audio codec: {astream['codec_name']}")
    if vstream:
        src_v = next(s for s in ffprobe_streams(args.video) if s["codec_type"] == "video")
        same = all(vstream.get(k) == src_v.get(k)
                   for k in ("codec_name", "width", "height", "r_frame_rate", "nb_frames"))
        print(f"video stream unchanged vs input: {same} "
              f"(in: {src_v}, out: {vstream})")

    loud = measure_integrated_loudness(args.out)
    if loud:
        print(f"integrated loudness of output: {loud.get('input_i')} LUFS "
              f"(TP {loud.get('input_tp')} dBTP, LRA {loud.get('input_lra')})")
    else:
        print("integrated loudness: could not parse loudnorm output")

    if placements:
        print("\nper-cue timing check (RMS dBFS, 0.5s window):")
        print(f"{'id':<4}{'expected@':>10}{'actual@':>10}{'shift':>8}{'rms@exp':>10}{'rms@act':>10}")
        for p in placements:
            cue = p["cue"]
            rms_exp = measure_rms(args.out, cue["at"])
            rms_act = measure_rms(args.out, p["start"])
            fmt = lambda v: f"{v:.1f}" if v is not None else "n/a"
            print(f"{cue['id']:<4}{cue['at']:>10.2f}{p['start']:>10.2f}"
                  f"{p['shift']:>8.2f}{fmt(rms_exp):>10}{fmt(rms_act):>10}")


if __name__ == "__main__":
    main()
