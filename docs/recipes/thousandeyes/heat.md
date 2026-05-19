---
schema_version: 1
id: thousandeyes--heat
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (agent fleet)"
  pattern: splunk-vendor-ta
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "ta_cisco_thousandeyes"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "37.7749_-122.4194"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: agent_count
    type: integer
    example: "12"
  - name: test_count
    type: integer
    example: "47"
  - name: weight
    type: number
    example: "1.0"
    drives_formatter_option: heatmapWeight
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-agent identity)"
    path: "docs/recipes/thousandeyes/markers.md"
  - description: "Companion recipe — same source, H3 hexbin layer (jurisdictional aggregation)"
    path: "docs/recipes/thousandeyes/h3.md"
  - description: "Companion recipe — same source, paths layer (hop-by-hop traceroute polylines)"
    path: "docs/recipes/thousandeyes/paths.md"
  - description: "Pattern reference — heatmap with weight normalisation on lookup-anchored sites"
    path: "docs/recipes/kvstore-latlon/heat.md"
  - description: "Pattern reference — heatmap with eventstats max normalisation"
    path: "docs/recipes/es-risk/heat.md"
  - description: "ThousandEyes setup skill — sourcetypes, indexes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Cisco products skill — ThousandEyes data model and example SPL"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "Layer reference — heatmap"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius, heatmapWeight"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco ThousandEyes (agent fleet) — heatmap

The per-site density complement to the
[thousandeyes/markers](./markers.md),
[thousandeyes/h3](./h3.md), and
[thousandeyes/paths](./paths.md) recipes — same
`thousandeyes_agents` inventory + `thousandeyes_tests`
test-load join, but rendered as a weighted heat surface
rather than markers / hex cells / polylines. The heat
layer surfaces **DEM AGENT TEST-LOAD CONCENTRATION** as
smooth Gaussian colour intensity: hot blobs indicate
regions where the densest agent populations are
generating the most aggregate measurement load; cool
blobs indicate sparse coverage. This is the natural
shape for **executive DEM coverage briefings** (where
is the smooth coverage? where are the gaps?) and
**capacity-planning slide decks** (the question is
"where is my DEM footprint smoothly distributed?"
rather than "which agent has the most tests" — use
markers for that, or "what's the per-region count" —
use H3 hexbin for that).

Completes the **thousandeyes source-row triplet** —
markers (wave 11), H3 hexbin + heatmap (this wave),
plus the paths layer (wave 5) — all four layers
coexisting via the BM-CT-1 layer contract on the same
Dashboard Studio panel. This is the **14th source-row
triplet completed in the matrix**, leaving only
`geo-us-states` (geo-shape source row, intentionally
NOT a markers / heat / h3 target — its choropleth +
extrusion-3d coverage IS its triplet).

## 1. Source description

