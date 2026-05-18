---
schema_version: 1
id: csv-lookup-geo--markers
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (geo polygons)"
  pattern: splunk-lookup
layer:
  id: markers
  display_name: Markers
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
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, supercluster layer (≥ 200 features)"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Companion recipe — same source family, polygon layer"
    path: "docs/recipes/csv-lookup-geo/polygons.md"
  - description: "Companion recipe — same source family, vector-tile-join"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — pointRenderer enum"
    path: "docs/_machine/formatter-schema.json"
---

# CSV lookup (geo points) — markers

The discrete-per-point complement to the
[csv-lookup-geo/supercluster](./supercluster.md) recipe — same
`csv-lookup-geo` source pattern, same `| inputlookup` read,
same five-column contract (`id`, `lat`, `lon`, plus two
descriptive columns), but rendered as **individual markers**
with full per-point popup affordance. This is the canonical
"my CSV has a small-to-medium list of geographic things and I
want to see each one on a map with its own popup" recipe —
the most universal `csv-lookup-geo` pattern, conspicuously
missing from the matrix until wave 13. Use it when your CSV
holds **≤ 200 points** (above that, the formatter's `auto`
renderer correctly switches to cluster; pin to `markers` if
you want to force per-marker rendering up to ~500).

## 1. Source description

Same **CSV lookup** mechanism as the
[supercluster sibling](./supercluster.md) — a CSV file under
`<app>/lookups/<name>.csv` exposed via a `transforms.conf`
stanza, queried with `| inputlookup <name>`. This recipe
binds to a lookup named `sites.csv` (rename to match your
install) with the columns `site_id`, `site_name`,
`site_category`, `lat`, `lon`.

**Why markers (not cluster/heatmap/H3) for this dataset.**
The markers layer's strength is **discrete identity** — each
feature is independently clickable with its own popup. For
small CSVs (a corporate office list, a retail flagship list,
a regional datacenter inventory) the per-point identity is the
WHOLE POINT of the panel: the user wants to click a marker and
see "Atlanta Downtown #42 — opened 2018 — manager: Alice —
phone: 555-0101." Cluster collapses individuals into counts;
heatmap eliminates per-point identity entirely; H3 aggregates
into hex cells. None of those carry the per-point click
affordance the small-CSV use case needs.

**When to switch to supercluster.** Once the CSV has > 200
points the markers layer becomes visually noisy at world
zoom (overlapping circles, illegible). At that point the
[supercluster sibling](./supercluster.md) is the right
recipe — it preserves the per-point identity (click a
cluster to zoom + expand, then click the individual marker
for the popup) while collapsing the visual density at
overview zoom. The 200-feature threshold is the formatter's
`auto`-renderer switching point and a good operational
heuristic.

**Typical sourcetype / index:** none — `| inputlookup` reads
the CSV directly, no event ingestion is involved. Same as
the supercluster sibling, every dispatch is a fresh CSV
read; no acceleration, no summary index. Git-friendly,
version-controlled, AppInspect-clean.

**One-time setup** (skip if your lookup already exists):

1. Place the CSV at `<app>/lookups/sites.csv` with header row
   `site_id,site_name,site_category,lat,lon`.
2. Add to `<app>/default/transforms.conf`:
   ```ini
   [sites]
   filename = sites.csv
   max_matches = 1
   ```
3. Reload (`| extract reload=t` from search head, or
   `splunk reload deploy-server` in distributed
   deployments).

## 2. SPL recipe

```spl
| inputlookup sites.csv
| rename site_id AS id
| where isnotnull(lat) AND isnotnull(lon)
| fields id, lat, lon, site_name, site_category
| sort + site_name
```

Why this exact shape:

- **`| inputlookup sites.csv`** — direct CSV read. No time
  predicate (CSV reads are time-independent — the lookup is
  the source of truth, not an event index). No `stats` —
  every row IS a point. This is the simplest possible Splunk
  search shape, intentionally so: the markers recipe is the
  ENTRY POINT for users with CSV data who want to put it on
  a map.
- **`| rename site_id AS id`** — adopt Better Map's canonical
  `id` alias up front, matching every other recipe in the
  matrix. The `id` field drives per-marker drilldown on
  click.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — defensive
  filter for CSVs that include un-geocoded rows (sites
  pending opening, in-transit locations, virtual / remote-
  only sites). Surface those in a companion table panel for
  the site-ops team to backfill.
- **`| fields id, lat, lon, site_name, site_category`** —
  explicit projection. CSV lookups often carry many columns
  (opening date, manager, square footage, regional VP,
  cost centre); for the map panel we only need the five
  documented in the field contract. Other columns flow
  through as raw lookup data but won't render unless
  explicitly added to the field list.
