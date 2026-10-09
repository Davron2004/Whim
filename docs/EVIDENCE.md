# Evidence archives

Evidence that used to be committed (screenshots, raw benchmark output, reference art) lives in the
private bucket `gs://anycognition-whim-evidence` (project `anycognition-whim`), one `tar` +
`zstd -19` archive per former folder. Archive paths are repo-relative: extracting at the repo root
restores the paths the docs cite. The tracked-weight check (`checks/test/repo/`) keeps new
evidence out of git.

| Archive | sha256 | Files | Unpacked | Contents |
|---|---|---|---|---|
| `gs://anycognition-whim-evidence/beta-1/acceptance.tar.zst` (74.4 MB) | `68c28ccb491d03c4e9959654cc12772a2648dc78498c6ed188f2ebee17336dc7` | 1,087 | 114.6 MB | `acceptance/`: Android/iOS screenshots, uiautomator and Maestro dumps, 2 recordings, raw SSE/server logs, one-off driver scripts and flows, run notes |
| `gs://anycognition-whim-evidence/beta-1/flowbench.tar.zst` (14.9 KB) | `53ad7b002308f60854974717a3e17864b313cca55c553d69b96f4d5ab13dd8b0` | 7 | 173 KB | `flowbench/`: before/after/rate JSON reports and the impossible-prompt set (10.3) |
| `gs://anycognition-whim-evidence/beta-1/upgrade-check.tar.zst` (3.9 KB) | `b6360756bd0a1093b3531f63b2dd8f4a35ed5ad1a61708d6274c6c02739edd4a` | 28 | 17 KB | `upgrade-check/`: before/after/result receipts of the 382511 → 391705, 392403 and 397438 upgrade checks (10.5) |
| `gs://anycognition-whim-evidence/legal-surface-v2/evidence.tar.zst` (727 KB) | `6b28f55b56ebccda21237f254af32aed24e0ed8ecc0153f9ada93095a28c531a` | 6 | 771 KB | Settings, French Terms/consent and language-persistence screenshots (tasks 5, 6.4) |
| `gs://anycognition-whim-evidence/faster-generation/bench.tar.zst` (13.5 KB) | `11df75b61b9959173faf0c2943a7778b121d891ea0af4c4d3d51732f1c17e70a` | 3 | 49 KB | Blind-judge verdicts (rounds 2 and 3) and round-2 inputs behind decision #69; the prompt is `docs/research/generation-speed-judge-prompt.md` |
| `gs://anycognition-whim-evidence/docs/mascot.tar.zst` (5.7 MB) | `b89495cb4d471758d92d5f5071012b670e3dd551cccfe59409f66d3c71b181dd` | 2 | 7.0 MB | `docs/mascot/big_ref.png` (2816×1536 sheet) and `no_brows.png`, the undecided Amber Wisp concept |

Fetch one:

```sh
gcloud storage cp gs://anycognition-whim-evidence/docs/mascot.tar.zst /tmp/ \
  && shasum -a 256 /tmp/mascot.tar.zst \
  && zstd -dc /tmp/mascot.tar.zst | tar -xf - -C "$(git rev-parse --show-toplevel)"
```

To add evidence: `tar -cf - <paths> | zstd -19 -o <name>.tar.zst`, `gcloud storage cp` it under
`<change-or-docs>/`, check the remote size and MD5 (`gcloud storage ls -L`), then add a row here.
