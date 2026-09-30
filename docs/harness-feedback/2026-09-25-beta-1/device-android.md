# 10.4 Android device acceptance agent (emulator-5560, API 37), Opus

- **What:** On-device run found the R10 keyboard problem. **Mechanism:** a real API 37 emulator with edge-to-edge enforced; the Chromium and Node suites can't see keyboard insets. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** about 10 min. **Evidence:** 03b, 03g.
- **What:** The stub server can't plan a plain prompt, and the app it builds fails on render. **Mechanism:** the stub rewrite only answers for marker prompts; the stub's app source is out of date with the SDK and nothing runs it. **Verdict:** CAUGHT-REAL-MISTAKE (app source) / ENV (rewrite). **Cost:** about 10 min of workarounds; plan row 4 blocked; orb checks moved to an example app. **Evidence:** 04f, 04j, `server/src/routes/rewrite.ts:320-327`.
- **What:** "The line" can't be staged. **Mechanism:** the stub's fixed 200 ms delay makes a build about 3 s, faster than any UI loop. **Verdict:** ENV. **Cost:** about 8 min; scenario blocked. **Evidence:** 05c.
- **What:** The brief's assumptions didn't match the app: the legal flow at launch ending on Home, and "compose any prompt" on the stub. **Verdict:** DRAWBACK. **Cost:** a few minutes re-checking against the spec.
- **What:** Compound shell commands and `curl` were denied by permissions. **Verdict:** ENV. **Cost:** minor, commands had to be split.

Proposals:
1. Make the stub able to run the whole acceptance: a `WHIM_STUB_DELAY_MS` setting (or `[[slow]]` marker) so a cap-1 line can be staged; the stub rewrite returns 5 or more canned plan rows for any prompt; `STUB_APP_SOURCE` updated to the current app shape, with a test that actually runs the stub bundle.
2. A Maestro keyboard flow on an API 35+ emulator that focuses each checklist field and checks the field and its main button stay visible, run in section 10 so R10 can't come back unnoticed.
