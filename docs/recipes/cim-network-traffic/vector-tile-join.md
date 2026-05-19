---
schema_version: 1
id: cim-network-traffic--vector-tile-join
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic (data model)"
  pattern: splunk-cim
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-24"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
  - id: "builtin:iplocation"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "USA"
    drives_formatter_option: idField
  - name: country_name
    type: string
    example: "United States"
  - name: value
    type: integer
    example: "8472913"
  - name: event_count
    type: integer
    example: "8472913"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, choropleth layer (bundled us-states preset, US-only)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Companion recipe — same source, extrusion-3d layer (height-encoded sibling)"
    path: "docs/recipes/cim-network-traffic/extrusion-3d.md"
  - description: "Companion recipes — same source, markers / heat / h3 / supercluster / paths layers"
    path: "docs/recipes/cim-network-traffic/markers.md"
  - description: "Pattern reference — vector-tile-join with KV Store metric source (sibling pattern, lookup-side)"
    path: "docs/recipes/kvstore-latlon/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with CSV lookup metric source (sibling pattern, lookup-side)"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "CIM Network Traffic data model reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Network Traffic — vector-tile join (customer PMTiles)

Render per-country network traffic volume by joining
**CIM-Network-Traffic events** (geocoded to country via Splunk's
built-in `iplocation`) against a **customer-hosted world-countries
PMTiles vector tileset**. The **third source** to demonstrate
the vector-tile-join layer, joining the existing
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
and [kvstore-latlon/vector-tile-join](../kvstore-latlon/vector-tile-join.md)
companions — and the **FIRST event-source vector-tile-join recipe**
(both existing companions are lookup-source: metric rows already
pre-aggregated and stored in CSV/KV Store before the panel runs).

This recipe demonstrates the **on-the-fly aggregation** pattern:
the panel queries the CIM Network Traffic data model directly,
geocodes events as they arrive, aggregates per-country, and feeds
the result to the same `featureJoin` layer that the two
companions use. No lookup table to maintain, no scheduled saved
search to keep fresh — the panel is self-contained.

The CIM Network Traffic source row now has **8 layer cells**
(markers, heat, h3, supercluster, paths, choropleth,
extrusion-3d, plus vector-tile-join now) — the joint-most-covered
source row in the recipe matrix alongside meraki (8 cells). The
vector-tile-join layer column moves from 2 cells to 3, exiting
its previous "singleton-trap exit" status from wave 30 with a
second non-lookup-source to demonstrate the layer's full breadth.

## 1. Source description

