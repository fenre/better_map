---
schema_version: 1
id: ot-datastreamer--supercluster
source:
  id: ot-datastreamer
  display_name: "OT Datastreamer / Edge Hub (Modbus / OPC-UA / BACnet)"
  pattern: splunk-edge-hub
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-23"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_oti"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "HUB-PLANT-A-01"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "29.7604"
  - name: lon
    type: number
    example: "-95.3698"
  - name: hub_name
    type: string
    example: "Plant A Process Floor Hub 01"
  - name: site_id
    type: string
    example: "SITE-PLANT-A"
  - name: zone_purdue_level
    type: string
    example: "L2"
  - name: safety_related
    type: string
    example: "N"
  - name: event_count
    type: integer
    example: "8473"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, markers layer (per-appliance liveness)"
    path: "docs/recipes/ot-datastreamer/markers.md"
  - description: "Companion recipe — same source, heatmap layer (smooth telemetry-density)"
    path: "docs/recipes/ot-datastreamer/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (per-region roll-up)"
    path: "docs/recipes/ot-datastreamer/h3.md"
  - description: "Companion recipe — same source, paths layer (mobile-asset trajectories)"
    path: "docs/recipes/ot-datastreamer/paths.md"
  - description: "Pattern reference — supercluster for OT inventory (Cyber Vision)"
    path: "docs/recipes/cyber-vision/supercluster.md"
  - description: "Pattern reference — supercluster with operator-maintained site lookup"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "splunk-edge-hub skill — Edge Hub indexes, sourcetypes, per-appliance ingest patterns"
    path: "~/.cursor/skills/splunk-edge-hub/SKILL.md"
  - description: "splunk-oti-datastreamer skill — OTI Datastreamer ingest pipeline, HEC tuning"
    path: "~/.cursor/skills/splunk-oti-datastreamer/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive collection, SIS read-only, Purdue boundary)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "Clusters layer source — supercluster index, clusterMaxZoom=14, clusterRadius=48 (hardcoded)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# OT Datastreamer / Edge Hub — supercluster

Render every Edge Hub appliance across a multi-plant OT fleet as
a **zoom-adaptive cluster** rather than per-appliance markers.
The right shape for **global-OT-NetOps panels** where Edge Hub
has been deployed across 50-500+ plants / refineries / substations
worldwide, and a per-marker panel collapses to overlapping dots
at world zoom.

Same `edge_hub_*` index union and operator-maintained
`edge_hub_sites.csv` lookup as the
[ot-datastreamer/markers](./markers.md), [heat](./heat.md),
[h3](./h3.md), and [paths](./paths.md) companions — but instead
of per-appliance pins (unreadable at world zoom on large global
fleets), per-site smooth heat blobs, regional H3 hexbins, or
mobile-asset trajectories, the recipe renders zoom-adaptive
cluster bubbles that resolve to individual appliances only when
the camera zooms in close to a single plant. The **5th layer
cell on the ot-datastreamer source row** — completing markers /
heat / h3 / paths / supercluster for OT Datastreamer.

**OT safety boundary (this recipe is `ot_safety_relevant:
true`).** Same contract as all ot-datastreamer companions: the
panel rests on the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
contract — passive collection only, SIS-related signals read-only,
no write-back to Level-0/1/2 zones, no SOAR actions wired to a
Level-0/1/2 target. The cluster bubble form is **VISUALLY
AGGREGATED** (one bubble may cover 50+ appliances at world zoom)
but EVERY safety rule still applies — and the visual aggregation
makes safety-flag handling MORE delicate, not less (see §6
Gotchas — a cluster bubble over a refinery may contain
`safety_related="Y"` appliances whose individual designation is
hidden by the count badge).

## 1. Source description

Same Splunk **Edge Hub / OTI Datastreamer** event union as the
companion [markers](./markers.md), [heat](./heat.md),
[h3](./h3.md), and [paths](./paths.md) recipes — the OR of every
`edge_hub_*` index plus the optional `bms` index, joined against
the operator-maintained `edge_hub_sites.csv` lookup for physical
lat / lon + Purdue level + safety classification.

The relevant distinction for THIS recipe: the panel renders
per-appliance cluster bubbles rather than per-appliance markers,
per-site heat blobs, regional H3 hexbins, or mobile-asset paths.
At world zoom the operator sees one "Houston Refinery: 23 hubs"
bubble; at refinery zoom the bubble explodes into
"Process Area A: 8 / Tank Farm B: 6 / Utilities C: 9"
sub-clusters; at floor zoom the sub-clusters resolve into
individual hub markers with the full per-appliance popup.

