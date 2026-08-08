/**
 * redact — the privacy floor as a code path, not a comment (obs-v1, design D3; spec "Sensitive
 * fields are structurally unloggable on the device").
 *
 * Prompt text, generated mini-app source, the `x-whim-device` value and any model-provider API key
 * never reach a transport. The seam runs this over a record's fields BEFORE the record is buffered,
 * so the overlay and the batching sink cannot disagree about what is sensitive — there is no
 * per-sink serializer to lose it.
 *
 * Matching is by field NAME, case-insensitively, against a closed set, and recurses into nested
 * plain objects and arrays to a bounded depth (a sensitive value hidden one level down in a
 * context object is the realistic leak, not an exotic one).
 */

/** What a sensitive value is replaced with. Fixed, greppable, never configurable. */
export const REDACTED = '[redacted]';

/** How deep the walk goes before it stops recursing (a cycle or a deep tree is not a reason to
 *  spend time in a logging call). Values below this depth are copied as-is. */
const MAX_DEPTH = 4;

/**
 * Field names whose VALUE is never loggable. Compared lower-cased, so `deviceId`, `deviceid` and
 * `DeviceID` all match. Four families, from the spec: prompt text, generated source, the device
 * id, and provider credentials.
 */
export const SENSITIVE_FIELD_NAMES: readonly string[] = [
  // prompt text
  'prompt',
  'prompttext',
  'prompt_text',
  'userprompt',
  'utterance',
  'transcript',
  // generated mini-app source
  'source',
  'sourcetext',
  'generatedsource',
  'appsource',
  'bundlesource',
  'code',
  // the x-whim-device value
  'deviceid',
  'device_id',
  'x-whim-device',
  'xwhimdevice',
  // model-provider credentials
  'apikey',
  'api_key',
  'apitoken',
  'accesstoken',
  'authorization',
  'secret',
];

const SENSITIVE = new Set(SENSITIVE_FIELD_NAMES);

/** True when a field of this name may never carry its own value into a record. */
export function isSensitiveField(name: string): boolean {
  return SENSITIVE.has(name.toLowerCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    return redactObject(value, depth + 1);
  }
  return value;
}

function redactObject(fields: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isSensitiveField(key) ? REDACTED : redactValue(value, depth);
  }
  return out;
}

/**
 * Return a copy of `fields` in which every sensitive-named field carries {@link REDACTED} instead
 * of its value. The input is never mutated; the result is what gets buffered and sent.
 */
export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return redactObject(fields, 0);
}
