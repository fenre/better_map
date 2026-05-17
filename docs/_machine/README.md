<!-- SPDX-License-Identifier: MIT -->
<!-- Source of truth: this file. Hand-maintained. -->

# `docs/_machine/` — machine-readable documentation layer

This directory is the **machine-readable** half of the better_map
documentation. Its purpose is to give AI agents (Cursor, Claude Code,
Copilot, Codex, the Splunk AI Assistant) structured, byte-stable inputs
they can consume without having to parse prose.

It is the partner of the human-readable layer: the repo-root
`README.md` / `CHANGELOG.md` / `ROADMAP.md` files **and** the
MkDocs Material documentation site (E2 Phase 1, shipped v1.7) whose
configuration lives at
[`mkdocs.yml`](https://github.com/fenre/better_map/blob/main/mkdocs.yml)
and whose sources live under the human-readable `docs/` pages
OUTSIDE this `_machine/` subtree. The MkDocs site auto-publishes to
GitHub Pages on every push to `main` via
[`.github/workflows/docs.yml`](https://github.com/fenre/better_map/blob/main/.github/workflows/docs.yml).

> **Contract:** every file here is either generated from a source of
> truth elsewhere in the repo, or hand-maintained with that fact
> declared in a `meta:` block. Either way, the file's contents are
> stable enough to be diffed in CI.

---

## What's in this directory today (G7 Phase 1)

| File / dir | What it documents | Source of truth | Drift gate |
|---|---|---|---|
| `formatter-schema.json` | All 82 formatter options exposed by the visualization (type, default, enum-values, help text, Splunk property path). JSON Schema 2020-12. | `better_map/appserver/static/visualizations/better_map/formatter.html` | `scripts/check-formatter-schema.py` (byte equality) + `scripts/check-formatter-coverage.py` (HTML ↔ schema mapping + duplicate transparency) + `scripts/check-accessibility.js` (axe-core WCAG 2.2 AA — D3 Phase 1) |
| `integrations/itsi.yaml` | ITSI integration scaffold (REST endpoints, auth, field contract, BM-CT-1 surface). | `src/lib/splunk/itsi.js` | hand-maintained; intentional drift requires an explicit PR |
| `integrations/soar.yaml` | SOAR integration scaffold. | `src/lib/splunk/soar.js` | hand-maintained |
| `integrations/rba.yaml` | Risk-Based Alerting offline helpers. | `src/lib/splunk/rba.js` | hand-maintained |
| `integrations/esNotable.yaml` | ES notable drilldown + close stub. | `src/lib/splunk/esNotable.js` | hand-maintained |
| `integrations/mitre.yaml` | MITRE ATT&CK technique overlay. | `src/lib/splunk/mitre.js` | hand-maintained |
| `integrations/purdue.yaml` | OT Purdue / IEC 62443 overlay (incl. OT safety boundary). | `src/lib/splunk/purdue.js` + `/.cursor/rules/ot-safety.mdc` | hand-maintained |
| `integrations/aiGeo.yaml` | AI-suggested geo annotations. | `src/lib/splunk/aiGeo.js` | hand-maintained |
| `integrations/aiAssistant.yaml` | Splunk AI Assistant for SPL bridge. | `src/lib/splunk/aiAssistant.js` | hand-maintained |
| `recipes/recipe-schema.json` | E5 Phase 1 — per-source recipe contract. JSON Schema 2020-12 declaring the YAML frontmatter every `docs/recipes/<source>/<layer>.md` MUST carry (id, source, layer, status, expected_fields, required_formatter_options, ot_safety_relevant). | hand-maintained | `scripts/check-recipe-schema.py` (frontmatter validation + 6-section structure + SPL pipe-per-line + §4 JSON vs formatter-schema cross-check + §3 table vs expected_fields cross-check) |
| `recipes/index.yaml` | E5 Phase 1 — auto-generated index of every recipe in `docs/recipes/<source>/<layer>.md`, with the frontmatter blocks flattened into one stable structure. The structured input for the G7 Phase 2 `llms.txt` emission. | `docs/recipes/<source>/<layer>.md` frontmatter (union of all) | `scripts/check-recipe-schema.py` (re-runs `scripts/build-recipe-index.py` under the hood and asserts byte-for-byte equality with the on-disk copy) |
| `agents.md` | Operating guide for AI agents working on the repo itself (the five non-negotiables, where things live, common mistakes). | hand-maintained | n/a |
| `README.md` | This file. | hand-maintained | n/a |
| `../llms.txt` (lives at `docs/llms.txt`, ships at `site/llms.txt`) | G7 Phase 2 — an `llms.txt`-convention index of every published documentation page, every Splunk integration, every per-source recipe, and every machine-readable scaffold. The single URL `<site>/llms.txt` is the entry point an LLM-aware agent should hit first. | `mkdocs.yml#nav`, `_machine/integrations/*.yaml`, `_machine/recipes/index.yaml`, `_machine/formatter-schema.json` (union of all) | `scripts/build-llms-txt.py --check` (regenerates from the structured sources and byte-compares; CI wires it into the docs-build job) |

---

## What's NOT here yet (G7 Phase 2, tracked under ROADMAP §3 G7)

These artefacts are part of the G7 design but depend on downstream
artefacts not yet built. They will be added once those land.

| File | Blocked by |
|---|---|
| ~~`llms.txt`~~ | ~~E2 — MkDocs site~~ (E2 Phase 1 shipped v1.7) + ~~E5 — recipe matrix~~ (E5 Phase 1 shipped v1.7-prep) + ~~emission script~~ (G7 Phase 2 shipped v1.7-prep — see row in the table above; lives at `docs/llms.txt`, copied verbatim to `site/llms.txt` by MkDocs, drift-gated by `scripts/build-llms-txt.py --check` in CI) |
| `llms-full.txt` | E2 Phase 1 (done) + E5 Phase 1 (done) + per-page token budget definition. Will require either a markdown-include-style concatenation or a separate render pass that strips MkDocs theme chrome from each rendered page; the per-page token-budget contract has to be agreed first |
| `layers/<layer-id>.yaml` (one per layer type) | Independent of E2 but de-prioritised behind integrations (where the customer questions actually land) |
| `recipes/<source>/<layer>.md` (the remaining matrix cells) | ~~E5 framework~~ (Phase 1 shipped) + live-Splunk verification time for each cell (status flips from `unverified` → `verified` as a maintainer with REST access dispatches each SPL). The framework is now drift-gated, so each new recipe lands as a small isolated PR |
| `openapi-better_map-rest.yaml` | The REST endpoints it would describe (KV-store bookmarks F1, plugin manifest G6, recipe-test webhook D5) are all v1.8 or later |

When each of these blockers clears, the corresponding artefact lands
under this directory with its own drift gate.

---

## How to consume `_machine/` as an agent

1. **First read:** `agents.md`. It encodes the five non-negotiables and
   the common mistake → fix table.
2. **To answer "what formatter options exist?":** parse
   `formatter-schema.json`. The Splunk property path you set in code is
   stored under `properties.<name>['x-bm'].splunk_property_path`.
3. **To answer "what endpoints does integration X call?":** read
   `integrations/<id>.yaml` → `endpoints_called[]`. Note the
   `auth_required` field and the `tested_against` value (`null` means
   "not yet verified against a live tenant", i.e., experimental).
4. **For OT/ICS work:** check the `ot_safety` block in
   `integrations/purdue.yaml` and read the referenced
   `/.cursor/rules/ot-safety.mdc`. The OT safety boundary is binding
   for any agent edit.
5. **For supply-chain decisions** (new dependency, license question,
   CVE waiver, release verification): follow
   `docs/runbooks/supply-chain.md`. The runbook is the source of truth;
   the SBOM and signatures it describes are produced by
   `.github/workflows/release.yml`.
6. **To answer "how do I wire source X into Better Map?":** read
   `recipes/index.yaml` first for a structured list, then drill into
   `docs/recipes/<source>/<layer>.md` for the full six-section
   playbook. Each recipe carries a `status` field — `verified` means
   the SPL has been dispatched against a real Splunk install (named
   in `verified_against`); `unverified` means the recipe is
   documentation-only and a maintainer-with-live-tenant should
   confirm before customer delivery.
7. **As your single-URL entry point:** if you can only hit one URL,
   hit `<site>/llms.txt`. It's an `llms.txt`-convention Markdown index
   (small enough to fit comfortably in any context window) of every
   page on the documentation site, every Splunk integration, every
   shipped per-source recipe, and every machine-readable scaffold —
   each with a one-line description and a stable URL. The on-disk
   source is `docs/llms.txt`; the canonical published URL is
   <https://fenre.github.io/better_map/llms.txt>.

---

## How to extend `_machine/`

When you add or change a file here:

1. **Generated file?** Update the source of truth (e.g.,
   `formatter.html`), run the generator, and commit BOTH the source and
   the regenerated file in the same PR. The drift gate will reject a
   PR that touches one without the other.
2. **Hand-maintained file?** Update the `meta:` block:
   - bump `version`
   - set `last_modified_iso8601` to today (YYYY-MM-DD)
   - confirm `source_of_truth_path` still resolves
3. **New file?** Add a row to the table above AND wire a CI check (or
   document why no machine check is feasible — e.g., narrative content
   that only humans can validate). A `_machine/` file with no gate is a
   liability, not an asset, because nothing prevents it from rotting.
4. **SPDX header:** every file starts with
   `# SPDX-License-Identifier: MIT` (YAML / `.py`) or
   `<!-- SPDX-License-Identifier: MIT -->` (markdown / HTML). An agent
   that copies one of these files into a customer engagement must know
   the licence applies.

---

## Versioning and stability promise

`_machine/` files use the same git tag as the rest of the repo. There is
no separate versioning. The stability promise is:

- **Within a patch release** (`vX.Y.Z` → `vX.Y.Z+1`): schemas are append-only; existing field semantics do not change.
- **Within a minor release** (`vX.Y.Z` → `vX.Y+1.0`): field renames must come with a migration note in `CHANGELOG.md`; old field names remain readable for at least one full minor release.
- **Across a major release** (`vX.Y.Z` → `vX+1.0.0`): breaking schema changes are allowed but must be enumerated in `CHANGELOG.md` under a "Machine-readable docs breaking changes" section.

An agent that needs absolute stability can pin to a git SHA — every
file here is deterministic given the source of truth.

---

## References

- `ROADMAP.md` §3 G7 — design intent for this layer
- `agents.md` — operating guide for agents
- `docs/runbooks/supply-chain.md` — G1 verification + waiver procedures
- `docs/runbooks/upgrade-hygiene.md` — G3 orphan-file remediation
- [llms.txt convention](https://llmstxt.org/) — G7 Phase 2 shipped; `docs/llms.txt` conforms
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema) — `formatter-schema.json` dialect
