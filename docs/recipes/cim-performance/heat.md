---
schema_version: 1
id: cim-performance--heat
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "web-prod-01"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: cpu_load_percent
    type: number
    example: "82.4"
  - name: mem_used_percent
    type: number
    example: "67.1"
  - name: weight
    type: number
    example: "0.82"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/cim-performance/markers.md"
  - description: "Companion recipe — same source, different layer (h3)"
    path: "docs/recipes/cim-performance/h3.md"
  - description: "splunk-cim skill — Performance data model schema, dataset tags, dest/cpu/memory contracts"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "splunk-datamodels-conf skill — CIM acceleration and tstats summariesonly tradeoffs"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# CIM Performance — heatmap

The aggregate-density complement to the
[cim-performance/markers](./markers.md) and
[cim-performance/h3](./h3.md) recipes — same CIM-accelerated
`Performance.CPU` and `Performance.Memory` datasets, same ES
Asset & Identity asset lookup for hostname → lat / lon, but
rendered as a weighted heatmap rather than discrete markers
or hex cells. The heat layer surfaces **infrastructure load
PRESSURE** as colour intensity: hot blobs indicate regions
with the highest aggregate CPU / memory pressure across the
monitored fleet; cool blobs indicate quiet regions. This is
the natural shape for **executive infrastructure briefings**
and **capacity-planning slide decks** where the question is
"where is our fleet running hottest, smoothly distributed?"
rather than "which individual host should I investigate"
(use markers for that) or "what's the per-region ranking"
(use H3 hexbin for that).

Completes the **cim-performance source-row triplet** —
markers (wave 4b), H3 hexbin (wave 8), heatmap (this wave) —
all three layers coexisting via the BM-CT-1 layer contract
on the same Dashboard Studio panel. This is the **8th
completed triplet** (joining cim-alerts, cim-authentication,
cim-network-traffic, cyber-vision, es-risk, meraki, and
netflow-sflow-ipfix), and the **last CIM/SOC-stack triplet**
needed to round out the IT observability surface.

## 1. Source description

Same Splunk **Performance** Common Information Model (CIM)
data model as the companion [markers](./markers.md) and
[h3](./h3.md) recipes — vendor-agnostic, normalising
telemetry from Universal Forwarders, Splunk Infrastructure
Monitoring, Cisco Catalyst Center, AWS CloudWatch, Azure
Monitor, GCP Stackdriver, and every TA tagged
`performance,cpu` / `performance,memory` / etc.

**Why heatmap for CIM Performance.** A markers view at
world zoom collapses dense datacenter clusters (one AWS
`us-east-1` availability zone hosts hundreds of monitored
hosts; one Azure `eastus2` region might host thousands for
a heavy-cloud customer) into overlapping circles that hide
the global pressure gradient. An H3 hexbin gives you sharp
per-cell rankings, which is great for capacity reviews —
but for a board slide showing "this is where our fleet's
load IS", smooth Gaussian blobs read more naturally than
either rectangles or hexes. The heatmap layer aggregates
the per-host CPU pressure as a smooth weight surface —
perfect for **CIO / CISO infrastructure briefings** and
**multi-region availability reviews** where the question is
"how is fleet pressure DISTRIBUTED across the geography",
NOT for per-host investigation or per-region drilldown.

**Heatmap vs H3 hexbin vs markers — which to choose.**
- Use **markers** when the panel question is "WHICH HOSTS
  are in trouble?" (analyst investigation, IR triage,
  per-host drilldown). Layer: [markers](./markers.md).
- Use **H3 hexbin** when the panel question is "WHICH
  REGION is hottest?" (SRE capacity planning, per-region
  ranking, click-to-drilldown). Layer: [h3](./h3.md).
- Use **heatmap** (this recipe) when the panel question is
  "WHERE is the pressure DISTRIBUTED?" (executive briefing,
  multi-region availability slide, smooth pressure gestalt).
- All three CAN coexist on the same Dashboard Studio panel
  via the BM-CT-1 layer contract — the heat layer renders
  underneath as the background gradient, hexbins overlay
  for per-region rankings, markers pin on top for clickable
  per-host investigation. Toggle each independently from a
  dashboard input.

