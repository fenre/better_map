---
schema_version: 1
id: csv-lookup-geo--paths
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (geo polygons)"
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
    example: "ROUTE-LAX-ATL"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "2"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "33.7490"
  - name: lon
    type: number
    example: "-84.3880"
  - name: site_id
    type: string
    example: "DC-ATL-01"
  - name: site_name
    type: string
    example: "Atlanta DC #1"
  - name: route_name
    type: string
    example: "LAX to ATL via DFW"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-site identity)"
    path: "docs/recipes/csv-lookup-geo/markers.md"
  - description: "Companion recipe — same source, supercluster layer (large-fleet overview)"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Companion recipe — same source, polygons layer (site boundaries)"
    path: "docs/recipes/csv-lookup-geo/polygons.md"
  - description: "Pattern reference — paths layer with sequenced vertices"
    path: "docs/recipes/cim-alerts/paths.md"
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — pathIdField, timeField, pathColor, pathArrows"
    path: "docs/_machine/formatter-schema.json"
---

# CSV lookup (geo points) — paths

The supply-chain / customer-journey companion to the
[csv-lookup-geo/markers](./markers.md),
[supercluster](./supercluster.md),
[polygons](./polygons.md), and
[vector-tile-join](./vector-tile-join.md) recipes — same
`csv-lookup-geo` source pattern, but with a **second CSV (or
second column-pair on the same CSV)** providing the
**sequenced route data**: a `route_id` + `seq` pair that orders
points into a polyline. The right shape for **supply-chain /
logistics dashboards** (shipment routes between distribution
centres), **customer-journey maps** (sequence of in-store visits
per loyalty-card holder), **field-service van routes** (ordered
stops per technician per day), or **inspection rounds**
(sequenced asset visits per inspector).

The `csv-lookup-geo` source row now has **6 layer cells**
(markers, h3, heat, supercluster, polygons, vector-tile-join,
plus paths now) — the **most-covered source row in the recipe
matrix** (tied with cim-network-traffic at 7). Paths is the
FIRST POLYLINE layer cell on a CSV-lookup source — closing the
gap between "I have CSV asset data with lat/lon" and "I want to
visualise sequence between those assets."

## 1. Source description

