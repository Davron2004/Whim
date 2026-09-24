/**
 * app-info Node suite (request-envelope task 3.2) — the pure wrapper around the `WhimAppInfo`
 * native module's constants, driven with injected constants, plus the seam on a build without the
 * native module (this runner's `react-native` stub registers no TurboModules).
 */
import { Harness } from './harness';
import { appInfoFrom, appInfoReader, internalBuildFrom, type NativeAppInfoConstants } from '../app-info';
import { installedAppInfo, installedInternalBuild } from '../installed-app-info';

export async function runAppInfoTests(h: Harness): Promise<void> {
  await h.test('app-info: the native constants become {platform, version, build}', () => {
    h.eq(
      appInfoFrom('android', { version: '1.0.0', build: '380642' }),
      { platform: 'android', version: '1.0.0', build: 380642 },
      'an Android build reports its own version and integer build',
    );
    h.eq(
      appInfoFrom('ios', { version: '1.2.0', build: '1' }),
      { platform: 'ios', version: '1.2.0', build: 1 },
      'an iOS build reports platform ios',
    );
  });

  await h.test('app-info: two builds of the same source each report their own build number', () => {
    const first = appInfoFrom('android', { version: '1.0.0', build: '380642' });
    const second = appInfoFrom('android', { version: '1.0.0', build: '380700' });
    h.eq([first.build, second.build], [380642, 380700], 'the build comes from the installed binary, not a constant');
  });

  await h.test('app-info: a build without the native module fails loudly', async () => {
    await h.throws(
      () => { appInfoFrom('android', null); },
      'WhimAppInfo: the native module is missing from this build',
      'a null module is refused',
    );
    await h.throws(
      () => { appInfoFrom('ios', undefined); },
      'WhimAppInfo: the native module is missing from this build',
      'an absent module is refused',
    );
  });

  await h.test('app-info: a missing build fails loudly', async () => {
    const missing: NativeAppInfoConstants[] = [{ version: '1.0.0' }, { version: '1.0.0', build: '' }, { version: '1.0.0', build: null }];
    for (const constants of missing) {
      await h.throws(
        () => { appInfoFrom('android', constants); },
        'WhimAppInfo: build is missing',
        `build ${JSON.stringify(constants.build)} counts as missing`,
      );
    }
  });

  await h.test('app-info: a build that is not a positive integer fails loudly, naming it', async () => {
    const forged: unknown[] = ['1.2.3', '12a', '-5', '0', '007', ' 42', '1e3', '99999999999999999999', 42];
    for (const build of forged) {
      await h.throws(
        () => { appInfoFrom('ios', { version: '1.0.0', build }); },
        `WhimAppInfo: build ${JSON.stringify(build)} is not a positive integer`,
        `build ${JSON.stringify(build)} is refused`,
      );
    }
  });

  await h.test('app-info: a missing version fails loudly', async () => {
    for (const version of [undefined, '', 100]) {
      await h.throws(
        () => { appInfoFrom('android', { version, build: '5' }); },
        'WhimAppInfo: version is missing',
        `version ${JSON.stringify(version)} is refused`,
      );
    }
  });

  await h.test('app-info: a version the server would refuse fails loudly, naming it', async () => {
    for (const version of ['v1.1', '.1.0', '1.0 beta', `1.${'0'.repeat(31)}`]) {
      await h.throws(
        () => { appInfoFrom('ios', { version, build: '5' }); },
        `WhimAppInfo: version ${JSON.stringify(version)} is not a version the server accepts`,
        `version ${JSON.stringify(version)} is refused before any request carries it`,
      );
    }
    for (const version of ['1.0.0', '1.1.0-beta.2', '2.0.0+381500', `1${'0'.repeat(31)}`]) {
      h.eq(appInfoFrom('android', { version, build: '5' }).version, version, `version ${version} is accepted as the phone reports it`);
    }
  });

  await h.test('app-info: a platform other than ios or android fails loudly', async () => {
    await h.throws(
      () => { appInfoFrom('web', { version: '1.0.0', build: '5' }); },
      'WhimAppInfo: unsupported platform "web"',
      'web is not a Whim platform',
    );
  });

  await h.test('app-info: the reader reads the native constants once and reuses them', () => {
    let reads = 0;
    const read = appInfoReader('android', () => {
      reads++;
      return { version: '1.0.0', build: '7' };
    });
    const first = read();
    const second = read();
    read();
    h.eq(first, { platform: 'android', version: '1.0.0', build: 7 }, 'the first call returns the app info');
    h.ok(first === second, 'later calls return the same object');
    h.eq(reads, 1, 'the native constants are read exactly once');
  });

  await h.test('app-info: the reader does not cache a failed read', async () => {
    const results: (NativeAppInfoConstants | null)[] = [null, { version: '1.0.0', build: '9' }];
    let reads = 0;
    const read = appInfoReader('ios', () => results[reads++]);
    await h.throws(() => { read(); }, 'WhimAppInfo: the native module is missing from this build', 'the failed first read throws');
    h.eq(read(), { platform: 'ios', version: '1.0.0', build: 9 }, 'the next call reads again');
    h.eq(reads, 2, 'each call before a success reads the constants');
  });

  await h.test('app-info: only a native true makes an internal build; anything else is a store build', () => {
    h.eq(internalBuildFrom({ version: '1.0.0', build: '1', internalBuild: true }), true, 'a debug/offline build reports true');
    h.eq(internalBuildFrom({ version: '1.0.0', build: '1', internalBuild: false }), false, 'the release build reports false');
    h.eq(internalBuildFrom({ version: '1.0.0', build: '1' }), false, 'a binary older than the flag is a store build');
    h.eq(internalBuildFrom({ version: '1.0.0', build: '1', internalBuild: 'true' }), false, 'a non-boolean is a store build');
    h.eq(internalBuildFrom(null), false, 'a missing module is a store build');
    h.eq(installedInternalBuild(), false, 'the seam, on a build without the module, reads as a store build');
  });

  await h.test('app-info: the seam fails loudly on a build without the WhimAppInfo module', async () => {
    await h.throws(
      () => { installedAppInfo(); },
      'WhimAppInfo: the native module is missing from this build',
      'the seam reports the missing module, not a TypeError',
    );
  });
}
