const BASE_RESTRICTED_SYNTAX = [
  {
    selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="sort"][arguments.length=0]',
    message: 'Pass an explicit comparator to sort(); use String.localeCompare for alphabetic strings or numeric subtraction for numbers.',
  },
  {
    selector: 'CatchClause[body.body.length=0]',
    message:
      'No error is swallowed silently: an empty catch discards the error. Rethrow, log through the seam in src/host/logging/, or add a disable comment stating why silence is intentional.',
  },
  {
    selector:
      'CatchClause[param=null][body.body.length>0]:not(:has(ThrowStatement)):not(:has(CallExpression[callee.object.name="log"])):not(:has(CallExpression[callee.name=/^log[A-Z]/]))',
    message:
      'No error is swallowed silently: this catch never binds the error and neither rethrows nor logs. Bind and handle it, log through the seam in src/host/logging/ (a level method on the seam logger `log`, or a log-prefixed helper), or add a disable comment stating why silence is intentional.',
  },
];

// The probe screens and device-acceptance harnesses report their verdicts to logcat through
// console, off by default behind RUN_*_PROBE flags and never on the product path. Listed one by
// one so the carve-out cannot widen.
const PROBE_SURFACES = [
  'src/host/BridgeProbeScreen.tsx',
  'src/host/StorageProbeScreen.tsx',
  'src/host/VersionStoreProbeScreen.tsx',
  'src/host/bridge/device-acceptance.ts',
  'src/host/storage-engine/device-acceptance.ts',
  'src/host/version-store/device-acceptance.ts',
];

module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:sonarjs/recommended-legacy'],
  rules: {
    'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX],
  },
  overrides: [
    {
      files: ['*.mjs', 'scripts/**/*.js', 'build/**/*.js'],
      env: {
        node: true,
        es2021: true,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    {
      // The house harness (checks/test/harness.ts) asserts via its own
      // assert/assertHasKind/assertNoKind helpers, which S2699 does not recognize.
      files: ['checks/test/**'],
      rules: { 'sonarjs/assertions-in-tests': 'off' },
    },
    {
      // Host code logs only through the seam in src/host/logging/, which redacts; a raw
      // console call would send a prompt or a device id to logcat unredacted.
      files: ['src/host/**/*.ts', 'src/host/**/*.tsx'],
      excludedFiles: ['src/host/**/test/**', 'src/host/logging/**', ...PROBE_SURFACES],
      rules: { 'no-console': 'error' },
    },
    {
      // Device code names contract types but never imports a value: a value import would put the
      // contract package, and zod with it, into the Metro bundle.
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      excludedFiles: ['src/**/test/**'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          { paths: [{ name: '@whim/contract', allowTypeImports: true, message: 'Device code imports @whim/contract with `import type` only.' }] },
        ],
      },
    },
    {
      // System back is subscribed in the two adapters only, so every screen shares one policy.
      files: ['src/host/**/*.ts', 'src/host/**/*.tsx'],
      excludedFiles: ['src/host/**/test/**', 'src/host/launcher/system-back.ts', 'src/host/launcher/useMiniAppHost.ts'],
      rules: {
        'no-restricted-properties': [
          'error',
          { object: 'BackHandler', property: 'addEventListener', message: 'Subscribe to system back through use-system-back / system-back.' },
        ],
      },
    },
    {
      // Release builds run with __DEV__ false, so a bare `__DEV__ ? a : b` ships its developer
      // branch with nothing to override it. __DEV__ is read only as a gate call's argument, e.g.
      // devLogOverlayEnabled(__DEV__) (decision #60(c)).
      files: ['src/host/launcher/**/*.ts', 'src/host/launcher/**/*.tsx'],
      excludedFiles: ['src/host/launcher/test/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...BASE_RESTRICTED_SYNTAX,
          {
            selector: 'Identifier[name="__DEV__"]:not(CallExpression > Identifier.arguments):not(VariableDeclarator > Identifier.id)',
            message: 'Read __DEV__ only as the argument of a gate call, e.g. devLogOverlayEnabled(__DEV__).',
          },
        ],
      },
    },
    {
      // vc-sdk is what mini-apps see; the shell's prose renderer stays on the host side.
      files: ['src/sdk/**/*.ts', 'src/sdk/**/*.tsx'],
      rules: {
        'no-restricted-imports': ['error', { patterns: ['**/whim-prose', '**/whim-prose/*'] }],
      },
    },
  ],
};
