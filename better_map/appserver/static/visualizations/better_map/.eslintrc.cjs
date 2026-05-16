// ESLint config — better_map Splunk custom visualization.
//
// Scope: lints src/ only (the AMD entry + lib modules). The webpack
// bundle output (visualization.js) is excluded via .eslintignore.
//
// This config is intentionally conservative for the v1.7 G2 baseline:
// only eslint:recommended rules are enabled, plus a small set of rule
// downgrades that match the code's existing JSDoc-rich, AMD-targeted
// style. Stricter rules (no-console, no-unused-vars upgrade, JSDoc
// completeness) land in a later v1.7 commit once the codebase is
// fully audited.

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: false, // viz runs in the Splunk Web browser, not Node
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  extends: ['eslint:recommended'],
  globals: {
    // Splunk Visualization API globals (loaded by SplunkJS AMD loader,
    // not imported as ES modules — recognised by webpack externals).
    define: 'readonly',
    require: 'readonly',
  },
  rules: {
    // Existing code uses `_unused` and similar leading-underscore names
    // for intentionally-unused arguments (e.g. callback params we don't
    // need). Match Splunk convention.
    'no-unused-vars': [
      'warn',
      {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      },
    ],

    // `console.warn` / `console.error` are used legitimately for the
    // debug HUD and dev-mode error surfaces. Production-bundle
    // console-noise is checked separately in CI (ROADMAP §7b).
    'no-console': 'off',

    // The codebase uses `let x; if (...) x = ...;` patterns extensively;
    // prefer-const is fine but should not block builds yet.
    'prefer-const': 'warn',

    // Empty blocks occur in defensive try/catch around optional features
    // (e.g. WebGL probes). Warn, don't error.
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
};
