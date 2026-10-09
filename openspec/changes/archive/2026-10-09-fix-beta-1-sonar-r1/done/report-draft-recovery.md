# DONE: sonar-r1-report-draft-recovery
Finding: S77, typescript:S9383, MAJOR.

Recover visibly when loading a report draft rejects. Do not make or send a partial draft: the active stored source remains mandatory whenever it exists. Render a copy-table, content-free inline failure and a close action; closing and reopening starts a fresh read. Log only the operation/outcome, never the note, prompt, source, app name, raw error message, or device id. Add a rendered regression proving a rejected active-description/source read neither becomes an unhandled rejection nor enables Send, and that it exposes the recovery state without report content. Preserve all existing send/refusal/thanks paths.
