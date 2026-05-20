---
schema_version: 1
id: cyber-vision--extrusion-3d
source:
  id: cyber-vision
  display_name: "Cisco Cyber Vision (components + vulnerabilities)"
  pattern: splunk-vendor-ta
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-06-01"
verified_against: null
splunk_apps_required:
  - id: "TA-cisco-cybervision"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "TX"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "Texas"
  - name: value
    type: integer
    example: "12"
    drives_formatter_option: extrusionHeightField
  - name: vulnerable_asset_count
    type: integer
    example: "12"
  - name: total_asset_count
    type: integer
    example: "47"
  - name: vulnerable_ratio
    type: number
    example: "0.26"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, choropleth layer (flat-fill sibling — same SPL, height-free encoding)"
    path: "docs/recipes/cyber-vision/choropleth.md"
  - description: "Companion recipes — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/cyber-vision/markers.md"
  - description: "Pattern reference — extrusion-3d on CIM Performance (sibling US-states preset, additive choropleth+extrusion double-encoding)"
    path: "docs/recipes/cim-performance/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on CIM Alerts (sibling US-states preset, height-encoded SOC metric)"
    path: "docs/recipes/cim-alerts/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "cisco-products skill — Cisco Cyber Vision sourcetypes, components / flows / events / vulnerabilities"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "cisco-splunk-integration skill — Cyber Vision passive DPI, API endpoints, integration patterns"
    path: "~/.cursor/skills/cisco-splunk-integration/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive DPI is the reference design, Rule 1)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco Cyber Vision — US states 3D extrusion

