# Sonar findings — PR #262 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #262
- gate: ERROR
- issues: 331

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — src/host/storage-engine/test/saved-data.suite.ts:139 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S2 — src/host/storage-engine/saved-data-device-acceptance.ts:43 — typescript:S6551 (MINOR)
'r.name' will use Object's default stringification format ('[object Object]') when stringified.

## S3 — src/host/storage-engine/test/saved-data.suite.ts:89 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S4 — src/host/storage-engine/test/saved-data.suite.ts:120 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S5 — src/host/storage-engine/test/saved-data.suite.ts:128 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S6 — src/host/storage-engine/test/saved-data.suite.ts:166 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S7 — src/host/launcher/HomeScreen.tsx:173 — typescript:S7503 (MINOR)
Async arrow function 'savedUnknown' has no 'await' expression.

## S8 — src/host/storage-engine/saved-data.ts:23 — typescript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S9 — src/host/storage-engine/saved-data.ts:28 — typescript:S6551 (MINOR)
'r.name' will use Object's default stringification format ('[object Object]') when stringified.

## S10 — src/host/storage-engine/test/saved-data.suite.ts:74 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S11 — src/host/storage-engine/test/saved-data.suite.ts:80 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S12 — src/host/storage-engine/test/saved-data.suite.ts:104 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S13 — scripts/lib/only-filter.mjs:149 — javascript:S4043 (MAJOR)
Move this array "reverse" operation to a separate statement or replace it with "toReversed".

## S14 — src/host/launcher/LauncherRoot.tsx:1547 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S15 — .claude/hooks/subagent-deny.sh:44 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S16 — .claude/hooks/subagent-deny.sh:44 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S17 — .claude/hooks/subagent-deny.sh:46 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S18 — .claude/hooks/subagent-deny.sh:55 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S19 — .claude/hooks/subagent-deny.sh:62 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S20 — .claude/hooks/subagent-deny.sh:62 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S21 — docs/design/mockups/index.html:1747 — javascript:S3776 (CRITICAL)
Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed.

## S22 — synthrun/sweep.ts:770 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S23 — synthrun/sweep.ts:770 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S24 — synthrun/sweep.ts:853 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S25 — src/host/launcher/HistoryScreen.tsx:380 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S26 — src/host/ui/SheetAnchor.tsx:66 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S27 — src/host/launcher/MakingSheet.tsx:102 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S28 — src/host/ui/TravelLayer.tsx:140 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S29 — src/host/ui/TravelLayer.tsx:282 — typescript:S905 (MAJOR)
Expected an assignment or function call and instead saw an expression.

## S30 — src/host/ui/TravelLayer.tsx:286 — typescript:S905 (MAJOR)
Expected an assignment or function call and instead saw an expression.

## S31 — src/host/ui/TravelLayer.tsx:312 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S32 — ios/Whim/AppDelegate.swift:120 — swift:S3087 (MAJOR)
Refactor this code to not nest more than 2 closure expressions.

## S33 — ios/Whim/AppDelegate.swift:114 — swift:S3087 (MAJOR)
Refactor this code to not nest more than 2 closure expressions.

## S34 — src/host/ui/tokens-pure.ts:205 — typescript:S2301 (MAJOR)
Provide multiple methods instead of using "reduceMotion" to determine which action to take.

## S35 — scripts/release/lib/android-project.ts:352 — typescript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S36 — scripts/release/lib/android-project.ts:305 — typescript:S7776 (MINOR)
`decorNames` should be a `Set`, and use `decorNames.has()` to check existence or non-existence.

## S37 — scripts/release/lib/android-project.ts:307 — typescript:S6557 (MAJOR)
Use the 'String#endsWith' method instead.

## S38 — scripts/release/lib/android-project.ts:231 — typescript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S39 — src/host/launcher/store-access.ts:551 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S40 — src/host/launcher/version-switches.ts:106 — typescript:S6551 (MINOR)
'e' will use Object's default stringification format ('[object Object]') when stringified.