Same **CSV lookup** mechanism as the
[markers companion](./markers.md#1-source-description) — a CSV
file under `<app>/lookups/<name>.csv` exposed via a
`transforms.conf` stanza, queried with `| inputlookup <name>`.
This recipe binds to two related lookups: `sites.csv` (the
geo-located endpoints — same schema as the markers companion's
`sites.csv`) and `routes.csv` (the sequencing — a
`route_id`, `route_name`, `site_id`, `seq` table that orders
sites into ordered chains).

**Why paths for CSV-lookup data.** A markers panel shows the
sites; a supercluster panel shows the site-density at zoom-out.
Neither shows the **connections** between sites — the actual
business question of "which DC ships to which retail outlet
via what intermediate hop?" The paths layer chains the sites
into polylines, with each polyline coloured by `route_id` and
each segment direction shown via arrows. The result maps
cleanly onto operational concepts: a supply-chain analyst sees
the actual physical route shape, not just the endpoint
inventory.

**Typical sourcetype / index:** none — `| inputlookup` reads
both CSVs directly, joined by `site_id`. Same operational
posture as the other csv-lookup-geo recipes: every dispatch is
a fresh CSV read; no acceleration, no summary index, git-
friendly, version-controlled, AppInspect-clean.

**One-time setup** (in addition to the markers companion's
`sites.csv` setup):

1. Place a second CSV at `<app>/lookups/routes.csv` with header
   row `route_id,route_name,site_id,seq`. Example rows:
   ```csv
   route_id,route_name,site_id,seq
   ROUTE-LAX-ATL,LAX to ATL via DFW,DC-LAX-01,1
   ROUTE-LAX-ATL,LAX to ATL via DFW,DC-DFW-02,2
   ROUTE-LAX-ATL,LAX to ATL via DFW,DC-ATL-01,3
   ROUTE-SEA-MIA,SEA to MIA via DEN,DC-SEA-01,1
   ROUTE-SEA-MIA,SEA to MIA via DEN,DC-DEN-03,2
   ROUTE-SEA-MIA,SEA to MIA via DEN,DC-MIA-04,3
   ```
2. Add to `<app>/default/transforms.conf`:
   ```ini
   [routes]
   filename = routes.csv
   max_matches = 0

   [sites]
   filename = sites.csv
   max_matches = 1
   ```
3. Reload (`| extract reload=t` from search head).

## 2. SPL recipe

```spl
| inputlookup routes.csv
| lookup sites site_id AS site_id OUTPUT lat, lon, site_name
| where isnotnull(lat) AND isnotnull(lon)
| rename route_id AS id
| sort 0 id, + seq
| fields id, seq, lat, lon, site_id, site_name, route_name
```

Why this exact shape, line by line:

- **`| inputlookup routes.csv`** — direct CSV read of the
  sequencing table. Each row is one (route, site, seq)
  triplet — multiple rows per route, one row per stop. The
  CSV is intentionally **denormalised** for path-rendering:
  the polyline geometry IS the row sequence per `route_id`,
  so the SPL needs no `mvexpand` / `transpose` / sub-search.
- **`| lookup sites site_id AS site_id OUTPUT lat, lon, site_name`**
  — enrich each route stop with the geo coordinates and human
  name from the sites lookup. `OUTPUT` (not `OUTPUTNEW`)
  because the `routes.csv` does NOT carry `lat`, `lon`, or
  `site_name` — keeping `routes.csv` lean prevents the sites
  inventory from going stale relative to the routes table.
  The single-table source-of-truth (sites) is preserved.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — defensive
  filter. A `route_id` that references a `site_id` not present
  in `sites.csv` (typo, decommissioned site) would produce a
  null-lat-lon row; the path renderer cannot draw a vertex with
  no coordinates and would silently drop the entire path.
  Filtering null-lat-lon rows upfront prevents this — but ALSO
  means a path with a missing intermediate vertex will render
  as a polyline that "skips" the missing stop, which may
  misrepresent the actual physical route. Surface dropped
  vertices in a companion table panel for the site-ops team
  to backfill.
- **`| rename route_id AS id`** — adopt Better Map's
  canonical `id` alias. The paths layer's `pathIdField`
  formatter option defaults to looking for `id` — the rename
  keeps the formatter config minimal.
- **`| sort 0 id, + seq`** — group by `id` (= `route_id`),
  then order ascending by `seq`. **Critical**: the paths
  renderer connects vertices in row-order within each
  `pathIdField` group. Without this sort, a `seq=3` row
  could appear before a `seq=1` row, producing a polyline
  that zigzags backward through the route. The `0` argument
  to `| sort` disables the default 10000-row cap (safe for
  small route tables; if your `routes.csv` exceeds 10000 rows
  add explicit `| head` to bound the result).
- **`| fields id, seq, lat, lon, site_id, site_name,
  route_name`** — explicit projection. `id` + `seq` drive
  the path geometry; `lat` + `lon` provide vertex
  coordinates; `site_id`, `site_name`, `route_name` carry
  through as feature properties for per-vertex popups
  (click a vertex → see "DC-DFW-02 — Dallas DC #2 — Route:
  LAX to ATL via DFW").

If your `routes.csv` already uses the canonical column names
`id` and `seq`, the recipe collapses to four lines:

```spl
| inputlookup routes.csv
| lookup sites site_id AS site_id OUTPUT lat, lon, site_name
| where isnotnull(lat) AND isnotnull(lon)
| sort 0 id, + seq
```

## 3. Expected fields

| field      | type    | example              |
|------------|---------|----------------------|
| id         | string  | ROUTE-LAX-ATL        |
| seq        | integer | 2                    |
| lat        | number  | 33.7490              |
| lon        | number  | -84.3880             |
| site_id    | string  | DC-ATL-01            |
| site_name  | string  | Atlanta DC #1        |
| route_name | string  | LAX to ATL via DFW   |

All seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`id` drives `pathIdField` (groups vertices into paths); `seq`
drives `timeField` (orders vertices within each path);
`lat`/`lon` provide geometry; `site_id`/`site_name`/`route_name`
flow through as feature properties for per-vertex popups.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#1f77b4",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit override pinning the
  field that groups rows into paths. Auto-detect would pick
  `id` (Better Map's `dataFitness.js` recognises the canonical
  alias), but pinning makes the path-grouping stable across
  formatter-version upgrades.
- **`timeField: "seq"`** — explicit override pinning the
  field that orders vertices WITHIN each path. The paths
  layer's `timeField` formatter option is named "time" by
  convention but accepts any monotonically-increasing
  per-path ordering field — `seq` (an integer) is the
  natural fit for CSV-driven routes where the ordering is
  manually assigned. For event-driven paths (e.g. the
  [cim-authentication/paths](../cim-authentication/paths.md)
  recipe), `timeField` would be `_time`.
- **`pathColor: "#1f77b4"`** — Tableau blue (Better Map's
  default neutral colour). Routes render in a single colour
  — distinguishable from each other at zoom because they
  occupy different physical geography, NOT because they have
  different colours. For dashboards with overlapping routes
  (e.g. a multi-carrier supply-chain panel where 5+ carriers
  share intermediate hubs), set `categoryField: "carrier"` +
  `palette: "set3"` to colour-code by carrier instead.
- **`pathArrows: true`** — render directional arrows on
  each polyline segment. **Critical** for supply-chain /
  customer-journey panels where the route's **direction**
  is the business signal (which way are the goods flowing?
  which way is the customer journey progressing?). Without
  arrows the polyline is bidirectional-ambiguous and the
  panel's value drops by half.
- **`route_name` flows through automatically** as a feature
  property on each vertex — popups can show the full route
  name without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce by dropping the
example `sites.csv` (from the
[markers companion](./markers.md)) + a hand-authored
`routes.csv` with 2-3 routes / 3-5 stops each into
`<app>/lookups/`, adding the matching `transforms.conf`
stanzas, pasting the SPL above into a Dashboard Studio map
panel with Better Map as the visualization, applying the
formatter JSON in §4, and confirming each route renders as a
distinct polyline with directional arrows on each segment._

## 6. Gotchas

- **`seq` must be monotonically increasing within each
  `route_id`.** The recipe sorts `0 id, + seq` before
  rendering — but if your CSV has gaps (`seq` jumps from 2
  to 5, missing 3 and 4) the polyline simply skips those
  vertices without visual indication. If you reorganise a
  route by inserting a new stop, REBUILD the `seq` values
  rather than appending fractional `seq` values
  (`2.5`) — fractional `seq` works in this recipe (the sort
  is numeric) but breaks any downstream consumer that
  expects integer ordering. Standardise on integers with
  unique values per `route_id`.
- **Route with one stop is silent.** A `route_id` with only
  one matching row (one `seq` value, no chain to draw) is
  not an error — the paths renderer simply emits no
  polyline (a single point has no edges). The
  [markers companion](./markers.md) is the right layer for
  showing isolated sites; this recipe is specifically for
  showing the connections between 2+ sites. Surface
  single-stop "routes" in a companion table panel for the
  ops team to investigate (typo? planned-but-not-started
  route? decommissioned middle stops?).
- **Route geometry is straight-line, not road-network.** The
  rendered polyline goes vertex-to-vertex in a straight
  great-circle line on the map — NOT along actual roads,
  flight paths, or shipping lanes. For physically-accurate
  routing visualisation (snap to roads, snap to airways),
  pre-compute the intermediate route geometry in a
  routing engine (OSRM, GraphHopper, Mapbox Directions
  API) and INSERT intermediate vertices into `routes.csv`
  with their own `seq` values. The recipe does not
  preprocess routing — by design (no outbound network
  calls, fully air-gap compatible per ROADMAP §1a).
- **Dateline-crossing paths render incorrectly.** A route
  from Sydney (151°E) to Los Angeles (118°W) will render
  as a polyline that goes WESTWARD across Asia + Europe +
  Atlantic (the "wrong way around"), NOT eastward across
  the Pacific. The Better Map paths renderer does not
  detect dateline-crossing pairs. Workaround: insert an
  intermediate vertex at the dateline (lat = midpoint, lon
  = ±180) to force the polyline into the short-way
  rendering. A v1.8+ formatter option for great-circle
  rendering is on the roadmap.
- **`max_matches = 0` on `routes.csv`.** Unlike the sites
  lookup (which uses `max_matches = 1` because each
  `site_id` is unique and only one row should match a
  lookup), `routes.csv` is a one-to-many table — multiple
  rows per `route_id`, one per stop. `max_matches = 0`
  (unlimited) is required for the `| lookup` to return
  all matching rows. Setting `max_matches = 1` would
  silently truncate routes to a single stop = no polyline
  rendered.
- **CSV reload latency.** Same as the
  [markers companion §6](./markers.md#6-gotchas) — Splunk
  caches lookups in memory per search head. After editing
  `routes.csv` on disk the panel may show stale path
  geometry until the lookup table refreshes — force a
  refresh with `| extract reload=t` in any panel, or wait
  for the lookup-table refresh interval (5 min default).
  For hot-edit workflows (route planners actively
  iterating route geometry), favour KV-Store over CSV.
- **No OT safety dependency.** Routes between IT sites
  (data centres, retail outlets, offices) carry no OT
  carve-out. If your `routes.csv` contains route stops at
  SIS-related sites (Level-0/1/2 in the Purdue model —
  e.g. inspection rounds through a control room), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 4 — Better Map MUST NOT be the surface that takes
  action against an SIS site. The path renders the route
  for situational awareness; per Rule 4 / Rule 5, any
  action against a vertex on the route requires a
  separate, human-authenticated, change-controlled
  workflow outside Better Map.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`inputlookup`, `lookup`,
`where`, `rename`, `sort`, `fields`). The formatter options
(`pathIdField`, `timeField`, `pathColor`, `pathArrows`) are
all present in `docs/_machine/formatter-schema.json` and cross-
checked by `scripts/check-formatter-coverage.py`. Verification
deferred pending the D5 harness landing — at which point a
hand-authored `sites.csv` + `routes.csv` pair can be dropped
into the lab tenant and the panel rendered end-to-end.
