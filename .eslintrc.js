module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:sonarjs/recommended-legacy'],
  rules: {
    'no-restricted-syntax': [
      'error',
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
    ],
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
      // The house greenBy harness (checks/test/harness.ts) asserts via its own
      // assert/assertHasKind/assertNoKind helpers, which S2699 does not recognize.
      files: ['checks/test/**'],
      rules: { 'sonarjs/assertions-in-tests': 'off' },
    },
  ],
};
