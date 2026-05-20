---
schema_version: 1
id: meraki--vector-tile-join
source:
  id: meraki
  display_name: "Cisco Meraki (devices)"
  pattern: splunk-vendor-ta
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-27"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_cisco_meraki"
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
    example: "847"
  - name: device_count
    type: integer
    example: "847"
  - name: network_count
    type: integer
    example: "62"
  - name: online_count
    type: integer
    example: "812"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers / h3 / heat / supercluster layers"
    path: "docs/recipes/meraki/markers.md"
  - description: "Companion recipe — same source, extrusion-3d layer (height-encoded country aggregation)"
    path: "docs/recipes/meraki/extrusion-3d.md"
  - description: "Pattern reference — vector-tile-join on ThousandEyes (sibling vendor-TA + iplocation Country aggregation)"
    path: "docs/recipes/thousandeyes/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join on CIM Network Traffic (event-source iplocation sibling)"
    path: "docs/recipes/cim-network-traffic/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with CSV lookup metric source (lookup-source sibling)"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "cisco-meraki-ta-setup skill — TA install, indexes, account config, input types"
    path: "~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# Cisco Meraki (devices) — vector-tile join (world-countries PMTiles)

Aggregate the Meraki device fleet by **country** (via `iplocation
publicIp`) and render as a **flat-fill choropleth** over a
customer-hosted **world-countries PMTiles tileset**. The
**global-coverage executive view** for any multinational Meraki
operator: "in how many countries do we have Meraki sites, where
are our coverage gaps, where is the device-density highest?".

The **5th vector-tile-join recipe in the matrix** — joining
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
[thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md),
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md),
and [kvstore-latlon/vector-tile-join](../kvstore-latlon/vector-tile-join.md).
This advances the vector-tile-join layer column from 4 cells to 5,
and brings the meraki source row from 5 cells to 6 (markers, h3,
heat, supercluster, extrusion-3d, plus vector-tile-join now). The
recipe is the canonical "global Meraki footprint" panel for
sales-engineering RFPs and CIO regional-coverage reviews.

## 1. Source description

Same **Cisco Meraki Add-on for Splunk** (`Splunk_TA_cisco_meraki`,
Splunkbase ID 5580) source as all meraki companions — see
[meraki/markers §1](./markers.md#1-source-description) for the
TA install, modular-input catalogue, and the `meraki:devices`
sourcetype contract.

The relevant distinction for THIS recipe: instead of one marker
per device (markers companion) or one hex per regional density
bucket (h3 companion), the panel aggregates **per country** via
`iplocation publicIp` on each device's NAT egress IP. The
country-aggregated row set then joins against a customer-hosted
world-countries PMTiles tileset to render as a polygon
choropleth.

**Why `publicIp` rather than `lat`/`lng`.** Meraki devices DO
publish their dashboard-configured `lat`/`lng` (the
[markers companion](./markers.md) uses these for per-device
positioning), but Splunk has no bundled lat/lng → country
geometry lookup (`geo_us_states` is bundled for state-level US
work, but there is no bundled `geo_countries`). The MaxMind
GeoLite2 lookup that ships with Splunk Enterprise (the
`iplocation` command) is the zero-add-on path to country
attribution: every device's `publicIp` (the WAN egress IP of
the Meraki MX or upstream router) resolves to a Country string
("United States", "Germany", "Japan") in one SPL stage.

Two practical consequences of choosing `publicIp` as the geocoding
key:

1. **All devices behind one MX share its public IP**, so a 50-AP
   building with one MX gateway aggregates as "50 devices in
   <country-of-MX-egress>". This is the desired semantic for a
   "global Meraki footprint" panel — one site = one cluster of
   devices in one country.
2. **Roaming or cloud-NATed devices may show in the country of
   the cloud egress**, not the country of the physical install.
   For tenants where this matters (e.g., AWS Direct Connect
   tunnels routing all Meraki traffic through us-east-1), see
   §6 Gotchas for the asset-lookup substitution pattern that
   reads physical country from a Dashboard-mirrored CSV
   instead.

