---
schema_version: 1
id: es-risk--heat
source:
  id: es-risk
  display_name: "ES Risk-Based Alerting (risk index)"
  pattern: splunk-premium-es
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "SplunkEnterpriseSecuritySuite"
    optional: false
  - id: "Splunk_SA_CIM"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "alice@example.com"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: total_risk
    type: integer
    example: "147"
  - name: risk_object_type
    type: string
    example: "user"
  - name: weight
    type: number
    example: "0.84"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/es-risk/markers.md"
  - description: "Companion recipe — same source, different layer (H3 hexbin)"
    path: "docs/recipes/es-risk/h3.md"
  - description: "splunk-rba skill — Risk-Based Alerting framework (risk index schema, rules, RIRs)"
    path: "~/.cursor/skills/splunk-rba/SKILL.md"
  - description: "splunk-enterprise-security skill — Asset & Identity framework, identities.csv schema"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# ES Risk-Based Alerting — heatmap

The aggregate-density complement to the
[es-risk/markers](./markers.md) and [es-risk/h3](./h3.md)
recipes — same `risk` index, same
`sum(risk_score) BY risk_object` RBA aggregator, same ES
Asset & Identity (A&I) framework lookup chain for
entity → home location, but rendered as a weighted heatmap
rather than discrete markers or hexagonal cells. The heat
layer surfaces **accumulated-risk PRESSURE** as smooth
colour intensity: hot regions indicate physical sites where
the most risk is currently accumulating; cool regions
indicate quiet workforce / fleet zones. This is the natural
shape when the SecOps question is "show me the global risk
landscape — where is the pressure right now?" rather than
"which individual entity should I drill into?" (markers) or
"which site hex is hottest?" (H3).

This recipe completes the **es-risk source-row triplet**
(markers + H3 + heat) shipped across waves 10, 11, and 13.

## 1. Source description

Same **Risk-Based Alerting (RBA)** data home as the
companion [markers](./markers.md) and [h3](./h3.md) recipes
— the `risk` index, populated by the `action.risk = 1`
adaptive-response action attached to ES correlation
searches. Each event carries `risk_object`,
`risk_object_type`, `risk_score`, `risk_message`,
`annotations.mitre_attack{}`, and `source_search`. See the
markers recipe §1 for the full RBA primer.

