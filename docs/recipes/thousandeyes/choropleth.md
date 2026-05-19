---
schema_version: 1
id: thousandeyes--choropleth
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (agent fleet)"
  pattern: splunk-vendor-ta
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: "ta_cisco_thousandeyes"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "CA"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "California"
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
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-agent drilldown)"
    path: "docs/recipes/thousandeyes/markers.md"
  - description: "Companion recipe — same source, paths layer (hop-by-hop traceroute polylines)"
    path: "docs/recipes/thousandeyes/paths.md"
  - description: "Companion recipe — same source, H3 hexbin (fleet density)"
    path: "docs/recipes/thousandeyes/h3.md"
  - description: "Companion recipe — same source, heatmap (smoothed density)"
    path: "docs/recipes/thousandeyes/heat.md"
  - description: "Companion recipe — same source, supercluster (zoom-adaptive)"
    path: "docs/recipes/thousandeyes/supercluster.md"
  - description: "Pattern reference — first choropleth recipe (geo-us-states)"
    path: "docs/recipes/geo-us-states/choropleth.md"
  - description: "Pattern reference — choropleth via iplocation + us-states preset"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "ThousandEyes setup skill — agent inventory, sourcetypes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enableChoropleth, featureJoinPreset, palette"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco ThousandEyes (agent fleet) — US states choropleth

Aggregate the ThousandEyes enterprise + cloud agent fleet by US
state and render as a **flat-fill choropleth** over the bundled
`us-states.pmtiles` preset. The right shape for **executive
DEM-coverage panels** where a leadership reviewer needs an
immediate "is my measurement coverage uniform across the US?"
read without per-agent detail — colour-saturated states are
well-covered, light states are under-covered, blanks are
uncovered entirely.

The **3rd choropleth recipe in the matrix** (joining cim-
network-traffic/choropleth and geo-us-states/choropleth) — this
is the milestone that takes the choropleth layer **OUT of
singleton-trap status** (was 2 sources, now 3), demonstrating
that the polygon-join pattern composes naturally with the
ThousandEyes vendor-TA source. Same `cisco:thousandeyes:agents`
inventory feed as the
[markers](./markers.md), [h3](./h3.md),
[heat](./heat.md), and [supercluster](./supercluster.md)
companions; aggregation grain is **per-state** rather than
per-agent.

## 1. Source description

