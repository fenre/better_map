---
schema_version: 1
id: cim-performance--vector-tile-join
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-31"
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
    example: "73"
  - name: signal_host_count
    type: integer
    example: "73"
  - name: total_host_count
    type: integer
    example: "412"
  - name: signal_ratio
    type: number
    example: "0.18"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, choropleth layer (bundled us-states preset, US-only sibling)"
    path: "docs/recipes/cim-performance/choropleth.md"
  - description: "Companion recipe — same source, extrusion-3d layer (us-states preset, height-encoded sibling)"
    path: "docs/recipes/cim-performance/extrusion-3d.md"
  - description: "Companion recipes — same source, markers / heat / h3 / supercluster / paths layers"
    path: "docs/recipes/cim-performance/markers.md"
  - description: "Pattern reference — vector-tile-join on CIM Network Traffic (sibling event-source pattern, same iplocation + iso_country_codes chain)"
    path: "docs/recipes/cim-network-traffic/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join on Meraki (sibling iplocation + Country aggregation, device-inventory metric)"
    path: "docs/recipes/meraki/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join on ThousandEyes (sibling iplocation + Country aggregation, agent-inventory metric)"
    path: "docs/recipes/thousandeyes/vector-tile-join.md"
  - description: "splunk-cim skill — Performance data model schema, dataset tags, dest/cpu/memory contracts"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "splunk-datamodels-conf skill — CIM acceleration and tstats summariesonly tradeoffs"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Performance — vector-tile join (customer PMTiles, world countries)

Render the global distribution of monitored-host fleet pressure
by joining **CIM Performance host telemetry** (breaching-host
count, geocoded via the ES Asset & Identity asset lookup) against
a **customer-hosted world-countries PMTiles vector tileset**. The
**global companion** to the
[cim-performance/choropleth](./choropleth.md) recipe — same triple-
threshold breach detection (CPU > 80%, Memory > 80%, Storage >
85%), same per-host pressure logic, but instead of aggregating to
the 50 US states + DC via the bundled `us-states.pmtiles` preset,
the panel aggregates to **all countries worldwide** via a custom
PMTiles tileset (~5-15 MB from Natural Earth via
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)).

The **8th vector-tile-join recipe in the matrix** — joining
[csv-lookup-geo](../csv-lookup-geo/vector-tile-join.md),
[kvstore-latlon](../kvstore-latlon/vector-tile-join.md),
[cim-network-traffic](../cim-network-traffic/vector-tile-join.md),
[meraki](../meraki/vector-tile-join.md),
[ot-datastreamer](../ot-datastreamer/vector-tile-join.md),
[netflow-sflow-ipfix](../netflow-sflow-ipfix/vector-tile-join.md),
and [thousandeyes](../thousandeyes/vector-tile-join.md). This
advances the vector-tile-join layer column from 7 cells to 8,
and brings the cim-performance source row from 7 cells to 8
(markers, h3, heat, supercluster, paths, choropleth, extrusion-
3d, plus vector-tile-join now) — making cim-performance one of
the **most-covered source rows in the matrix** (matched only by
the CIM Network Traffic row).

The recipe is the canonical "global infrastructure fleet
pressure" panel for any tenant whose monitored host fleet spans
multiple continents — multinationals with EMEA / APAC / AMER
datacenters, SaaS vendors with multi-region cloud presence,
managed-service providers with multi-tenant host inventories.

## 1. Source description

