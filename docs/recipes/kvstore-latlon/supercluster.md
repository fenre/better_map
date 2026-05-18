---
schema_version: 1
id: kvstore-latlon--supercluster
source:
  id: kvstore-latlon
  display_name: "KV Store (lat/lon collection)"
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
    example: "STORE-04827"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "40.7128"
  - name: lon
    type: number
    example: "-74.0060"
  - name: site_name
    type: string
    example: "NYC Times Square store #04827"
  - name: site_type
    type: string
    example: "retail"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source family, individual-marker layer"
    path: "docs/recipes/kvstore-latlon/markers.md"
  - description: "Companion recipe — same source family, density heatmap layer"
    path: "docs/recipes/kvstore-latlon/heat.md"
  - description: "Companion recipe — same supercluster layer over CSV data"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Splunk lookups skill — KV Store lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — supercluster (Cluster layer, supercluster-backed)"
    path: "docs/reference/layers.md"
  - description: "Cluster layer source (supercluster index, MapLibre cluster: true)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# KV Store (lat/lon collection) — supercluster

The **high-volume drilldown** companion to the
[kvstore-latlon/markers](./markers.md) and
[kvstore-latlon/heat](./heat.md) recipes. Same KV Store
collection-as-source-of-truth shape, but the panel ships with
the **supercluster-backed cluster renderer** — the right layer
when the collection holds thousands of locations rather than
dozens. The canonical scaling threshold is around 200 features
(per `pointRenderer: auto`), but the cluster renderer is a
better experience all the way down to ~50 features for
audiences who expect "click to drill in" affordance over a
field of dots.

This is the layer to ship for:
- **Retail chains** with hundreds-to-thousands of store
  locations.
- **Logistics fleets** with thousands of vehicles, warehouses,
  or distribution hubs.
- **Charging-station networks** with tens of thousands of
  endpoints.
- **Smart-city deployments** with thousands of sensors,
  cameras, or service locations.

Compared to the existing `heat` recipe, the supercluster layer
**preserves per-site drilldown affordance** that heatmap
collapses; compared to the existing `markers` recipe, it
**stays performant at 10k+ rows** where individual markers
visually collapse into illegible "dot soup."

## 1. Source description

A KV Store collection is the right home for a **large, machine-
maintained list of customer locations** — a retail chain's
store register, a logistics provider's vehicle fleet, a
charging-network's endpoint registry, a telco's base-station
inventory. KV Store rows scale to **millions of rows per
collection** (per Splunk docs) and ride Splunk's KV replication
onto search heads automatically.

The recipe binds to a collection named `customer_locations`
(rename to match your install) with the columns `location_id`,
`site_name`, `site_type`, `lat`, `lon`. Same shape as the
[markers sibling](./markers.md) (`site_id` → `location_id` is
the only column rename, reflecting the higher-cardinality
naming convention) but the volume is 100-1000x larger.

**Typical sourcetype / index:** none — `| inputlookup` runs
against the KV Store collection directly, no event ingestion
is involved. The collection is the source of truth; the panel
re-reads it fresh on every dispatch.

**One-time setup** (skip if your collection already exists).
For testing, synthesise a 5000-row retail chain register by
hand. In production you would NOT generate this way — you
would PUT rows over REST from your store-management system, or
`outputlookup` rows from a saved search that distils your
master location table.

## 2. SPL recipe

```spl
| inputlookup customer_locations
| rename location_id AS id
| where isnotnull(lat) AND isnotnull(lon)
| fields id, lat, lon, site_name, site_type
| sort + site_name
| head 50000
```

Why this exact shape:

- **`| inputlookup customer_locations`** — direct KV Store
  read. No time predicate (KV Store reads are time-
  independent unless your collection holds a `_time` column).
  No `stats` — every row is one point. The collection is the
  source of truth.
- **`| rename location_id AS id`** — adopt Better Map's `id`
  alias up front. Same convention as every other recipe in
  the matrix. The `id` field drives per-point drilldown when
  a cluster expands and the user clicks a single marker.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — defensive
  filter for collections that include un-geocoded rows
  (pending-installation sites, in-transit vehicles, decommissioned
  endpoints that retained a row but lost their coordinates).
  Surface these in a companion table panel for the operations
  team to backfill or remove.
