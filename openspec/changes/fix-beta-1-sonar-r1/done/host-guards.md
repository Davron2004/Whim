# DONE: sonar-r1-host-guards
Findings: S3, S4, S35, typescript:S6653, MINOR.
Replace the three hasOwnProperty.call guards with Object.hasOwn. Preserve optional-null normalization, known summary-kind validation, and known event-type validation. No source-grep test. A final Android offline and iOS Release generation must exercise all three host decode paths before terminal acceptance; current WebView SDK usage is not Hermes proof.
