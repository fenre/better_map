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
6. Run `python3 scripts/build-llms-txt.py` and commit the regenerated
   `docs/llms.txt` — the file embeds the option count and a link to
   the formatter-schema, so the option-count delta drifts the gate.
7. Local sanity check:

   ```bash
   python3 scripts/check-formatter-schema.py
   python3 scripts/check-formatter-coverage.py
   python3 scripts/build-reference-pages.py --check
   python3 scripts/build-llms-txt.py --check
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
6. Run `python3 scripts/build-llms-txt.py && python3 scripts/build-llms-txt.py --check`
   — the new integration appears in the `## Integrations (Splunk)`
   section of `docs/llms.txt` (display name, status, required Splunk
   app, JS source path). Commit the regenerated `docs/llms.txt` in the
   same PR. The CI gate `build-llms-txt.py --check` will reject any
   drift.

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
   python3 scripts/build-recipe-index.py
   python3 scripts/check-recipe-schema.py
   python3 scripts/build-llms-txt.py
   python3 scripts/build-llms-txt.py --check
   ```

   The recipe check-script also re-runs the index builder under the
   hood and compares byte-for-byte against the on-disk copy — drift
   means you added a recipe but forgot to commit the regenerated index.
   The same logic applies to `llms.txt`: the new recipe MUST appear
   under `## Recipes (per-source playbooks)` of `docs/llms.txt`, so
   commit the regenerated file in the same PR.

5. **(If possible) verify against a live tenant**, then flip
   `status: unverified` → `status: verified`, populate
   `verified_against`, and submit the same PR. A maintainer with
   `secrets.env` REST access against `rev` can do this in seconds; an
   agent without live credentials should leave the status at
   `unverified` and document what was checked.

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

# Auto-generated reference page drift (E2 Phase 2).
# Regenerates the managed regions inside docs/reference/*.md from the
# machine schema (currently: the 82-option enumeration in
# formatter.md, inside the BEGIN/END AUTOGEN: formatter-enumeration
# marker pair) and FAILS if the on-disk file disagrees. Hand-authored
# narrative OUTSIDE the markers is preserved. On drift: run
# `python3 scripts/build-reference-pages.py` and commit. Pure stdlib —
# no extra deps needed.
python3 scripts/build-reference-pages.py --check

# Bundle hygiene (run after webpack build)
node scripts/check-bundle-size.js
node scripts/check-bundle-console-noise.js
node scripts/check-version-consistency.js
```

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
| `FATAL — Executable doesn't exist at .../chrome-headless-shell` | First run on this machine; Playwright's Chromium isn't installed yet | `cd better_map/appserver/static/visualizations/better_map && npx playwright install chromium` |
| `Aborted with N warnings in strict mode!` (MkDocs) | A new doc page introduced a broken cross-link, an orphan markdown file, or a deprecated MkDocs config key | Read the warning lines above the abort — each names the file + link target. Fix the link (relative within `docs/`, absolute `https://github.com/.../blob/main/...` for repo-root files), or remove the orphan from `nav:` in `mkdocs.yml`. Rerun `.venv-mkdocs/bin/mkdocs build --strict`. |
| `ImportError: No module named 'mkdocs'` (first run of `mkdocs build`) | The MkDocs venv hasn't been created yet | `python3 -m venv .venv-mkdocs && .venv-mkdocs/bin/pip install -r scripts/requirements-mkdocs.txt` |
| `Get Pages site failed` / `Create Pages site failed: Resource not accessible by integration` (docs deploy workflow) | Brand-new repo where GitHub Pages was never enabled; workflow `GITHUB_TOKEN` cannot self-bootstrap Pages (the REST `enable-pages-for-repository` endpoint requires PAT-level perms) | One-time, with maintainer credentials: `gh api -X POST /repos/<owner>/<repo>/pages -f build_type=workflow` — then re-run the docs workflow. From then on `actions/configure-pages`' `enablement: true` no-ops and the deploy is fully turnkey |
| `[FAIL] docs/_machine/recipes/index.yaml drifted vs the recipe files on disk` | You added or edited a recipe but forgot to regenerate the machine-readable index | `python3 scripts/build-recipe-index.py && git add docs/_machine/recipes/index.yaml` |
| `[FAIL] docs/recipes/<src>/<layer>.md: §2 SPL line N has K pipes on one physical line` | SPL Pipe-Per-Line Rule violation — splice the pipes onto their own lines | Reformat the SPL so every `\|` starts a new line in the ```spl ...``` fence; rerun `python3 scripts/check-recipe-schema.py` |
| `[FAIL] docs/recipes/<src>/<layer>.md: §4 references formatter option(s) that are NOT in formatter-schema.json` | The recipe's §4 JSON sets a property name that doesn't exist on the formatter | Pick a real option (check `docs/_machine/formatter-schema.json`), or add the option to `formatter.html` first via §4 of this guide |
| `[FAIL] docs/recipes/<src>/<layer>.md: expected_fields entry 'foo' is not present in the §3 markdown table` | Frontmatter promises a field the §3 table doesn't document | Add the field as a row in the §3 Markdown table, OR remove it from `expected_fields` if the SPL no longer produces it |
| `[FAIL] docs/llms.txt is out of sync vs the structured sources of truth` | You added/edited an integration YAML, a recipe, a nav entry in `mkdocs.yml`, or a formatter option, but forgot to regenerate `docs/llms.txt` | `python3 scripts/build-llms-txt.py && git add docs/llms.txt`. The regenerator is deterministic — no clock-based fields, no random ordering — so a clean rebuild always re-passes the check |
| `[FAIL] docs/reference/formatter.md is out of sync vs the structured sources of truth` | You added/edited/removed a `formatter.html` control, or otherwise changed the formatter schema, but forgot to regenerate the auto-managed section of `docs/reference/formatter.md` | `python3 scripts/build-reference-pages.py && git add docs/reference/formatter.md`. The script only touches the region BETWEEN the `<!-- BEGIN AUTOGEN: formatter-enumeration -->` and `<!-- END AUTOGEN: formatter-enumeration -->` markers; hand-authored narrative outside the markers is preserved |
| `[FAIL] docs/reference/<file>.md has no `<!-- BEGIN AUTOGEN: <id> -->` / `<!-- END AUTOGEN: <id> -->` markers` | The reference page lost its managed-region marker pair (e.g. someone deleted them while editing prose). The script refuses to "guess" where to put the auto-gen output | Add the marker pair back at the spot where the auto-generated content should live, then rerun `python3 scripts/build-reference-pages.py` |

