---
schema_version: 1
id: geo-us-states--extrusion-3d
source:
  id: geo-us-states
  display_name: "US states (built-in geo lookup)"
  pattern: splunk-builtin
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required: []
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
    example: "12847"
    drives_formatter_option: extrusionHeightField
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, different layer (choropleth)"
    path: "docs/recipes/geo-us-states/choropleth.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# US states (built-in geo lookup) — 3D extrusion

The third-dimension companion to the
[geo-us-states/choropleth](./choropleth.md) recipe — same SPL,
same `value` aggregation, same `us-states` PMTiles preset, but
the per-state shading is replaced by **per-state vertical
extrusion**. Tall states are busy; short states are quiet. The
right layer when the dashboard reader has to quickly rank states
by an absolute metric — choropleth's colour ramp is good for
ordinal "where is the heat?" but loses precision when ten of the
fifty states are above the 90th percentile (the top of the ramp
saturates). Extrusion preserves rank visibility because
height-encoding has unbounded headroom.

## 1. Source description

Same `us-states` PMTiles vector-tile preset as
[geo-us-states/choropleth](./choropleth.md) — 50 states + DC,
keyed by USPS two-letter `stusps`, bundled with Better Map (no
CDN). The recipe re-uses the choropleth recipe's SPL verbatim;
only the formatter options change to switch from colour-shading
to height-extrusion (and the colour-shading is still available
as a complementary visual signal — see §4).

