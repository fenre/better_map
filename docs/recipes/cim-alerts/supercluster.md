---
schema_version: 1
id: cim-alerts--supercluster
source:
  id: cim-alerts
  display_name: "CIM Alerts"
  pattern: splunk-cim
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-22"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
  - id: "builtin:iplocation"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "web-prod-04.example.com"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: dest
    type: string
    example: "web-prod-04.example.com"
  - name: alert_count
    type: integer
    example: "47"
  - name: max_severity
    type: string
    example: "critical"
  - name: distinct_signatures
    type: integer
    example: "8"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-host identity at all zooms)"
    path: "docs/recipes/cim-alerts/markers.md"
  - description: "Companion recipes — same source, h3/heat/paths layers (per-cell aggregation, density, attack-flow)"
    path: "docs/recipes/cim-alerts/h3.md"
  - description: "Pattern reference — supercluster on Cisco Meraki devices (per-AP fleet clustering)"
    path: "docs/recipes/meraki/supercluster.md"
  - description: "Pattern reference — supercluster on CIM Network Traffic (sibling CIM source-IP clustering)"
    path: "docs/recipes/cim-network-traffic/supercluster.md"
  - description: "Pattern reference — supercluster on CIM Authentication (sibling CIM clustering with severity)"
    path: "docs/recipes/cim-authentication/supercluster.md"
  - description: "Splunk CIM skill — Alerts data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — notable events + correlation searches generate CIM Alerts"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "Clusters layer source — supercluster index, clusterMaxZoom=14, clusterRadius=48"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# CIM Alerts — supercluster

Render every host firing alerts as a **zoom-adaptive cluster** rather
than per-host markers. Same `tag=alert` CIM Alerts data model and
`iplocation`-geocoded `dest` field as the
[cim-alerts/markers](./markers.md),
[cim-alerts/h3](./h3.md),
[cim-alerts/heat](./heat.md), and
[cim-alerts/paths](./paths.md) companions — but instead of rendering
one marker per affected host (which collapses to overlapping dots at
world zoom on a busy ES install with thousands of noisy hosts), the
renderer groups nearby hosts into a cluster bubble with a per-cluster
count badge, and the bubble expands to individual hosts when the
operator zooms in to a high-density region.

The 13th source to demonstrate the supercluster layer (joining
csv-lookup-geo, kvstore-latlon, meraki, cim-network-traffic,
cim-authentication, splunk-stream, netflow-sflow-ipfix, es-risk,
itsi-kpi-base, cim-performance, thousandeyes, cyber-vision), and the
5th layer shape for cim-alerts (markers, h3, heat, paths, supercluster).

The right shape for **global NOC / SOC overview panels** where the
alert fleet spans hundreds-to-thousands of unique destination hosts
across multiple data centres / cloud regions / branch offices, and
the operator needs to see "where is the alert pressure concentrated
right now" at a glance without per-host marker overlap drowning the
view. Combined with the §4 popup configuration, drilldown into a
cluster expands it on click to surface the constituent per-host
alert load.

## 1. Source description