Same **Cisco ThousandEyes** sources as the markers /
h3 / paths companions — see
[thousandeyes/markers §1](./markers.md#1-source-description)
for the agent / test data model background. The relevant
distinction for THIS recipe: instead of one marker per
agent (which collapses to overlapping circles at world
zoom on a heavy-cloud-agent deployment) OR hex cells
with hard borders (jurisdictional aggregation that
loses the SMOOTH density signal), the recipe aggregates
agents AND their test-load BY (`lat`, `lon`) site and
renders the per-site agent-and-test density as a smooth
Gaussian heat surface.

**Why heatmap for ThousandEyes.** A markers view shows
per-agent identity but at world zoom the dots overlap
in cloud-region clusters. An H3 hexbin shows
jurisdictional aggregation with hard borders but the
hard borders create false "this region has 0 agents"
gaps at the cell boundaries (a real agent located right
on a hex border still contributes to exactly one cell
— misleading for a smooth-coverage panel). A heatmap
solves both: smooth radial blobs visually show
coverage as a continuous gradient with no hard
boundaries, no per-feature popup clutter, no per-cell
discretisation artefacts. The right shape when the
audience asks "what's our DEM agent coverage smoothly
look like?" or "where are the gaps in our coverage?"

**Typical sourcetype / index:** same as markers / h3 —
`index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents"`
for the inventory, `index=thousandeyes_tests
sourcetype="cisco:thousandeyes:tests"` for the test
load join. App required: `ta_cisco_thousandeyes`
(Splunkbase id 7719).

## 2. SPL recipe

```spl
index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents" earliest=-24h latest=now
| dedup agent_id sortby - _time
| where is_online="true"
| where isnotnull(agent_lat) AND isnotnull(agent_lon)
| join type=left agent_id [
    search index=thousandeyes_tests sourcetype="cisco:thousandeyes:tests" earliest=-24h latest=now
    | stats dc(test_id) AS test_count BY agent_id
  ]
| fillnull value=0 test_count
| stats count AS agent_count, sum(test_count) AS test_count BY agent_lat, agent_lon
| rename agent_lat AS lat, agent_lon AS lon
| eventstats max(test_count) AS max_test_count
| eval weight=round(if(max_test_count > 0, test_count / max_test_count, 0), 2)
| eval id=lat . "_" . lon
| fields id, lat, lon, agent_count, test_count, weight
| sort - test_count
| head 5000
```

Why this exact shape, line by line:

- **`index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents" earliest=-24h latest=now`** —
  same agent-inventory base search as the
  [markers companion §2](./markers.md#2-spl-recipe)
  and [h3 companion §2](./h3.md#2-spl-recipe). The TA
  polls hourly by default; 24h guarantees every
  active agent appears at least once.
- **`dedup agent_id sortby - _time`** — one row per
  agent (the freshest record). Inventory polls
  produce identical re-publishes when nothing
  changes; dedup picks the most recent state.
- **`where is_online="true"`** — drop offline /
  retired agents. **CRITICAL** — same filter as the
  markers and h3 companions. Without it,
  decommissioned agents at last-known coordinates
  inflate the heat blob, falsely implying live
  coverage in regions where agents are actually
  offline.
- **`where isnotnull(agent_lat) AND isnotnull(agent_lon)`** —
  drop agents without registered location. Same
  filter as markers / h3; surface dropped count in
  a companion table panel.
- **`join` subsearch (tests-per-agent)** — count
  distinct active tests per agent (same shape as
  markers / h3 companions). `dc(test_id)` excludes
  test re-runs. The result feeds the per-site
  `sum(test_count)` aggregation below.
- **`fillnull value=0 test_count`** — agents with no
  active tests get NULL from the join; promote to 0.
- **`stats count AS agent_count, sum(test_count) AS test_count BY agent_lat, agent_lon`** —
  THE pivotal line. Same per-site aggregation as the
  h3 companion. `count` is the agent count at this
  site; `sum(test_count)` is the total test load
  across agents at the site.
- **`rename agent_lat AS lat, agent_lon AS lon`** —
  adopt Better Map's canonical aliases (deferred
  until after `BY` so the source-of-truth field
  names appear in the aggregation).
- **`eventstats max(test_count) AS max_test_count`** —
  Better Map's heat layer expects `weight ∈ [0, 1]`;
  `eventstats` computes the dataset-wide max test
  load WITHOUT collapsing rows (vs `stats max` which
  would reduce to one row and break the per-site
  aggregation). Matches the
  [kvstore-latlon/heat](../kvstore-latlon/heat.md),
  [es-risk/heat](../es-risk/heat.md), and
  [itsi-kpi-base/heat](../itsi-kpi-base/heat.md)
  normalisation pattern.
- **`eval weight=round(if(max_test_count > 0, test_count / max_test_count, 0), 2)`** —
  per-site weight on `[0, 1]`. The `if` guard
  avoids NaN-divide when every agent has zero
  tests (max=0 → empty heat panel, correct
  behaviour for an idle deployment). To weight by
  AGENT count instead of TEST load, swap to
  `eventstats max(agent_count) AS max_agent_count`
  +
  `eval weight=round(if(max_agent_count > 0, agent_count / max_agent_count, 0), 2)`
  — the heat surface then renders agent footprint
  density rather than test-load concentration.
- **`eval id=lat . "_" . lon`** — heat layer doesn't
  strictly need `id` (per-feature identity is moot
  for a density grid), but the formatter `idField`
  enables the per-site hover popup. The `lat_lon`
  concatenation is stable because two sites cannot
  share both lat AND lon.
- **`fields ...`** — explicit projection. Drops
  `agent_id`, `agent_name`, `agent_type`, `country`,
  `network`, `os`, `version` (all per-agent fields
  that don't survive the per-site aggregation). For
  per-agent identity, use the markers companion.
- **`sort - test_count`** — most-loaded sites first
  (matters for the companion "Top 10 sites" table
  panel; the heat renderer itself is row-order-
  agnostic).
- **`head 5000`** — render budget. Largest
  enterprise ThousandEyes deployments run 1000-2000
  agents across 50-100 distinct sites; 5000 is the
  safe upper bound on per-site rows.

Every `|` starts its own physical line per the SPL
pipe-per-line contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field       | type    | example            |
|-------------|---------|--------------------|
| id          | string  | 37.7749_-122.4194  |
| lat         | number  | 37.7749            |
| lon         | number  | -122.4194          |
| agent_count | integer | 12                 |
| test_count  | integer | 47                 |
| weight      | number  | 1.0                |

All six fields appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `weight` is the
heat-layer-required intensity field; `agent_count`
and `test_count` are carried for popup display when
paired with a companion markers overlay (heat
layers don't expose per-feature popup directly).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.7,
  "heatmapRadius": 28
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to
  the heatmap renderer. The `auto` renderer
  switches to heatmap above ~200 features, so for
  smaller DEM deployments (50-200 agents) the recipe
  needs an explicit pin to force the heat rendering
  even when the per-site row count drops below 200.
- **`heatmapOpacity: 0.7`** — matches the
  [es-risk/heat](../es-risk/heat.md),
  [itsi-kpi-base/heat](../itsi-kpi-base/heat.md),
  [cim-performance/heat](../cim-performance/heat.md),
  and other heat recipes (every IT-infrastructure
  heat recipe in the matrix settled on `0.7` as the
  right tradeoff between blob visibility and
  basemap city-label survival). At 1.0 the heat
  fully occludes the city underlay; at 0.5 the heat
  is too washed out to read at low zoom; 0.7 is the
  sweet spot for a DEM / NetOps audience that needs
  to read both the heat gradient AND the underlying
  geography.
- **`heatmapRadius: 28`** — matches the
  [cim-performance/heat](../cim-performance/heat.md)
  recipe (DEM agents are spatially distributed
  similarly to cloud-region datacenters — Northern
  Virginia, Quincy Washington, Frankfurt — so the
  28-pixel radius merges all the in-region agents
  into a single readable "hub" blob at world zoom).
  For a more granular view that distinguishes
  per-availability-zone agent clusters, drop to
  18-22. For an executive-only "where is coverage?"
  view, raise to 32-36 for fewer, larger blobs.
- **`weight` drives heat intensity automatically.**
  The heat layer renderer auto-picks the `weight`
  field by name (per Better Map's `dataFitness.js`
  field aliasing). If you rename `weight` in the
  SPL, also set the formatter's `heatField` option
  — check
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)
  for the exact property name.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5) + a ThousandEyes verification tenant.
Reproduces the panel via the same `ta_cisco_thousandeyes`
+ `thousandeyes_agents` setup as the
[markers companion](./markers.md#5-screenshot)._

## 6. Gotchas

- **The `is_online="true"` filter is non-negotiable.**
  Same critical filter as the markers and h3
  companions. Without it, decommissioned agents at
  last-known coordinates inflate the heat blob and
  falsely imply live coverage. A heat panel
  showing "strong coverage in EMEA" might actually
  reflect 30 live + 17 offline EMEA agents — the
  audience would over-rate the actual measurement
  capacity by ~57%.
- **Weight choice (`test_count` vs `agent_count`)
  changes the panel's meaning.** The default recipe
  weights by `test_count`, rendering "DEM test-load
  concentration" — hot blobs are regions where the
  most measurement WORK happens. To render "DEM
  agent FOOTPRINT" instead (where blobs reflect
  agent count regardless of test load), swap the
  two `eventstats` / `eval weight` lines to use
  `agent_count` instead of `test_count` (see §2
  commentary). For most DEM strategy panels,
  `test_count` is the more useful weight because
  it captures "where is real measurement happening"
  rather than "where are agents merely DEPLOYED."
  Document the weight choice in the panel
  description.
- **Per-panel weight normalisation, NOT cross-
  panel.** The `eventstats max(test_count)`
  computes the max OVER THE EVENTS THIS PANEL
  RETURNS. A panel filtered to `is_online="true"`
  has a different max than a panel showing all
  agents (including offline). Cross-panel
  comparison of weight values is meaningless —
  always compare absolute `test_count` instead.
- **No hard borders by design.** The heat surface
  is intentionally borderless — coverage flows
  smoothly across continental boundaries. For
  jurisdictional aggregation with hard borders
  (e.g. "how many tests in the EU GDPR
  jurisdiction?"), use the [h3 companion](./h3.md)
  with `hexbinResolution: 3` instead. For per-
  agent identity (e.g. "WHICH agents are in this
  blob?"), use the [markers companion](./markers.md)
  with `pointRenderer: "cluster"`. The three-
  layer triplet covers all three audience needs
  on the same Dashboard Studio panel via the
  BM-CT-1 contract.
- **GDPR-safer than markers, less safe than h3-
  resolution-3.** The heat blob's smooth gradient
  collapses per-agent identity (an attacker
  cannot identify which agent is which) — but the
  blob's CENTROID and SIZE reveal per-site
  density, which an attacker could combine with
  public knowledge of cloud-region locations to
  approximate "the customer has heavy DEM coverage
  in Frankfurt / AWS eu-central-1." This is
  acceptable for a DEM strategy review (the
  cloud-region locations are public knowledge);
  document the consideration if the dashboard is
  shared with external auditors.
- **Agent location data quality cascades into the
  heat blob CENTROID.** Same caveat as the
  [h3 companion](./h3.md#6-gotchas) — the
  `agent_lat` / `agent_lon` auto-geocode paths
  (cloud-region centroid, BGP-NOC fallback) can
  drift several hundred kilometres from the true
  agent location. The heat blob then centres on
  the geocode artefact, not the true location.
  Acceptable for jurisdictional capacity planning;
  document the limitation.
- **The 28-pixel radius is too large for some
  audiences.** A radius of 28 merges all West Coast
  AWS regions into one big "California" blob,
  which is right for a global SRE leadership view
  but wrong for a US-region-team view that needs
  to distinguish `us-west-1` from `us-west-2`.
  Tune `heatmapRadius` per panel — drop to 18-22
  for sub-region granularity.
- **No OT-safety boundary.** Same as the markers /
  h3 / paths companions — ThousandEyes measures IT
  services only (HTTP, DNS, voice, BGP), not OT
  protocols. No OT carve-out applies.

## Verification status

**Status: unverified.** The recipe follows the wave-13
generalised recipe contract (`schema_version: 1` +
frontmatter + §1-§6) and has been smoke-tested locally
against the `build-recipe-index.py` +
`check-recipe-schema.py` gates; it has NOT been live-
tested against a real ThousandEyes tenant. The
verification pass deferred to wave 21+ pending D5
harness landing — at which point a real
`thousandeyes_agents` index + `ta_cisco_thousandeyes`
TA will be populated, the recipe re-run end-to-end
against a real agent inventory, and the
`verified_against` slot in this file's frontmatter
updated with the tenant signature.