**Typical sourcetype / index:** any sourcetype tagged
`performance,cpu` and `performance,memory` — the model is
accelerated for production tenants. The TA app context
required is `Splunk_SA_CIM`. The asset lookup is
operator-maintained (this recipe uses the same
`asset_lookup_by_str` from the ES A&I framework as the
markers and h3 companions).

## 2. SPL recipe

```spl
| tstats summariesonly=true latest(Performance.cpu_load_percent) AS cpu_load_percent FROM datamodel=Performance.CPU WHERE earliest=-15m latest=now BY Performance.dest
| rename Performance.dest AS dest
| append [
    | tstats summariesonly=true latest(Performance.mem_used_percent) AS mem_used_percent FROM datamodel=Performance.Memory WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| stats latest(cpu_load_percent) AS cpu_load_percent, latest(mem_used_percent) AS mem_used_percent BY dest
| where isnotnull(cpu_load_percent) OR isnotnull(mem_used_percent)
| eval cpu_load_percent=coalesce(cpu_load_percent, 0)
| eval mem_used_percent=coalesce(mem_used_percent, 0)
| eval load_pressure=if(cpu_load_percent > mem_used_percent, cpu_load_percent, mem_used_percent)
| where load_pressure >= 30
| lookup asset_lookup_by_str src AS dest OUTPUT lat AS lat, long AS lon
| where isnotnull(lat) AND isnotnull(lon)
| eventstats max(load_pressure) AS max_load_pressure
| eval weight=round(log10(load_pressure + 1) / log10(max_load_pressure + 1), 2)
| eval cpu_load_percent=round(cpu_load_percent, 1)
| eval mem_used_percent=round(mem_used_percent, 1)
| rename dest AS id
| fields id, lat, lon, cpu_load_percent, mem_used_percent, weight
| sort - load_pressure
| head 5000
```

Why this exact shape, line by line:

- **Two `tstats summariesonly=true` against
  `datamodel=Performance.CPU` / `.Memory`** — same pattern
  as the h3 recipe but dropping `.Storage` (same rationale:
  storage pressure is typically persistent per host and
  doesn't vary across a region on a 15 min cadence —
  including it would mute the cell-to-cell variance the
  heatmap layer is designed to surface). The 15 min window
  matches the typical 5 min accel span × 3 (covers one
  missed sample).
- **`append` + `stats latest(...) BY dest`** — same multi-
  dataset merge pattern as the markers and h3 recipes.
  Avoids `join`'s 50K row × 60 s truncation per the SPL
  quality rules.
- **`where isnotnull(cpu_load_percent) OR isnotnull(mem_used_percent)`**
  — the heatmap layer needs at least ONE pressure signal
  per row (unlike the h3 recipe which requires CPU
  specifically). A host with memory-only telemetry still
  contributes weight to the heatmap if its memory is
  pressured; same for a CPU-only host. The `coalesce(...,
  0)` lines below then ensure the next `eval` doesn't
  short-circuit on a missing signal.
- **Two `eval *=coalesce(*, 0)`** — defend against the
  CPU-only-host and memory-only-host cases. A null value
  in either signal would otherwise break the
  `if(cpu_load_percent > mem_used_percent, ...)` comparison.
  `0` is the right sentinel because it means "no signal,
  no pressure contribution from this dimension".
- **`eval load_pressure=if(cpu_load_percent > mem_used_percent,
  cpu_load_percent, mem_used_percent)`** — **worst-of-CPU-
  or-memory aggregation per host**. The heatmap's job is
  to surface ANY load pressure regardless of which
  resource is constrained; a CPU-bound host (95 % CPU,
  20 % memory) and a memory-bound host (15 % CPU, 92 %
  memory) should BOTH light up the heat blob in their
  region. Pre-aggregating to the worst-of via `if` is
  cheaper than computing both heat layers separately and
  blending them in the renderer. To represent CPU-only
  pressure (drop memory from the heat signal), swap to
  `eval load_pressure=cpu_load_percent`. To represent a
  weighted combination, swap to
  `eval load_pressure=0.7*cpu_load_percent + 0.3*mem_used_percent`
  (CPU-weighted) or whatever blend matches the customer's
  SRE conventions.
