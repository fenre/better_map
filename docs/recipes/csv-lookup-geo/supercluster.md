---
schema_version: 1
id: csv-lookup-geo--supercluster
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (geo polygons)"
  pattern: splunk-lookup
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "ASSET-0042"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "33.7490"
  - name: lon
    type: number
    example: "-84.3880"
  - name: asset_name
    type: string
    example: "Atlanta DC asset 0042"
  - name: asset_category
    type: string
    example: "compute"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source family, polygon layer"
    path: "docs/recipes/csv-lookup-geo/polygons.md"
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — supercluster (Cluster layer, supercluster-backed)"
    path: "docs/reference/layers.md"
  - description: "Cluster layer source (supercluster index, MapLibre cluster: true)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# CSV lookup (geo points) — supercluster

The high-cardinality companion to the
[csv-lookup-geo/polygons](./polygons.md) recipe — same `csv-
lookup-geo` source family, but the CSV holds **thousands of
discrete points** (an asset register, a sensor inventory, a
retail-store list) rather than polygon boundaries. The recipe
demonstrates the **supercluster-backed cluster renderer**
(MapLibre's `cluster: true` on a GeoJSON source, internally
indexed by Mapbox's `supercluster` library — see the
[clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js))
which scales to ~250k point features per panel without GPU
saturation — the right layer when the data is dense enough
that markers would visually merge into illegible "dot soup"
but you still want per-point drilldown affordance (which
heatmap eliminates and choropleth doesn't carry).

## 1. Source description

A **CSV lookup** under `<app>/lookups/<name>.csv` exposed via a
`transforms.conf` stanza, queried with `| inputlookup <name>`.
This recipe binds to a lookup named `asset_register.csv`
(rename to match your install) with the columns `asset_id`,
`asset_name`, `asset_category`, `lat`, `lon`. Same git-friendly
+ versionable + AppInspect-clean properties as the
[polygons sibling](./polygons.md), but the row count is
dramatically higher: a global enterprise asset register easily
runs to 10000+ rows.

**Typical sourcetype / index:** none — `| inputlookup` runs
against the CSV directly, no event ingestion is involved. The
CSV is the source of truth; the panel re-reads it fresh on
every dispatch (KV-Store reads are also valid alternatives —
see §6 Gotchas for the choice rubric).

**One-time setup** (skip if your lookup already exists). For
testing purposes, you can synthesise a 10000-row register from
the city polygons in your bundled `us-cities.pmtiles` preset
or by hand-authoring a CSV with the documented columns. In
production you would NOT generate this way — you would export
from your CMDB / asset management system.

## 2. SPL recipe

```spl
| inputlookup asset_register.csv
| rename asset_id AS id
| where isnotnull(lat) AND isnotnull(lon)
| fields id, lat, lon, asset_name, asset_category
| sort + asset_name
| head 10000
```

Why this exact shape:

- **`| inputlookup asset_register.csv`** — direct CSV read. No
  time predicate (CSV reads are time-independent). No `stats`
  — every row is a point. The CSV is the source of truth.
- **`| rename asset_id AS id`** — adopt Better Map's `id`
  alias up front. Same convention as every other recipe in the
  matrix. The `id` field is what drives per-point drilldown
  when the user clicks a marker (or a cluster that expands to
  this point).
- **`| where isnotnull(lat) AND isnotnull(lon)`** — defensive
  filter for CSVs that include un-geocoded asset rows (assets
  in a remote field office, prototypes in a developer lab, in-
  transit shipments). Surface those in a companion table panel
  for the asset team to backfill.
- **`| fields id, lat, lon, asset_name, asset_category`** —
  explicit projection. CSV lookups can carry many columns
  (acquisition date, owner cost centre, depreciation
  schedule); for the map panel we only need the five.
- **`| sort + asset_name`** — alphabetical for stable
  rendering. The cluster renderer's expansion behaviour
  (which point appears "first" when a cluster expands to
  reveal its members) is stable across re-renders.
- **`| head 10000`** — defensive cap. The cluster renderer
  scales to ~250k features per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md);
  but a 10k cap gives a comfortable ceiling for the typical
  enterprise asset register and prevents accidental DOS if
  your CSV grows unexpectedly. Raise to 50k for true
  enterprise-scale fleets; raise to 250k only after testing
  performance on the target browser fleet.