Same **Cisco ThousandEyes App for Splunk**
(`ta_cisco_thousandeyes`, Splunkbase ID 7719) source as all
thousandeyes companions — see
[thousandeyes/markers §1](./markers.md#1-source-description)
for the full platform background and the `cisco:thousandeyes:agents`
sourcetype contract.

The relevant distinction for THIS recipe: instead of rendering
one marker per agent, the recipe aggregates by US state (via
`iplocation` on `agent_ip` since `agent_lat`/`agent_lon` are
not natively state-attributed) and renders one polygon fill
per state coloured by agent density.

**Why choropleth for ThousandEyes.** A markers panel shows
WHERE individual agents live; a heat or H3 panel shows their
density grain-by-grain. But neither directly answers the
**leadership-coverage question**: "across the 50 US states,
which ones have ≥1 enterprise agent and which are blind?"
A choropleth solves this in one panel: states with ≥1 agent
get coloured, states with zero are blank (or rendered in the
neutral base-polygon colour). This is the right shape for
**DEM-strategy panels** (CIO asks "where's our coverage
gap?"), **sales-engineering RFPs** (proving multi-state
measurement reach), and **regional account-planning views**
(per-state agent count is the proxy for "depth of coverage in
this customer's footprint").

**Why `iplocation` and not `agent_lat`/`agent_lon` directly.**
ThousandEyes agents have lat/lon but no native state
attribution. The cleanest state aggregation reuses Splunk's
bundled `iplocation` on the agent's public IP (`agent_ip` from
the agent inventory record) — same pattern as
[cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
and [meraki/extrusion-3d](../meraki/extrusion-3d.md). For a
point-level extrusion-3d view (one prism per agent location),
the
[H3 hexbin companion](./h3.md) at high resolution is closer.

**Typical sourcetype / index:** `sourcetype="cisco:thousandeyes:agents"`,
`index=thousandeyes_agents` (defaults; see the markers
companion for the broader catalogue).

## 2. SPL recipe

```spl
index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents" earliest=-24h latest=now
| dedup agent_id sortby - _time
| where isnotnull(agent_ip)
| iplocation agent_ip
| where Country="United States" AND isnotnull(Region)
| eval is_online=if(is_online="true", 1, 0)
| stats count AS agent_count,
    sum(is_online) AS online_count
  BY Region
| eval id=upper(case(
    Region=="California","CA",
    Region=="New York","NY",
    Region=="Texas","TX",
    Region=="Washington","WA",
    Region=="Illinois","IL",
    Region=="Florida","FL",
    Region=="Massachusetts","MA",
    Region=="Virginia","VA",
    Region=="Colorado","CO",
    Region=="Oregon","OR",
    Region=="Pennsylvania","PA",
    Region=="New Jersey","NJ",
    Region=="Georgia","GA",
    Region=="North Carolina","NC",
    Region=="Ohio","OH",
    Region=="Michigan","MI",
    Region=="Arizona","AZ",
    Region=="Minnesota","MN",
    Region=="Indiana","IN",
    Region=="Tennessee","TN",
    Region=="District of Columbia","DC",
    true(),substr(Region,1,2)))
| eval value=agent_count
| rename Region AS state_name
| fields id, state_name, value, agent_count, online_count
| sort - value
```

Why this exact shape, line by line:

- **`index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents"`** —
  TA defaults, same as all thousandeyes companions.
- **`earliest=-24h latest=now`** — agent inventory polls hourly
  by default; 24h covers ≥24 polls per agent. `dedup agent_id
  sortby -_time` keeps the freshest snapshot per agent.
- **`where isnotnull(agent_ip)`** — defensive guard. Some
  endpoint agents (browser-extension installs) don't publish
  a stable `agent_ip` — they'd drop here and be invisible
  on the panel.
- **`iplocation agent_ip`** — Splunk's bundled MaxMind lookup
  populates `Country`, `Region`, `lat`, `lon`. Only `Region`
  (state name) is used downstream.
- **`where Country="United States" AND isnotnull(Region)`** —
  US-only guard. The bundled `us-states.pmtiles` is the 50
  states + DC; non-US agents drop here. For global
  aggregation, see §6 Gotchas for the `featureJoinUrl`
  + world-countries PMTiles path.
- **`eval is_online=if(is_online="true", 1, 0)`** — 0/1 flag
  for the next `stats` to SUM. Produces a per-state count of
  online vs total agents in the popup.
- **`stats count AS agent_count, sum(is_online) AS online_count BY Region`** —
  one row per state. `agent_count` drives the colour fill;
  `online_count` flows to the popup.
- **`eval id=upper(case(...))`** — same `Region` → USPS two-
  letter code mapping as the
  [cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
  and [meraki/extrusion-3d](../meraki/extrusion-3d.md)
  companions. The `featureId` / `promoteId` on the bundled
  us-states PMTiles is `stusps` (two-letter USPS code).
- **`eval value=agent_count`** — explicit copy. The
  choropleth layer reads `value` per the formatter contract;
  the popup shows both `agent_count` (semantic) and `value`
  (technical) without overloading.
- **`rename Region AS state_name`** — popup-friendly alias
  for the full state name (the PMTiles tileset also carries
  the state name, but the SPL-side rename is the
  authoritative source).
- **`fields id, state_name, value, agent_count, online_count`** —
  explicit projection.
- **`sort - value`** — biggest states first. The choropleth
  layer renders all polygons regardless of order, but a sorted
  result is easier to debug in the search panel.
- **No `head` cap.** Maximum row count is 51 (50 states +
  DC), well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field        | type    | example     |
|--------------|---------|-------------|
| id           | string  | CA          |
| state_name   | string  | California  |
| value        | integer | 47          |
| agent_count  | integer | 47          |
| online_count | integer | 44          |

All five fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the choropleth colour; `state_name`,
`agent_count`, `online_count` flow through to the popup.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this minimal config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). Same preset as the two existing
  choropleth recipes.
- **`enableChoropleth: "true"`** — switches the join layer
  from neutral polygon outline to colour-graded fill. The
  string `"true"` is the formatter contract (per the schema —
  some formatter options accept string-form booleans for
  legacy compatibility); future v1.8 may accept boolean
  `true` directly.
- **`palette: "viridis"`** — perceptually-uniform sequential
  ramp. Viridis is the accessibility-default per the
  formatter schema — visible across all colour-vision
  profiles and prints legibly in grayscale (which matters
  for hard-copy executive briefings). For a sequential "blue
  is good, red is bad" alternative, swap to `RdYlBu`
  (reversed) when the colour direction encodes severity
  rather than quantity.

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
§3 D5). A maintainer can reproduce by pasting the SPL into a
Dashboard Studio map panel with Better Map as the visualization,
applying the formatter JSON in §4. The right demo data: a
ThousandEyes deployment with enterprise agents distributed across
≥10 US states (the standard "global enterprise" reference
deployment), so the choropleth shows a clear distribution
gradient rather than a single saturated state._

## 6. Gotchas

- **`agent_ip` resolves to the AGENT's network egress point,
  not the agent's true location.** Enterprise agents typically
  carry the customer's WAN egress IP — which `iplocation`
  resolves to the customer's HQ state, even if the agent is
  physically deployed in a branch office in a different state.
  Cloud agents (running in AWS / GCP / Azure regions) carry
  the cloud provider's regional IP — which resolves to the
  region's billing-registered state (often US-East-1 → VA,
  US-West-1 → CA). Result: a global enterprise with 30
  branch-office agents all routing through one HQ Internet
  uplink will show as 30 agents in ONE state. Combined with
  the choropleth's colour saturation, the panel can overstate
  state-level coverage concentration.
