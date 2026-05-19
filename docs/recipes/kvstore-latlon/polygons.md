---
schema_version: 1
id: kvstore-latlon--polygons
source:
  id: kvstore-latlon
  display_name: "KV Store (geo polygons collection)"
  pattern: splunk-lookup
layer:
  id: polygons
  display_name: Polygons
status: unverified
last_verified_iso8601: "2026-05-22"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "ZONE-PLANT-A"
    drives_formatter_option: idField
  - name: zone_name
    type: string
    example: "Plant A production floor"
  - name: zone_type
    type: string
    example: "production"
  - name: geojson
    type: string
    example: '{"type":"Polygon","coordinates":[[[-95.37,29.76],[-95.36,29.76],[-95.36,29.77],[-95.37,29.77],[-95.37,29.76]]]}'
  - name: owner_team
    type: string
    example: "manufacturing-ops"
required_formatter_options:
  - polygonFill
  - polygonOpacity
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-site identity)"
    path: "docs/recipes/kvstore-latlon/markers.md"
  - description: "Companion recipe — same source, heat/h3/supercluster/paths layers"
    path: "docs/recipes/kvstore-latlon/heat.md"
  - description: "Pattern reference — polygons on CSV-lookup-anchored geometry (sibling singleton until now)"
    path: "docs/recipes/csv-lookup-geo/polygons.md"
  - description: "Splunk lookups skill — KV Store lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — polygons"
    path: "docs/reference/layers.md"
  - description: "polygons layer source (geojson + wkt field auto-detect contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/polygons.js"
---

# KV Store (geo polygons collection) — polygons

Render named polygon boundaries from a customer-managed KV Store
collection — asset zones, sales territories, fire-cell areas, branch
service territories, restricted-access perimeters, geofences. The
**second source** to demonstrate the polygons layer (alongside the
existing [csv-lookup-geo/polygons](../csv-lookup-geo/polygons.md)
companion), promoting the polygons layer **out of the singleton-trap
region**.

KV Store is the right home for polygons when the geometry set:

- changes frequently (a GIS team can `outputlookup` updates without a
  Splunk app redeploy)
- requires row-level RBAC (e.g., territory polygons restricted to the
  sales region's regional director)
- needs to participate in a join with telemetry indexed elsewhere (KV
  Store queries are first-class in SPL)
- spans search heads in a SHC (KV replicates automatically)

## 1. Source description

A KV Store collection named `site_polygons` (rename to match your
install) holds one row per polygon boundary, with columns:

| column     | type   | purpose                                              |
|------------|--------|------------------------------------------------------|
| `zone_id`  | string | per-zone unique key (joined to telemetry, drilldown) |
| `zone_name`| string | human-readable label                                 |
| `zone_type`| string | category (e.g., `production`, `storage`, `office`)   |
| `geojson`  | string | stringified GeoJSON `Polygon` or `MultiPolygon`      |
| `owner_team`| string | RBAC / ownership annotation                          |

The `geojson` column holds a single-line stringified GeoJSON geometry
per [RFC 7946 §3.1.6](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6).
The collection is defined in `collections.conf` + `transforms.conf`
per the three-file lookup contract (see the
[splunk-lookups skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-lookups.mdc)).

**Typical sourcetype / index:** none — `| inputlookup` runs against
the KV Store collection directly, no event ingestion is involved.

**One-time setup** (skip if your collection already exists):

```spl
| makeresults
| eval zone_id="ZONE-PLANT-A", zone_name="Plant A production floor",
       zone_type="production", owner_team="manufacturing-ops",
       geojson="{\"type\":\"Polygon\",\"coordinates\":[[[-95.37,29.76],[-95.36,29.76],[-95.36,29.77],[-95.37,29.77],[-95.37,29.76]]]}"
| append [
  | makeresults
  | eval zone_id="ZONE-PLANT-B", zone_name="Plant B storage yard",
         zone_type="storage", owner_team="manufacturing-ops",
         geojson="{\"type\":\"Polygon\",\"coordinates\":[[[-95.39,29.76],[-95.38,29.76],[-95.38,29.77],[-95.39,29.77],[-95.39,29.76]]]}"]
| fields - _time
| outputlookup site_polygons
```

(The one-time setup is the only place `| makeresults` is allowed in
this recipe — it is bootstrap data, not panel data. Per ROADMAP §1a
and the Splunk SPL anti-pattern rules, `| makeresults` is BANNED
inside dashboard `dataSources` queries.)

In production you would NOT generate the GeoJSON inline — you would
export polygon geometry from a GIS tool (QGIS, ArcGIS) to GeoJSON,
then `outputlookup` the rows into the KV Store collection from a
nightly saved-search.

## 2. SPL recipe

```spl
| inputlookup site_polygons
| rename zone_id AS id
| fields id, zone_name, zone_type, geojson, owner_team
```

That's the whole panel search. No time predicate — KV Store reads are
time-independent. No `stats` — every row is a polygon.

The `| rename zone_id AS id` is what lets Better Map's drilldown and
cross-panel coordination work without setting `idField` in the
formatter: `id` is in the auto-detected alias list (`id`, `feature_id`,
`iso`, `iso2`, `iso3`, `admin1`, `state`, `country`).

The `geojson` column is auto-detected as the geometry source — no
`geometryField` formatter override required. Better Map's
`dataFitness.js` walks the row schema looking for a field named
`geojson` / `geometry` / `wkt` in that priority order; the first match
wins.

For territory-restricted views, layer a `WHERE` filter that respects
the calling user's RBAC scope (e.g.,
`| inputlookup site_polygons WHERE owner_team="manufacturing-ops"`).
KV Store does NOT enforce row-level RBAC server-side — the filter is
the responsibility of the SPL author. For true row-level enforcement,
deploy the polygons under a per-team collection name (e.g.,
`site_polygons_manufacturing`, `site_polygons_sales`) and apply
collection-level ACLs via `metadata/default.meta` instead.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field      | type   | example                                                                  |
|------------|--------|--------------------------------------------------------------------------|
| id         | string | ZONE-PLANT-A                                                             |
| zone_name  | string | Plant A production floor                                                 |
| zone_type  | string | production                                                               |
| geojson    | string | `{"type":"Polygon","coordinates":[[[-95.37,29.76],[…]]]}`                |
| owner_team | string | manufacturing-ops                                                        |

