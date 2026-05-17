---
title: Recipes
description: >-
  Per-source playbooks — how to wire Better Map into common
  Splunk-resident data sources end-to-end.
---

# Recipes

The recipes section is a collection of **end-to-end playbooks** for
wiring Better Map into common Splunk-resident data sources. Every
recipe is the literal SPL + formatter config you'd paste into
Dashboard Studio for a real customer panel; every recipe is gated by
a CI schema check so it cannot drift away from the contract it
declares.

## Status (v1.7-prep, 2026-05-17): E5 Phase 1 SHIPPED

Phase 1 delivers the **recipe framework** and three **starter
recipes** that cover the three most common Better Map source
patterns:

| Source pattern | Recipe | Splunk apps required |
|---|---|---|
| `splunk-cim` | [CIM Network Traffic → markers](cim-network-traffic/markers.md) | `Splunk_SA_CIM` (data-model accelerated) |
| `splunk-lookup` | [KV Store (lat/lon) → markers](kvstore-latlon/markers.md) | none (vanilla install) |
| `splunk-builtin` | [US states (geo lookup) → choropleth](geo-us-states/choropleth.md) | none (vanilla install) |

The remaining matrix cells from the E5 design — every layer × every
source pattern — are tracked in
[ROADMAP §3 E5](../roadmap.md) and unblock as a maintainer with
live-Splunk access verifies them.

## The recipe contract

Every recipe MUST be a six-section Markdown file with a YAML
frontmatter block at the top:

```text
docs/recipes/<source-id>/<layer-id>.md
└── ---
    YAML frontmatter (validated against recipe-schema.json)
    ---
    # <Source display name> — <Layer display name>
    ## 1. Source description
    ## 2. SPL recipe
    ## 3. Expected fields
    ## 4. Recommended formatter config
    ## 5. Screenshot
    ## 6. Gotchas
```

### Frontmatter schema

The contract is declared at
[`docs/_machine/recipes/recipe-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/recipes/recipe-schema.json)
(JSON Schema 2020-12). Every recipe's frontmatter declares:

- `schema_version` — currently `1`.
- `id` — `<source.id>--<layer.id>`, used as the dedup key in
  `index.yaml`.
- `source` — `id`, `display_name`, `pattern` (one of `splunk-cim`,
  `splunk-lookup`, `splunk-builtin`, `splunk-premium-es`,
  `splunk-premium-itsi`, `splunk-edge-hub`, `splunk-stream`,
  `splunk-vendor-ta`).
- `layer` — `id`, `display_name` (one of the ten core layer types:
  `markers`, `paths`, `polygons`, `choropleth`, `heat`, `h3`,
  `supercluster`, `extrusion-3d`, `indoor`, `vector-tile-join`).
- `status` — `verified` (dispatched against a real Splunk install),
  `unverified` (authored from documentation only — needs live test),
  or `deferred` (explicitly out-of-scope for this release).
- `verified_against` — Splunk version + tenant name hash + app
  context, required when `status: verified`.
- `splunk_apps_required` — list of app IDs (with `optional: bool`
  per entry).
- `expected_fields` — the field contract for the panel: every
  field name, type, and an example value.
- `required_formatter_options` — every property name from
  [formatter-schema.json](../reference/formatter.md) that this
  recipe sets in §4.
- `ot_safety_relevant` — per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc),
  is any signal SIS-related (safety_related=Y) or sourced from
  OT Level 0/1/2?

### Generated index

The CI gate emits a machine-readable index at
[`docs/_machine/recipes/index.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/recipes/index.yaml).
That index is the structured input for G7 Phase 2 (`llms.txt`
emission) and for any downstream AI agent or content-pack
generator that needs to enumerate recipes without parsing
markdown.

### CI gates

Two scripts enforce the contract on every PR (see
[`.github/workflows/ci.yml`](https://github.com/fenre/better_map/blob/main/.github/workflows/ci.yml)
`docs-build` job):

- **`scripts/check-recipe-schema.py`** — validates every recipe
  frontmatter against the schema; asserts the six canonical
  sections are present in order; cross-checks the §2 SPL fence
  for pipe-per-line compliance; cross-checks the §4 JSON config
  against `formatter-schema.json`; asserts `expected_fields`
  entries appear in the §3 markdown table; asserts the on-disk
  `index.yaml` matches what the index builder would emit
  (drift gate).
- **`scripts/build-recipe-index.py`** — walks `docs/recipes/`
  and writes the deterministic `index.yaml`. Run after adding or
  editing any recipe.

### Adding a new recipe

```bash
mkdir -p docs/recipes/<source-id>
cp docs/recipes/kvstore-latlon/markers.md \
   docs/recipes/<source-id>/<layer-id>.md
# Edit the frontmatter + 6 sections.
python3 scripts/build-recipe-index.py
python3 scripts/check-recipe-schema.py
```

All three commands are also documented in
[`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md).

## Where to read more

- [`recipe-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/recipes/recipe-schema.json)
  — the binding schema.
- [`index.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/recipes/index.yaml)
  — the auto-generated index of every recipe.
- [Layer reference](../reference/layers.md) — what each `layer.id`
  actually renders.
- [Formatter options](../reference/formatter.md) — the master list
  of every formatter property the recipes can configure.
- [Integration catalogue](../integrations/catalogue.md) — eight
  declared integrations that the recipes' popups, colour scales,
  and drilldowns can light up.
- [ROADMAP §3 E5](../roadmap.md) — the remaining matrix cells and
  their priority order.
