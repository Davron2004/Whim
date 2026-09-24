# Stage title video

Title slide for the 2026-09-24 live demo: a dandelion seed head with one seed drifting past, plus a QR code.

```sh
uv run demo/tools/title-slide.py --url https://real-link
```

- `--url` (required): where the QR code points.
- `--label "…"`: line above the QR code. Default: `Try the beta`.
- `--minutes N`: video length. Default: 5.
- `--still`: write PNG stills only, no video.

Output: `demo/out/stage-title/whim-title.mp4` (1080p H.264, loops every 45 s with no visible seam) and `still-*.png`. Takes about 40 s. Check the URL it prints.
