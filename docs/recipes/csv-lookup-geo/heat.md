---
schema_version: 1
id: csv-lookup-geo--heat
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (geo polygons)"
  pattern: splunk-lookup
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required: []
expected_fields:
  - name: id
    type: string
    example: "STORE-0042"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "33.7490"
  - name: lon
    type: number
    example: "-84.3880"
  - name: site_name
    type: string
    example: "Atlanta Downtown #42"
  - name: site_category
    type: string
    example: "retail"
  - name: event_count
    type: number
    example: "1284"
  - name: weight
    type: number
    example: "0.84"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer"
    path: "docs/recipes/csv-lookup-geo/markers.md"
  - description: "Companion recipe — same source, supercluster layer"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Companion recipe — same source family, polygon layer"
    path: "docs/recipes/csv-lookup-geo/polygons.md"
  - description: "Companion recipe — same source family, vector-tile-join"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "Pattern reference — same heat-weight shape, KV-Store source"
    path: "docs/recipes/kvstore-latlon/heat.md"
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# CSV lookup (geo points) — heatmap

The activity-volume complement to the
[csv-lookup-geo/markers](./markers.md) +
[csv-lookup-geo/supercluster](./supercluster.md) recipes — same
`csv-lookup-geo` source pattern, same `sites.csv` lookup that holds
`site_id` → `lat`/`lon` (plus descriptive columns), but rendered
as a **weighted heatmap** driven by an events-index join. The
question this recipe answers is "which of my CSV-listed sites
are busiest right now?" — not "where is each site?" (use
[markers](./markers.md)) nor "how many sites are clustered in
each region?" (use [supercluster](./supercluster.md)). Completes
the `csv-lookup-geo` source-row triplet (markers / supercluster /
heat — polygons and vector-tile-join are separate-shape layers
for the same source pattern).

## 1. Source description

Same `sites.csv` lookup mechanism as the markers /
supercluster siblings — a CSV file under
`<app>/lookups/sites.csv` with columns
`site_id,site_name,site_category,lat,lon` exposed via a
`transforms.conf` `[sites]` stanza, queried with the `| lookup`
command. The difference here is the SECOND data source: an
events index that carries a `site_id` field (extracted from
`hostname` via a CIM `FIELDALIAS`, set directly by a forwarder
via `inputs.conf` `_meta`, or tagged in by a search-time `eval`).
The two sources are joined on `site_id`: the events provide
WEIGHT (event count per site), the CSV provides POSITION (lat /
lon / display fields per site). Structurally identical to the
[kvstore-latlon/heat](../kvstore-latlon/heat.md) pattern — the
only difference is the inventory store (CSV file vs KV-Store
collection), which changes the operational model (git-friendly
+ version-controlled + AppInspect-clean for CSV vs live-editable
+ REST-API-driven for KV-Store) but NOT the SPL shape.

**Why heatmap for CSV-listed sites.** A markers view at world
zoom shows you WHERE each site is but not WHICH sites are
active. A supercluster view tells you how many sites are
clustered per region but flattens activity volume to "1 site =
1 dot." For the executive panel "show me my fleet's load
distribution" or the SRE panel "which sites are hottest in this
window?" the heat layer is the right shape — it weights each
feature by activity and lets the operator see the pressure
gradient at a glance.

**Heatmap vs markers vs supercluster — which to choose.**
- Use **markers** when the panel question is "WHICH SITE is
  this dot? Let me click it." (per-site identity, ≤ 200
  sites). Layer: [markers](./markers.md).
- Use **supercluster** when the panel question is "how many
  sites do I have per region, and let me drill down per
  individual" (200-250k sites, identity preserved via cluster
  expand-on-click). Layer: [supercluster](./supercluster.md).
- Use **heatmap** (this recipe) when the panel question is
  "where is the ACTIVITY distributed?" (volume-weighted,
  identity collapsed into density). The heat layer is the
  right shape for executive briefings, multi-region SRE
  reviews, and "which of my sites generated the most traffic
  this hour" questions.

**Typical sourcetype / index:** events index varies by use
case (`web`, `firewall`, `wineventlog`, `aws:cloudtrail`,
`pan:traffic`, ...); the `sites.csv` lookup is the same
regardless. The events SPL stage assumes the events have
already been enriched with a `site_id` field; if they have
not, see §6 Gotchas for the enrichment patterns.

