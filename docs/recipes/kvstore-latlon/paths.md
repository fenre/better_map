---
schema_version: 1
id: kvstore-latlon--paths
source:
  id: kvstore-latlon
  display_name: "KV Store (lat/lon collection)"
  pattern: splunk-lookup
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "WAN-ATL-FRA"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "33.7490"
  - name: lon
    type: number
    example: "-84.3880"
  - name: src_site_id
    type: string
    example: "DC-ATL-01"
  - name: dest_site_id
    type: string
    example: "DC-FRA-01"
  - name: connection_type
    type: string
    example: "wan_mpls"
  - name: bandwidth_mbps
    type: integer
    example: "10000"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-site identity)"
    path: "docs/recipes/kvstore-latlon/markers.md"
  - description: "Companion recipe — same source, heat layer (smoothed density)"
    path: "docs/recipes/kvstore-latlon/heat.md"
  - description: "Companion recipe — same source, H3 hexbin (regional aggregation)"
    path: "docs/recipes/kvstore-latlon/h3.md"
  - description: "Companion recipe — same source, supercluster (zoom-adaptive)"
    path: "docs/recipes/kvstore-latlon/supercluster.md"
  - description: "Pattern reference — paths layer with two-CSV inputlookup + lookup join"
    path: "docs/recipes/csv-lookup-geo/paths.md"
  - description: "Pattern reference — paths layer with mvexpand 2-vertex polylines"
    path: "docs/recipes/itsi-kpi-base/paths.md"
  - description: "Splunk lookups skill — KV Store collection setup"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
---

# KV Store (lat/lon collection) — paths

Render **site-to-site connectivity edges** (WAN circuits,
replication links, DR-failover partnerships) as polylines
on a world map by reading two KV-Store collections:
`site_locations` (the inventory used by all kvstore-latlon
siblings) and a new `site_connections` collection that
describes the edges between sites. The recipe joins each
edge to both endpoint sites and emits a 2-vertex polyline
per connection.

The right shape for **infrastructure-topology panels** where
the operator needs to see the GRAPH of how their sites are
interconnected — not the sites themselves (the
[markers companion](./markers.md) is for that) but the
LINKS between sites. Pair with the markers companion in the
same dashboard for a "sites + edges" topology view.

The **5th and final layer cell on the kvstore-latlon source
row** — completing markers / heat / h3 / supercluster /
paths for the KV Store inventory source. Every kvstore-latlon
layer now ships.

## 1. Source description

