# iOS WebView network-deny contract

## Runtime surface

- `WebViewNetworkDeny.json` contains only two `block` rules: `^https?:` and `^wss?:`.
- `WhimWebViewNetworkDeny.m` exchanges `-[WKWebView initWithFrame:configuration:]` once from
  `+load`. Its replacement selector is
  `initWhimNetworkDeniedWithFrame:configuration:`; the `init` family name preserves ARC's
  initializer ownership rules.
- The rule list identifier is `whim-webview-network-deny-v1`.
- A compiled rule list is attached to every new `WKWebViewConfiguration` before the original
  initializer runs. Until compilation succeeds, JavaScript is disabled on new web views.
- The Whim target compiles the `.m` file in Sources and copies the JSON file in Resources.

## Stable error surface

Every loader failure emits one line beginning with `WhimNetworkDeny:`. The messages are:

```text
WhimNetworkDeny: missing WebViewNetworkDeny.json
WhimNetworkDeny: failed to read WebViewNetworkDeny.json: %@
WhimNetworkDeny: failed to compile WebViewNetworkDeny.json: %@
WhimNetworkDeny: rule list unavailable at WKWebView initialization
```

## Project membership command

Run from `ios/` with the repository's pinned gems:

```sh
BUNDLE_IGNORE_CONFIG=1 BUNDLE_PATH=/Users/davrondjabborov/Work/other/Whim/vendor/bundle \
  /opt/homebrew/bin/bundle exec /opt/homebrew/bin/ruby -e \
  'require "xcodeproj"; project = Xcodeproj::Project.open("Whim.xcodeproj"); target = project.targets.find { |candidate| candidate.name == "Whim" }; whim_group = project.main_group.groups.find { |group| group.display_name == "Whim" }; source = whim_group.files.find { |file| file.path == "Whim/WhimWebViewNetworkDeny.m" } || whim_group.new_reference("Whim/WhimWebViewNetworkDeny.m"); rules = whim_group.files.find { |file| file.path == "Whim/WebViewNetworkDeny.json" } || whim_group.new_reference("Whim/WebViewNetworkDeny.json"); target.source_build_phase.add_file_reference(source) unless target.source_build_phase.files_references.include?(source); target.resources_build_phase.add_file_reference(rules) unless target.resources_build_phase.files_references.include?(rules); project.save'
```

## Acceptance controls

For chain 12's leakage control, replace this one line locally, build and run the probe, then
restore it exactly:

```objc
// before
[configuration.userContentController addContentRuleList:ruleList];
// temporary control
(void)ruleList;
```

That edit removes the deny from the ready-rule path. The HTTP and TLS canaries must then observe
the probe traffic.

For the fail-closed loader check, keep `RUN_NETDENY_PROBE = false` so the app runs the normal
`LauncherRoot`. Make this one-line local edit, build and launch, then restore it:

```objc
// before
URLForResource:@"WebViewNetworkDeny"
// temporary missing-resource control
URLForResource:@"WebViewNetworkDenyMissing"
```

Open the seeded Tip Splitter mini-app. The required result is both the missing-resource and
rule-list-unavailable log messages, no canary traffic, and a visible app-error surface instead of
mini-app content. On 2026-09-15 the corrected host reached the app-error screen within an
8.54-second observation window from a fresh launcher tap. Retry also reached the error screen,
and "Back to your apps" returned Home. Both required native log messages were recorded.
The host now arms its six-second deadline before page delivery, so missing page JavaScript no
longer prevents the timeout from starting. See task 20.4 and the progress ledger for evidence.
The normal-launcher test sends no probe bundles: the canary observed zero HTTP/TLS traffic but
correctly rejected its acceptance verdict for missing bundles. This verifies error UX, not the
separate full network-deny probe acceptance.
