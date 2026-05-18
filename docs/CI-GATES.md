# CI gate inventory

Authoritative reference for every check that fires on a pull request,
on a push to `main`, and on a tagged release. If a gate exists but is
not in this document, that's a bug — open an issue.

## TL;DR

Better Map's CI is built from **three GitHub Actions workflows** that,
together, enforce **~30 distinct gates** across linting, security,
build artefacts, browser compatibility, accessibility, packaging, and
release supply-chain integrity. Every gate has a stated reason, a
known failure mode, and a one-line local-repro command.

| Workflow | Trigger | Job count | Gate count | Runtime budget |
|---|---|---:|---:|---|
| `ci.yml` | every PR + every push to `main` | 4 | 23 | 20 min (lint+build), 12 min (appinspect), 5 min (commitlint), 5 min (docs) |
| `release.yml` | every `v*` tag push | 1 | 17 | 15 min |
| `docs.yml` | every push to `main` touching docs paths + `workflow_dispatch` | 2 | 1 (re-runs MkDocs strict) | 5 min build, 5 min deploy |

The three workflows are intentionally redundant: the PR gate proves
"this change is safe to merge"; the docs deploy gate proves "this
commit's docs render before they go live"; the release gate proves
"this exact tagged artefact passes every quality bar we've ever
defined, including bars stricter than the PR gate." A release MUST
clear the same bar a PR clears — no exceptions.

## Runtime versions

CI pins **Node.js 22** (Active LTS) across every job in `ci.yml` and
`release.yml`. The viz package declares `engines.node: ">=20.12.0"`,
which is the lower bound imposed by `vitest` v4 (its bundled
`rolldown` calls `styleText` from `node:util`, an export landed in
Node 20.12.0 — March 2024). Contributors on Node 18 will see an
`npm install` warning and `npm test` will fail with `SyntaxError:
'styleText' is not exported from 'node:util'` — bump locally to
Node 20.12+ (recommended 22 LTS to match CI).

Python is pinned to **3.11** (matches the Splunk AppInspect virtualenv
and the upstream AppInspect cloud-cert environment).

## Why this document exists

The G2 design (`ROADMAP.md` §3 G2) called out a single ~10-line
"PR pipeline" sentence. In practice the pipeline grew organically
across ~30 separate gates, each living in its own ci.yml step with
its own justification comment. That growth was healthy — every gate
was added in response to a real defect — but the cumulative
inventory drifted away from any single human-readable page. This
document is that page. It is also the source of truth for "is the
release gate at parity with the PR gate?" — a question that came up
during the G2 close-out audit (this PR) and surfaced three
missing-from-release-gate items now fixed.

## Gate matrix

### Workflow: `ci.yml` (every PR + every push to `main`)

#### Job: `lint-and-build`

