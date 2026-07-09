# Bypass-class handoff for the §16.4 hostile-corpus session (task 1.3 → task 8)

For the SEPARATE session that authors `checks/test/hostile/*` (chain-F, tasks 8.1/8.2). This
document is prose only — pattern-family descriptions, no encoded fixtures, no checker
internals (no pass names, no data-structure names, no file paths inside `checks/`). Test the
finished checker as a black box, through `runStaticChecks` only (`handoff/contract.md`'s
public signature), the same way a model-generated mini-app would be checked.

The unifying lesson (decision #37/T8): the *name* is not the *capability*. A defense that
scans for tokens like `fetch` or `eval` is defeated by anything that produces the same
runtime value without spelling the token. Each family below is a way a generated (or
adversarial) bundle could try to reach a forbidden global, a forbidden capability, or a
misleading manifest, without a literal, unaliased, uncomputed token appearing in the source.
Vary the surface form freely — these are families, not fixtures; the corpus should not be
guessable from the family names alone.

## Alias chains

Assign a forbidden global (or a member reached through one) to a local binding, then to
another binding derived from the first, any number of hops deep, mixing destructuring,
default parameters, and re-exports of the alias between local functions. The goal: the last
binding in the chain still resolves — by ordinary lexical scoping — to the same forbidden
value, however far the assignment chain wanders from the original name.

## Computed keys

Reach a forbidden member without ever writing its name as a string literal: build the key at
runtime from string concatenation, array `.join`, `String.fromCharCode`, template-literal
interpolation of otherwise-innocuous parts, or a lookup table keyed by something unrelated.
Apply the computed key to a global root, an alias of one, or an object obtained by some other
indirect means, and use the result as a call target or an assignment target.

## String assembly

Broaden "computed keys" to any place a checker might expect a string literal and instead see
an assembled one: an import specifier built from parts, a `capabilities` array entry that is a
template literal or a `.concat()` result, a navigation target computed from a variable. The
question each variant asks: does treating "not a literal" as "reject" actually hold, or does
some assembly pattern slip through because it merely *looks* like a literal at a glance?

## Prototype walks

Reach dynamic code execution via the object-prototype chain instead of the `eval`/`Function`
tokens directly: `{}.constructor`, an empty array or function's `.constructor`, a value
obtained from user-controlled data whose `.constructor.constructor` still resolves to the
`Function` constructor, chained through one or more intermediate variables or object property
accesses before the final call.

## Pollution routes

Attempt to corrupt a shared prototype (`Object.prototype`, `Array.prototype`, or similar) so
that a later, innocent-looking property read on any object picks up attacker-controlled
behavior — via `__proto__` assignment, `Object.setPrototypeOf`, `Object.assign` onto a
prototype object, or a deep-merge-style helper function that happens to walk into
`__proto__` when given a crafted key. Vary whether the pollution target is reached directly or
through an alias/computed key (combine with the families above).

## Manifest games

Attempt to make the extracted app manifest lie about what the bundle actually does, or make it
unreadable while the code beneath still runs: declare `capabilities` (or `screens`, or
`initial`) through a spread of a computed object, a function call that returns the "real"
array, a conditional expression that picks between two literal arrays at runtime, a second
`defineApp`-shaped call that never becomes the default export (to see whether the wrong one
gets read), or a `defineApp` argument object built by `Object.assign` from multiple literal
pieces instead of written as one literal. The question: does the manifest reader either
recover the true intent from an AST-static shape, or refuse it outright — never silently
produce a wrong-but-plausible manifest.

## What the negative control (task 8.2) needs

A hostile suite that always passes is worthless (the same non-vacuity concern as the
`invariants/` negative control, decision #28). Task 8.2's negative control should be a sample
built from one of the families above but pushed one step further than the checker is expected
to catch — or a deliberately weakened checker configuration run against the existing hostile
corpus — such that at least one hostile case is *known* to still get through. That failing
case documents the checker's stated boundary (design D3: "what slips a genuinely adversarial
encoding is the runtime's job") rather than silently proving nothing.