- **`agent_lat`/`agent_lon` is an ALTERNATIVE attribution
  path that the recipe deliberately ignores.** The agent
  record carries customer-set lat/lon at registration time,
  which DOES reflect the agent's true physical location
  (e.g., "Branch Office 12, Topeka, KS"). For
  physical-coverage reporting (vs. egress-IP coverage), swap
  the `iplocation agent_ip` line for a `| geom geo_us_states
  featureIdField="stusps" latitude=agent_lat longitude=agent_lon`
  point-in-polygon (requires the `Splunk_TA_geo_us_states`
  add-on OR equivalent). The default recipe uses
  `iplocation` because the dependency is zero (Splunk
  bundles MaxMind); the geom alternative is the right
  choice for customers with the add-on installed.
- **US-only preset is a hard boundary.** The bundled
  `us-states.pmtiles` covers the 50 states + DC only. Non-US
  ThousandEyes agents (the cloud agents in EU / APAC / LATAM
  regions, the enterprise agents in customer-owned non-US
  offices) are filtered out by the `Country="United States"`
  guard. For **global per-country aggregation** (which is the
  more natural fit for a global DEM platform like
  ThousandEyes), ship a custom `world-countries.pmtiles`
  preset, swap `featureJoinPreset: "us-states"` →
  `featureJoinUrl: "/path/to/world-countries.pmtiles"`, and
  change the SPL to aggregate `BY Country` with `id=upper(...)`
  mapping country names to ISO-3166-alpha-2 codes.
- **Choropleth saturates on dense fleets.** A 500-agent fleet
  evenly distributed across 50 states gives ~10 agents per
  state; the colour ramp can distinguish CA (47), TX (23),
  NY (18), WA (15), and the rest of the long tail as "light".
  But a 2000-agent fleet with 800 in CA, 300 in TX, 200 in
  NY makes CA, TX, NY all "dark" in the top decile and
  visually equivalent — even though the actual gap is 800 vs
  300 vs 200. For this case, use the
  [extrusion-3d alternative](#) (height has unbounded
  headroom) OR add a log transform to the SPL
  (`eval value=ceil(log10(agent_count+1)*10)`).
- **`Splunk_TA_geo_us_states` is NOT required for this
  recipe.** The recipe uses `iplocation` (bundled). The
  alternative `geom + geo_us_states` lookup path documented
  above in the second gotcha DOES require that add-on. If
  your install has it, the geom path is more accurate for
  the agent-physical-location use case.
- **`agent_type` filtering for cleaner panels.** The recipe
  includes ALL agent types (enterprise, cloud, endpoint). For
  an "enterprise coverage" panel only, add
  `where agent_type="enterprise"` before the `stats`. Cloud
  agents will tend to concentrate in 3-5 states (cloud
  provider regions); endpoint agents follow the customer's
  employee distribution. Filtering by type makes the panel
  semantically cleaner.
- **No OT-safety dependency.** Same posture as all
  thousandeyes companions: ThousandEyes is a digital-
  experience-monitoring platform for IT/web/SaaS reachability;
  no OT carve-out applies.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6) and
smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. Verification path mirrors the
[cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
companion's: install `ta_cisco_thousandeyes`, complete OAuth +
account setup, populate the inventory with US-distributed
agents, dispatch via REST, drop into a Dashboard Studio panel
with the §4 formatter JSON, confirm per-state polygon fills
render with sensible colour gradients. Promote to
`status: verified` + fill in `verified_against` in a follow-up
PR.