The third-dimension companion to the
[cyber-vision/choropleth](./choropleth.md) recipe — same Cisco
Cyber Vision component + vulnerability rollup, same operator-
maintained `cybervision_sites.csv` lookup chain, same
`us-states` PMTiles preset, but per-state shading is
**augmented by per-state vertical extrusion**. Tall states host
more vulnerable OT assets; short states host less. The right
shape for **OT-SecOps executive briefings where the absolute
vulnerable-asset delta between states matters** (the
choropleth's colour ramp saturates once a few manufacturing-
belt states pass the 80th percentile — extrusion's height has
unbounded headroom), **plant-floor patching capacity-planning
reviews** where the visual cliff over a Texas / Ohio / Michigan
prism pre-attentively communicates "this plant region needs the
next firmware refresh", and **NERC CIP / IEC 62443 per-
jurisdiction compliance posture views** (per-state vulnerable
OT asset count as the proxy for "which BES-cyber-system regions
have the largest exposure backlog").

The **8th extrusion-3d recipe in the matrix** — joining
[geo-us-states](../geo-us-states/extrusion-3d.md),
[cim-network-traffic](../cim-network-traffic/extrusion-3d.md),
[cim-authentication](../cim-authentication/extrusion-3d.md),
[cim-alerts](../cim-alerts/extrusion-3d.md),
[cim-performance](../cim-performance/extrusion-3d.md),
[meraki](../meraki/extrusion-3d.md), and
[splunk-stream](../splunk-stream/extrusion-3d.md). This advances
the extrusion-3d layer column from 7 cells to 8, and brings the
cyber-vision source row from 6 cells to 7 (markers, h3, heat,
supercluster, paths, choropleth, plus extrusion-3d now). The
recipe is the **first OT-safety-relevant 3D-extrusion in the
matrix** — the metric being extruded is `safety_related=Y`-marked
OT asset exposure, with the full
[`~/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
contract applied to the input data (passive-DPI-only collection
via Cyber Vision, no active probing of the OT zone, read-only
mirror of the customer SRS for safety-classification annotations).

## 1. Source description

Same **Cisco Cyber Vision** passive-DPI platform as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), [paths](./paths.md), and
[choropleth](./choropleth.md) companions — see
[cyber-vision/markers §1](./markers.md#1-source-description)
for the full platform background, the four sourcetype streams
(`cisco:cybervision:components` / `:flows` / `:events` /
`:vulnerabilities`), and the OT-safety boundary (Rule 1: Cyber
Vision is the reference passive-DPI design; this recipe
consumes its already-passive metadata stream).

The relevant distinction for THIS recipe: the panel renders the
same per-state vulnerable-asset aggregation as the
[choropleth companion](./choropleth.md) but encodes the rank as
**polygon vertical extrusion** in addition to (or instead of)
colour shading. Same SPL as the choropleth companion (verbatim) —
the only differences live in the formatter config (§4).

**Why extrusion-3d for Cyber Vision.** A choropleth saturates
fast: once Texas, Ohio, Michigan, Indiana, and Pennsylvania all
exceed the 80th percentile of vulnerable-OT-asset counts, the
magma colour ramp can't distinguish them — they're all "dark
magma". Extrusion-3d preserves rank visibility because height-
encoding has unbounded headroom — Texas with 47 vulnerable
assets is **4× taller** than Iowa with 12 vulnerable assets, and
the visual gap is impossible to miss even when both states are
at the saturated end of the colour ramp. Combined with the
additive choropleth (height + colour encode the same `value`
— see §4), the panel becomes double-encoded: height for absolute
rank, colour for severity tint. The OT-SecOps handoff at shift
change reads off the panel in under 5 seconds — the tallest
prism over the most saturated colour identifies the highest-
priority plant region without forcing the on-call to interpret
a numeric legend.

The use cases this recipe unlocks beyond the choropleth companion:

- **Plant-floor firmware-budget reviews** — the 3D prism over
  the most-pressured plant region is the focal point of the OT-
  engineering conversation; the colour ramp adds the "is this
  exposure trending up vs the prior 24 h" signal as a secondary
  visual cue (rerun with `earliest=-48h` for the trend
  comparison).
- **Multi-state OT capacity-planning views** — height pre-
  attentively ranks the top 5 plant-region states even when
  their colour-ramp positions saturate, supporting "we need a
  patching crew on-site in Ohio next" discussions without
  forcing the reader to interpret a colour legend.
- **Per-jurisdiction OT-compliance posture views** — the visual
  cliff over a high-exposure manufacturing state serves as the
  executive talking point for NERC CIP audit prep or IEC 62443
  zone-conduit reviews.

**Typical sourcetype / index:** Same as the
[markers companion §1](./markers.md#1-source-description) —
`index=cybervision`, sourcetype-prefixed `cisco:cybervision:*`.
The TA is `TA-cisco-cybervision`. The site lookup is operator-
maintained (no automated way to derive plant-floor coordinates
from Cyber Vision metadata) and MUST be extended with `lat` /
`lon` columns per the
[markers companion §6 Gotchas](./markers.md#6-gotchas) site
lookup schema.

**No add-on required beyond `TA-cisco-cybervision`** for the
Cyber Vision data and Splunk Core's bundled `geo_us_states`
geometry lookup for the point-in-polygon step. Fully air-gap
compatible per ROADMAP §1a.

## 2. SPL recipe

Identical to the
[choropleth companion §2](./choropleth.md#2-spl-recipe) — same
components + vulnerabilities subsearch chain, same per-asset
`max_cvss` rollup, same site-lookup-derived lat/lon, same
`geom geo_us_states` point-in-polygon, same per-state
aggregation, same `value=vulnerable_asset_count` projection:

```spl
index=cybervision sourcetype="cisco:cybervision:components" earliest=-24h latest=now
| dedup asset_id sortby - _time
| rename asset_id AS id
| join type=left id [
    search index=cybervision sourcetype="cisco:cybervision:vulnerabilities" earliest=-24h latest=now
    | stats max(cvss_score) AS max_cvss BY asset_id
    | rename asset_id AS id
  ]
| fillnull value=0 max_cvss
| eval is_vulnerable=if(max_cvss >= 7.0, 1, 0)
| lookup cybervision_sites.csv asset_id AS id OUTPUT lat, lon, safety_related, site_name
| where isnotnull(lat) AND isnotnull(lon)
| geom geo_us_states featureIdField="stusps" latitude=lat longitude=lon
| where isnotnull(featureId)
| stats sum(is_vulnerable) AS vulnerable_asset_count,
    count AS total_asset_count,
    values(state_name) AS state_name
  BY featureId
| eval vulnerable_ratio=round(vulnerable_asset_count / total_asset_count, 2)
| eval value=vulnerable_asset_count
| rename featureId AS id
| fields id, state_name, value, vulnerable_asset_count, total_asset_count, vulnerable_ratio
| sort - value
```

See the
[choropleth companion §2](./choropleth.md#2-spl-recipe) for the
line-by-line walkthrough of every stage — the per-stage
rationale (CVSS-≥-7 NIST-High threshold semantics, site-lookup
schema for the lat/lon + safety_related + site_name OUTPUT,
`isnotnull(featureId)` US-only filter, ratio-variant alternative
for fleet-size-normalised views) is identical between the two
recipes.

For an **alternative height encoding**: swap
`eval value=vulnerable_asset_count` to `eval value=ceil(
vulnerable_ratio * 100)` to get height = "% of state fleet
vulnerable" instead of height = "absolute vulnerable count".
Visually, the RATIO variant prevents the manufacturing-belt
states (TX, OH, MI, IN, PA) from always dominating — a small
state where 80% of its OT fleet is vulnerable will tower over
a large manufacturing state with 20% fleet vulnerable, even
though the latter has more absolute vulnerable assets. Same
SPL change, same formatter config below.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field                    | type    | example     |
|--------------------------|---------|-------------|
| id                       | string  | TX          |
| state_name               | string  | Texas       |
| value                    | integer | 12          |
| vulnerable_asset_count   | integer | 12          |
| total_asset_count        | integer | 47          |
| vulnerable_ratio         | number  | 0.26        |

Identical to the
[choropleth companion §3](./choropleth.md#3-expected-fields)
— same six fields, same role contract. `value` now drives BOTH
the choropleth shading AND the extrusion height
(`extrusionHeightField: "value"` in §4 below).

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": "true",
  "extrusionHeightField": "value",
  "extrusionScale": 50000.0,
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why this config (the only differences from the
[choropleth companion §4](./choropleth.md#4-recommended-formatter-config)
are the three new `enable3DExtrusion` / `extrusionHeightField` /
`extrusionScale` options):

- **`featureJoinPreset: "us-states"`** — same as the choropleth
  companion. Bundled preset, no CDN, air-gap compatible per
  ROADMAP §1a.
- **`enable3DExtrusion: "true"`** — switches the polygon
  rendering from flat-fill to extruded-prism. Without this
  option set, `extrusionHeightField` and `extrusionScale` are
  silently ignored — the panel falls back to choropleth-only
  behaviour.
- **`extrusionHeightField: "value"`** — the column that drives
  the prism's vertical height. Same column drives the
  choropleth fill via the implicit `value` contract, so the
  panel is double-encoded: height + colour both rank vulnerable-
  asset counts.
- **`extrusionScale: 50000.0`** — the multiplier that converts
  the `value` field's numeric range to meters of polygon
  height. OT vulnerable-asset counts per 24 h on a typical
  mid-size manufacturer span 5-100 vulnerable assets per
  state (about 100× lower than CIM Alerts event counts in the
  same window, which justifies a ~100× larger scale than the
  cim-alerts companion's `500.0`). Tunable to the fleet's
  expected vulnerability distribution:
  - Single-site operator (~50 OT assets, vulnerable counts
    0-5): `200000.0`
  - Multi-site mid-size (~500 OT assets, vulnerable counts
    5-30): `50000.0` (this recipe's default)
  - Multi-site large (~5000 OT assets, vulnerable counts
    30-300): `10000.0`
  - Hyperscale industrial (~50000 OT assets, vulnerable counts
    100-3000): `1000.0`
  Visual rule of thumb: the tallest state's prism should
  extend ~1/3 the screen height when the panel is sized to
  fill the dashboard at 30° camera pitch. Iterate the scale
  in the formatter sidebar until the tallest prism reads as
  "obviously tall" without obscuring its neighbours.
- **`enableChoropleth: "true"`** — keeps the colour shading
  enabled alongside the extrusion (double encoding). To get a
  height-ONLY view (uniform-coloured prisms, height-encoded
  rank), set `enableChoropleth: "false"`. The double-encoded
  view is recommended because it preserves the choropleth
  companion's "which plant regions need urgent patching"
  answer on smaller-exposure states whose extrusion is too
  short to pre-attentively register.
- **`palette: "magma"`** — same as the choropleth companion's
  attention-framed default. Warm-colour-equates-with-attention.
  For an executive-briefing view where magma red is too
  alarming, swap to `viridis` (the neutral perceptually-
  uniform default).

For a **RATIO-based view** (height = percent of OT fleet
vulnerable), make the §2 SPL swap (`eval value=ceil(
vulnerable_ratio * 100)`) AND reduce `extrusionScale` to
`10000.0` (since ratio values are in 0-100, not 1-1000 like
absolute counts). The recipe-level tweak preserves the entire
formatter contract.

For a **NERC-CIP-framed view** (where the question is "which
states have BES-cyber-system OT assets with high-CVSS exposure"
rather than "all OT assets"), add a `where safety_related="N"
OR is_BES_cyber_system="Y"` filter to the SPL after the site
lookup. Same extension as the
[choropleth companion §4](./choropleth.md#4-recommended-formatter-config)
documents — applies identically to the extrusion variant.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). For
OT recipes specifically, the deferred verification path is to
dispatch against a customer pilot tenant (E4) under a
non-production Cyber Vision sensor rather than a synthetic
generator — the same posture as the
[markers companion §5](./markers.md#5-screenshot) and the
[choropleth companion §5](./choropleth.md#5-screenshot). The
3D extrusion is best demoed with the camera tilted ~35° via the
on-map camera widget (which honours `allowPitch: true`, the
formatter-schema default per
[`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json));
a flat-top screenshot loses the entire 3D-extrusion signal. A
maintainer can reproduce by following the
[choropleth companion's §5 walkthrough](./choropleth.md#5-screenshot)
verbatim, then applying the §4 formatter JSON above (instead of
the choropleth companion's flat-fill JSON). The panel should
render per-state extruded prisms whose heights rank states by
vulnerable-OT-asset count, with manufacturing-belt states (TX,
OH, MI, IN, PA) typically the tallest if the customer's OT
firmware backlog is high._

## 6. Gotchas

- **OT safety — passive DPI is the REFERENCE DESIGN (Rule 1).**
  Same posture as the
  [markers companion §6](./markers.md#6-gotchas) and the
  [choropleth companion §6](./choropleth.md#6-gotchas): Cyber
  Vision is explicitly named in
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 as the reference design for passive OT collection.
  This recipe consumes Cyber Vision's already-passive metadata
  stream — it does NOT itself probe the OT zone. Every
  `vulnerable_asset_count` value is derived from Cisco-validated
  passive DPI.

- **OT safety — every asset row is read-only mirrored from the
  customer SRS (Rule 5).** Same posture as the markers /
  choropleth companions: the `safety_related` column in
  `cybervision_sites.csv` is a read-only copy of the customer-
  supplied SIS-asset register, NEVER authored by VISTA. If the
  Safety Annex is missing for any `safety_related=Y` row, STOP
  and get the customer's OT engineering team to author the SRS
  first.

- **OT safety — SOAR action scope (Rule 3).** Same posture as
  the markers / choropleth companions: any SOAR playbook
  triggered by THIS panel must keep its containment actions in
  the IT zone. Notify the OT operator; do NOT auto-issue any
  firmware push, any ACL change, or any patch command to the
  OT assets themselves.

- **`cybervision_sites.csv` MUST be extended with lat/lon.**
  Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas): the
  markers companion documents the canonical schema (asset_id,
  lat, lon, zone_purdue_level, safety_related, site_name); the
  lat/lon columns are OPERATOR-MAINTAINED.

- **`geom geo_us_states` requires the bundled geometry lookup.**
  Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas) — confirm
  via `| inputlookup geo_us_states | head 1`; three substitution
  paths if absent.

- **`extrusionScale` requires per-tenant tuning.** Unlike the
  choropleth's colour ramp, which auto-scales to the data range,
  extrusion height is a multiplicative function of the raw
  `value` × `extrusionScale`. A scale tuned for a single-site
  manufacturer (`200000.0`) makes prisms tower above the map
  for a multi-site large operator (whose tallest state has 300+
  vulnerable assets); a scale tuned for the latter (`10000.0`)
  makes the prisms invisible for the single-site operator. See
  the §4 tuning table for the recommended starting scales by
  fleet size, and iterate in the formatter sidebar.

- **Camera angle affects pre-attentive height ranking.** Same
  caveat as the
  [cim-performance/extrusion-3d §6](../cim-performance/extrusion-3d.md#6-gotchas):
  the default 45° pitch is the best tradeoff; lock the panel's
  initial pitch in `mapInitialPitch` (formatter option) to
  ensure consistent executive viewing — different camera angles
  can flip which state visually "wins" on first glance.

- **Saturation moves from colour to height — but only above the
  visual ceiling.** Once a single state's prism reaches the
  visual ceiling (its top edge clips against the panel's top
  edge), subsequent rank-rises in that state become
  imperceptible. For a customer whose worst-case state has 10×
  the vulnerable assets of the second-worst, this manifests as
  "Texas's prism touches the ceiling regardless of whether it's
  at 50 vulnerable assets or 5,000". Two mitigations: (a) cap
  `extrusionScale` so the worst-case state's prism reaches only
  ~60% of the panel height, leaving headroom for further growth;
  or (b) display the `value` as a number in the popup so the
  operator can read the exact figure even when the prism
  saturates.

- **CVSS threshold semantics.** Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas): the
  `>= 7.0` threshold matches NIST CVSS v3.x "High" severity.
  CVSS v2 used a different scale; tenants with legacy CVE
  feeds may have v2 scores in the `cvss_score` field that
  don't align with v3 semantics. See the choropleth companion
  for the v2→v3 normalization pattern.

- **State-area bias (MAUP).** Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas): the
  manufacturing-belt states (TX, OH, MI, IN, PA, CA) host the
  largest OT footprints by absolute count. Extrusion makes this
  WORSE than choropleth — a tall extrusion over a large polygon
  creates a visual "cliff" that draws the eye even harder than
  a saturated colour fill. For a fleet-size-normalised view,
  swap to the RATIO variant (`eval value=ceil(vulnerable_ratio
  * 100)` per §2).

- **24 h time-range alignment.** Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas): hard-
  coded `earliest=-24h latest=now` for both subsearches; Cyber
  Vision's vulnerabilities stream re-publishes whenever NVD adds
  a new CVE that matches an inventoried asset.

