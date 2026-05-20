---
schema_version: 1
id: csv-lookup-geo--extrusion-3d
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (region metrics)"
  pattern: splunk-lookup
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-06-01"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "CA"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "California"
  - name: value
    type: number
    example: "847.3"
    drives_formatter_option: extrusionHeightField
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, vector-tile-join layer (customer-PMTiles flat-fill sibling — same | inputlookup input shape, different join target)"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "Companion recipes — same source, markers / supercluster / polygons / paths / h3 / heat layers"
    path: "docs/recipes/csv-lookup-geo/markers.md"
  - description: "Pattern reference — extrusion-3d on CIM Performance (sibling US-states preset, additive choropleth+extrusion double-encoding contract)"
    path: "docs/recipes/cim-performance/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on CIM Alerts (sibling US-states preset, height-encoded SOC metric)"
    path: "docs/recipes/cim-alerts/extrusion-3d.md"
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
---

# CSV lookup (region metrics) — US states 3D extrusion

Render a per-state value from a customer-owned CSV (sales,
incidents, SLO compliance, operational health, headcount, etc.)
as a **3D-extruded US-states prism** over the bundled
`us-states.pmtiles` preset. Per-state height + colour both
encode the CSV's `value` column. This is the "bring your own
state-aggregated CSV" recipe — used when the data is already
pre-aggregated upstream (warehouse roll-up, planning
spreadsheet, manually-curated metric table) rather than
computed live from Splunk events.

The right shape for **executive scorecard panels driven by
business-intelligence outputs** (e.g., monthly per-state sales
totals from a finance data warehouse exported as CSV), **per-
state SLO compliance reviews** (where the SLO computation runs
elsewhere and produces a per-region CSV), and **air-gap-friendly
operational maps** where the data source is intentionally NOT
an event index (smaller security review surface, simpler audit
trail).

The **8th extrusion-3d recipe in the matrix** — joining
[geo-us-states](../geo-us-states/extrusion-3d.md),
[cim-network-traffic](../cim-network-traffic/extrusion-3d.md),
[cim-authentication](../cim-authentication/extrusion-3d.md),
[cim-alerts](../cim-alerts/extrusion-3d.md),
[cim-performance](../cim-performance/extrusion-3d.md),
[meraki](../meraki/extrusion-3d.md), and
[splunk-stream](../splunk-stream/extrusion-3d.md). This advances
the extrusion-3d layer column from 7 cells to 8, and brings the
csv-lookup-geo source row from 7 cells to 8 (markers, h3, heat,
supercluster, paths, polygons, vector-tile-join, plus
extrusion-3d now) — the second-most-complete row in the matrix
after the CIM Network Traffic and CIM Performance 8-cell rows.

Zero Splunk add-ons required. The CSV is operator-maintained on
the search head; the US-states polygon geometry lives in the
bundled `presets/us-states.pmtiles` file. No external API calls.

## 1. Source description

Same **CSV lookup** mechanism as the
[markers](./markers.md), [supercluster](./supercluster.md), and
[vector-tile-join](./vector-tile-join.md) siblings — a CSV file
under `<app>/lookups/<name>.csv` exposed via a `transforms.conf`
stanza, queried with `| inputlookup <name>`. The recipe binds
to a lookup named `state_metrics.csv` (rename to match your
install) with the columns `state_code` (USPS 2-letter:
"CA" / "TX" / "NY"), `state_name`, and `value`.

The recipe's contract (same as the
[vector-tile-join sibling §1](./vector-tile-join.md#1-source-description)
philosophically — the small dataset lives in the CSV, the big
dataset is the polygon geometry):

- **Customer owns the CSV.** The recipe assumes you have a
  pre-aggregated state-level CSV available as a Splunk lookup.
  Aggregating raw events into per-state rows is OUT of scope
  for this recipe — for live event-driven aggregation use the
  [cim-performance/extrusion-3d](../cim-performance/extrusion-3d.md),
  [cim-alerts/extrusion-3d](../cim-alerts/extrusion-3d.md), or
  [splunk-stream/extrusion-3d](../splunk-stream/extrusion-3d.md)
  recipes (live `tstats` / `iplocation` / `geom geo_us_states`
  chains).
