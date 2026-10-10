# iOS UI driver

A small XCUITest command driver for driving the Whim app on an iOS simulator from a shell: tap, type, drag, read the labels on screen.

Maestro's iOS driver does not connect to the iOS 27 simulator (mobile-dev-inc/maestro#157), so this is the substitute. It is a dev tool, not part of the product or the gate.

## How it works

`gen.rb` generates a tiny Xcode project with the `xcodeproj` gem that ships inside CocoaPods. Its one UI test attaches to Whim by bundle id (`com.anycognition.whim`) and polls a command file in a working directory. `driver.sh cmd` appends one `<id> <verb> <args>` line and waits for `res-<id>.txt`.

The working directory is `$WHIM_IOS_DRIVER_DIR`, default `$TMPDIR/whim-ios-driver`. `driver.sh build` bakes that path into a generated `Config.swift`, so the test and the script always agree, and nothing generated lands in the repo.

## Prerequisites

- Xcode with the iOS 27 simulator runtime.
- CocoaPods (`brew install cocoapods`), only for its `xcodeproj` gem. `gen.rb` finds it by itself and stops with a message if it cannot.
- A booted simulator with Whim installed. The build and install commands are in `openspec/changes/copy-app-data/progress.md`, section "Commands that worked".

## Quick start

```sh
D=scripts/ios-ui-driver/driver.sh
$D build <udid>        # once, and again after editing the Swift
$D start <udid>        # detached; returns when the driver answers
$D cmd tapText "Describe an app…"
$D cmd labels
$D shot <udid> out.png
$D stop                # before deleting the simulator
```

## Subcommands

- `build <udid>`: generate the project into the working directory and run `build-for-testing`.
- `start <udid>`: run the test detached, record its pid, wait until it answers (`WHIM_IOS_DRIVER_START_TIMEOUT`, default 180 seconds).
- `cmd <verb> [args]`: send one command and print the reply. Exit 0 on success, 3 when the driver refused the command, 1 when no reply arrived within `WHIM_IOS_DRIVER_TIMEOUT` (default 40 seconds) or no driver is running.
- `stop`: ask the test to end, then terminate `xcodebuild` and confirm it is gone.
- `shot <udid> <out.png>`: screenshot through `simctl`; needs no driver.

## Verbs

- `launch`, `activate`, `terminate`: start, foreground or kill Whim.
- `tapText <label>`, `longText <label>`: tap or press an element found by label or identifier, waiting up to 5 seconds and scrolling it into view.
- `tap <x> <y>`, `long <x> <y> [seconds]`, `drag <x1> <y1> <x2> <y2>`: by coordinates, in points.
- `type <text>`: type into the focused field.
- `exists <label>`, `hittable <label>`, `frame <label>`: query one element.
- `waitFor <label>`: wait up to 6 seconds for it; prints `yes` or `no`.
- `labels`: every labelled element with type, frame and label, from one snapshot walk. Use this instead of element queries, which can kill the driver on a WebView screen.
- `dump`: the full accessibility tree text.
- `wait <seconds>`: pause the driver.

## Gotchas

- Coordinates are points (402x874 on an iPhone 17); screenshots are 3x pixels.
- `xcrun simctl terminate` followed by `launch` clears a stuck app.
- The first keyboard shows an iOS "Slide to type" card that must be dismissed (Continue, near 201,826) before keyboard screenshots.
- Press-and-drag does not scroll some sheets, while `tapText` scrolls to its target on its own.
- Text size and appearance: `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large` (or `large`) and `xcrun simctl ui <udid> appearance dark` (or `light`).
- Always run `stop` before deleting the simulator. An `xcodebuild` left behind keeps running against a device that no longer exists.
