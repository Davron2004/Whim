/**
 * server/src/device-identity.ts — the attestation-ready device identity seam (design D15;
 * specs/generation-server "Device-identity middleware").
 *
 * The `/v1/*` middleware asks a `DeviceVerifier` for the calling device's id and sets only what it
 * returns; routes, admission and metering never read the raw `x-whim-device` header. The default
 * `shapeOnlyVerifier` is the UUID shape check with its `DeviceIdError` 400 bodies. A later App Attest
 * or Play Integrity verifier validates an assertion header behind the same interface, with no
 * route change.
 */
import type { ApiError, DeviceIdError } from '@whim/contract';

export interface DeviceVerifier {
  verify(headers: Headers): Promise<
    | { ok: true; deviceId: string }
    | { ok: false; status: 400 | 401 | 403; body: ApiError }
  >;
}

const DEVICE_HEADER = 'x-whim-device';

/** Any 8-4-4-4-12 hex UUID, any version, either case. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const shapeOnlyVerifier: DeviceVerifier = {
  async verify(headers) {
    const deviceHeader = headers.get(DEVICE_HEADER);

    if (!deviceHeader) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'missing_device_id',
          hint: 'Include a UUID in the x-whim-device request header.',
        } satisfies DeviceIdError,
      };
    }

    if (!UUID_RE.test(deviceHeader)) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'invalid_device_id',
          hint: 'The x-whim-device header must be a valid UUID (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
        } satisfies DeviceIdError,
      };
    }

    return { ok: true, deviceId: deviceHeader };
  },
};
