---
schema_version: 1
id: meraki--extrusion-3d
source:
  id: meraki
  display_name: "Cisco Meraki (devices)"
  pattern: splunk-vendor-ta
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_cisco_meraki"
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
    example: "247"
    drives_formatter_option: extrusionHeightField
  - name: device_count
    type: integer
    example: "247"
  - name: alerting_count
    type: integer
    example: "11"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-device drilldown)"
    path: "docs/recipes/meraki/markers.md"
  - description: "Companion recipe — same source, H3 hexbin layer (per-cell density)"
    path: "docs/recipes/meraki/h3.md"
  - description: "Companion recipe — same source, supercluster layer (zoom-adaptive)"
    path: "docs/recipes/meraki/supercluster.md"
  - description: "Pattern reference — extrusion-3d via iplocation + us-states preset"
    path: "docs/recipes/cim-network-traffic/extrusion-3d.md"
  - description: "Pattern reference — first extrusion-3d recipe (geo-us-states preset)"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "cisco-meraki-ta-setup skill — TA install, indexes, account config, input types"
    path: "~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco Meraki (devices) — US states 3D extrusion

The third-dimension complement to the
[meraki/h3](./h3.md) recipe: where the H3 hexbin renders fleet
density as area-coloured hexagons, this recipe renders fleet
density as **vertical extruded prisms over US-state polygons**.
The right shape for **executive-briefing panels** where a CIO,
sales engineer, or account-planning lead needs an immediate-
read "where does this customer's Meraki footprint live?" view
without interpreting a colour ramp — the height of the
California prism IS the story.

Same `meraki:devices` inventory feed as the
[markers](./markers.md), [heat](./heat.md), [h3](./h3.md), and
[supercluster](./supercluster.md) companions, but aggregated
by US state via `iplocation` on the device's WAN IP and joined
to the bundled `us-states.pmtiles` preset. This is the **2nd
extrusion-3d cell on a non-geo-builtin source** (after the
cim-network-traffic companion in wave 26), and the **8th layer
cell on the meraki source row** — completing markers / heat /
h3 / supercluster / extrusion-3d for Meraki.

## 1. Source description

Same **Cisco Meraki Add-on for Splunk** (`Splunk_TA_cisco_meraki`,
Splunkbase ID 5580) source as the markers / heat / h3 /
supercluster companions — see
[meraki/markers §1](./markers.md#1-source-description) for the
data model background. The relevant distinction for THIS recipe:
instead of rendering one marker per device (or one heat cell, or
one H3 hexagon), the recipe aggregates by US state and renders a
3D extruded prism per state, height-encoded by the device count.

**Why extrusion-3d for Meraki.** A choropleth answers "which
states have devices?" but saturates: California with 247 devices
and Texas with 89 both render as "dark" once they exceed the
top decile, and the rank difference is invisible. Extrusion-3d
preserves rank: California is 2.8x taller than Texas, impossible
to miss. This is the right shape for **executive-briefing
panels** (the geographic distribution IS the panel signal),
**capacity-planning panels** (the visible cliff over CA tells
the operator "we need a regional support team here"), and
**deployment-density panels** (the height-encoded volume tells
the partner "this customer skews 80% US-west").

**Why `iplocation` instead of device `lat`/`lng`.** Meraki
Dashboard stores per-device lat/lng but provides no built-in
state attribution. The cleanest state aggregation uses
`iplocation` on the device's WAN IP (`publicIp` on MX,
`wan1Ip` on MR/MS/MV) which Splunk's bundled MaxMind database
resolves to state. This matches the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
companion's pattern for visual + SPL consistency across the
recipe matrix. For coordinate-level extrusion (NOT
state-aggregated — one prism per device), the H3 companion
with `pointRenderer: "h3"` at high resolution is a closer match.

**Typical sourcetype / index:** `sourcetype="meraki:devices"`,
`index=meraki` (both are the TA defaults; see the markers
companion for the broader catalogue).

## 2. SPL recipe

```spl
index=meraki sourcetype="meraki:devices" earliest=-1h latest=now
| dedup serial sortby - _time
| eval public_ip=coalesce(publicIp, wan1Ip)
| where isnotnull(public_ip)
| iplocation public_ip
| where Country="United States" AND isnotnull(Region)
| eval is_alerting=if(status=="alerting", 1, 0)
| stats count AS device_count,
    sum(is_alerting) AS alerting_count
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
| eval value=device_count
| rename Region AS state_name
| fields id, state_name, value, device_count, alerting_count
| sort - value
```