- **PII / GDPR posture.** Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas): asset
  names embed plant-floor semantics regulated in some
  jurisdictions; restrict via Splunk RBAC on the `cybervision`
  index.

## Verification status

`status: unverified` in the frontmatter — the SPL is identical
to the
[choropleth companion](./choropleth.md), which itself has not
been dispatched against the v1.7-prep lab tenant for the
reasons documented in
[its §Verification status](./choropleth.md#verification-status)
(the lab has no Cyber Vision Center; OT-safety-relevant recipes
should be verified against a customer pilot tenant E4 with real
operator-curated annotations per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract). The formatter changes (the three
extrusion options) are covered by Better Map's own `featureJoin`
module unit tests for the extrusion-3d path — proven in the
[cim-performance/extrusion-3d](../cim-performance/extrusion-3d.md),
[cim-alerts/extrusion-3d](../cim-alerts/extrusion-3d.md), and
[geo-us-states/extrusion-3d](../geo-us-states/extrusion-3d.md)
companions, all of which use the same `featureJoinPreset:
"us-states"` + `enable3DExtrusion` + `extrusionHeightField:
"value"` contract this recipe uses. A maintainer with REST
auth to a tenant carrying `TA-cisco-cybervision` AND a populated
`cybervision_sites.csv` (with lat/lon extended) should follow
the
[choropleth companion's §Verification status](./choropleth.md#verification-status)
verification steps (substituting this recipe's §4 extrusion
formatter for the choropleth companion's flat-fill formatter),
then promote both this recipe AND the choropleth companion to
`status: verified` + fill in `verified_against` in a follow-up
PR.
