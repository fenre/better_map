<!-- SPDX-License-Identifier: MIT -->
<!-- Source of truth: this file. Do NOT regenerate; hand-maintained. -->
<!--
  This file is the operator manual for AI agents working on the
  better_map repo itself. It is intentionally short and link-rich.
  When in doubt, FOLLOW THE LINKS — do not paraphrase, do not invent.
-->

# Agent operating guide — better_map

> If you're an AI agent (Cursor, Claude Code, Copilot, Codex, Splunk AI
> Assistant, etc.) about to edit this repository, **read this file first**.
> It encodes the invariants that the CI gates enforce and the rules
> that exist precisely because past contributors broke them.

---

## 1. The five non-negotiables

| # | Rule | Enforced by |
|---|---|---|
| 1 | **No edits to `formatter-schema.json` by hand.** Regenerate from `formatter.html` via `scripts/build-formatter-schema.py`. | `scripts/check-formatter-schema.py` (drift gate) + `scripts/check-formatter-coverage.py` (coverage gate) — both run on every PR |
| 2 | **No edits to the deployed-file manifest by hand.** Regenerate via `scripts/build-manifest.py`. | `scripts/check-manifest.py` |
| 3 | **Every `better_map-*` CSS class created in JS MUST have at least one rule in `visualization.css`** OR an entry in `scripts/css-contract-allowlist.json`. This is the BM-FIX class of bug (control-panel toggles look dead because widgets render behind the MapLibre canvas). | `scripts/lint-js-css-contract.js` |
| 4 | **Every `$better_map.*$` token referenced in a dashboard MUST be emitted by a widget in `src/lib/**/*.js`**, and vice-versa. This is the SPATIAL-1 class of bug (widget emits to `bm_spatial_filter`, dashboard consumes `$better_map.spatial_query$` — silent zero results). | `scripts/check-dashboard-tokens.py` |
| 5 | **BM-CT-1 contract: every Splunk integration, layer, and widget MUST expose `setEnabled(bool)`, `isEnabled()`, and `reset()`.** Reset must restore the panel to its documented initial state in ≤ 400 ms. | Convention + future Playwright assertion (D5) |

If you break any of these the PR pipeline will fail with a precise
remediation message. Read the message; it tells you the exact script to
run.

---

## 2. Where things live

### 2a. The visualization itself

```text
better_map/appserver/static/visualizations/better_map/
├── formatter.html                  ← UI for the formatter panel (SOURCE OF TRUTH for options)
├── visualization.css               ← every better_map-* class MUST live here
├── visualization_source.js         ← AMD entrypoint (transpiled to visualization.js)
├── webpack.config.js               ← single-bundle AMD config (es5 target, see §3)
├── visualizations.conf             ← Splunk registration stanza
├── src/
│   ├── lib/
│   │   ├── splunk/                 ← 8 integration modules (one per Theme C scaffold)
│   │   │   ├── itsi.js  soar.js  rba.js  aiGeo.js
│   │   │   ├── mitre.js esNotable.js purdue.js aiAssistant.js
│   │   │   ├── correlationSearchBuilder.js  rest.js  index.js
│   │   ├── layers/                 ← MapLibre layer adapters (markers, hexbin, …)
│   │   ├── widgets/                ← UI controls (spatialQuery, brushing, drawTools, …)
│   │   ├── analytics/              ← spatial algorithms (DBSCAN, KDE, Getis-Ord, LISA)
│   │   ├── basemaps/               ← PMTiles loader + tile pipeline
│   │   ├── time/                   ← time scrubber
│   │   └── …                       ← controlPanel, theme, palettes, mapBuilder, …
│   └── styles/                     ← (rare — most CSS lives in visualization.css)
└── .npmrc                          ← deterministic-build settings (engines-strict, save-exact)
```

### 2b. The Splunk app shell

```text
better_map/                         ← the app root that ships to Splunk
├── default/
│   ├── app.conf                    ← version is the source of truth (see §6 release flow)
│   ├── visualizations.conf
│   ├── data/ui/
│   │   ├── nav/default.xml
│   │   └── views/*.xml             ← Dashboard Studio v2 JSON inside CDATA
│   └── …
├── metadata/default.meta
└── README/savedsearches.conf.spec  ← formatter property specs (mirrors formatter.html)
```

### 2c. CI, docs, scripts

```text
.github/
├── workflows/ci.yml                ← PR pipeline
├── workflows/release.yml           ← tag-triggered release (signs with cosign, ships SBOM)
└── dependabot.yml                  ← weekly npm + github-actions updates

docs/
├── _machine/                       ← G7 machine-readable docs (this file lives here)
│   ├── README.md                   ← contract for the _machine layer
│   ├── agents.md                   ← you are here
│   ├── formatter-schema.json       ← generated from formatter.html
│   └── integrations/*.yaml         ← one file per Splunk integration
└── runbooks/
    ├── supply-chain.md             ← SBOM / cosign / OSV / waiver procedures
    └── upgrade-hygiene.md          ← orphan-file detection on long-lived installs

scripts/                            ← CI gates + build/release helpers + runbooks
```

---

## 3. Build & runtime envelope (binding)

These constraints come from `ROADMAP.md` §1a and ALL apply:

1. **Single AMD bundle.** `webpack.config.js` outputs ONE `visualization.js`
   with `target: ['web', 'es5']` and `output.environment.arrowFunction:
   false`. No dynamic `import()`, no Service Workers, no extra script
   tags.
2. **Splunk Cloud CSP is centrally managed.** `script-src 'self'
   'unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`.
   Workers ship as same-origin URLs. Basemap tiles must come via an
   allow-listed CDN or PMTiles inside the app.
3. **No external fetches except basemap tiles + air-gapped PMTiles + the
   integrations declared in `docs/_machine/integrations/*.yaml`.** The
   AI Assistant scaffold (`aiAssistant.yaml`) routes through
   `Splunk_AI_Assistant_Cloud`, not directly to an LLM API.
4. **No iframes pointing outside Splunk.** Drilldowns open new tabs
   within the Splunk app.
5. **No reliance on Dashboard Studio v3 `core.*` keys.** Splunk silently
   ignores the AMD bundle and shows a grey placeholder.

If you're about to break any of these, stop and re-read the table in
ROADMAP.md §1a.

---

## 4. Adding a new formatter option (the right way)

The formatter is rendered by Splunk from `formatter.html`. The schema in
`docs/_machine/formatter-schema.json` is **derived** — never edit it
directly.

1. Add the control to `formatter.html`. Every input/select MUST carry a
   unique `data-name="<camelCase>"` attribute and a `<p>` of help text.