**Why supercluster for Edge Hub.** A markers panel works for
≤50-hub single-plant deployments but collapses on
multi-refinery / multi-substation global fleets where Edge Hub
can be deployed across 200-500+ plants. The H3 hexbin companion
solves the visual-density problem but H3 cells are stable across
zoom levels — operators cannot zoom into a single hex cell to
see the individual appliances. The heat companion shows per-site
density without per-appliance identity. The paths companion is
mobile-asset-specific (AGVs, vehicles, drones); for FIXED-
LOCATION Edge Hub appliances the trajectory is degenerate (one
point). Supercluster solves the world-zoom-density tradeoff:
zoom-adaptive cluster bubbles at extreme zoom-out, individual
markers at plant-zoom, full popup affordance preserved.

**Typical sourcetype / index:** anything matching `edge_hub_*`
plus the `bms` index (Building Management System events: HVAC,
power monitoring, occupancy sensors). The TA is `Splunk_TA_oti`.
The site lookup is the same operator-maintained
`edge_hub_sites.csv` used by all companions — no additional
lookup work needed if the markers / heat / h3 / paths companions
are already deployed.

## 2. SPL recipe

```spl
index=edge_hub_* OR index=bms earliest=-24h latest=now
| stats count AS event_count BY host
| lookup edge_hub_sites.csv host OUTPUT lat, lon, hub_name, site_id, zone_purdue_level, safety_related
| where isnotnull(lat) AND isnotnull(lon)
| eval safety_related=coalesce(safety_related, "N")
| eval zone_purdue_level=coalesce(zone_purdue_level, "L2")
| rename host AS id
| fields id, lat, lon, hub_name, site_id, zone_purdue_level, safety_related, event_count
| sort id
| head 5000
```

Why this exact shape, line by line:

- **`index=edge_hub_* OR index=bms earliest=-24h latest=now`** —
  same index union as all ot-datastreamer companions. 24-hour
  window catches every appliance that has emitted events in
  the last day; appliances that have been offline > 24h are
  silently dropped from the cluster panel (visible to the
  operator as a gap relative to the `edge_hub_sites.csv`
  registered set — surface in a companion KPI panel:
  "Registered hubs not heard from in 24h: <count>").
- **`| stats count AS event_count BY host`** — one row per
  hub. `event_count` flows through to the per-appliance popup
  (visible after the cluster fully expands) as an
  "events-in-window" liveness metric.
