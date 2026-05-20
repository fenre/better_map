---
schema_version: 1
id: thousandeyes--vector-tile-join
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (agent fleet)"
  pattern: splunk-vendor-ta
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-25"
verified_against: null
splunk_apps_required:
  - id: "ta_cisco_thousandeyes"
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
    example: "47"
  - name: agent_count
    type: integer
    example: "47"
  - name: online_count
    type: integer
    example: "44"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, choropleth layer (US-only via bundled us-states preset)"
    path: "docs/recipes/thousandeyes/choropleth.md"
  - description: "Companion recipe — same source, markers / paths / h3 / heat / supercluster layers"
    path: "docs/recipes/thousandeyes/markers.md"
  - description: "Pattern reference — vector-tile-join with CIM Network Traffic source (event-source sibling)"
    path: "docs/recipes/cim-network-traffic/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with CSV lookup metric source (lookup-source sibling)"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with KV Store metric source (lookup-source sibling)"
    path: "docs/recipes/kvstore-latlon/vector-tile-join.md"
  - description: "ThousandEyes setup skill — agent inventory, sourcetypes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# Cisco ThousandEyes (agent fleet) — vector-tile join (world-countries PMTiles)

Aggregate the ThousandEyes enterprise + cloud agent fleet by
**country** and render as a **flat-fill choropleth** over a
customer-hosted **world-countries PMTiles tileset**. The
**global-coverage companion** to the US-only
[thousandeyes/choropleth](./choropleth.md) recipe — same agent
inventory feed, same per-polygon aggregation, but per-country
rather than per-state and over a multinational tileset rather
than the bundled `us-states` preset.

