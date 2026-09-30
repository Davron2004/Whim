# DONE: sonar-r1-xhr-usage-appstats
Findings: S46, S78, S85, typescript:S9383/S7503, MAJOR/MINOR.

Make the XHR HTTP-classification continuation explicitly discarded without changing its continuation: it alone settles the open promise and preserves the late-abort-wins race. Mark the completed usage-purge notification chain as intentional background work after its two purge failures have already been handled. Make the no-op resolver return its required promise without an unnecessary async function. Preserve resolver retry/null semantics, purge boot/tick order, onError and onTick timing, XHR error taxonomy, and no source change to S84. Structural only; existing xhr abort-race and device-record purge tests are the regression surface. No new test.

Superseded rejection classification for S46/S85: thrown observer callbacks and unexpected HTTP classification rejection need behavior fixes/tests. See done/xhr-usage.md. S78 stays a separate structural public-Promise-contract change. Do not apply void.
