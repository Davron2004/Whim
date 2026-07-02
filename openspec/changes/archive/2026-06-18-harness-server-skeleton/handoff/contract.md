# Handoff: contract.md (chain-B → C, D)

The exported surface of `@whim/contract` (`contract/src/index.ts`). Chains C/D import these names
and `z.infer` types; they never redefine a shape. Schemas are zod; each has a `z.infer` type
export of the same PascalCase name.

## Schemas (verbatim shapes)
```
GenerateRequest  = z.object({ prompt: z.string(),
                              app: z.object({ source, manifest, schema }).optional() })
RewriteRequest   = z.object({ prompt: z.string() })
RewriteResponse  = z.object({ rewrittenPrompt: z.string() })
Diagnostic       = z.object({ kind: z.string(), symbol: z.string().optional(),
                              line: z.number().optional(), hint: z.string().min(1) })
Usage            = z.object({ promptTokens: z.number().int(),
                              completionTokens: z.number().int(),
                              totalTokens: z.number().int() })
WireAppRecord    = z.object({ name: z.string(), source: z.string(), bundle: z.string(),
                              sourceMap: z.string().optional(), manifest: <object>, schema: <object> })
GenerationEvent  = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'),
             stage: z.enum(['plan','generate','check','run','repair']),
             status: z.enum(['start','done']), attempt: z.number().optional() }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('diagnostic'), diagnostic: Diagnostic }),
  z.object({ type: z.literal('usage'), usage: Usage }),
  z.object({ type: z.literal('result'), app: WireAppRecord }),
  z.object({ type: z.literal('failure'), reason: z.string(), attempts: z.number(),
             diagnostics: z.array(Diagnostic) }),
])
```

## Invariants
- `Diagnostic.hint` is mandatory, non-empty (`.min(1)`).
- A `GenerationEvent` stream carries **exactly one** terminal event (`result` | `failure`),
  and it is **always last**. Unknown `type` is rejected by the union.
- `WireAppRecord` is install-state-free: NO app-id, install timestamp, or launcher position.
- `Diagnostic.kind` is an OPEN string in #8; #9 (static-check-pipeline) narrows it to a closed
  catalog later — do not hard-code a closed enum here.

## Open points carried to the implementer
- **P3 (seam check):** before freezing `WireAppRecord`, confirm #5 (launcher-shell) stored record
  adds install-state fields *on top of* this set, not overlapping. Overlap → roadmap ledger note.
- **P4 (`manifest`/`schema`):** if real sub-schemas aren't cheaply extractable from
  `src/host/storage-engine/contract.ts` / `build/build.mjs`, `z.record(z.unknown())` is acceptable
  — the wire contract only needs the shape to round-trip, not to re-validate app internals.
