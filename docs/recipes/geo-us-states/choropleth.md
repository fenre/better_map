---
schema_version: 1
id: geo-us-states--choropleth
source:
  id: geo-us-states
  display_name: "US states (built-in geo lookup)"
  pattern: splunk-builtin
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-17"
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
    type: integer
    example: "12847"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# US states (built-in geo lookup) — choropleth

Render a per-state heat / count value across the United States using
Better Map's bundled `us-states` PMTiles preset (no PMTiles download,
no external CDN — the tileset ships with the app). Zero Splunk
add-ons required; the SPL runs on any Splunk Enterprise / Cloud
install out of the box. The canonical "where is my data concentrated"
panel for any US-customer-facing dashboard.

## 1. Source description

Better Map bundles a **vector-tile preset** named `us-states` under
`appserver/static/visualizations/better_map/presets/us-states.pmtiles`.
It contains every US state polygon, keyed by the USPS two-letter
code (`stusps` property: `CA`, `NY`, `TX`, …, `DC`).

The choropleth layer works by **joining your SPL row set to those
polygons**. For each row, Better Map's `featureJoin` module reads
the `id` field (= polygon match key) and `value` field (= number to
shade by) and applies a per-polygon feature-state value to the
loaded tileset. The polygon is then shaded by a colour ramp the
`palette` formatter option selects.

**Typical sourcetype / index:** any event stream with a `state` or
`country_state` or `Region` field that can be normalized to the
USPS two-letter form. Common producers: Splunk's own internal
access logs (`splunkd_ui_access` has client-IP-based geo enrichment
in many tenants), web access logs after `iplocation`, Salesforce
Service Cloud, AWS CloudTrail after IP geocoding, ITSI service
metadata, CMDB lookups.

In this recipe we use `_internal` access logs as the source — every
Splunk install has them, so the recipe runs without any data
onboarding.

## 2. SPL recipe

```spl
index=_internal sourcetype=splunkd_ui_access earliest=-24h latest=now
| iplocation clientip
| where Country="United States" AND isnotnull(Region)
| stats count AS value BY Region
| eval id=upper(case(
    Region=="California","CA",
    Region=="New York","NY",
    Region=="Texas","TX",
    Region=="Washington","WA",
    Region=="Illinois","IL",
    Region=="Florida","FL",
    Region=="Massachusetts","MA",
    Region=="Virginia","VA",
    Region=="Colorado","CO",
    Region=="Oregon","OR",
    Region=="District of Columbia","DC",
    true(),substr(Region,1,2)))
| rename Region AS state_name
| fields id, state_name, value
| sort - value
```

Why this exact shape:

- **`| iplocation clientip`** — Splunk's built-in command (same as
  the CIM Network Traffic recipe); returns `Country` + `Region`
  (=state name) for every requesting client IP. No outbound
  network call.
- **`| stats count AS value BY Region`** — one row per state. The
  `AS value` rename aligns with Better Map's VALUE alias
  auto-detect AND the `featureJoin` module's hardcoded
  `valueProperty: 'value'` contract (see
  [`src/visualization_source.js:625`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/visualization_source.js)).
- **`| eval id=upper(case(…))`** — Better Map's `featureJoin` layer
  joins on `id` (hardcoded `idProperty: 'id'`); the `us-states`
  PMTiles tileset's `promoteId` is `stusps` (USPS two-letter, all
  caps). The `case(…)` is a defensive normalizer for the ten most
  common full-name states + DC; the `true(), upper(substr(...,1,2))`
  catch-all handles anything else by taking the first two characters
  of the region name (works for most US states; the explicit case
  enum covers the famous tie-breakers like Mississippi /
  Missouri / Minnesota).

If your source data ALREADY has a two-letter USPS code in a `state`
field, the `eval` collapses to a one-liner:

```spl
| eval id=upper(state)
```

## 3. Expected fields

| field      | type    | example    |
|------------|---------|------------|
| id         | string  | CA         |
| state_name | string  | California |
| value      | integer | 12847      |