- **`| sort + site_name`** — alphabetical for stable
  rendering. The markers layer's z-order (which marker
  renders "on top" when two are at nearly the same lat/lon)
  is stable across re-renders because the row order is
  stable. This matters when an operator screenshots the
  panel for a report — the same SPL on the same day
  produces the same image.
- **No `| head`.** Unlike the supercluster sibling (which
  caps at 10000 for safety) and the heatmap recipes (which
  cap at 5000 to bound rendering), the markers recipe
  intentionally has no cap because the workflow REQUIRES
  small datasets. If your CSV has > 200 rows, switch to
  the supercluster sibling rather than capping here — a
  capped markers panel is a misleading panel. A future
  trip wire could add `| head 500 | eval cap_hit=if(...)
  ...` to surface a warning, but for v1.7 the recipe
  documents the constraint in §6 Gotchas and trusts the
  operator.

If your CSV already has the canonical column names `id`,
`lat`, `lon`, the recipe collapses to one or two lines:

```spl
| inputlookup sites.csv
| where isnotnull(lat) AND isnotnull(lon)
```

## 3. Expected fields

| field         | type   | example              |
|---------------|--------|----------------------|
| id            | string | STORE-0042           |
| lat           | number | 33.7490              |
| lon           | number | -84.3880             |
| site_name     | string | Atlanta Downtown #42 |
| site_category | string | retail               |

All five fields appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `site_name` and
`site_category` are carried for the per-marker popup but are
not strictly required by the markers layer (auto-detect
would pick `site_name` as the popup title if `id` were
absent).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "markers",
  "idField": "id"
}
```

Why this minimal config:

- **`pointRenderer: "markers"`** — explicit pin to the
  markers renderer. The default `pointRenderer: "auto"`
  would switch to `cluster` at 200+ features and
  `heatmap` at 10000+ features (per
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)
  — same enum description applies). For small CSVs that
  STAY small (the markers use case), pinning is harmless;
  for CSVs that GROW past 200 rows over time, the explicit
  pin will cause progressive visual degradation as
  overlapping markers pile up — the operational tripwire
  to switch to the supercluster sibling.
- **`idField: "id"`** — explicit override. Auto-detect would
  already pick `id` (Better Map's `dataFitness.js` field
  aliasing recognises the canonical name), but pinning
  makes the drilldown URL stable across formatter-version
  upgrades. Worth the one extra line.
- **`site_name` and `site_category` flow through
  automatically** as feature properties on each rendered
  marker — popups can reference them by name without
  further formatter config (`enablePopups: true` is the
  default per [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).
- **No `markerColor` set** — the default
  marker palette (`#1f77b4` Tableau blue per
  [`src/lib/palettes.js`](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/palettes.js))
  is a reasonable starting point for "neutral inventory
  view" panels. Set `markerColor` to a brand colour or to
  a per-row colour via `categoryField: "site_category"` +
  `palette: "set3"` if you want category-coloured markers
  (e.g. retail / wholesale / office in distinct hues).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce the panel by
dropping a hand-authored `sites.csv` (5-20 rows is enough
to demonstrate the markers behaviour) into
`<app>/lookups/`, adding the `[sites]` transforms.conf
stanza, pasting the SPL above into a Dashboard Studio map
panel with Better Map as the visualization, applying the
formatter JSON in §4, and confirming each marker is
individually clickable with a popup showing site_name and
site_category._

## 6. Gotchas

- **Markers vs supercluster vs heatmap — when to choose
  which.** Three CSV-lookup-geo layers, three answers:

  | Layer | Best for | Switch when |
  |---|---|---|
  | `markers` (this recipe) | ≤ 200 discrete points needing per-point click affordance | Rows grow past ~200 → switch to `supercluster` |
  | `supercluster` (see [csv-lookup-geo/supercluster](./supercluster.md)) | 200-250k points with per-point identity preserved (cluster expands on click) | Rows grow past ~250k OR you want continuous density signal → switch to `heat` (via the [kvstore-latlon/heat](../kvstore-latlon/heat.md) pattern adapted to CSV) |
  | `heatmap` | "Show me density landscape" with no per-point identity needed | (csv-lookup-geo + heat not yet shipped — adapt the kvstore-latlon/heat pattern) |

  All four CSV-lookup-geo recipes (markers, supercluster,
  polygons, vector-tile-join) coexist in the same dashboard
  via Better Map's BM-CT-1 layer contract
  (`setEnabled` / `isEnabled` / `reset`) toggled from
  dashboard inputs.

- **CSV file-size ceiling.** Same Splunk default
  `[lookup] max_memtable_bytes = 25000000` (25 MB) as the
  supercluster recipe. For the markers use case (≤ 200
  rows) this is irrelevant — you are 4+ orders of magnitude
  under the ceiling. Documenting for completeness.
