---
schema_version: 1
id: cim-performance--extrusion-3d
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-27"
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
    example: "47"
    drives_formatter_option: extrusionHeightField
  - name: signal_host_count
    type: integer
    example: "47"
  - name: total_host_count
    type: integer
    example: "212"
  - name: signal_ratio
    type: number
    example: "0.22"
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
    path: "docs/recipes/cim-performance/choropleth.md"
  - description: "Companion recipe — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/cim-performance/markers.md"
  - description: "Pattern reference — extrusion-3d on CIM Network Traffic (sibling CIM source, event-count height encoding)"
    path: "docs/recipes/cim-network-traffic/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on CIM Authentication (sibling CIM source, login-count height encoding)"
    path: "docs/recipes/cim-authentication/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on CIM Alerts (sibling CIM source, severity-weighted height encoding)"
    path: "docs/recipes/cim-alerts/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "splunk-cim skill — Performance data model schema, dataset tags, dest/cpu/memory contracts"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "splunk-datamodels-conf skill — CIM acceleration and tstats summariesonly tradeoffs"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
---

# CIM Performance — US states 3D extrusion

The third-dimension companion to the
[cim-performance/choropleth](./choropleth.md) recipe — same
Performance data model, same per-state breaching-host aggregation,
same `us-states` PMTiles preset, but per-state shading is
**augmented by per-state vertical extrusion**. Tall states host
more breaching infrastructure; short states host less. The right
shape for **executive infrastructure-pressure briefings where
absolute breach-count rank matters** (the choropleth's colour
ramp saturates once 5+ states exceed the 80th percentile —
extrusion's height has unbounded headroom), **capacity-planning
reviews** where the visual cliff over a CA / VA / TX-host-dense
state pre-attentively communicates "this region needs the next
capacity investment", and **CIO regional-budget reviews** where
the 3D prism over the most-pressured state is itself the executive
talking point.

The **7th extrusion-3d recipe in the matrix** — joining
[geo-us-states](../geo-us-states/extrusion-3d.md),
[cim-network-traffic](../cim-network-traffic/extrusion-3d.md),
[cim-authentication](../cim-authentication/extrusion-3d.md),
[cim-alerts](../cim-alerts/extrusion-3d.md),
[meraki](../meraki/extrusion-3d.md), and
[splunk-stream](../splunk-stream/extrusion-3d.md). This advances
the extrusion-3d layer column from 6 cells to 7, and brings the
cim-performance source row from 6 cells to 7 (markers, h3, heat,
supercluster, paths, choropleth, plus extrusion-3d now). The
recipe is the canonical "executive 3D map of infrastructure-
pressure distribution" panel for CIO briefing decks.

## 1. Source description

Same **CIM Performance** data model as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), [paths](./paths.md), and
[choropleth](./choropleth.md) companions — see
[cim-performance/markers §1](./markers.md#1-source-description)
for the full data model background, the six datasets (CPU,
Memory, Storage, Network, Facilities, Uptime), and the
acceleration / `tstats summariesonly=true` contract.

The relevant distinction for THIS recipe: the panel renders the
same per-state breaching-host aggregation as the
[choropleth companion](./choropleth.md) but encodes the rank as
**polygon vertical extrusion** in addition to (or instead of)
colour shading. Same SPL as the choropleth companion (verbatim) —
the only differences live in the formatter config (§4).

**Why extrusion-3d for CIM Performance.** A choropleth saturates:
once California, Virginia, Texas, New York, and Washington all
exceed the 80th percentile of breaching-host counts, the colour
ramp can't distinguish them — they're all "dark magma". Extrusion
preserves rank visibility because height has unbounded headroom —
California with 47 breaching hosts is **5x taller** than a
mid-tier state with 9 breaching hosts, and the visual gap is
impossible to miss even when both states are at the saturated end
of the colour ramp. Combined with the additive choropleth (height
+ colour encode the same `value` — see §4), the panel becomes
double-encoded: height for absolute breach-count rank, colour
for the ordinal "where is the operational pressure".

The use cases this recipe unlocks beyond the choropleth companion:

- **CIO infrastructure-budget reviews** — the 3D prism over the
  most-pressured state is the focal point of the executive
  conversation; the colour ramp adds the "is this pressure
  growing" signal as a secondary visual cue.
- **Multi-region capacity-planning views** — height pre-attentively
  ranks the top 5 states even when their colour-ramp positions
  saturate, supporting "we need a regional PoP in Virginia next"
  discussions without forcing the reader to interpret a colour
  legend.
- **Per-jurisdiction infrastructure-health views** — the visual
  cliff over CA / VA / TX serves as the executive talking point
  for regional-cost-allocation reviews.

**Typical sourcetype / index:** Same broad catalogue as the
[choropleth companion §1](./choropleth.md#1-source-description)
— `nix:cpu`, `Perfmon:CPU`, `cisco:dnac:device`,
`cloudwatch:host`, `azure:monitor:metric`,
`vmware:vsphere:host:performance`, etc. The TA app context
required is `Splunk_SA_CIM`. The asset lookup is operator-
maintained.

## 2. SPL recipe

Identical to the [choropleth companion §2](./choropleth.md#2-spl-recipe)
— same triple-tstats over Performance.CPU / .Memory / .Storage,
same per-host breach detection, same asset-lookup-derived lat/lng,
same `geom geo_us_states` point-in-polygon, same per-state
aggregation, same `value=signal_host_count` projection:

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
| lookup asset_lookup_by_str src AS dest OUTPUT lat AS lat, long AS lon
| where isnotnull(lat) AND isnotnull(lon)
| geom geo_us_states featureIdField="stusps" latitude=lat longitude=lon
| where isnotnull(featureId)
| stats sum(is_signalling) AS signal_host_count,
    count AS total_host_count,
    values(state_name) AS state_name
  BY featureId
| eval signal_ratio=round(signal_host_count / total_host_count, 2)
| eval value=signal_host_count
| rename featureId AS id
| fields id, state_name, value, signal_host_count, total_host_count, signal_ratio
| sort - value
```

See the
[choropleth companion §2](./choropleth.md#2-spl-recipe) for the
line-by-line walkthrough of every stage — the per-stage
rationale is identical between the two recipes.

For an **alternative height encoding**: swap
`eval value=signal_host_count` to `eval value=ceil(signal_ratio
* 100)` to get height = "% of fleet breaching" instead of height
= "absolute breaching count". Visually, the RATIO variant
prevents the larger-fleet states (CA, VA, TX) from always
dominating — a small state where 80% of its fleet is breaching
will tower over a large state with 20% breaching, even though
the latter has more absolute breaching hosts. Same SPL change,
same formatter config below.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field             | type    | example     |
|-------------------|---------|-------------|
| id                | string  | CA          |
| state_name        | string  | California  |
| value             | integer | 47          |
| signal_host_count | integer | 47          |
| total_host_count  | integer | 212         |
| signal_ratio      | number  | 0.22        |

Identical to the [choropleth companion §3](./choropleth.md#3-expected-fields)
— same six fields, same role contract. `value` now drives BOTH
the choropleth shading AND the extrusion height
(`extrusionHeightField: "value"` in §4 below).

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": "true",
  "extrusionHeightField": "value",
  "extrusionScale": 25000.0,
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why this config (the only differences from the
[choropleth companion §4](./choropleth.md#4-recommended-formatter-config)
are the three new `enable3DExtrusion` / `extrusionHeightField` /
`extrusionScale` options):

- **`featureJoinPreset: "us-states"`** — same as the choropleth
  companion. Bundled preset, no CDN, air-gap compatible.
- **`enable3DExtrusion: "true"`** — switches the polygon
  rendering from flat-fill to extruded-prism. Without this
  option set, `extrusionHeightField` and `extrusionScale` are
  silently ignored — the panel falls back to choropleth-only
  behaviour.
- **`extrusionHeightField: "value"`** — the column that drives
  the prism's vertical height. Same column drives the
  choropleth fill via the implicit `value` contract, so the
  panel is double-encoded: height + colour both rank breaching
  hosts.
- **`extrusionScale: 25000.0`** — the multiplier that converts
  the `value` field's numeric range to meters of polygon height.
  Tunable to the fleet's expected breach-count distribution:
  - Small operator (~100 hosts, breach counts 1-15): `5000.0`
  - Mid operator (~1k hosts, breach counts 5-50): `25000.0`
    (this recipe's default)
  - Large operator (~10k hosts, breach counts 20-500):
    `100000.0`
  - Hyperscaler (~100k hosts, breach counts 200-5000):
    `500000.0`
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
  companion's "where is the operational pressure" answer on
  smaller-pressure states whose extrusion is too short to
  pre-attentively register.
- **`palette: "magma"`** — same as the choropleth companion's
  alerting-framed default. Warm-colour-equates-with-attention.
  For a neutral CIO-briefing view (no implicit alerting tone),
  swap to `viridis`.

For a **RATIO-based view** (height = percent of fleet breaching),
make the §2 SPL swap (`eval value=ceil(signal_ratio * 100)`)
AND reduce `extrusionScale` to `5000.0` (since ratio values are
in 0-100, not 1-1000 like absolute counts). The recipe-level
tweak preserves the entire formatter contract.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by following the
[choropleth companion's §5 walkthrough](./choropleth.md#5-screenshot)
verbatim, then applying the §4 formatter JSON above (instead of
the choropleth companion's flat-fill JSON). The panel should
render per-state extruded prisms whose heights rank states by
breaching-host count, with California, Virginia, and Texas
typically the tallest for cloud-fleet customers. The default
camera pitch (45°) gives the best initial read of relative
heights; the user can rotate to inspect occluded states._

## 6. Gotchas

- **Acceleration is mandatory for `summariesonly=true`.** Same
  caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas) and the
  [markers companion §6](./markers.md#6-gotchas): without
  acceleration, the SPL returns zero rows.

- **`asset_lookup_by_str` is the ES A&I asset lookup — requires
  ES.** Same caveat and three substitution patterns as the
  [choropleth companion §6](./choropleth.md#6-gotchas).

- **`geom geo_us_states` requires the bundled geometry lookup.**
  Same caveat and three substitution paths as the
  [choropleth companion §6](./choropleth.md#6-gotchas).

- **`extrusionScale` requires per-tenant tuning.** Unlike the
  choropleth's colour ramp, which auto-scales to the data range,
  extrusion height is a multiplicative function of the raw
  `value` × `extrusionScale`. A scale tuned for a 100-host
  operator (`5000.0`) makes prisms invisible for a 10k-host
  operator's breach counts; a scale tuned for the latter
  (`100000.0`) makes the prisms tower above the map for the
  former. See the §4 tuning table for the recommended starting
  scales by fleet size, and iterate in the formatter sidebar.

- **Camera angle affects pre-attentive height ranking.** The
  default 45° pitch is the best tradeoff: too low (5-15°) and
  short prisms become invisible behind tall ones; too high
  (75-90°) and the panel reads as a top-down choropleth with
  the extrusion adding nothing. Lock the panel's initial pitch
  in `mapInitialPitch` (formatter option) to ensure consistent
  executive viewing — different camera angles can flip which
  state visually "wins" on first glance.

- **Saturation moves from colour to height — but only above
  the visual ceiling.** Once a single state's prism reaches the
  visual ceiling (its top edge clips against the panel's top
  edge), subsequent rank-rises in that state become
  imperceptible (the prism can't grow further). For a tenant
  whose worst-case state has 10x the breaches of the
  second-worst, this manifests as "California's prism touches
  the ceiling regardless of whether it's at 200 breaches or
  20,000". Two mitigations: (a) cap `extrusionScale` so the
  worst-case state's prism reaches only ~60% of the panel
  height, leaving headroom for further growth; or (b) display
  the `value` as a number in the popup so the operator can
  read the exact figure even when the prism saturates.

- **MAUP — state-area bias persists.** Same caveat as the
  [choropleth companion §6](./choropleth.md#6-gotchas):
  California / Virginia / Texas host the largest tech fleets,
  so they will tend to dominate both the colour and the height
  encoding. For a fleet-size-normalised view, use the
  RATIO-based variant per §2 (height = % of fleet breaching).

- **`asset_lookup_by_str` cardinality mismatch.** Same caveat
  as the [choropleth companion §6](./choropleth.md#6-gotchas):
  confirm the lookup is keyed on hostname (not IP) before
  shipping.

- **No OT-safety dependency.** Pure IT infrastructure
  performance. If the CIM Performance model also ingests
  OT-zone equipment, filter those OUT here (`NOT dest IN
  ("plc-*", "hmi-*", "rtu-*")`) and put them in a SEPARATE
  recipe with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

`status: unverified` in the frontmatter — the SPL is identical
to the
[choropleth companion](./choropleth.md), which itself has not
been dispatched against the v1.7-prep lab tenant for the
reasons documented in
[its §Verification status](./choropleth.md#verification-status).
The formatter changes (the three extrusion options) are covered
by Better Map's own `featureJoin` module unit tests for the
extrusion-3d path — proven in the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
and
[geo-us-states/extrusion-3d](../geo-us-states/extrusion-3d.md)
companions, both of which use the same `featureJoinPreset:
"us-states"` + `enable3DExtrusion` + `extrusionHeightField:
"value"` contract this recipe uses. A maintainer with a
populated `asset_lookup_by_str` should follow the verification
steps in the
[markers companion §Verification status](./markers.md#verification-status)
(substituting this recipe's §4 extrusion formatter for the
markers companion's marker formatter), then promote both this
recipe AND the choropleth companion to `status: verified` + fill
in `verified_against` in a follow-up PR.