| # | Gate | Source of truth | Catches | Local repro |
|--:|---|---|---|---|
| 1 | ESLint | `npm run lint` | JS style / dead-code / dangerous-construct violations in `src/lib/**/*.js` | `cd better_map/appserver/static/visualizations/better_map && npm run lint` |
| 2 | Version consistency (REL-1) | `scripts/check-version-consistency.js` | `app.conf` / `package.json` / `HUD_VERSION` drift between the three version sources | `node scripts/check-version-consistency.js` |
| 3 | JS↔CSS contract (G8) | `scripts/lint-js-css-contract.js` | BM-FIX class regression: a JS-created `better_map-*` class with no matching CSS rule (silent invisibility bug) | `cd better_map/appserver/static/visualizations/better_map && npm run lint:css-contract` |
| 4 | Dashboard XML + Studio JSON (Q-1) | `scripts/check-dashboard-xml-json.py` | Typo'd CDATA closing tag, missing brace inside Dashboard Studio JSON, unescaped `&` in `<label>` | `python3 scripts/check-dashboard-xml-json.py` |
| 5 | Dashboard ↔ widget token contract (Q-1B) | `scripts/check-dashboard-tokens.py` | SPATIAL-1 class regression: a dashboard references `$better_map.*$` token but no widget produces it | `python3 scripts/check-dashboard-tokens.py` |
| 6 | Release manifest drift (G3) | `scripts/check-manifest.py` | Orphan-file accumulation across `update=true` REST installs (manifest must match source tree byte-for-byte) | `python3 scripts/check-manifest.py` |
| 7 | Formatter schema drift (G7) | `scripts/check-formatter-schema.py` | Schema drifts from `formatter.html` — AI agents consuming the schema would set non-existent options | `python3 scripts/check-formatter-schema.py` |
| 8 | Formatter schema coverage (G7) | `scripts/check-formatter-coverage.py` | HTML→schema or schema→HTML gaps + duplicate-`data-name` transparency | `python3 scripts/check-formatter-coverage.py` |
| 9 | **D3 accessibility audit** | `scripts/check-accessibility.js` | WCAG 2.2 AA violations in `formatter.html` (loaded in headless Chromium with axe-core) | `cd better_map/appserver/static/visualizations/better_map && npm run lint:a11y` |
| 10 | **D2 browser-compat (Phase 1 + Phase 1.5)** | `scripts/check-browser-compat.js` | (a) `formatter.html` rejected by WebKit / Firefox; (b) `visualization.js` AMD-eval fails in WebKit / Firefox (webpack target slipped to ES2020+) | `cd better_map/appserver/static/visualizations/better_map && npm run lint:browser-compat` |
| 11 | npm audit (G1) | `scripts/check-npm-audit.py` | Runtime-dep CVEs at severity `high` or `critical` without an in-date waiver | `python3 scripts/check-npm-audit.py` |
| 12 | License allowlist (G1) | `scripts/check-license-allowlist.py` | Copyleft (or unknown) transitive dep that would block Splunkbase / enterprise legal review | `python3 scripts/check-license-allowlist.py` |
| 13 | OSV-Scanner (G1) | `scripts/check-osv-report.py` | Vulnerability second-opinion vs npm-audit, same waiver file, same severity bar | (CI-only — needs OSV-Scanner binary on `$PATH`) |
| 14 | Vitest unit tests (T-1) | `npm test` | Regression in `popupSanitizer.js` (71-case security-critical suite) and any later-added test files | `cd better_map/appserver/static/visualizations/better_map && npm test` |
| 15 | Webpack production build | `npm run build` | Build failure: missing entry, broken loader, OOM, etc. | `cd better_map/appserver/static/visualizations/better_map && npm run build` |
| 16 | Production-bundle console noise (Q-2) | `scripts/check-bundle-console-noise.js` | Raw `console.log` / `console.debug` shipped to production OR allowlisted-warn count drifts over budget | `cd better_map/appserver/static/visualizations/better_map && npm run lint:console-noise` |
| 17 | Bundle-size budget (Q-3) | `scripts/check-bundle-size.js` | `visualization.js` raw > 3.0 MB OR gzipped > 800 KB OR `visualization.css` > 100 KB (cold-start performance contract) | `cd better_map/appserver/static/visualizations/better_map && npm run lint:bundle-size` |
| 18 | Sanity check build artefacts | inline `bash` | Webpack produced a zero-byte bundle or skipped CSS emission | (inline only) |

#### Job: `appinspect`

| # | Gate | Source of truth | Catches | Local repro |
|--:|---|---|---|---|
| 19 | Splunk AppInspect (cloud + future tags) | `splunk-appinspect` via `scripts/check-appinspect-results.py` | Cloud-vetting failures (35-check baseline) + advance-warning of future-failure checks Splunkbase will start enforcing | `cd better_map/appserver/static/visualizations/better_map && npm run lint:appinspect` |

#### Job: `commitlint`

| # | Gate | Source of truth | Catches | Local repro |
|--:|---|---|---|---|
| 20 | Conventional Commits | `@commitlint/cli@^19` against `.commitlintrc.cjs` | Commit subject lines that violate the Conventional Commits contract (auto-changelog generation breaks otherwise) | `npx --no -- commitlint --from <base> --to HEAD --config .commitlintrc.cjs` |

#### Job: `docs-build`

| # | Gate | Source of truth | Catches | Local repro |
|--:|---|---|---|---|
| 21 | Recipe schema + index (E5) | `scripts/check-recipe-schema.py` | Frontmatter / SPL fence / formatter-JSON contract violations + `_machine/recipes/index.yaml` drift | `python3 scripts/check-recipe-schema.py` |
| 22 | `docs/llms.txt` drift (G7 Phase 2) | `scripts/build-llms-txt.py --check` | LLM site-index drift from the four structured sources of truth | `python3 scripts/build-llms-txt.py --check` |
| 23 | `docs/llms-full.txt` drift + token budget (G7 Phase 2 follow-up) | `scripts/build-llms-full-txt.py --check` | Body-inclusive drift + hard 200k-token / soft 150k-token budget breach | `python3 scripts/build-llms-full-txt.py --check` |
| 24 | Auto-generated reference pages (E2 Phase 2) | `scripts/build-reference-pages.py --check` | Drift in the 3 managed regions (formatter-enumeration, integrations-matrix, recipes-matrix) | `python3 scripts/build-reference-pages.py --check` |
| 25 | MkDocs strict build (E2 Phase 1) | `mkdocs build --strict` | Broken cross-link, orphan markdown file, deprecated config key, missing snippet path | `.venv-mkdocs/bin/mkdocs build --strict` |

