/**
 * The signup route's flood brake (beta-waitlist design D3; spec "Abuse limits"). A browser has no
 * device id, so the per-client key is the client address Caddy forwards, hashed with a random salt
 * made once per limiter. The key lives only in this process's memory: never stored, never logged,
 * gone on restart. Two limits, both counted only for admitted signups:
 *
 * - per client, a sliding one-hour window (`WHIM_BETA_LIMIT_PER_CLIENT_HOUR`);
 * - for everyone together, a UTC-day count (`WHIM_BETA_LIMIT_PER_DAY`), which also bounds how many
 *   client keys the window can hold.
 */
import { createHash, randomBytes } from 'node:crypto';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface SignupLimits {
  readonly perClientHour: number;
  readonly perDay: number;
}

export interface SignupLimiter {
  /** Counts the signup and returns true, or returns false and counts nothing. `clientAddress` is
   *  the forwarded address as received; an absent one shares a single key. */
  admit(clientAddress: string | undefined, now: number): boolean;
}

export function createSignupLimiter(limits: SignupLimits): SignupLimiter {
  const salt = randomBytes(16);
  const windows = new Map<string, number[]>();
  let day = -1;
  let dayCount = 0;

  const keyOf = (address: string | undefined): string =>
    createHash('sha256').update(salt).update(address?.trim() ?? '').digest('base64url');

  return {
    admit(clientAddress, now) {
      const today = Math.floor(now / DAY_MS);
      if (today !== day) {
        day = today;
        dayCount = 0;
      }
      const since = now - HOUR_MS;
      for (const [key, times] of windows) {
        const recent = times.filter((t) => t > since);
        if (recent.length === 0) windows.delete(key);
        else windows.set(key, recent);
      }
      const key = keyOf(clientAddress);
      const recent = windows.get(key) ?? [];
      if (recent.length >= limits.perClientHour || dayCount >= limits.perDay) return false;
      windows.set(key, [...recent, now]);
      dayCount++;
      return true;
    },
  };
}
