# Demo pipeline

How the LinkedIn cut (`demo/out/linkedin-2026-09-11-sound.mp4`) is made, end to end. Every
stage writes files the next stage reads; nothing is held in a running process.

```
demo/android/flows/tea/*.yaml      Maestro flows, one per shot (plus a prep flow)
        │  filmkit (external, ~/Work/other/filmkit/film-android.mjs)
        ▼
demo/raw/<date>/shot-N/take-*.mp4  raw emulator recordings (gitignored)
        │  demo/tools/linkedin-cut.py
        ▼
demo/out/linkedin-<date>.mp4       silent cut: segments, speed-ups, burned captions, end card
        │  demo/tools/eleven.py tts  +  demo/tools/mix.py
        ▼
demo/out/linkedin-<date>-sound.mp4 voiceover + ducked music bed, video stream byte-identical
```

## 1. Film

The app under film is the real release APK on the Android emulator (build notes in the root
`CLAUDE.md`: Node 22, JDK 21, `npm run android:release`). The flows are driven and recorded by
**filmkit**, which lives outside this repo:

```sh
node ~/Work/other/filmkit/film-android.mjs demo/android/flows/tea/1-compose-to-transmute.yaml
```

Things that bit us on the 2026-09-11 shoot, so you don't rediscover them:

- Record at the device's native size (`--size 1080x2404`); the cut assumes it.
- Detach the camera with `nohup` so a flow that back-navigates doesn't kill the recording.
- Keep the raw take for the long "transmute" shot; the tightened variant drops the frames the
  cut needs for its 8x speed-up.
- Maestro selectors are per generation: the text in a freshly generated mini-app differs run to
  run. Re-derive them with `demo/android/uidump.py` before re-filming a shot. Text selectors
  do reach inside the sandboxed iframe (the a11y tree pierces it); `inputText` appends rather
  than replaces, and `hideKeyboard` back-navigates.

Shoot notes and take-by-take verdicts live in `demo/raw/PROGRESS.md` (gitignored, local only).

## 2. Cut

```sh
python3 demo/tools/linkedin-cut.py --out demo/out/linkedin-2026-09-11.mp4
```

Needs Python 3 with Pillow and ffmpeg. The source takes, in/out points, speed factors and
captions are a table at the top of the script. Sources are normalised to 30 fps CFR first
because the emulator records variable frame rate and every seek would otherwise land on the
wrong frame. Captions are Pillow-rendered PNG pills overlaid with alpha fades, not drawtext.
The script writes a `.recipe.md` next to the output with the exact segment list and the
cumulative timestamps; the voiceover cue sheet is derived from that.

## 3. Voice and music

`demo/tools/voiceover.cues.json` holds one spoken line per caption with its start time and the
moment the next caption appears (the latest the line may end). Lines are adapted from the
captions, not read verbatim; a caption can be dropped from the voiceover while staying on screen.

```sh
export ELEVENLABS_API_KEY=...                     # never committed; read from the env only
python3 demo/tools/eleven.py subscription         # tier and remaining characters
python3 demo/tools/eleven.py voices               # premade voices with ids
python3 demo/tools/eleven.py tts --voice-id <id>  # one clip per cue into demo/out/.work/vo/
python3 demo/tools/eleven.py music --prompt "..." # instrumental bed (paid plans only)
```

The 2026-09-11 cut uses the voice "River" on `eleven_multilingual_v2` at speed 1.05, and a
Mixkit ambient track as the bed (free licence, no attribution; see
`demo/out/.work/music/CANDIDATES.md`). Free ElevenLabs tiers can't call the music endpoint.

```sh
python3 demo/tools/mix.py --video demo/out/linkedin-2026-09-11.mp4 \
  --vo-dir demo/out/.work/vo --music demo/out/.work/music/<bed>.mp3 \
  --out demo/out/linkedin-2026-09-11-sound.mp4 [--music-db -12] [--duck-db 9]
```

The mixer places each clip at its cue (pushing it later, with a warning, if the previous clip
is still playing), normalises the voice bus to -16 LUFS, sidechain-ducks the bed under speech,
fades it in and out, limits at -1 dBTP and muxes AAC over the untouched video stream. It prints
a verification block: duration, stream layout, loudness, and per-cue level so a timing slip is
visible in the log. `--no-music` and `--no-vo` audition one bus at a time.