## S41 — src/host/launcher/generation-request.ts:62 — typescript:S6551 (MINOR)
'e' will use Object's default stringification format ('[object Object]') when stringified.

## S42 — src/host/launcher/store-access.ts:547 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S43 — src/host/launcher/store-access.ts:548 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S44 — src/host/launcher/HistoryScreen.tsx:103 — typescript:S6551 (MINOR)
'e' will use Object's default stringification format ('[object Object]') when stringified.

## S45 — src/host/launcher/HistoryScreen.tsx:377 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S46 — src/host/launcher/HistoryScreen.tsx:472 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S47 — src/host/launcher/KeyboardShell.tsx:141 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S48 — scripts/release/lib/android-project.ts:65 — typescript:S7776 (MINOR)
`configChanges` should be a `Set`, and use `configChanges.has()` to check existence or non-existence.

## S49 — src/host/launcher/LauncherRoot.tsx:1352 — typescript:S6551 (MINOR)
'e' will use Object's default stringification format ('[object Object]') when stringified.

## S50 — src/host/launcher/webview-pool.ts:121 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S51 — src/host/launcher/webview-pool.ts:140 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S52 — src/host/launcher/LauncherRoot.tsx:3233 — typescript:S7750 (MINOR)
Prefer `.findLast(…)` over `.filter(…).at(-1)`.

## S53 — src/host/ui/OverlayModal.tsx:97 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S54 — synthrun/sweep.ts:1046 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S55 — scripts/ios-ui-driver/Driver/main.swift:6 — swift:S1172 (MAJOR)
Remove the unused function parameter "o" or name it "_".

## S56 — scripts/ios-ui-driver/Driver/main.swift:6 — swift:S1172 (MAJOR)
Remove the unused function parameter "a" or name it "_".

## S57 — scripts/ios-ui-driver/DriverUITests/DriverUITests.swift:5 — swift:S115 (MINOR)
Rename this constant "BUNDLE" to match the regular expression ^[a-z][a-zA-Z0-9]*$.

## S58 — scripts/ios-ui-driver/DriverUITests/DriverUITests.swift:53 — swift:S3358 (MAJOR)
Extract the nested ternary operation into an independent statement.

## S59 — scripts/ios-ui-driver/driver.sh:33 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S60 — scripts/ios-ui-driver/driver.sh:40 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S61 — scripts/ios-ui-driver/driver.sh:50 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S62 — scripts/ios-ui-driver/driver.sh:56 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S63 — scripts/ios-ui-driver/driver.sh:91 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S64 — scripts/ios-ui-driver/driver.sh:98 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S65 — scripts/ios-ui-driver/driver.sh:98 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S66 — scripts/ios-ui-driver/driver.sh:99 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S67 — scripts/ios-ui-driver/driver.sh:100 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S68 — scripts/ios-ui-driver/driver.sh:100 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S69 — scripts/ios-ui-driver/driver.sh:104 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S70 — scripts/ios-ui-driver/driver.sh:109 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S71 — scripts/ios-ui-driver/driver.sh:115 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S72 — scripts/ios-ui-driver/driver.sh:126 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S73 — scripts/ios-ui-driver/driver.sh:132 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S74 — scripts/ios-ui-driver/driver.sh:133 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S75 — scripts/ios-ui-driver/driver.sh:136 — shell:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S76 — scripts/ios-ui-driver/driver.sh:159 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S77 — scripts/ios-ui-driver/driver.sh:160 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S78 — scripts/ios-ui-driver/driver.sh:160 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S79 — scripts/ios-ui-driver/driver.sh:164 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S80 — scripts/ios-ui-driver/gen.rb:23 — rubydre:S7840 (MINOR)
Use `any?` instead of `each`.

## S81 — scripts/ios-ui-driver/gen.rb:34 — rubydre:S7816 (MAJOR)
Move this 'require' statement to the top of the file before any class or module definitions.