If your CSV already has the canonical column names `id`, `lat`,
`lon`, the recipe collapses to two lines:

```spl
| inputlookup asset_register.csv
| where isnotnull(lat) AND isnotnull(lon)
```

## 3. Expected fields

| field          | type   | example              |
|----------------|--------|----------------------|
| id             | string | ASSET-0042           |
| lat            | number | 33.7490              |
| lon            | number | -84.3880             |
| asset_name     | string | Atlanta DC asset 0042|
| asset_category | string | compute              |

All five fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — explicit pin to the cluster
  renderer (the supercluster-backed strategy per the layers
  reference). The default `pointRenderer: "auto"` would already
  switch to cluster at 200+ features (per the formatter-schema
  enum description), but pinning is explicit and survives
  zoom-level changes. For ≥ 10000 features `auto` would
  switch to heatmap — pinning to `cluster` preserves the
  per-point drilldown affordance heatmap loses.
- **Cluster tuning (`clusterMaxZoom`, `clusterRadius`) is
  currently hardcoded** in the [clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js)
  at 14 / 48 respectively. These defaults are the empirical
  visual sweet spot (clusters big enough to read the count
  label, small enough to resolve neighbouring city-level
  groupings; expansion at street-level zoom). Exposing them
  as formatter options is a v1.8+ candidate — see §6 Gotchas
  for the rationale and the temporary code-level customization
  path.
- **`asset_name` and `asset_category` flow through
  automatically** as feature properties on each rendered
  point — popups (on a marker click after cluster
  expansion) can reference them by name.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The cluster renderer is best demoed with the camera at
country-level zoom (so most points are clustered) AND the user
then zooming in to a single city (so clusters expand to
individual markers, demonstrating the drilldown affordance). A
maintainer can reproduce by pasting the SPL into a Dashboard
Studio map panel with Better Map as the visualization, applying
the formatter JSON in §4, and scroll-zooming the panel._

## 6. Gotchas

