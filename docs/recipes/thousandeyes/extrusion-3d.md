---
schema_version: 1
id: thousandeyes--extrusion-3d
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (agent fleet)"
  pattern: splunk-vendor-ta
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-29"
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
    drives_formatter_option: extrusionHeightField
  - name: agent_count
    type: integer
    example: "47"
  - name: online_count
    type: integer
    example: "44"
  - name: online_ratio
    type: number
    example: "0.94"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, choropleth layer (flat-fill sibling — same SPL, height-free encoding)"
    path: "docs/recipes/thousandeyes/choropleth.md"
  - description: "Companion recipe — same source, vector-tile-join layer (global per-country footprint)"
    path: "docs/recipes/thousandeyes/vector-tile-join.md"
  - description: "Companion recipe — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/thousandeyes/markers.md"
  - description: "Pattern reference — extrusion-3d on CIM Performance (sibling per-state breaching-host height encoding)"
    path: "docs/recipes/cim-performance/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "ThousandEyes setup skill — agent inventory, sourcetypes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco ThousandEyes (agent fleet) — US states 3D extrusion

The third-dimension companion to the
[thousandeyes/choropleth](./choropleth.md) recipe — same agent-fleet
inventory source, same per-state aggregation, same `us-states`
PMTiles preset, but per-state shading is **augmented by per-state
vertical extrusion**. Tall states host more enterprise / cloud
agents; short states host fewer. The right shape for **executive
DEM-coverage briefings where absolute fleet-size rank matters** —
the choropleth's colour ramp saturates once 5+ states exceed the
80th percentile, but extrusion's height has unbounded headroom —
**capacity-planning reviews** where the visual cliff over a
CA / VA / TX-agent-dense state pre-attentively communicates "this
region anchors our DEM coverage", and **CIO regional-investment
reviews** where the 3D prism over the most-instrumented state is
itself the executive talking point.

The **8th extrusion-3d recipe in the matrix** — joining
[geo-us-states](../geo-us-states/extrusion-3d.md),
[cim-network-traffic](../cim-network-traffic/extrusion-3d.md),
[cim-authentication](../cim-authentication/extrusion-3d.md),
[cim-alerts](../cim-alerts/extrusion-3d.md),
[cim-performance](../cim-performance/extrusion-3d.md),
[meraki](../meraki/extrusion-3d.md), and
[splunk-stream](../splunk-stream/extrusion-3d.md). This advances
the extrusion-3d layer column from 7 cells to 8, and brings the
thousandeyes source row from 7 cells to 8 (markers, h3, heat,
supercluster, paths, choropleth, vector-tile-join, plus
extrusion-3d now) — the **second-most-covered source row in the
matrix**, with only `cim-network-traffic` (8 cells) ahead.

## 1. Source description