**Typical sourcetype / index:** any event stream with a `state`
or `Region` field that can be normalized to USPS two-letter. The
recipe uses `_internal` access logs as the canonical example
(same as the choropleth recipe) because every Splunk install has
them — but the more compelling 3D-extrusion use cases are
SLA/SLO violation counts per region, cumulative dollar value
per customer territory, or active incident count per
operations region (where the absolute number — not just the
rank — is the dashboard's primary signal).

## 2. SPL recipe

```spl
index=_internal sourcetype=splunkd_ui_access earliest=-24h latest=now
| iplocation clientip
| where Country="United States" AND isnotnull(Region)
| stats count AS value BY Region
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
    Region=="District of Columbia","DC",
    true(),substr(Region,1,2)))
| rename Region AS state_name
| fields id, state_name, value
| sort - value
```

The SPL is **deliberately identical** to the choropleth recipe
— the only differences live in the formatter config (§4). This
is the recipe matrix's "one source, two layers, two views" demo:
the dashboard author swaps `extrusion-3d` for `choropleth` (or
combines both) without any SPL re-authoring. Why each line is
shaped this way is documented in
[choropleth.md §2](./choropleth.md#2-spl-recipe) — only the
extrusion-specific notes are below.

For 3D extrusion specifically, two more SPL refinements are
worth considering:

- **If your `value` spans orders of magnitude** (e.g. California
  with 50k events, Wyoming with 50), add a log transform so
  small states are visible at all:
  `| eval value=ceil(log10(value+1)*100)`
  This re-scales to a 0-400 range that extrudes legibly without
  drowning small states.
- **If your `value` represents money / units that aren't event
  counts**, the extrusion scale (`extrusionScale` in §4) is the
  multiplier you tune to convert to metres. Defaults to 1.0 (one
  metre per unit). For an SLO percentage 0-100, scale to 5000
  (= 500 km tall at 100 %) for a globe-readable extrusion.

## 3. Expected fields

| field      | type    | example    |
|------------|---------|------------|
| id         | string  | CA         |
| state_name | string  | California |
| value      | integer | 12847      |

Three fields, all of which appear in `expected_fields` in the
frontmatter — `value` ALSO drives the `extrusionHeightField`
formatter option (per the `drives_formatter_option` annotation),
which is what produces the per-state vertical extrusion. The
polygon geometry itself is bundled in the `us-states.pmtiles`
preset — Better Map joins polygon to SPL row on `id`.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": true,
  "extrusionHeightField": "value",
  "extrusionScale": 200.0,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — same as the choropleth
  recipe: load the bundled `presets/us-states.pmtiles` (no CDN,
  no add-on, air-gap compatible per ROADMAP §1a).
- **`enable3DExtrusion: true`** — switches the join layer from
  flat polygon fill to extruded prism rendering. Per the
  formatter-schema documentation, "pitch and rotate are already
  enabled by default" — the user can tilt the camera by right-
  dragging to see the extrusion in 3D as soon as this is on.
- **`extrusionHeightField: "value"`** — points the extrusion
  height to the `value` field from the SPL. Without this
  override the layer would auto-detect — but pinning is
  explicit and survives any future field-name changes.
- **`extrusionScale: 200.0`** — multiplier (per the formatter
  schema: "useful when units are not metres"). For event-count
  data ranging 50-50000, 200.0 makes the tallest state ~10000
  metres tall — visible at globe zoom but not so tall it
  occludes neighbouring states at city zoom. Tune to your
  data: scale = (target_max_metres / max_value).
- **`enableChoropleth: "true"`** combined with
  **`palette: "viridis"`** — the surface-layer choropleth
  shading is ADDITIVE with the extrusion. Height + colour
  encode the same `value`, so reading either dimension answers
  the question. The colour ramp gives quick "this state is
  red" recognition; the height gives precise rank comparison.
  Removing `enableChoropleth` keeps just the extruded prisms
  (more minimal — useful when other layers are competing for
  visual attention).
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

- **Pitch / camera tilt UX.** 3D extrusion is only visible when
  the camera is pitched — at the default top-down camera
  position the extruded prisms look identical to flat
  polygons. The `allowPitch` formatter option defaults to
  `true` so the user CAN tilt, but does NOT auto-tilt on load.
  For dashboards where 3D-readability is the primary signal,
  either (a) instruct dashboard readers via a `splunk.markdown`
  panel that they can right-drag to tilt, or (b) wait for the
  v1.8 `initialPitch` formatter option (currently a v1.8+
  candidate per ROADMAP) to default the camera to a tilted
  view on panel load.
- **`extrusionScale` is dataset-dependent.** A scale of 200.0
  works for event-count data in the 50-50000 range. For other
  data ranges, calculate: `scale = target_max_height_metres /
  max(value)`. Tall-thin extrusions (e.g. SLO % = 99.9 at
  scale 5000 = 500 km tall) look striking but can clip out of
  the MapLibre rendering frustum at low zoom — pitch the
  camera down (or reduce the scale) if states disappear.
- **MAUP — extrusion exaggerates it MORE than choropleth.**
  The choropleth recipe's §6 Gotchas notes that California
  always looks dominant in a per-state aggregation simply
  because it is the largest state geographically. Extrusion
  makes this WORSE: a tall extrusion over a large polygon
  creates a visual "cliff" that draws the eye even harder
  than a saturated colour fill. For area-neutral aggregation
  use H3 hexbin (`pointRenderer: hexbin`) instead — see the
  [netflow-sflow-ipfix/h3](../netflow-sflow-ipfix/h3.md)
  recipe for the pattern.
- **3D performance ceiling.** MapLibre's WebGL2 renderer
  handles 50 + DC extruded prisms trivially. If you scale up
  to a per-county recipe (3000+ polygons), the GPU cost rises
  but stays well under the per-frame budget on a modern
  laptop. For per-zip-code recipes (40000+ polygons), monitor
  per-tile draw-call counts via the MapLibre debug overlay —
  Better Map's hexbin layer is the right tool above 5000+
  features.
- **Colour-blind accessibility.** With `enableChoropleth +
  palette: viridis`, the layer is double-encoded (height +
  colour) — readers with full colour vision get redundant
  signal, readers with deuteranopia / protanopia get the
  height-only signal (still readable). With
  `enableChoropleth: false` the layer is height-only — fully
  accessible to all colour-vision profiles. For high-stakes
  dashboards, prefer the height-only configuration unless
  the dashboard is also being viewed by a non-tilt-capable
  client.
- **No OT safety dependency.** Same posture as the
  [choropleth](./choropleth.md) sibling: this is a per-state
  aggregation, not an asset-level surface, so the
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 4 (never push configuration to PLCs/HMIs/SIS) does
  not apply.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
identical to the verified-pending choropleth sibling and uses
only Splunk built-ins. The formatter options
(`enable3DExtrusion`, `extrusionHeightField`, `extrusionScale`)
are all present in `docs/_machine/formatter-schema.json` and
cross-checked by `scripts/check-formatter-coverage.py`. The
recipe has not been dispatched against the v1.7-prep lab tenant
because non-interactive admin auth is not present in the agent
workspace. A maintainer with REST auth should:

1. Confirm the bundled tileset exists (per the choropleth
   recipe's §verification step 1).
2. Run the recipe SPL and confirm at least one row is returned
   (`_internal/splunkd_ui_access` is present on every Splunk
   install).
3. Apply the formatter JSON in §4 to a Dashboard Studio map
   panel; right-drag the panel to tilt the camera; confirm
   per-state prisms are visible AND scale proportionally to
   `value`.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