- **`| lookup edge_hub_sites.csv host OUTPUT lat, lon,
  hub_name, site_id, zone_purdue_level, safety_related`** —
  THE critical line. The operator-maintained site lookup
  (same contract as all ot-datastreamer companions).
  `zone_purdue_level` and `safety_related` are the OT-safety
  annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5 — read-only mirrored from the customer's Safety
  Requirements Specification. `hub_name` and `site_id` flow
  through for the popup (visible at zoom levels where
  individual markers resolve).
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drop hubs
  without site registration. The cluster index cannot include
  hubs without coordinates — they would silently disappear
  from the panel. Surface in a companion table panel ("Hubs
  lacking site registration: <count>") so the OT-asset team
  can backfill.
- **`| eval safety_related=coalesce(safety_related, "N")`** —
  defensive fallback. Hubs without an explicit `safety_related`
  flag in the lookup default to "N" (not safety-related). Per
  Rule 5, the OT-asset team SHOULD explicitly mark "Y" or "N"
  for every row in `edge_hub_sites.csv`; the coalesce is a
  safety-net to prevent NULL handling bugs, NOT an excuse to
  leave the lookup column unpopulated.
- **`| eval zone_purdue_level=coalesce(zone_purdue_level,
  "L2")`** — defensive fallback. Hubs without an explicit
  Purdue level default to "L2" (operations / SCADA-HMI zone),
  the safe assumption for a typical Edge Hub appliance which
  collects from L1 PLCs/sensors and forwards to L3 historian /
  L4 IT. Document the convention in the panel description so
  operators don't mistake "L2 (default)" for "L2 (verified)".
- **`| rename host AS id`** — Better Map's canonical `id`
  alias. The Edge Hub `host` field is the per-appliance
  hostname (e.g. `hub-plant-a-01`), which doubles as the
  per-row unique key.
- **`| fields ...`** — explicit projection. Drops Edge Hub
  envelope fields (`source`, `sourcetype`, `index`, raw
  `_raw`) and any per-event detail fields that don't help
  the cluster bubble or popup. Drilldown to the markers
  companion for the full-detail per-appliance view.
- **`| sort id`** — alphabetical-by-hub for stable rendering.
  The cluster expansion order is stable across re-renders.
- **`| head 5000`** — render budget. The supercluster index
  scales to ~250k features per the layers reference. A
  5000-hub deployment is the high end of normal Edge Hub
  capacity (~50 plants × 100 hubs per plant). Capping at
  5000 prevents browser-OOM on accidental scope expansion.
  Raise to 25k for true global-mega-deployments (500+
  plants).

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field             | type    | example                       |
|-------------------|---------|-------------------------------|
| id                | string  | HUB-PLANT-A-01                |
| lat               | number  | 29.7604                       |
| lon               | number  | -95.3698                      |
| hub_name          | string  | Plant A Process Floor Hub 01  |
| site_id           | string  | SITE-PLANT-A                  |
| zone_purdue_level | string  | L2                            |
| safety_related    | string  | N                             |
| event_count       | integer | 8473                          |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`hub_name`, `site_id`, `zone_purdue_level`, `safety_related`,
`event_count` flow through to the per-appliance popup (visible
when the user fully zooms into a cluster and clicks a marker).
The cluster bubble itself shows ONLY the per-cluster count badge
— per-appliance identity, Purdue level, and safety classification
are NOT visible at the cluster level.

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
  `cluster` preserves the per-appliance drilldown affordance
  heatmap loses.
- **`idField: "id"`** — explicit. Same alignment as the
  markers companion §4 — making `id` explicit avoids any
  field-auto-detect ambiguity at drilldown time.

For Purdue-level-tinted cluster pills (red for clusters
containing any L1 / L0 appliance), pair this panel with a
companion correlation search that drives a separate alert-context
overlay — a v1.8 candidate. The minimal cluster panel as-shipped
is the right starting point for the global-OT overview.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The cluster renderer is best demoed with the camera at
country-level zoom (so most appliances are clustered into
per-plant bubbles) AND the user then zooming in to a single
refinery (so clusters expand to per-area sub-clusters,
demonstrating the multi-level drilldown affordance). For OT
recipes specifically, the deferred verification path is to
dispatch against a customer pilot tenant (E4) under a
non-production Edge Hub deployment rather than a synthetic
generator. The site lookup must be authored by the customer's
OT-asset team — Better Map ships nothing._

## 6. Gotchas

- **OT safety — passive collection.** Same contract as all
  ot-datastreamer companions — Edge Hub appliances are
  passive collectors per ot-safety Rule 1. This recipe
  consumes Edge Hub's already-passive event stream — it does
  NOT itself probe the OT zone. The supercluster rendering
  is a VIEW operation, not a collection operation.
- **OT safety — safety-related appliances are visually
  undifferentiated in the cluster bubble.** A cluster bubble
  over a refinery with 23 hubs (including 4
  safety_related="Y" hubs at the SIS-adjacent process areas)
  shows ONLY the count badge — the safety designation is NOT
  visible at the cluster level. To highlight safety-related
  appliances at panel-load time, pair this cluster panel with
  a companion Single-Value panel that filters on
  `safety_related="Y"` and displays the count prominently
  (and tints the dashboard's border / header in amber).
  Operators MUST be aware of safety-related appliance density
  before taking any panel-driven action (network maintenance,
  remote restart, firmware push — none of which Better Map
  itself can trigger, but all of which a downstream SOAR /
  ServiceNow workflow might).
- **OT safety — SOAR action scope.** Per Rule 3, any SOAR
  playbook triggered by this panel must keep containment
  actions in the IT zone. NEVER auto-push a containment
  action (firewall block, port shutdown, traffic shape) to
  an Edge Hub serving an L1/L0 zone via SOAR; require human
  + OT-engineering approval for any OT-zone enforcement step.
  This is doubly important when the cluster contains
  `safety_related="Y"` appliances — even seemingly-benign
  containment can destabilize the BPCS↔SIS independence
  required by IEC 61511 §9 and IEC 62443.
- **OT safety — `zone_purdue_level` is metadata-only at the
  cluster level.** The cluster bubble does not visually
  distinguish L4 / L3 / L2 / L1 / L0 appliances — they all
  contribute to the same count badge. For Purdue-level-
  segregated views, build SEPARATE supercluster panels filtered
  to specific Purdue levels (`| where zone_purdue_level="L1"`,
  etc.) and put them side-by-side in a Dashboard Studio
  dashboard. The per-level view makes the L1 / L0 attack
  surface visually distinct from the L2 / L3 ops infrastructure.
- **`edge_hub_sites.csv` schema unchanged.** Same lookup as
  all ot-datastreamer companions — see
  [ot-datastreamer/markers §6](./markers.md#6-gotchas) for
  the full schema. Required columns: `host`, `lat`, `lon`,
  `hub_name`, `site_id`, `zone_purdue_level`, `safety_related`.
- **Cluster bubbles don't carry per-appliance liveness colour.**
  The cluster bubble shows ONLY the count badge — the
  `event_count` per-hub is visible only after the user expands
  the cluster to individual markers. For an "how many hubs are
  silent across the fleet" KPI, pair this panel with a
  companion Single-Value panel that runs the registered-vs-
  active comparison: `| inputlookup edge_hub_sites.csv | stats
  count AS registered | appendcols [search index=edge_hub_* OR
  index=bms earliest=-1h latest=now | stats dc(host) AS active]
  | eval silent=registered-active`.
- **Cluster expansion preserves the popup contract.** When the
  user zooms in and a cluster expands to individual markers,
  each marker carries the full popup (id, hub_name, site_id,
  zone_purdue_level, safety_related, event_count). The same
  popup shape as the markers companion — this recipe is purely
  a rendering swap, not a popup-affordance change.
- **`pointRenderer: "cluster"` is irreversible per panel.**
  Once pinned, the renderer will never switch to heatmap or
  markers regardless of feature count. For a panel that
  should adapt to feature count, leave the default
  `pointRenderer: "auto"`. The recipe pins for "always
  cluster" semantics because that's the audience expectation
  for a global OT overview.
- **Cluster tuning defaults are hardcoded.** Same constraint
  as [cyber-vision/supercluster](../cyber-vision/supercluster.md) §6
  and [meraki/supercluster](../meraki/supercluster.md) §6 —
  `clusterMaxZoom` (14) and `clusterRadius` (48 pixels) are
  not yet formatter-exposed. For very dense single-refinery
  views where neighbouring hubs ~10m apart should NOT cluster
  together, the only current workaround is to edit
  `src/lib/layers/clusters.js` and rebuild the visualization
  bundle. v1.8+ will expose these as formatter options.
- **Time range vs hub liveness.** Hard-coded `earliest=-24h
  latest=now`. Longer windows include more hubs (catches the
  appliance that emits hourly summaries vs the appliance that
  emits per-event); shorter windows exclude silent hubs (which
  may itself be the signal — a silent OT hub is a
  high-attention-grabber). For a "fleet liveness" panel,
  shorten to `-1h` to surface silent hubs; for a "scope of
  deployment" panel, lengthen to `-7d` to catch
  monthly-summary appliances.
- **PII / GDPR posture.** Edge Hub hostnames typically embed
  plant-floor semantics (e.g. `hub-plant-a-process-floor-01`);
  restrict via Splunk RBAC on the `edge_hub_*` indexes for
  audiences without "see OT appliance naming" authorisation.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented Edge Hub sourcetype shape from
[`~/.cursor/skills/splunk-edge-hub/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-edge-hub/SKILL.md),
and uses the same operator-maintained site lookup pattern as all
ot-datastreamer companions. Verification path mirrors the
[markers companion](./markers.md) §"Verification status" —
confirm `edge_hub_sites.csv` is in place, confirm events are
flowing from at least one Edge Hub appliance, dispatch via REST,
drop into a Dashboard Studio panel with the §4 formatter JSON,
confirm cluster bubbles render at world zoom and split correctly
when zooming. **Per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, this OT-safety-relevant recipe should be
verified against a customer pilot tenant (E4) with real
operator-curated annotations** — not a synthetic generator.
Promote to `status: verified` + fill in `verified_against`
(include `splunk_app: "Splunk_TA_oti"` and a non-PII tenant
identifier) in a follow-up PR.