## S82 — scripts/ios-ui-driver/gen.rb:40 — rubydre:S7816 (MAJOR)
Move this 'require' statement to the top of the file before any class or module definitions.

## S83 — synthrun/sweep.ts:322 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S84 — synthrun/sweep.ts:755 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S85 — synthrun/sweep.ts:755 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S86 — synthrun/sweep.ts:917 — typescript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S87 — synthrun/sweep.ts:399 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S88 — synthrun/sweep.ts:408 — typescript:S7503 (MINOR)
Async function 'firstActionableIndex' has no 'await' expression.

## S89 — synthrun/sweep.ts:488 — typescript:S4138 (MINOR)
Use a "for...of" loop, since the index is only used to read array elements.

## S90 — scripts/removal-ratchet.mjs:124 — javascript:S6557 (MAJOR)
Use the 'String#endsWith' method instead.

## S91 — src/host/storage-engine/test/copy.suite.ts:232 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S92 — src/host/launcher/HomeScreen.tsx:453 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S93 — src/host/launcher/HomeScreen.tsx:586 — typescript:S7727 (MAJOR)
Do not pass function `renderCell` directly to `.map(…)`.

## S94 — src/host/launcher/customize-tile.ts:9 — typescript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S95 — src/host/launcher/home-live.ts:79 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S96 — fixtures/latency-probe.app.tsx:36 — typescript:S7755 (MINOR)
Prefer `.at(…)` over `[….length - index]`.

## S97 — src/host/launcher/data-copy-journal.ts:35 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S98 — src/host/launcher/data-copy-journal.ts:101 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S99 — src/host/launcher/store-access.ts:117 — typescript:S6551 (MINOR)
'e' will use Object's default stringification format ('[object Object]') when stringified.

## S100 — src/host/launcher/store-access.ts:787 — typescript:S7718 (MINOR)
The catch parameter `cleanup` should be named `error_`.

## S101 — synthrun/sweep.ts:998 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S102 — src/host/storage-engine/copy-device-acceptance.ts:89 — typescript:S6551 (MINOR)
'scalar(db, 'PRAGMA quick_check')' will use Object's default stringification format ('[object Object]') when stringified.

## S103 — src/host/storage-engine/copy-device-acceptance.ts:101 — typescript:S6551 (MINOR)
'err' will use Object's default stringification format ('[object Object]') when stringified.

## S104 — src/host/storage-engine/copy-device-acceptance.ts:158 — typescript:S6551 (MINOR)
'scalar(db, 'SELECT sqlite_version()')' will use Object's default stringification format ('[object Object]') when stringified.

## S105 — src/host/storage-engine/copy-device-acceptance.ts:158 — typescript:S6551 (MINOR)
'scalar(db, 'PRAGMA journal_mode')' will use Object's default stringification format ('[object Object]') when stringified.

## S106 — src/host/storage-engine/copy-device-acceptance.ts:207 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S107 — src/host/storage-engine/copy-node.ts:25 — typescript:S7503 (MINOR)
Async method 'runAsync' has no 'await' expression.

## S108 — src/host/storage-engine/copy.ts:67 — typescript:S6551 (MINOR)
'err' will use Object's default stringification format ('[object Object]') when stringified.

## S109 — src/host/storage-engine/copy.ts:72 — typescript:S6551 (MINOR)
'err' will use Object's default stringification format ('[object Object]') when stringified.

## S110 — src/host/storage-engine/copy.ts:118 — typescript:S6551 (MINOR)
'check' will use Object's default stringification format ('[object Object]') when stringified.

