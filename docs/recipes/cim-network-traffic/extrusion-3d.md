---
schema_version: 1
id: cim-network-traffic--extrusion-3d
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic (data model)"
  pattern: splunk-cim
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
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
    example: "847291"
    drives_formatter_option: extrusionHeightField
  - name: event_count
    type: integer
    example: "847291"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, choropleth layer (flat fill)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Companion recipe — same source, markers layer"
    path: "docs/recipes/cim-network-traffic/markers.md"
  - description: "Companion recipe — same source, H3 hexbin layer"
    path: "docs/recipes/cim-network-traffic/h3.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "CIM Network Traffic data model reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Network Traffic — US states 3D extrusion

The third-dimension companion to the
[cim-network-traffic/choropleth](./choropleth.md) recipe — same
`tag=network,communicate` data model, same per-state aggregation,
same `us-states` PMTiles preset, but per-state shading is replaced
by **per-state vertical extrusion**. Tall states generate more
traffic; short states generate less. The right shape for
**executive-briefing panels where the absolute traffic delta
between states matters** (choropleth's colour ramp saturates at
the top — extrusion's height-encoding has unbounded headroom),
**capacity-planning panels where height pre-attentively
communicates "this region needs a regional PoP"** without forcing
the reader to interpret a colour legend, and **per-jurisdiction
compliance views** where the visual cliff over CA or NY is
itself the executive talking point.

The CIM Network Traffic source row now has **7 layer cells**
(markers, heat, h3, supercluster, paths, choropleth, plus
extrusion-3d now) — the second-most-covered source row in the
recipe matrix. Extrusion-3d is the FIRST EXTRUDED-POLYGON layer
cell on a non-geo-builtin source — making this the canonical
demo for "you can render any CIM-tagged data as a 3D extruded
choropleth, not just the `geo-us-states` source".

## 1. Source description

Same **CIM Network Traffic** data model as the markers / heat /
h3 / supercluster / paths / choropleth companions — see
[cim-network-traffic/markers §1](./markers.md#1-source-description)
for the data model background. The relevant distinction for
THIS recipe: the panel renders per-state aggregation as a
**height-extruded polygon prism**, not a flat colour-shaded
polygon. Same SPL as the choropleth companion (verbatim) — the
only differences live in the formatter config (§4).

**Why extrusion-3d for CIM Network Traffic.** A choropleth
saturates: once California, Texas, and New York all exceed the
90th percentile of event volume, the colour ramp can't
distinguish them — they're all "dark viridis". Extrusion-3d
preserves rank visibility because height-encoding has unbounded
headroom — California at 847k events is **20x taller** than
Wyoming at 42k events, and the visual gap is impossible to miss.
Combined with the additive choropleth (height + colour encode
the same `value` — see §4), the panel becomes double-encoded:
height for absolute rank, colour for ordinal "where is the heat".

**Typical sourcetype / index:** any sourcetype tagged
`network,communicate` in your CIM tag config — `cisco:asa`,
`pan:traffic`, `aws:cloudwatchlogs:vpcflow`, `cisco:meraki:flow`,
`netflow` (after netflow-sflow-ipfix add-on), etc. See the
[choropleth companion](./choropleth.md#1-source-description) for
the broader catalogue.

**No add-on required beyond Splunk_SA_CIM** for the data model,
and the bundled `us-states.pmtiles` preset for the polygons.
Fully air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
tag=network tag=communicate earliest=-24h latest=now
| iplocation src
| where Country="United States" AND isnotnull(Region)
| stats count AS event_count BY Region
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
| eval value=event_count
| rename Region AS state_name
| fields id, state_name, value, event_count
| sort - value
```

The SPL is **deliberately identical** to the
[choropleth companion](./choropleth.md#2-spl-recipe) — the only
differences live in the formatter config (§4). This is the
recipe matrix's "one CIM source, two polygon-derived layers,
two views" demo: the dashboard author swaps `extrusion-3d` for
`choropleth` (or combines both as the default config does) without
any SPL re-authoring. Why each line is shaped this way is
documented in the
[choropleth companion §2](./choropleth.md#2-spl-recipe) — only
the extrusion-specific notes are below.

For 3D extrusion specifically, two SPL refinements are worth
considering for CIM network-traffic data in particular:

- **If your `value` spans 3+ orders of magnitude** (e.g.
  California with 847k events vs Wyoming with 800 — both
  realistic for inbound-CDN traffic), add a log transform so
  small states are visible at all:
  `| eval value=ceil(log10(event_count+1)*1000)`
  This re-scales to a 0-7000 range that extrudes legibly without
  drowning low-volume states under tall-state shadows. Network
  traffic data has a heavier tail than most metrics — California
  at 1000x Wyoming is realistic, where the
  [geo-us-states/extrusion-3d](../geo-us-states/extrusion-3d.md)
  recipe's `_internal` example tops out around 50x.
- **If filtering on attack signatures** (`tag=ids,attack` instead
  of `tag=network,communicate`) the per-state count drops to
  hundreds or single digits — adjust `extrusionScale` (§4) up
  by 10-100x to keep the tallest prism visible at globe zoom.

## 3. Expected fields

| field       | type    | example   |
|-------------|---------|-----------|
| id          | string  | CA        |
| state_name  | string  | California|
| value       | integer | 847291    |
| event_count | integer | 847291    |

All four fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the `extrusionHeightField` formatter option (per
the `drives_formatter_option` annotation), which is what produces
the per-state vertical extrusion. `event_count` is the popup-
display field carrying the same numeric value semantically
separate from the extrusion-driver — the popup shows "847,291
events" while the prism height comes from `value`.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": true,
  "extrusionHeightField": "value",
  "extrusionScale": 12.0,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — same as the choropleth
  companion: load the bundled `presets/us-states.pmtiles` (no
  CDN, no add-on, air-gap compatible per ROADMAP §1a).
- **`enable3DExtrusion: true`** — switches the join layer from
  flat polygon fill to extruded prism rendering. Per the
  formatter-schema documentation, "pitch and rotate are already
  enabled by default" — the user can tilt the camera by right-
  dragging to see the extrusion in 3D as soon as this is on.
- **`extrusionHeightField: "value"`** — points the extrusion
  height to the `value` field from the SPL. Without this
  override the layer would auto-detect — pinning is explicit
  and survives any future field-name changes.
- **`extrusionScale: 12.0`** — multiplier. For CIM network-
  traffic event-count data in the 1k-1M range (typical 24-hour
  window for a mid-size customer), 12.0 keeps the tallest state
  at ~10000 metres tall: visible at globe zoom but not so tall
  it occludes neighbouring states at city zoom. Tune to your
  data: `scale = (target_max_metres / max(value))`. The
  [geo-us-states/extrusion-3d](../geo-us-states/extrusion-3d.md)
  recipe uses 200.0 because its `_internal` example tops at
  ~50k events; CIM network-traffic typically tops at 5-10x
  higher event counts so the scale comes down proportionally.
- **`enableChoropleth: "true"`** combined with
  **`palette: "viridis"`** — the surface-layer choropleth
  shading is ADDITIVE with the extrusion. Height + colour
  encode the same `value`, so reading either dimension answers
  the question. The colour ramp gives quick "this state is
  dark-purple" recognition; the height gives precise rank
  comparison. Removing `enableChoropleth` keeps just the
  extruded prisms (more minimal — useful when other layers are
  competing for visual attention, or when the dashboard reader
  has full colour vision and the height is sufficient).
- **`state_name` flows through automatically** as a feature
  property on the joined polygon — popups can show the full
  state name without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The 3D extrusion is best demoed with the camera tilted
~35° via the on-map camera widget (which honours
`allowPitch: true`, the formatter-schema default per
[`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json));
a flat-top screenshot loses the entire 3D-extrusion signal. A
maintainer can reproduce by pasting the SPL into a Dashboard
Studio map panel with Better Map as the visualization, applying
the formatter JSON in §4, and right-dragging the panel to tilt
the view._

## 6. Gotchas

- **US-only preset is a hard boundary.** The bundled
  `us-states.pmtiles` is the 50 states + DC. Non-US events from
  `iplocation` are filtered out by the `Country="United States"`
  guard. For global aggregation, ship a custom `world-countries`
  PMTiles tileset, point `featureJoinUrl` at it, and swap the
  `iplocation` `Region` → `Country` field in the SPL — same
  gotcha as the [choropleth companion §6](./choropleth.md#6-gotchas).
- **`extrusionScale` is dataset-dependent.** A scale of 12.0
  works for CIM network-traffic event-count data in the 1k-1M
  range. For other data ranges, calculate: `scale =
  target_max_height_metres / max(value)`. Tall-thin extrusions
  (e.g. a single state with 100M events at scale 12.0 = 1200 km
  tall) can clip out of the MapLibre rendering frustum at low
  zoom — pitch the camera down (or reduce the scale) if states
  disappear.
- **Pitch / camera tilt UX.** 3D extrusion is only visible when
  the camera is pitched. The `allowPitch` formatter option
  defaults to `true` so the user CAN tilt by right-dragging,
  but does NOT auto-tilt on load. For dashboards where 3D-
  readability is the primary signal, either (a) instruct
  dashboard readers via a `splunk.markdown` panel that they can
  right-drag to tilt, or (b) wait for the v1.8 `initialPitch`
  formatter option to default the camera to a tilted view on
  panel load.
- **MAUP — extrusion exaggerates it MORE than choropleth.** The
  [choropleth companion §6](./choropleth.md#6-gotchas) flags
  that California always looks dominant because it's the
  geographically-largest western state with the most public IPs.
  Extrusion makes this WORSE: a tall extrusion over a large
  polygon creates a visual "cliff" that draws the eye even
  harder than a saturated colour fill. For area-neutral
  aggregation use the [H3 hexbin companion](./h3.md) with
  `hexbinResolution: 4-5` (cell area is constant across all
  cells, so a hot cell really means "high density per unit
  area").
- **`iplocation` accuracy varies by IP type.** Splunk's bundled
  MaxMind database resolves US public IPs to state-level with
  ~80-90% accuracy. Hosting-provider IPs (AWS, Azure, GCP,
  Cloudflare) often resolve to where the PROVIDER is
  headquartered (often CA / WA / VA) regardless of which
  datacenter actually served the request. Combined with
  extrusion's visual amplification, the rendered "California
  spike" in your panel may overstate California's true
  traffic share by 30-40%. Document this caveat in the
  dashboard's surrounding markdown.
- **Colour-blind accessibility.** With `enableChoropleth +
  palette: viridis`, the layer is double-encoded (height +
  colour) — readers with full colour vision get redundant
  signal, readers with deuteranopia / protanopia get the
  height-only signal (still readable). With
  `enableChoropleth: false` the layer is height-only — fully
  accessible to all colour-vision profiles. For high-stakes
  executive dashboards, prefer the height-only configuration
  unless the dashboard is also viewed on a non-tilt-capable
  client (mobile, print, screenshot-only review).
- **No OT-safety dependency.** Same posture as the
  [choropleth companion](./choropleth.md#6-gotchas): CIM
  Network Traffic events are IT-network events (firewalls,
  proxies, switches, IPS). No OT carve-out applies.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6) and
smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. SPL is structurally identical to the
[choropleth companion](./choropleth.md) (only formatter options
differ). Verification deferred pending the D5 harness landing.
