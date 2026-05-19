---
schema_version: 1
id: meraki--supercluster
source:
  id: meraki
  display_name: "Cisco Meraki (devices)"
  pattern: splunk-vendor-ta
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_cisco_meraki"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "Q2KD-XXXX-YYYY"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: name
    type: string
    example: "SFO-Office-MR46-12"
  - name: model
    type: string
    example: "MR46"
  - name: status
    type: string
    example: "online"
  - name: network_name
    type: string
    example: "SFO Corporate"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-AP identity at all zooms)"
    path: "docs/recipes/meraki/markers.md"
  - description: "Companion recipe — same source, heatmap layer (smooth AP density)"
    path: "docs/recipes/meraki/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (jurisdictional sum-aggregation)"
    path: "docs/recipes/meraki/h3.md"
  - description: "Pattern reference — supercluster with CSV-lookup-anchored points"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Pattern reference — supercluster on indexed network traffic"
    path: "docs/recipes/cim-network-traffic/supercluster.md"
  - description: "Pattern reference — supercluster on KV-Store-anchored sites"
    path: "docs/recipes/kvstore-latlon/supercluster.md"
  - description: "Cisco Meraki TA setup skill"
    path: "~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md"
  - description: "Layer reference — cluster"
    path: "docs/reference/layers.md"
  - description: "Clusters layer source — supercluster index, clusterMaxZoom=14, clusterRadius=48 (hardcoded)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# Cisco Meraki (devices) — supercluster

Render every deployed Meraki device (MR access point, MS switch,
MX security appliance, MV camera, MT sensor) as a **zoom-
adaptive cluster** rather than per-device markers. Same
`meraki:devices` inventory source as the
[meraki/markers](./markers.md),
[heat](./heat.md), and
[h3](./h3.md) companions — but instead of rendering one marker
per device (which collapses to overlapping dots at world zoom
on a multi-thousand-device enterprise deployment), the renderer
groups nearby devices into a cluster bubble with a per-cluster
count badge, and the bubble expands to individual devices when
the user zooms in to a high-density site.

The right shape for **multi-campus enterprise NetOps panels**
where the Meraki fleet spans 50-500+ sites with 5-50 devices
per site. Distinct from the markers companion (1000+ overlapping
dots at world zoom are unreadable), the heat companion (smooth
density without per-device identity affordance), and the h3
companion (hard-bordered jurisdictional aggregation, not zoom-
adaptive). This is the **4th layer cell on the meraki source
row**, completing markers / heat / h3 → markers / heat / h3 /
supercluster.

## 1. Source description