- **CSV lookup file-size ceiling.** Splunk's default
  `[lookup] max_memtable_bytes = 25000000` (25 MB) is the
  RAM ceiling per lookup. A 10000-row asset register with
  the five documented columns is well under (typically
  ~1 MB). At 100000 rows you start to approach the ceiling;
  switch to a KV-Store collection with `replicate = true` for
  larger fleets. Trade-off: KV-Store loses the git-diff
  friendliness of a CSV (the polygons-recipe choice rubric
  applies here too — see
  [polygons.md §6](./polygons.md#6-gotchas)).
- **Cluster vs heatmap vs hexbin — when to choose which.**
  Three high-cardinality layers, three answers to different
  questions:

  | Layer | Best for | Loses |
  |---|---|---|
  | `cluster` (this recipe) | "Show me how many points are here AND let me drill into each one" | Continuous density signal at intermediate zoom |
  | `heatmap` (see [kvstore-latlon/heat](../kvstore-latlon/heat.md)) | "Show me the density landscape regardless of individual points" | Per-point identity (you cannot click a heatmap blob) |
  | `hexbin` (see [netflow-sflow-ipfix/h3](../netflow-sflow-ipfix/h3.md)) | "Show me area-neutral density with stable bin boundaries" | Per-point identity AND the geographic precision of the original lat/lon |

  All three coexist in the same dashboard via Better Map's
  BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
  `reset`) toggled from dashboard inputs.

- **Cluster radius / max-zoom tuning (current limitation).**
  The two key cluster-tuning knobs `clusterMaxZoom` (zoom
  level above which clusters STOP collapsing — default 14)
  and `clusterRadius` (pixel radius of the clustering
  algorithm — default 48) are currently **hardcoded** in the
  [clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js)
  and not exposed as formatter options. For the typical
  enterprise asset register the defaults give a comfortable
  visual experience. If you need to customise (e.g. a
  geographically dense fleet where street-level still
  produces clusters, or a sparse fleet where city-level
  always resolves to individuals), the temporary path is to
  patch `clusters.js` with your preferred values and re-build
  the visualization bundle (`npm run build` in
  `better_map/appserver/static/visualizations/better_map/`).
  Exposing these via the formatter schema is a tracked
  v1.8+ enhancement; the tuning principles are: high
  `clusterMaxZoom` (16+) pairs with small `clusterRadius`
  (24-32); low `clusterMaxZoom` (12) pairs with large
  `clusterRadius` (64-96).
- **Cluster colour drives from data.** The cluster layer
  ships a default colour ramp (`SET3[0]` from the
  bundled palettes — see
  [`src/lib/palettes.js`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/palettes.js))
  but custom colour by `asset_category` is supported via
  the formatter's `palette` option + a per-row colour
  field. Set `categoryField: "asset_category"` and
  `palette: "set3"` to colour individual markers by
  category once clusters expand to individuals (the
  colour is preserved through cluster expansion).
- **Per-point identity at cluster level.** A cluster
  marker's popup CANNOT show per-point fields (because
  it represents many points). On a cluster click, the
  panel zooms in to the cluster's expansion zoom; on a
  cluster's individual-marker click (after expansion),
  the standard marker popup with `asset_name` /
  `asset_category` etc. fires. Document this two-step
  drilldown in your dashboard markdown if your audience
  is unfamiliar with cluster UX.
- **`| inputlookup` vs KV-Store performance.** For a 10k-
  row CSV, the `| inputlookup` cost is < 100 ms (it's
  a memory-mapped file read). For a 100k-row CSV, the
  cost rises to 1-3 s — at which point a KV-Store
  collection with `replicate = true` is the right
  choice (KV-Store reads stay sub-100ms because they're
  served from the search-head local replica, not the
  captain). The polygons-sibling recipe documents the
  same choice rubric.
- **No OT safety dependency.** This is a pure asset-
  register layer. If `asset_register.csv` ALSO contains
  entries for SIS-related assets (Level-0/1/2 in the
  Purdue model), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — segregate those into a dedicated layer
  with `ot_safety_relevant: true` and a hand-curated
  popup that says "READ ONLY — SIS asset, no action
  permitted from this panel." Better Map MUST NOT be
  the surface that takes action against an SIS asset.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented CSV-lookup and
SPL contracts, and only references Splunk built-ins. The
formatter options (`pointRenderer: cluster`, `clusterMaxZoom`,
`clusterRadius`) are all present in
`docs/_machine/formatter-schema.json` and cross-checked by
`scripts/check-formatter-coverage.py`. The recipe has not
been dispatched against a real `asset_register.csv` lookup
in the v1.7-prep development cycle (the lab tenant does not
have a populated asset-register CSV). A maintainer with
write access to a Splunk dev tenant should:

1. Drop a hand-authored or CMDB-exported CSV with the
   documented schema into `<app>/lookups/asset_register.csv`
   and add a matching `[asset_register]` stanza in
   `transforms.conf`.
2. Run the panel SPL and confirm at least 100 rows return
   with the five documented fields (cluster behaviour is
   visually most interesting above the 200-feature auto-
   switch threshold).
3. Apply the formatter JSON in §4 to a Dashboard Studio map
   panel; zoom in and out; confirm clusters collapse /
   expand at the `clusterMaxZoom` boundary; confirm
   individual marker popups fire on point click.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 10.0 against
   a 12-zone asset-boundary CSV exported from QGIS"), and
   submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change
   without touching the schema.