Same **CIM Performance** data model as the
[markers](./markers.md), [choropleth](./choropleth.md),
[extrusion-3d](./extrusion-3d.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), and [paths](./paths.md)
companions — see
[cim-performance/markers §1](./markers.md#1-source-description)
for the full data model background, the six datasets (CPU,
Memory, Storage, Network, Facilities, Uptime), and the
acceleration / `tstats summariesonly=true` contract.

The relevant distinction for THIS recipe: instead of per-state
aggregation via `geom geo_us_states` (the
[choropleth companion](./choropleth.md#2-spl-recipe) pattern),
the panel aggregates per-COUNTRY via a chained
`asset_lookup_by_str` → `iplocation` lookup. The mid-pipeline
substitution is a small SPL change (one lookup re-target, one
extra aggregation column, one lookup join with
`iso_country_codes`), but the operational impact is large:
panel now answers "in which **countries** does our fleet have
the most pressured hosts?" instead of "in which **US states**".

**Why use the asset-lookup-derived IP rather than direct host
geocoding.** Same constraint as the
[choropleth companion §1](./choropleth.md#1-source-description):
CIM Performance's `dest` field is a hostname, NOT an IP, so
`iplocation dest` would not work. The
[choropleth companion](./choropleth.md) chains via
`asset_lookup_by_str` to get `lat` / `lon` for `geom
geo_us_states`. THIS recipe takes the parallel approach but uses
the asset lookup to get a public `ip` instead, then chains
`iplocation ip` to derive the country directly (same path the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
and [meraki/vector-tile-join](../meraki/vector-tile-join.md)
companions use, just with the IP sourced from a lookup instead
of directly from event fields).

**Why vector-tile-join (custom PMTiles) for CIM Performance.**
A US-states choropleth answers "which US states host our
pressured infrastructure" — and that's the right question for
many US-centric tenants. But for a global tenant (EMEA / APAC /
AMER footprint), the US-only choropleth answers the wrong
question; entire continents render as the unmatched-grey
fallback fill and the executive viewer can't tell whether
"grey = no pressure" or "grey = no coverage at all". A world-
countries vector-tile-join surfaces both questions correctly:
shaded countries have monitored hosts with measured pressure;
unshaded countries are operationally "no fleet there" (which
itself is informative — "we have no monitored infrastructure in
LATAM, that's a capacity-coverage gap").

Typical use cases:

- **Global CIO infrastructure-coverage reviews** — "Where is
  our monitored-host fleet pressured worldwide? Are EMEA and
  APAC absorbing more capacity pressure than AMER?"
- **Multi-region datacenter capacity-planning** — "Our
  Germany / Singapore / Sydney regions all show >20% breaching
  hosts; the next quarter's CapEx focus should be those three
  regions, not the comparatively lightly-loaded US-East /
  US-West baseline."
- **Compliance jurisdictional health reports** — "Per-country
  monitored-host fleet health, suitable for GDPR / data-
  residency reporting where infrastructure-incident counts
  need per-jurisdiction breakdown."
- **Sales-engineering RFP infrastructure-coverage visuals** —
  "We monitor host fleets across 42 countries; the heat map
  shows where our top-tier coverage lives today."

**Typical sourcetype / index:** Same broad catalogue as the
[markers companion](./markers.md#1-source-description) —
`nix:cpu`, `Perfmon:CPU`, `cisco:dnac:device`,
`cloudwatch:host`, `azure:monitor:metric`,
`vmware:vsphere:host:performance`, etc. The TA app context
required is `Splunk_SA_CIM`. The asset lookup is operator-
maintained; the `iso_country_codes` lookup is the same 250-row
CSV the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
and [meraki/vector-tile-join](../meraki/vector-tile-join.md)
companions document in their §6 Gotchas (one-time bootstrap
from the Natural Earth countries dataset).

**No add-on required beyond Splunk_SA_CIM** for the data model
and Splunk's built-in `iplocation` for geocoding. The PMTiles
file is customer-hosted (on the Splunk app's own
`appserver/static/` folder for air-gapped tenants, or on a
customer CDN for non-air-gapped). No external API calls. Fully
air-gap compatible per ROADMAP §1a when the PMTiles file is
bundled into the app.

## 2. SPL recipe

```spl
| tstats summariesonly=true latest(Performance.cpu_load_percent) AS cpu_load_percent FROM datamodel=Performance.CPU WHERE earliest=-15m latest=now BY Performance.dest
| rename Performance.dest AS dest
| append [
    | tstats summariesonly=true latest(Performance.mem_used_percent) AS mem_used_percent FROM datamodel=Performance.Memory WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| append [
    | tstats summariesonly=true latest(Performance.storage_used_percent) AS storage_used_percent FROM datamodel=Performance.Storage WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| stats latest(cpu_load_percent) AS cpu_load_percent, latest(mem_used_percent) AS mem_used_percent, latest(storage_used_percent) AS storage_used_percent BY dest
| eval cpu_signal=if(cpu_load_percent>80, 1, 0)
| eval mem_signal=if(mem_used_percent>80, 1, 0)
| eval storage_signal=if(storage_used_percent>85, 1, 0)
| eval signal_count=cpu_signal+mem_signal+storage_signal
| eval is_signalling=if(signal_count >= 1, 1, 0)
| lookup asset_lookup_by_str src AS dest OUTPUT ip AS host_ip
| where isnotnull(host_ip) AND host_ip != ""
| iplocation host_ip
| where isnotnull(Country) AND Country != ""
| stats sum(is_signalling) AS signal_host_count,
    count AS total_host_count
  BY Country
| lookup iso_country_codes country_name AS Country OUTPUT iso_a3 AS id
| where isnotnull(id) AND id != ""
| eval signal_ratio=round(signal_host_count / total_host_count, 2)
| eval value=signal_host_count
| rename Country AS country_name
| fields id, country_name, value, signal_host_count, total_host_count, signal_ratio
| sort - value
```

Why this exact shape, line by line (the first 13 lines mirror
the [choropleth companion §2](./choropleth.md#2-spl-recipe)
verbatim — same triple-tstats threshold detection — then the
geocoding chain diverges from line 14 onward):

- **Lines 1-12 (the breach-detection block).** Same as the
  [choropleth companion](./choropleth.md#2-spl-recipe) — three
  `tstats summariesonly=true` against `Performance.CPU`,
  `.Memory`, `.Storage` data models, joined via `stats latest()
  BY dest`, then per-threshold `eval *_signal=if(...)` to
  derive `is_signalling`. The 80% / 80% / 85% thresholds are
  the same operational defaults as the markers / choropleth /
  extrusion-3d companions; tune in your tenant per the
  [markers companion §6](./markers.md#6-gotchas) calibration
  guidance.
- **`lookup asset_lookup_by_str src AS dest OUTPUT ip AS
  host_ip`** — the geocoding-chain change vs the
  [choropleth companion](./choropleth.md). The companion looks
  up `lat` / `lon` for `geom geo_us_states`; this recipe looks
  up `ip` for `iplocation`. The ES Asset & Identity framework's
  `assets.csv` schema includes both `lat` / `long` AND `ip`
  fields by convention (see the
  [splunk-enterprise-security skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-enterprise-security.mdc)
  for the canonical column layout), so either field can be
  pulled from the same lookup. The renamed `host_ip` avoids
  collision with the CIM `ip` field that some host-performance
  sourcetypes (e.g., `cisco:dnac:device`) ALSO populate at the
  event level.
- **`where isnotnull(host_ip) AND host_ip != ""`** — drop
  hosts that don't have an IP in the asset inventory. This is
  a real signal (asset lookup is missing data for some hosts);
  surface it in a companion table panel ("Hosts missing IP in
  asset inventory: <count>") so operations sees the gap rather
  than letting hosts silently fall off the panel.
- **`iplocation host_ip`** — Splunk's bundled MaxMind GeoLite2
  geocoder. Populates `Country` (e.g., "United States",
  "Germany", "Japan") plus `Region` / `City` / lat/lng. RFC-
  1918 / private IPs resolve to null `Country` and are filtered
  out by the next stage. **Identical to the
  [cim-network-traffic/vector-tile-join §2](../cim-network-traffic/vector-tile-join.md#2-spl-recipe)
  geocoding pattern** — the difference is only in the
  upstream source (event-side IP vs lookup-side IP).
- **`where isnotnull(Country) AND Country != ""`** — drop
  internal-IP hosts so they don't pile up under a synthetic
  "unknown country" bucket. For tenants with a heavy internal-
  IP host fleet (typical), this is the #1 way to ensure the
  choropleth shading is accurate: only public-IP hosts
  contribute. To surface the internal-IP fleet separately,
  add a companion table panel that runs the same SPL minus
  this filter, grouped by `if(isnull(Country), "Internal", Country)`.
- **`stats sum(is_signalling) AS signal_host_count, count AS
  total_host_count BY Country`** — second aggregation pass:
  per-country breaching-host count + total host count. The
  ratio (`signal_ratio` two lines later) is the percentage of
  the country's monitored fleet that's currently breaching
  ≥1 threshold — the executive-friendly metric for "how
  pressured is this region?".
- **`lookup iso_country_codes country_name AS Country OUTPUT
  iso_a3 AS id`** — maps the MaxMind country NAME to the ISO
  3166-1 alpha-3 CODE the world-countries PMTiles `promoteId`
  uses. **Identical lookup to the
  [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
  [meraki/vector-tile-join](../meraki/vector-tile-join.md),
  and [thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md)
  companions** — the 250-row CSV bootstrap is documented in
  any of those recipes' §6 Gotchas. If your tileset uses
  ISO 3166-1 alpha-2 codes (`iso_a2`, "US" / "DE" / "JP")
  instead, change `OUTPUT iso_a3 AS id` to `OUTPUT iso_a2 AS
  id` and update the §4 `featureJoinPromoteId` accordingly.
- **`where isnotnull(id) AND id != ""`** — drop countries that
  didn't resolve in the lookup. Typical drops are MaxMind
  edge-case names ("Korea, Republic of" vs Natural Earth's
  "South Korea") that don't exact-match the 250-row table;
  surface these in a companion table panel ("Countries with
  monitored hosts but no PMTiles match: <count>") so the
  operator can extend the `iso_country_codes` lookup if needed.
- **`eval signal_ratio=round(signal_host_count /
  total_host_count, 2)`** — the executive metric. A country
  with 1 breaching host out of 1 monitored host (`ratio=1.00`)
  reads identically to a country with 100 / 100 in the raw
  count panel; the ratio normalizes for fleet size. For
  tenants where absolute count matters more than ratio (e.g.,
  "find the country with the most ABSOLUTE breaches, not the
  highest BREACH RATIO"), use `eval value=signal_host_count`
  (which the next line already does — `value` drives shading,
  `signal_ratio` flows through as a popup field).
- **`eval value=signal_host_count`** — alias the breach count
  to Better Map's canonical `value` field name for choropleth
  shading. `value` is what `enableChoropleth` reads. To shade
  by RATIO instead of COUNT, change to `eval
  value=signal_ratio` (ratio is 0.0-1.0, so tune the §4
  palette / colour-scale-max accordingly).
- **`rename Country AS country_name`** — popup-friendly alias
  matching the
  [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
  popup contract.
- **`fields ...`** — explicit projection, six columns: the
  join key (`id`), the popup label (`country_name`), the
  shading driver (`value`), and three feature-property fields
  (`signal_host_count`, `total_host_count`, `signal_ratio`)
  for popup detail.
- **`sort - value`** — most-pressured countries first (matters
  for any companion "Top 10 countries by breach count" table
  panel; the choropleth renderer itself is row-order-
  agnostic).

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field             | type    | example       |
|-------------------|---------|---------------|
| id                | string  | USA           |
| country_name      | string  | United States |
| value             | integer | 73            |
| signal_host_count | integer | 73            |
| total_host_count  | integer | 412           |
| signal_ratio      | number  | 0.18          |

Six fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `value` drives the choropleth
shading; `country_name` / `signal_host_count` /
`total_host_count` / `signal_ratio` flow through as feature
properties on the joined polygon for popups (a hover over
"Germany" reads e.g., "Germany — 23 of 87 hosts breaching, 26%
ratio").

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

Why these settings (identical contract to the
[cim-network-traffic/vector-tile-join companion §4](../cim-network-traffic/vector-tile-join.md#4-recommended-formatter-config)
— the PMTiles join contract is layer-driven, not source-
driven):

- **`featureJoinUrl`** — the customer-hosted world-countries
  PMTiles URL. Public-domain Natural Earth tileset from
  [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
  is the canonical starting point (~5 MB at 1:110M scale,
  ~15 MB at 1:50M). For air-gapped tenants, copy the
  `.pmtiles` file into
  `better_map/appserver/static/visualizations/better_map/presets/`
  and use `featureJoinPreset: "<your-preset-name>"` instead.
- **`featureJoinPromoteId: "iso_a3"`** — the property name on
  each tileset feature whose value matches the `id` field
  from the SPL. For Natural Earth / OpenStreetMap-derived
  country tilesets, `iso_a3` is canonical. Use `pmtiles show
  <file>.pmtiles` to confirm; some tilesets use `iso_a2`
  (2-letter), `name`, or `name_en` instead. If your tileset
  uses `iso_a2`, update both this option AND the SPL `OUTPUT
  iso_a2 AS id` in §2 to match.
- **`featureJoinSourceLayer: "countries"`** — the source-
  layer name inside the tileset. Inspect with `pmtiles tile
  <file>.pmtiles 0 0 0 | jq '.layers | keys'`. For most
  world-countries tilesets the source-layer name matches the
  conceptual category (`countries`, `world`, `nations`).
- **`enableChoropleth: "true"`** — switches the rendering
  mode from "outline only" (default for joined tilesets) to
  "value-shaded fill". The SPL MUST produce a `value` field
  for shading; rows with no `value` render with the
  unmatched-grey fallback fill.
- **`palette: "viridis"`** — perceptually-uniform single-
  direction palette. Same default as the
  [choropleth companion §4](./choropleth.md#4-recommended-formatter-config)
  for visual consistency when both recipes ship side-by-side
  in the same dashboard (US-only choropleth + global VTJ).
  For a security-framed view where breaching hosts represent
  ATTACK SURFACE rather than CAPACITY PRESSURE, swap to
  `palette: "magma"` (warm-equates-with-danger, matching the
  [cim-alerts](../cim-alerts/choropleth.md) companion). For
  diverging data (e.g., "this week's breach count vs the
  30-day baseline, positive or negative") switch to
  `palette: "rdbu"` and set a midpoint via `colorScaleMid`.

For a **breach-RATIO shading variant** (where the question is
"which countries have the LARGEST PORTION of their fleet
breaching" rather than "which countries have the most ABSOLUTE
breaches"), change the SPL `eval value=signal_host_count` to
`eval value=signal_ratio`. The `signal_ratio` is 0.0-1.0, so the
palette ramp auto-scales to that range. Useful when fleet sizes
are heterogeneous across countries (e.g., 1000 hosts in USA vs
20 hosts in Iceland) — the ratio answers "is Iceland's tiny
fleet under MORE pressure than USA's large one?" which the raw
count cannot.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). Until
then, reproduce by (a) staging a small world-countries PMTiles
file (the public-domain Natural Earth countries tileset from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
is the canonical starting point), (b) populating an
`iso_country_codes` CSV lookup with the 250-row name → alpha-3
mapping (one-time bootstrap documented in the
[cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas)
or installing the
[Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
add-on which ships its own equivalent), (c) ensuring
`asset_lookup_by_str` has populated `ip` field values for the
host fleet (typical ES Asset & Identity framework deployment),
(d) pasting the §2 SPL into a Dashboard Studio map panel with
Better Map as the visualization and applying the §4 formatter
JSON. The choropleth should shade countries that host
breaching-threshold infrastructure, with the densest-fleet
countries (typically USA, Germany, UK, India for global SaaS
tenants) darkest._

## 6. Gotchas

- **`iso_country_codes` lookup is REQUIRED but NOT bundled.**
  Same caveat as all four other world-countries VTJ recipes
  (`cim-network-traffic`, `meraki`, `thousandeyes`,
  `ot-datastreamer`). The lookup is a 250-row CSV mapping
  `country_name` (matching MaxMind / `iplocation` output)
  → `iso_a3` (matching the PMTiles `promoteId`). One-time
  bootstrap from the Natural Earth countries dataset is
  documented in the
  [cim-network-traffic/vector-tile-join §6 Gotchas](../cim-network-traffic/vector-tile-join.md#6-gotchas)
  with a `| makeresults`-based seed snippet (which is
  explicitly a one-time setup script, NOT panel SPL — per
  the ROADMAP §5 anti-pattern carve-out). Alternatively,
  install [Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
  which ships an equivalent lookup with broader coverage.

- **`asset_lookup_by_str` MUST have populated `ip` fields.**
  This recipe assumes the customer has a populated ES Asset
  & Identity (`assets.csv`) lookup with the `ip` column filled
  for the monitored host fleet. Tenants without ES installed,
  or with `assets.csv` only partially populated, will see
  silent host drops on the line `where isnotnull(host_ip)`.
  Mitigations:
  - **Companion gap-detection panel.** Run the same SPL up
    through the `asset_lookup_by_str` line, then `eval
    has_ip=if(isnotnull(host_ip), "yes", "no") | stats count
    BY has_ip`. The "no" row count tells you how many hosts
    silently drop. If that count is significant, populate
    `assets.csv` (manually, via CMDB sync, or via the
    [Splunk Asset & Risk Intelligence](https://splunkbase.splunk.com/app/5829)
    automation) before relying on this recipe.
  - **Alternative source: `nslookup` on dest.** For hosts
    where the hostname IS DNS-resolvable from the search head,
    replace the asset-lookup chain with `| lookup
    dnslookup host AS dest OUTPUT clientip AS host_ip`
    (assuming Splunk's bundled DNS lookup is configured). This
    avoids the asset lookup dependency entirely but adds DNS
    lookup latency to every panel refresh (significant for
    large fleets).
  - **Alternative source: host metadata sourcetype.** Some
    hosts ship their own IP in performance event fields (e.g.,
    `cisco:dnac:device` events include `managementIpAddress`;
    `cloudwatch:host` events include `instance_id` / private
    IP). For tenants whose host telemetry already carries IP
    in the event, bypass the asset lookup entirely: extract
    the per-host IP via `stats values(host_ip) AS host_ip BY
    dest` immediately after the breach-detection block, then
    `iplocation host_ip` directly. Lower latency, no
    cross-table join.

- **Internal-IP hosts silently drop.** Same caveat as all
  `iplocation`-based vector-tile-join recipes: hosts whose
  `host_ip` from the asset lookup is RFC-1918 private
  (10/8, 172.16/12, 192.168/16), carrier-NAT (100.64/10), or
  loopback (127/8) resolve to null `Country` and drop at
  `where isnotnull(Country)`. For tenants with a large
  internal-IP fleet (typical), this is the #1 way to ensure
  the choropleth shading reflects the public-facing fleet
  only. To surface the internal-IP fleet on the panel,
  EITHER (a) populate `assets.csv` with the public-edge IP
  (e.g., the egress IP of the host's outbound NAT), OR (b)
  add a companion single-value panel that runs the same SPL
  minus the `where isnotnull(Country)` filter, with the
  null-Country bucket displayed as the "Internal fleet
  baseline" count.

- **MaxMind country-name vs Natural Earth country-name
  drift.** MaxMind GeoLite2's country naming sometimes drifts
  from Natural Earth's (e.g., "Korea, Republic of" vs "South
  Korea"; "Macedonia" vs "North Macedonia" pre-2019;
  "Czech Republic" vs "Czechia" post-2016). When the
  `iso_country_codes` lookup is bootstrapped from Natural
  Earth but the SPL uses MaxMind output, exact-string
  joining can fail on these edge cases — the country
  silently disappears from the panel. Mitigations:
  - **Bidirectional CSV bootstrap.** When seeding the
    `iso_country_codes` lookup, include BOTH MaxMind-style
    and Natural-Earth-style names as separate rows mapping
    to the same `iso_a3` code. This is a few extra rows
    (~10-15 known drift cases) but guarantees no silent drop.
  - **Companion gap-detection panel.** Run the same SPL up
    through the `lookup iso_country_codes` line, then `eval
    has_id=if(isnotnull(id), "yes", "no") | stats count BY
    has_id, Country`. The "no" rows tell you exactly which
    MaxMind country names are missing from the lookup;
    extend the CSV with those rows.
  - **Use a country-CODE-based lookup instead.** Some
    `iplocation` configurations populate `Country` as the
    ISO 3166-1 alpha-2 code directly (rather than the
    name). If your tenant uses such a configuration,
    change the lookup invocation to `| lookup
    iso_country_codes iso_a2 AS Country OUTPUT iso_a3 AS
    id` — code-based joining is far more reliable than
    name-based joining.

- **CIM Performance acceleration is a hard prerequisite.**
  Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas):
  `tstats summariesonly=true` REQUIRES the Performance data
  model be accelerated; if acceleration is not enabled on
  the customer tenant, the search returns zero rows. Verify
  acceleration with `| datamodel Performance summariesonly`
  before relying on this recipe in a dashboard. To bootstrap
  acceleration, navigate to "Settings > Data Models >
  Performance > Edit > Edit Acceleration" and enable a
  7-day acceleration window (the default).

- **Saved-search summary indexing recommended for large
  fleets.** A panel that runs the chained triple-tstats +
  asset-lookup + iplocation pipeline against a 10,000+ host
  fleet can take 30-60 seconds — too slow for a refreshing
  dashboard. For production deployment, schedule a saved
  search (every 15 minutes, say) that runs the SPL above and
  outputs to a CSV lookup or summary index, then point the
  dashboard panel at the lookup / summary index. Sub-second
  panel refresh, same data freshness as the 15-minute saved
  search.

- **The `signal_ratio` may be misleading for tiny country
  fleets.** A country with 1 monitored host that's breaching
  reads as `signal_ratio=1.00` (100%) — visually identical to
  a country with 100 / 100 hosts breaching. For executive
  panels, surface BOTH the count and the ratio (the SPL's
  popup fields cover this), AND consider a
  `where total_host_count > 5` filter to drop countries
  with too-small fleets to draw conclusions from. This is
  a soft-truth issue: the tiny-fleet country DOES have 100%
  breaching, but the executive viewer should know it's 1 of
  1 hosts, not 1000 of 1000.

- **No OT-safety dependency.** CIM Performance covers IT-
  infrastructure host telemetry (CPU, memory, storage,
  facilities) — NOT OT-zone PLCs, HMIs, RTUs, or SIS
  logic-solvers. The recipe is IT-only and the
  `ot_safety_relevant: false` frontmatter is correct.
  For tenants whose CIM Performance feed DOES include OT-
  zone host metrics (e.g., an OT engineering workstation
  shadowing a Level-3 device's perf counters into Splunk
  via CIM mapping), the operator should review the OT
  metric in scope against
  [`~/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1-3 (passive read-only collection, no active
  signal disabling, no SOAR write actions) and set
  `ot_safety_relevant: true` on any operator-specific
  variant.

## Verification status

`status: unverified` in the frontmatter — every component is
proven elsewhere: the triple-tstats breach-detection block
mirrors the
[choropleth companion](./choropleth.md) (verified-against-
prototype); the `asset_lookup_by_str` → `iplocation` chain
mirrors the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
geocoding pattern; the `iso_country_codes` lookup join is
identical to four existing VTJ recipes; the `featureJoinUrl`
+ `featureJoinPromoteId` + `featureJoinSourceLayer` contract
is exercised by every world-countries VTJ recipe in the matrix.
A maintainer with a populated CIM Performance feed AND a
populated `asset_lookup_by_str` lookup AND the
`iso_country_codes` CSV bootstrap AND a hosted world-countries
PMTiles tileset can promote this recipe to `status: verified`
+ fill in `verified_against` in a follow-up PR — verification
steps mirror the
[choropleth companion's verification fence](./choropleth.md#verification-status),
substituting the §4 formatter JSON for the world-countries
variant and confirming non-US countries shade correctly.
