---
title: Contributing
description: >-
  Development workflow, the five non-negotiable invariants, the
  pre-commit checklist, the conventional-commits-driven release
  flow.
---

# Contributing

Better Map is an MIT-licensed open-source project. Contributions
(human or AI-agent) are welcome and follow a strict workflow because
the viz is in production at multiple customer sites and a regression
is expensive.

## The operating manual

Read [`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md)
end-to-end before your first commit. It is the canonical operating
manual — the five non-negotiables, where things live, the runtime
envelope, the pre-commit checklist, and the common-mistakes table.

This page is the human-friendly summary; `agents.md` is the
ground truth.

## The five non-negotiables

CI will reject your PR if you violate any of these. They exist
because past contributors broke them, not because they're
nice-to-haves.

1. **Never edit `formatter-schema.json` by hand.** Regenerate via
   `scripts/build-formatter-schema.py`.
2. **Never edit `better_map/default/_better_map_manifest.json` by
   hand.** Regenerate via `scripts/build-manifest.py`.
3. **Every `better_map-*` CSS class created in JS must have a rule
   in `visualization.css`** or an allowlist entry. (BM-FIX class of
   bug.)
4. **Every `$better_map.*$` token referenced in a dashboard must be
   emitted by a widget in `src/lib/**/*.js`** and vice-versa.
   (SPATIAL-1 class of bug.)
5. **BM-CT-1:** every integration / layer / widget exposes
   `setEnabled(bool)`, `isEnabled()`, `reset()`. See
   [BM-CT-1 reference](reference/bm-ct-1.md).

## Branch + commit + PR workflow

1. **Branch:** `git checkout -b feat/<short-id>-<slug>` (e.g.
   `feat/d3-axe-core-ci`). Conventional commit prefix matches the
   theme (`feat`, `fix`, `chore`, `docs`, `ci`).
2. **Implement.** Edit completely across all affected files in one
   pass. No half-finished states on disk.
3. **Local verify** (see the [pre-commit checklist
   below](#pre-commit-checklist)).
4. **Commit** with a detailed [conventional-commits](https://www.conventionalcommits.org/)
   body. Use a HEREDOC to preserve newlines. Reference the ROADMAP
   item ID in the trailer (`Refs ROADMAP §3 D3`).
5. **Push + PR:**

    ```bash
    git push -u origin HEAD
    gh pr create --title "<conventional>" --body "..."
    ```

6. **Wait for CI** (`gh pr checks <num>` — three jobs must say
   `pass`). If anything fails, fix it on the SAME branch with a new
   commit and re-push; do NOT amend after the PR is open.
7. **Merge:** `gh pr merge <num> --rebase --delete-branch`.
8. **Sync local main** and pick the next item.

## Pre-commit checklist

The full checklist is in
[`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md)
§7. The condensed version, runnable from the repo root:

```bash
# Formatter contracts
python3 scripts/check-formatter-schema.py
python3 scripts/check-formatter-coverage.py

# Manifest
python3 scripts/check-manifest.py

# Dashboard tokens (SPATIAL-1) + XML/JSON validity
python3 scripts/check-dashboard-tokens.py
python3 scripts/check-dashboard-xml-json.py

# Supply chain (G1)
python3 scripts/check-npm-audit.py
python3 scripts/check-license-allowlist.py

# JS/CSS contract (BM-FIX + BM-CT-1)
node scripts/lint-js-css-contract.js

# Accessibility (D3 — axe-core on formatter.html)
# First run only:
#   cd better_map/appserver/static/visualizations/better_map
#   npx playwright install chromium
node scripts/check-accessibility.js

# If you touched the viz bundle:
cd better_map/appserver/static/visualizations/better_map
npm ci && npm run build
node ../../../../../scripts/check-bundle-size.js
node ../../../../../scripts/check-bundle-console-noise.js
node ../../../../../scripts/check-version-consistency.js
```

## Where things live

| Surface | Path |
|---|---|
| Viz JS source | `better_map/appserver/static/visualizations/better_map/src/` |
| Viz formatter HTML | `better_map/appserver/static/visualizations/better_map/formatter.html` |
| Showcase dashboards | `better_map/default/data/ui/views/*.xml` |
| App configuration | `better_map/default/*.conf` |
| Splunk app metadata | `better_map/default/app.conf`, `better_map/metadata/default.meta` |
| Machine-readable docs | `docs/_machine/**` |
| Human docs (this site) | `docs/**` (except `docs/_machine/`) |
| CI gates | `scripts/check-*.{py,js}` |
| CI workflows | `.github/workflows/{ci.yml,release.yml}` |
| Roadmap | `ROADMAP.md` (and `docs/roadmap.md` mirrors §3) |

## Adding a new formatter option

1. Add the control to `formatter.html` with `data-name="newOption"`.
2. Regenerate the schema:
   `python3 scripts/build-formatter-schema.py`.
3. Read the value in JS via
   `getOption(config, ns, 'newOption', default)`.
4. Add a Splunk spec entry to
   `better_map/README/savedsearches.conf.spec`.
5. Run `python3 scripts/check-formatter-coverage.py` — it will
   fail if any step is missing.

## Adding a new integration

1. Author the YAML under
   `docs/_machine/integrations/<name>.yaml` (use an existing one as
   a template; the schema is enforced at parse time).
2. Add the JS adapter under
   `src/lib/integrations/<name>.js` (must satisfy
   [BM-CT-1](reference/bm-ct-1.md)).
3. Update the [integration catalogue](integrations/catalogue.md)
   here.
4. Regenerate the manifest:
   `python3 scripts/build-manifest.py`.

## Release flow

Releases are cut from `main` via
[`.github/workflows/release.yml`](https://github.com/fenre/better_map/blob/main/.github/workflows/release.yml).
The workflow:

1. Bumps the version per [semver](https://semver.org/) using the
   conventional-commits log since the previous tag.
2. Runs the full CI gate set.
3. Builds the Splunk app tarball.
4. Generates a **CycloneDX 1.6 SBOM** of the runtime npm tree.
5. Signs the tarball with **cosign keyless** (GitHub Actions OIDC
   identity).
6. Publishes the tarball, SBOM, signature, and certificate to the
   GitHub release.

Verification recipe: [air-gapped deployment](air-gapped.md).

## See also

- [`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md)
  — the operating manual.
- [Runtime envelope](runtime-envelope.md) — what the viz is allowed
  to do.
- [Performance](performance.md) — the PR-gating budget.
- [Roadmap](roadmap.md) — what's open, what's shipped.
