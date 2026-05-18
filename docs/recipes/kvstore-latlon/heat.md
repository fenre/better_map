---
schema_version: 1
id: kvstore-latlon--heat
source:
  id: kvstore-latlon
  display_name: "KV Store (lat/lon collection)"
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
    example: "DC-ATL-01"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "33.7490"
  - name: lon
    type: number
    example: "-84.3880"
  - name: site_name
    type: string
    example: "Atlanta data center"
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
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/kvstore-latlon/markers.md"
  - description: "Splunk lookups skill — KV Store lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# KV Store (lat/lon collection) — heatmap

The pedagogical complement to the
[kvstore-latlon/markers](./markers.md) recipe — same source
collection, same join semantics, but rendered as a weighted
heatmap rather than discrete markers. The heat layer surfaces
**activity volume per site** as colour intensity: hot blobs
indicate sites generating the most events; cool blobs indicate
quiet sites. This is the natural shape when the dashboard
question is "which of my sites are busiest right now?" rather
than "where is each site located?".

## 1. Source description

Same `site_locations` KV-Store collection as
[kvstore-latlon/markers](./markers.md) — an inventory of fixed
sites with `site_id`, `site_name`, `lat`, `lon`, `site_type`
columns. The difference is the SECOND data source: an events
index that carries a `site_id` field (extracted from
`hostname` via a CIM `FIELDALIAS`, or set directly by a
forwarder via `inputs.conf` `_meta`, or tagged in by a search-
time `eval`). The two sources are joined on `site_id`: the
events provide WEIGHT (event count per site), the KV Store
provides POSITION (lat / lon per site).

For a global fleet of N sites with M total events across all
sites, the panel emits N feature rows — one per site, with a
`weight` column normalised against the max — and the heat
layer renders each row as a Gaussian blob whose intensity is
weighted by `weight`. Sites with higher `event_count` produce
darker / hotter blobs; sites with lower `event_count` produce
fainter blobs.

**Typical sourcetype / index:** events index varies by use
case (`web`, `firewall`, `wineventlog`, `aws:cloudtrail`, ...);
the `site_locations` KV Store is the same regardless. The
events SPL stage assumes the events have already been
enriched with a `site_id` field; if they have not, see §6
Gotchas for the enrichment patterns.

This recipe assumes the `site_locations` KV-Store collection
described in
[kvstore-latlon/markers](./markers.md) already exists — its
one-time setup is the prerequisite, not duplicated here.

## 2. SPL recipe

```spl
index=web sourcetype=access_combined earliest=-1h latest=now
| stats count AS event_count BY site_id
| lookup site_locations site_id OUTPUT site_name, lat, lon, site_type
| where isnotnull(lat) AND isnotnull(lon)
| eventstats max(event_count) AS max_event_count
| eval weight=round(event_count / max_event_count, 2)
| rename site_id AS id
| fields id, lat, lon, site_name, site_type, event_count, weight
| sort - event_count
| head 5000
```

Why this exact shape, line by line:

- **`index=web sourcetype=access_combined earliest=-1h latest=now`**
  — change to whatever events index represents "activity" in your
  install. The recipe uses web access logs as the canonical
  example because every Splunk install has them. A 1 h window
  gives a rolling "recently busy" picture without dragging in
  long-tail history.
- **`stats count AS event_count BY site_id`** — one row per
  site, with the count of events on that site in the window.
  The `BY site_id` is what makes the heat blob density per-site
  rather than per-event.
- **`lookup site_locations site_id OUTPUT site_name, lat, lon,
  site_type`** — pull coordinates AND display fields from the
  KV Store. `site_id` is the join key on both sides (no `AS`
  alias needed — same name).
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop any
  site that is in the events stream but not in the KV Store
  (an unregistered site_id). Surface those in a companion
  table panel for the inventory team to backfill.
- **`eventstats max(event_count) AS max_event_count`** — adds
  the global maximum as a column on every row, so the next
  `eval` can normalise. `eventstats` (not `stats`) is the
  right command here because it KEEPS the per-site rows and
  only ADDS the new column.
- **`eval weight=round(event_count / max_event_count, 2)`** —
  normalise to a `[0, 1]` band so the heat layer's weight
  property has a predictable scale across panels. Rounded to
  2 decimal places for stable rendering and clean popup
  formatting.
- **`rename site_id AS id`** — adopt Better Map's canonical
  `id` alias, same convention as the markers recipe.
- **`fields ...`** — explicit field projection — drops the
  `max_event_count` helper and any other transient columns.
- **`sort - event_count, head 5000`** — render budget. A heat
  layer scales to thousands of points cleanly. 5000 covers a
  fleet of thousands of sites comfortably.

## 3. Expected fields

| field         | type   | example             |
|---------------|--------|---------------------|
| id            | string | DC-ATL-01           |
| lat           | number | 33.7490             |
| lon           | number | -84.3880            |
| site_name     | string | Atlanta data center |
| event_count   | number | 1284                |
| weight        | number | 0.84                |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`site_type` flows through as a feature property for the popup
but is not strictly required by the heat layer.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 24
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin (the default
  `"auto"` would only switch to heatmap above 200 features, so
  for small fleets the recipe needs an explicit pin to force
  the heat rendering).
- **`heatmapOpacity: 0.75`** — sweet spot from the
  formatter-schema (range 0.0-1.0). At 1.0 the heat blobs
  fully occlude the underlying basemap labels; at 0.5 the
  heat is too washed out to read at low zoom. 0.75 lets you
  read both the heat colour ramp AND the city / region labels
  underneath at globe zoom.
