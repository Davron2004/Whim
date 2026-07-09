module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="sort"][arguments.length=0]',
        message: 'Pass an explicit comparator to sort(); use String.localeCompare for alphabetic strings or numeric subtraction for numbers.',
      },
    ],
  },
};