Same **Cisco Meraki Add-on for Splunk** (`Splunk_TA_cisco_meraki`,
Splunkbase ID 5580) source as the markers / heat / h3 companions
— see [meraki/markers §1](./markers.md#1-source-description)
for the data model background. The relevant distinction for
THIS recipe: instead of rendering one marker per Meraki device
(unreadable at world zoom on a >500-device enterprise), the
recipe renders zoom-adaptive cluster bubbles that resolve to
individual devices only when the camera zooms in close.

**Why supercluster for Meraki.** A markers panel works for
small (<200-device) deployments but collapses to a sea of
overlapping dots on large multi-campus enterprises. A heatmap
panel solves the visual-density problem but loses per-AP
identity (you can't click an AP from a hot blob). An H3 hexbin
solves the jurisdictional aggregation problem but hex cells
are stable at all zooms (don't reshuffle as you zoom in).
Supercluster solves the zoom-density tradeoff: at world zoom
you see one "SFO cluster: 47 APs" bubble, at city zoom the
bubble explodes into "SFO Building 3: 12 APs / SFO Building
12: 18 APs" sub-clusters, and at street zoom the sub-clusters
explode further into individual AP markers with full per-
device popup affordance.

**Typical sourcetype / index:** `sourcetype="meraki:devices"`,
`index=meraki` (both are the TA defaults; see the markers
companion for the broader catalogue of input groups).

## 2. SPL recipe

```spl
index=meraki sourcetype="meraki:devices" earliest=-1h latest=now
| dedup serial sortby - _time
| where isnotnull(lat) AND isnotnull(lng)
| rename serial AS id, lng AS lon, networkName AS network_name
| eval status=coalesce(status, "unknown")
| fields id, lat, lon, name, model, status, network_name
| sort id
| head 5000
```

Why this exact shape, line by line:

- **`index=meraki sourcetype="meraki:devices" earliest=-1h latest=now`** —
  identical base search to the
  [markers companion §2](./markers.md#2-spl-recipe). The
  supercluster recipe does NOT change the SPL — it changes
  the FORMATTER. The SPL produces per-AP rows; the cluster
  renderer groups them into bubbles at runtime.
- **`dedup serial sortby - _time`** — one row per Meraki
  device (the freshest snapshot). The devices input polls
  every 600s by default and re-publishes identical records;
  dedup keeps only the freshest. The cluster index is built
  on the deduplicated row set.
- **`where isnotnull(lat) AND isnotnull(lng)`** — drop
  devices without a configured location (Meraki Dashboard
  stores `lat`/`lng` from device self-reporting OR operator
  manual placement; devices without either come through
  with NULLs). Devices without coords cannot contribute to
  a cluster bubble — they would silently disappear from the
  panel without a defensive filter.
- **`rename serial AS id, lng AS lon, networkName AS network_name`** —
  adopt Better Map's canonical aliases. `serial` → `id` is
  the per-device drilldown key (visible on the popup that
  appears after the user fully zooms into a cluster), and
  `lng` → `lon` is the Meraki API's longitude field
  normalised to Better Map's standard alias.
- **`eval status=coalesce(status, "unknown")`** — defensive
  fallback. Meraki Dashboard rarely emits NULL status, but
  newly-onboarded devices that haven't checked in yet can
  show up with status missing; the fallback prevents NULL
  styling errors in the popup.
- **`fields id, lat, lon, name, model, status, network_name`** —
  explicit projection. Drops `serial` (renamed to `id`),
  `productType`, `firmware`, `mac`, `address`, `notes`,
  `tags`, `configurationUpdatedAt`, `lanIp`, `wan1Ip`,
  `wan2Ip`, `url` — all secondary fields that don't help
  the cluster bubble. These secondary fields are visible
  in the markers companion for full-detail per-AP popup
  but the cluster recipe keeps the projection lean.
- **`sort id`** — alphabetical-by-serial for stable
  rendering. The cluster expansion order (which point
  appears "first" when a cluster expands to reveal its
  members) is stable across re-renders.
- **`head 5000`** — render budget. The supercluster index
  scales to ~250k features per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md);
  but a 5000-AP enterprise is at the upper end of normal
  Meraki deployments (~50 sites × ~100 APs/site), and
  capping at 5000 prevents browser-OOM on accidental scope
  expansion. Raise to 25k for true global-enterprise
  Meraki deployments (1000+ sites).

Every `|` starts its own physical line per the SPL pipe-per-
line contract.

## 3. Expected fields

| field        | type   | example              |
|--------------|--------|----------------------|
| id           | string | Q2KD-XXXX-YYYY       |
| lat          | number | 37.7749              |
| lon          | number | -122.4194            |
| name         | string | SFO-Office-MR46-12   |
| model        | string | MR46                 |
| status       | string | online               |
| network_name | string | SFO Corporate        |

All seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`name`, `model`, `status`, `network_name` flow through to the
per-device popup (visible when the user fully zooms into a
cluster and clicks a marker). The cluster bubble itself shows
ONLY the per-cluster count badge — the per-device popup is the
drilldown affordance.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — explicit pin to the
  cluster renderer (the supercluster-backed strategy per
  the layers reference). The default `pointRenderer: "auto"`
  would already switch to cluster at 200+ features, but
  pinning is explicit and survives zoom-level changes. For
  ≥10000 features `auto` would switch to heatmap — pinning
  to `cluster` preserves the per-AP drilldown affordance
  heatmap loses.
- **Cluster tuning (`clusterMaxZoom`, `clusterRadius`) is
  currently hardcoded** in the
  [clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js)
  at 14 / 48 respectively. These defaults are the empirical
  visual sweet spot (clusters big enough to read the count
  label, small enough to resolve neighbouring office-level
  groupings; expansion at street-level zoom). Exposing them
  as formatter options is a v1.8+ candidate — see §6 Gotchas
  for the rationale and the temporary code-level customization
  path.
- **`status`, `model`, `name`, `network_name` flow through
  automatically** as feature properties on each rendered
  point — popups (on a marker click after cluster
  expansion) can reference them by name.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). The cluster renderer is best demoed with the
camera at country-level zoom (so most APs are clustered) AND
the user then zooming in to a single campus (so clusters
expand to per-building sub-clusters, demonstrating the multi-
level drilldown affordance). Reproduces the panel via the same
`Splunk_TA_cisco_meraki` + `meraki:devices` setup as the
[markers companion](./markers.md#5-screenshot)._

## 6. Gotchas

- **AP location data quality depends on the Meraki
  Dashboard.** Meraki devices self-report their position
  to the cloud via beaconing on first-power-up; the cloud
  geocodes the position OR the operator manually drags the
  device onto the Dashboard map view. Devices that beacon
  from inside a building with poor GPS reception (basement,
  underground parking, server room) often resolve to an
  approximate coordinate ~50-500m off; this is acceptable
  for cluster-bubble grouping but the per-device drilldown
  may show the AP at a slightly-off location. For high-
  fidelity AP placement, ensure operators manually adjust
  the Dashboard map view after onboarding.
- **`pointRenderer: "cluster"` is irreversible per panel.**
  Once pinned, the renderer will never switch to heatmap or
  markers regardless of feature count. For a panel that
  should adapt to feature count, leave the default
  `pointRenderer: "auto"`. The recipe pins for "always
  cluster" semantics because that's the audience
  expectation for a multi-campus NetOps overview.
- **Cluster tuning defaults are hardcoded.** `clusterMaxZoom`
  (14) and `clusterRadius` (48 pixels) are not yet
  formatter-exposed. For a denser campus where neighbouring
  APs across narrow streets should NOT cluster together,
  the only current workaround is to edit
  `src/lib/layers/clusters.js` and rebuild the visualization
  bundle. For most enterprise deployments the defaults are
  appropriate (clusters big enough to read, small enough to
  expand at street zoom). v1.8+ will expose these as
  `clusterMaxZoom` / `clusterRadius` formatter options.
- **Cluster bubbles don't carry per-device status colour.**
  The cluster bubble shows ONLY the count badge — the
  `status` field (online / alerting / offline / dormant)
  is visible only after the user expands the cluster to
  individual markers. For a "how many APs are alerting
  across the fleet" KPI, pair this panel with a companion
  Single-Value panel that runs
  `| stats count(eval(status="alerting")) AS alerting_count`
  on the same data. The cluster panel itself is for
  "where are the APs" not "what's their health".
- **Cluster expansion preserves the popup contract.**
  When the user zooms in and a cluster expands to
  individual markers, each marker carries the full popup
  (id, name, model, status, network_name). The same popup
  shape as the markers companion — this recipe is purely
  a rendering swap, not a popup-affordance change.
- **Multi-tenant index naming.** Some Splunk Cloud stacks
  prefix the Meraki index (e.g. `cisco_meraki_<tenant>`
  instead of `meraki`). The recipe assumes the TA default;
  substitute your install's actual index in the base
  search if your install renamed.
- **No OT-safety dependency.** Meraki devices are IT
  network equipment (wireless APs, switches, cameras,
  sensors, security appliances). None are SIS-related
  Level-0/1/2 OT devices. The recipe is safe to deploy
  in IT zones; for OT-zone equipment use the
  [ot-datastreamer markers recipe](../ot-datastreamer/markers.md) with the
  passive-collection / OT-safety carve-out documented
  there.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6)
and smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. Has NOT been live-tested against a
real Meraki tenant. Verification deferred to wave 21+ pending
D5 harness landing — at which point a real Meraki Dashboard +
`Splunk_TA_cisco_meraki` will be populated and the recipe
re-run end-to-end against a real multi-device deployment.