- **`| fields id, lat, lon, site_name, site_type`** —
  explicit projection. KV Store collections can carry many
  columns (opening date, manager name, square footage,
  contract reference); for the map panel we only need the
  five.
- **`| sort + site_name`** — alphabetical for stable
  rendering. The cluster renderer's expansion behaviour
  (which point appears "first" when a cluster expands to
  reveal its members) is stable across re-renders.
- **`| head 50000`** — defensive cap. The cluster renderer
  scales to ~250k features per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md);
  50k is the comfortable ceiling for a national-scale retail
  chain (e.g. Walmart's ~10500 US stores, Starbucks' ~16500
  global) or a regional vehicle fleet. Raise to 250k for
  truly global deployments (≥ 100k endpoints across multiple
  continents) only after testing performance on the target
  browser fleet — at 250k the initial panel load is 3-5s
  even with the supercluster index.

If your collection already uses the canonical column names
`id`, `lat`, `lon`, the recipe collapses to two lines:

```spl
| inputlookup customer_locations
| where isnotnull(lat) AND isnotnull(lon)
```

## 3. Expected fields

| field      | type   | example                          |
|------------|--------|----------------------------------|
| id         | string | STORE-04827                      |
| lat        | number | 40.7128                          |
| lon        | number | -74.0060                         |
| site_name  | string | NYC Times Square store #04827    |
| site_type  | string | retail                           |

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
  renderer (the supercluster-backed strategy per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md)).
  The default `pointRenderer: "auto"` would already switch to
  cluster at 200+ features and to heatmap at 10000+; pinning
  to `cluster` preserves the per-site drilldown affordance
  heatmap loses, regardless of whether the collection is at
  500 or 50000 rows.
- **`id` carries through automatically** because the SPL
  renamed `location_id AS id` — single-marker popups (after
  cluster expansion) show the location ID as the popup title.
- **`site_name` and `site_type` flow through as feature
  properties** on each rendered point — reference them by
  name in custom popup templates. A `dashboardInputs` token
  on `site_type` can drive a separate "site-type breakdown"
  panel keyed on the selected category.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The cluster renderer is best demoed at country-level zoom
showing dense clusters over major metropolitan areas (NYC, LA,
Chicago for a US retail chain), then zoom into one cluster to
demonstrate per-site expansion. A maintainer can reproduce by
pasting the SPL into a Dashboard Studio map panel with Better Map
as the visualization, applying the formatter JSON in §4, and
scroll-zooming the panel from continent to street level._

## 6. Gotchas

- **KV Store collection size limits.** Splunk's default KV
  Store collection limit is **unbounded by default**, but
  per-collection performance starts to degrade around
  **1-10 million rows** depending on the `accelerated_fields`
  configuration. For a 50k-row collection (this recipe's cap)
  the `| inputlookup` round-trip is typically < 200 ms even
  on a cold cache. For collections > 500k rows, consider
  adding an accelerated field on a high-cardinality column
  the panel filters by (e.g. `accelerated_fields.by_region =
  {"region": 1}` then add `| where region=$region_token$`
  to the SPL).
- **Cluster vs heatmap vs hexbin — which to pick for a
  large location collection.** Three high-cardinality
  strategies, three answers:

  | Layer | Best for | Loses |
  |---|---|---|
  | `cluster` (this recipe) | "Where are my locations AND let me drill into each one to see name / type / status" | Continuous density signal at intermediate zoom |
  | `heatmap` (see [kvstore-latlon/heat](./heat.md)) | "Show me the density landscape regardless of individual locations" | Per-site identity (cannot click a heatmap blob) |
  | `hexbin` | "Area-neutral count per geographic cell with stable bin boundaries for week-over-week comparison" | Per-site identity and the precision of the original lat/lon |

  All three coexist in the same dashboard via Better Map's
  BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
  `reset`) toggled from dashboard inputs.

