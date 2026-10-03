# Android serial-case helper pre-execution review

VERDICT: findings

FINDINGS:

- `/tmp/whim-beta1-android-case.py:43-48,57-60` — **med** — `start` checks only that `case` begins with `post-` and silently treats any fourth argument other than `plan-only` as permission to tap `Build it`. For example, `start 'post-../bad' 'prompt'` passes the prefix check, reaches the Compose field, and types before the pinned capture helper finally rejects `post-../bad-prompt`; `start post-demo 'prompt' typo` proceeds to `Build it` rather than rejecting the unknown option. The helper's no-overwrite regex prevents a bad capture, but the serial driver does not fail closed before UI effects and can turn a mistyped plan-only request into a generation.

- `/tmp/whim-beta1-android-case.py:2,5` — **low** — `json`, `pathlib`, and `BASE` have no caller. Remove them when correcting the argument validation so the temporary action surface stays minimal.

Required correction: validate the mode and arity before any action; for `start`, accept only `start CASE PROMPT` or `start CASE PROMPT plan-only`, and require CASE to match the pinned helper's full `post-[A-Za-z0-9-]+` rule. For `wait`, accept only its documented arities and require a positive timeout. Then retain the current quoted argument vectors and action-wrapper calls.

The remaining controls are sound: every UI action routes through the previously reviewed wrapper, which clears stale scratch XML and preserves the helper's no-overwrite guard; direct `adb` uses the absolute binary and explicit `emulator-5560`; subprocess calls have timeouts; no report submission, Docker, server, or external-device operation appears. The reviewed SHA-256 matches the supplied `d0c65079d0de24f9241c0523d89cf4a4ecb6ccefc510728a74cc04d8883c10c3`.

I did not invoke the helper, operate a device, or start a resource.

## Re-review — SHA-256 `4504602da5408afa53b7a1e5da259c77db5e2d88130c7b5f9865400565f940c3`

VERDICT: findings

The MED finding is resolved. Before any `wait`, wrapper action, or direct `adb` call, the revised helper now rejects an absent or unknown mode, wrong arity, a malformed case/capture name, an empty prompt, an unknown optional `start` argument, and a wait bound outside integer `1..180`. `start CASE PROMPT plan-only` is the only accepted optional form, so a typo cannot fall through to `Build it`.

One low-severity cleanup finding remains: `/tmp/whim-beta1-android-case.py:2,5,56,76` keeps unused `pathlib`/`BASE`, a prefix check made unreachable by the preceding full regex, and a final `else` made unreachable by the validated mode dispatch. These do not affect the reviewed safety or provenance behavior, but they are dead scaffolding in a temporary action surface and should be removed before calling the helper clean.

The current SHA matches the supplied value. I did not invoke the helper or operate any native resource.

## Final re-review — SHA-256 `f54d60e07d2063872cadf10fff02a16e26de729523d8c364707f54ebca6e6634`

VERDICT: clean

The final helper removes the unused imports/constants and unreachable branches identified above. Its full input validation still occurs before every action; it preserves the explicit `emulator-5560` target, bounded wrapper calls and waits, the pinned wrapper's stale-XML/no-overwrite behavior, and exact-label-only interactions. No report submission, Docker, server control, external-device operation, or product mutation path was added.

I did not invoke the helper or operate a native resource.
