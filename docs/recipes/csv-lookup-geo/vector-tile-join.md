---
schema_version: 1
id: csv-lookup-geo--vector-tile-join
source:
  id: csv-lookup-geo
  display_name: "CSV lookup (region metrics)"
  pattern: splunk-lookup
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-18"
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
  - description: "Splunk lookups skill — CSV lookup configuration"
    path: "~/.cursor/skills/splunk-lookups/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
  - description: "Bundled choropleth sibling (`featureJoinPreset` instead of `featureJoinUrl`)"
    path: "docs/recipes/geo-us-states/choropleth.md"
---

# CSV lookup (region metrics) — vector-tile join (customer PMTiles)

Render a per-region value (sales, incidents, SLO compliance, network
health) by joining a customer-owned CSV of metric values against a
**customer-hosted PMTiles vector tileset** that defines the region
polygons. This is the "bring your own boundary" recipe — used when
the bundled `us-states` / `countries` / `admin1` presets don't match
your jurisdiction (e.g., FAA TRACON sectors, retail catchment areas,
service-territory polygons, electoral districts at a sub-national
level, custom asset-zone footprints).

Zero Splunk add-ons required. The polygon geometry lives entirely on
a customer-hosted CDN (or on the Splunk app's own `appserver/static/`
folder for air-gapped tenants). No external API calls.

## 1. Source description