## S111 — src/host/storage-engine/test/copy.suite.ts:184 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S112 — src/host/storage-engine/test/copy.suite.ts:212 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S113 — src/host/storage-engine/test/copy.suite.ts:322 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S114 — src/host/storage-engine/test/copy.suite.ts:340 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S115 — src/host/storage-engine/test/copy.suite.ts:373 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S116 — src/host/storage-engine/test/copy.suite.ts:390 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S117 — src/host/storage-engine/test/copy.suite.ts:399 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S118 — src/host/storage-engine/test/copy.suite.ts:405 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S119 — src/host/storage-engine/test/copy.suite.ts:427 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S120 — src/host/storage-engine/test/copy.suite.ts:446 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S121 — src/host/storage-engine/test/copy.suite.ts:461 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S122 — src/host/storage-engine/test/copy.suite.ts:473 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S123 — src/host/storage-engine/test/copy.suite.ts:512 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S124 — src/host/storage-engine/test/copy.suite.ts:529 — typescript:S2699 (BLOCKER)
Add at least one assertion to this test case.

## S125 — synthrun/sweep.ts:206 — typescript:S4138 (MINOR)
Use a "for...of" loop, since the index is only used to read array elements.

## S126 — synthrun/sweep.ts:228 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S127 — fixtures/pour-over-timer.app.tsx:19 — typescript:S6759 (MINOR)
Mark the props of the component as read-only.

## S128 — fixtures/pour-over-timer.app.tsx:53 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S129 — fixtures/pour-over-timer.app.tsx:59 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S130 — fixtures/reading-list.app.tsx:49 — typescript:S6551 (MINOR)
'row.title ?? ''' will use Object's default stringification format ('[object Object]') when stringified.

## S131 — fixtures/reading-list.app.tsx:49 — typescript:S6551 (MINOR)
'row.author ?? ''' will use Object's default stringification format ('[object Object]') when stringified.

## S132 — fixtures/reading-list.app.tsx:49 — typescript:S6551 (MINOR)
'row.shelf ?? SHELVES[0]' will use Object's default stringification format ('[object Object]') when stringified.

## S133 — deploy/site/fr/privacy.html:33 — css:S4666 (MAJOR)
Duplicate selector ":lang(ko)", first used at line 32

## S134 — server/src/admin/migrate-waitlist.ts:216 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S135 — src/sdk/motion.ts:404 — typescript:S7755 (MINOR)
Prefer `.at(…)` over `[….length - index]`.

## S136 — src/sdk/navigation.tsx:221 — typescript:S7755 (MINOR)
Prefer `.at(…)` over `[….length - index]`.

## S137 — src/sdk/surfaces.tsx:400 — typescript:S2301 (MAJOR)
Provide multiple methods instead of using "first" to determine which action to take.

## S138 — src/host/ui/tokens.ts:39 — typescript:S6551 (MINOR)
'e' will use Object's default stringification format ('[object Object]') when stringified.

## S139 — src/sdk/index.tsx:529 — typescript:S1874 (MINOR)
'HeadingProps' is deprecated.

## S140 — src/sdk/surfaces.tsx:340 — typescript:S6767 (MINOR)
'children' PropType is defined but prop is never used

## S141 — checks/passes/manifest-extraction.ts:151 — typescript:S6653 (MINOR)
Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.

## S142 — server/src/flowbench/report.ts:44 — typescript:S7776 (MINOR)
`TINT_KINDS` should be a `Set`, and use `TINT_KINDS.has()` to check existence or non-existence.

## S143 — server/src/flowbench/report.ts:45 — typescript:S7776 (MINOR)
`ICON_KINDS` should be a `Set`, and use `ICON_KINDS.has()` to check existence or non-existence.

## S144 — src/host/launcher/pending-purge.ts:210 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S145 — src/host/launcher/seed.ts:54 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S146 — deploy/cloudrun/smoke.sh:78 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S147 — deploy/lib.sh:216 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S148 — deploy/lib.sh:229 — shell:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S149 — deploy/lib.sh:322 — shell:S7684 (MAJOR)
Local variable 'uptime_DISPLAY_NAME' should use lower_case naming convention.

