---
schema_version: 1
id: kvstore-latlon--vector-tile-join
source:
  id: kvstore-latlon
  display_name: "KV Store (geo polygons collection)"
  pattern: splunk-lookup
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-23"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "NLD"
    drives_formatter_option: idField
  - name: country_name
    type: string
    example: "Netherlands"
  - name: value
    type: number
    example: "847.3"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, polygons layer (KV Store-hosted GeoJSON)"
    path: "docs/recipes/kvstore-latlon/polygons.md"
  - description: "Companion recipe — same source, markers/heat/h3/supercluster/paths layers"
    path: "docs/recipes/kvstore-latlon/markers.md"
  - description: "Pattern reference — vector-tile-join with CSV lookup metric source (sibling singleton until now)"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "Splunk lookups skill — KV Store lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# KV Store (geo polygons collection) — vector-tile join (customer PMTiles)

Render a per-region metric value (sales by territory, incidents
by service area, SLO compliance by jurisdiction, OT roll-up KPIs
by plant zone) by joining a **KV Store collection** of metric
values against a **customer-hosted PMTiles vector tileset** that
defines the region polygons. The **second source** to demonstrate
the vector-tile-join layer (alongside the existing
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
companion), promoting the vector-tile-join layer **out of the
singleton-trap region**.

KV Store is the right home for the metric rows when the dataset:

- changes frequently (a GIS / data team can `outputlookup`
  updates without a Splunk app redeploy, or even mutate
  individual rows via the KV Store REST API)
