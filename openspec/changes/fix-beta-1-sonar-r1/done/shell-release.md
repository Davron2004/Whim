# DONE: sonar-r1-shell-release
Findings: S7, S9-S21, S25, S36-S39, S47.
Use Bash [[ tests at every cited predicate; bind each cited positional input to a function-local name before use; use node:buffer; make runVerifyAab non-async while keeping numeric outcomes and caught failures. Preserve Bash 3.2, set -euo pipefail, argument quoting, upgrade artifact order, printed diagnostics, and all exit codes. Existing deploy-config coverage is the regression seam. No patch-shaped test.