### Workflow: `release.yml` (every `v*` tag push)

#### Job: `build-and-release`

The release workflow re-runs every gate from `lint-and-build` that
asserts something about the artefact being shipped, plus adds three
release-only contracts (SBOM, cosign signature, GitHub Release
publication). The full list, in execution order:

| # | Gate | Stricter than PR gate? | Notes |
|--:|---|:-:|---|
| 1 | Version consistency vs tag (REL-1) | yes (`--tag`) | All four sources (app.conf launcher version + build + package.json + HUD_VERSION) MUST equal the tag |
| 2 | ESLint | no | identical |
| 3 | JS↔CSS contract (G8) | no | identical |
| 4 | Dashboard XML + Studio JSON (Q-1) | no | identical |
| 5 | Dashboard ↔ widget token contract (Q-1B) | no | identical |
| 6 | Release manifest drift (G3) | no | identical |
| 7 | Formatter schema drift (G7) | no | identical |
| 8 | Formatter schema coverage (G7) | no | identical |
| 9 | npm audit (G1) | yes (re-evaluates waiver expiry) | A waiver valid at PR-merge may have expired by tag time (cap = 90 days) |
| 10 | License allowlist (G1) | no | identical |
| 11 | OSV-Scanner (G1) | no | identical, shared waiver file |
| 12 | **Vitest unit tests (T-1)** ✅ added by G2 close-out audit | no | identical to PR-gate Vitest run |
| 13 | Webpack production build | no | identical |
| 14 | Production-bundle console noise (Q-2) | no | identical |
| 15 | Bundle-size budget (Q-3) | no | identical |
| 16 | **D3 accessibility audit** ✅ added by G2 close-out audit | no | identical to PR-gate D3 run; reuses cached Playwright |
| 17 | **D2 browser-compat (Phase 1 + Phase 1.5)** ✅ added by G2 close-out audit | no | identical to PR-gate D2 run; reuses cached Playwright |
| 18 | App tarball staging + smoke checks | n/a | New gates: no macOS forks, single top-level dir, no `node_modules`, no `src/`, `visualization.js` present |
| 19 | Splunk AppInspect cloud + future | yes (`--fail-on-warnings`) | PR gate allows informational warnings; release does NOT |
| 20 | CycloneDX SBOM emission (G1) | n/a | New gate: SBOM validates against CycloneDX 1.6 schema |
| 21 | cosign keyless sign + verify (G1) | n/a | New gate: round-trip verify before publishing |
| 22 | GitHub Release publication (REL-1) | n/a | `--verify-tag` ensures we publish the exact tag the workflow was triggered by |

### Workflow: `docs.yml` (push to `main` + `workflow_dispatch`)

| # | Gate | Source of truth | Catches | Notes |
|--:|---|---|---|---|
| 1 | MkDocs strict build (re-run) | `mkdocs build --strict` | Same as ci.yml docs-build #25 | Belt-and-braces — ci.yml already proved the build on the PR that produced this commit; this gate stops a known-broken site from being published |

## Defense-in-depth posture

Three sentinels prove the artefact-of-record is safe to ship:

1. **PR gate** (`ci.yml`) — every change must pass before merge.
   A reviewer who approves a PR sees a green check that represents
   all 25 gates in the PR-time matrix.
2. **Push-to-main gate** (`ci.yml` re-fires on push) — the merge
   commit on `main` must also pass. This catches the rare case
   where a fast-forward merge surfaces a conflict-driven regression
   that didn't appear in the PR branch.
3. **Tag gate** (`release.yml`) — the tarball that goes to
   Splunkbase MUST clear every PR gate AND the release-strict
   bars (REL-1 tag verify, AppInspect `--fail-on-warnings`, SBOM
   validation, cosign signing). A tag created from a commit that
   somehow bypassed the PR gate still cannot ship without satisfying
   the release gate.

The PR-gate ↔ release-gate parity is intentional and audited every
time this document is updated. Three runtime gates (D2, D3, Vitest)
were SHIPPED in the PR gate before the G2 close-out audit but not in
release.yml — that gap was closed as part of the audit and is the
defining outcome of this PR.