The **4th vector-tile-join recipe in the matrix** (joining the
event-source [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
and the two lookup-source companions
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
and [kvstore-latlon/vector-tile-join](../kvstore-latlon/vector-tile-join.md)).
This advances the vector-tile-join layer column from 3 cells to
4, demonstrating that the polygon-join pattern composes with the
**ThousandEyes vendor-TA source** and that the same `featureJoin`
contract drives both US-state polygons (via the bundled preset)
AND world-country polygons (via a customer-hosted tileset).

## 1. Source description

Same **Cisco ThousandEyes App for Splunk**
(`ta_cisco_thousandeyes`, Splunkbase ID 7719) source as all
thousandeyes companions — see
[thousandeyes/markers §1](./markers.md#1-source-description)
for the full platform background and the
`cisco:thousandeyes:agents` sourcetype contract.

The relevant distinction for THIS recipe: the panel aggregates
agents by **Country** (not US Region/state), and renders the
per-country polygon fill against a **customer-hosted
world-countries PMTiles tileset** rather than the bundled
`us-states.pmtiles` preset that the
[choropleth companion](./choropleth.md) uses. Same SPL backbone
(`iplocation agent_ip`, `dedup agent_id`) — the swap is at the
`BY` clause and the formatter join target.

**Why vector-tile-join (world-countries) for ThousandEyes.**
ThousandEyes is a **global** digital-experience-monitoring
platform — its native value is measuring web/SaaS reachability
from agents distributed across continents. The US-only
[choropleth companion](./choropleth.md) answers "where is my
US coverage gap?", but for a multinational customer with EMEA /
APAC / LATAM enterprise agents AND cloud agents in AWS
EU-Frankfurt / GCP asia-northeast / Azure-southeastasia, the
panel question is "which countries do I have measurement
coverage in, and where are my blind spots?". A world-countries
choropleth answers this in one panel: every country with ≥1
agent is shaded; every country without is rendered in the
neutral unmatched-grey fallback. The shaded-vs-unshaded ratio
is the executive read on global DEM-coverage maturity.

This recipe is the **natural cross-sell view** for any customer
running ThousandEyes globally: CIO asks "are we measuring our
European customer base?"; sales-engineering RFP needs a
"36-country measurement footprint" map; international
account-planning needs a per-country agent-count metric for
regional expansion forecasts.

**Why a customer-hosted PMTiles file rather than the bundled
us-states preset.** Better Map's `featureJoin` layer is
geometry-agnostic at the layer level — any PMTiles tileset with
a `source-layer` name and a per-feature `promoteId` property
works. The bundled presets only cover US-jurisdiction polygons
(50 states + DC). Shipping a custom `world-countries.pmtiles`
file (~5-15 MB, public-domain from
[Natural Earth via protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets))
unlocks global per-country rendering with the same join contract
the bundled presets use.

**Typical sourcetype / index:**
`sourcetype="cisco:thousandeyes:agents"`,
`index=thousandeyes_agents` (defaults from
[`ta_cisco_thousandeyes`](https://splunkbase.splunk.com/app/7719);
see the [markers companion §1](./markers.md#1-source-description)
for the broader catalogue).

**No add-on required beyond `ta_cisco_thousandeyes`** for the
agent inventory and Splunk's built-in `iplocation` for
geocoding. The PMTiles file is customer-hosted (on the Splunk
app's own `appserver/static/` folder for air-gapped tenants, or
on a customer CDN for non-air-gapped tenants). Fully air-gap
compatible per ROADMAP §1a when the PMTiles file is bundled
into the app via `featureJoinPreset`.

## 2. SPL recipe

```spl
index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents" earliest=-24h latest=now
| dedup agent_id sortby - _time
| where isnotnull(agent_ip)
| iplocation agent_ip
| where isnotnull(Country) AND Country != ""
| eval is_online=if(is_online="true", 1, 0)
| stats count AS agent_count,
    sum(is_online) AS online_count
  BY Country
| lookup iso_country_codes country_name AS Country OUTPUT iso_a3 AS id
| where isnotnull(id) AND id != ""
| eval value=agent_count
| rename Country AS country_name
| fields id, country_name, value, agent_count, online_count
| sort - value
```

Why this exact shape, line by line:

- **`index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents"`** —
  TA defaults, same as all thousandeyes companions.
- **`earliest=-24h latest=now`** — agent inventory polls hourly
  by default; 24h covers ≥24 polls per agent. `dedup agent_id
  sortby -_time` keeps the freshest snapshot per agent.
- **`where isnotnull(agent_ip)`** — defensive guard, same as the
  [choropleth companion §2](./choropleth.md#2-spl-recipe). Some
  endpoint agents (browser-extension installs) don't publish a
  stable `agent_ip` and would drop here invisibly.
- **`iplocation agent_ip`** — Splunk's bundled MaxMind GeoLite2
  lookup populates `Country` (e.g., "United States", "Germany",
  "Japan", "Brazil"). No outbound network call.
- **`where isnotnull(Country) AND Country != ""`** — drop
  internal-IP / unresolved-IP rows. (The choropleth companion's
  `Country="United States"` guard is replaced by an "any
  country" guard here — that's the whole point of the global
  recipe.)
- **`eval is_online=if(is_online="true", 1, 0)`** — 0/1 flag
  for the next `stats` to SUM. Produces a per-country count of
  online vs total agents in the popup.
- **`stats count AS agent_count, sum(is_online) AS online_count
  BY Country`** — one row per country with two metrics:
  total-agent count for the panel value, online count for the
  popup detail.
- **`lookup iso_country_codes country_name AS Country OUTPUT
  iso_a3 AS id`** — maps the MaxMind country NAME ("United
  States", "Germany", "Japan") to the ISO 3166-1 alpha-3 CODE
  ("USA", "DEU", "JPN") that the world-countries PMTiles
  tileset uses as its `promoteId` join key. The
  `iso_country_codes` lookup is NOT a Splunk built-in — same
  one-time CSV bootstrap as the
  [cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas).
  If your tileset's `promoteId` is ISO-3166-1 alpha-2 (`iso_a2`,
  "US" / "DE" / "JP"), use `OUTPUT iso_a2 AS id` instead.
- **`where isnotnull(id) AND id != ""`** — drop countries that
  didn't resolve in the lookup (typically obscure islands or
  disputed territories whose MaxMind name doesn't exactly match
  a Natural Earth entry). Without this guard those rows render
  with the unmatched-grey fallback fill, which obscures the
  semantic "no coverage" reading of unshaded countries.
- **`eval value=agent_count`** — explicit copy. The choropleth
  layer reads `value` per the formatter contract; the popup
  shows both `agent_count` (semantic) and `value` (technical)
  without overloading.
- **`rename Country AS country_name`** — popup-friendly alias.
  Same pattern as the
  [cim-network-traffic/vector-tile-join companion §2](../cim-network-traffic/vector-tile-join.md#2-spl-recipe).
- **`fields ...`** — explicit projection.
- **`sort - value`** — biggest fleets first. Matters for the
  companion "Top 10 countries by agent count" table panel; the
  choropleth itself is row-order-agnostic.
- **No `head` cap.** Maximum row count is ~250 (one per country
  with at least one online agent), well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field        | type    | example       |
|--------------|---------|---------------|
| id           | string  | USA           |
| country_name | string  | United States |
| value        | integer | 47            |
| agent_count  | integer | 47            |
| online_count | integer | 44            |

All five fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the choropleth shading; `country_name`,
`agent_count`, and `online_count` flow through as feature
properties on the joined polygon for popups.

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
[cim-network-traffic/vector-tile-join companion §4](../cim-network-traffic/vector-tile-join.md#4-recommended-formatter-config)
and the
[csv-lookup-geo/vector-tile-join companion §4](../csv-lookup-geo/vector-tile-join.md#4-recommended-formatter-config) —
the metric row source is interchangeable across these recipes,
the PMTiles join contract is not):

- **`featureJoinUrl`** — the customer-hosted PMTiles URL.
  Better Map uses PMTiles' HTTP Range fetcher to retrieve only
  visible tiles. For air-gapped tenants, copy the `.pmtiles`
  file into
  `better_map/appserver/static/visualizations/better_map/presets/`
  and use `featureJoinPreset: "<your-preset-name>"` instead.
  The public-domain Natural Earth
  [world-countries tileset from protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
  is the standard starting point.
- **`featureJoinPromoteId: "iso_a3"`** — the property name on
  each tileset feature whose value matches the `id` field in
  the SPL row set. For Natural Earth / OpenStreetMap-derived
  country tilesets, `iso_a3` is the canonical ISO 3166-1
  alpha-3 code. Inspect via `pmtiles show <file>.pmtiles` to
  confirm the property name (some tilesets use `iso_a2`,
  `name`, or `name_en` instead).
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. Inspect via `pmtiles tile
  <file>.pmtiles 0 0 0 | jq '.layers | keys'` to list available
  source layers (`countries`, `world`, `nations` are common).
- **`enableChoropleth: "true"`** — switches the join layer from
  neutral polygon outline to colour-graded fill. The SPL MUST
  produce a `value` field; rows with no `value` render with
  the unmatched-grey fallback fill.
- **`palette: "viridis"`** — perceptually-uniform sequential
  ramp. Same default as the
  [thousandeyes/choropleth companion §4](./choropleth.md#4-recommended-formatter-config).
  For an **alerting-framed view** (panel restricted to agents
  reporting elevated test failures), switch to `magma` for
  warm-colour-equates-with-attention semantics.

For an **extrusion + choropleth double-encoded view** (3D
height = agent count, colour = agent count), enable
`enable3DExtrusion: true` + `extrusionHeightField: "value"`
+ `extrusionScale: 50000.0` — same recipe-level tweak as the
[meraki/extrusion-3d](../meraki/extrusion-3d.md) companion.
Tunable per fleet size: a 50-agent fleet needs
`extrusionScale: 200000`; a 500-agent fleet needs
`extrusionScale: 20000`.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). Until
then, reproduce by (a) staging a small PMTiles file (the
public-domain Natural Earth countries tileset from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
is the canonical starting point), (b) populating an
`iso_country_codes` CSV lookup with the 250-row name → alpha-3
mapping (or installing the
[Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
add-on which ships its own equivalent), (c) pasting the §2 SPL
into a Dashboard Studio map panel with Better Map as the
visualization and applying the §4 formatter JSON. The
choropleth should shade the US, UK, Germany, Japan, India,
Brazil, and other major-cloud / multinational-deployment
countries darker than under-covered regions, with truly
uncovered countries rendering in the neutral fallback fill._

## 6. Gotchas

- **`iso_country_codes` lookup is REQUIRED but NOT bundled.**
  Same one-time CSV bootstrap as the
  [cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas).
  Without the lookup, the §2 SPL returns zero `id` values and
  the panel renders the unmatched-grey fallback fill globally.
  Alternatively, install the
  [Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
  add-on which ships an equivalent lookup with broader
  coverage.

- **MaxMind name ≠ Natural Earth name for ~20 countries.** Same
  caveat as the
  [cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas).
  Common cases: "United States" vs "United States of America",
  "Russia" vs "Russian Federation", "South Korea" vs "Korea,
  Republic of", "Vietnam" vs "Viet Nam". Decide on a canonical
  name and align both sides.

- **The remaining PMTiles + customer-hosted CDN gotchas are
  identical to the
  [csv-lookup-geo/vector-tile-join companion §6](../csv-lookup-geo/vector-tile-join.md#6-gotchas).**
  Specifically: HTTP Range request support (`curl -I -H "Range:
  bytes=0-1023" <url>` must return `206 Partial Content`);
  Splunk Cloud CSP `connect-src 'self'` blocks cross-origin
  fetches (host the PMTiles on the same origin via the app's
  `appserver/static/` folder for air-gap-safe operation, OR get
  the CDN host CSP-allowed, OR use `featureJoinPreset` after
  bundling the tileset); `featureJoinPromoteId` case-
  sensitivity; empty-id rows silently dropped; unmatched-grey
  fallback semantics. Read the CSV companion's §6 once; the
  contract is fully shared.

- **`agent_ip` resolves to the AGENT's network egress point,
  not the agent's true location.** Same caveat as the
  [thousandeyes/choropleth companion §6](./choropleth.md#6-gotchas):
  enterprise agents typically carry the customer's WAN egress
  IP (resolves to the customer's HQ country, even for branch-
  office deployments); cloud agents carry the cloud provider's
  regional IP. For a 50-country multinational with all agents
  routing through 3 corporate Internet uplinks (HQ-US, EMEA-DE,
  APAC-SG), the panel can collapse global coverage into 3
  countries. For physical-location attribution, swap
  `iplocation agent_ip` for a `geom` point-in-polygon using
  `agent_lat`/`agent_lon` (which the agent records at
  registration time) — see the [choropleth companion §6](./choropleth.md#6-gotchas)
  second bullet for the substitution.

- **Cloud-agent attribution distortion.** ThousandEyes cloud
  agents run in AWS / GCP / Azure regions; their `agent_ip`
  resolves to the cloud provider's billing-registered country
  (typically US for AWS, US for Azure, US-or-IE for GCP). A
  20-region cloud-agent deployment can read as "20 agents in
  the US" rather than "20 globally-distributed agents". For a
  cloud-agent-only panel, prefer `agent_region` (the
  ThousandEyes-side region identifier like `aws-us-east-1`)
  parsed into ISO codes via a lookup, rather than `iplocation`.
  Mixed enterprise + cloud panels can split via
  `agent_type` and run two separate choropleths.

- **No OT-safety dependency.** Same posture as all
  thousandeyes companions: ThousandEyes is a digital-
  experience-monitoring platform for IT/web/SaaS reachability;
  no OT carve-out applies. The customer-hosted PMTiles file is
  a static polygon dataset with no operational dependency.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`iplocation`, `dedup`,
`stats`, `lookup`, `eval`, `where`, `rename`, `fields`, `sort`).
The PMTiles fetch + join behaviour is covered by Better Map's
own `featureJoin` module unit tests, but the end-to-end "this
recipe's ThousandEyes agent SPL + a real customer PMTiles
tileset + the `iso_country_codes` lookup renders a per-country
choropleth in a Splunk Dashboard Studio panel" path has not
been dispatched against the v1.7-prep lab tenant in this PR
because (a) non-interactive admin auth is not present in the
agent workspace, (b) the lab tenant does not carry an
`iso_country_codes` lookup populated to the full 250 countries,
and (c) the lab tenant does not carry a registered world-
countries PMTiles URL. A maintainer with REST auth, a populated
`iso_country_codes` lookup, and a small custom PMTiles file
should follow the verification steps in the
[csv-lookup-geo/vector-tile-join companion](../csv-lookup-geo/vector-tile-join.md#verification-status)
(substituting the §2 ThousandEyes SPL for the lookup-source
SPL).