**Why vector-tile-join (world-countries) for Meraki.** Meraki is
a **global** SD-WAN / wireless / IoT platform — its native value
is fleet-of-fleets cloud-managed deployment across continents.
The [meraki/markers companion](./markers.md) answers "where is
every single device?" at building zoom; this recipe answers
"in how many countries do we have a Meraki footprint, and which
countries dominate?" at world zoom. Typical use cases:

- **Sales-engineering RFP visuals** — "Acme runs Meraki in 36
  countries across EMEA / APAC / LATAM".
- **CIO regional-coverage reviews** — "Where are our Meraki
  blind spots? Latin America is shaded grey, suggesting we
  haven't expanded our SD-WAN reach into the region yet".
- **Compliance jurisdictional views** — "Which countries does
  our Meraki fleet operate in, for GDPR / data-sovereignty
  reporting?".

**Typical sourcetype / index:** `sourcetype="meraki:devices"`,
`index=meraki` (TA defaults — see the
[markers companion §1](./markers.md#1-source-description) for
the broader catalogue and the Meraki API-polling cadence).

## 2. SPL recipe

```spl
index=meraki sourcetype="meraki:devices" earliest=-1h latest=now
| dedup serial sortby - _time
| where isnotnull(publicIp) AND publicIp != ""
| iplocation publicIp
| where isnotnull(Country) AND Country != ""
| eval is_online=if(status="online", 1, 0)
| stats count AS device_count,
    dc(networkName) AS network_count,
    sum(is_online) AS online_count
  BY Country
| lookup iso_country_codes country_name AS Country OUTPUT iso_a3 AS id
| where isnotnull(id) AND id != ""
| eval value=device_count
| rename Country AS country_name
| fields id, country_name, value, device_count, network_count, online_count
| sort - value
```

Why this exact shape, line by line:

- **`index=meraki sourcetype="meraki:devices"`** — TA defaults,
  same as the [markers companion §2](./markers.md#2-spl-recipe).
- **`earliest=-1h latest=now`** — the devices input polls every
  600 s by default; 1 h covers ~6 polls per device.
- **`dedup serial sortby -_time`** — one row per device, freshest
  snapshot. Same dedup pattern as the markers companion.
- **`where isnotnull(publicIp) AND publicIp != ""`** — defensive
  guard. Some devices (newly unboxed, awaiting first dashboard
  registration) ship without a `publicIp` and would drop here
  invisibly. Surface them in a companion table panel ("Devices
  awaiting public-IP registration: <count>") so the operator
  sees the gap.
- **`iplocation publicIp`** — Splunk's bundled MaxMind GeoLite2
  lookup populates `Country` (e.g., "United States", "Germany",
  "Japan") plus `Region` / `City` / lat/lng. No outbound network
  call.
- **`where isnotnull(Country) AND Country != ""`** — drop devices
  whose `publicIp` is private (10/8, 172.16/12, 192.168/16) or
  carrier-NAT range. These are operationally a real signal (a
  device is misconfigured or behind an unexpected NAT layer),
  but they don't belong on a country choropleth.
- **`eval is_online=if(status="online", 1, 0)`** — 0/1 flag for
  the next `stats` to SUM. Yields a per-country online-vs-total
  ratio for popup detail.
- **`stats count AS device_count, dc(networkName) AS
  network_count, sum(is_online) AS online_count BY Country`** —
  one row per country with three metrics: total devices, distinct
  Meraki networks (sites), and online count. The
  `dc(networkName)` is the useful sales-engineering metric ("36
  sites in Germany") — it counts distinct Meraki organizations'
  network groupings, not individual devices.
- **`lookup iso_country_codes country_name AS Country OUTPUT
  iso_a3 AS id`** — maps the MaxMind country NAME to the ISO
  3166-1 alpha-3 CODE that the world-countries PMTiles
  `promoteId` uses. Same lookup as the
  [thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md)
  and [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
  companions — see those recipes' §1 setup fences for the
  one-time `iso_country_codes` CSV bootstrap (a 250-row mapping
  file derived from the ISO 3166-1 alpha-3 standard).
- **`where isnotnull(id) AND id != ""`** — drop countries the
  lookup doesn't recognise. MaxMind occasionally emits country
  names that don't exactly match the ISO 3166-1 English short
  name ("Czechia" vs "Czech Republic", "Türkiye" vs "Turkey",
  "Burma" vs "Myanmar"); the iso_country_codes lookup should
  carry both spellings to minimise this.
- **`eval value=device_count`** — explicit copy. The choropleth
  layer reads `value` per the formatter contract. This is the
  absolute-count view; countries with the most Meraki devices
  shade darkest. For a NETWORK-COUNT view (highlights countries
  with the most distinct sites regardless of device density),
  swap to `eval value=network_count`. For an OFFLINE-RATIO view
  (highlights countries where the largest fraction of the fleet
  is offline), swap to `eval value=ceil((1.0 -
  (online_count*1.0/device_count)) * 100)`.
- **`rename Country AS country_name`** — adopt the Better Map
  snake_case convention for popup labels.
- **`fields ...`** — explicit projection of the six fields
  declared in `expected_fields` frontmatter.
- **`sort - value`** — biggest-fleet countries first.
- **No `head` cap.** Maximum row count is ~250 (ISO 3166-1
  country count), well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field         | type    | example        |
|---------------|---------|----------------|
| id            | string  | USA            |
| country_name  | string  | United States  |
| value         | integer | 847            |
| device_count  | integer | 847            |
| network_count | integer | 62             |
| online_count  | integer | 812            |

All six fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`. `value`
drives the choropleth shading; the other four flow through as
feature properties on the joined polygon for popups.

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

Why this minimal config (identical to the
[thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md#4-recommended-formatter-config)
companion — the row source differs, the PMTiles join contract
does not):

- **`featureJoinUrl`** — the customer-hosted PMTiles URL. Better
  Map uses PMTiles' HTTP Range fetcher to retrieve only visible
  tiles. For air-gapped tenants, drop the file into
  `better_map/appserver/static/visualizations/better_map/presets/`
  and substitute `featureJoinPreset: "<preset-name>"`.
- **`featureJoinPromoteId: "iso_a3"`** — the per-feature property
  whose value matches the SPL `id` column. Natural-Earth-derived
  country tilesets canonically use `iso_a3`; inspect via
  `pmtiles show <file>.pmtiles | jq '.layers[0].features[0].properties'`.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. Inspect via `pmtiles tile <file>.pmtiles
  0 0 0 | jq '.layers | keys'`.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from outline-only to value-shaded fill.
- **`palette: "viridis"`** — perceptually-uniform default;
  green-yellow-blue ramp reads neutrally for a "presence map"
  semantic (the recipe surfaces device count, not alerting
  severity). For an alerting-framed variant (e.g., countries
  with the most offline devices), swap to `magma`.

For an **extrusion + choropleth double-encoded view** (3D
height = device count, colour = device count), enable
`enable3DExtrusion: true` + `extrusionHeightField: "value"` +
`extrusionScale: 50000.0` (tunable to fleet size). Same
recipe-level tweak as the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
companion.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by (a) configuring the
`Splunk_TA_cisco_meraki` add-on against a Meraki organization
with devices in ≥5 countries (typically any multinational
Meraki tenant), (b) bootstrapping the `iso_country_codes` CSV
lookup per the
[thousandeyes/vector-tile-join §1 setup fence](../thousandeyes/vector-tile-join.md#1-source-description),
(c) hosting a `world-countries.pmtiles` file from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
on the customer CDN (or bundling into the app per ROADMAP §1a
for air-gap deployment), and (d) pasting the SPL above into a
Dashboard Studio map panel with Better Map as the visualization
+ applying the §4 formatter JSON. The choropleth should shade
countries proportional to their Meraki device count, with the
US, UK, Germany, Japan, and Australia typically the darkest
for global SaaS / managed-services customer fleets._

## 6. Gotchas

- **`publicIp` aggregates by NAT egress, not physical install
  location.** For tenants where Meraki traffic egresses through
  centralised cloud gateways (AWS Direct Connect us-east-1,
  Azure ExpressRoute, customer-owned SD-WAN VPN hubs), all
  devices may appear in the country of the egress hub rather
  than the country of the physical install. Two substitution
  paths:
  1. Maintain a `meraki_dashboard_inventory.csv` lookup mapping
     `serial` → `country_iso3` from the Meraki Dashboard's
     own address-of-record (operator-maintained from CSV
     export). Replace the `iplocation publicIp` + lookup steps
     with `| lookup meraki_dashboard_inventory serial OUTPUT
     country_iso3 AS id`.
  2. Read the country directly from a parsed `address` field
     (Meraki Dashboard captures a street address for each
     device): `| rex field=address ",\\s*(?<country_name>
     [^,]+)$"`, then lookup ISO3 from the parsed country.

- **`iso_country_codes` lookup must exist.** The same caveat
  as the
  [thousandeyes/vector-tile-join §6](../thousandeyes/vector-tile-join.md#6-gotchas)
  and
  [cim-network-traffic/vector-tile-join §6](../cim-network-traffic/vector-tile-join.md#6-gotchas)
  applies: bootstrap the lookup once via
  `| inputlookup iso_country_codes` and confirm `iso_a3` is
  populated for every row.

- **Private-IP devices invisibly drop.** Devices with `publicIp`
  in the 10/8, 172.16/12, 192.168/16, or carrier-NAT ranges
  (100.64/10) yield `Country=null` from `iplocation` and drop
  silently. Surface the count via a companion panel:
  ```spl
  index=meraki sourcetype="meraki:devices" earliest=-1h
  | dedup serial sortby - _time
  | iplocation publicIp
  | where isnull(Country)
  | stats count AS unattributed_devices
  ```

- **MaxMind country-name vs ISO-name mismatches.** MaxMind
  GeoLite2 emits country names that don't always match the
  English short name in the ISO 3166-1 lookup ("Czechia" vs
  "Czech Republic", "Türkiye" vs "Turkey", "Burma" vs
  "Myanmar"). Maintain the `iso_country_codes` lookup with
  both spellings as separate rows, OR add a normalisation
  step:
  ```spl
  | eval Country=case(
      Country="Czechia", "Czech Republic",
      Country="Türkiye", "Turkey",
      Country="Burma", "Myanmar",
      true(), Country
  )
  ```

- **Customers with <10 countries don't benefit from this
  recipe.** For a Meraki tenant operating in only the US +
  Canada, the world-countries choropleth shows ~245 grey
  countries and 2 coloured ones — visually misleading. Such
  tenants should use the
  [cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
  US-state pattern adapted to Meraki, OR the
  [meraki/markers](./markers.md) per-device view at building
  zoom.

- **No OT-safety dependency.** Meraki is IT infrastructure
  (campus wireless, SD-WAN, security appliances). If a Meraki
  install also covers OT-zone equipment (Cisco IE switches
  in a plant network), filter those OUT here via `| where NOT
  match(model, "^IE-")` and put them in a SEPARATE recipe with
  `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented `meraki:devices` schema from the
[cisco-meraki-ta-setup skill](https://github.com/fenre/better_map/blob/main/docs/recipes/meraki/markers.md),
follows the proven `iplocation Country` → `iso_a3` → world-countries
PMTiles pattern shipped in
[thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md)
and
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
and uses only Splunk built-ins (`dedup`, `iplocation`, `stats`,
`eval`, `where`, `lookup`, `rename`, `fields`, `sort`). The PMTiles
fetch + choropleth fill behaviour is covered by Better Map's own
`featureJoin` module unit tests. The end-to-end "this recipe's
SPL against a real multinational Meraki tenant + a populated
`iso_country_codes` lookup + a customer-hosted world-countries
PMTiles tileset renders a per-country choropleth in a Splunk
Dashboard Studio panel" path has not been dispatched against the
v1.7-prep lab tenant in this PR because the lab tenant does not
carry a multi-country Meraki organization. A maintainer with a
multinational Meraki tenant (or willing to spin up a synthetic
multi-country Meraki Dashboard sandbox) should follow the
verification steps in the
[thousandeyes/vector-tile-join §Verification status](../thousandeyes/vector-tile-join.md#verification-status)
(substituting the Meraki SPL for the ThousandEyes SPL), then
promote to `status: verified` + fill in `verified_against` in a
follow-up PR.