This recipe assumes the `sites.csv` lookup described in
[csv-lookup-geo/markers §1](./markers.md#1-source-description)
already exists — its one-time setup is the prerequisite, not
duplicated here.

## 2. SPL recipe

```spl
index=web sourcetype=access_combined earliest=-1h latest=now
| stats count AS event_count BY site_id
| lookup sites site_id OUTPUT lat, lon, site_name, site_category
| where isnotnull(lat) AND isnotnull(lon)
| eventstats max(event_count) AS max_event_count
| eval weight=round(event_count / max_event_count, 2)
| rename site_id AS id
| fields id, lat, lon, site_name, site_category, event_count, weight
| sort - event_count
| head 5000
```

Why this exact shape, line by line:

- **`index=web sourcetype=access_combined earliest=-1h latest=now`**
  — change to whatever events index represents "activity" in
  your install. The recipe uses web access logs as the canonical
  example because every Splunk install has them. A 1 h window
  gives a rolling "recently busy" picture without dragging in
  long-tail history. For shift-handover views widen to 24 h;
  for live ops narrow to 5 min.
- **`stats count AS event_count BY site_id`** — one row per
  site, with the count of events on that site in the window.
  The `BY site_id` is what makes the heat blob density per-site
  rather than per-event.
- **`lookup sites site_id OUTPUT lat, lon, site_name,
  site_category`** — pull coordinates AND display fields from
  the CSV. `site_id` is the join key on both sides (no `AS`
  alias needed — same name as the CSV column). The `lookup`
  command reads from the `[sites]` `transforms.conf` stanza.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop any
  `site_id` value that is in the events stream but missing
  from `sites.csv` (an unregistered site, a typo in the
  hostname enrichment, a decommissioned site whose entry was
  deleted from the CSV but whose hostname still appears in
  events). Surface those in a companion table panel for the
  site-ops team to backfill.
- **`eventstats max(event_count) AS max_event_count`** — adds
  the global maximum as a column on every row, so the next
  `eval` can normalise. `eventstats` (not `stats`) is the right
  command here because it KEEPS the per-site rows and only ADDS
  the new column.
- **`eval weight=round(event_count / max_event_count, 2)`** —
  normalise to a `[0, 1]` band so the heat layer's weight
  property has a predictable scale across panels. Rounded to
  2 decimal places for stable rendering and clean popup
  formatting.
- **`rename site_id AS id`** — adopt Better Map's canonical
  `id` alias, same convention as the markers / supercluster
  siblings and every other recipe in the matrix.
- **`fields id, lat, lon, site_name, site_category,
  event_count, weight`** — explicit projection. CSV lookups
  often carry many columns (opening date, manager, square
  footage, regional VP, cost centre); for the heat panel we
  only need the seven documented in the field contract.
  `max_event_count` is dropped explicitly (it was a transient
  helper).
- **`sort - event_count`, `head 5000`** — render budget. The
  heat layer scales to thousands of points cleanly. 5000
  covers a fleet of thousands of sites comfortably. The
  `sort - event_count` makes the hottest sites render first,
  which is the right z-order for the heat layer (overlap of
  hot blobs reinforces; overlap of hot-over-cold lets the hot
  bleed through).

## 3. Expected fields

| field         | type   | example              |
|---------------|--------|----------------------|
| id            | string | STORE-0042           |
| lat           | number | 33.7490              |
| lon           | number | -84.3880             |
| site_name     | string | Atlanta Downtown #42 |
| site_category | string | retail               |
| event_count   | number | 1284                 |
| weight        | number | 0.84                 |

All seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`site_name` and `site_category` flow through as feature
properties for the popup but are not strictly required by the
heat layer (the heat renderer reads only `lat`, `lon`, and
`weight`; the descriptive columns survive the join because
the heat layer preserves all feature properties for the popup
panel that pops up on hover / click of a hot region).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 24
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the heatmap
  renderer. The `auto` renderer switches to heatmap above
  ~200 features, so for SMALL CSVs (the most common
  csv-lookup-geo use case — a corporate site list, a regional
  datacenter inventory) the recipe needs an explicit pin to
  force the heat rendering even when the active-site count
  drops below 200.
- **`heatmapOpacity: 0.75`** — matches the `kvstore-latlon/
  heat` recipe. At 1.0 the heat fully occludes the basemap
  labels; at 0.5 the heat is too washed out to read at low
  zoom; 0.75 is the sweet spot for an SRE / executive
  audience that needs to read both the heat gradient AND the
  underlying city / region labels.
- **`heatmapRadius: 24`** — matches the `kvstore-latlon/heat`
  recipe (a fleet-of-sites view where blobs from neighbouring
  sites SHOULD merge at world zoom and resolve to per-site
  blobs at country / city zoom). For a single-region or
  single-city view, drop to 12-16; for a dense
  hundreds-of-sites-per-metro view (the retail-flagship
  pattern), bump to 28-32.
- **`weight` drives heat intensity automatically.** The heat
  layer renderer auto-picks the `weight` field by name (per
  Better Map's `dataFitness.js` field aliasing). If you
  rename `weight` in the SPL, also set the formatter's
  `heatField` option (or whichever name the formatter schema
  uses — check
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce the panel by
dropping a hand-authored `sites.csv` (10-30 rows with realistic
`site_id` values that match a `site_id`-tagged events index)
into `<app>/lookups/`, adding the `[sites]` transforms.conf
stanza, pasting the SPL above into a Dashboard Studio map panel
with Better Map as the visualization, applying the formatter
JSON in §4, and varying the events index to confirm the heat
ramps with activity volume (e.g. compare a quiet 3 AM window
vs a busy peak-hour window — the heat ramp should shift
markedly even though the SITE LIST in `sites.csv` is identical)._

## 6. Gotchas

- **`site_id` extraction must already exist on the events.**
  Same gotcha as the [kvstore-latlon/heat
  sibling](../kvstore-latlon/heat.md#6-gotchas). If your events
  stream does not carry a `site_id` field, three common
  enrichment patterns: (1) `EVAL-site_id = case(match(host,
  "atl"), "STORE-0042", match(host, "fra"), "STORE-0156",
  ...)` in props.conf; (2) a separate `host_to_site.csv`
  lookup at index time (`LOOKUP-site = host_to_site host
  OUTPUTNEW site_id`); (3) a `_meta` annotation in
  `inputs.conf` on each forwarder (`_meta = site_id::STORE-0042`).
  Best practice is option 1 if your hostnames are regular;
  option 2 if the mapping is irregular but stable; option 3
  if you control the forwarders and want zero search-time
  cost.
- **`weight` normalisation gotcha.** Same as the
  [kvstore-latlon/heat sibling](../kvstore-latlon/heat.md#6-gotchas)
  — the normalisation uses the SINGLE max across the panel
  window. If one site is 10000× busier than the rest, every
  other site's `weight` rounds to 0.00 and the heat layer
  renders them as invisible. For multi-site heat where the
  volumes span orders of magnitude, replace the
  `eval weight=...` with
  `eval weight=round(log10(event_count + 1) / log10(max_event_count + 1), 2)`
  (log-scale normalisation), or drop the heaviest 1% with a
  `where event_count < percentile99(event_count)` prefilter.
- **Heat vs markers vs supercluster — when to choose
  which.** Three CSV-lookup-geo layers, three answers:

  | Layer | Best for | Switch when |
  |---|---|---|
  | `markers` ([csv-lookup-geo/markers](./markers.md)) | ≤ 200 discrete sites needing per-site click affordance | Rows grow past ~200 OR you want activity-weighted display |
  | `supercluster` ([csv-lookup-geo/supercluster](./supercluster.md)) | 200-250k sites with per-site identity preserved (cluster expands on click) | You want continuous density signal instead of cluster-count circles |
  | `heatmap` (this recipe) | Activity-weighted density view (the events index drives intensity) | The dashboard question shifts to per-site identity → switch to markers |

  All four CSV-lookup-geo layers (markers, supercluster, heat,
  polygons) can coexist in the same dashboard via Better Map's
  BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
  `reset`) toggled from dashboard inputs — heat goes
  underneath (rendered first), markers go on top (rendered
  second), and the operator gets BOTH the activity heatmap
  AND the discrete-site drilldown affordance.
- **CSV file vs KV-Store choice.** Same as the
  [csv-lookup-geo/markers §6 gotcha](./markers.md#6-gotchas)
  — for the inventory aspect the choice is operational, not
  performance: git-friendly + version-controlled +
  AppInspect-clean → CSV; live-editable from the Splunk UI +
  REST API + role-based per-row authorisation → KV-Store. The
  heat SPL shape is identical for both stores (substitute
  `| inputlookup sites OUTPUT ...` for the KV-Store collection
  read, or use the `lookup` command in either case).
- **`auto` renderer switching at 200 features.** Same gotcha
  as the markers sibling — the formatter's
  `pointRenderer: "auto"` enum description in
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)
  documents the 200-feature → cluster switch and the
  10000-feature → heat switch. For the heat use case you
  WANT heat regardless of feature count, so pin to
  `pointRenderer: "heatmap"` always. If you accept the auto
  switch you'll get cluster (not heat) for fleets of 10-200
  active sites — defeating the layer choice.
- **Empty result handling.** If the events index has zero
  matching events in the window, `stats count BY site_id`
  returns empty, the `lookup` returns nothing, the panel
  renders an empty heat layer (no error). This is the
  correct behaviour — the heat layer shouldn't pretend there
  is activity when there isn't. To distinguish "no events"
  from "events but no registered sites," add a companion
  single-value panel showing `| inputlookup sites | stats
  count` so the operator can verify the inventory is
  non-empty even when the heat layer is blank.
- **CSV file-size ceiling.** Splunk's default
  `[lookup] max_memtable_bytes = 25000000` (25 MB) per
  `transforms.conf` lookup. For typical site inventories
  (10-5000 rows at ~200 bytes per row = 2 KB - 1 MB) this
  is irrelevant. Documenting for completeness — at ~125k
  rows the CSV would hit the ceiling and require either
  splitting into multiple lookup files or migrating to a
  KV-Store collection (which has no size ceiling and offers
  per-row REST access for live edits).
- **`max_event_count` cardinality.** `eventstats max(...)`
  re-distributes the value to every row. On extremely large
  fleets (10000+ sites) this is a non-trivial CPU cost — but
  typical CSV-anchored panels run on fleets in the 10-1000
  range where the cost is negligible.
- **Time range.** The 1 h window in the recipe is a typical
  "operations dashboard" window. Widen to 24 h for shift-
  handover views, narrow to 5 min for live ops. The CSV
  lookup itself is time-independent so the time range
  affects only the events `stats`.
- **No OT safety dependency.** As with the markers /
  supercluster siblings, this is a pure IT / inventory layer.
  If `sites.csv` contains SIS-related sites (Level-0/1/2 in
  the Purdue model — control rooms, RTU enclosures, SCADA
  workstations), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — split SIS sites into a separate dedicated
  layer with `ot_safety_relevant: true` and a hand-curated
  marker style + popup that says "READ ONLY — SIS asset,
  no action permitted from this panel." Heat is generally
  not the right layer for SIS visualisation anyway because
  it obscures individual asset identity — use markers
  there.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented CSV-lookup +
`| lookup` + `eventstats max + eval normalise` heat-weight
pattern, mirrors the verified-pattern shape of the
[kvstore-latlon/heat](../kvstore-latlon/heat.md) sibling, and
only references Splunk built-ins. It has not been dispatched
against a real `sites.csv` joined to a real events index in
the v1.7-prep development cycle (the lab tenant carries
neither). A maintainer with REST auth to a tenant with both a
populated `sites.csv` AND a `site_id`-tagged events index
(any sourcetype) should:

1. Confirm the events carry `site_id`:
   `index=<your_index> earliest=-1h | stats dc(site_id)`.
2. Confirm the join is non-empty:
   `index=<your_index> earliest=-1h
   | stats count BY site_id
   | lookup sites site_id OUTPUT lat
   | where isnotnull(lat)
   | stats count`.
3. Run the recipe SPL and confirm the heat layer renders
   denser blobs over busier sites (eyeball-test against a
   companion `count BY site_id` panel).
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` with the events index / sourcetype pair,
   and submit a follow-up PR.
