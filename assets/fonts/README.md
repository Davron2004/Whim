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

Android also carries `InstrumentSans-Bold_bold.ttf` and
`Newsreader-Italic_italic.ttf`, byte copies of the files they are named for.
React Native on Android opens an asset font as its family's file name plus
`_bold` for text at weight 700 and up and `_italic` for italic text, so the
bold titles and the italic quotes ask for those names; without them Android
draws the system font. `src/host/launcher/test/android-fonts.suite.tsx` holds
every face to a file Android ships and each copy to its original.