2. Add the matching `savedsearches.conf.spec` line under
   `README/savedsearches.conf.spec`.
3. Read the option in `visualization_source.js` (or wherever the
   relevant layer lives) via the
   `display.visualizations.custom.better_map.better_map.<name>`
   property path. Helper getters already exist in `src/lib/`.
4. Run `python3 scripts/build-formatter-schema.py` and commit the
   updated `docs/_machine/formatter-schema.json`.
5. Run `python3 scripts/build-reference-pages.py` and commit the
   regenerated `docs/reference/formatter.md`. The new option's row
   (with type, default, enum / range, and the help text) appears in
   the `Full option enumeration` section, inside the
   `formatter-enumeration` managed region. Narrative outside the
   markers is hand-authored and survives re-generation.
6. Run `python3 scripts/build-llms-txt.py` and
   `python3 scripts/build-llms-full-txt.py`, then commit both
   `docs/llms.txt` and `docs/llms-full.txt`. The short index embeds
   the option count and a link to the formatter-schema; the
   body-inclusive sibling expands every page on the site (including
   the auto-generated reference page you just regenerated). Both
   are byte-for-byte drift-gated in CI.
7. Local sanity check:

   ```bash
   python3 scripts/check-formatter-schema.py
   python3 scripts/check-formatter-coverage.py
   python3 scripts/build-reference-pages.py --check
   python3 scripts/build-llms-txt.py --check
   python3 scripts/build-llms-full-txt.py --check
   ```

   All four must print `[PASS]`.

> **Duplicate `data-name`s:** the parser handles them via
> "last-write-wins" and records the conflict in
> `x-meta.known-issues.duplicate-data-names` of the schema. This is
> *not* a feature — it's a documented escape hatch. As of v1.7 D3
> the only legacy duplicate (`highContrast`) was removed (the
> duplicate `<select>` triggered axe-core `duplicate-id-aria` and
> `form-field-multiple-labels` findings; the canonical control lives
> in `Data configurations > Accessibility & localization`). The
> escape hatch remains in the parser as a safety net, but the
> `duplicate-data-names` list MUST be empty going forward — adding
> a new duplicate fails the `check-formatter-coverage.py` gate AND
> the `check-accessibility.js` gate (the `duplicate-id-aria` rule
> catches the matching `id`/`for` collision). Fix by renaming, not
> ratifying.

---

## 5. Adding a new Splunk integration (Theme C)

1. Create `src/lib/splunk/<id>.js`. Export at minimum: `configure()`,
   `setEnabled(bool)`, `isEnabled()`, `reset()` and the public
   helpers documented in the corresponding YAML.
2. Re-export from `src/lib/splunk/index.js` (alphabetical block).
3. Author `docs/_machine/integrations/<id>.yaml` with the schema used by
   the eight existing files (`itsi.yaml` is the canonical reference).
   Fields: `meta`, `id`, `display_name`, `status` (`experimental` |
   `verified` | `production`), `splunk_app_required`,
   `splunk_version_min`, `endpoints_called`, `auth_required`,
   `field_contract`, `tested_against`, `bm_ct_1`, `references`.
4. If the integration touches an OT/ICS asset, read
   `/.cursor/rules/ot-safety.mdc` and reflect Rules 1, 2, 5, 6 in
   the YAML's `ot_safety` block (see `purdue.yaml` for the canonical
   example).
5. `status: experimental` is the default until the integration is
   smoke-tested against a live Splunk tenant. Setting `tested_against`
   to a non-null value is the trigger for `status: verified`.
6. Run the three regenerators (one auto-managed reference page +
   both llms files):

   ```bash
   python3 scripts/build-reference-pages.py # integrations matrix in catalogue.md
   python3 scripts/build-llms-txt.py        # short index
   python3 scripts/build-llms-full-txt.py   # body-inclusive sibling
   python3 scripts/build-reference-pages.py --check
   python3 scripts/build-llms-txt.py --check
   python3 scripts/build-llms-full-txt.py --check
   ```

   The new integration appears in THREE places that all derive from
   the same `docs/_machine/integrations/<id>.yaml` source of truth:

   - `docs/integrations/catalogue.md` — a new row in the
     `Integration matrix at a glance` section (the auto-managed
     region between `<!-- BEGIN AUTOGEN: integrations-matrix -->`
     and the matching `END` marker), AND a new `#### <id>` block in
     the `Endpoint detail` subsection. The hand-authored prose
     blocks (one `##` heading per integration, below the markers)
     are NOT auto-managed — author them by hand using the existing
     blocks as the template.
   - `docs/llms.txt` — under `## Integrations (Splunk)` with
     display name, status, required Splunk app, JS source path.
   - `docs/llms-full.txt` — under Appendix A with endpoints,
     field-contract keys, BM-CT-1 slot mapping and references, AND
     the auto-managed matrix above is now part of the inlined
     `catalogue.md` page body.

   Commit all four regenerated files (`catalogue.md`, `llms.txt`,
   `llms-full.txt`, and any updated `formatter.md` if you also
   touched the formatter) in the same PR. All three CI drift gates
   (`build-reference-pages.py --check`,
   `build-llms-txt.py --check`, `build-llms-full-txt.py --check`)
   will reject any drift.

---

## 5b. Adding a new per-source recipe (Theme E — E5 Phase 1)

