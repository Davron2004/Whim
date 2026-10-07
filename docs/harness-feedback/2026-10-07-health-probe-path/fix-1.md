# fix-1 (implementer)

- [worked] The reviewer's findings were exact (file, line, red-check requirement), so no exploration was needed.
- [trap] BSD sed on macOS needs `sed -i ''`; `sed -i 'expr' file` fails with a misleading "extra characters at the end of d command".
- [worked] The provision uptime-update test reuses `stateAfter(first)` with a prepended list-configs rule carrying a stale spec hash. Rules are first-match, so the override wins.
