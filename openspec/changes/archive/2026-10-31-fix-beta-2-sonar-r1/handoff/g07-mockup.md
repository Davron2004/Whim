# g07-mockup handoff

Single file touched: `docs/design/mockups/index.html`. All fixes are structural-no-test (rendered output and control flow unchanged).

## Per S-number
- S179, S238, S251: fixed (structural) - unused `g` / `c` declarations removed (`G(c)` is pure; the `c` in viewComponents was shadowed by inner `{ k, c }` destructures)
- S180, S239, S252: fixed (structural) - same dead stores
- S183: fixed (structural) - `word-break: break-word` -> `overflow-wrap: anywhere` (the specified equivalent)
- S185, S186, S187, S188, S189: fixed (structural) - duplicate selectors merged into the first rule; no intervening rule has equal specificity and the same property, so the cascade is unchanged
- S190, S191, S192: fixed (structural) - `replaceAll` with string literals
- S193: fixed (structural) - `EMBER_SIZES` is a Set, `.has`
- S213: fixed (structural) - `to(target, cfg, velocity)` with `cfg ?? SPRINGS.smooth` in the body (no caller passes null)
- S214, S215, S262, S263, S264, S265, S266, S267, S268, S269, S270, S271, S272, S273: fixed (structural) - braces added around the guard `return` / conditional branch; the following statement stays unconditional, as before
- S247: fixed (structural) - `narrow ? .5 : .5` collapsed to `.5` (both branches were equal; `narrow` is still used for the second frame)
- S259: fixed (structural) - `dataset.theme`
- S21, S181, S194: accept-proposed
- S182, S195, S196, S197, S199, S203, S204, S206, S208, S210, S224, S225, S229, S230, S231, S242, S245, S246, S253: accept-proposed
- S198, S200, S201, S202, S205, S207, S209, S211, S212, S216, S217, S218, S219, S220, S221, S222, S223, S226, S227, S228, S232, S233, S234, S235, S236, S237, S240, S241, S243, S244, S248, S249, S250, S254, S255, S256, S257, S258, S260, S261, S274: accept-proposed
- S184: accept-proposed

## Accept proposals
Rule S3776 (S21, S181, S194): design reference mockup; splitting functions changes the reference without behavior value, and the gain is a 1-4 point complexity overshoot.
Rule S3358 (S182, S195, S196, S197, S199, S203, S204, S206, S208, S210, S224, S225, S229, S230, S231, S242, S245, S246, S253): design reference mockup; the nested ternaries sit inside HTML template strings, and extracting them restructures the reference without behavior value.
Rule S4624 (S198, S200, S201, S202, S205, S207, S209, S211, S212, S216, S217, S218, S219, S220, S221, S222, S223, S226, S227, S228, S232, S233, S234, S235, S236, S237, S240, S241, S243, S244, S248, S249, S250, S254, S255, S256, S257, S258, S260, S261, S274): nested template literals are the mockup's HTML-in-JS idiom (about 40 sites); rewriting them is pure churn on a design reference and risks changing rendered markup.
Rule S9423 (S184): `* { scroll-behavior: auto !important }` inside `prefers-reduced-motion` must beat author and inline scroll-behavior declarations; removing `!important` could reintroduce smooth scrolling for reduced-motion users.

## Red-check
none: all structural.

## Commands run
- `python3 -I .../g07edit.py docs/design/mockups/index.html`: exit 0 (all 40 replacements matched exactly once)
- `node --check` of the extracted `<script>` body: exit 0
- `npm run -s build`: exit 0
- `npm run -s sdk:test -- --only icons` (reads the mockup ICONS map): exit 0
- `node scripts/design-tokens.mjs --check` (reads the mockup): exit 0
- `npm run -s checks:test -- --only design-system`: exit 0, PASS 30 FAIL 0
All via capped-run.sh. No eslint/typecheck run: the only touched file is HTML, not linted.

## Deviations
none