A **PMTiles** file (`.pmtiles`) is a single-file, range-request-
friendly vector-tile container — the modern replacement for tile-
folder hierarchies and remote tile servers. It packs every zoom
level of a vector tileset into one file that Better Map can fetch
with HTTP Range headers, eliminating the need for a tile-server
process. PMTiles ship as static assets under the Splunk app or on
any CDN that supports Range requests (CloudFront, Fastly, S3 with
Range enabled, GitHub Pages, the customer's own NGINX).

The recipe's contract:

- **Customer owns the tileset.** The recipe assumes you have a
  PMTiles file accessible at a known URL. Authoring PMTiles is
  outside this recipe's scope; tools like
  [`tippecanoe`](https://github.com/felt/tippecanoe) (Mapbox /
  Felt's GeoJSON-to-tileset compiler) and
  [`pmtiles-cli`](https://github.com/protomaps/go-pmtiles) cover
  authoring + inspection.
- **The tileset declares a `source-layer` name.** Vector tilesets
  group features into named source-layers (the `tileset.json`
  equivalent). The recipe needs the source-layer name to know which
  layer to join against (a tileset can carry multiple — e.g., one
  with TRACON sectors and one with airport runways).
- **The tileset features carry a `promoteId` property.** This is
  the per-feature property whose value matches the `id` field in
  the SPL row set. PMTiles compiled with `tippecanoe -aI` promote
  the `id` GeoJSON property automatically; bespoke tilesets can
  declare any property name (`iso_a3`, `tracon_code`, `district_id`,
  etc.).

The recipe binds to a lookup named `region_metrics.csv` (rename to
match your install) with the columns `country_code`, `country_name`,
`value`. The CSV is the SMALL dataset (one row per region, often
< 300 rows); the BIG dataset is the PMTiles file, which is loaded
once by the browser and cached.

**Typical sourcetype / index:** none — `| inputlookup` runs against
the CSV directly, no event ingestion involved. (Production
dashboards often `| stats sum(value) BY country_code` over real
events and feed THAT into the join — see §6 Gotchas for the
"summary-search join" pattern.)

**One-time setup** (skip if your lookup already exists):

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
| outputlookup region_metrics.csv
```

(The one-time setup is the only place `| makeresults` is allowed in
this recipe — it is bootstrap data, not panel data. Per ROADMAP §1a
and the Splunk SPL anti-pattern rules, `| makeresults` is BANNED
in panel SPL because it bypasses time-range filtering and can't be
distributed.)

After the `| outputlookup`, register the lookup in
`transforms.conf` (already done if you use the Splunk Web lookup
UI). See the [Splunk lookups
skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-lookups/SKILL.md)
for the full transforms.conf stanza pattern.

## 2. SPL recipe

```spl
| inputlookup region_metrics.csv
| rename country_code AS id
| fields id, country_name, value
| sort - value
```

What the pipeline does, stage by stage:

- **`| inputlookup region_metrics.csv`** — pulls every row of the
  CSV into the search pipeline. CSV lookups are cached in memory
  on the search head; this is a sub-millisecond operation for
  < 10k rows.
- **`| rename country_code AS id`** — Better Map's `featureJoin`
  layer hardcodes `idProperty: 'id'` as the per-row join key.
  Renaming `country_code` to `id` aligns with that contract.
- **`| fields id, country_name, value`** — trim to the three fields
  the panel actually consumes. `country_name` flows through as a
  feature property for popups; `value` drives the choropleth shade.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type   | example     |
|---------------|--------|-------------|
| id            | string | NLD         |
| country_name  | string | Netherlands |
| value         | number | 847.3       |

The polygon geometry itself is NOT a field — Better Map fetches it
internally from the PMTiles URL configured in §4.

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

Why these settings:

- **`featureJoinUrl`** — the customer-hosted PMTiles URL. Better
  Map's `featureJoin` module uses [PMTiles' HTTP Range fetcher](https://docs.protomaps.com/pmtiles/) to
  retrieve only the visible tiles, not the whole file. Use
  `pmtiles://` for self-hosted MapLibre PMTiles servers; use the
  raw `https://` URL for direct CDN serving (the more common path).
  For air-gapped tenants, copy the `.pmtiles` file into
  `better_map/appserver/static/visualizations/better_map/presets/`
  and reference it as `featureJoinUrl: ""` + `featureJoinPreset:
  "<your-preset-name>"` — same as the bundled `us-states` preset,
  but with your own tileset registered into the preset list.
- **`featureJoinPromoteId: "iso_a3"`** — the property name on each
  tileset feature whose value matches the `id` field in the SPL row
  set. For Natural Earth / OpenStreetMap-derived country tilesets,
  `iso_a3` is the canonical ISO 3166-1 alpha-3 code property. For
  the bundled `us-states.pmtiles` it is `stusps` (USPS two-letter);
  for the bundled `countries.pmtiles` it is `iso_a3`. For custom
  tilesets, inspect with `pmtiles show <file>.pmtiles` to see the
  available properties on the first feature.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. A PMTiles file can contain multiple
  source-layers (e.g., one for countries + one for admin-1 regions
  + one for cities). Inspect with `pmtiles tile <file>.pmtiles
  0 0 0 | jq '.layers | keys'` to list them. For most tilesets the
  source-layer name matches the conceptual category
  (`countries`, `states`, `tracon`, `districts`).
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" (default for joined tilesets) to
  "value-shaded fill". The SPL MUST produce a `value` field for
  the shading to engage; rows with no `value` render with the
  unmatched-grey fallback fill.
- **`palette: "viridis"`** — perceptually uniform single-direction
  palette. For diverging data (e.g., SLO compliance ± target) use
  `rdbu` (red-blue diverging) and set a midpoint via
  `colorScaleMid`.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). Until then, a maintainer can reproduce the panel by pasting the
SPL above into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4, after staging
a small PMTiles file (the Natural Earth countries tileset from
<https://github.com/protomaps/basemaps-assets> is a public-domain
starting point)._

## 6. Gotchas

- **PMTiles host MUST support HTTP Range requests.** Better Map's
  `featureJoin` module relies on Range to fetch only visible tiles
  (typically a few KB each) rather than the entire `.pmtiles` file
  (tens of MB for a world tileset). Most modern CDNs support this
  by default — CloudFront, Fastly, S3 with Range Bytes enabled,
  Netlify, GitHub Pages, Cloudflare R2 — but some legacy CDNs and
  many corporate file servers do not. Test before deploying:
  `curl -I -H "Range: bytes=0-1023" <url>` should return
  `HTTP/1.1 206 Partial Content`. If it returns `200 OK` with the
  full file, the tileset will still load but with a multi-MB
  initial fetch that visibly slows panel render.
- **Splunk Cloud CSP `connect-src 'self'` blocks cross-origin
  fetches.** Per ROADMAP §1a, customers cannot relax CSP. Either
  (a) host the PMTiles file on the same origin as the Splunk Web UI
  (typically via a Splunk app's `appserver/static/` folder, served
  at `/static/app/<app>/`); or (b) ask the Splunk Cloud admin to
  add the CDN host to the `connect-src` allow-list (a per-tenant
  request); or (c) ship the PMTiles inside the Better Map app's
  `presets/` folder and reference it via `featureJoinPreset` rather
  than `featureJoinUrl`. Option (c) is the air-gap-safe default.
- **`featureJoinPromoteId` is case-sensitive AND
  property-name-specific.** A common debug scenario: SPL emits
  `id="USA"` (uppercase, 3-letter), tileset has `name="United States"`
  + `iso_a3="USA"`. Setting `featureJoinPromoteId: "name"` will join
  nothing (because no SPL row has `id="United States"`). Setting it
  to `"iso_a3"` works. Use `pmtiles show <file>` to dump the
  per-feature properties of a sample tile to find the correct one.
- **Empty `id` rows are silently dropped.** A row from the CSV with
  `id=""` won't trigger an error; it just won't join any polygon.
  Add `| where isnotnull(id) AND id != ""` to the SPL if you're
  debugging "why are these rows missing from the map".
- **Unmatched-grey is the default for rows-without-polygons.** If
  your SPL has rows whose `id` doesn't match any tileset feature,
  Better Map silently ignores them — they don't render anywhere.
  This is a feature (you can have a CSV with rows for regions
  outside the tileset's scope), but it can hide data errors. Add a
  diagnostic SPL run that joins `| inputlookup region_metrics.csv`
  against a server-side enumeration of valid tileset IDs (export
  with `pmtiles tile <file> 0 0 0 | jq -r '.layers.countries.features[].properties.iso_a3'`)
  to surface the orphans.
- **The pre-built `featureJoinPreset` values are the easy-mode
  alternative.** If your tileset is "world countries" or "US
  states" or "admin-1 world regions", use the bundled preset
  rather than ship a custom PMTiles file. The presets ship with
  the Better Map app, are AppInspect-clean, and require zero CSP
  configuration. Only reach for `featureJoinUrl` when the bundled
  options don't fit your geography.
- **vector-tile-join vs choropleth-with-preset is a tilesets
  axis, not a layer-type axis.** Both use the `featureJoin` layer
  source under the hood. The recipe distinction is whether the
  tileset is bundled (`featureJoinPreset`) or customer-supplied
  (`featureJoinUrl`). The polygon-rendering, choropleth fill
  semantics, MAUP caveats, and unmatched-grey fallback all
  behave identically.
- **No OT safety dependency.** This recipe ingests bootstrap
  CSV data and joins it to a polygon tileset. The CSV may carry
  data DERIVED from OT events (e.g., per-site equipment failure
  counts rolled up from Level-0/1/2 telemetry into a Level-3 or
  Level-4 summary), but the recipe itself never reads from a
  Level-0/1/2 source. The OT-safety boundary lives in the upstream
  pipeline that produces the CSV, not in this recipe.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`inputlookup`, `rename`,
`fields`, `sort`). The PMTiles fetch + join behaviour is covered
by Better Map's own `featureJoin` module unit tests, but the
end-to-end "this recipe's CSV + a real customer PMTiles renders a
choropleth in a Splunk Dashboard Studio panel" path has not been
dispatched against the v1.7-prep lab tenant in this PR because
(a) non-interactive admin auth is not present in the agent
workspace, and (b) the lab tenant does not carry a populated
`region_metrics.csv` or a registered PMTiles URL. A maintainer
with REST auth and a small custom PMTiles file should:

1. Stage a small PMTiles file (the Natural Earth countries tileset
   at <https://github.com/protomaps/basemaps-assets> is public-
   domain).
2. Populate `region_metrics.csv` with the bootstrap SPL in §1.
3. Add `featureJoinUrl` to a Dashboard Studio panel applying the
   formatter JSON in §4.
4. Confirm the choropleth renders (at least one country shaded).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