## S150 — deploy/lib.sh:322 — shell:S7684 (MAJOR)
Local variable 'uptime_CHECK_PATH' should use lower_case naming convention.

## S151 — deploy/lib.sh:322 — shell:S7684 (MAJOR)
Local variable 'uptime_PERIOD_MINUTES' should use lower_case naming convention.

## S152 — deploy/lib.sh:322 — shell:S7684 (MAJOR)
Local variable 'uptime_TIMEOUT_SECONDS' should use lower_case naming convention.

## S153 — deploy/lib.sh:322 — shell:S7684 (MAJOR)
Local variable 'uptime_REGIONS' should use lower_case naming convention.

## S154 — deploy/lib.sh:322 — shell:S7684 (MAJOR)
Local variable 'uptime_MATCHER_CONTENT' should use lower_case naming convention.

## S155 — deploy/lib.sh:460 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S156 — deploy/lib.sh:505 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S157 — deploy/lib.sh:561 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S158 — deploy/lib.sh:561 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S159 — deploy/lib.sh:600 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S160 — deploy/lib.sh:600 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S161 — deploy/lib.sh:608 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S162 — deploy/lib.sh:608 — shell:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S163 — scripts/lib/design-tokens.ts:293 — typescript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S164 — scripts/lib/design-tokens.ts:293 — typescript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S165 — scripts/lib/design-tokens.ts:293 — typescript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S166 — scripts/lib/design-tokens.ts:521 — typescript:S6959 (MAJOR)
Add an initial value to this "reduce()" call.

## S167 — scripts/lib/design-tokens.ts:585 — typescript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S168 — src/design/tints.ts:64 — typescript:S6653 (MINOR)
Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.

## S169 — src/design/tints.ts:83 — typescript:S7773 (MINOR)
Prefer `Number.parseInt` over `parseInt`.

## S170 — synthrun/session.ts:289 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S171 — synthrun/session.ts:297 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S172 — src/design/icons/names.ts:251 — typescript:S6653 (MINOR)
Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.

