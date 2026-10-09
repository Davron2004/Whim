# beta-1 evidence (out of git since 2026-10-09)

Device, benchmark and upgrade-check evidence for this change lives in the private bucket
`gs://anycognition-whim-evidence` (project `anycognition-whim`), one `tar` + `zstd -19` archive per
former folder. Archive paths are repo-relative, so extracting at the repo root restores the paths
`progress.md` and the plans cite. Results are summarised in `progress.md` and `docs/evals.md`.

| Archive | sha256 | Files | Unpacked | Contents |
|---|---|---|---|---|
| `gs://anycognition-whim-evidence/beta-1/acceptance.tar.zst` (74.4 MB) | `68c28ccb491d03c4e9959654cc12772a2648dc78498c6ed188f2ebee17336dc7` | 1,087 | 114.6 MB | `acceptance/`: Android/iOS screenshots, uiautomator and Maestro dumps, 2 recordings, raw SSE/server logs, one-off driver scripts and flows, run notes |
| `gs://anycognition-whim-evidence/beta-1/flowbench.tar.zst` (14.9 KB) | `53ad7b002308f60854974717a3e17864b313cca55c553d69b96f4d5ab13dd8b0` | 7 | 173 KB | `flowbench/`: before/after/rate JSON reports and the impossible-prompt set (10.3) |
| `gs://anycognition-whim-evidence/beta-1/upgrade-check.tar.zst` (3.9 KB) | `b6360756bd0a1093b3531f63b2dd8f4a35ed5ad1a61708d6274c6c02739edd4a` | 28 | 17 KB | `upgrade-check/`: before/after/result receipts of the 382511 → 391705, 392403 and 397438 upgrade checks (10.5) |

Fetch one (needs access to the `anycognition-whim` project):

```sh
gcloud storage cp gs://anycognition-whim-evidence/beta-1/acceptance.tar.zst /tmp/ \
  && shasum -a 256 /tmp/acceptance.tar.zst \
  && zstd -dc /tmp/acceptance.tar.zst | tar -xf - -C "$(git rev-parse --show-toplevel)"
```

New evidence follows the same path: keep it local (`.gitignore` refuses it under
`openspec/changes/*/`), upload an archive, add a row here. Other changes' archives: `docs/EVIDENCE.md`.
