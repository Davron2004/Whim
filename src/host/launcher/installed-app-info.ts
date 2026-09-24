/**
 * installed-app-info — the one place the `WhimAppInfo` native module meets the pure `app-info`
 * wrapper (request-envelope D2). Everything else asks `installedAppInfo()`.
 */

import { Platform } from 'react-native';
import NativeWhimAppInfo from '../../native/NativeWhimAppInfo';
import { appInfoReader } from './app-info';

/** The installed app's `{platform, version, build}`. Reads the native constants on the first call
 *  and returns the same object after; throws what `appInfoFrom` throws (see `app-info.ts`). */
export const installedAppInfo = appInfoReader(Platform.OS, () => NativeWhimAppInfo?.getConstants());
