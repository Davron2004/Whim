# Android observer pre-execution review

VERDICT: clean

The reviewed observer SHA-256 is `e654eb258e10a96ba1f3553f13c87b126b2d4d77f72ad8101f7d7da46ec77848`, matching the supplied value.

It rejects bad arity, empty or NUL-bearing labels, invalid capture names, invalid bounds, and any existing or broken-symlink evidence path before it reads the wrapper or issues an Android command. Publication uses exclusive creation for XML, PNG, window data, and the receipt, so a preflight-to-publication collision cannot overwrite prior evidence.

Observation calls only the reviewed `show` action. After an exact label is parsed from that successful output, the observer copies the wrapper's scratch XML from explicit `emulator-5560`, parses it, and requires the same exact label in that hierarchy. It then performs only `screencap` and `dumpsys window`; no second UIAutomator dump, tap, type, swipe, report, server, Docker, or external-device command appears.

Retries are limited to the two named UIAutomator idle/null-root messages and refuse any additional explicit Android error. All other wrapper failures, malformed XML, missing label, ADB read failure, invalid PNG, or empty window output terminate the run. The observation loop uses the requested monotonic bound; each wrapper call is bounded at 65 seconds so its own child cleanup can finish, and each subsequent read is bounded at 20 seconds.

The receipt records hashes, serial, attempts, retry count, timings, and artifact hashes. It correctly leaves visual confirmation pending because a PNG/window capture may follow the XML dump after a UI transition. The documented serial-ownership requirement remains necessary to prevent another actor from replacing the scratch XML during capture.

I did not invoke the observer or operate a native resource.