Same `site_locations` KV-Store collection as the
[markers](./markers.md), [heat](./heat.md), [h3](./h3.md),
and [supercluster](./supercluster.md) siblings — see
[kvstore-latlon/markers §1](./markers.md#1-source-description)
for the one-time `collections.conf` / `transforms.conf` /
seed-data setup.

The relevant addition for THIS recipe: a SECOND KV-Store
collection — `site_connections` — that describes edges
between sites. The recommended schema:

| field           | type   | example     | meaning                       |
|-----------------|--------|-------------|-------------------------------|
| connection_id   | string | WAN-ATL-FRA | unique edge identifier        |
| src_site_id     | string | DC-ATL-01   | source site (joins `site_locations`) |
| dest_site_id    | string | DC-FRA-01   | destination site (joins `site_locations`) |
| connection_type | string | wan_mpls    | edge category (popup display) |
| bandwidth_mbps  | int    | 10000       | edge capacity (popup display) |
| is_primary      | bool   | true        | primary vs backup edge (optional) |

One-time setup (mirrors the
[csv-lookup-geo/paths](../csv-lookup-geo/paths.md) two-input
pattern but uses KV Store for both):

```ini
# default/collections.conf
[site_connections]
field.connection_id = string
field.src_site_id = string
field.dest_site_id = string
field.connection_type = string
field.bandwidth_mbps = number
field.is_primary = bool
replicate = false
accelerated_fields.con_id = {"connection_id": 1}

# default/transforms.conf
[site_connections]
external_type = kvstore
collection = site_connections
fields_list = _key, connection_id, src_site_id, dest_site_id, connection_type, bandwidth_mbps, is_primary
case_sensitive_match = false
max_matches = 1
```

Seed-data flow once the collections are stood up — `|
makeresults | eval ... | outputlookup site_connections`
inside a setup search (one row per edge). REST API alternative
documented in the
[splunk-lookups skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-lookups/SKILL.md#kv-store-population-via-rest-api).

**Why paths for kvstore-latlon.** A markers panel shows WHERE
your sites are; the heat / h3 / supercluster panels show their
density patterns. But none of these answer the
**topology-comprehension question**: "which sites have a
direct link to which other sites, and what's the shape of
the resulting graph?" The paths layer makes the edges
visible, which is the prerequisite for any
network-engineering, DR-readiness, or capacity-planning
conversation.

**Why a separate `site_connections` collection (not a
self-join on `site_locations`).** A single-collection
self-join would require encoding the edge list as multi-
value fields on the site rows (e.g., `peers = mvappend(...)`)
which is awkward to maintain, harder to query, and loses the
per-edge attributes (bandwidth, connection_type). The
two-collection pattern is the standard graph-modelling
shape for KV Store (nodes table + edges table — same as
SQL).

**Typical sourcetype / index:** N/A — this recipe is
purely lookup-driven. The base search is `| inputlookup
site_connections`. The events index is irrelevant; the
edges are static topology, not telemetry. For
**dynamic edge weighting** (e.g., colour edges by current
utilisation), join to a metrics index in §6 Gotchas.

## 2. SPL recipe

```spl
| inputlookup site_connections
| lookup site_locations site_id AS src_site_id
    OUTPUT lat AS src_lat, lon AS src_lon, site_name AS src_site_name
| lookup site_locations site_id AS dest_site_id
    OUTPUT lat AS dest_lat, lon AS dest_lon, site_name AS dest_site_name
| where isnotnull(src_lat) AND isnotnull(src_lon)
    AND isnotnull(dest_lat) AND isnotnull(dest_lon)
| rename connection_id AS id
| eval vertex=mvrange(0, 2, 1)
| mvexpand vertex
| eval vertex_num=tonumber(vertex)
| eval lat=case(vertex_num=0, src_lat, vertex_num=1, dest_lat),
       lon=case(vertex_num=0, src_lon, vertex_num=1, dest_lon),
       site_id=case(vertex_num=0, src_site_id, vertex_num=1, dest_site_id),
       site_name=case(vertex_num=0, src_site_name, vertex_num=1, dest_site_name),
       role=case(vertex_num=0, "src", vertex_num=1, "dest"),
       seq=vertex_num
| fields id, seq, lat, lon, src_site_id, dest_site_id, site_id, site_name, role, connection_type, bandwidth_mbps
| sort 0 id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`| inputlookup site_connections`** — pure-lookup base
  search (no `index=...` prefix). The leading `|` is
  required for generating commands at the start of a search.
  The recipe is time-independent — edges are static topology.
- **`lookup site_locations site_id AS src_site_id OUTPUT lat
  AS src_lat, lon AS src_lon, site_name AS src_site_name`** —
  join the source endpoint. The `AS src_site_id` rebinds
  the lookup's `site_id` join key to the `site_connections`
  table's `src_site_id` column. `OUTPUT ... AS src_lat`
  renames the output fields to disambiguate from the
  destination lookup on the next line.
- **`lookup site_locations site_id AS dest_site_id OUTPUT
  lat AS dest_lat, lon AS dest_lon, site_name AS
  dest_site_name`** — symmetric join for the destination
  endpoint. Two separate `lookup` commands (not one with
  `OUTPUTNEW`) because each lookup uses a DIFFERENT join
  key against the same lookup table.
- **`where isnotnull(src_lat) AND isnotnull(src_lon) AND
  isnotnull(dest_lat) AND isnotnull(dest_lon)`** — drop
  edges where either endpoint is missing from
  `site_locations` (orphaned references, decommissioned
  sites, typos in the seed data). All four guards are
  required; a missing src OR dest produces a partially-
  geocoded edge that the paths layer would render as a
  single-vertex point (invisible) or a degenerate line.
- **`rename connection_id AS id`** — adopt Better Map's
  canonical `id` alias. Per-edge identifier.
- **`eval vertex=mvrange(0, 2, 1)` + `mvexpand vertex`** —
  fan out one row per (edge, vertex) pair. Same canonical
  pattern as the [itsi-kpi-base/paths](../itsi-kpi-base/paths.md)
  recipe.
- **`eval vertex_num=tonumber(vertex)`** — cast for `case()`
  numeric comparison.
- **`eval lat=case(...), lon=case(...), site_id=case(...),
  site_name=case(...), role=case(...), seq=vertex_num`** —
  pick src or dest attributes per vertex. `role` flows into
  the popup for endpoint disambiguation.
- **`fields ...`** — explicit projection. Carries `src_site_id`,
  `dest_site_id`, `connection_type`, `bandwidth_mbps` on
  every vertex so popup-on-vertex shows the same edge
  context regardless of which endpoint was clicked.
- **`sort 0 id, + seq`** — group all vertices for one edge
  contiguously, ordered seq=0 (src) then seq=1 (dest).
- **`head 5000`** — render cap. A typical site topology
  has 10-500 edges; 5000 covers the largest enterprise
  WAN topologies (~1000 sites, ~3000 edges) with headroom.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field           | type    | example     |
|-----------------|---------|-------------|
| id              | string  | WAN-ATL-FRA |
| seq             | integer | 0           |
| lat             | number  | 33.7490     |
| lon             | number  | -84.3880    |
| src_site_id     | string  | DC-ATL-01   |
| dest_site_id    | string  | DC-FRA-01   |
| connection_type | string  | wan_mpls    |
| bandwidth_mbps  | integer | 10000       |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`site_id`, `site_name`, and `role` also flow through as
per-vertex feature properties for the popup.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#17becf",
  "pathArrows": false
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit. Per-edge polyline
  grouping uses the `connection_id` value (renamed to `id`).
- **`timeField: "seq"`** — monotonic vertex ordering. Each
  edge has exactly two vertices (seq=0 for src, seq=1 for
  dest).
- **`pathColor: "#17becf"`** — Tableau muted-cyan. Distinct
  from the other path-layer colours: green
  ([splunk-stream/paths](../splunk-stream/paths.md) — wire-
  data flows), blue ([cyber-vision/paths](../cyber-vision/paths.md)
  — OT flows), red
  ([cim-authentication/paths](../cim-authentication/paths.md)
  — kill-chain trajectories), purple
  ([itsi-kpi-base/paths](../itsi-kpi-base/paths.md) — ITSI
  service edges), and dark-blue
  ([csv-lookup-geo/paths](../csv-lookup-geo/paths.md) —
  supply-chain routes). Cyan reads as "infrastructure
  topology" against any base-map.
- **`pathArrows: false`** — site-to-site connectivity is
  typically BIDIRECTIONAL (WAN circuits, replication links
  are two-way). Disabling arrows avoids implying
  unidirectional flow. For DIRECTIONAL topology (e.g.,
  primary→secondary replication), set `pathArrows: true`
  and ensure the `src_site_id` / `dest_site_id` convention
  matches the actual direction in the data.

For **bandwidth-weighted edge thickness** (thicker lines
for higher-capacity circuits), set `weightField:
"bandwidth_mbps"` — a v1.8 candidate. The static cyan with
uniform thickness is the appropriate starting point for
topology overview.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). The reference demo data: a 12-site global
WAN topology with ~20 inter-site MPLS / IPsec / replication
edges. The paths panel renders the edges as cyan polylines
fanning across continents, with the site markers from the
[markers companion](./markers.md) overlaid at each endpoint.
A maintainer can reproduce by seeding `site_locations` with
the canonical 10-site reference set
([kvstore-latlon/markers §1](./markers.md#1-source-description)),
seeding `site_connections` with 15-25 edges (e.g.,
`| makeresults | eval connection_id="WAN-ATL-FRA",
src_site_id="DC-ATL-01", dest_site_id="DC-FRA-01",
connection_type="wan_mpls", bandwidth_mbps=10000 |
outputlookup site_connections append=true`), pasting the
SPL into a Dashboard Studio map panel with Better Map as the
visualization, applying the §4 formatter JSON._

## 6. Gotchas

- **`site_connections` collection is operator-built.** Like
  the
  [csv-lookup-geo/paths](../csv-lookup-geo/paths.md) recipe
  needs a `routes.csv`, this recipe needs a `site_connections`
  KV Store collection. The schema in §1 is the recommended
  starting point. For minimum-viable deployment: 4 required
  columns (`connection_id`, `src_site_id`, `dest_site_id`,
  `_key`). For a richer panel: add `connection_type` (categorical
  popup label), `bandwidth_mbps` (capacity for popup OR
  edge-weighting in v1.8), `is_primary` (boolean for
  primary/backup distinction).
- **Two `lookup` commands, not one.** A single `lookup` can
  ONLY join on one key per command. The src and dest are
  TWO joins against the same lookup table using TWO different
  keys, so two `lookup` commands are required. The `OUTPUT
  AS` renames are critical to avoid the second lookup
  overwriting the first's `lat`/`lon` output.
- **Orphaned edges are silently dropped.** If `site_connections`
  references a `src_site_id` or `dest_site_id` that doesn't
  exist in `site_locations`, the `where isnotnull(src_lat) AND
  ...` filter drops the row. For data-quality awareness,
  pair this recipe with a companion table panel:
  ```spl
  | inputlookup site_connections
  | lookup site_locations site_id AS src_site_id OUTPUT lat AS src_lat
  | lookup site_locations site_id AS dest_site_id OUTPUT lat AS dest_lat
  | where isnull(src_lat) OR isnull(dest_lat)
  | table connection_id, src_site_id, dest_site_id
  ```
  to surface orphaned edges.
- **Self-loops are not visualized.** If `src_site_id ==
  dest_site_id`, the resulting polyline is degenerate (both
  vertices at the same lat/lon) and renders as a single
  point. The recipe doesn't filter these (it's valid for
  some topologies — e.g., intra-site management loopbacks)
  but operators wanting to exclude them should add
  `| where src_site_id != dest_site_id` after the
  `inputlookup`.
- **Bidirectional edges may produce duplicates.** If your
  `site_connections` seed data has both `ATL→FRA` and
  `FRA→ATL` as separate rows (one per direction), the
  panel will render TWO polylines on top of each other.
  Either deduplicate at seed time (canonical-order:
  `src_site_id < dest_site_id` always) or filter at
  search time: `| where src_site_id < dest_site_id` after
  the `inputlookup`.
- **Static topology vs dynamic utilisation.** This recipe
  treats edges as static topology with fixed properties
  (`bandwidth_mbps`, `connection_type`). For DYNAMIC
  edge-state visualization (current utilisation, link
  health, link state from streaming telemetry), pipe the
  inputlookup through a `tstats` join to a metrics index:
  ```spl
  | inputlookup site_connections
  | join connection_id [
      | tstats latest(utilization_pct) AS util WHERE index=netops_metrics BY connection_id
    ]
  | eval is_saturated=if(util > 80, 1, 0)
  | ... rest of recipe ...
  ```
  Then map `is_saturated` to `pathColor` via a v1.8
  `colorField` option (currently a static-colour layer).
- **No time-range parameter.** The base search uses
  `| inputlookup` (no time range applies — KV Store reads
  are time-independent). For panel-token time-range
  compatibility (e.g., to layer dynamic utilisation), wrap
  the inputlookup in `| union [search index=foo earliest=$
  earliest$ latest=$latest$]` per the
  [splunk-spl-commands skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-spl-commands/SKILL.md).
- **Multi-vertex paths.** This recipe shows 2-vertex
  point-to-point edges. For MULTI-VERTEX paths through
  intermediate hops (e.g., a 3-hop WAN circuit ATL→AMS→FRA),
  extend `site_connections` with a `via_sites` multi-value
  column and adapt the SPL to fan out one vertex per hop —
  same pattern as the
  [csv-lookup-geo/paths](../csv-lookup-geo/paths.md)
  recipe which sequences vertices via `seq` from `routes.csv`.
- **No OT-safety dependency.** As with the markers / heat /
  h3 / supercluster siblings, this is a pure IT topology
  layer. If `site_connections` carries SIS-related
  connectivity (e.g., links into a Level-2 control network),
  follow [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — split SIS edges into a separate
  `site_connections_sis` collection with
  `ot_safety_relevant: true` on the recipe and a
  hand-curated read-only tooltip per OT-safety Rule 4
  (READ ONLY, no edge-state writebacks permitted).

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound and uses only Splunk built-ins
(`inputlookup`, `lookup`, `eval`, `case`, `mvrange`,
`mvexpand`, `where`, `tonumber`, `rename`, `sort`,
`fields`, `head`). Verification path: stand up
`site_locations` and `site_connections` collections per the
§1 setup, seed with the canonical 10-site reference + 15-25
edges, dispatch via REST, drop into a Dashboard Studio panel
with the §4 formatter JSON, confirm 2-vertex polylines
render between geo-located endpoints. Promote to
`status: verified` + fill in `verified_against` (include
the seed-data fixture identifier) in a follow-up PR.
