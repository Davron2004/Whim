# Evidence archives

Evidence that used to be committed (screenshots, raw benchmark output, reference art) lives in the
private bucket `gs://anycognition-whim-evidence` (project `anycognition-whim`), one `tar` +
`zstd -19` archive per former folder. Archive paths are repo-relative: extracting at the repo root
restores the paths the docs cite. beta-1's archives are indexed in
`openspec/changes/beta-1/EVIDENCE.md`. The tracked-weight check (`checks/test/repo/`) keeps new
evidence out of git.

| Archive | sha256 | Files | Unpacked | Contents |
|---|---|---|---|---|
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