- **`heatmapRadius: 24`** — pixel radius at low zoom. The
  formatter-schema documents the range as 2-64 px. 24 px is
  appropriate for a "fleet of sites" view where blobs from
  neighbouring sites SHOULD merge at world zoom (giving a
  regional density read), and resolve to per-site blobs at
  country / city zoom. A radius of 8 (the schema placeholder)
  is sharper but produces isolated dots at world zoom that
  read as markers rather than heat — defeating the layer's
  purpose. For a single-region or single-city view, drop to
  12-16.
- **`weight` drives heat intensity automatically.** The heat
  layer renderer auto-picks the `weight` field by name (per
  Better Map's `dataFitness.js` field aliasing). If you
  rename `weight` in the SPL, also set the formatter's
  `heatField` option (or whichever name the formatter schema
  uses — check `docs/_machine/formatter-schema.json`).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). A maintainer can reproduce the panel by pasting the SPL
above into a Dashboard Studio map panel with Better Map as the
visualization, applying the formatter JSON in §4, and varying
the events index to confirm the heat ramps with activity volume
(e.g. compare a quiet 3 AM window vs a busy peak-hour window —
the heat ramp should shift markedly even though the SITE LIST
is identical)._

## 6. Gotchas

- **`site_id` extraction must already exist on the events.**
  This recipe assumes the events stream carries a `site_id`
  field. If it does not, three common enrichment patterns:
  (1) `EVAL-site_id = case(match(host, "atl"), "DC-ATL-01",
  match(host, "fra"), "DC-FRA-01", ...)` in props.conf;
  (2) a separate `host_to_site.csv` lookup at index time
  (`LOOKUP-site = host_to_site host OUTPUTNEW site_id`);
  (3) a `_meta` annotation in `inputs.conf` on each
  forwarder (`_meta = site_id::DC-ATL-01`). Best practice
  is option 1 if your hostnames are regular; option 2 if
  the mapping is irregular but stable; option 3 if you
  control the forwarders and want zero search-time cost.
- **`weight` normalisation gotcha.** The normalisation uses
  the SINGLE max across the panel window. If one site is
  10000× busier than the rest, every other site's `weight`
  rounds to 0.00 and the heat layer renders them as
  invisible. For multi-site heat where the volumes span
  orders of magnitude, replace the `eval weight=...` with
  `eval weight=round(log10(event_count) / log10(max_event_count), 2)`
  (log-scale normalisation), or drop the heaviest 1% with
  a `where event_count < percentile90(event_count)`
  prefilter.
- **Heat layer vs markers — when to choose which.** Heat is
  the right layer for "show me the activity intensity"
  questions. Markers (per
  [kvstore-latlon/markers](./markers.md)) are the right
  layer for "show me each site individually" questions.
  Both can coexist in the same dashboard with the same
  KV-Store collection — the heat layer goes underneath
  (rendered first in the panel), markers go on top
  (rendered second), and the operator gets BOTH the
  activity heatmap AND the discrete-site drilldown
  affordance. Use Better Map's BM-CT-1 layer contract
  (`setEnabled` / `isEnabled` / `reset`) to toggle each
  layer independently from a dashboard input.
- **Heat layer is NOT good for "show me each event".** Every
  event from a single site collapses to a single feature
  (one row in the panel). If the dashboard question is
  "show me each individual event on the map," use a
  marker layer over the raw event stream (not over the
  per-site stats). The heat layer is fundamentally a
  per-feature-density renderer — pre-aggregate to one row
  per heat blob you want rendered.
- **Empty result handling.** If the events index has zero
  matching events in the window, the `stats` returns
  empty, the `lookup` returns nothing, the panel renders
  an empty heat layer (no error). This is the correct
  behaviour — the heat layer shouldn't pretend there is
  activity when there isn't. To distinguish "no events"
  from "events but no registered sites," add a companion
  single-value panel showing `| inputlookup site_locations
  | stats count` so the operator can verify the inventory
  is non-empty even when the heat layer is blank.
- **`max_event_count` cardinality.** `eventstats max(...)`
  re-distributes the value to every row. On extremely
  large fleets (10000+ sites) this is a non-trivial CPU
  cost — but typical KV-Store-anchored panels run on
  fleets in the 10-1000 range where the cost is
  negligible.
- **Time range.** The 1 h window in the recipe is a typical
  "operations dashboard" window. Widen to 24 h for shift-
  handover views, narrow to 5 min for live ops. The
  KV-Store lookup itself is time-independent so the time
  range affects only the events `stats`.
- **No OT safety dependency.** As with the markers recipe,
  this is a pure IT / inventory layer. If `site_locations`
  contains SIS-related sites (Level-0/1/2 in the Purdue
  model), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — split SIS sites into a separate dedicated
  layer with `ot_safety_relevant: true` and a hand-curated
  marker style + popup that says "READ ONLY — SIS asset, no
  action permitted from this panel." Heat is generally not
  the right layer for SIS visualisation anyway because it
  obscures individual asset identity — use markers there.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented KV-Store + lookup
contracts plus the canonical `eventstats max + eval normalise`
heat-weight pattern, and only references Splunk built-ins. It
has not been dispatched against a real `site_locations`
collection joined to a real events index in the v1.7-prep
development cycle (the lab tenant carries neither). A
maintainer with REST auth to a tenant with both a populated
`site_locations` collection AND a `site_id`-tagged events
index (any sourcetype) should:

1. Confirm the events carry `site_id`:
   `index=<your_index> earliest=-1h | stats dc(site_id)`.
2. Confirm the join is non-empty:
   `index=<your_index> earliest=-1h | stats count BY site_id |
   lookup site_locations site_id OUTPUT lat | where
   isnotnull(lat) | stats count`.
3. Run the recipe SPL and confirm the heat layer renders
   denser blobs over busier sites (eyeball-test against a
   companion `count BY site_id` panel).
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` with the events index / sourcetype
   pair, and submit a follow-up PR.