- **Cluster radius / max-zoom tuning (current limitation).**
  As documented in the
  [csv-lookup-geo/supercluster sibling](../csv-lookup-geo/supercluster.md#6-gotchas),
  `clusterMaxZoom` (default 14) and `clusterRadius` (default
  48) are **hardcoded** in the
  [clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js)
  and not yet formatter-exposed. For a typical retail chain
  the defaults give comfortable visual behaviour; a dense
  national fleet (e.g. Starbucks Tokyo, where 1500+ stores
  fit inside the 23 wards) may benefit from a smaller
  `clusterRadius` (24-32) so individual stores resolve
  earlier as the user zooms in. Tracked v1.8+ enhancement.
- **Cluster colour drives from data.** The cluster layer
  ships a default colour ramp (`SET3[0]` from the bundled
  palettes — see
  [`src/lib/palettes.js`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/palettes.js))
  but custom colour by `site_type` is supported via the
  formatter's `palette` option + a per-row colour field.
  Set `categoryField: "site_type"` and `palette: "set3"` to
  colour individual markers by type once clusters expand to
  individuals (the colour is preserved through cluster
  expansion).
- **Per-point identity at cluster level.** A cluster
  marker's popup CANNOT show per-point fields (because it
  represents many points). On a cluster click, the panel
  zooms in to the cluster's expansion zoom; on a cluster's
  individual-marker click (after expansion), the standard
  marker popup with `id`, `site_name`, `site_type` etc.
  fires. Document this two-step drilldown in your dashboard
  markdown if your audience is unfamiliar with cluster UX.
- **`| inputlookup` performance.** For a 50k-row collection,
  `| inputlookup` cost is typically < 200 ms (it's a
  Mongo-backed read via Splunk's KV Store). For collections
  > 500k rows, the cost rises to 1-3 s; in that regime,
  adding an accelerated field (see the size-limits gotcha
  above) restores sub-200ms read times. For collections
  > 5M rows, consider distilling to a periodic snapshot
  collection via a scheduled `outputlookup` from a search
  that aggregates the high-cardinality population to a
  panel-ready shape.
- **Privacy / PII posture.** A location collection that
  identifies individual customer or staff homes (e.g. a
  field-service technician's home base, an at-home
  customer-care agent's address) is PII under GDPR and most
  US state laws. Apply role-based collection ACLs
  (`metadata/default.meta` → `[collections/customer_locations]
  access = read : [admin, ops_team]`) and consider showing
  only aggregated cluster counts (not individual markers
  on expansion) by capping the panel at `clusterMaxZoom = 8`
  (city-level) for unprivileged roles. The
  [cim-authentication/heat §6 Gotchas](../cim-authentication/heat.md#6-gotchas)
  recipe documents the same masking pattern.
- **No OT safety dependency.** This is a pure customer-
  managed location collection. If `customer_locations`
  also contains entries for SIS-related sites (Level-0/1/2
  in the Purdue model), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — segregate those into a dedicated layer
  with `ot_safety_relevant: true` and a hand-curated popup
  that says "READ ONLY — SIS site, no action permitted
  from this panel." Better Map MUST NOT be the surface that
  takes action against an SIS asset.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented KV Store and
SPL contracts, and only references Splunk built-ins. The
formatter options (`pointRenderer: cluster`, `idField`) are
all present in `docs/_machine/formatter-schema.json` and
cross-checked by `scripts/check-formatter-coverage.py`. The
recipe has not been dispatched against a real 50k-row KV
Store collection in the v1.7-prep development cycle (the lab
tenant does not have a populated retail-chain location
collection). A maintainer with write access to a Splunk dev
tenant should:

1. Create a `customer_locations` KV Store collection in
   `collections.conf` and `transforms.conf`; populate it
   with at least 1000 rows (the cluster behaviour is
   visually most interesting above the 200-feature auto-
   switch threshold).
2. Run the panel SPL and confirm at least 1000 rows
   return with the five documented fields.
3. Apply the formatter JSON in §4 to a Dashboard Studio
   map panel; zoom in and out; confirm clusters collapse /
   expand at the `clusterMaxZoom` boundary; confirm
   individual marker popups fire on point click and show
   `id` as the popup title plus `site_name` and `site_type`
   as popup fields.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Cloud 9.4 against a
   2400-store regional retail chain location collection"),
   and submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change
   without touching the schema.