- **`where load_pressure >= 30`** — drop healthy hosts.
  Hosts running below 30 % on both CPU and memory don't
  contribute meaningful "pressure" signal; including them
  dilutes the heat gradient with thousands of cool-blob
  pixels. Tune by tenant: a heavily-utilised tenant
  running steady 60-80 % might raise the floor to 50 to
  isolate the genuinely-stressed hosts; an over-provisioned
  tenant might drop to 15 to make the heat layer
  visualise any signal at all. The h3 recipe doesn't need
  this filter because the hexbin layer's `avg` aggregate
  naturally handles low values per cell.
- **`lookup asset_lookup_by_str src AS dest OUTPUT lat
  AS lat, long AS lon`** — same ES A&I asset lookup as
  the markers and h3 recipes. See the markers companion
  Gotchas section for the three substitution patterns
  (ITSI entity collection, DNS-or-CMDB CSV, geocode-by-DNS)
  for tenants without ES.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  hosts with no geographic attribution. Real performance
  problems without geographic representation are surfaced
  in a companion table panel.
- **`eventstats max(load_pressure) AS max_load_pressure`**
  — adds the global maximum pressure as a column on every
  row, so the next `eval` can normalise. `eventstats` (not
  `stats`) is the right command here because it KEEPS the
  per-host rows and only ADDS the new column.
- **`eval weight=round(log10(load_pressure + 1) /
  log10(max_load_pressure + 1), 2)`** — **log-scale
  normalisation**. CIM Performance load_pressure values
  span 30-100 % in the typical workload; that's narrower
  than the 6-order-of-magnitude span of `splunk-stream/heat`'s
  `bytes_out` field, but log-scale STILL gives the long-
  tail of mildly-pressured hosts a readable weight in the
  `[0, 1]` band rather than collapsing them to `weight ≈
  0` against the heaviest host. The `+ 1` inside both
  log calls is the standard +1 trick to avoid `log10(0)
  = -inf` in the edge case where `load_pressure=0` slips
  through (it won't, because of the `>= 30` filter, but
  the +1 makes the formula safe under future filter
  tuning).
- **Two `eval *=round(*, 1)`** — round for display (the
  underlying CIM values are float-precise from the raw
  telemetry). Carried as feature properties for the popup
  when the operator clicks ON a marker layer overlay
  (NOT on a heat blob — heat layers don't directly
  expose per-feature popup; use the companion markers
  recipe as the top layer in a multi-layer panel for
  clickable drilldown).
- **`rename dest AS id`** — adopt Better Map's `id` alias.
- **`fields ...`** — explicit field list, six fields.
  `load_pressure` and `max_load_pressure` are intentionally
  dropped — they're scratch fields used to compute
  `weight`, not features the renderer or drilldown layers
  need.
- **`sort - load_pressure`** — most-pressured hosts first
  so `head 5000` keeps the heavy hitters even when the
  long-tail is truncated.
- **`head 5000`** — render budget. CIM Performance
  monitors entire fleets (tens of thousands of hosts for
  large customers). 5000 covers a busy enterprise fleet
  even with a permissive `load_pressure >= 30` threshold;
  the heat layer aggregates many hosts per blob, so even
  5000 hosts collapse to a manageable visual surface at
  world zoom.

Note every `|` starts its own physical line per the SPL
pipe-per-line contract.

## 3. Expected fields

| field            | type   | example     |
|------------------|--------|-------------|
| id               | string | web-prod-01 |
| lat              | number | 37.7749     |
| lon              | number | -122.4194   |
| cpu_load_percent | number | 82.4        |
| mem_used_percent | number | 67.1        |
| weight           | number | 0.82        |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`weight` is the heat-layer-required intensity field; the two
`_percent` fields are carried for popup display when paired
with a companion markers overlay (heat layers don't expose
per-feature popup directly).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.7,
  "heatmapRadius": 28
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer switches to
  heatmap above ~200 features, so for quieter tenants
  (small fleets running calmly) the recipe needs an
  explicit pin to force the heat rendering even when the
  pressured-host count drops below 200.
