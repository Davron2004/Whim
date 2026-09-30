# 10.4 iOS device acceptance agent (simulator Whim-beta1-2156, iOS 27, Release, production), Opus

- **What:** the checklist's "reproduce first" note on R10. **Mechanism:** it named plan row 4 and Clarify's last question. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** none. **Evidence:** `18`, `22`, `23`.
- **What:** the limit scenario depends on the model. **Mechanism:** the production model never returned a limit; the `[[limit]]` stub marker only works on the stub server. **Verdict:** DRAWBACK. **Cost:** 2 extra prompts, and the limit screen stayed untested. **Evidence:** `39`, `41`, `42`.
- **What:** the orb menu is missing from the accessibility tree. **Mechanism:** it forced coordinate taps. **Verdict:** CAUGHT-REAL-MISTAKE (accessibility). **Cost:** small. **Evidence:** `30` plus the hierarchy dump.
- **What:** each Maestro command starts slowly. **Mechanism:** about 8–12 s per call, over about 60 calls. **Verdict:** ENV. **Cost:** about 10 minutes. **Evidence:** the run timings.
- **What:** the build finished in about 22 s, faster than my screenshot interval. **Mechanism:** most of the progress UI was never captured. **Verdict:** ENV. **Cost:** a partial check of the progress UI. **Evidence:** `25`, `26`.

Proposals:
1. Add a flowbench case that checks how often known-impossible prompts get a limit, and a reliable way to show the limit screen in acceptance builds, so the UI can be tested regardless of the model.
2. Run `xcrun simctl io <udid> recordVideo` during builds and keyboard transitions, and add a checklist line: "Done bar is present when a field autofocuses".