**Why heatmap for RBA risk.** A markers view at world zoom
collapses every site (corporate HQ, branch offices,
datacenter regions) into overlapping clusters that bury the
"where is risk concentrated" signal. An H3 view answers
"which site cells are hot" with stable hex-cell geometry,
but the hexagonal grid can read as analytically rigorous /
operationally cold for executive-briefing audiences. A
heatmap aggregates per-entity risk into smooth Gaussian
blobs that read as "risk pressure" — the layer for
**SOC leadership dashboards** ("show me where the company's
risk is concentrating this quarter"), **board-deck
slides** ("here's our global risk distribution"), and
**hand-off briefings between SOC shifts** ("the day shift
left a hot blob over EMEA — investigate"), NOT for
per-entity investigation (use markers) or per-site
drilldown (use H3).

**Heatmap vs markers vs H3 for RBA — when to choose which.**

| Layer | Best for | Why |
|---|---|---|
| `markers` ([es-risk/markers](./markers.md)) | SOC analyst investigation, IR triage | Each entity is individually clickable with full RBA context |
| `h3` ([es-risk/h3](./h3.md)) | SOC stand-up, site comparison | Per-site totals with stable hex cells + per-cell drilldown |
| `heat` (this recipe) | SOC leadership / board briefings, shift hand-off | Smooth global pressure landscape, intentionally aggregated |

All three coexist in the same dashboard via Better Map's
BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
`reset`) toggled from dashboard inputs — a single dashboard
can carry the analyst view (markers default), with
leadership / hand-off layers toggled on demand.

**Typical sourcetype / index:** `index=risk` via the ``
`risk` `` macro. Requires `SplunkEnterpriseSecuritySuite`
plus `Splunk_SA_CIM` and an A&I lookup populated with
`lat` and `long` columns. See the
[markers recipe §6](./markers.md#6-gotchas) for the
A&I-extension procedure and the geocode-by-IP fallback if
your A&I lookups lack geographic columns.

## 2. SPL recipe

```spl
`risk` earliest=-24h latest=now
| stats sum(risk_score) AS total_risk BY risk_object, risk_object_type
| where total_risk >= 50
| lookup identity_lookup_expanded identity AS risk_object OUTPUT lat AS identity_lat, long AS identity_lon
| lookup asset_lookup_by_str src AS risk_object OUTPUT lat AS asset_lat, long AS asset_lon
| eval lat=coalesce(identity_lat, asset_lat)
| eval lon=coalesce(identity_lon, asset_lon)
| where isnotnull(lat) AND isnotnull(lon)
| eventstats max(total_risk) AS max_total_risk
| eval weight=round(log10(total_risk + 1) / log10(max_total_risk + 1), 2)
| rename risk_object AS id
| fields id, lat, lon, risk_object_type, total_risk, weight
| sort - total_risk
| head 5000
```

Why this exact shape, line by line:

- **`` `risk` earliest=-24h latest=now ``** — `` `risk` ``
  is the ES macro that resolves to `index=risk` plus any
  optional risk index shards. Same convention as the
  markers / H3 siblings — always use the macro, never
  hard-code `index=risk`.
- **`stats sum(risk_score) AS total_risk BY risk_object,
  risk_object_type`** — the canonical RBA aggregator,
  one row per entity. Same as the H3 recipe (which also
  needs per-entity aggregation before geographic
  rendering). Drops the `values(annotations.mitre_attack{})`
  and `values(source_search)` aggregates the markers recipe
  uses because the heatmap layer renders aggregate
  PRESSURE, not per-entity drilldown — per-entity
  techniques would be invisible inside a smoothed blob.
- **`where total_risk >= 50`** — signal-to-noise filter,
  matches the default RBA medium-priority threshold. Same
  advice as the markers / H3 recipes — match this to your
  tenant's RIR threshold.
- **Two `lookup` lines + `coalesce`** — same ES A&I
  fallback chain as the markers / H3 recipes. User-typed
  `risk_object` values resolve via the identity lookup;
  machine `risk_object` values resolve via the asset
  lookup; `coalesce` picks whichever hit.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  entities with no home location. See the
  [markers recipe §6](./markers.md#6-gotchas) for the
  A&I-extension procedure and the geocode-by-IP fallback.
- **`eventstats max(total_risk) AS max_total_risk`** —
  adds the per-tenant maximum risk score as a column on
  every row, so the next `eval` can normalise. `eventstats`
  (not `stats`) is the right command because it KEEPS the
  per-entity rows and ADDS the new column. Same pattern
  used in the [cim-network-traffic/heat](../cim-network-traffic/heat.md),
  [netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md),
  [splunk-stream/heat](../splunk-stream/heat.md),
  [ot-datastreamer/heat](../ot-datastreamer/heat.md), and
  [meraki/heat](../meraki/heat.md) sibling heat recipes.
- **`eval weight=round(log10(total_risk + 1) /
  log10(max_total_risk + 1), 2)`** — **log-scale**
  normalisation. RBA risk scores in production span 2-3
  orders of magnitude (50-100 for a barely-triggering
  entity vs 1000+ for a serious kill-chain accumulator).
  Linear normalisation would render every entity below
  10 % of the top accumulator as `weight ≈ 0.1` and
  produce a heatmap with one bright blob over the worst
  entity's site and nothing else visible. The log-scale
  formula preserves the rank order while compressing the
  dynamic range so the third-most-risky region is still
  visible on the heatmap alongside the worst. The `+ 1`
  guards against `log10(0)` = `-inf` when `total_risk`
  is very low (defensive — the `where total_risk >= 50`
  filter above already ensures `total_risk >= 50` so
  `log10(total_risk)` is well-defined, but the `+ 1`
  pattern is the canonical defensive form used across all
  heat recipes and worth keeping for consistency). See §6
  Gotchas for the trade-offs.
- **`rename risk_object AS id`** — adopt Better Map's
  canonical `id` alias.
- **`head 5000`** — render budget. Most ES tenants
  accumulate < 500 risk-object aggregates over 24 h above
  the default threshold; 5000 covers worst-case noisy days.
  Heatmap rendering is fast even at 5000 features (smooth
  Gaussian blobs are cheap to compute on the GPU).

## 3. Expected fields

| field            | type    | example           |
|------------------|---------|-------------------|
| id               | string  | alice@example.com |
| lat              | number  | 47.6062           |
| lon              | number  | -122.3321         |
| total_risk       | integer | 147               |
| risk_object_type | string  | user              |
| weight           | number  | 0.84              |

All six appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.
`weight` is the heat-layer-required normalised intensity
field; `total_risk` and `risk_object_type` flow through as
feature properties for the per-region drilldown popup (if
the SOC operator zooms in and hovers over a blob region,
the popup will show the strongest contributing entity).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 32
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer only switches to
  heatmap above ~10000 features, so for the typical RBA
  tenant (< 500 risk-object aggregates) the recipe NEEDS
  the explicit pin — without it, `auto` would render
  markers and silently invert the panel's intent.
- **`heatmapOpacity: 0.75`** — slightly higher than the
  network-traffic heatmap default (0.7) because RBA
  heatmaps tend to be LESS saturated than network-traffic
  heatmaps (RBA distributes across the customer's
  workforce-and-fleet footprint, which is more
  geographically spread-out than cloud egress which
  concentrates in a handful of hyperscaler regions). 0.75
  keeps the heat blobs in the visual foreground without
  occluding the basemap geography. The formatter-schema
  range is 0.0-1.0.
- **`heatmapRadius: 32`** — larger than the network-traffic
  heatmap default (28 px) because risk pressure is per-
  ENTITY-at-a-SITE (one office may host 200 employees, all
  contributing risk to a single lat/lon — they should
  visually merge into a single regional blob rather than a
  pinprick on the building). 32 px provides comfortable
  cross-metro merging for "regional risk pressure" reading.
  For a corporate-campus zoom (one building at a time),
  drop to 16-20 px so individual floors / buildings remain
  visible. The formatter-schema range is 2-64 px.
- **`weight` drives heat intensity automatically.** The
  heat layer renderer auto-picks the `weight` field by
  name (per Better Map's `dataFitness.js` field aliasing).
  Same convention as every other heat recipe in the matrix.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). Like the markers / H3 companions, this
recipe will be validated against an ES-licensed verification
tenant rather than the default D5 lab environment — the D5
harness will not ship ES + an A&I lookup with lat/lon
seeded. A maintainer can reproduce by running the SPL
against an ES tenant with seeded A&I, applying the formatter
JSON in §4, and observing that the heatmap brightens over
the customer's regional offices and dims over quiet
workforce zones._

## 6. Gotchas

- **Log-scale weight is INTENTIONAL.** Same rationale as
  the [cim-network-traffic/heat](../cim-network-traffic/heat.md)
  recipe — RBA risk scores span 2-3 orders of magnitude;
  linear normalisation would collapse 80 % of entities to
  invisibility. The log-scale formula preserves rank
  order while compressing dynamic range. The trade-off is
  that the weight values feel less intuitive in popups
  ("weight" of 0.7 doesn't read as "70 % of max" — read it
  as the log-scale rank, or expose `total_risk` directly
  in the popup template instead of `weight`).
- **A&I lookups need lat/lon columns — they do NOT ship
  that way.** Same blocker as the markers / H3 recipes.
  See [es-risk/markers §6](./markers.md#6-gotchas) for
  the extension procedure and the geocode-by-IP fallback.
- **Heatmap vs markers vs H3 — when to choose which** (see
  also §1 above). Heatmap is the right layer when the
  audience is **leadership / executive / board**, when the
  question is **"where is risk concentrating?"** (not
  "which entity?" or "which site?"), and when **per-entity
  drilldown is NOT expected** from this panel. If the SOC
  analyst wants to click a blob and see the contributing
  entity list, render the markers companion on the same
  dashboard and toggle layers via BM-CT-1 — do NOT add
  drilldown to the heatmap panel itself (heatmap blobs
  don't carry per-feature click-through, and trying to
  retrofit it creates a confusing UX).
- **Heatmap blurs OT vs IT risk distinction.** Same
  concern as the cim-network-traffic/heat recipe — a hot
  blob over a manufacturing-plant region could conceal a
  safety-impacting OT-zone risk under aggregate IT
  workforce risk. If your ES install ALSO scores OT-zone
  entities (passive DPI alerts from Cisco Cyber Vision
  feeding ES correlation searches), keep them in a
  SEPARATE recipe with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1, 4, and 6. The heatmap layer's smoothing makes
  this risk more acute than for markers / H3 — a single
  OT-zone risk event averaged into a hot office blob
  effectively vanishes from this panel.
- **Aggregation semantics — `sum` of risk scores.** The
  heat layer normalises `total_risk` per entity then
  Gaussian-blends across nearby entities into blobs. This
  means a single entity with `total_risk = 500` produces
  a similar visual heat blob as five entities with
  `total_risk = 100` each at the same site — both
  aggregate to "high regional risk." If your SOC question
  distinguishes "one loud entity at a site" from "many
  medium-risk entities at a site," use the H3 companion
  recipe with `hexbinAggregate: "max"` (one loud entity)
  vs `hexbinAggregate: "sum"` (total accumulation) — the
  heatmap layer cannot disambiguate these.
- **`risk` index acceleration.** Same as the markers / H3
  recipes — ES does NOT accelerate the `risk` index by
  default. A 24 h aggregate is usually fast enough; for
  > 100k risk events per day, schedule a daily summary
  search.
- **Time range.** Hard-coded `earliest=-24h latest=now`
  matches the default RBA scoring horizon. For a 7-day
  "weekly risk landscape" leadership briefing, replace
  with `earliest=-7d`. The heatmap shape is generally
  stable across time-range adjustments — the panel just
  smooths out (longer windows produce more entity
  contributions, larger blobs).
- **PII / GDPR posture.** Same as the markers / H3
  recipes — `risk_object` values for `risk_object_type=
  "user"` are by definition PII. The heatmap layer is the
  **lowest-risk** of the three es-risk layers for
  privacy-sensitive deployments because heat blobs
  collapse identifying entity names into anonymous
  regional pressure (the popup CAN still expose
  entity-level data on hover, so set the
  `popupTemplate` formatter option to a
  category-only template like
  `"Risk pressure: {{weight}}"` to fully
  anonymise the panel for board-deck rendering).
- **No OT safety dependency for this layer.** This recipe
  is pure IT identity-and-system risk. The OT-safety
  carve-out applies if your ES install scores OT-zone
  entities — see the gotcha above. Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6, OT-safety-dependent risk MUST surface via the
  OT-zone runbook and NOT alongside IT risk in the same
  visual panel — the heatmap's smoothing makes
  cross-mixing more dangerous than for markers / H3.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented ES RBA contract
from
[`~/.cursor/skills/splunk-rba/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-rba.mdc)
and the A&I lookup conventions in
[`~/.cursor/skills/splunk-enterprise-security/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-enterprise-security.mdc),
and reuses the same canonical
`eventstats max + log10 eval normalise` heat-weight pattern
as every other heat recipe in the matrix
([cim-network-traffic/heat](../cim-network-traffic/heat.md),
[netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md),
[splunk-stream/heat](../splunk-stream/heat.md),
[ot-datastreamer/heat](../ot-datastreamer/heat.md),
[meraki/heat](../meraki/heat.md),
[kvstore-latlon/heat](../kvstore-latlon/heat.md)). It has
NOT been dispatched against a tenant carrying both ES
licence AND a lat/lon-extended A&I lookup. A maintainer
with REST auth to such a tenant should:

1. Verify the A&I extension is in place: `| inputlookup
   identity_lookup_expanded | where isnotnull(lat) | stats
   count`.
2. Confirm the `risk` index has data: `` | `risk`
   earliest=-24h | stats count ``.
3. Run the recipe SPL and confirm the panel renders heat
   blobs over the customer's site regions with sensible
   intensity gradients.
4. Render the markers / H3 / heat panels side by side and
   confirm the hottest heat regions correspond to the
   loudest markers / fullest H3 cells (sanity check on the
   log-scale normalisation, the `head 5000` truncation,
   and the cross-layer consistency).
5. Vary `heatmapRadius` between 16 and 48 to find the
   sweet spot for the tenant's geographic footprint
   (concentrated single-region tenants: 16-24; multi-
   continent enterprises: 32-48).
6. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "SplunkEnterpriseSecuritySuite"`), and submit a
   follow-up PR.
