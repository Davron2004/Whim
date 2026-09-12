#!/usr/bin/env python3
"""ElevenLabs CLI for the Whim demo voiceover/music pipeline.

Stdlib only (urllib/json/subprocess/argparse) — no pip installs. Auth is
`xi-api-key: $ELEVENLABS_API_KEY`, read from the environment and never
printed or written to disk.

Subcommands:
    subscription                 account tier/usage summary
    voices [--filter SUB]        table of premade voices
    tts --voice-id ID ...        render every cue's line to <out-dir>/<id>.mp3
    tts --dry-run ...            same, via macOS `say` instead of the API
    music --prompt "..." ...     generate instrumental candidate(s)

Companion to mix.py, which consumes the --out-dir this writes (vo mp3s +
manifest.json) and a music mp3 (from `music` or a stand-in).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_CUES = os.path.join(REPO, "demo", "tools", "voiceover.cues.json")
DEFAULT_VO_DIR = os.path.join(REPO, "demo", "out", ".work", "vo")
DEFAULT_MUSIC_OUT = os.path.join(REPO, "demo", "out", ".work", "music", "NN.mp3")

API_BASE = "https://api.elevenlabs.io/v1"
DEFAULT_MODEL = "eleven_multilingual_v2"

# Not exposed as CLI flags (the spec only calls out stability/style/speed) but
# still real fields the TTS request body needs; recorded in manifest.json
# alongside the rest of voice_settings.
DEFAULT_SIMILARITY_BOOST = 0.75
DEFAULT_SPEAKER_BOOST = True


def get_api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set. Export it and try again.")
    return key


def _http_error_detail(err: urllib.error.HTTPError) -> str:
    try:
        body = err.read().decode("utf-8", errors="replace")
    except Exception:
        body = ""
    return f"HTTP {err.code} {err.reason}: {body[:500]}"


def api_get(path: str, key: str) -> dict:
    req = urllib.request.Request(API_BASE + path, headers={"xi-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit(f"GET {path} failed: {_http_error_detail(e)}")
    except urllib.error.URLError as e:
        sys.exit(f"GET {path} failed: {e.reason}")


def api_post(path: str, key: str, body: dict) -> bytes:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        API_BASE + path,
        data=data,
        method="POST",
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"POST {path} failed: {_http_error_detail(e)}")
    except urllib.error.URLError as e:
        sys.exit(f"POST {path} failed: {e.reason}")


def load_cues(cues_path: str) -> list:
    with open(cues_path) as f:
        return json.load(f)["cues"]


def ffprobe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit(f"ffprobe could not read duration of {path}:\n{out.stderr}")
    return float(out.stdout.strip())


def run(cmd: list) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"command failed ({proc.returncode}):\n  {' '.join(cmd)}\n{proc.stderr}")


# ------------------------------------------------------------- subscription -
def cmd_subscription(args: argparse.Namespace) -> None:
    key = get_api_key()
    data = api_get("/user/subscription", key)
    used = data.get("character_count", 0)
    limit = data.get("character_limit", 0)
    reset_unix = data.get("next_character_count_reset_unix")
    reset_local = (
        datetime.fromtimestamp(reset_unix).strftime("%Y-%m-%d %H:%M:%S %Z").strip()
        if reset_unix else "unknown"
    )
    print(f"tier:        {data.get('tier', 'unknown')}")
    print(f"status:      {data.get('status', 'unknown')}")
    print(f"characters:  {used} / {limit}")
    print(f"remaining:   {max(limit - used, 0)}")
    print(f"resets:      {reset_local}")


# ------------------------------------------------------------------- voices -
def cmd_voices(args: argparse.Namespace) -> None:
    key = get_api_key()
    data = api_get("/voices", key)
    voices = [v for v in data.get("voices", []) if v.get("category", "premade") == "premade"]

    def matches(v: dict) -> bool:
        if not args.filter:
            return True
        needle = args.filter.lower()
        haystack = " ".join([
            v.get("name", ""),
            *[str(x) for x in (v.get("labels") or {}).values()],
        ]).lower()
        return needle in haystack

    voices = [v for v in voices if matches(v)]

    rows = []
    for v in voices:
        labels = v.get("labels") or {}
        rows.append((
            v.get("name", ""),
            v.get("voice_id", ""),
            labels.get("gender", ""),
            labels.get("accent", ""),
            labels.get("use_case", ""),
            labels.get("description", ""),
        ))

    if not rows:
        print("no premade voices matched")
        return

    headers = ("name", "voice_id", "gender", "accent", "use_case", "description")
    widths = [max(len(str(headers[i])), max((len(str(r[i])) for r in rows), default=0))
              for i in range(len(headers))]
    def fmt_row(r):
        return "  ".join(str(v).ljust(w) for v, w in zip(r, widths))
    print(fmt_row(headers))
    print(fmt_row(["-" * w for w in widths]))
    for r in rows:
        print(fmt_row(r))


# ---------------------------------------------------------------------- tts -
def synth_dry_run(text: str, out_mp3: str) -> None:
    aiff = out_mp3[:-4] + ".aiff"
    run(["say", "-v", "Samantha", "-o", aiff, text])
    run(["ffmpeg", "-v", "error", "-y", "-i", aiff, "-ar", "44100", out_mp3])
    os.remove(aiff)


def synth_api(text: str, voice_id: str, model: str, settings: dict, key: str, out_mp3: str) -> None:
    audio = api_post(
        f"/text-to-speech/{voice_id}?output_format=mp3_44100_128",
        key,
        {"text": text, "model_id": model, "voice_settings": settings},
    )
    with open(out_mp3, "wb") as f:
        f.write(audio)


def cmd_tts(args: argparse.Namespace) -> None:
    if not args.dry_run and not args.voice_id:
        sys.exit("tts needs --voice-id (or --dry-run)")

    cues = load_cues(args.cues)
    if args.only:
        wanted = {c.strip() for c in args.only.split(",") if c.strip()}
        cues = [c for c in cues if c["id"] in wanted]
        missing = wanted - {c["id"] for c in cues}
        if missing:
            sys.exit(f"--only referenced unknown cue id(s): {sorted(missing)}")

    os.makedirs(args.out_dir, exist_ok=True)

    settings = {
        "stability": args.stability,
        "similarity_boost": DEFAULT_SIMILARITY_BOOST,
        "style": args.style,
        "use_speaker_boost": DEFAULT_SPEAKER_BOOST,
        "speed": args.speed,
    }
    key = None if args.dry_run else get_api_key()
    voice_id = "dry-run:say/Samantha" if args.dry_run else args.voice_id
    model = "macOS say" if args.dry_run else args.model

    manifest_path = os.path.join(args.out_dir, "manifest.json")
    # --only renders a subset; merge into any existing manifest so the other
    # cues' entries (from an earlier full run) survive.
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
        manifest.update({"voice_id": voice_id, "model": model, "settings": settings})
        manifest.setdefault("cues", {})
    else:
        manifest = {
            "voice_id": voice_id,
            "model": model,
            "settings": settings,
            "cues": {},
        }

    print(f"{'id':<4}{'duration':>10}{'window':>10}  ")
    for cue in cues:
        out_mp3 = os.path.join(args.out_dir, f"{cue['id']}.mp3")
        window = cue["until"] - cue["at"]
        if os.path.exists(out_mp3) and not args.force:
            skipped = True
        else:
            skipped = False
            if args.dry_run:
                synth_dry_run(cue["line"], out_mp3)
            else:
                synth_api(cue["line"], args.voice_id, args.model, settings, key, out_mp3)
        dur = ffprobe_duration(out_mp3)
        warn = " WARN over window" if dur > window else ""
        skip_note = " (skipped, existing)" if skipped else ""
        print(f"{cue['id']:<4}{dur:>9.2f}s{window:>9.2f}s{warn}{skip_note}")
        manifest["cues"][cue["id"]] = {"duration": dur, "window": window, "line": cue["line"]}

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nwrote manifest {manifest_path}")


# -------------------------------------------------------------------- music -
def cmd_music(args: argparse.Namespace) -> None:
    key = get_api_key()
    out_dir = os.path.dirname(args.out) or "."
    os.makedirs(out_dir, exist_ok=True)

    for i in range(1, args.n + 1):
        if "NN" in args.out:
            dst = args.out.replace("NN", f"{i:02d}")
        elif args.n > 1:
            base, ext = os.path.splitext(args.out)
            dst = f"{base}-{i:02d}{ext}"
        else:
            dst = args.out

        body = {
            "prompt": args.prompt,
            "music_length_ms": int(args.seconds * 1000),
            "force_instrumental": True,
            "model_id": args.model,
        }
        if args.seed is not None:
            body["seed"] = args.seed

        audio = api_post("/music", key, body)
        with open(dst, "wb") as f:
            f.write(audio)
        dur = ffprobe_duration(dst)
        print(f"{dst}  ({dur:.2f}s, model={args.model})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("subscription", help="account tier/usage summary")
    sp.set_defaults(func=cmd_subscription)

    sp = sub.add_parser("voices", help="table of premade voices")
    sp.add_argument("--filter", default=None, help="substring match on name/labels")
    sp.set_defaults(func=cmd_voices)

    sp = sub.add_parser("tts", help="render cue lines to mp3")
    sp.add_argument("--voice-id", default=None)
    sp.add_argument("--model", default=DEFAULT_MODEL)
    sp.add_argument("--speed", type=float, default=1.0)
    sp.add_argument("--stability", type=float, default=0.5)
    sp.add_argument("--style", type=float, default=0.0)
    sp.add_argument("--out-dir", default=DEFAULT_VO_DIR)
    sp.add_argument("--only", default=None, help="comma-separated cue ids, e.g. 03,04")
    sp.add_argument("--cues", default=DEFAULT_CUES)
    sp.add_argument("--force", action="store_true", help="re-render even if the mp3 exists")
    sp.add_argument("--dry-run", action="store_true", help="use macOS `say` instead of the API")
    sp.set_defaults(func=cmd_tts)

    sp = sub.add_parser("music", help="generate instrumental candidate(s)")
    sp.add_argument("--prompt", required=True)
    sp.add_argument("--seconds", type=float, default=80.0)
    sp.add_argument("--out", default=DEFAULT_MUSIC_OUT)
    sp.add_argument("--n", type=int, default=1)
    sp.add_argument("--model", default="music_v2_5",
                     choices=["music_v1", "music_v2", "music_v2_5"], help="sent as model_id")
    sp.add_argument("--seed", type=int, default=None, help="omitted from the body when not given")
    sp.set_defaults(func=cmd_music)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
