# Fonts

Static TTFs for Instrument Sans, IBM Plex Mono, and Newsreader, sourced from
Google Fonts (github.com/google/fonts), licensed under the SIL Open Font
License 1.1 (OFL-1.1) — see https://openfontlicense.org for the license text.

The Instrument Sans and Newsreader files are static instances cut from their
variable-font sources with `fontTools varLib.instancer`:

- Instrument Sans: `wdth=100` (Regular, Medium, SemiBold, Bold weights)
- Newsreader: `opsz=17, wght=400` (Italic)

IBM Plex Mono ships static weights upstream, so Regular and Medium are used
as-is.

This directory is the canonical copy. Android loads fonts from
`android/app/src/main/assets/fonts/`, which must be kept in sync with this
directory by hand whenever a font file here changes.