All five fields appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

`zone_name`, `zone_type`, and `owner_team` flow through automatically
as feature properties on the rendered GeoJSON — popups, tooltips, and
drilldown actions can reference them by name.

## 4. Recommended formatter config

```json
{
  "polygonFill": "#3b82f6",
  "polygonOpacity": 0.35
}
```

Why this config:

- **`polygonFill: "#3b82f6"`** — a calm blue. Customer-overrideable
  via the formatter colour picker for brand alignment. The default is
  intentionally low-saturation so polygons read as overlays, not
  heatmaps. For multi-zone views where different `zone_type` values
  should render differently, drive colour from data via the
  categorical palette path (see the
  [splunk-dashboard-studio rule](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-dashboard-studio.mdc)
  for the `> if(value == ...)` dynamic-option pattern).
- **`polygonOpacity: 0.35`** — semi-transparent so the basemap stays
  visible. Drop to 0.2 for dense polygon meshes (>100 polygons
  visible); raise to 0.6 for sparse overviews (<10 polygons visible).
- **No `pointRenderer` set** — polygons are auto-routed by the
  presence of the `geojson` column. If the same panel carries BOTH
  point rows (lat/lon) AND polygon rows (geojson), Better Map renders
  both layers stacked. Use the `layerField` formatter option (a
  per-row layer-id column) for explicit control.
- **`zone_name`, `zone_type`, `owner_team` flow through automatically**
  as feature properties on the rendered GeoJSON.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker harness (ROADMAP §3 D5 Phase
1 SHIPPED — Playwright Phase 2 still pending). Until then, a maintainer
can reproduce the panel by populating the `site_polygons` collection
with a handful of zones (QGIS export → CSV with one `geojson` column →
`| inputlookup site_polygons.csv | outputlookup site_polygons`) and
pasting the SPL above into a Dashboard Studio map panel with Better
Map as the visualization and applying the formatter JSON in §4._

## 6. Gotchas