Same **Cisco ThousandEyes App for Splunk** (`ta_cisco_thousandeyes`,
Splunkbase ID 7719) source as all thousandeyes companions — see
[thousandeyes/markers §1](./markers.md#1-source-description) for
the full platform background and the `cisco:thousandeyes:agents`
sourcetype contract.

The relevant distinction for THIS recipe: the panel renders the
same per-state agent aggregation as the
[choropleth companion](./choropleth.md) but encodes the rank as
**polygon vertical extrusion** in addition to (or instead of)
colour shading. Same `iplocation agent_ip` → `Region` → USPS code
mapping as the choropleth (verbatim) — the only differences live
in the formatter config (§4).

**Why extrusion-3d for ThousandEyes.** A DEM-coverage choropleth
saturates: once California, Virginia, Texas, New York, and
Washington all exceed the 80th percentile of agent counts, the
colour ramp can't distinguish them — they're all "dark viridis".
Extrusion preserves rank visibility because height has unbounded
headroom — California with 47 agents is **5x taller** than a
mid-tier state with 9 agents, and the visual gap is impossible to
miss even when both states are at the saturated end of the colour
ramp. Combined with the additive choropleth (height + colour
encode the same `value` — see §4), the panel becomes double-
encoded: height for absolute fleet-size rank, colour for the
ordinal "where is our DEM coverage concentrated".

The use cases this recipe unlocks beyond the choropleth companion:

- **CIO DEM-strategy reviews** — the 3D prism over the
  most-instrumented state is the focal point of the executive
  conversation; the colour ramp adds the "is this where our
  customers actually are" tension.
- **Sales-engineering coverage RFPs** — the visual cliff over
  CA / VA / TX vs the long-tail states pre-attentively
  communicates "broad coverage" without the prospect having to
  read a state-by-state number table.
- **Capacity-planning reviews** for ThousandEyes seat purchasing —
  the height pre-attentively ranks the top 5 instrumented states,
  supporting "we need 20 more enterprise agents in
  [under-instrumented mid-tier state]" discussions.
- **Compliance / coverage-gap reviews** — pairing the height
  (where we ARE instrumented) with the choropleth COLOUR shaded
  by `online_ratio` (where instrumentation is HEALTHY) gives a
  two-channel "complete view": tall + dark = where we have lots
  of agents that are mostly online; tall + light = lots of
  agents with high offline rate (worth investigating);
  short + dark = sparse but healthy; short + light = sparse and
  unhealthy (high-priority for expansion + remediation).

**Typical sourcetype / index:** `sourcetype="cisco:thousandeyes:agents"`,
`index=thousandeyes_agents` (defaults; see the markers companion
for the broader catalogue).

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
| eval online_ratio=round(online_count*1.0/agent_count, 2)
| eval value=agent_count
| rename Region AS state_name
| fields id, state_name, value, agent_count, online_count, online_ratio
| sort - value
```

Identical to the
[choropleth companion §2](./choropleth.md#2-spl-recipe) — same
`iplocation agent_ip` → `Region` extraction, same USPS mapping —
plus one additional `eval online_ratio` line that the choropleth
companion doesn't carry. The popup-detail `online_ratio` is the
input you'd swap into the `value` slot for an "alerting" framing
(height = total agents, colour = % online, where light = unhealthy)
described in §4 below.

For the **alternative "fleet HEALTH" view** (height = total agents,
colour = unhealthy ratio — the executive answer to "where do I
have lots of agents that aren't reporting?"), the SPL is unchanged;
only the formatter config (§4) and the `value` semantic swap. See
§4 for the dual-encoding pattern.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field         | type    | example     |
|---------------|---------|-------------|
| id            | string  | CA          |
| state_name    | string  | California  |
| value         | integer | 47          |
| agent_count   | integer | 47          |
| online_count  | integer | 44          |
| online_ratio  | number  | 0.94        |

Six fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `value` drives BOTH the
choropleth shading AND the extrusion height
(`extrusionHeightField: "value"` in §4). The popup-detail
`online_count` and `online_ratio` enable the two-channel
visualization described in §1.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": "true",
  "extrusionHeightField": "value",
  "extrusionScale": 50000.0,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this config (the only differences from the
[choropleth companion §4](./choropleth.md#4-recommended-formatter-config)
are the three new `enable3DExtrusion` / `extrusionHeightField` /
`extrusionScale` options):

- **`featureJoinPreset: "us-states"`** — same as the choropleth
  companion. Bundled preset, no CDN, air-gap compatible per
  ROADMAP §1a.
- **`enable3DExtrusion: "true"`** — switches polygon rendering
  from flat-fill to extruded-prism. Without this option, the
  three extrusion options below are silently ignored — the
  panel falls back to choropleth-only behaviour.
- **`extrusionHeightField: "value"`** — the column driving the
  prism's vertical height. Same column drives the choropleth
  fill via the implicit `value` contract, so the panel is
  double-encoded: height + colour both rank agent counts.
- **`extrusionScale: 50000.0`** — the multiplier that converts
  the `value` field's numeric range to meters of polygon height.
  Tunable to fleet size:
  - Small deployment (~25 agents, per-state counts 0-5):
    `200000.0`
  - Mid deployment (~150 agents, per-state counts 1-15):
    `50000.0` (this recipe's default)
  - Large deployment (~500 agents, per-state counts 5-50):
    `15000.0`
  - Very large (~2000+ agents, per-state counts 20-300):
    `3000.0`
  Visual rule of thumb: the tallest state's prism should extend
  ~1/3 the screen height at default 45° camera pitch. Iterate
  in the formatter sidebar until the tallest prism reads as
  "obviously tall" without obscuring its neighbours.
- **`enableChoropleth: "true"`** — keeps the colour shading
  enabled alongside the extrusion (double encoding). To get a
  height-ONLY view (uniform-coloured prisms, height-encoded
  rank), set `"false"`.
- **`palette: "viridis"`** — perceptually-uniform, semantically
  neutral. Same as the choropleth companion.

For the **dual-encoding "fleet HEALTH" view** (height = total
agents, colour = unhealthy fraction — instantly readable as
"where do I have many agents AND a problem?"), make ONE SPL swap:
move the `value` assignment to derive from offline ratio while
keeping the popup as raw counts:

```spl
| eval value=ceil((1 - online_ratio) * 100)
| eval value_height=agent_count
```

Then in the formatter config above, replace
`"extrusionHeightField": "value"` with
`"extrusionHeightField": "value_height"` and switch
`palette: "viridis"` → `palette: "magma"` (warm-colour-equates-with-
attention). The result: each state's prism height ranks fleet
SIZE, while the prism colour shades fleet HEALTH on a green-to-red
ramp. Tall + dark prism = "many agents AND many offline" =
top-priority remediation; tall + light prism = "many agents and
all healthy" = expected coverage hotspot; short + dark prism =
"few agents and a high offline fraction" = small-coverage gap
worth investigation.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by following the
[choropleth companion's §5 walkthrough](./choropleth.md#5-screenshot)
verbatim, then applying the §4 formatter JSON above (instead of
the choropleth companion's flat-fill JSON). The panel should
render per-state extruded prisms whose heights rank states by
agent count, with California, Virginia, and Texas typically the
tallest for enterprise customers; the default camera pitch (45°)
gives the best initial read of relative heights._

## 6. Gotchas

- **`agent_ip` resolves to NETWORK EGRESS, not physical location.**
  Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas) — enterprise
  agents typically carry the customer's WAN egress IP, which can
  cause "30 agents in branch offices but all in ONE state" if the
  network NATs through a single headquarters Internet uplink.
  Extrusion amplifies this distortion visually because the
  concentrated state's prism towers over the rest of the map. For
  physical-location attribution, swap to the `geom geo_us_states
  latitude=agent_lat longitude=agent_lon` substitution path
  described in the choropleth companion's gotchas (requires the
  `Splunk_TA_geo_us_states` add-on).

- **`extrusionScale` requires per-tenant tuning.** Unlike the
  choropleth's colour ramp (which auto-scales to the data range),
  extrusion height is a multiplicative function of raw `value` ×
  `extrusionScale`. A scale tuned for a 25-agent fleet
  (`200000.0`) makes prisms invisible for a 500-agent fleet's
  state counts; a scale tuned for the latter (`15000.0`) makes
  every prism tower above the map for the smaller fleet. See the
  §4 tuning table for the recommended starting scales by fleet
  size, and iterate in the formatter sidebar.

- **Camera angle affects pre-attentive height ranking.** Same
  caveat as the
  [cim-performance/extrusion-3d companion §6](../cim-performance/extrusion-3d.md#6-gotchas):
  the default 45° pitch is the best tradeoff; too low (5-15°)
  and short prisms hide behind tall ones; too high (75-90°) and
  the panel reads as a top-down choropleth with the extrusion
  adding nothing. Lock the panel's initial pitch in
  `mapInitialPitch` (formatter option) to ensure consistent
  executive viewing.

- **Saturation moves from colour to height — but only above the
  visual ceiling.** Same caveat as the
  [cim-performance/extrusion-3d companion §6](../cim-performance/extrusion-3d.md#6-gotchas):
  once a single state's prism reaches the visual ceiling
  (top edge clips the panel's top edge), subsequent rank-rises
  in that state become imperceptible. For a tenant whose
  worst-case state has 10x the agents of the second-worst,
  this manifests as "California's prism touches the ceiling
  regardless of whether it's at 47 agents or 4700". Cap
  `extrusionScale` so the worst-case prism reaches only ~60% of
  the panel height, leaving headroom for further fleet growth.

- **US-only preset is a hard boundary.** Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas): the
  bundled `us-states.pmtiles` covers the 50 states + DC only.
  Non-US ThousandEyes agents are filtered out by the
  `Country="United States"` guard. For **global per-country
  3D extrusion** (the natural fit for a globally-distributed
  DEM platform), use the
  [thousandeyes/vector-tile-join companion](./vector-tile-join.md)
  as the starting point and add `enable3DExtrusion: true` to
  its §4 formatter — the SPL is the per-country aggregation;
  the formatter changes the polygon-rendering mode.

- **`agent_type` filtering for cleaner panels.** Same caveat as
  the [choropleth companion §6](./choropleth.md#6-gotchas):
  the recipe includes ALL agent types (enterprise, cloud,
  endpoint). Cloud agents will tend to concentrate in 3-5 states
  (cloud provider regions); endpoint agents follow the customer's
  employee distribution. Filtering by type (`where
  agent_type="enterprise"`) before the `stats` makes the panel
  semantically cleaner for "enterprise coverage" framing.

- **Dual-encoding requires careful colour-scale interpretation.**
  When using the "fleet HEALTH" variant in §4 (height = count,
  colour = unhealthy ratio), the viewer must mentally decouple
  height from colour. The choropleth-companion's "more is more"
  intuition (tall = high count, dark = high count) breaks: tall
  states might be dark (lots of agents AND lots offline) OR
  light (lots of agents and mostly online). Include a legend
  panel that explicitly labels both encodings ("height = total
  agents per state; colour = % offline").

- **No OT-safety dependency.** Same posture as all
  thousandeyes companions: ThousandEyes is a digital-experience-
  monitoring platform for IT / web / SaaS reachability; no OT
  carve-out applies.

## Verification status

`status: unverified` in the frontmatter — the SPL is essentially
identical to the
[choropleth companion](./choropleth.md) (same `iplocation` +
`Region` + USPS mapping path, plus one additional `online_ratio`
eval). The formatter changes (the three extrusion options) are
covered by Better Map's own `featureJoin` module unit tests for
the extrusion-3d path — proven in the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md),
[cim-performance/extrusion-3d](../cim-performance/extrusion-3d.md),
and
[geo-us-states/extrusion-3d](../geo-us-states/extrusion-3d.md)
companions, all of which use the same `featureJoinPreset:
"us-states"` + `enable3DExtrusion` + `extrusionHeightField:
"value"` contract this recipe uses. A maintainer with a populated
ThousandEyes agent inventory should follow the verification steps
in the
[choropleth companion's §Verification status](./choropleth.md#verification-status)
(substituting this recipe's §4 extrusion formatter for the
choropleth flat-fill formatter), then promote both this recipe
AND the choropleth companion to `status: verified` + fill in
`verified_against` in a follow-up PR.