Same **CIM Network Traffic** data model as the markers / heat /
h3 / supercluster / paths / choropleth / extrusion-3d
companions — see
[cim-network-traffic/markers §1](./markers.md#1-source-description)
for the data model background and the `tag=network,communicate`
contract. The relevant distinction for THIS recipe: the panel
renders per-COUNTRY (not per-state) event aggregation against a
**customer-hosted world-countries PMTiles tileset**, not the
bundled `us-states` preset that the
[choropleth](./choropleth.md) and
[extrusion-3d](./extrusion-3d.md) companions use.

**Why vector-tile-join (customer PMTiles) for CIM Network
Traffic.** The bundled `us-states.pmtiles` covers only the 50
US states + DC. For a global tenant whose ingress / egress spans
multiple continents — a multinational with EMEA / APAC / AMER
offices, a SaaS vendor with global users, a CDN-fronted retail
property, a managed-services provider with multi-tenant
customers — the panel must shade COUNTRIES, not US states.
Better Map's `featureJoin` layer is geometry-agnostic at the
layer level — any PMTiles tileset with a `source-layer` name
and a per-feature `promoteId` property works — but the bundled
presets only cover US-jurisdiction polygons. Shipping a custom
`world-countries.pmtiles` tileset (≈ 5-15 MB, public-domain
from Natural Earth via [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets))
unlocks global per-country rendering.

The 5-minute "executive briefing — where is our network traffic
coming from globally" answer reads off this panel from across
the boardroom; the NetOps team uses the same panel to justify
regional PoP placement in continents currently un-shaded; the
compliance team uses it for GDPR / CCPA per-jurisdiction traffic
attribution.

**Typical sourcetype / index:** any sourcetype tagged
`network,communicate` in your CIM tag config — `cisco:asa`,
`pan:traffic`, `aws:cloudwatchlogs:vpcflow`,
`azure:nsg:flow`, `gcp:vpc:flow`, `cisco:meraki:flow`,
`netflow` (after the
[Splunk Add-on for NetFlow](https://splunkbase.splunk.com/app/2989)
is installed), `stream:tcp` (after Splunk Stream is configured).
See the
[choropleth companion §1](./choropleth.md#1-source-description)
for the broader catalogue.

**No add-on required beyond Splunk_SA_CIM** for the data model
and Splunk's built-in `iplocation` for geocoding. The PMTiles
file is customer-hosted (on the Splunk app's own
`appserver/static/` folder for air-gapped tenants, or on a
customer CDN for non-air-gapped). No external API calls. Fully
air-gap compatible per ROADMAP §1a when the PMTiles file is
bundled into the app.

## 2. SPL recipe

```spl
tag=network tag=communicate earliest=-24h latest=now
| iplocation src
| where isnotnull(Country) AND Country != ""
| stats count AS event_count BY Country
| lookup iso_country_codes country_name AS Country OUTPUT iso_a3 AS id
| where isnotnull(id) AND id != ""
| eval value=event_count
| rename Country AS country_name
| fields id, country_name, value, event_count
| sort - value
```

What the pipeline does, stage by stage:

- **`tag=network tag=communicate earliest=-24h latest=now`** —
  base search against the CIM-tagged network-traffic events.
  `tag=network tag=communicate` is the contract that selects
  every event the CIM Network Traffic data model has been told
  about (regardless of vendor — same as the markers / heat /
  h3 / supercluster / paths / choropleth / extrusion-3d
  companions). `earliest=-24h` is the typical operational
  window; widen to `-7d` for a weekly trend panel or narrow
  to `-15m` for a real-time NOC panel.
- **`| iplocation src`** — Splunk's built-in MaxMind GeoLite2
  geocoder. No outbound network call. Populates `Country`
  (e.g., "United States", "Germany", "Japan") for any `src`
  that's a public IP. Internal-IP sources resolve to null
  `Country` and are filtered out by the next stage. Substitute
  `iplocation dest` if your panel question is "traffic to
  which country" rather than "traffic from which country".
- **`| where isnotnull(Country) AND Country != ""`** — drops
  internal-IP rows so they don't pile up under a synthetic
  "unknown country" bucket. (Failure to filter is the #1
  reason an early-iteration vector-tile-join panel renders a
  single shaded country labelled "Local" — the unknown bucket
  joined against nothing and got absorbed by the unmatched-
  grey fallback fill silently.)
- **`| stats count AS event_count BY Country`** — first
  aggregation pass: per-country event volume.
- **`| lookup iso_country_codes country_name AS Country OUTPUT
  iso_a3 AS id`** — maps the MaxMind country NAME ("United
  States", "Germany", "Japan") to the ISO 3166-1 alpha-3
  CODE ("USA", "DEU", "JPN") that the world-countries
  PMTiles tileset uses as its `promoteId` join key. The
  `iso_country_codes` lookup is NOT a Splunk built-in — see
  the "lookup setup" callout in §6 Gotchas for the one-time
  CSV bootstrap (it's a 250-row table the customer probably
  already maintains, or can be reproduced from
  [Natural Earth's countries dataset](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/)).
  If your tileset's `promoteId` is ISO-3166-1 alpha-2 (`iso_a2`,
  "US" / "DE" / "JP") use `OUTPUT iso_a2 AS id` instead.
- **`| where isnotnull(id) AND id != ""`** — drop countries
  that didn't resolve in the lookup (typically obscure
  islands or disputed territories whose MaxMind name doesn't
  match a Natural Earth entry exactly). Without this guard,
  those rows render with the unmatched-grey fallback fill,
  which can be visually confusing for an "every column shaded"
  expectation.
- **`| eval value=alert_count`** — alias the event count to
  Better Map's canonical `value` field name. `value` is what
  the `enableChoropleth` rendering reads to compute the
  per-polygon colour ramp.
- **`| sort - value`** — most-traffic-bearing countries first
  (matters for the companion "Top 10 countries by event volume"
  table panel; the choropleth renderer itself is row-order-
  agnostic).

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field        | type    | example       |
|--------------|---------|---------------|
| id           | string  | USA           |
| country_name | string  | United States |
| value        | integer | 8472913       |
| event_count  | integer | 8472913       |

Four fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the choropleth shading; `country_name` and
`event_count` flow through as feature properties on the joined
polygon for popups.

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
and
[kvstore-latlon/vector-tile-join](../kvstore-latlon/vector-tile-join.md#4-recommended-formatter-config)
companions — the metric row source is interchangeable, the
PMTiles join contract is not):

- **`featureJoinUrl`** — the customer-hosted PMTiles URL.
  Better Map uses PMTiles' HTTP Range fetcher to retrieve only
  the visible tiles. Use `pmtiles://` for self-hosted MapLibre
  PMTiles servers; use the raw `https://` URL for direct CDN
  serving. For air-gapped tenants, copy the `.pmtiles` file
  into `better_map/appserver/static/visualizations/better_map/presets/`
  and use `featureJoinPreset: "<your-preset-name>"` instead.
  The public-domain Natural Earth
  [world-countries tileset from protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
  is the standard starting point — ~5 MB at 1:110M scale,
  ~15 MB at 1:50M.
- **`featureJoinPromoteId: "iso_a3"`** — the property name on
  each tileset feature whose value matches the `id` field in
  the SPL row set. For Natural Earth / OpenStreetMap-derived
  country tilesets, `iso_a3` is the canonical ISO 3166-1
  alpha-3 code property. Use `pmtiles show <file>.pmtiles`
  to list available properties on the first feature; some
  tilesets use `iso_a2` (2-letter), `name`, or `name_en`
  instead.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. Inspect with `pmtiles tile
  <file>.pmtiles 0 0 0 | jq '.layers | keys'` to list them.
  For most world-countries tilesets the source-layer name
  matches the conceptual category (`countries`, `world`,
  `nations`).
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" (default for joined tilesets) to
  "value-shaded fill". The SPL MUST produce a `value` field
  for shading; rows with no `value` render with the
  unmatched-grey fallback fill.
- **`palette: "viridis"`** — perceptually uniform single-
  direction palette. Same default as the
  [cim-network-traffic/choropleth companion](./choropleth.md#4-recommended-formatter-config).
  For diverging data (e.g., "this week's traffic vs the
  30-day baseline, positive or negative") switch to `rdbu`
  and set a midpoint via `colorScaleMid`. For a SECURITY-
  framed view (e.g., panel restricted to
  `tag=network,communicate AND tag=ids,attack`) switch to
  `magma` (warm-colour-equates-with-danger semantics) to
  match the
  [cim-alerts/choropleth companion](../cim-alerts/choropleth.md#4-recommended-formatter-config).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). Until
then, reproduce by (a) staging a small PMTiles file (the public-
domain Natural Earth countries tileset from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
is the canonical starting point), (b) populating an
`iso_country_codes` CSV lookup with the 250-row name → alpha-3
mapping (or installing the
[Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
add-on which ships its own equivalent), (c) pasting the §2 SPL
into a Dashboard Studio map panel with Better Map as the
visualization and applying the §4 formatter JSON. The choropleth
should shade the US, China, Germany, the UK, and other major-
traffic-source countries darker than low-traffic regions._

## 6. Gotchas

- **`iso_country_codes` lookup is REQUIRED but NOT bundled.**
  This recipe assumes a CSV lookup named `iso_country_codes`
  with at least two columns: `country_name` (matching MaxMind /
  Splunk's `iplocation` output) and `iso_a3` (matching the
  PMTiles `promoteId`). The lookup is small (~250 rows) and
  changes rarely — one-time bootstrap from
  [Natural Earth's countries dataset](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/)
  via:

  ```spl
  | makeresults
  | eval country_name="United States", iso_a3="USA", iso_a2="US"
  | append [
    | makeresults
    | eval country_name="Germany", iso_a3="DEU", iso_a2="DE"]
  | append [
    | makeresults
    | eval country_name="Japan", iso_a3="JPN", iso_a2="JP"]
  | fields - _time
  | outputlookup iso_country_codes.csv
  ```

  (Expand to all 250 countries from the Natural Earth source.)
  Alternatively, install the
  [Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
  add-on which ships its own equivalent lookup with broader
  coverage (UN/LOCODE country codes, sub-region codes, etc.).
  Without the lookup, the §2 SPL returns zero `id` values and
  the panel renders the unmatched-grey fallback fill globally.

- **MaxMind name ≠ Natural Earth name for ~20 countries.** The
  MaxMind GeoLite2 country name and the Natural Earth /
  ISO-3166-1 official short name disagree for a handful of
  countries — common cases include "United States" vs "United
  States of America", "Russia" vs "Russian Federation",
  "South Korea" vs "Korea, Republic of", "Vietnam" vs
  "Viet Nam". Decide on a canonical name and align both sides:
  either rename MaxMind output (`| eval Country=case(Country=="United
  States","United States of America",...)`) OR populate the
  lookup with MaxMind's variant names. Without alignment those
  countries fall out at the `where isnotnull(id)` guard and
  render with the fallback fill.

- **The remaining PMTiles + customer-hosted CDN gotchas are
  identical to the
  [csv-lookup-geo/vector-tile-join companion](../csv-lookup-geo/vector-tile-join.md#6-gotchas).**
  Specifically: HTTP Range request support (the
  `curl -I -H "Range: bytes=0-1023" <url>` test must return
  `206 Partial Content`); Splunk Cloud CSP `connect-src
  'self'` blocks cross-origin fetches (host the PMTiles on
  the same origin via the app's `appserver/static/` folder
  for air-gap-safe operation, OR get the CDN host CSP-allowed,
  OR use `featureJoinPreset` after bundling the tileset);
  `featureJoinPromoteId` case-sensitivity; empty-id rows
  silently dropped; unmatched-grey fallback semantics;
  `featureJoinPreset` air-gap alternative. Read the CSV
  companion's §6 once; the contract is fully shared.

- **Event-source aggregation cost vs lookup-source.** This
  recipe runs a full per-event scan + geocode + per-country
  aggregation on EVERY panel refresh, where the
  [csv-lookup-geo](../csv-lookup-geo/vector-tile-join.md) and
  [kvstore-latlon](../kvstore-latlon/vector-tile-join.md)
  companions just read pre-aggregated rows from a lookup /
  collection (microseconds). For a high-event-volume tenant
  (10M+ events / 24h tagged `network,communicate`) the panel
  refresh can take 5-30 seconds, which is too slow for an
  always-on NOC dashboard. The right pattern: schedule a
  saved-search that runs the per-country aggregation every
  15 minutes via `| outputlookup country_traffic_summary.csv`,
  then point the panel at the summary lookup (effectively
  becoming a [csv-lookup-geo](../csv-lookup-geo/vector-tile-join.md)
  variant). For ad-hoc / executive-briefing / weekly-review
  panels where 10-30s first-render latency is acceptable,
  the on-the-fly aggregation in this recipe is the more
  honest default — it always reflects the most recent data.

- **`iplocation` accuracy at country level.** Splunk's bundled
  MaxMind GeoLite2 database resolves public IPs to country
  with ~99% accuracy (city-level ~80%). The few outliers are
  typically VPN exits and hosting providers whose registered
  country differs from where the IP physically lives —
  acceptable noise for a per-country choropleth (since the
  hosting-provider IPs are still IN a country, just not the
  country the end user is in). For a "true end-user
  geographic origin" view, layer an Anonymizer / VPN-exit
  enrichment (e.g., the
  [MaxMind GeoIP2 Anonymous IP](https://www.maxmind.com/en/geoip2-anonymous-ip-database)
  database, available via
  [Splunk_TA_iplocation_premium](https://splunkbase.splunk.com/app/4836))
  to filter known anonymisation traffic out of the panel.

- **MAUP — country area amplifies large-country bias.** Same
  caveat as the
  [cim-network-traffic/choropleth companion §6](./choropleth.md#6-gotchas)
  at the state level, but worse at the country level: Russia
  is geographically the largest country, but its actual
  internet-traffic share is dwarfed by smaller countries with
  more users (Singapore, Netherlands, South Korea). A large
  shaded country in the choropleth always reads as "high
  traffic" even if the per-capita / per-density traffic is
  low. Document this caveat in the dashboard's surrounding
  markdown, OR shift to the
  [cim-network-traffic/h3 companion](./h3.md) with
  `hexbinResolution: 2-3` for area-neutral aggregation at
  continental scales.

- **No OT-safety dependency.** Same posture as the
  [choropleth companion §6](./choropleth.md#6-gotchas) and the
  [extrusion-3d companion §6](./extrusion-3d.md#6-gotchas):
  CIM Network Traffic events are IT-network events (firewalls,
  proxies, switches, IPS). No OT carve-out applies. The
  customer-hosted PMTiles file is a static polygon dataset
  with no operational dependency.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`iplocation`, `stats`,
`lookup`, `eval`, `where`, `rename`, `fields`, `sort`). The
PMTiles fetch + join behaviour is covered by Better Map's own
`featureJoin` module unit tests, but the end-to-end "this
recipe's CIM Network Traffic SPL + a real customer PMTiles
tileset + the iso_country_codes lookup renders a per-country
choropleth in a Splunk Dashboard Studio panel" path has not
been dispatched against the v1.7-prep lab tenant in this PR
because (a) non-interactive admin auth is not present in the
agent workspace, (b) the lab tenant does not carry an
`iso_country_codes` lookup populated to the full 250 countries,
and (c) the lab tenant does not carry a registered world-
countries PMTiles URL. A maintainer with REST auth and a
small custom PMTiles file should follow the verification
steps in the
[csv-lookup-geo/vector-tile-join companion](../csv-lookup-geo/vector-tile-join.md#verification-status)
(substituting the §2 event-source SPL for the lookup-source
SPL).
