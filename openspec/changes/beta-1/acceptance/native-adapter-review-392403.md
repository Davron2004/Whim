# Emulator adapter pre-execution review

VERDICT: clean

The current adapter SHA-256 is `bd0095a8f27f900d46d63dc852aebf4868e708a80051242ca4f24af071f9e876`, matching the supplied value.

The preserved original and current adapter differ only after the existing exact AVD/port checks. The new Bash 3.2-compatible loop creates `headed_args` in original order and omits only an argument exactly equal to `-no-window`. Every other element of `args` remains a distinct quoted argument in the final `exec`.

The existing boundaries remain intact:

- It accepts only `-avd Whim_Verify` and `-port 5580`.
- Caller-provided `-memory` or `-cores` still exit with an error.
- The final emulator invocation still appends exactly `-memory 3072 -cores 2`.
- It does not invoke `adb`, change an AVD, write a global setting, or target another emulator.

This is root-owned temporary orchestration glue, not a product-source change. I did not execute the adapter or start a resource. The supplied Bash 3.2 syntax check passed; no gate, device, or native acceptance result is claimed.
