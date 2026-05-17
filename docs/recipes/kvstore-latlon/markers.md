---
schema_version: 1
id: kvstore-latlon--markers
source:
  id: kvstore-latlon
  display_name: "KV Store (lat/lon collection)"
  pattern: splunk-lookup
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-17"
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
  - name: site_type
    type: string
    example: "data_center"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Splunk lookups skill — KV Store lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "dataFitness.js alias auto-detect (lat/lon/id auto-picked)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/dataFitness.js"
---

# KV Store (lat/lon collection) — markers

The simplest possible Better Map recipe: a customer-managed KV Store
collection of named locations, rendered as one marker per row. No
add-ons required, no GeoIP enrichment, no time-series join — every
field the panel needs is owned by the customer in a single
collection.

## 1. Source description

A KV Store collection is the right home for a **small, human-curated
list of fixed sites** — data centres, retail stores, plants, branch
offices, charging stations, indoor venues. KV Store rows have the
following advantages over CSV lookups for this use case:

- **Editable in place**: the inventory team can `outputlookup` rows
  from a saved search, or PUT rows over REST, without redeploying
  the app.
- **Permissionable**: row-level RBAC via `outputlookup` ACLs.
- **Replicable**: KV Store rides Splunk's KV replication onto search
  heads automatically — no per-SH lookup file sync.

The recipe binds to a collection named `site_locations` (rename to
match your install) with the columns `site_id`, `site_name`, `lat`,
`lon`, `site_type`.

**Typical sourcetype / index:** none — `| inputlookup` runs against
the KV Store collection directly, no event ingestion is involved.

**One-time setup** (skip if your collection already exists):

```spl
| makeresults
| eval site_id="DC-ATL-01", site_name="Atlanta data center",
       lat=33.7490, lon=-84.3880, site_type="data_center"
| append [
  | makeresults
  | eval site_id="DC-FRA-01", site_name="Frankfurt data center",
         lat=50.1109, lon=8.6821, site_type="data_center"]
| append [
  | makeresults
  | eval site_id="DC-SYD-01", site_name="Sydney data center",
         lat=-33.8688, lon=151.2093, site_type="data_center"]
| fields - _time
| outputlookup site_locations
```

(The one-time setup is the only place `| makeresults` is allowed in
this recipe — it is bootstrap data, not panel data. Per ROADMAP §1a
and the Splunk SPL anti-pattern rules, `| makeresults` is BANNED
inside dashboard `dataSources` queries.)

## 2. SPL recipe

```spl
| inputlookup site_locations
| rename site_id AS id
| fields id, lat, lon, site_name, site_type
```

That's the whole panel search. No time predicate — KV Store reads
are time-independent. No `stats` — every row is a marker.

The `| rename site_id AS id` is what lets Better Map's drilldown
and cross-panel coordination work without setting `idField` in the
formatter: `id` is in the auto-detected alias list (`id`,
`feature_id`, `iso`, `iso2`, `iso3`, `admin1`, `state`, `country`).
Similarly `lat` / `lon` are auto-detected, so no `latField` /
`lonField` override is needed.

If your collection is larger and you want to filter by region in
the dashboard with a `$site_type$` input token, extend with:

```spl
| inputlookup site_locations
| where site_type="$site_type$"
| rename site_id AS id
| fields id, lat, lon, site_name, site_type
```

(One pipe per line, per the SPL quality rule in
[`splunk-conf-and-spl.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-conf-and-spl.mdc).)

## 3. Expected fields

| field      | type   | example             |
|------------|--------|---------------------|
| id         | string | DC-ATL-01           |
| lat        | number | 33.7490             |
| lon        | number | -84.3880            |
| site_name  | string | Atlanta data center |
| site_type  | string | data_center         |

All five fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "markers"
}
```

Why this is the entire config:

- **Auto-detect handles lat / lon / id.** The SPL produces fields
  with canonical names (`lat`, `lon`, `id`) that Better Map's
  `dataFitness.js` module recognises automatically. No `latField`
  / `lonField` / `idField` overrides are needed.
- **`pointRenderer: "markers"`** — pin the renderer to markers
  explicitly. The default `"auto"` would also render markers for
  a small collection (< 200 features), but a hand-curated KV-Store
  site list almost never needs clustering or heatmap; pinning
  removes one degree of automatic behaviour the dashboard author
  has to predict.
- **`site_name` and `site_type` flow through automatically** as
  feature properties on the rendered GeoJSON — popups, tooltips,
  and drilldown actions can reference them by name.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). Until then, a maintainer can reproduce the panel by pasting the
SPL above into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4._

## 6. Gotchas

- **Field types in KV Store collections.** `lat` and `lon` MUST be
  declared as `number` in your `collections.conf` stanza. If they
  default to `string`, Better Map's auto-swap heuristic
  (`autoSwap`) cannot fire, AND `dataFitness.js` will silently drop
  rows whose lat/lon can't be parsed as numbers. Always validate
  with `| inputlookup site_locations | fieldsummary lat lon` and
  confirm `numeric_count` matches the row count.
- **KV Store replication.** On a search-head cluster, KV writes go
  through the captain; reads are local. If a recently-`outputlookup`-ed
  row does not appear in the panel within a second or two, force a
  collection refresh via `| inputlookup site_locations | append [|
  makeresults | eval foo=1] | head 1` (the no-op forces a fresh read).
- **`id` is reserved.** Better Map auto-picks `id` (and a handful
  of CIM-style siblings: `feature_id`, `iso`, `iso2`, `iso3`,
  `admin1`, `state`, `country`) as the identifier for drilldown
  and cross-panel coordination. If your KV-Store column is called
  `site_id`, the `| rename site_id AS id` in the SPL above is
  essential — otherwise the auto-detect falls back to the first
  ID-shaped column it finds, which is usually wrong.
- **Time-cursor compatibility.** Because KV Store rows have no
  `_time`, the Better Map time scrubber widget has no effect on
  this panel. If the dashboard wires the scrubber to other panels
  (e.g. a time-correlated event layer), this panel will simply
  not respond — which is the correct behaviour for a "fixed sites"
  layer.
- **No OT safety dependency.** This is a pure IT/inventory layer.
  If your `site_locations` collection ALSO contains entries for
  SIS-related assets (Level-0/1/2 in the Purdue model), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — flag those rows with a `safety_related: true` column
  and render them in a DEDICATED layer with a hand-curated marker
  style + popup that says "READ ONLY — SIS asset, no action permitted
  from this panel." Better Map MUST NOT be the surface that takes
  action against an SIS asset.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and follows the documented KV-Store and SPL contracts, but it
has not been dispatched against a real `site_locations` collection
in the v1.7-prep development cycle (the lab tenant does not have a
`site_locations` collection populated). A maintainer with write
access to a Splunk dev tenant should:

1. Run the one-time setup `| outputlookup site_locations` once.
2. Run the panel SPL and confirm three rows return with the five
   documented fields.
3. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change without
   touching the schema.