- **The CSV's `state_code` column matches the
  `us-states.pmtiles` `promoteId`** — that's the USPS 2-letter
  code (`stusps`: "CA", "TX", "NY", "DC"). Same join contract
  as every other US-states recipe in the matrix.
- **The CSV's `value` column is numeric.** The choropleth
  shading + extrusion height both consume `value` — non-numeric
  rows render with the unmatched-grey fallback fill and
  zero-height prism.

**Typical sourcetype / index:** none — `| inputlookup` runs
against the CSV directly, no event ingestion involved. (Some
production dashboards `| stats sum(value) BY state_code` over
real events and feed THAT into the lookup — see §6 Gotchas for
the "summary-search join" pattern.)

**Why extrusion-3d for a CSV.** The CSV pattern is the canonical
"data lives elsewhere, Splunk renders it" recipe — perfect for
business-intelligence outputs (warehouse roll-ups, manually-
curated planning metrics, externally-computed SLO scores) where
the EVENT-driven recipes don't fit. The extrusion variant adds
**rank visibility for sparse CSVs** where only a handful of
states have non-zero values — the prism height pre-attentively
ranks the top states even when colour ramp saturates.

The use cases this recipe unlocks beyond the
[vector-tile-join sibling](./vector-tile-join.md):

- **Finance / sales per-region dashboards** — monthly per-state
  revenue from a warehouse-exported CSV, height-encoded for
  rank visibility at executive shareholder reviews.
- **SLO compliance scorecards** — externally-computed SLO
  scores per region (where the SLO logic runs in a dedicated
  observability stack and Splunk is the executive presentation
  layer), height-encoded with magma palette for "where are we
  falling behind".
- **Headcount / capacity planning views** — per-state
  workforce totals from an HR system exported as CSV,
  height-encoded for "where do we need the next hire" visual.
- **Compliance / regulatory metric reviews** — per-state
  filing counts, breach notifications, audit findings — all
  data that lives in a compliance system, not in Splunk
  events, but where the per-state choropleth + extrusion is
  the right executive surface.

**One-time setup** (skip if your lookup already exists):

```spl
| makeresults
| eval state_code="CA", state_name="California", value=847.3
| append [
  | makeresults
  | eval state_code="TX", state_name="Texas", value=612.8]
| append [
  | makeresults
  | eval state_code="NY", state_name="New York", value=534.1]
| append [
  | makeresults
  | eval state_code="VA", state_name="Virginia", value=421.6]
| append [
  | makeresults
  | eval state_code="WA", state_name="Washington", value=298.4]
| fields - _time
| outputlookup state_metrics.csv
```