Why this exact shape, line by line:

- **`index=meraki sourcetype="meraki:devices"`** — TA defaults,
  same as all meraki companions.
- **`earliest=-1h latest=now`** — covers 5-6 polling cycles
  (default 600s). `dedup serial sortby -_time` keeps the
  freshest snapshot per device.
- **`eval public_ip=coalesce(publicIp, wan1Ip)`** — MX security
  appliances carry `publicIp` (the WAN-side public IP).
  MR/MS/MV devices carry `wan1Ip` (their uplink IP, usually
  the upstream MX's public IP). Coalesce handles both. Devices
  with neither (rare — usually pre-onboarding) are filtered
  out by the next `where`.
- **`iplocation public_ip`** — Splunk's built-in MaxMind
  lookup. Produces `Country`, `Region`, `City`, `lat`, `lon`,
  `Continent`. Only `Region` (state name) is used downstream.
- **`where Country="United States" AND isnotnull(Region)`** —
  US-only guard (the bundled `us-states.pmtiles` is the 50
  states + DC, NOT a world-countries preset). Non-US devices
  drop here.
- **`eval is_alerting=if(status=="alerting", 1, 0)`** — 0/1
  flag for the alerting status. Allows the next `stats` to
  SUM it across all devices in the state, producing a per-state
  alerting count for the popup.
- **`stats count AS device_count, sum(is_alerting) AS alerting_count BY Region`** —
  one row per state. `device_count` drives the extrusion
  height; `alerting_count` flows through as a popup attribute
  ("California: 247 devices, 11 alerting").
- **`eval id=upper(case(...))`** — converts state names to
  two-letter codes (the `featureId` / `promoteId` on the
  bundled us-states PMTiles tileset is `stusps`, the USPS
  two-letter code). The full case list mirrors the
  [cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
  companion for cross-recipe consistency. `substr(Region,1,2)`
  fallback handles non-matching strings gracefully — but the
  case list covers all 50 states + DC, so the fallback only
  fires on unexpected `Region` values from `iplocation`.
- **`eval value=device_count`** — explicit assignment. The
  extrusion layer reads `value` (per the
  `drives_formatter_option: extrusionHeightField`); making the
  copy explicit allows the popup to show both the semantic
  field (`device_count`) AND the height-driver field (`value`)
  without overloading either's meaning.
- **`rename Region AS state_name`** — popup-friendly alias.
- **`fields id, state_name, value, device_count, alerting_count`** —
  explicit projection. The PMTiles join will add `state_name`
  back from the tileset (in case the SPL-side rename was
  dropped), so this final projection is the popup's source
  of truth.
- **`sort - value`** — biggest states first. The PMTiles
  layer renders all polygons regardless of order, but a sorted
  result is easier to debug in the search result panel.
- **No `head` cap.** The maximum row count is 51 (50 states +
  DC), well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field          | type    | example     |
|----------------|---------|-------------|
| id             | string  | CA          |
| state_name     | string  | California  |
| value          | integer | 247         |
| device_count   | integer | 247         |
| alerting_count | integer | 11          |

All five fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives `extrusionHeightField`; `state_name`,
`device_count`, `alerting_count` flow through to the popup.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": true,
  "extrusionHeightField": "value",
  "extrusionScale": 8000.0,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — same as the
  [cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
  companion: load the bundled `presets/us-states.pmtiles` (no
  CDN, no add-on, air-gap compatible per ROADMAP §1a).
- **`enable3DExtrusion: true`** — switches the join layer from
  flat polygon fill to extruded prism rendering. Per the
  formatter-schema documentation, "pitch and rotate are already
  enabled by default" — the user can tilt the camera by right-
  dragging to see the 3D as soon as this is on.
- **`extrusionHeightField: "value"`** — points the extrusion
  height to the `value` field. Pinning is explicit and
  survives any future field-name changes.
- **`extrusionScale: 8000.0`** — Meraki device counts are
  typically 1-500 per state (vs CIM Network Traffic's
  1k-1M event range). The scale is proportionally HIGHER
  (8000 vs 12 in the CIM companion) to keep the tallest
  prism at a similar absolute height in metres. For very
  small fleets (<10 devices total nationwide), bump to
  20000 so single-device states show as visible prisms
  instead of flat polygons. For very large fleets (5000+
  devices), drop to 3000 so the tallest state doesn't clip
  the rendering frustum.
- **`enableChoropleth: "true"` + `palette: "viridis"`** —
  additive surface-layer choropleth. Height + colour double-
  encode `value`, giving redundant signal for full-vision
  readers AND a fallback for colour-impaired readers (who
  still get the height encoding). Same accessibility rationale
  as the
  [cim-network-traffic/extrusion-3d §4](../cim-network-traffic/extrusion-3d.md#4-recommended-formatter-config)
  companion.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The 3D extrusion is best demoed with the camera tilted
~35° via right-dragging the on-map camera widget; a flat-top
screenshot loses the entire signal. A maintainer can reproduce
by pasting the SPL into a Dashboard Studio map panel with Better
Map as the visualization, applying the formatter JSON in §4, and
right-dragging the panel to tilt the view._

## 6. Gotchas

- **Devices behind CGNAT all resolve to the carrier's state.**
  MR APs in some SMB / branch-office deployments share a
  single public IP via carrier-grade NAT — every device behind
  that CGNAT resolves to the same state (where the carrier
  registered the IP block). Result: a row of MR APs in
  Wisconsin can all show as Virginia because the carrier's
  IP block is registered there. For branch-office customers,
  prefer the [meraki/markers](./markers.md) recipe (which uses
  device lat/lng directly) and treat this extrusion as a
  rough-cut "where do our devices speak from" visualization
  rather than a definitive deployment map.
- **`extrusionScale: 8000.0` is fleet-size dependent.** Tuned
  for typical mid-size deployments (~200-500 devices). Compute
  for your data: `scale = target_max_height_metres /
  max(device_count)`. For a fleet of 50 devices in CA, scale
  20000 keeps CA visible at ~1000km tall; for a fleet of 5000
  devices in CA, scale 200 keeps CA at ~1000km tall.
- **`Splunk_TA_cisco_meraki` must be installed AND the
  `devices` input enabled.** Same prerequisite as all meraki
  companions; see the [markers](./markers.md#1-source-description)
  recipe for the setup commands.
- **`publicIp` / `wan1Ip` field availability varies by device.**
  MX security appliances always carry `publicIp` (the WAN-side
  IP). MR APs and MS switches sometimes carry `wan1Ip` only
  when they're upstream from a Meraki MX (otherwise their
  upstream IP isn't visible to Dashboard). MV cameras and MT
  sensors typically have neither and drop out at the
  `isnotnull(public_ip)` filter — they're invisible to this
  panel. For a full-fleet extrusion that includes MV/MT, a
  state-derivation strategy other than `iplocation` is needed
  (e.g., a custom `geom_us_states` point-in-polygon lookup on
  device lat/lng — a v1.8 candidate).
- **`iplocation` Region values are sometimes ambiguous.** Major
  US tech-vendor IP blocks are registered to states where the
  vendor HQ lives (CA for AWS / GCP / Apple, WA for Microsoft /
  AWS regions, VA for AWS Virginia region). Meraki devices
  whose WAN IP is in one of these blocks will all resolve to
  the vendor HQ state. Combined with extrusion's visual
  amplification, this can make CA, WA, and VA look 5-10x
  larger than they should. Document the caveat in the
  dashboard's surrounding markdown panel.
- **US-only preset is a hard boundary.** The bundled
  `us-states.pmtiles` covers the 50 states + DC only. Non-US
  Meraki devices are filtered out by the `Country="United
  States"` guard. For multi-country aggregation, ship a custom
  `world-countries` PMTiles preset and swap `Region` → `Country`
  in the SPL — same path as documented in
  [cim-network-traffic/extrusion-3d §6](../cim-network-traffic/extrusion-3d.md#6-gotchas).
- **Pitch / camera tilt UX.** 3D extrusion is only visible
  when the camera is pitched. The `allowPitch` formatter
  option defaults to `true` so the user CAN tilt by
  right-dragging. For dashboards where 3D-readability is the
  primary signal, instruct dashboard readers via a
  `splunk.markdown` panel that they can right-drag to tilt,
  or wait for the v1.8 `initialPitch` formatter option.
- **No OT-safety dependency.** Same posture as all meraki
  companions: Meraki devices are IT networking gear; no OT
  carve-out applies. If your tenant integrates MT sensors
  with an OT-zone monitoring program, route THOSE sensors to
  a dedicated `ot-datastreamer` recipe per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6) and
smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. Verification path mirrors the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
companion's: install `Splunk_TA_cisco_meraki`, populate a
Meraki organization with US-distributed devices, dispatch via
REST, drop into a Dashboard Studio panel with the §4 formatter
JSON, confirm per-state prisms render at sensible heights with
the camera tilted. Promote to `status: verified` + fill in
`verified_against` in a follow-up PR.