## Known gaps

| # | Gap | Stakes | Tracking |
|--:|---|---|---|
| 1 | Docs gates (recipe schema, llms.txt, llms-full.txt, reference-pages, MkDocs strict) are in `ci.yml` and `docs.yml` but NOT in `release.yml` | LOW — docs are not shipped in the release tarball (`rsync --exclude='docs'`); they live on GitHub Pages, which is gated by `docs.yml` on push-to-main, which precedes every tag. A tag from a non-main commit could theoretically ship with stale docs already on Pages, but the tag itself doesn't change what's on Pages. | Tracked as a `release.yml` follow-up; not in scope for the G2 close-out audit because the docs aren't in the release artefact |
| 2 | Live dispatch test (D5 Phase 2) is in neither PR gate nor release gate | MEDIUM — would catch "the bundle loads but the data pipeline silently drops events" | ROADMAP §3 D5 Phase 2; blocked on a self-hosted-runner decision |
| 3 | Cross-OS browser-compat (D2 Phase 2) is Linux-only in PR + release gates | MEDIUM — covers ~99 % of real browsers via the three engine families on Linux, but doesn't catch macOS-Safari-specific or Windows-Edge-specific bugs | ROADMAP §3 D2 Phase 2; same self-hosted-runner blocker as #2 |
| 4 | `splunk-appinspect` runs locally via `npm run lint:appinspect` but is not on `lint-and-build` job timing budget for the PR gate (lives in its own `appinspect` job) | n/a — by design (parallelism + retry isolation) | working as intended |

## Reading a failing CI run

The two most useful pieces of information when a gate fails:

1. **The step name.** GitHub Actions surfaces it in the run UI and
   in PR check rollups. Match it against the # column in the tables
   above to find the gate's source of truth + local-repro command.
2. **The uploaded artefact.** Every JSON-emitting gate uploads its
   full report as an artefact (browser-compat, accessibility,
   AppInspect, OSV-Scanner) with 14-day retention. Download it
   from the Actions run page, inspect locally — the inline log
   truncates lists at 5 entries per category.

Per-gate troubleshooting guides:

- **D2 browser-compat** — `docs/COMPAT-MATRIX.md` "Reading a failing
  run" (separate tables for formatter failures vs bundle AMD failures)
- **D3 accessibility** — `docs/_machine/agents.md` "Common mistakes"
  table, D3 row
- **AppInspect** — `docs/runbooks/appinspect-triage.md`
- **G1 supply-chain (npm audit, license, OSV)** — `docs/runbooks/supply-chain.md`
- **G3 manifest drift** — `docs/runbooks/upgrade-hygiene.md`
- **G8 JS↔CSS contract** — `scripts/lint-js-css-contract.js` header
  block + `scripts/css-contract-allowlist.json` justifications

## Updating this document

This document is hand-maintained but assertable: a one-page summary
that lists every gate currently wired into the workflow YAML.
When you add a gate:

1. Add a step to the relevant workflow file (`ci.yml` and/or
   `release.yml`).
2. Add a row to the matrix above with the source of truth, the
   failure mode, and the local repro.
3. If the gate adds a release-only contract (SBOM, signature, etc.),
   add a row to the §2 release matrix too.
4. Run the PR-gate locally end-to-end before opening the PR (see
   `docs/_machine/agents.md` §7 pre-commit checklist).

A future Phase-2 cut may auto-generate this matrix from a YAML
manifest under `docs/_machine/ci-gates.yaml`. Until then, the
hand-maintained matrix is the contract.

## See also

- [ROADMAP §3 G2 — CI/CD infrastructure](roadmap.md) — design + status
- [ROADMAP §3 G8 — JS↔CSS contract lint](roadmap.md) — design + status
- [ROADMAP §3 D1 — AppInspect re-cert](roadmap.md) — design + status
- [ROADMAP §3 G1 — Security audit + supply-chain hardening](roadmap.md)
- [ROADMAP §7b — Quality checklist](roadmap.md) — high-level project
  invariants the gates protect
- [`docs/COMPAT-MATRIX.md`](COMPAT-MATRIX.md) — D2 customer-facing matrix
- [`docs/_machine/agents.md`](_machine/agents.md) — pre-commit checklist
  + common-mistakes table
- [`docs/runbooks/upgrade-hygiene.md`](runbooks/upgrade-hygiene.md) — G3 operator workflow
- [`docs/runbooks/supply-chain.md`](runbooks/supply-chain.md) — G1 verification flow
