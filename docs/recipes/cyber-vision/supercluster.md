---
schema_version: 1
id: cyber-vision--supercluster
source:
  id: cyber-vision
  display_name: "Cisco Cyber Vision (components + vulnerabilities)"
  pattern: splunk-vendor-ta
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: "TA-cisco-cybervision"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "PLC-FLOOR3-A02"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "29.7604"
  - name: lon
    type: number
    example: "-95.3698"
  - name: asset_name
    type: string
    example: "PLC-FLOOR3-A02"
  - name: vendor
    type: string
    example: "Siemens"
  - name: zone_purdue_level
    type: string
    example: "L1"
  - name: safety_related
    type: string
    example: "Y"
  - name: site_name
    type: string
    example: "Houston Refinery"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, markers layer (per-asset CVE + event overview)"
    path: "docs/recipes/cyber-vision/markers.md"
  - description: "Companion recipe — same source, heatmap layer (asset-density per site)"
    path: "docs/recipes/cyber-vision/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (per-zone CVE roll-up)"
    path: "docs/recipes/cyber-vision/h3.md"
  - description: "Companion recipe — same source, paths layer (OT lateral movement)"
    path: "docs/recipes/cyber-vision/paths.md"
  - description: "Pattern reference — supercluster with operator-maintained site lookup"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Pattern reference — supercluster for vendor-TA inventory"
    path: "docs/recipes/meraki/supercluster.md"
  - description: "cisco-products skill — Cisco Cyber Vision sourcetypes, components/flows/events/vulnerabilities"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "cisco-splunk-integration skill — Cyber Vision passive DPI, API endpoints, integration patterns"
    path: "~/.cursor/skills/cisco-splunk-integration/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive DPI is the reference design, Rule 1)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "Clusters layer source — supercluster index, clusterMaxZoom=14, clusterRadius=48 (hardcoded)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# Cisco Cyber Vision — supercluster

Render every OT asset discovered by Cisco Cyber Vision as a
**zoom-adaptive cluster** rather than per-asset markers. The
right shape for **multi-site OT-NetOps panels** where Cyber
Vision has discovered 500-5000+ assets across multiple
plants / refineries / substations, and a per-marker panel
collapses to a sea of overlapping dots at world zoom.

Same `cisco:cybervision:components` source as the
[cyber-vision/markers](./markers.md), [heat](./heat.md), and
[h3](./h3.md) companions — but instead of per-asset markers
(unreadable at world zoom on large multi-site fleets), the
recipe renders zoom-adaptive cluster bubbles that resolve to
individual assets only when the camera zooms in close to a
single site. The **5th layer cell on the cyber-vision source
row** — completing markers / heat / h3 / paths / supercluster
for Cyber Vision.

Strict adherence to
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc):
Cyber Vision is the **reference passive-DPI design** per
Rule 1; this recipe surfaces its discoveries without ever
querying the OT zone.

## 1. Source description