---

## 9. What this file is NOT

- Not a substitute for `README.md` (user-facing) or `CHANGELOG.md`.
- Not the ROADMAP. Roadmap lives at `ROADMAP.md` and is the planning
  document.
- Not the canonical docs site (that's E2 — MkDocs-based; Phase 1
  infrastructure shipped in v1.7, lives at
  [`mkdocs.yml`](https://github.com/fenre/better_map/blob/main/mkdocs.yml)
  + the human-readable `docs/` pages OUTSIDE this `_machine/`
  subtree; the G7 Phase 2 `llms.txt` index ships AT the site root
  via [`docs/llms.txt`](https://github.com/fenre/better_map/blob/main/docs/llms.txt),
  drift-gated by `scripts/build-llms-txt.py --check`; the E2 Phase 2
  auto-generated reference enumerations live INSIDE the
  hand-authored reference pages (currently:
  [`docs/reference/formatter.md`](https://github.com/fenre/better_map/blob/main/docs/reference/formatter.md)
  inside the `<!-- BEGIN AUTOGEN: formatter-enumeration -->` markers),
  drift-gated by `scripts/build-reference-pages.py --check`).
- Not the customer-facing setup guide. That's E5 — the recipe matrix.
  Phase 1 (framework + three starter recipes) shipped in v1.7-prep;
  the remaining matrix cells (every layer × every source) are
  authored as live-Splunk verification time becomes available. See
  [`docs/recipes/index.md`](https://github.com/fenre/better_map/tree/main/docs/recipes)
  for the live status table and §5b above for the authoring contract.
- Not the API reference for plugin authors (that's G6, deferred to
  v2.0).

If you find drift between this file and the codebase, the codebase
wins. Open a PR that updates this file.

---

## 10. References

- `ROADMAP.md` §3 G7 — design intent for the machine-readable docs layer
- `docs/_machine/README.md` — explains the `_machine` contract
- `docs/_machine/formatter-schema.json` — generated formatter schema
- `docs/_machine/integrations/*.yaml` — Splunk integration scaffolds
- `docs/_machine/recipes/recipe-schema.json` — per-source recipe schema (E5 Phase 1)
- `docs/_machine/recipes/index.yaml` — auto-generated recipe index (E5 Phase 1)
- `docs/llms.txt` — agent-discoverable site index (G7 Phase 2), conforming to <https://llmstxt.org/>
- `scripts/build-llms-txt.py` — generator + `--check` drift gate for the above
- `scripts/build-reference-pages.py` — generator + `--check` drift gate for the auto-managed regions inside `docs/reference/*.md` (E2 Phase 2 — currently the 82-option enumeration in `formatter.md`)
- `docs/runbooks/supply-chain.md` — G1 verification + waiver procedures
- `docs/runbooks/upgrade-hygiene.md` — G3 orphan-file remediation
- `/.cursor/rules/ot-safety.mdc` — VISTA OT safety boundary (binding for OT integrations)
