// Commitlint config — Conventional Commits with a small project-specific
// type allowlist. See ROADMAP §3 G2 for the full CI rationale.
//
// CommonJS (.cjs) is used intentionally so this file works even when the
// root package.json declares "type": "module" in a future revision.

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed commit types. Conventional defaults + `revert`. We
    // intentionally do NOT add ad-hoc types like `wip` or `tmp`;
    // those should be squashed before merge.
    'type-enum': [
      2,
      'always',
      [
        'feat',     // user-visible feature
        'fix',      // user-visible bug fix
        'docs',     // documentation only
        'style',    // formatting, whitespace, lint config (no logic)
        'refactor', // code change that is neither feat nor fix
        'perf',     // measurable performance improvement
        'test',     // adding or fixing tests
        'build',    // build system, webpack, package.json, dependencies
        'ci',       // GitHub Actions, husky, commitlint, lint configs
        'chore',    // repo hygiene (gitignore, file moves, formatting tooling)
        'revert',   // revert of a previous commit
      ],
    ],

    // Scope is optional for now. Once Theme A renames stabilise we may
    // pin a scope-enum (e.g. `viz`, `dashboards`, `docs`, `ci`).
    'scope-empty': [0],

    // Header soft-limit. Hard limits below.
    'header-max-length': [2, 'always', 100],

    // Body and footer line length — generous enough for the long-form
    // commit messages this repo uses (root-cause + fix + verification).
    'body-max-line-length': [1, 'always', 120],
    'footer-max-line-length': [1, 'always', 120],

    // Subject must be lowercase / sentence-case / start-case is too
    // restrictive for the way we write Splunk-specific subjects (e.g.
    // "BM-FIX-01" or "v1.6.0"). Disable the case rule.
    'subject-case': [0],

    // Conventional default forbids trailing period in subject — keep that.
    'subject-full-stop': [2, 'never', '.'],
  },
};