(The one-time setup is the only place `| makeresults` is allowed
in this recipe — it is bootstrap data, not panel data. Per
ROADMAP §1a and the Splunk SPL anti-pattern rules, `| makeresults`
is BANNED in panel SPL because it bypasses time-range filtering
and can't be distributed.)

After the `| outputlookup`, register the lookup in
`transforms.conf` (already done if you use the Splunk Web lookup
UI). See the [Splunk lookups
skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-lookups/SKILL.md)
for the full transforms.conf stanza pattern.

## 2. SPL recipe

```spl
| inputlookup state_metrics.csv
| rename state_code AS id
| fields id, state_name, value
| sort - value
```

What the pipeline does, stage by stage:

- **`| inputlookup state_metrics.csv`** — pulls every row of
  the CSV into the search pipeline. CSV lookups are cached in
  memory on the search head; this is a sub-millisecond
  operation for the typical 51-row state lookup. Same shape
  as the
  [vector-tile-join sibling §2](./vector-tile-join.md#2-spl-recipe).
- **`| rename state_code AS id`** — Better Map's `featureJoin`
  layer hardcodes `idProperty: 'id'` as the per-row join key.
  The bundled `us-states.pmtiles` `promoteId` is `stusps` (USPS
  2-letter code), so the CSV's `state_code` column must contain
  the 2-letter USPS code. Same `id` aliasing contract as every
  other recipe in the matrix.
- **`| fields id, state_name, value`** — trim to the three
  fields the panel actually consumes. `state_name` flows
  through as a feature property for popups; `value` drives
  BOTH the choropleth fill AND the extrusion height (per the
  formatter contract in §4).
- **`| sort - value`** — highest-value states first. The
  extrusion is row-order-agnostic; sorting helps when the
  same data feeds a companion "Top 10 states by <metric>"
  table panel.
- **No `head` cap.** Maximum row count is 51 (50 states + DC),
  well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

For a **live-events variant** (where the per-state aggregation
runs over real Splunk events rather than reading a pre-rolled
CSV), use the
[cim-performance/extrusion-3d](../cim-performance/extrusion-3d.md),
[cim-alerts/extrusion-3d](../cim-alerts/extrusion-3d.md), or
[splunk-stream/extrusion-3d](../splunk-stream/extrusion-3d.md)
recipes instead — each demonstrates the `tstats` + `iplocation`
+ `geom geo_us_states` + per-state aggregation chain that this
recipe deliberately avoids.

## 3. Expected fields

| field      | type   | example      |
|------------|--------|--------------|
| id         | string | CA           |
| state_name | string | California   |
| value      | number | 847.3        |

The polygon geometry itself is NOT a field — Better Map fetches
it internally from the bundled `presets/us-states.pmtiles` file
referenced via `featureJoinPreset: "us-states"` in §4.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": "true",
  "extrusionHeightField": "value",
  "extrusionScale": 10000.0,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). Same preset as all eight other
  US-state choropleth / extrusion recipes in the matrix.
- **`enable3DExtrusion: "true"`** — switches the polygon
  rendering from flat-fill to extruded-prism. Without this
  option set, `extrusionHeightField` and `extrusionScale` are
  silently ignored — the panel falls back to choropleth-only
  behaviour (functionally equivalent to a swapped-preset
  variant of the [csv-lookup-geo/vector-tile-join](./vector-tile-join.md)
  sibling).
- **`extrusionHeightField: "value"`** — the column that drives
  the prism's vertical height. Same column drives the
  choropleth fill via the implicit `value` contract, so the
  panel is double-encoded: height + colour both rank the CSV
  metric.
- **`extrusionScale: 10000.0`** — the multiplier that converts
  the `value` field's numeric range to meters of polygon
  height. Because the CSV's `value` is operator-supplied (could
  be 0-100 SLO scores, 0-1000 incident counts, 0-1M revenue
  dollars), the scale MUST be tuned per CSV. Visual rule of
  thumb: the tallest state's prism should extend ~1/3 the
  screen height when the panel is sized to fill the dashboard
  at 30° camera pitch. Worked examples:
  - SLO compliance 0-100 (%): `extrusionScale: 5000.0`
  - Incident counts 0-1,000: `extrusionScale: 500.0`
  - Revenue 0-10M ($): `extrusionScale: 0.05`
  - Headcount 0-10,000: `extrusionScale: 50.0`
  Iterate the scale in the formatter sidebar until the tallest
  prism reads as "obviously tall" without obscuring its
  neighbours.
- **`enableChoropleth: "true"`** — keeps the colour shading
  enabled alongside the extrusion (double encoding). To get
  a height-ONLY view (uniform-coloured prisms, height-encoded
  rank), set `enableChoropleth: "false"`. The double-encoded
  view is recommended for executive readability.
