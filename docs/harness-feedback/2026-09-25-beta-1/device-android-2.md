# 10.4 Android pass 2 agent (emulator-5560, build 386398, slow stub), Opus

- **What:** a subagent ran the Android device acceptance with adb, Maestro and the local stub server. **Mechanism:** Maestro flows for long paths, raw adb tap scripts where timing mattered (the line), Python pixel checks for hairlines and colours, and the stub server log as the source of truth. **Verdict:** CAUGHT-REAL-MISTAKE (the server log exposed the queued-screen bug the screenshots alone didn't, #131). **Cost:** about 55 minutes; time lost on adb typing glitches, a first line attempt too slow with Maestro, discovering that a second build per device is refused (not in the brief), trying to drive TalkBack through adb, and a scratchpad collision (overwrote the orchestrator's `shot.sh`/`tmp.sh`). **Evidence:** `acceptance/android-2/`, `08q-line-server-log.txt`, `03e-settings-probe-debounce-logcat.txt`.

Proposals:
1. A stub marker that installs an app which throws at runtime (e.g. `[[throw]]`), so the mini-app error screen can be verified.
2. Device briefs note that the line needs distinct device IDs (per-device limit), and each device agent uses its own scratch subfolder.
