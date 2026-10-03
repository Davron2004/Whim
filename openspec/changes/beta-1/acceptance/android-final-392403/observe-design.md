# Native observation helper

`/tmp/whim-beta1-android-observe.py` accepts exactly `LABEL CAPTURE [SECONDS1..180]`. The default observation bound is 120 seconds. Before any Android command, it rejects an empty label, a name that does not fully match `post-[a-zA-Z0-9-]+`, a bound outside 1..180, and any existing XML, PNG, window, or receipt path. The existence check includes broken symlinks.

The helper calls the reviewed `/tmp/whim-beta1-android-action.py show`. It accepts either quoting style from Python's `repr` output and requires an exact label match. After that match, it copies `/sdcard/whim-post-ui.xml` through the absolute ADB binary on `emulator-5560` and confirms that the parsed hierarchy still contains the exact label. It never issues a second UIAutomator dump for capture. PNG and window capture follow immediately.

Only UIAutomator's recognized idle-state and null-root messages permit a failed observation to retry. Another explicit Android error causes failure. A successful hierarchy without the target label is another observation attempt, with at most a 250 ms pause. An XML parse failure, missing target in the copied XML, ADB failure, invalid PNG signature, or empty window output ends the run. The helper never taps, types, swipes, starts/stops resources, or searches for processes to cancel. The reviewed `show` wrapper manages its own scratch file and child cleanup.

The observation loop uses a monotonic deadline. Each `show` call has a 65-second caller timeout so the reviewed wrapper can finish its own bounded cleanup of its separately sessioned UI child. The requested observation deadline can therefore overrun by one bounded wrapper call. Each XML/PNG/window read has a separate 20-second timeout. Failed reads do not retry or invoke another dump.

All evidence goes into the existing acceptance directory beside `post-ui.py`. The helper holds capture bytes in memory until every read and validation succeeds, then writes `.xml`, `.png`, `-window.txt`, and `-observe.json` using exclusive creation. A name collision between the preflight check and publication cannot overwrite old evidence. It may leave new partial files, but there is no success receipt unless all three evidence files were written. The helper never deletes failed output or rewrites an earlier capture.

The receipt records the exact label, emulator, executable paths, helper and reviewed-wrapper hashes, attempt/retry counts, requested bound, deadline overrun, capture hashes, and monotonic times for the successful `show` and each read. Its `captured` status means data acquisition passed; root visual validation remains pending.

One snapshot cannot make screenshot timing atomic. The label can disappear after the XML dump and before `screencap`, especially on the short future-failure path. The receipt exposes that interval, and root must inspect the PNG and window data before claiming that the transient label is visible in the screenshot. Root must also keep access to the leased emulator serial during capture so another dump cannot replace the scratch XML between `show` and its copy.

Verification is limited to Python compilation and device-free calls to the argument, repr-label, and error-classification functions. No Android command or UI function ran during authoring. Independent root review is required before use.