- requires row-level RBAC (e.g., per-region metrics restricted
  to the regional director's role)
- needs to participate in joins with telemetry indexed elsewhere
  (KV Store queries are first-class in SPL)
- spans search heads in a SHC (KV replicates automatically;
  CSVs require manual sync via the deployer or a deployment
  server bundle)
- carries more than a few thousand rows (CSV lookups are loaded
  into search-head memory on every search; KV Store queries are
  indexed and scale to ~millions of rows)

The polygon geometry STILL lives on a customer-hosted PMTiles
file (this recipe shares the PMTiles contract verbatim with the
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
companion — see its §1 for the deep PMTiles + tippecanoe +
promoteId background). The only thing this recipe changes is the
**metric row source**: KV Store collection instead of CSV file.

Zero Splunk add-ons required. The polygon geometry lives on a
customer-hosted CDN (or on the Splunk app's own
`appserver/static/` folder for air-gapped tenants). The metric
rows live in the customer's KV Store. No external API calls.

## 1. Source description

A KV Store collection named `region_metrics_kv` (rename to match
your install) holds one row per region, with columns:

| column         | type   | purpose                                                |
|----------------|--------|--------------------------------------------------------|
| `country_code` | string | per-region unique key (joined to PMTiles `promoteId`)  |
| `country_name` | string | human-readable label                                   |
| `value`        | number | choropleth shading driver (sales, count, percentage)   |

The collection is defined in `collections.conf` +
`transforms.conf` per the three-file lookup contract (see the
[splunk-lookups skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-lookups.mdc)).
The matching transforms.conf stanza uses `external_type = kvstore`
and points at the collection by `collection = region_metrics_kv`.

The polygon geometry side is **identical** to the
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
companion — a customer-hosted PMTiles file, with a `source-layer`
name and a `promoteId` property. See its §1 for the PMTiles
contract, the `tippecanoe -aI` recipe for promoting GeoJSON `id`
properties, and the air-gap-safe `featureJoinPreset` alternative.

**Typical sourcetype / index:** none — `| inputlookup` runs
against the KV Store collection directly, no event ingestion
involved. (Production dashboards often run `| stats sum(value)
BY region_id` over real events and feed THAT into the join — see
§6 Gotchas for the "summary-search join" pattern, which works
identically to the CSV companion.)

**One-time setup** (skip if your collection already exists):

```spl
| makeresults
| eval country_code="NLD", country_name="Netherlands", value=847.3
| append [
  | makeresults
  | eval country_code="DEU", country_name="Germany", value=1342.6]
| append [
  | makeresults
  | eval country_code="FRA", country_name="France", value=1058.2]
| fields - _time
| outputlookup region_metrics_kv
```

(The one-time setup is the only place `| makeresults` is allowed
in this recipe — it is bootstrap data, not panel data. Per
ROADMAP §1a and the Splunk SPL anti-pattern rules,
`| makeresults` is BANNED in panel SPL because it bypasses
time-range filtering and can't be distributed across indexers.)

After the `| outputlookup`, the collection is queryable from any
search head in the SHC (KV Store replicates automatically). For
incremental updates use a saved-search that runs `| stats
sum(value) BY country_code | outputlookup region_metrics_kv` on
a schedule, OR mutate individual rows via the KV Store REST API
(see the splunk-lookups skill for the curl invocation patterns).

## 2. SPL recipe

```spl
| inputlookup region_metrics_kv
| rename country_code AS id
| fields id, country_name, value
| sort - value
```

What the pipeline does, stage by stage:

- **`| inputlookup region_metrics_kv`** — pulls every row of
  the KV Store collection into the search pipeline. Unlike
  CSV lookups (loaded into search-head memory per search),
  KV Store queries are indexed and scale to millions of rows
  with constant-time `_key` access. For larger datasets, add
  WHERE filters: `| inputlookup region_metrics_kv WHERE
  country_code="NLD" OR country_code="DEU"` to push the
  predicate down to the collection scan.
- **`| rename country_code AS id`** — Better Map's
  `featureJoin` layer hardcodes `idProperty: 'id'` as the
  per-row join key. Renaming `country_code` to `id` aligns
  with that contract.
- **`| fields id, country_name, value`** — trim to the three
  fields the panel actually consumes. `country_name` flows
  through as a feature property for popups; `value` drives
  the choropleth shade.
- **`| sort - value`** — most-significant regions first
  (matters for the companion "Top N regions by value" table
  panel; the choropleth renderer itself is row-order-agnostic).

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type   | example     |
|---------------|--------|-------------|
| id            | string | NLD         |
| country_name  | string | Netherlands |
| value         | number | 847.3       |

The polygon geometry itself is NOT a field — Better Map fetches
it internally from the PMTiles URL configured in §4.

## 4. Recommended formatter config

```json
{
  "featureJoinUrl": "https://cdn.example.com/tilesets/world-countries.pmtiles",
  "featureJoinPromoteId": "iso_a3",
  "featureJoinSourceLayer": "countries",
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why these settings (identical to the
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md#4-recommended-formatter-config)
companion — the metric row source is interchangeable, the
PMTiles join contract is not):

- **`featureJoinUrl`** — the customer-hosted PMTiles URL.
  Better Map uses PMTiles' HTTP Range fetcher to retrieve only
  the visible tiles. Use `pmtiles://` for self-hosted MapLibre
  PMTiles servers; use the raw `https://` URL for direct CDN
  serving. For air-gapped tenants, copy the `.pmtiles` file
  into `better_map/appserver/static/visualizations/better_map/presets/`
  and use `featureJoinPreset: "<your-preset-name>"` instead.
- **`featureJoinPromoteId: "iso_a3"`** — the property name on
  each tileset feature whose value matches the `id` field in
  the SPL row set. For Natural Earth / OpenStreetMap-derived
  country tilesets, `iso_a3` is the canonical ISO 3166-1
  alpha-3 code property. Use `pmtiles show <file>.pmtiles` to
  list available properties on the first feature.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. Inspect with `pmtiles tile <file>.pmtiles
  0 0 0 | jq '.layers | keys'` to list them.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" (default for joined tilesets) to
  "value-shaded fill". The SPL MUST produce a `value` field
  for shading; rows with no `value` render with the
  unmatched-grey fallback fill.
- **`palette: "viridis"`** — perceptually uniform single-
  direction palette. For diverging data (e.g., SLO compliance
  ± target) use `rdbu` and set a midpoint via `colorScaleMid`.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). Until then, reproduce by (a) populating
`region_metrics_kv` with the bootstrap SPL in §1, (b) staging a
small PMTiles file (the Natural Earth countries tileset from
<https://github.com/protomaps/basemaps-assets> is public-domain),
(c) pasting the SPL above into a Dashboard Studio map panel with
Better Map as the visualization and applying the formatter JSON
in §4._

## 6. Gotchas

- **KV Store collection requires the three-file contract.**
  Per the splunk-lookups skill, a KV Store lookup needs ALL
  THREE of: a `collections.conf` stanza defining the collection
  schema, a `transforms.conf` stanza with `external_type =
  kvstore` and `collection = <name>`, and (optionally) the
  permissions in `metadata/default.meta`. Missing any of the
  three causes `| inputlookup` to return zero rows with a
  silent warning. Verify with `| rest /services/data/lookup-table-files`
  and `| rest /servicesNS/-/-/storage/collections/config`.
- **KV Store row count vs CSV.** CSV lookups load the entire
  file into search-head memory per search; KV Store queries
  scan the collection on-demand. For < 10k rows, CSV is
  often FASTER (no query parse overhead); for > 10k rows,
  KV Store wins decisively. The crossover is around 10k
  rows for typical hardware; benchmark with `| inputlookup
  | stats count` against your actual collection size.
- **REST API mutation does NOT invalidate search-head caches.**
  When you mutate a KV Store row via the REST API
  (`curl -X POST /servicesNS/.../storage/collections/data/<name>`),
  the change is immediately visible to NEW `| inputlookup`
  invocations — but any IN-FLIGHT searches still see the
  pre-mutation state. For a "real-time" KPI dashboard, this
  is normally fine (the next 30-second refresh picks up the
  new value); for a "trigger a re-run when the KV mutates"
  workflow, wire the mutation to a saved-search via Splunk's
  scripted-input + REST API webhook.
- **The remaining PMTiles + customer-hosted CDN gotchas are
  identical to the
  [csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md#6-gotchas)
  companion.** Specifically: HTTP Range request support,
  Splunk Cloud CSP `connect-src 'self'` blocks cross-origin
  fetches, `featureJoinPromoteId` case-sensitivity,
  empty-id rows being silently dropped, unmatched-grey
  fallback semantics, and the `featureJoinPreset` air-gap
  alternative. Read the CSV companion's §6 once; the contract
  is fully shared.
- **No OT safety dependency.** This recipe ingests metric
  rows from a KV Store collection and joins them to a polygon
  tileset. The KV Store rows may carry data DERIVED from OT
  events (per-site equipment failure counts rolled up from
  Level-0/1/2 telemetry into a Level-3 or Level-4 summary),
  but the recipe itself never reads from a Level-0/1/2 source.
  The OT-safety boundary lives in the upstream pipeline that
  produces the KV Store rows, not in this recipe.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`inputlookup`, `rename`,
`fields`, `sort`). The PMTiles fetch + join behaviour is covered
by Better Map's own `featureJoin` module unit tests, but the
end-to-end "this recipe's KV Store collection + a real customer
PMTiles renders a choropleth in a Splunk Dashboard Studio panel"
path has not been dispatched against the v1.7-prep lab tenant in
this PR because (a) non-interactive admin auth is not present in
the agent workspace, (b) the lab tenant does not carry a
populated `region_metrics_kv` collection, and (c) the lab tenant
does not carry a registered PMTiles URL. A maintainer with REST
auth and a small custom PMTiles file should follow the
verification steps in the
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md#verification-status)
companion (substituting the `outputlookup` of the bootstrap rows
into the KV Store collection name rather than a CSV file).