Same **Cisco Cyber Vision** + **`TA-cisco-cybervision`** add-on
source as all cyber-vision companions — see
[cyber-vision/markers §1](./markers.md#1-source-description) for
the platform overview, the four-sourcetype contract
(`components`, `flows`, `events`, `vulnerabilities`), and the
operator-maintained `cybervision_sites.csv` lookup contract.

The relevant distinction for THIS recipe: it reads ONLY the
`components` sourcetype (drops the vulnerabilities and events
joins from the markers companion) and renders cluster bubbles
instead of per-asset markers. The simpler SPL keeps the recipe
fast on large multi-sensor fleets (5000+ assets) where the
markers companion's join cardinality can saturate the search
head.

**Why supercluster for Cyber Vision.** A markers panel works for
≤200-asset single-site deployments but collapses on multi-site
refineries / utility-substation networks where Cyber Vision can
discover 1000-5000+ assets across 10-50 plants. The H3 hexbin
companion solves the visual-density problem but H3 cells are
stable across zoom levels — operators cannot zoom into a single
hex cell to see the individual assets. The heat companion shows
density without per-asset identity. Supercluster solves the
zoom-density tradeoff: at world zoom you see one "Houston
Refinery: 247 assets" cluster bubble, at refinery zoom the
bubble explodes into "Process Area A: 47 assets / Tank Farm B:
12 assets" sub-clusters, and at floor-zoom the sub-clusters
explode further into individual asset markers with full
per-asset popup affordance.

**Typical sourcetype / index:** `sourcetype="cisco:cybervision:components"`,
`index=cybervision`. The TA is `TA-cisco-cybervision`. The
site lookup is the same operator-maintained `cybervision_sites.csv`
used by all companions — no additional lookup work needed if
the markers / heat / h3 / paths companions are already deployed.

## 2. SPL recipe

```spl
index=cybervision sourcetype="cisco:cybervision:components" earliest=-24h latest=now
| dedup asset_id sortby - _time
| rename asset_id AS id,
         asset_name AS asset_name,
         asset_vendor AS vendor,
         asset_type AS type
| lookup cybervision_sites.csv asset_id AS id
    OUTPUT lat,
           lon,
           zone_purdue_level,
           safety_related,
           site_name
| where isnotnull(lat) AND isnotnull(lon)
| eval status=coalesce(status, "unknown")
| eval safety_related=coalesce(safety_related, "N")
| fields id, lat, lon, asset_name, vendor, type, zone_purdue_level, safety_related, site_name, status
| sort id
| head 5000
```

Why this exact shape, line by line:

- **`index=cybervision sourcetype="cisco:cybervision:components"
  earliest=-24h latest=now`** — components stream over 24h.
  Cyber Vision re-publishes the asset inventory on changes
  (default every 5 min for modified records); 24h guarantees
  every active asset is in the sample.
- **`dedup asset_id sortby -_time`** — one row per asset
  (the freshest record). Cyber Vision re-publishes the entire
  asset record on changes, so the freshest row carries the
  current vendor / model / firmware / IP / MAC.
- **`rename asset_id AS id, ...`** — adopt Better Map's `id`
  alias up front. `asset_name`, `vendor`, `type` flow through
  to the per-asset popup (visible after the user fully zooms
  into a cluster and clicks a marker).
- **`lookup cybervision_sites.csv asset_id AS id OUTPUT lat,
  lon, zone_purdue_level, safety_related, site_name`** — THE
  critical line. The operator-maintained site lookup (same
  contract as all cyber-vision companions). `zone_purdue_level`
  and `safety_related` are the OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5 — read-only mirrored from the customer's Safety
  Requirements Specification. `site_name` flows through for
  the cluster popup (visible at zoom levels where individual
  markers resolve).
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop assets
  without site registration. The cluster index cannot include
  assets without coordinates — they would silently disappear.
  Surface in a companion table panel ("Assets lacking site
  registration: <count>") so the OT-asset team can backfill.
- **`eval status=coalesce(status, "unknown")`** — defensive
  fallback for newly-discovered assets that haven't reported
  status yet.
- **`eval safety_related=coalesce(safety_related, "N")`** —
  defensive fallback. Assets without an explicit
  `safety_related` flag in the lookup default to "N" (not
  safety-related). For unambiguous safety-relevance tracking,
  the OT-asset team should explicitly mark "Y" or "N" for
  every row in `cybervision_sites.csv` (per Rule 5).
- **`fields ... ` ** — explicit projection. Drops asset_model,
  mac, ip, firmware, protocols, and other fields not needed
  for the cluster popup. Drilldown to the markers companion
  for the full-detail per-asset view.
- **`sort id`** — alphabetical-by-asset for stable rendering.
  The cluster expansion order (which asset appears "first"
  when a cluster expands to reveal its members) is stable
  across re-renders.
- **`head 5000`** — render budget. The supercluster index
  scales to ~250k features per the layers reference, but a
  5000-asset Cyber Vision deployment is at the high end of
  normal sensor capacity (one sensor per plant; 5-10 sensors
  per multi-site SOC view). Capping at 5000 prevents
  browser-OOM on accidental scope expansion. Raise to 25k
  for true global-operator deployments (50+ sensors).

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field             | type   | example          |
|-------------------|--------|------------------|
| id                | string | PLC-FLOOR3-A02   |
| lat               | number | 29.7604          |
| lon               | number | -95.3698         |
| asset_name        | string | PLC-FLOOR3-A02   |
| vendor            | string | Siemens          |
| zone_purdue_level | string | L1               |
| safety_related    | string | Y                |
| site_name         | string | Houston Refinery |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`asset_name`, `vendor`, `type`, `zone_purdue_level`,
`safety_related`, `site_name`, `status` flow through to the
per-asset popup (visible when the user fully zooms into a
cluster and clicks a marker). The cluster bubble itself shows
ONLY the per-cluster count badge.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — explicit pin to the cluster
  renderer (the supercluster-backed strategy per the layers
  reference). The default `pointRenderer: "auto"` would
  already switch to cluster at 200+ features, but pinning is
  explicit and survives any zoom-level change. For ≥10000
  features `auto` would switch to heatmap — pinning to
  `cluster` preserves the per-asset drilldown affordance
  heatmap loses.
- **`idField: "id"`** — explicit. Same alignment as the
  markers companion §4 — the SPL assembles `id` from
  `asset_id` so making it explicit avoids any field-auto-
  detect ambiguity at drilldown time.

For severity-tinted cluster pills (red for clusters containing
any high-CVSS asset), pair this panel with a companion
correlation search that drives a separate alert-context overlay
— a v1.8 candidate. The minimal cluster panel as-shipped is the
right starting point for the multi-site OT overview.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The cluster renderer is best demoed with the camera at
country-level zoom (so most assets are clustered into per-plant
bubbles) AND the user then zooming in to a single refinery (so
clusters expand to per-area sub-clusters, demonstrating the
multi-level drilldown affordance). For OT recipes specifically,
the deferred verification path is to dispatch against a customer
pilot tenant (E4) under a non-production Cyber Vision sensor
rather than a synthetic generator. The site lookup must be
authored by the customer's OT-asset team — Better Map ships
nothing._

## 6. Gotchas

- **OT safety — passive DPI is the REFERENCE DESIGN.** Same
  contract as all cyber-vision companions — Cyber Vision is
  explicitly named in
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 as the reference design for passive OT collection.
  This recipe consumes Cyber Vision's already-passive asset
  inventory — it does NOT itself probe the OT zone.
- **OT safety — safety-related assets are visually undifferentiated
  in the cluster bubble.** A cluster bubble over a refinery
  with 247 assets (including 47 safety-related SIL-rated
  assets) shows ONLY the count badge — the `safety_related="Y"`
  designation is NOT visible at the cluster level. To
  highlight safety-related assets at panel-load time, pair
  this cluster panel with a companion Single-Value panel that
  filters on `safety_related="Y"` and displays the count
  prominently (and tints the dashboard's border / header in
  amber). Operators MUST be aware of safety-related asset
  density before taking any panel-driven action.
- **OT safety — SOAR action scope.** Per Rule 3, any SOAR
  playbook triggered by this panel must keep containment
  actions in the IT zone. NEVER auto-push a containment
  action into the OT zone via SOAR; require human + OT-
  engineering approval for any OT-zone enforcement step.
  This is doubly important when the cluster contains
  `safety_related="Y"` assets — even seemingly-benign
  containment (network isolation, traffic-rate-limit) can
  destabilize the BPCS↔SIS independence required by
  IEC 61511 §9 and IEC 62443.
- **`cybervision_sites.csv` schema unchanged.** Same lookup
  as all cyber-vision companions — see
  [cyber-vision/markers §6](./markers.md#6-gotchas) for the
  full schema. Required columns: `asset_id`, `lat`, `lon`,
  `zone_purdue_level`, `safety_related`, `site_name`.
- **Cluster bubbles don't carry per-asset status colour.**
  The cluster bubble shows ONLY the count badge — the
  `status` field is visible only after the user expands the
  cluster to individual markers. For an "how many assets
  are offline across the fleet" KPI, pair this panel with
  a companion Single-Value panel that runs `| stats
  count(eval(status="offline")) AS offline_count` on the
  same data.
- **Cluster expansion preserves the popup contract.** When
  the user zooms in and a cluster expands to individual
  markers, each marker carries the full popup (id,
  asset_name, vendor, zone_purdue_level, safety_related,
  site_name, status). The same popup shape as the markers
  companion — this recipe is purely a rendering swap, not a
  popup-affordance change.
- **`pointRenderer: "cluster"` is irreversible per panel.**
  Once pinned, the renderer will never switch to heatmap or
  markers regardless of feature count. For a panel that
  should adapt to feature count, leave the default
  `pointRenderer: "auto"`. The recipe pins for "always
  cluster" semantics because that's the audience
  expectation for a multi-site OT overview.
- **Cluster tuning defaults are hardcoded.** Same constraint
  as [meraki/supercluster](../meraki/supercluster.md) §6 —
  `clusterMaxZoom` (14) and `clusterRadius` (48 pixels)
  are not yet formatter-exposed. For very dense single-
  refinery views where neighbouring assets ~10m apart
  should NOT cluster together, the only current workaround
  is to edit `src/lib/layers/clusters.js` and rebuild the
  visualization bundle. v1.8+ will expose these as formatter
  options.
- **`type` cardinality is high.** Cyber Vision discovers
  Engineering Stations, HMIs, PLCs, RTUs, Historians, OPC
  servers, network switches, firewalls, jump hosts, and
  more. Each asset type has different OT-safety relevance.
  For a per-type filter dropdown, expose `type` as a panel
  input token.
- **Time range.** Hard-coded `earliest=-24h latest=now`.
  Longer windows multiply dedup cost but don't change the
  output (one row per asset regardless of window). The 24h
  default catches any asset that has been seen in the last
  day even if it's currently offline.
- **PII / GDPR posture.** Same as
  [cyber-vision/markers §6](./markers.md#6-gotchas) — asset
  names embed plant-floor semantics (e.g.,
  `PLC-FLOOR3-A02`); restrict via Splunk RBAC on the
  `cybervision` index for audiences without "see OT asset
  naming" authorisation.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented Cyber Vision
sourcetype shape from
[`~/.cursor/skills/cisco-products/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/skills/cisco-products/SKILL.md),
and uses the same operator-maintained site lookup pattern as
all cyber-vision companions. Verification path mirrors the
[markers companion](./markers.md) §"Verification status" —
confirm site lookup is in place, confirm components are
flowing, dispatch via REST, drop into a Dashboard Studio
panel with the §4 formatter JSON, confirm cluster bubbles
render at world zoom and split correctly when zooming.
**Per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, this OT-safety-relevant recipe should
be verified against a customer pilot tenant (E4) with real
operator-curated annotations** — not a synthetic generator.
Promote to `status: verified` + fill in `verified_against`
(include `splunk_app: "TA-cisco-cybervision"` and a non-PII
tenant identifier) in a follow-up PR.