- **`| inputlookup` vs KV-Store performance.** For ≤ 200
  rows, both are sub-100ms. The choice is operational, not
  performance: git-friendly + version-controlled +
  AppInspect-clean → CSV; live-editable from the Splunk UI
  + REST API + role-based per-row authorisation → KV-Store.
  See [polygons.md §6](./polygons.md#6-gotchas) for the
  full choice rubric.
- **`auto` renderer switching at 200 features.** The
  formatter's `pointRenderer: "auto"` enum description in
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)
  documents the 200-feature → cluster switch. If your CSV
  grows past 200 rows AND you have not pinned
  `pointRenderer: "markers"`, the panel will silently
  switch from markers to cluster — visually disorienting if
  the user expects to see individual markers. The
  recommended formatter config above pins to `markers`
  precisely because silent renderer switching is the
  number-one source of "my map looks different today"
  Slack messages. Set the pin OR accept the auto-switch
  deliberately.
- **No popup deduplication.** Two CSV rows at the exact
  same lat/lon (a building with two tenants, two services
  at the same address) render as overlapping markers. The
  markers layer does NOT auto-collapse them. The supercluster
  layer does (cluster icon shows "2" at that point). If
  your CSV has known co-located rows, either jitter the
  lat/lon slightly (`| eval lat = lat + (random() % 100 -
  50) / 1000000`) for visual separation, or switch to the
  supercluster sibling for proper handling. Random jitter
  is fine for visual-only panels but DO NOT use it on a
  panel where the lat/lon will be exported / drilled-into
  / used to compute distances.
- **CSV reload latency.** Splunk caches lookups in memory
  per search head. After editing the CSV on disk the panel
  may show stale data until the lookup table refreshes —
  force a refresh with `| extract reload=t` in any panel or
  search, or wait for the lookup-table refresh interval
  (5 min default). On Splunk Cloud with distributed search
  heads, lookup propagation can take longer; favour
  KV-Store for hot-edit workflows.
- **Lat/lon validation.** The recipe filters
  `isnotnull(lat) AND isnotnull(lon)` but does NOT validate
  the values are sensible. A typo'd row with `lat=370.7490`
  (extra digit) renders off the map and survives the
  filter. Add `| where lat BETWEEN -90 AND 90 AND lon
  BETWEEN -180 AND 180` as a defensive filter if your CSV
  is human-edited rather than CMDB-exported. The supercluster
  recipe doesn't carry this filter either — the bullet is
  here because the markers recipe's smaller dataset makes
  individual-row errors more impactful (one bad row =
  noticeable empty zone vs. one bad row buried in 10k
  cluster expansions).
- **No OT safety dependency.** This is a pure site /
  inventory layer. If `sites.csv` ALSO contains entries
  for SIS-related sites (Level-0/1/2 in the Purdue model
  — e.g. control rooms, instrument racks, SIL-rated logic
  solvers), follow
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 5 — segregate those into a dedicated layer
  with `ot_safety_relevant: true` and a hand-curated popup
  that says "READ ONLY — SIS site, no action permitted
  from this panel." Better Map MUST NOT be the surface
  that takes action against an SIS site (Rule 4 — never
  push configuration to PLCs/HMIs/DCS/RTUs/SIS).
  Per Rule 5, the SIS site list is a read-only mirror of
  the customer-owned Safety Requirements Specification,
  NOT a Better-Map-authored asset list.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound (this is the simplest possible Splunk
search shape, intentionally so), follows the documented
CSV-lookup contract, and only references Splunk built-ins
(`inputlookup`, `rename`, `where`, `fields`, `sort`). The
formatter options (`pointRenderer`, `idField`) are both
present in `docs/_machine/formatter-schema.json` and cross-
checked by `scripts/check-formatter-coverage.py`. The recipe
has not been dispatched against a real `sites.csv` lookup in
the v1.7-prep development cycle (the lab tenant does not
have a populated sites CSV — see the supercluster recipe's
verification status for the same caveat). A maintainer with
write access to a Splunk dev tenant should:

1. Drop a hand-authored CSV with the documented schema
   (5-20 rows is sufficient — e.g. five major US cities
   with `lat`/`lon` from any reference) into
   `<app>/lookups/sites.csv` and add a matching `[sites]`
   stanza in `transforms.conf`.
2. Run the panel SPL and confirm each row returns with the
   five documented fields.
3. Apply the formatter JSON in §4 to a Dashboard Studio map
   panel; confirm each marker is individually visible at
   continent zoom and clickable with a popup showing
   `site_name` + `site_category`.
4. Grow the CSV past 200 rows and confirm the formatter's
   `auto`-switch trip wire (toggle `pointRenderer` to
   `"auto"` to observe the switch to cluster); switch back
   to `"markers"` to observe the visual degradation that
   motivates the supercluster sibling.
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 10.0 against
   a 12-row hand-authored sites CSV"), and submit a
   follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change
   without touching the schema.