## S173 — server/src/routes/clarify.ts:224 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S174 — server/src/routes/generate.ts:295 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S175 — server/src/routes/generate.ts:477 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S176 — server/src/routes/generate.ts:838 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S177 — deploy/loadtest/firestore-admission.sh:51 — shell:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S178 — scripts/firestore-emulator-test.mjs:34 — javascript:S7780 (MINOR)
`String.raw` should be used to avoid escaping `\`.

## S179 — docs/design/mockups/index.html:1463 — javascript:S1481 (MINOR)
Remove the declaration of the unused 'g' variable.

## S180 — docs/design/mockups/index.html:1463 — javascript:S1854 (MAJOR)
The value assigned to "g" is never read. Use it or remove this assignment.

## S181 — docs/design/mockups/index.html:1873 — javascript:S3776 (CRITICAL)
Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed.

## S182 — docs/design/mockups/index.html:1885 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S183 — docs/design/mockups/index.html:109 — css:S1874 (MINOR)
Deprecated keyword "break-word" for property "word-break"

## S184 — docs/design/mockups/index.html:135 — css:S9423 (MAJOR)
Remove this "!important" and resolve the specificity conflict instead.

## S185 — docs/design/mockups/index.html:152 — css:S4666 (MAJOR)
Duplicate selector ".phone[data-platform="android"]", first used at line 149

## S186 — docs/design/mockups/index.html:228 — css:S4666 (MAJOR)
Duplicate selector ".w-actions", first used at line 226

## S187 — docs/design/mockups/index.html:253 — css:S4666 (MAJOR)
Duplicate selector ".w-switch.on::after", first used at line 252

## S188 — docs/design/mockups/index.html:265 — css:S4666 (MAJOR)
Duplicate selector ".w-chip.decide.sel", first used at line 264

## S189 — docs/design/mockups/index.html:413 — css:S4666 (MAJOR)
Duplicate selector ".s-switch.on::after", first used at line 407

## S190 — docs/design/mockups/index.html:788 — javascript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S191 — docs/design/mockups/index.html:788 — javascript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S192 — docs/design/mockups/index.html:788 — javascript:S7781 (MINOR)
Use `replaceAll()` with a string literal instead of this global regex.

## S193 — docs/design/mockups/index.html:820 — javascript:S7776 (MINOR)
`EMBER_SIZES` should be a `Set`, and use `EMBER_SIZES.has()` to check existence or non-existence.

## S194 — docs/design/mockups/index.html:851 — javascript:S3776 (CRITICAL)
Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed.

## S195 — docs/design/mockups/index.html:854 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S196 — docs/design/mockups/index.html:897 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S197 — docs/design/mockups/index.html:897 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S198 — docs/design/mockups/index.html:898 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S199 — docs/design/mockups/index.html:910 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S200 — docs/design/mockups/index.html:911 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S201 — docs/design/mockups/index.html:911 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S202 — docs/design/mockups/index.html:911 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S203 — docs/design/mockups/index.html:922 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S204 — docs/design/mockups/index.html:922 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S205 — docs/design/mockups/index.html:923 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S206 — docs/design/mockups/index.html:923 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S207 — docs/design/mockups/index.html:935 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S208 — docs/design/mockups/index.html:943 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S209 — docs/design/mockups/index.html:944 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S210 — docs/design/mockups/index.html:949 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S211 — docs/design/mockups/index.html:951 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S212 — docs/design/mockups/index.html:951 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S213 — docs/design/mockups/index.html:989 — javascript:S1788 (MAJOR)
Move this default parameter last, so callers can omit it instead of passing "undefined".

## S214 — docs/design/mockups/index.html:995 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S215 — docs/design/mockups/index.html:1023 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S216 — docs/design/mockups/index.html:1086 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S217 — docs/design/mockups/index.html:1121 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S218 — docs/design/mockups/index.html:1122 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S219 — docs/design/mockups/index.html:1122 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S220 — docs/design/mockups/index.html:1122 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S221 — docs/design/mockups/index.html:1131 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S222 — docs/design/mockups/index.html:1156 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S223 — docs/design/mockups/index.html:1159 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S224 — docs/design/mockups/index.html:1159 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S225 — docs/design/mockups/index.html:1159 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S226 — docs/design/mockups/index.html:1168 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S227 — docs/design/mockups/index.html:1175 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S228 — docs/design/mockups/index.html:1179 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S229 — docs/design/mockups/index.html:1190 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S230 — docs/design/mockups/index.html:1190 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S231 — docs/design/mockups/index.html:1190 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S232 — docs/design/mockups/index.html:1201 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S233 — docs/design/mockups/index.html:1259 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S234 — docs/design/mockups/index.html:1332 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S235 — docs/design/mockups/index.html:1348 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S236 — docs/design/mockups/index.html:1367 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S237 — docs/design/mockups/index.html:1369 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S238 — docs/design/mockups/index.html:1395 — javascript:S1481 (MINOR)
Remove the declaration of the unused 'g' variable.

## S239 — docs/design/mockups/index.html:1395 — javascript:S1854 (MAJOR)
The value assigned to "g" is never read. Use it or remove this assignment.

## S240 — docs/design/mockups/index.html:1418 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S241 — docs/design/mockups/index.html:1418 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S242 — docs/design/mockups/index.html:1423 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S243 — docs/design/mockups/index.html:1429 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S244 — docs/design/mockups/index.html:1430 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S245 — docs/design/mockups/index.html:1456 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S246 — docs/design/mockups/index.html:1503 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S247 — docs/design/mockups/index.html:1516 — javascript:S3923 (MAJOR)
This conditional operation returns the same value whether the condition is "true" or "false".

## S248 — docs/design/mockups/index.html:1519 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S249 — docs/design/mockups/index.html:1540 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S250 — docs/design/mockups/index.html:1541 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S251 — docs/design/mockups/index.html:1549 — javascript:S1481 (MINOR)
Remove the declaration of the unused 'c' variable.

## S252 — docs/design/mockups/index.html:1549 — javascript:S1854 (MAJOR)
The value assigned to "c" is never read. Use it or remove this assignment.

## S253 — docs/design/mockups/index.html:1564 — javascript:S3358 (MAJOR)
Extract this nested ternary operation into an independent statement.

## S254 — docs/design/mockups/index.html:1572 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S255 — docs/design/mockups/index.html:1587 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S256 — docs/design/mockups/index.html:1593 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S257 — docs/design/mockups/index.html:1593 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S258 — docs/design/mockups/index.html:1593 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S259 — docs/design/mockups/index.html:1609 — javascript:S7761 (MAJOR)
Prefer `.dataset` over `getAttribute(…)`.

## S260 — docs/design/mockups/index.html:1621 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S261 — docs/design/mockups/index.html:1621 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S262 — docs/design/mockups/index.html:1661 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S263 — docs/design/mockups/index.html:1673 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S264 — docs/design/mockups/index.html:1673 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S265 — docs/design/mockups/index.html:1675 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S266 — docs/design/mockups/index.html:1779 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S267 — docs/design/mockups/index.html:1791 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S268 — docs/design/mockups/index.html:1809 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S269 — docs/design/mockups/index.html:1811 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S270 — docs/design/mockups/index.html:1827 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S271 — docs/design/mockups/index.html:1828 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S272 — docs/design/mockups/index.html:1830 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S273 — docs/design/mockups/index.html:1837 — javascript:S2681 (MAJOR)
This statement will not be executed conditionally; only the first statement will be. The rest will execute unconditionally.

## S274 — docs/design/mockups/index.html:1920 — javascript:S4624 (MAJOR)
Refactor this code to not use nested template literals.

## S275 — docs/design/system-v1/palette-check.py:23 — python:S117 (MINOR)
Rename this parameter "C" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S276 — docs/design/system-v1/palette-check.py:23 — python:S117 (MINOR)
Rename this parameter "H" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S277 — docs/design/system-v1/palette-check.py:23 — python:S117 (MINOR)
Rename this parameter "L" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S278 — docs/design/system-v1/palette-check.py:42 — python:S117 (MINOR)
Rename this local variable "Cb" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S279 — docs/design/system-v1/palette-check.py:45 — python:S117 (MINOR)
Rename this local variable "C1p" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S280 — docs/design/system-v1/palette-check.py:45 — python:S117 (MINOR)
Rename this local variable "C2p" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S281 — docs/design/system-v1/palette-check.py:47 — python:S117 (MINOR)
Rename this local variable "dCp" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S282 — docs/design/system-v1/palette-check.py:47 — python:S117 (MINOR)
Rename this local variable "dLp" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S283 — docs/design/system-v1/palette-check.py:53 — python:S117 (MINOR)
Rename this local variable "dHp" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S284 — docs/design/system-v1/palette-check.py:54 — python:S117 (MINOR)
Rename this local variable "Cbp" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S285 — docs/design/system-v1/palette-check.py:54 — python:S117 (MINOR)
Rename this local variable "Lbp" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S286 — docs/design/system-v1/palette-check.py:57 — python:S3358 (MAJOR)
Extract this nested conditional expression into an independent statement.

## S287 — docs/design/system-v1/palette-check.py:60 — python:S117 (MINOR)
Rename this local variable "Rc" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S288 — docs/design/system-v1/palette-check.py:61 — python:S117 (MINOR)
Rename this local variable "Sc" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S289 — docs/design/system-v1/palette-check.py:61 — python:S117 (MINOR)
Rename this local variable "Sh" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S290 — docs/design/system-v1/palette-check.py:61 — python:S117 (MINOR)
Rename this local variable "Sl" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S291 — docs/design/system-v1/palette-check.py:62 — python:S117 (MINOR)
Rename this local variable "Rt" to match the regular expression ^[_a-z][a-z0-9_]*$.

## S292 — docs/design/system-v1/palette-check.py:72 — python:S1542 (MAJOR)
Rename function "dE" to match the regular expression ^[a-z_][a-z0-9_]*$.

## S293 — docs/design/system-v1/palette-check.py:105 — python:S7519 (MINOR)
Replace with dict fromkeys method call

## S294 — scripts/firestore-emulator-test.mjs:52 — javascript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S295 — scripts/firestore-emulator-test.mjs:92 — javascript:S2189 (BLOCKER)
Correct this loop's end condition to not be invariant.

## S296 — scripts/firestore-emulator-test.mjs:93 — javascript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S297 — deploy/site/beta.html:206 — css:S9423 (MAJOR)
Remove this "!important" and resolve the specificity conflict instead.

## S298 — deploy/site/beta.html:206 — css:S9423 (MAJOR)
Remove this "!important" and resolve the specificity conflict instead.

## S299 — deploy/site/beta.html:206 — css:S9423 (MAJOR)
Remove this "!important" and resolve the specificity conflict instead.

## S300 — scripts/release/lib/assets.ts:382 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S301 — server/src/policy/policy.ts:292 — typescript:S7503 (MINOR)
Async method 'check' has no 'await' expression.

## S302 — src/host/launcher/refusal-window.ts:17 — typescript:S6754 (MINOR)
useState call is not destructured into value + setter pair

## S303 — src/host/version-store/engine.ts:335 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S304 — src/host/version-store/engine.ts:339 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S305 — synthrun/capability.ts:100 — typescript:S7503 (MINOR)
Async method 'dispatch' has no 'await' expression.

## S306 — synthrun/sweep.ts:141 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S307 — synthrun/sweep.ts:164 — typescript:S7503 (MINOR)
Async function 'getScreenInfo' has no 'await' expression.

## S308 — synthrun/sweep.ts:259 — typescript:S7503 (MINOR)
Async function 'enumerateInteractiveElements' has no 'await' expression.

## S309 — synthrun/sweep.ts:912 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S310 — synthrun/sweep.ts:1045 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S311 — src/sdk/surfaces.tsx:54 — typescript:S6767 (MINOR)
'radius' PropType is defined but prop is never used

## S312 — fixtures/latency-probe.app.tsx:60 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S313 — fixtures/pour-over-timer.app.tsx:54 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S314 — fixtures/pour-over-timer.app.tsx:60 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S315 — fixtures/pour-over-timer.app.tsx:74 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S316 — fixtures/pour-over-timer.app.tsx:75 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S317 — src/host/version-store/engine.ts:562 — typescript:S7503 (MINOR)
Async method 'remove' has no 'await' expression.

## S318 — fixtures/latency-probe.app.tsx:13 — typescript:S1874 (MINOR)
'Heading' is deprecated.

## S319 — fixtures/latency-probe.app.tsx:50 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S320 — fixtures/latency-probe.app.tsx:81 — typescript:S1874 (MINOR)
The signature '({ size, color: colorToken, children }: HeadingProps): any' of 'Heading' is deprecated.

## S321 — fixtures/latency-probe.app.tsx:81 — typescript:S1874 (MINOR)
'Heading' is deprecated.

## S322 — src/host/version-store/engine.ts:171 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S323 — src/host/version-store/engine.ts:171 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S324 — src/host/version-store/engine.ts:209 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S325 — src/host/version-store/engine.ts:250 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S326 — src/host/version-store/engine.ts:251 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S327 — src/host/version-store/engine.ts:257 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S328 — src/host/version-store/engine.ts:257 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S329 — src/host/version-store/engine.ts:258 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S330 — src/host/version-store/engine.ts:468 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S331 — src/sdk/index.tsx:565 — typescript:S6767 (MINOR)
'radius' PropType is defined but prop is never used
