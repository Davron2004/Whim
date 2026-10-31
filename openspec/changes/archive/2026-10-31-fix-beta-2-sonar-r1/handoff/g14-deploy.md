# g14-deploy handoff

S133: fixed (structural)
S146: fixed (structural)
S147: fixed (structural)
S148: fixed (structural)
S149: fixed (structural)
S150: fixed (structural)
S151: fixed (structural)
S152: fixed (structural)
S153: fixed (structural)
S154: fixed (structural)
S155: fixed (structural)
S156: fixed (structural)
S157: fixed (structural)
S158: fixed (structural)
S159: fixed (structural)
S160: fixed (structural)
S161: fixed (structural)
S162: fixed (structural)
S177: fixed (structural)
S297: accept-proposed
S298: accept-proposed
S299: accept-proposed

## Accept proposals
S297: beta.html:206 is the `prefers-reduced-motion` reset (`animation/transition/scroll-behavior ... !important` on `*`); it must beat every author rule and inline style, so dropping !important would stop honoring the user's motion preference (accessibility regression).
S298: same line and rule as S297 (transition).
S299: same line and rule as S297 (scroll-behavior).

## Red-check
none: all structural

## Commands run
- bash -n deploy/lib.sh deploy/cloudrun/smoke.sh deploy/loadtest/firestore-admission.sh: exit 0
- sourced whim_uptime_var_name + whim_capture_uptime_value into a stub harness; CHECK_PATH lands in local uptime_check_path: exit 0
- No scripts/test/*.test.sh or deploy/test covers deploy/lib.sh (deploy/test does not exist); no deploy/smoke/loadtest script was run.

## Deviations
S7684: uptime locals renamed to lower case; added helper whim_uptime_var_name (tr) because bash 3.2 on macOS lacks `${var,,}`. Error messages keep upper-case keys.
S177: default case calls whim_usage_error (unreachable, outer case already restricts options).