- **`palette: "viridis"`** — perceptually uniform single-
  direction palette. Default for csv-lookup-geo recipes (same
  as the
  [vector-tile-join sibling §4](./vector-tile-join.md#4-recommended-formatter-config))
  because the CSV's `value` is operator-supplied — the recipe
  doesn't know whether higher values are "good" (revenue,
  SLO compliance) or "bad" (incidents, exposure). For
  alerting-framed CSVs (incidents, breaches, SLO breaches)
  swap to `magma` (warm-equals-attention). For divergent data
  (SLO ± target) use `rdbu` with `colorScaleMid` set to the
  zero-line value.

For a **height-only variant** (uniform-coloured prisms), drop
`enableChoropleth` and `palette` from the formatter config —
the panel renders as monochrome prisms with height-encoded
rank, easier to interpret for colour-blind viewers and
print-only audiences.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). Until then, reproduce by (a) writing the §1 bootstrap
SPL to populate `state_metrics.csv`, (b) registering the lookup
in `transforms.conf`, (c) pasting the §2 SPL into a Dashboard
Studio map panel with Better Map as the visualization and
applying the §4 formatter JSON. The panel should render per-
state extruded prisms over the bundled US-states polygons, with
California (847.3) the tallest prism if the bootstrap data
is used unchanged. The 3D extrusion is best demoed with the
camera tilted ~35° via the on-map camera widget (which honours
`allowPitch: true`, the formatter-schema default)._

## 6. Gotchas