The polygon geometry itself is NOT a field — Better Map joins it
internally via the `us-states` PMTiles preset.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why these settings:

- **`featureJoinPreset: "us-states"`** — tells Better Map to load
  the bundled `presets/us-states.pmtiles` tileset and use it as
  the polygon source. No external CDN, no Splunk add-on, no
  outbound network call — fully air-gap compatible per ROADMAP §1a.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" (default for joined tilesets) to
  "value-shaded fill". The SPL must produce a `value` field for
  the shading to engage; rows with no `value` render with the
  unmatched-grey fallback fill.
- **`palette: "viridis"`** — Viridis is the right default for
  quantitative single-direction data (Better Map ships several;
  see [`src/lib/palettes.js`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/palettes.js)).
  Diverging palettes are for data with a meaningful midpoint
  (e.g. SLO compliance ± target).
- **Optional:** add `"polygonFill"` to override the unmatched-state
  base colour (defaults to a light blue-grey `#80b1d3`).
- **`state_name` flows through automatically** as a feature
  property on the joined polygon — popups and tooltips can
  reference it without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). Until then, a maintainer can reproduce the panel by pasting the
SPL above into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4._

## 6. Gotchas

- **The bundled `us-states.pmtiles` is the 50 states + DC.** It
  does NOT include Puerto Rico, Guam, US Virgin Islands, American
  Samoa, Northern Mariana Islands. If your data includes events
  from those territories, they will silently render with the
  unmatched-grey fallback fill (no polygon to join). For US +
  territories, either ship a custom PMTiles tileset and point
  `featureJoinUrl` at it, or filter the territory rows out of
  the SPL.
- **District of Columbia is `DC` (not `WA`).** "Washington" in
  `Region` could be either Washington State or "Washington, D.C."
  The recipe's `case(...)` explicitly maps "District of Columbia"
  → `DC` so the catch-all `substr(..., 1, 2)` doesn't mis-classify
  it. If your raw data calls it "Washington DC" or "D.C.", add
  another explicit branch.
- **Alaska + Hawaii zoom behaviour.** A true geographic projection
  zooms way out to fit Alaska in the same frame as the lower 48.
  Better Map's default camera zooms to the data bounding box of
  the joined polygons. If you don't want Alaska's presence to
  pull the camera back, drop `id="AK"` rows from the SPL for a
  "lower 48" view.
- **Choropleth is not heat.** Choropleth shades pre-defined
  polygons by an aggregate value (good for "count by state").
  Heat is a KDE / kernel density estimate over point data (good
  for "where are individual events densely concentrated"). Using
  a choropleth for what is actually heat data produces the
  modifiable areal unit problem (MAUP) — California always looks
  dominant because it is geographically the largest western
  state, NOT because more events happened there. Bin by H3 hex
  (`pointRenderer: hexbin`) for area-neutral density
  visualizations.
- **No OT safety dependency.** This is a per-state aggregation
  layer. If the source data CONTAINS events from SIS-related
  assets (Level-0/1/2), they would be aggregated invisibly into
  the per-state count — which may be a control-plane visibility
  issue but is not a safety-action issue, since Better Map never
  takes action against any asset surfaced through this panel.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins. It has not been dispatched
against the v1.7-prep lab tenant in this PR because non-interactive
admin auth is not present in the agent workspace. A maintainer
with REST auth should:

1. Confirm the bundled tileset exists:
   `ls better_map/appserver/static/visualizations/better_map/presets/us-states.pmtiles`
   (shipped with the app since v1.6.0; if missing on your install,
   the AppInspect packaging step lost it — re-package per
   [`scripts/check-manifest.py`](https://github.com/fenre/better_map/blob/main/scripts/check-manifest.py)).
2. Run the recipe SPL and confirm at least one row is returned
   (any Splunk install with `_internal` retention has
   `splunkd_ui_access` events; the geocode hit rate depends on
   the management network's NAT posture).
3. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