A recipe is a single Markdown file documenting how to wire ONE Splunk
source pattern into ONE Better Map layer end-to-end (SPL + formatter
config + expected fields + gotchas). The CI gates enforce a strict
six-section structure so AI agents and humans can consume them with
the same expectations. Source of truth:
[`docs/_machine/recipes/recipe-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/recipes/recipe-schema.json).

1. **Create the file at the canonical path**

   ```bash
   mkdir -p docs/recipes/<source-id>
   cp docs/recipes/kvstore-latlon/markers.md \
      docs/recipes/<source-id>/<layer-id>.md
   ```

   `<source-id>` MUST be one of the enum values in `recipe-schema.json
   #/properties/source/properties/id/enum`. `<layer-id>` MUST be one of
   the ten core layer types (see
   `recipe-schema.json#/properties/layer/properties/id/enum`).

2. **Update the YAML frontmatter.** Every key in the schema is
   required; the path-derived id contract is:

   - `id`: `<source-id>--<layer-id>` (literal — the validator
     enforces this).
   - `source.id`: `<source-id>` (same as parent directory).
   - `layer.id`: `<layer-id>` (same as filename stem).
   - `expected_fields`: every field name the SPL produces, with type
     and example. The validator cross-checks that each name appears
     as a row in the §3 markdown table.
   - `required_formatter_options`: every option the §4 JSON sets. The
     validator cross-checks that each entry is a real property in
     `formatter-schema.json` AND that the §4 JSON sets exactly those
     options (no more, no fewer).
   - `status`: start at `unverified`. Promote to `verified` only after
     dispatching the SPL against a real Splunk tenant; you MUST also
     populate `verified_against` in the same edit.
   - `ot_safety_relevant`: per
     [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc).
     If `true`, the §6 Gotchas section MUST mention "OT safety" or
     "safety_related" (the validator checks).

3. **Write the six canonical sections, in order:**

   1. `## 1. Source description` — what produces the data, typical
      sourcetype / index, required add-ons.
   2. `## 2. SPL recipe` — a single ```spl``` fence. Every pipe MUST
      start its own physical line (the SPL Pipe-Per-Line Rule;
      the validator enforces it).
   3. `## 3. Expected fields` — a Markdown table whose first column
      is the field name. Every `expected_fields[*].name` from the
      frontmatter MUST appear here.
   4. `## 4. Recommended formatter config` — a single ```json``` fence
      with the minimum formatter options for the recipe. The keys
      MUST match `required_formatter_options` from the frontmatter
      exactly (sets are equal).
   5. `## 5. Screenshot` — placeholder until the D5 Splunk Docker
      compose harness lands.
   6. `## 6. Gotchas` — failure modes, data-shape sharp edges, OT
      safety notes if applicable.

4. **Regenerate the machine-readable indexes AND run the validators:**

   ```bash
   python3 scripts/build-recipe-index.py            # _machine/recipes/index.yaml
   python3 scripts/check-recipe-schema.py           # frontmatter + body + index drift
   python3 scripts/build-reference-pages.py         # recipes-matrix region in docs/recipes/index.md
   python3 scripts/build-llms-txt.py                # short index
   python3 scripts/build-llms-full-txt.py           # body-inclusive sibling
   python3 scripts/build-reference-pages.py --check
   python3 scripts/build-llms-txt.py --check
   python3 scripts/build-llms-full-txt.py --check
   ```

   The recipe check-script re-runs `build-recipe-index.py` under the
   hood and compares byte-for-byte against the on-disk
   `_machine/recipes/index.yaml` — drift means you added a recipe but
   forgot to commit the regenerated index. The new recipe THEN appears
   in FOUR places, all derived from the same frontmatter:

   - `docs/recipes/index.md` — a new row in the `recipes-matrix`
     managed region (status, source pattern, layer, apps, field
     count, formatter options, OT-safety flag, last-verified date).
     Rendered by `build-reference-pages.py` from
     `_machine/recipes/index.yaml`. The hand-authored
     `## The recipe contract`, `## Where to read more`, and other
     prose sections OUTSIDE the markers are preserved verbatim.
   - `docs/_machine/recipes/index.yaml` — flattened frontmatter
     under `recipes[]`.
   - `docs/llms.txt` — under `## Recipes (per-source playbooks)`
     with display name, status, source pattern, layer, apps.
   - `docs/llms-full.txt` — under Appendix B (status, required
     apps, expected-fields summary) AND the page body appears under
     its `# === BEGIN: <url> ===` block (the script walks the same
     `mkdocs.yml` `nav:` the short-index generator does).

   Commit all five regenerated files in the same PR. All three CI
   drift gates (`build-reference-pages.py --check`,
   `build-llms-txt.py --check`, `build-llms-full-txt.py --check`)
   plus `check-recipe-schema.py` will reject any drift.

5. **(If possible) verify against a live tenant**, then flip
   `status: unverified` → `status: verified`, populate
   `verified_against`, and submit the same PR. A maintainer with
   `secrets.env` REST access against `rev` can do this in seconds; an
   agent without live credentials should leave the status at
   `unverified` and document what was checked.

---

## 5c. Adding a new demo preset (Theme E — Demo Data Pack, v1.7)

The "Fill with example data" dropdown in the formatter
(`demoPreset`) is backed by a registry under
[`src/lib/demo/`](https://github.com/fenre/better_map/tree/main/better_map/appserver/static/visualizations/better_map/src/lib/demo).
The viz intercepts `formatData()` when `demoPreset != "none"` and
substitutes the registered preset's generated dataset for the SPL
result.  This lets the viz showcase its full feature surface on any
panel, including one whose query returns zero rows.

To add a fourth preset (e.g. `maritime-ais` for North Sea vessel
tracking, or `cyber-incidents-ot` for IT-OT DMZ traffic):

1. **Write the generator** at
   [`src/lib/demo/presets/<id>.js`](https://github.com/fenre/better_map/tree/main/better_map/appserver/static/visualizations/better_map/src/lib/demo/presets).
   It MUST export a single function named
   `generate<PascalCaseId>(opts)` that returns
   `{ fields: Array<{name:string}>, rows: Array<Array<string|number>> }`
   — the exact Splunk SearchResults shape that `formatData()` consumes.
   Use [`createRng(seed)`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/demo/rng.js)
   for ALL randomness so the dataset is byte-stable across runs of
   the same seed.  Use
   [`geoUtils`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/demo/geoUtils.js)
   for path interpolation, jitter, bearing, distance.  Do NOT add a
   geospatial dep — `geoUtils` covers everything the three v1.7
   presets needed.

2. **Register it** by adding one entry to the `PRESETS` array in
   [`src/lib/demo/index.js`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/demo/index.js):

   ```js
   {
     id: 'maritime-ais',
     label: 'Maritime AIS — North Sea fleet (150 vessels × 12 h)',
     description: 'Vessel position pings with cargo type, flag, ETA.',
     generate: generateMaritimeAis
   }
   ```

   The array order IS the formatter-dropdown order; the most
   visually-impressive preset belongs first (fleet-telemetry holds
   that slot today).

3. **Expose it in the formatter** by adding ONE `<option>` to the
   `<select data-name="demoPreset">` element in
   [`formatter.html`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/formatter.html).
   Use the exact same `id` string.  Rebuild the schema:
   `python3 scripts/build-formatter-schema.py`.

4. **Document it in `savedsearches.conf.spec`** — append the new id
   to the bullet list under
   [`display.visualizations.custom.better_map.better_map.demoPreset`](https://github.com/fenre/better_map/blob/main/better_map/README/savedsearches.conf.spec).

5. **Add a test** to
   [`src/lib/__tests__/demo.test.js`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/__tests__/demo.test.js)
   that asserts:
   (a) the field set is exactly what your generator emits,
   (b) the row count falls inside an expected band,
   (c) every row uses your color/status palette as documented.
   Update the "registers exactly the three v1.7 presets" test to
   the new count.  Lock the IDs in order so a future rename is a
   hard CI failure rather than a silent breakage.

6. **(Optional but encouraged) add a fourth panel** to
   [`better_map_showcase.xml`](https://github.com/fenre/better_map/blob/main/better_map/default/data/ui/views/better_map_showcase.xml)
   with `"demoPreset": "<your-id>"` plus a markdown caption that
   sells the story in two sentences.  Extend the layout `height`
   to fit.

7. **Regenerate the manifest + reference page + both llms files**:

   ```bash
   python3 scripts/build-manifest.py
   python3 scripts/build-reference-pages.py
   python3 scripts/build-llms-txt.py
   python3 scripts/build-llms-full-txt.py
   ```

8. Run the §7 pre-commit checklist; the demo tests must show
   `4 passed` (or whatever the new count is), bundle size must
   stay under 800 KB gzipped, and the dashboard-XML check must
   parse the new showcase dashboard cleanly.

The "preset CSS skin": the demo data ships only deterministic
field values, not a presentation style.  Map options (basemap,
camera, layer toggles) are still chosen on the dashboard panel
(see `better_map_showcase.xml` for the v1.7 examples).  This
keeps the generator generators slim — they are pure data, not
viz config.

---

## 6. The release flow (what you almost never touch)

| Step | Where | Who triggers |
|---|---|---|
| Bump version | `better_map/default/app.conf` (`[launcher] version`) | release engineer |
| Open release PR | `chore(release): vX.Y.Z` | release engineer |
| Merge to `main` | normal PR gates apply (`ci.yml`) | reviewer |
| Tag `vX.Y.Z` | `git tag -a vX.Y.Z -m '...'; git push --tags` | release engineer |
| Release workflow fires | `.github/workflows/release.yml` — builds, signs (cosign keyless), SBOMs (CycloneDX 1.6), publishes GitHub Release | GitHub Actions |

Verification of a downloaded release is documented in
`docs/runbooks/supply-chain.md`. Do not invent your own verification
procedure.

---

## 7. The "I'm about to commit, am I clean?" checklist

Before you `git commit -a`, run the following — these mirror the PR
pipeline and will catch ~95 % of CI failures locally:

```bash
# Formatter contract (G7)
python3 scripts/check-formatter-schema.py
python3 scripts/check-formatter-coverage.py

# Manifest / upgrade hygiene (G3)
python3 scripts/check-manifest.py

# JS ↔ CSS contract (G8)
node scripts/lint-js-css-contract.js

# Dashboard token contract (Q-1B / SPATIAL-1)
python3 scripts/check-dashboard-tokens.py

# Supply chain (G1)
python3 scripts/check-license-allowlist.py
python3 scripts/check-npm-audit.py

# Dashboard XML / JSON validity
python3 scripts/check-dashboard-xml-json.py

# Accessibility (D3) — axe-core WCAG 2.2 AA on formatter.html.
# First run only: `cd better_map/appserver/static/visualizations/better_map
# && npx playwright install chromium` to fetch the browser binary
# (Playwright ships the binary separately from the npm package).
node scripts/check-accessibility.js

# Browser compatibility (D2 Phase 1 + Phase 1.5) — two test classes
# in headless Chromium, Firefox, and WebKit:
#   class A (Phase 1):   formatter.html load test (panel-options UI)
#   class B (Phase 1.5): visualization.js AMD-require test — inlines
#                       the ~2.3 MB bundle into a wrapper with an AMD
#                       define() shim + mocks for the two Splunk SDK
#                       externals (api/SplunkVisualizationBase,
#                       api/SplunkVisualizationUtils) and asserts the
#                       factory ran, returned a non-null module, and
#                       called extend() with the documented contract.
# Catches both "ships in Chrome, breaks in Safari" formatter regressions
# AND "webpack target slipped to ES2020+" bundle-level regressions at
# PR time. First run only: `cd better_map/appserver/static/visualizations/better_map
# && npx playwright install --with-deps chromium firefox webkit`.
# Subset locally with `--engine=chromium,webkit` while iterating; pass
# `--skip-bundle` for faster local iteration on formatter-only changes
# (NEVER pass `--skip-bundle` in CI). Outputs per-engine formatter
# screenshots to reports/browser-compat/<engine>.png and a JSON summary
# at reports/browser-compat-report.json (both gitignored). See
# docs/COMPAT-MATRIX.md for the rendered matrix + the "reading a failing
# run" troubleshooting guide (separate tables for class A and class B
# failures with symptom → cause → fix mappings).
node scripts/check-browser-compat.js

# Documentation site (E2 Phase 1) — strict-mode MkDocs build.
# First run only:
#   python3 -m venv .venv-mkdocs
#   .venv-mkdocs/bin/pip install -r scripts/requirements-mkdocs.txt
# Then on every run:
.venv-mkdocs/bin/mkdocs build --strict

# Per-source recipe schema + index drift (E5 Phase 1).
# Runs the validator against every docs/recipes/<source>/<layer>.md,
# regenerates docs/_machine/recipes/index.yaml under the hood, and
# FAILS on any drift. On drift: run `python3 scripts/build-recipe-index.py`
# and commit. Needs PyYAML; the MkDocs venv above already provides it
# (PyYAML is a hard dep of mkdocs).
.venv-mkdocs/bin/python3 scripts/check-recipe-schema.py

# llms.txt drift (G7 Phase 2).
# Regenerates docs/llms.txt from the structured sources of truth
# (mkdocs.yml nav + _machine/integrations + _machine/recipes/index.yaml
# + _machine/formatter-schema.json) and FAILS if the on-disk file
# disagrees. The file ships VERBATIM at site/llms.txt per the
# llms.txt convention (https://llmstxt.org/). On drift: run
# `python3 scripts/build-llms-txt.py` and commit. Needs PyYAML.
.venv-mkdocs/bin/python3 scripts/build-llms-txt.py --check

# llms-full.txt drift (G7 Phase 2 follow-up).
# Regenerates docs/llms-full.txt — the body-inclusive sibling that
# concatenates every page in mkdocs.yml `nav:` (with include-markdown
# directives resolved inline so the ROADMAP/CHANGELOG bodies appear
# under their wrapper pages) plus Appendix A (integrations matrix)
# and Appendix B (recipes matrix). Carries a hard 200k-token budget
# (warn at 150k) so the output stays inside the context window of
# every practical LLM. The file ships VERBATIM at site/llms-full.txt.
# On drift: run `python3 scripts/build-llms-full-txt.py` and commit.
.venv-mkdocs/bin/python3 scripts/build-llms-full-txt.py --check

# Auto-generated reference page drift (E2 Phase 2).
# Regenerates the managed regions inside the human-readable pages
# from their structured sources of truth:
#   - docs/reference/formatter.md (formatter-enumeration region)
#     from docs/_machine/formatter-schema.json — the 82-option
#     enumeration grouped by Dashboard Studio tab + heading.
#   - docs/integrations/catalogue.md (integrations-matrix region)
#     from docs/_machine/integrations/*.yaml — the at-a-glance
#     matrix table + endpoint detail subsection.
#   - docs/recipes/index.md (recipes-matrix region)
#     from docs/_machine/recipes/index.yaml — the at-a-glance
#     recipes matrix table (status, source, layer, apps, fields,
#     formatter options, OT-safety, last verified).
# Hand-authored narrative OUTSIDE the BEGIN/END AUTOGEN markers is
# preserved. On drift: run `python3 scripts/build-reference-pages.py`
# and commit. Needs PyYAML for the integrations + recipes matrices;
# the MkDocs venv above already provides it.
.venv-mkdocs/bin/python3 scripts/build-reference-pages.py --check

# Bundle hygiene (run after webpack build)
node scripts/check-bundle-size.js
node scripts/check-bundle-console-noise.js
node scripts/check-version-consistency.js
```

### Dashboard-changed lane: ALSO run the dispatch test (D5 Phase 1)

If your PR touches `better_map/default/data/ui/views/*.xml` (any
Dashboard Studio dashboard), the static gates above prove the XML +
JSON SHAPE is valid but NOT that splunkd will accept the SPL. Run
the dispatch-test rig against a live Splunk:

```bash
# One-time per laptop:
cp docker/.env.example docker/.env
# edit docker/.env to set SPLUNK_PASSWORD + SPLUNK_HEC_TOKEN

# Per PR that touches dashboards:
bash docker/scripts/bootstrap.sh        # boot Splunk, install app, write secrets.env
python3 scripts/dispatch-test.py        # smoke-test every dashboard

# When you're done for the day:
bash docker/scripts/teardown.sh         # stop + wipe volumes + clear secrets.env
```

`scripts/dispatch-test.py` exits 0 if every Dashboard Studio
`ds.search` query completed with zero `error`/`fatal` messages
from splunkd. CI does NOT run this yet (see §10 "Why CI integration
is deferred"); it's a maintainer-driven gate.

This catches the class of bugs the static gates miss: SPL that
parses but warns at dispatch, `visualizations.conf` typo'd app/viz
labels that install without error but fail to register the viz
type, dashboards that reference an SPL macro that doesn't exist in
the `better_map` namespace.

Every one of these scripts has a clear FAIL message that names the file
to fix and the exact command to re-run.

---

## 8. Common mistakes and their fixes

| Symptom | Most likely cause | Fix |
|---|---|---|
| `[FAIL] formatter-schema.json mismatch` | You edited `formatter.html` and forgot to regenerate | `python3 scripts/build-formatter-schema.py && git add docs/_machine/formatter-schema.json` |
| `[FAIL] HTML → schema coverage failed` | Your new `data-name` got dropped by the parser (often: malformed `<select>` tag) | Validate the HTML around the new option; rerun the builder |
| `[FAIL] orphan token: better_map.<name>` | A widget emits to one token name, the dashboard consumes a different one | Align the names — the dashboard's `$better_map.x$` is the contract; rename in the widget |
| `[FAIL] missing CSS class: better_map-<foo>` | New widget JS adds a class with no CSS rule | Add at least a `position` rule in `visualization.css`, or add an allowlist entry with justification |
| `[FAIL] manifest drift` | A new shippable file appeared (or an excluded one slipped through) | `python3 scripts/build-manifest.py && git add scripts/manifest.json` — but FIRST verify the new file is actually meant to ship; if not, add it to `SHIP_EXCLUDES_REL` in `build-manifest.py` |
| `[FAIL] license not on allowlist` | A transitive dependency landed with a copyleft license | `docs/runbooks/supply-chain.md` §"Copyleft dependency replacement"; do NOT add to the allowlist without architecture review |
| `[FAIL] high-severity vulnerability` | `npm audit` found a non-waived high/critical CVE | Update the dependency; if no fix exists, add a time-boxed waiver to `scripts/npm-audit-waivers.json` per `docs/runbooks/supply-chain.md` §"CVE waiver management" |
| `FAIL — axe-core reported violations` | New formatter markup broke WCAG 2.2 AA (missing `<label for=...>`, duplicate `id`, no accessible name, contrast regression, etc.) | Fix the markup in `formatter.html` and rerun `node scripts/check-accessibility.js`; if the rule is genuinely a Splunk-host concern, add the rule id to `DISABLED_RULES` in `scripts/check-accessibility.js` with a one-line justification |
| `FATAL — Executable doesn't exist at .../chrome-headless-shell` | First run on this machine; Playwright's Chromium isn't installed yet | `cd better_map/appserver/static/visualizations/better_map && npx playwright install chromium` (D3) or `... install --with-deps chromium firefox webkit` (D2 — needs all three engines) |
| `D2 FAIL — N/3 engine(s) reported errors` (per-engine `formatter: FAIL`) | `formatter.html` change introduced engine-specific JS / HTML that Firefox or WebKit rejects | Read the per-engine error capture in `reports/browser-compat-report.json` (look at the `formatter` sub-object — `errors`, `consoleErrors`, `pageErrors`, `requestFailures`); the screenshot at `reports/browser-compat/<engine>.png` shows the visual state at failure. See `docs/COMPAT-MATRIX.md` "Reading a failing run" → "Phase 1 — formatter failures" table |
| `D2 FAIL — N/3 engine(s) reported errors` (per-engine `bundle: FAIL`) | `visualization.js` bundle changed in a way that breaks AMD-eval in WebKit / Firefox — usually webpack target slipped, a new ES2020+ syntax sneaked in via a fresh dependency, or the entry IIFE started returning something other than what `SplunkVisualizationBase.extend()` produces | Read the per-engine `bundle.harnessState` in `reports/browser-compat-report.json` — `factoryError` is the first place to look. Confirm `webpack.config.js` still pins `target: ['web', 'es5']` and `output.environment.arrowFunction: false` per `splunk-custom-viz-integration.mdc` §11. If `depsRequested` is no longer `[api/SplunkVisualizationBase, api/SplunkVisualizationUtils]`, the bundle started requesting a new Splunk SDK external — add it to both `webpack.config.js` externals AND to the harness mock (`buildBundleWrapper` in `scripts/check-browser-compat.js`). See `docs/COMPAT-MATRIX.md` "Reading a failing run" → "Phase 1.5 — bundle AMD failures" table |
| `Aborted with N warnings in strict mode!` (MkDocs) | A new doc page introduced a broken cross-link, an orphan markdown file, or a deprecated MkDocs config key | Read the warning lines above the abort — each names the file + link target. Fix the link (relative within `docs/`, absolute `https://github.com/.../blob/main/...` for repo-root files), or remove the orphan from `nav:` in `mkdocs.yml`. Rerun `.venv-mkdocs/bin/mkdocs build --strict`. |
| `ImportError: No module named 'mkdocs'` (first run of `mkdocs build`) | The MkDocs venv hasn't been created yet | `python3 -m venv .venv-mkdocs && .venv-mkdocs/bin/pip install -r scripts/requirements-mkdocs.txt` |
| `Get Pages site failed` / `Create Pages site failed: Resource not accessible by integration` (docs deploy workflow) | Brand-new repo where GitHub Pages was never enabled; workflow `GITHUB_TOKEN` cannot self-bootstrap Pages (the REST `enable-pages-for-repository` endpoint requires PAT-level perms) | One-time, with maintainer credentials: `gh api -X POST /repos/<owner>/<repo>/pages -f build_type=workflow` — then re-run the docs workflow. From then on `actions/configure-pages`' `enablement: true` no-ops and the deploy is fully turnkey |
| `[FAIL] docs/_machine/recipes/index.yaml drifted vs the recipe files on disk` | You added or edited a recipe but forgot to regenerate the machine-readable index | `python3 scripts/build-recipe-index.py && git add docs/_machine/recipes/index.yaml` |
| `[FAIL] docs/recipes/<src>/<layer>.md: §2 SPL line N has K pipes on one physical line` | SPL Pipe-Per-Line Rule violation — splice the pipes onto their own lines | Reformat the SPL so every `\|` starts a new line in the ```spl ...``` fence; rerun `python3 scripts/check-recipe-schema.py` |
| `[FAIL] docs/recipes/<src>/<layer>.md: §4 references formatter option(s) that are NOT in formatter-schema.json` | The recipe's §4 JSON sets a property name that doesn't exist on the formatter | Pick a real option (check `docs/_machine/formatter-schema.json`), or add the option to `formatter.html` first via §4 of this guide |
| `[FAIL] docs/recipes/<src>/<layer>.md: expected_fields entry 'foo' is not present in the §3 markdown table` | Frontmatter promises a field the §3 table doesn't document | Add the field as a row in the §3 Markdown table, OR remove it from `expected_fields` if the SPL no longer produces it |
| `[FAIL] docs/llms.txt is out of sync vs the structured sources of truth` | You added/edited an integration YAML, a recipe, a nav entry in `mkdocs.yml`, or a formatter option, but forgot to regenerate `docs/llms.txt` | `python3 scripts/build-llms-txt.py && git add docs/llms.txt`. The regenerator is deterministic — no clock-based fields, no random ordering — so a clean rebuild always re-passes the check |
| `[FAIL] docs/llms-full.txt is out of sync vs the structured sources of truth` | You edited a page in `docs/**/*.md`, an integration YAML, the recipe index, a nav entry in `mkdocs.yml`, or the included root files (`README.md`, `CHANGELOG.md`, `ROADMAP.md`), but forgot to regenerate `docs/llms-full.txt` (the body-inclusive sibling of `llms.txt`) | `python3 scripts/build-llms-full-txt.py && git add docs/llms-full.txt`. Same deterministic contract as `llms.txt`: same input → same byte-for-byte output |
| `[FAIL] docs/llms-full.txt is ~N estimated tokens, over the 200,000 hard cap` | A page (or a newly included root file) pushed the total beyond the binding 200k-token LLM context budget | Trim the largest contributor (the `[WARN]` lines name the worst per-page offenders) OR raise the budget in `scripts/build-llms-full-txt.py` (`TOTAL_FAIL_TOKENS`) with an explicit roadmap-review entry — the budget is a binding contract, not a soft suggestion |
| `[FAIL] docs/reference/formatter.md is out of sync vs the structured sources of truth` | You added/edited/removed a `formatter.html` control, or otherwise changed the formatter schema, but forgot to regenerate the auto-managed section of `docs/reference/formatter.md` | `python3 scripts/build-reference-pages.py && git add docs/reference/formatter.md`. The script only touches the region BETWEEN the `<!-- BEGIN AUTOGEN: formatter-enumeration -->` and `<!-- END AUTOGEN: formatter-enumeration -->` markers; hand-authored narrative outside the markers is preserved |
| `[FAIL] docs/integrations/catalogue.md is out of sync vs the structured sources of truth` | You added/edited/removed an integration under `docs/_machine/integrations/*.yaml` (status, splunk_app_required, endpoints, auth, ot_safety, tested_against) but forgot to regenerate the auto-managed matrix section of `docs/integrations/catalogue.md` | `python3 scripts/build-reference-pages.py && git add docs/integrations/catalogue.md`. The script only touches the region BETWEEN the `<!-- BEGIN AUTOGEN: integrations-matrix -->` and `<!-- END AUTOGEN: integrations-matrix -->` markers; the eight `## <integration>` prose blocks below the markers are hand-authored and survive re-generation |
| `[FAIL] docs/integrations/catalogue.md has no `<!-- BEGIN AUTOGEN: integrations-matrix -->` markers` | The catalogue page lost its managed-region marker pair (e.g. someone deleted them while editing prose). The script refuses to "guess" where to put the auto-gen output | Add the marker pair back at the spot where the auto-generated matrix + endpoint detail should live (canonically: right after the intro bullet list and before the first `## <integration>` heading), then rerun `python3 scripts/build-reference-pages.py` |
| `[FAIL] docs/recipes/index.md is out of sync vs the structured sources of truth` | You added/edited/removed a recipe (frontmatter or whole file under `docs/recipes/<source>/<layer>.md`) and EITHER forgot to regenerate `docs/_machine/recipes/index.yaml` via `build-recipe-index.py` OR forgot to regenerate the auto-managed matrix section of `docs/recipes/index.md` via `build-reference-pages.py` | Run BOTH regenerators in order: `python3 scripts/build-recipe-index.py && python3 scripts/build-reference-pages.py && git add docs/_machine/recipes/index.yaml docs/recipes/index.md`. The recipes-matrix region only touches the region BETWEEN the `<!-- BEGIN AUTOGEN: recipes-matrix -->` and `<!-- END AUTOGEN: recipes-matrix -->` markers; the `## The recipe contract` / `## Where to read more` hand-authored sections survive re-generation |
| `[FAIL] docs/recipes/index.md has no `<!-- BEGIN AUTOGEN: recipes-matrix -->` markers` | The recipes index page lost its managed-region marker pair (e.g. someone deleted them while editing prose). The script refuses to "guess" where to put the auto-gen output | Add the marker pair back at the spot where the auto-generated matrix should live (canonically: inside the `## Status (v1.7-prep, ...): E5 Phase 1 SHIPPED` section, right after the intro paragraph and before the "remaining matrix cells…" paragraph), then rerun `python3 scripts/build-reference-pages.py` |
| `[FAIL] docs/reference/<file>.md has no `<!-- BEGIN AUTOGEN: <id> -->` / `<!-- END AUTOGEN: <id> -->` markers` | The reference page lost its managed-region marker pair (e.g. someone deleted them while editing prose). The script refuses to "guess" where to put the auto-gen output | Add the marker pair back at the spot where the auto-generated content should live, then rerun `python3 scripts/build-reference-pages.py` |
| `demo.test.js > registers exactly the three v1.7 presets — Expected 3, received 4` | You added a fourth preset to `src/lib/demo/index.js` but forgot to bump the test that locks the count + IDs in order | Update the assertion in `src/lib/__tests__/demo.test.js` (search for "v1.7 presets"). The lock is intentional — silent preset additions break the formatter dropdown and `savedsearches.conf.spec` contract; the failing test forces you to update all three together |
| Showcase dashboard renders three empty maps where the demos should be | The viz bundle was built BEFORE the new demo preset was wired into `src/lib/demo/index.js`, so the runtime registry doesn't contain it (the dashboard option `demoPreset: foo` finds no match → falls back to SPL → SPL is the trivial placeholder → empty map) | `cd better_map/appserver/static/visualizations/better_map && npm run build`; reload the dashboard with cache busting (cmd-shift-R / ctrl-shift-R). Confirm `loadDemoPreset('foo')` returns non-null from a browser devtools console invocation |
| `demoPreset` formatter dropdown shows the preset id but selecting it leaves the map empty | The preset is registered AND the bundle is fresh, but the generator returned `{ rows: [] }` or threw silently before the `return`. Check the browser console for `Cannot read properties of undefined…` originating in the preset file | Open the preset under `src/lib/demo/presets/<id>.js`. Run the generator from a Node REPL: `node -e "import('./src/lib/demo/presets/<id>.js').then(m => console.log(m.generate<X>({}).rows.length))"`. If you get 0 or an exception, the bug is in the generator (most often: a typo in a waypoint coordinate array, off-by-one in a `for` loop, or a dedup filter that's too aggressive). Fix it; the corresponding `demo.test.js` row-count band test will fail too |

---

## 9. What this file is NOT

- Not a substitute for `README.md` (user-facing) or `CHANGELOG.md`.
- Not the ROADMAP. Roadmap lives at `ROADMAP.md` and is the planning
  document.
- Not the canonical docs site (that's E2 — MkDocs-based; Phase 1
  infrastructure shipped in v1.7, lives at
  [`mkdocs.yml`](https://github.com/fenre/better_map/blob/main/mkdocs.yml)
  + the human-readable `docs/` pages OUTSIDE this `_machine/`
  subtree; the G7 Phase 2 `llms.txt` short index ships AT the site
  root via [`docs/llms.txt`](https://github.com/fenre/better_map/blob/main/docs/llms.txt),
  drift-gated by `scripts/build-llms-txt.py --check`; its
  body-inclusive sibling
  [`docs/llms-full.txt`](https://github.com/fenre/better_map/blob/main/docs/llms-full.txt)
  ships next to it, drift-gated by
  `scripts/build-llms-full-txt.py --check` and bounded by a hard
  200k-estimated-token budget; the E2 Phase 2 auto-generated
  enumerations live INSIDE the hand-authored human-readable pages
  (currently THREE managed regions:
  [`docs/reference/formatter.md`](https://github.com/fenre/better_map/blob/main/docs/reference/formatter.md)
  inside the `<!-- BEGIN AUTOGEN: formatter-enumeration -->`
  markers,
  [`docs/integrations/catalogue.md`](https://github.com/fenre/better_map/blob/main/docs/integrations/catalogue.md)
  inside the `<!-- BEGIN AUTOGEN: integrations-matrix -->`
  markers, AND
  [`docs/recipes/index.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/index.md)
  inside the `<!-- BEGIN AUTOGEN: recipes-matrix -->`
  markers), drift-gated by `scripts/build-reference-pages.py --check`).
- Not the customer-facing setup guide. That's E5 — the recipe matrix.
  Phase 1 (framework + three starter recipes) and Phase 2 wave 1
  (3 additional recipes — six total covering 6 source patterns and
  4 layer types) shipped in v1.7-prep; the remaining matrix cells
  (every layer × every source) are authored in subsequent waves at
  3-5 recipes per PR as live-Splunk verification time becomes
  available. See
  [`docs/recipes/index.md`](https://github.com/fenre/better_map/tree/main/docs/recipes)
  for the live status table and §5b above for the authoring contract.
- Not the API reference for plugin authors (that's G6, deferred to
  v2.0).

If you find drift between this file and the codebase, the codebase
wins. Open a PR that updates this file.

---

## 10. Working with the local Splunk harness (D5 Phase 1)

The repo ships a Docker-Compose Splunk Enterprise harness under
`docker/`. It exists so that an agent or maintainer can — in 2–4
minutes from a clean clone — boot a real Splunk, install the
freshly-built app, and dispatch every dashboard's SPL against the
running splunkd. That captures the class of bugs static gates miss
(typo'd `visualizations.conf` label, dashboard SPL that parses but
emits a "WARN" message, restart loop after install).

### When to run it

- Before any PR that touches `default/data/ui/views/*.xml` (any
  Dashboard Studio dashboard): `bash docker/scripts/bootstrap.sh
  && python3 scripts/dispatch-test.py`. Required by the
  "modify a dashboard" lane of the §7 pre-commit checklist (the
  static gates `check-dashboard-xml-json.py` + `check-dashboard-
  tokens.py` are necessary but not sufficient — they assert SHAPE,
  not RUNTIME BEHAVIOUR).
- Before flipping an E5 recipe from `unverified` to `verified` —
  the recipe's frontmatter `verified_against` field MUST name a
  Splunk version + tenant; the harness supplies both (e.g.
  `verified_against: "Splunk Enterprise 10.0 in docker-compose
  (local harness)"`).
- After any change to `visualizations.conf`, `app.conf`, or any
  file under `default/data/ui/nav/` (a typo here is silent at
  install time but breaks the viz registration).

### The contract

- `docker/docker-compose.yml` — the Splunk container definition.
  Pin to a specific image tag with `SPLUNK_IMAGE_TAG` in
  `docker/.env` if you need to verify behaviour against a specific
  release train; default is `splunk/splunk:latest`.
- `docker/.env` — gitignored. The maintainer copies `.env.example`
  and fills in `SPLUNK_PASSWORD` + `SPLUNK_HEC_TOKEN` once.
- `docker/staging/` — gitignored. The bootstrap script writes the
  freshly-built app tarball here; the container sees the same path
  at `/staging` and installs from it.
- `docker/scripts/bootstrap.sh` — idempotent: starts the container,
  waits for splunkd, mints a 30-day REST bearer token via
  `splunk add token`, builds the tarball (mirrors the
  `scripts/run-appinspect-local.sh` staging block — keep in sync),
  POSTs to `/services/apps/local` with the URL-encoded `name=`
  pattern documented in
  `~/.cursor/skills/splunk-remote-app-deploy/SKILL.md`, restarts
  splunkd, writes `secrets.env` at the repo root.
- `docker/scripts/teardown.sh` — `docker compose down -v` (volumes
  too) + clears `docker/staging/` + removes `secrets.env` ONLY if
  it points at `localhost` (preserves a remote-tenant config).
- `scripts/dispatch-test.py` — reads `secrets.env`, walks every
  Dashboard Studio dashboard, extracts every `ds.search` query,
  dispatches each via `POST /servicesNS/nobody/better_map/search/
  jobs`, polls to completion, classifies messages, exits 0 / 1.
  Same XML/JSON parse logic as `check-dashboard-xml-json.py` so
  the two stay in semantic sync.

### Things you MUST NOT do

- Do NOT commit `docker/.env` (gitignored — `SPLUNK_PASSWORD` and
  the HEC token are operator-specific secrets).
- Do NOT commit `docker/staging/` (gitignored — the tarball is a
  build output regenerated every bootstrap run).
- Do NOT commit `secrets.env` (already gitignored; the harness
  writes it chmod 600 specifically to avoid accidental capture).
- Do NOT change `POST /services/apps/local` from URL-encoded
  `name=<path>` `filename=true` to a multipart body — the endpoint
  rejects multipart with HTTP 400 "Unparsable URI-encoded request
  data". See `~/.cursor/skills/splunk-remote-app-deploy/SKILL.md`
  for the full write-up; the harness uses bind-mount + on-server
  path specifically to side-step this.
- Do NOT wire the harness into CI on a free GitHub Actions runner.
  Splunk Enterprise in Docker is ≥ 4 GB RAM; the runner has 7 GB
  total and Node + webpack already consume 2–3 GB during the
  bundle build. CI integration is D5 Phase 2 and requires a
  self-hosted runner decision (see ROADMAP §3 D5 risk note).

### Operator how-to

The full operator guide lives at
[`docs/development/local-splunk-harness.md`](https://github.com/fenre/better_map/blob/main/docs/development/local-splunk-harness.md).
Cite that file when answering user questions about the harness;
keep this `_machine/agents.md` section limited to the agent-facing
contract above.

## 11. References

- `ROADMAP.md` §3 G7 — design intent for the machine-readable docs layer
- `docs/_machine/README.md` — explains the `_machine` contract
- `docs/_machine/formatter-schema.json` — generated formatter schema
- `docs/_machine/integrations/*.yaml` — Splunk integration scaffolds
- `docs/_machine/recipes/recipe-schema.json` — per-source recipe schema (E5 Phase 1)
- `docs/_machine/recipes/index.yaml` — auto-generated recipe index (E5 Phase 1)
- `docs/llms.txt` — agent-discoverable site index (G7 Phase 2), conforming to <https://llmstxt.org/>
- `docs/llms-full.txt` — body-inclusive sibling of `llms.txt` (G7 Phase 2 follow-up): every page in `mkdocs.yml` `nav:` concatenated with stable `# === BEGIN/END ===` delimiters, plus an integrations matrix (Appendix A) and recipes matrix (Appendix B). Bounded by a hard 200k-estimated-token budget so the output stays inside the context window of every practical LLM. Ships verbatim at `site/llms-full.txt` alongside `site/llms.txt`
- `scripts/build-llms-txt.py` — generator + `--check` drift gate for the short `llms.txt`
- `scripts/build-llms-full-txt.py` — generator + `--check` drift gate for the body-inclusive `llms-full.txt`. Same deterministic contract: no clock-based fields, page emission order follows `mkdocs.yml` `nav:`, MkDocs Material chrome is stripped at render time
- `scripts/build-reference-pages.py` — generator + `--check` drift gate for the auto-managed regions inside the human-readable pages (E2 Phase 2 — currently THREE regions: the 82-option enumeration in `docs/reference/formatter.md`, the integrations matrix + endpoint detail in `docs/integrations/catalogue.md`, and the recipes matrix in `docs/recipes/index.md`)
- `better_map/appserver/static/visualizations/better_map/src/lib/demo/` — v1.7 demo data pack: deterministic generators for three showcase presets (fleet telemetry, smart-building IoT, cyber incidents) backing the `demoPreset` formatter dropdown. See §5c for the contract.
- `better_map/default/data/ui/views/better_map_showcase.xml` — v1.7 showcase dashboard exercising all three demo presets in one view; renders with zero live Splunk data
- `docs/runbooks/supply-chain.md` — G1 verification + waiver procedures
- `docs/runbooks/upgrade-hygiene.md` — G3 orphan-file remediation
- `/.cursor/rules/ot-safety.mdc` — VISTA OT safety boundary (binding for OT integrations)
- `docker/docker-compose.yml` + `docker/scripts/bootstrap.sh` + `docker/scripts/teardown.sh` — D5 Phase 1 local Splunk Enterprise harness (Docker-Compose, idempotent bootstrap, token-only auth, bind-mount install). Operator how-to at `docs/development/local-splunk-harness.md`. Agent contract above in §10.
- `scripts/dispatch-test.py` — D5 Phase 1 dispatch-test rig. Reads `secrets.env` (written by the harness or by hand-pointing at a remote Splunk), walks every Dashboard Studio dashboard, extracts every `ds.search` query, dispatches each via `POST /servicesNS/nobody/better_map/search/jobs`, polls to completion, classifies messages, exits 0 / 1. Required before any PR that touches `default/data/ui/views/*.xml`