- **CSV column names ARE the contract.** The recipe's `|
  rename state_code AS id` assumes the CSV's first column is
  named `state_code`. If your CSV uses `state`, `stusps`,
  `usps_code`, or any other variation, adjust the rename.
  Similarly `state_name` and `value` must match the §3
  expected-fields contract — Better Map's choropleth /
  extrusion layers consume those exact field names.

- **USPS code case sensitivity.** Same caveat as the
  [csv-lookup-geo/vector-tile-join §6 Gotchas](./vector-tile-join.md#6-gotchas):
  `featureJoinPromoteId` is case-sensitive. The bundled
  `us-states.pmtiles` `promoteId` is `stusps` with UPPERCASE
  2-letter codes ("CA", "TX", "NY"). Mixed-case CSV values
  ("Ca", "ca") will fail to join. Force uppercase via `| eval
  id=upper(id)` if your source data has inconsistent casing.

- **`extrusionScale` requires per-CSV tuning.** Unlike the
  choropleth's colour ramp, which auto-scales to the data
  range, extrusion height is a multiplicative function of the
  raw `value` × `extrusionScale`. A scale tuned for SLO
  scores (0-100) makes prisms invisible for incident-count
  data (0-1000); a scale tuned for revenue-dollars makes
  prisms tower above the map for headcount data. See the §4
  tuning table for the worked examples by metric type, and
  iterate in the formatter sidebar.

- **Camera angle affects pre-attentive height ranking.** Same
  caveat as the
  [cim-performance/extrusion-3d §6](../cim-performance/extrusion-3d.md#6-gotchas):
  the default 45° pitch is the best tradeoff; lock the panel's
  initial pitch in `mapInitialPitch` (formatter option) to
  ensure consistent executive viewing — different camera
  angles can flip which state visually "wins" on first
  glance.

- **Saturation moves from colour to height — but only above
  the visual ceiling.** Same caveat as
  [cim-performance/extrusion-3d §6](../cim-performance/extrusion-3d.md#6-gotchas):
  once a single state's prism reaches the visual ceiling,
  subsequent rank-rises in that state become imperceptible.
  Mitigate via (a) capping `extrusionScale` so the worst-case
  state reaches only ~60% of the panel height, or (b)
  surfacing the `value` in the popup so the operator can
  read the exact figure even when the prism saturates.

- **Live-events variant — `| stats sum(...) BY state` over
  real events.** If your CSV is itself produced by a Splunk
  search (e.g., a daily summary search that aggregates events
  per state and writes to the lookup), the SPL pattern is:
  ```spl
  index=foo earliest=-24h
  | iplocation src_ip
  | where Country="United States"
  | stats sum(metric) AS value BY Region
  | eval state_code=upper(case(Region=="California","CA", ...))
  | rename state_code AS id
  | fields id, value
  | sort - value
  ```
  Same approach used by
  [cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
  and [cim-alerts/choropleth](../cim-alerts/choropleth.md);
  this recipe deliberately stays at the `| inputlookup` level
  to keep the CSV pattern pure (data lives elsewhere). The
  warehouse-derived workflow (CSV updated nightly from a BI
  pipeline) is the canonical motivation for keeping the SPL
  at one stage.

- **State-area bias (MAUP).** Same caveat as all US-state
  choropleths and extrusions: California / Texas / New York /
  Virginia host the largest populations / economies, so they
  will tend to dominate both the colour and the height
  encoding. For a per-capita-normalised view, pre-aggregate
  the CSV with `value=metric / state_population` upstream
  (the CSV pattern is well-suited to this — the BI pipeline
  can do the normalisation before the CSV export).

- **Mismatched state codes silently drop.** A CSV row with
  `state_code="ZZ"` (no such USPS state) renders nowhere —
  Better Map's `featureJoin` layer silently skips
  unmatched-`id` rows. Add a diagnostic SPL run that joins
  `| inputlookup state_metrics.csv` against the bundled
  `geo_us_states` lookup (`| lookup geo_us_states stusps AS
  state_code | where isnull(_geom)`) to surface orphan rows.

- **The pre-built `featureJoinPreset` is the easy-mode
  alternative to custom PMTiles.** Same caveat as the
  [csv-lookup-geo/vector-tile-join §6](./vector-tile-join.md#6-gotchas):
  the `us-states` preset is bundled, AppInspect-clean, and
  requires zero CSP configuration. Only reach for
  `featureJoinUrl` when the bundled options don't fit your
  geography — but for US-state-aggregated CSVs, the bundled
  preset IS the right answer.

- **No OT-safety dependency.** This recipe ingests bootstrap
  CSV data and renders it on US-state polygons. The CSV may
  carry data DERIVED from OT events (per-site equipment
  failure counts rolled up to per-state in a BI pipeline), but
  the recipe itself never reads from a Level-0/1/2 source.
  The OT-safety boundary lives in the upstream pipeline that
  produces the CSV, not in this recipe.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, uses only Splunk built-ins (`inputlookup`, `rename`,
`fields`, `sort`), and the formatter contract (`featureJoinPreset:
"us-states"` + `enable3DExtrusion` + `extrusionHeightField:
"value"` + `extrusionScale` + `enableChoropleth` + `palette`)
mirrors the verified-by-unit-test extrusion-3d path exercised by
the
[cim-performance/extrusion-3d](../cim-performance/extrusion-3d.md),
[cim-alerts/extrusion-3d](../cim-alerts/extrusion-3d.md), and
[geo-us-states/extrusion-3d](../geo-us-states/extrusion-3d.md)
companions. The PMTiles fetch + choropleth fill + extrusion
rendering behaviour is covered by Better Map's own `featureJoin`
module unit tests. The end-to-end "this recipe's `| inputlookup`
+ a populated `state_metrics.csv` + the bundled `us-states.pmtiles`
preset renders a per-state extruded prism in a Splunk Dashboard
Studio panel" path has not been dispatched against the v1.7-prep
lab tenant in this PR because the lab tenant does not carry a
populated `state_metrics.csv`. A maintainer with REST auth and a
populated state-metrics CSV should:

1. Write the §1 bootstrap SPL to populate `state_metrics.csv`
   (or supply a customer-specific CSV with the
   `state_code,state_name,value` schema).
2. Register the lookup in `transforms.conf`.
3. Paste the §2 SPL into a Dashboard Studio map panel with
   Better Map as the visualization, applying the §4 formatter
   JSON.
4. Confirm the choropleth-extrusion renders (at least one state
   shaded + extruded above the map plane).
5. Right-drag the panel to tilt the camera and confirm the 3D
   prisms are visible.
6. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