Same **CIM Alerts** data model as the markers / h3 / heat / paths
companions — see
[cim-alerts/markers §1](./markers.md#1-source-description) for the
data model background and the `tag=alert` contract. The relevant
distinction for THIS recipe: the panel renders per-host alert volume
as zoom-adaptive cluster bubbles instead of flat markers, which
removes the visual-noise floor created by hundreds of overlapping
dots at world zoom.

**Why supercluster for CIM Alerts.** A markers panel at world zoom
on a typical ES tenant collapses every affected `dest` into the same
visual region — Amsterdam-data-centre, AWS-eu-west-1, AWS-us-east-1
each produce a single visual marker that's actually 30-200 overlapping
markers from different hosts. The cluster layer renders a single
labelled bubble per visual cluster with the constituent host count
("48 alerts firing across 11 hosts in AWS us-east-1"), and zooming
in expands the bubble into the constituent per-host markers — same
data, zoom-adaptive rendering.

The 5-minute "tactical NOC hand-off — where is alert pressure
concentrated right now" answer reads off the cluster panel from
across the SOC at a glance; the operator then zooms in on the
hottest cluster to drill into per-host attribution.

**Typical sourcetype / index:** anything tagged `alert` (check
`| tstats values(sourcetype) WHERE \`cim_Alerts_indexes\` tag=alert`).
Typical indexes: `notable` (ES correlation results),
`itsi_tracked_alerts` (ITSI), `summary` (saved-search aggregation),
and the SIEM-forwarder indexes (`pan_logs`, `crowdstrike`,
`microsoft365`, etc.). See the
[markers companion §1](./markers.md#1-source-description) for the
broader catalogue.

**No add-on required beyond Splunk_SA_CIM** for the data model. Fully
air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS alert_count,
    dc(Alerts.signature) AS distinct_signatures,
    values(Alerts.severity) AS severities
  FROM datamodel=Alerts WHERE earliest=-24h
  BY Alerts.dest
| rename "Alerts.dest" AS dest
| iplocation dest
| where isnotnull(lat) AND isnotnull(lon)
| eval max_severity=case(
    mvfind(severities, "^critical$") >= 0, "critical",
    mvfind(severities, "^high$") >= 0, "high",
    mvfind(severities, "^medium$") >= 0, "medium",
    mvfind(severities, "^low$") >= 0, "low",
    mvfind(severities, "^informational$") >= 0, "informational",
    true(), "unknown")
| rename dest AS id
| fields id, lat, lon, dest, alert_count, max_severity,
    distinct_signatures
| sort - alert_count
| head 5000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true count ... FROM datamodel=Alerts`** —
  uses the CIM-accelerated Alerts data model. Orders of magnitude
  faster than raw event scanning on a busy ES install with millions
  of alerts. The `summariesonly=true` flag forces the accelerated
  TSIDX summary path; without it Splunk silently falls back to raw
  scanning.
- **`count AS alert_count`** — aggregate alert volume per host;
  surfaces in the per-host popup once a cluster is expanded. NOT
  used for cluster colour intensity at the cluster level (the
  cluster bubble shows the **constituent point count**, not an
  aggregate of the constituent values — see the §6 gotcha on the
  layer contract).
- **`dc(Alerts.signature) AS distinct_signatures`** — number of
  distinct alert signatures per host. A host firing 47 alerts of 1
  signature (one noisy IDS rule) is materially different from a host
  firing 47 alerts of 8 signatures (multi-pronged event). Carried
  through to the per-host popup once the cluster is expanded.
- **`values(Alerts.severity)`** — multi-value collect of every
  observed severity per host; the `case(mvfind(...))` block then
  picks the highest in the conventional severity ordering
  (`critical > high > medium > low > informational`) and exposes it
  as `max_severity`. Carried through to the per-host popup.
- **`BY Alerts.dest`** — one row per affected host. The CIM schema's
  `dest` field is typically a hostname or IP; `iplocation` on the
  next stage handles both. The supercluster layer then groups these
  per-host rows into cluster bubbles in `lat`/`lon` space.
- **`| iplocation dest`** — Splunk's built-in MaxMind GeoLite2
  geocoder. No outbound network call. Populates `lat`, `lon`,
  `Country`, `City` for any `dest` that's a public IP; internal
  hostnames typically resolve to null and are dropped by the next
  filter. For private-IP hosts with known geo, use a customer-
  curated lookup join instead of `iplocation`.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drops the null-
  geocoded internal hosts so they do not pile up at Null Island
  and visually dominate the panel. (Failure to filter is the #1
  reason a Better Map cluster panel shows a giant cluster bubble at
  0,0 with thousands of constituent points.)
- **`| rename dest AS id`** — adopt Better Map's canonical `id`
  alias. The cluster layer uses `id` for cross-panel coordination
  and for popup keying when a cluster is expanded to individual
  markers.
- **`| sort - alert_count | head 5000`** — render budget. The
  supercluster layer is fast (server-side spatial indexing — see the
  §6 gotcha on the 5000-point soft ceiling) but past 5000 points the
  initial cluster-index build adds visible latency to first render.
  5000 captures the top noisy hosts; bump to 10000 for a dedicated
  alert-volume-analysis panel where first-render latency can be
  sacrificed for completeness.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field               | type    | example                       |
|---------------------|---------|-------------------------------|
| id                  | string  | web-prod-04.example.com       |
| lat                 | number  | 47.6062                       |
| lon                 | number  | -122.3321                     |
| dest                | string  | web-prod-04.example.com       |
| alert_count         | integer | 47                            |
| max_severity        | string  | critical                      |
| distinct_signatures | integer | 8                             |

Seven fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by `scripts/check-recipe-schema.py`.

The supercluster layer requires `lat` / `lon` for the geographic
grouping; `id` for cross-panel coordination; and carries `dest`,
`alert_count`, `max_severity`, `distinct_signatures` through to the
per-host popup when a cluster is expanded to individual markers.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — the ONLY required setting.
  Switches the per-row marker rendering to the supercluster layer.
  The cluster bubbles render at `clusterMaxZoom=14` and below;
  above that, individual `dest` hosts render as plain markers (so
  the operator can drill into per-host detail by zooming in). The
  formatter's supercluster renderer takes care of per-zoom-level
  aggregation client-side via the supercluster index, hardcoded
  `clusterRadius=48` and `clusterMaxZoom=14` per `clusters.js`
  (see the §6 gotcha on parameter hardcoding).
- **No `pointSize` / cluster-colour overrides set** — defaults
  provide a calibrated palette + sizing. Override only if customer
  branding requires (set via Dashboard Studio formatter panel).
- **`alert_count`, `max_severity`, `distinct_signatures` flow
  through as feature properties** for the per-host popup once the
  cluster is expanded. The operator drilldown story is: world zoom
  shows clusters; clicking a cluster zooms in until it breaks apart
  into individual host markers; each host marker's popup carries
  the full alert-volume + severity context.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker harness (ROADMAP §3 D5
Phase 1 SHIPPED — Playwright Phase 2 still pending). Until then, a
maintainer can reproduce the panel by accelerating the CIM Alerts
data model in a Splunk dev tenant, generating ~50-500 synthetic
alerts via `| makeresults | eval dest=mvindex(split("server01.aws-
us-east-1,server02.aws-us-east-1,...",",")) | collect index=summary`
(per the synthetic-alert pattern in the cim-alerts/markers companion
recipe), then dispatching the §2 SPL into a Dashboard Studio map
panel with Better Map as the visualization and applying the §4
formatter JSON. The cluster bubbles should appear over AWS-east /
AWS-west / Amsterdam DC at world zoom; zooming in past zoom 14
breaks them into per-host markers._

## 6. Gotchas

- **`summariesonly=true` requires acceleration.** If the CIM Alerts
  data model has not been accelerated in your tenant, the recipe will
  return zero results. Confirm with `| tstats summariesonly=true count
  FROM datamodel=Alerts` — non-zero count means acceleration is
  enabled. Enable under Settings → Data Models → Alerts → Edit →
  Acceleration; allow ~24h for the initial summary build on a large
  tenant.
- **Cluster bubble count ≠ aggregate alert volume.** The cluster
  layer counts CONSTITUENT POINTS — i.e., the number of hosts
  inside the cluster — NOT the sum of `alert_count` across hosts.
  A cluster bubble showing "11" means 11 distinct hosts; if you need
  "total alerts in this cluster", expand the cluster by zooming in
  and use the h3 / heat companion layers instead, which DO sum
  `value` across grouped points. This is a hardcoded behaviour of
  the supercluster engine, not a Better Map formatter option.
- **`clusterMaxZoom=14` and `clusterRadius=48` are hardcoded.**
  The supercluster layer in `better_map/appserver/static/
  visualizations/better_map/src/lib/layers/clusters.js` pins both
  parameters. Below zoom 14 points group into clusters; at or above
  zoom 14 each point renders as an individual marker. If your
  operator expects clusters all the way to street-level zoom (e.g.,
  building-by-building visibility), this is the wrong layer — use
  markers + a customer-pinned `maxZoom` instead. The 48-pixel
  cluster radius is calibrated for desktop-size panel rendering;
  on a wall-display panel with high pixel density (4k+) clusters
  may visually under-pack.
- **Internal hostname null geocoding.** `iplocation` returns null
  for any `dest` that's an internal hostname without DNS
  resolution. The `where isnotnull(lat) AND isnotnull(lon)` filter
  drops them silently — which is correct for an external-host
  alert-pressure view. For a "where on the corporate network are
  alerts firing" view, layer a customer-curated CMDB / asset-
  registry lookup on `dest` to produce a synthetic `lat`/`lon` from
  the host's `site_id` instead of `iplocation`.
- **Cluster expansion on click vs zoom.** Better Map's cluster
  layer is configured for **zoom-driven** expansion (zoom in past
  the cluster's `clusterMaxZoom` and it breaks apart). Click-to-
  expand (zoom directly to a tight bbox around the cluster) is
  available via a custom click handler — see the
  [meraki/supercluster companion](../meraki/supercluster.md#6-gotchas)
  for the pattern.
- **5000-point soft ceiling.** Supercluster's spatial-index build is
  O(n log n); past ~5000 points the first-render latency becomes
  visible (~500ms-2s on a typical browser). The `head 5000` cap is
  the pragmatic ceiling. If your tenant has more than 5000 noisy
  hosts the operator probably needs to filter the data model upstream
  by severity (`WHERE Alerts.severity IN ("critical","high")`) or
  by app (`WHERE Alerts.app="splunk_enterprise_security"`) rather
  than rendering everything.
- **Max-severity escalation does NOT drive cluster bubble colour.**
  Unlike the markers companion (which colours each marker by
  `max_severity`), the cluster layer renders all bubbles in a
  uniform colour from `pointFill`. Severity is only visible per-host
  once the cluster is expanded. For a "critical-only at world zoom"
  view, pre-filter the SPL with `WHERE Alerts.severity="critical"`
  rather than relying on visual encoding inside the cluster.
- **Time-window calibration.** The `earliest=-24h` window matches
  the markers companion. For a real-time SOC panel narrow to
  `earliest=-15m`; for an incident-response review widen to
  `earliest=-7d` (but bump the `head` cap accordingly).
- **No OT-safety dependency.** CIM Alerts is an IT-zone alerting
  data model (ES correlation searches, ITSI notable events, SIEM
  forwarders). The recipe is safe to deploy in IT zones; for
  alerts that DO reference SIS-related signals
  (`safety_dependent: true` per ROADMAP / atomic-runbook contract),
  layer per-host severity escalation that distinguishes
  safety-dependent destinations and routes them to a separate
  human-in-the-loop atomic runbook per
  [/.cursor/rules/ot-safety.mdc](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised recipe
contract (`schema_version: 1` + frontmatter + §1-§6) and smoke-tests
locally against `build-recipe-index.py` + `check-recipe-schema.py`.
Has NOT been live-tested against a real CIM Alerts data model
populated with multi-host alert traffic. Verification deferred to a
maintainer with a Splunk dev tenant where the Alerts data model is
accelerated and ES correlation searches / ITSI notable events / SIEM
forwarder feeds are producing alert events with public-IP `dest`
values, at which point the panel SPL can be dispatched, the cluster
bubbles rendered, and the frontmatter updated to `status: verified`.
