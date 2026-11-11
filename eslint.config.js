// `npm run lint`: catches names used but never defined (a typo, or something lost in
// a move between files) and code left unused, in the server and the tests.
// The app's own files (public/js) share one scope across files, which this
// check can't follow; the browser tests cover them.
const globals = require('globals');

module.exports = [
  {
    files: ['server.js', 'src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-dupe-else-if': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
];
