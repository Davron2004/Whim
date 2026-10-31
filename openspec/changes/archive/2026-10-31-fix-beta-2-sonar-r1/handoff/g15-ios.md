# g15-ios handoff

S32: fixed (structural)
S33: fixed (structural)
S55: fixed (structural)
S56: fixed (structural)
S57: fixed (structural)
S58: fixed (structural)
S59: fixed (structural)
S60: fixed (structural)
S61: fixed (structural)
S62: fixed (structural)
S63: fixed (structural)
S64: fixed (structural)
S65: fixed (structural)
S66: fixed (structural)
S67: fixed (structural)
S68: fixed (structural)
S69: fixed (structural)
S70: fixed (structural)
S71: fixed (structural)
S72: fixed (structural)
S73: fixed (structural)
S74: fixed (structural)
S75: fixed (structural)
S76: fixed (structural)
S77: fixed (structural)
S78: fixed (structural)
S79: fixed (structural)
S80: fixed (structural)
S81: accept-proposed
S82: accept-proposed

## Accept proposals
S81: the `require 'xcodeproj'` is a deliberate lazy fallback (begin/rescue LoadError, then extend $LOAD_PATH with CocoaPods' gem homes, then require again); hoisting it to the top would defeat the fallback.
S82: same, the retry require after the load path is extended must follow the helper call.

## Red-check
none: all structural

## Commands
- bash -n scripts/ios-ui-driver/driver.sh: exit 0
- ruby -c scripts/ios-ui-driver/gen.rb: exit 0
- swiftc -parse on AppDelegate.swift, main.swift, DriverUITests.swift: exit 0 (syntax only, nothing compiled or run)

## Deviations
none. S32/S33: setStyle/setHidden blocks extracted to makeSetStyle()/makeSetHidden() static funcs (nesting now 2). S58: nested ternary split into if/else. S57: BUNDLE renamed appBundleId. driver.sh line 54 (`$1` in wait_gone) was not flagged and is left.