- **`heatmapOpacity: 0.7`** — matches the `splunk-stream/
  heat` and `cyber-vision/heat` recipes (every wire-data
  / OT / IT-infrastructure heat recipe in the matrix
  settled on `0.7` as the right tradeoff between blob
  visibility and basemap city-label survival). At 1.0 the
  heat fully occludes the city underlay; at 0.5 the heat
  is too washed out to read at low zoom; 0.7 is the sweet
  spot for an SRE / SecOps audience that needs to read
  both the heat gradient AND the underlying geography.
- **`heatmapRadius: 28`** — matches the `splunk-stream/
  heat` recipe (slightly larger than the
  `cim-authentication/heat` recipe's `24` because
  infrastructure tends to be more spatially concentrated
  in cloud regions — Northern Virginia for AWS
  `us-east-1`, Quincy Washington for AWS `us-west-2`,
  Frankfurt for AWS `eu-central-1`). A larger radius
  merges all the in-region hosts into a single readable
  "hub" blob at world zoom and resolves to per-region
  clusters at country zoom. For an on-prem datacenter
  view (sparse, far apart, less geographic concentration),
  drop to 18-22.
- **`weight` drives heat intensity automatically.** The
  heat layer renderer auto-picks the `weight` field by
  name (per Better Map's `dataFitness.js` field aliasing).
  If you rename `weight` in the SPL, also set the
  formatter's `heatField` option (or whichever name the
  formatter schema uses — check
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). The harness will ship synthetic CIM
Performance events from the `*nix` TA, but the asset
lookup (`asset_lookup_by_str` or equivalent) must be
seeded with at least a few `lat`/`long` rows representing
multiple datacenters across at least two continents (so
the heatmap visualization has multiple regional blobs to
compare). Recipe verification path: dispatch against the
D5 harness once the asset lookup is bootstrapped with
multi-region coordinates, then pair with the cim-
performance/markers companion on the same Dashboard Studio
panel to show the BM-CT-1 layer contract working
end-to-end (heat underneath, markers clickable on top)._

## 6. Gotchas

- **Acceleration is mandatory for `summariesonly=true`.**
  Same as the markers and h3 recipes — if your tenant's
  CIM Performance data model is not accelerated, the
  `tstats summariesonly=true` query returns zero rows.
  Two fixes: (a) enable acceleration (5 min span,
  6-week retention — the splunk-datamodels-conf skill
  defaults work); or (b) drop `summariesonly=true` and
  pay the raw-event query cost.
- **Heatmap vs H3 vs markers — when to choose which.**
  See the §1 source-description matrix. Heat is right for
  executive infrastructure briefings (smooth gradient
  reads cleaner in a slide deck than rectangles or
  hexes). H3 is right for SRE capacity reviews (per-
  region rankings with clickable drilldown). Markers are
  right for analyst investigation (per-host clickable
  detail). All three can coexist via the BM-CT-1 layer
  contract — heat underneath, hexbins overlay, markers
  on top. Toggle each independently from a dashboard
  input. Recommended top-of-stack for cim-performance:
  heat for the slide-deck panel, markers for the IR
  panel, h3 for the SRE drilldown panel — three panels
  off the same data, three audiences served.
- **The "worst-of CPU or memory" pressure aggregation
  blurs the diagnosis signal.** A heat blob does NOT
  tell you whether a region's pressure is CPU-bound or
  memory-bound — both light it up. This is intentional
  for the executive-briefing use case (the executive
  doesn't need to know WHICH resource is constrained,
  just that the region is hot). For diagnostic panels
  that need to distinguish CPU pressure from memory
  pressure, use TWO panels with single-signal `eval`
  variants: `eval load_pressure=cpu_load_percent` for
  the CPU-only heatmap and `eval load_pressure=mem_used_percent`
  for the memory-only heatmap. Side-by-side rendering
  reveals whether a region is universally hot (both
  panels light up the same blob) or signal-specific
  (only one panel lights up — diagnostic clue).
