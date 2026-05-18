---
schema_version: 1
id: csv-lookup-geo--polygons
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (geo polygons)"
  pattern: splunk-lookup
layer:
  id: polygons
  display_name: Polygons
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "ZONE-NORTH-01"
    drives_formatter_option: idField
  - name: zone_name
    type: string
    example: "North storage yard"
  - name: zone_type
    type: string
    example: "storage"
  - name: geojson
    type: string
    example: '{"type":"Polygon","coordinates":[[[-122.42,37.78],[-122.41,37.78],[-122.41,37.79],[-122.42,37.79],[-122.42,37.78]]]}'
  - name: area_m2
    type: number
    example: "12830"
required_formatter_options:
  - polygonFill
  - polygonOpacity
ot_safety_relevant: false
references:
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — polygons"
    path: "docs/reference/layers.md"
  - description: "polygons layer source (geojson + wkt field auto-detect contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/polygons.js"
---

# CSV lookup (geo polygons) — polygons

Render named polygon boundaries from a customer-owned CSV lookup —
asset zones, geofences, jurisdiction boundaries, fire-cell areas,
no-fly zones, branch-office service territories. Zero Splunk add-ons
required, zero ingestion pipeline, zero KV-Store schema work. The
simplest possible "draw these shapes on the map" recipe.

## 1. Source description

A **CSV lookup** is Splunk's most basic external-data primitive: a
file on disk under `<app>/lookups/<name>.csv`, exposed to SPL via a
`transforms.conf` stanza, queried with `| inputlookup <name>`. CSV
lookups have the following advantages over KV Store collections for
geometry data:

- **Diff-friendly**: a GIS team can author / edit polygons in
  QGIS, export to CSV, commit to git, and ship via a Splunk app
  update. No collection-state to migrate.
- **Versionable**: the polygon set is reproducible across
  environments — staging, prod, dev all read the same file.
- **AppInspect-clean**: ships inside the Splunk app package; no
  per-tenant setup step.

The recipe binds to a lookup named `asset_zones.csv` (rename to
match your install) with the columns `zone_id`, `zone_name`,
`zone_type`, `geojson`, `area_m2`.

The `geojson` column holds a single-line stringified GeoJSON
geometry — a `Polygon` (one ring of coordinates) or a `MultiPolygon`
(multiple disjoint rings). Other valid geometry types (LineString,
MultiLineString, Point) are rendered too, but for the "asset
boundary" use case Polygon is the typical shape.

**Typical sourcetype / index:** none — `| inputlookup` runs against
the CSV directly, no event ingestion is involved.

**One-time setup** (skip if your lookup already exists):

```spl
| makeresults
| eval zone_id="ZONE-NORTH-01", zone_name="North storage yard",
       zone_type="storage", area_m2=12830,
       geojson="{\"type\":\"Polygon\",\"coordinates\":[[[-122.42,37.78],[-122.41,37.78],[-122.41,37.79],[-122.42,37.79],[-122.42,37.78]]]}"
| append [
  | makeresults
  | eval zone_id="ZONE-SOUTH-02", zone_name="South production floor",
         zone_type="production", area_m2=8420,
         geojson="{\"type\":\"Polygon\",\"coordinates\":[[[-122.42,37.76],[-122.41,37.76],[-122.41,37.77],[-122.42,37.77],[-122.42,37.76]]]}"]
| fields - _time
| outputlookup asset_zones.csv
```

(The one-time setup is the only place `| makeresults` is allowed in
this recipe — it is bootstrap data, not panel data. Per ROADMAP §1a
and the Splunk SPL anti-pattern rules, `| makeresults` is BANNED
inside dashboard `dataSources` queries.)

In production you would NOT generate the GeoJSON this way — you
would export from a GIS tool. The
[`splunk-lookups` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-lookups.mdc)
documents the CSV+transforms.conf contract.

## 2. SPL recipe

```spl
| inputlookup asset_zones.csv
| rename zone_id AS id
| fields id, zone_name, zone_type, geojson, area_m2
```

That's the whole panel search. No time predicate — CSV reads are
time-independent. No `stats` — every row is a polygon.

The `| rename zone_id AS id` is what lets Better Map's drilldown
and cross-panel coordination work without setting `idField` in the
formatter: `id` is in the auto-detected alias list (`id`,
`feature_id`, `iso`, `iso2`, `iso3`, `admin1`, `state`, `country`).

The `geojson` column is auto-detected as the geometry source — no
`geometryField` formatter override required. Better Map's
`dataFitness.js` walks the row schema looking for a field named
`geojson` / `geometry` / `wkt` in that priority order; the first
match wins.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field     | type   | example                                            |
|-----------|--------|----------------------------------------------------|
| id        | string | ZONE-NORTH-01                                      |
| zone_name | string | North storage yard                                 |
| zone_type | string | storage                                            |
| geojson   | string | `{"type":"Polygon","coordinates":[[[…]]]}`         |
| area_m2   | number | 12830                                              |

All five fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.

The `geojson` example value is the canonical GeoJSON geometry
form per [RFC 7946 §3.1.6](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6).
Coordinates are `[longitude, latitude]` order — the historical
GeoJSON gotcha that bites every team once. WKT (`POLYGON((-122.42
37.78, -122.41 37.78, ...))`) is also accepted via a `wkt` column;
see the [`polygons` layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/polygons.js)
for the auto-detect priority.

## 4. Recommended formatter config

```json
{
  "polygonFill": "#3b82f6",
  "polygonOpacity": 0.35
}
```

Why this config:

- **`polygonFill: "#3b82f6"`** — a calm blue. The colour is
  customer-overrideable via the formatter colour picker for
  brand alignment, but the default is intentionally low-saturation
  so polygons read as overlays, not heatmaps. For multi-zone
  views where different `zone_type` values should render
  differently, drive colour from data instead via the categorical
  palette path (see the
  [`splunk-dashboard-studio` rule](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-dashboard-studio.mdc)
  for the `> if(value == ...)` dynamic-option pattern).
- **`polygonOpacity: 0.35`** — semi-transparent so the basemap
  context stays visible. Drop to 0.2 for dense polygon meshes
  (>100 polygons visible); raise to 0.6 for sparse overviews
  (<10 polygons visible).
- **No `pointRenderer` set** — polygons are auto-routed by the
  presence of the `geojson` / `wkt` column. If the same panel
  carries BOTH point rows (lat/lon) AND polygon rows (geojson),
  Better Map renders both layers stacked. Use the `layerField`
  formatter option (a per-row layer-id column) for explicit
  control.
- **`zone_name` and `zone_type` flow through automatically** as
  feature properties on the rendered GeoJSON — popups, tooltips,
  and drilldown actions can reference them by name.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker harness (ROADMAP §3 D5
Phase 1 SHIPPED — Playwright Phase 2 still pending). Until then, a
maintainer can reproduce the panel by pasting the SPL above into a
Dashboard Studio map panel with Better Map as the visualization and
applying the formatter JSON in §4. The IoT smart-building demo
preset (`demoPreset: "iot-smart-building"` — D6 SHIPPED) demonstrates
floor-shape polygons rendered with the same options if you don't
have an asset-zones lookup handy._

## 6. Gotchas

- **CSV escaping inside GeoJSON.** A GeoJSON polygon string
  contains nested double-quotes. CSV requires that those be
  escaped per RFC 4180: surround the field value in `"..."` and
  double every internal `"`. The `| outputlookup` bootstrap above
  does this correctly because `eval` quotes are runtime values;
  when authoring the CSV by hand or exporting from QGIS, validate
  by `| inputlookup asset_zones.csv | head 1 | eval g=geojson |
  table g` — if you see literal `\"` in the output, the file is
  double-escaped (`"`-inside-`"` was written as `\"` instead of
  `""`). Fix at export time, not in SPL.
- **Coordinate order.** GeoJSON is `[longitude, latitude]`.
  WKT is `longitude latitude`. Most non-GIS data sources will
  give you `latitude, longitude` order — that's wrong for both
  geometry forms and will plot every polygon in the Atlantic
  Ocean or near Antarctica. Flip with a quick `eval` if you
  have only point pairs; for polygons re-export from the GIS
  tool with the right axis order set.
- **Polygon closure.** GeoJSON `Polygon` rings MUST close — the
  first and last coordinate pair MUST be identical. QGIS exports
  this correctly; hand-authored polygons sometimes don't, and
  Better Map's MapLibre renderer silently drops unclosed
  geometries. Validate with `| inputlookup asset_zones.csv |
  eval first=substr(geojson, 1, 200) | table id, first` and look
  for the first/last coordinate pair to match.
- **Lookup file size.** Splunk's default
  `[lookup] max_memtable_bytes = 25000000` (25 MB) is the lookup
  RAM ceiling. A CSV with 500 detailed building polygons can
  push 50 MB. If your lookup is bigger, switch to a KV Store
  collection with `replicate = true` — the trade-off is loss of
  git-diff friendliness for unbounded size. Document the choice
  in the
  [`splunk-lookups` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-lookups.mdc)
  decision-tree pattern.
- **Polygon-fill clipping.** MapLibre clips polygon fills at the
  tile edge; very large polygons (e.g. a whole-country geofence)
  rendered at city zoom show seams at vector-tile boundaries.
  This is a MapLibre engine behaviour; the workaround is to
  pre-clip large polygons into smaller pieces before storing in
  the CSV. For the typical asset-zone / branch-territory use
  case, polygons are small enough that this isn't a problem.
- **No OT safety dependency, BUT.** If your `asset_zones` lookup
  ALSO contains entries for SIS-related boundaries (control-
  room geofences, hazardous-zone perimeters, BPCS-vs-SIS
  separation lines), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — flag those rows with a `safety_related: true`
  column and render them in a DEDICATED, visually distinct layer
  with a hand-curated popup that says "READ ONLY — SIS-defined
  boundary, no action permitted from this panel." Better Map MUST
  NOT be the surface that takes action against an SIS-related
  asset, including via drilldown into a SOAR playbook keyed off
  the polygon's `zone_id`.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and follows the documented CSV-lookup and GeoJSON contracts
(see references) but it has not been dispatched against a real
`asset_zones.csv` lookup in the v1.7-prep development cycle (the
lab tenant does not have a populated zones lookup). A maintainer
with write access to a Splunk dev tenant should:

1. Run the one-time setup `| outputlookup asset_zones.csv` once,
   OR drop a hand-authored CSV with the documented schema into
   `<app>/lookups/asset_zones.csv` and add a matching
   `[asset_zones]` stanza in `transforms.conf`.
2. Run the panel SPL and confirm ≥ 2 rows return with the five
   documented fields, the GeoJSON validates as a `Polygon` or
   `MultiPolygon`, and the panel renders the polygons inside the
   map viewport.
3. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 10.0 against a
   12-zone asset-boundary CSV exported from QGIS"), and submit a
   follow-up PR. The CI gate `scripts/check-recipe-schema.py`
   will accept the change without touching the schema.

The D5 Phase 1 harness (`docker/`) makes this a 5-minute round-trip
once an operator has a polygons CSV to point it at — drop the file
into `docker/staging/better_map/lookups/`, re-run
`bash docker/scripts/bootstrap.sh`, dispatch the panel — see the
[local Splunk harness operator guide](https://github.com/fenre/better_map/blob/main/docs/development/local-splunk-harness.md).
