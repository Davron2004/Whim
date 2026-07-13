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