- **Log-scale normalisation rationale.** Even though
  CPU% values are bounded `[0, 100]` (only ~3.3 orders
  of magnitude in the worst case), log-scale STILL
  gives the long tail readable weight. A `load_pressure=
  35` host normalised linearly against `max_load_pressure=
  100` gets `weight=0.35`; log-scale gives it
  `log10(36) / log10(101) ≈ 0.78` — visually present in
  the heat blob rather than washed out. If your tenant
  runs a narrow pressure band (e.g. ALL hosts hover
  between 70-90 %), the log-scale formula compresses
  the range; swap to linear:
  `eval weight=round(load_pressure / max_load_pressure, 2)`
  for the narrow-range case.
- **`asset_lookup_by_str` requires ES — same as
  markers and h3 recipes.** See [cim-performance/markers](./markers.md)
  §6 for the three substitution patterns (ITSI entity
  collection, DNS-or-CMDB CSV, geocode-by-DNS).
- **Time range.** Hard-coded `earliest=-15m latest=now`.
  Same rationale as the markers and h3 recipes (5 min
  accel span × 3 covers one missed sample). For "capacity
  trend over the workday," widen to `-8h` and switch
  `latest()` to `avg()` so the heat blob represents
  "avg pressure over the last 8 h" rather than "freshest
  sample pressure." For executive boardroom panels,
  consider `-24h` with `max()` so the blob represents
  "worst pressure in the last day" — pessimistic but
  surfaces the regions that hit peaks.
- **PII / GDPR posture — same as markers and h3
  recipes.** Hostnames may embed regulated information;
  restrict via Splunk RBAC on the CIM Performance
  indexes for audiences without "see infrastructure
  naming" auth. Per ROADMAP §1a, Better Map never sends
  event data outside `splunkd:8089`. The heat layer is
  the BROADEST view of the three cim-performance
  recipes — individual host names are not directly
  legible from a heat blob, only the regional pressure
  aggregate is — so this layer is generally the LOWEST-
  risk for privacy-sensitive deployments. Still subject
  to the same RBAC rules as the underlying CIM data.
- **No OT safety dependency — same as markers and h3
  recipes.** This recipe is pure IT infrastructure
  performance. If your CIM Performance model also ingests
  OT-zone equipment (PLC CPU, HMI memory), filter those
  hosts OUT here (`NOT dest IN ("plc-*", "hmi-*", "rtu-*")`)
  and put them in a SEPARATE recipe with
  `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — a CPU-bound PLC and a CPU-bound web server
  need fundamentally different operator responses and
  should not visually compete on the same heatmap.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented CIM Performance
schema and `tstats` contract from
[`~/.cursor/skills/splunk-cim/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-cim/SKILL.md),
and uses the canonical `eventstats max + log10 eval normalise`
heat-weight pattern shared across every heat recipe in the
matrix ([cim-alerts/heat](../cim-alerts/heat.md),
[cim-authentication/heat](../cim-authentication/heat.md),
[cim-network-traffic/heat](../cim-network-traffic/heat.md),
[cyber-vision/heat](../cyber-vision/heat.md),
[es-risk/heat](../es-risk/heat.md), [meraki/heat](../meraki/heat.md),
[netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md),
[ot-datastreamer/heat](../ot-datastreamer/heat.md),
[splunk-stream/heat](../splunk-stream/heat.md)). It has not
been dispatched against a tenant with CIM Performance
accelerated AND an A&I lookup carrying multi-region lat/long.
A maintainer with REST auth to such a tenant should:

1. Confirm Performance is accelerated:
   `| datamodel Performance | head 1`.
2. Confirm the A&I lookup carries lat/long across
   MULTIPLE regions (the heat layer only works if there's
   geographic variance):
   `| inputlookup asset_lookup_by_str | where
   isnotnull(lat) | stats dc(lat) AS distinct_lats`.
3. Run the recipe SPL and confirm the panel renders at
   least 3 distinct heat blobs with meaningful `weight`
   variance.
4. Pair with [cim-performance/markers](./markers.md) on
   the same panel to verify the BM-CT-1 layer contract
   — heat underneath, markers clickable on top.
5. Tune the `load_pressure >= 30` threshold to the
   tenant's baseline workload (see Gotchas).
6. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app: "Splunk_SA_CIM"`),
   and submit a follow-up PR.