- **KV Store schema must be declared in `collections.conf`.** A
  collection that has not been declared in `collections.conf` cannot
  be queried — `| inputlookup site_polygons` will return an error
  `lookup table not found`. The matching stanza is:
  ```ini
  [site_polygons]
  field.zone_id = string
  field.zone_name = string
  field.zone_type = string
  field.geojson = string
  field.owner_team = string
  ```
  with a paired `transforms.conf` stanza:
  ```ini
  [site_polygons]
  external_type = kvstore
  collection = site_polygons
  fields_list = _key, zone_id, zone_name, zone_type, geojson, owner_team
  ```
  See the [splunk-lookups skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-lookups.mdc)
  three-file contract for the full setup.
- **Coordinate order.** GeoJSON is `[longitude, latitude]`. WKT is
  `longitude latitude`. Most non-GIS data sources will give you
  `latitude, longitude` order — that's wrong for both geometry forms
  and will plot every polygon in the Atlantic Ocean or near
  Antarctica. Re-export from QGIS with the right axis order set; do
  NOT try to flip in SPL with `eval` (it's error-prone on Multi*
  geometries).
- **Polygon closure.** GeoJSON `Polygon` rings MUST close — the first
  and last coordinate pair MUST be identical. QGIS exports this
  correctly; hand-authored polygons sometimes don't, and Better Map's
  MapLibre renderer silently drops unclosed geometries. Validate
  with `| inputlookup site_polygons | eval first=substr(geojson, 1,
  200) | table id, first` and look for the first/last coordinate pair
  to match.
- **KV Store size limit.** Splunk's KV Store collections have no
  hard size cap, but performance degrades materially past ~100k rows
  for `| inputlookup` reads. A polygon set bigger than a few thousand
  zones is unusual for the use cases this recipe targets (asset
  zones, branch territories, jurisdiction boundaries). If your
  polygon set is larger than ~50k, consider:
  (a) pre-filtering by `_key` range so each panel queries only
      visible zones,
  (b) sharding across multiple collections by jurisdiction
      (`site_polygons_us`, `site_polygons_eu`, etc.),
  (c) switching to a vector-tile preset (PMTiles) — but that loses
      the KV-Store-resident editability benefit.
- **KV Store replication latency.** KV Store rides Splunk's KV
  replication onto search heads — typically <1s but can lag in
  multi-site SHCs under load. For a freshly-mutated row to appear in
  a panel, the panel may need to wait for replication. If you
  observe stale data after an `outputlookup`, check
  `| rest /services/kvstore/status | search status!="ready"` for
  any replication delays.
- **Polygon-fill clipping.** MapLibre clips polygon fills at the tile
  edge; very large polygons (e.g., a whole-country geofence)
  rendered at city zoom show seams at vector-tile boundaries. This
  is a MapLibre engine behaviour; the workaround is to pre-clip
  large polygons into smaller pieces before storing in the
  collection. For the typical asset-zone / branch-territory use
  case, polygons are small enough that this isn't a problem.
- **No OT-safety dependency, BUT.** If your `site_polygons`
  collection ALSO contains entries for SIS-related boundaries
  (control-room geofences, hazardous-zone perimeters, BPCS-vs-SIS
  separation lines), follow
  [/.cursor/rules/ot-safety.mdc](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — flag those rows with a `safety_related: true` column
  and render them in a DEDICATED, visually distinct layer with a
  hand-curated popup that says "READ ONLY — SIS-defined boundary, no
  action permitted from this panel." Better Map MUST NOT be the
  surface that takes action against an SIS-related asset, including
  via drilldown into a SOAR playbook keyed off the polygon's
  `zone_id`.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised recipe
contract (`schema_version: 1` + frontmatter + §1-§6) and smoke-tests
locally against `build-recipe-index.py` + `check-recipe-schema.py`.
Has NOT been live-tested against a real KV Store collection populated
with polygon geometry. Verification deferred to a maintainer with a
Splunk dev tenant where a `site_polygons` collection can be defined
in `collections.conf` + `transforms.conf` and seeded with GeoJSON
zones (recommended: 2-12 polygons exported from QGIS), at which point
the panel SPL can be dispatched, the polygons rendered, and the
frontmatter updated to `status: verified`.

The D5 Phase 1 harness (`docker/`) makes this a 5-minute round-trip
once a polygons KV Store collection is defined — see the
[local Splunk harness operator guide](https://github.com/fenre/better_map/blob/main/docs/development/local-splunk-harness.md).
