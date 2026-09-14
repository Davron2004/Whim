/**
 * contract-mirror — a client-local mirror of shapes `openspec/changes/public-generation-server`
 * adds to `@whim/contract` (`ServiceRefusalCode`, `ReportReason`, `ReportRequest`,
 * `ReportResponse`), which has not landed on this branch yet. Authoritative source, quoted
 * verbatim from `openspec/changes/public-generation-server/specs/generation-contract/spec.md`:
 *
 *   - §"Service refusal codes are a closed vocabulary": the seven-member closed set below.
 *   - §"Report request and response shapes": `ReportRequest`'s and `ReportResponse`'s fields and
 *     bounds below.
 *
 * Once `public-generation-server` chain-1 lands these in `contract/src/index.ts`, this module
 * should be deleted and every import of it switched to the real schemas/types from
 * `@whim/contract` instead. The shapes below are kept byte-for-byte in sync with that spec in the
 * meantime.
 *
 * Zod is a VALUE import here — unlike every other `@whim/contract` shape this repo imports
 * type-only, to keep zod out of the Metro bundle graph (see `generation-client.ts`'s hand-rolled
 * structural guards). That is safe ONLY because this module is consumed by Node test suites
 * (which parse against these schemas exactly as they will against the real contract's), plus
 * type-only (`import type`) by the two production modules that need the shapes
 * (`service-refusal.ts`, `report-payload.ts`) — neither imports this module's zod VALUES, so
 * nothing here reaches Metro either way.
 */
import { z } from 'zod';

export const ServiceRefusalCode = z.enum([
  'payload_too_large',
  'daily_limit',
  'device_busy',
  'server_busy',
  'content_policy',
  'policy_unavailable',
  'budget_exhausted',
]);
export type ServiceRefusalCode = z.infer<typeof ServiceRefusalCode>;

export const ReportReason = z.enum(['offensive', 'harmful', 'broken', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;

export const ReportRequest = z.object({
  reason: ReportReason,
  note: z.string().max(1000).optional(),
  appName: z.string().max(200).optional(),
  prompt: z.string().optional(),
  source: z.string().optional(),
});
export type ReportRequest = z.infer<typeof ReportRequest>;

export const ReportResponse = z.object({ reportId: z.string().min(1) });
export type ReportResponse = z.infer<typeof ReportResponse>;
