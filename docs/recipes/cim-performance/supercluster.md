---
schema_version: 1
id: cim-performance--supercluster
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: supercluster
  display_name: Supercluster
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
  - name: dest
    type: string
    example: "web-prod-01"
  - name: max_cpu_load
    type: number
    example: "82.4"
  - name: breach_count
    type: integer
    example: "47"
  - name: datacenter
    type: string
    example: "us-west-2"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-host current-breach drilldown)"
    path: "docs/recipes/cim-performance/markers.md"
  - description: "Companion recipe — same source, paths layer (incident-cascade polylines)"
    path: "docs/recipes/cim-performance/paths.md"
  - description: "Companion recipe — same source, H3 hexbin (regional roll-up)"
    path: "docs/recipes/cim-performance/h3.md"
  - description: "Companion recipe — same source, heatmap (density smoothing)"
    path: "docs/recipes/cim-performance/heat.md"
  - description: "Pattern reference — supercluster on ES risk-object portfolio"
    path: "docs/recipes/es-risk/supercluster.md"
  - description: "Pattern reference — supercluster on ITSI service-health portfolio"
    path: "docs/recipes/itsi-kpi-base/supercluster.md"
  - description: "Splunk CIM skill — Performance data model schema"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk datamodels-conf skill — CIM acceleration + tstats summariesonly"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# CIM Performance — supercluster

Render every monitored host that has breached any CPU
threshold (CPU > 80%) over a 24h window as a **zoom-adaptive
supercluster** on a world map, one row per host, with cluster
pills at regional zoom that progressively split into per-host
markers as the user zooms. The canonical **SRE / ITops portfolio
hot-spot overview** panel — when a leader needs a single-pane
"where is my infrastructure pressure RIGHT NOW across the
portfolio" view that gracefully collapses 5000-10000+ hosts into
navigable cluster pills, organized by datacenter / cloud region.

## 1. Source description

The **CIM Performance data model** normalises infrastructure
telemetry across every monitored host; see the
[cim-performance/markers](./markers.md) sibling recipe §1 for
the full dataset / field schema and the
[cim-performance/paths](./paths.md) sibling for the incident-
cascade variant. The distinction for THIS recipe: while the
markers companion is a **point-in-time current-state SRE
overview** (15-minute window, immediate-action signal coloured
by worst CPU), the supercluster recipe is a **24-hour portfolio-
hot-spot view** built for executive / SRE-manager audiences who
care about which datacenters / regions are running hot across
the day, not which specific host crossed the threshold 60
seconds ago.

The key shape changes vs the markers companion:

- **Window**: 24h instead of 15-minute (markers captures the
  current breach; supercluster captures the daily portfolio
  footprint).
- **Aggregation**: `max(cpu_load_percent) AS max_cpu_load` per
  host (vs `latest()` in markers) — the worst-of-the-day
  signal, more relevant for portfolio overview than the current
  instantaneous reading.
- **Breach count**: `count` of 5-minute buckets above 80% per
  host — surfaces "this host was hot for 47 of the 288 buckets"
  vs "this host crossed the threshold once" in popups.
- **No memory / storage join**: deliberately CPU-only for
  portfolio clarity. For multi-signal portfolio panels, switch
  to the [cim-performance/h3](./h3.md) companion which
  aggregates all three signals per region.
- **Cap raised to `head 10000`** for 1k+ host enterprises.

**Typical sourcetype / index:** see
[cim-performance/markers](./markers.md) §1 for the full list of
contributing sourcetypes via CIM Performance. App context
required: `Splunk_SA_CIM`. The asset lookup is the same
operator-curated `asset_lookup_by_str` (ES A&I) or
customer-equivalent hostname → lat/lon/datacenter map.

## 2. SPL recipe

```spl
| tstats summariesonly=true max(All_Performance.cpu_load_percent) AS max_cpu_load,
    count AS breach_count
  FROM datamodel=Performance.All_Performance
  WHERE earliest=-24h All_Performance.cpu_load_percent>80
  BY All_Performance.dest, _time span=5m
| stats max(max_cpu_load) AS max_cpu_load, count AS breach_count BY All_Performance.dest
| rename "All_Performance.dest" AS dest
| where breach_count >= 3
| lookup asset_lookup_by_str dest AS dest OUTPUT lat AS asset_lat, lon AS asset_lon, datacenter
| rename asset_lat AS lat, asset_lon AS lon
| where isnotnull(lat) AND isnotnull(lon)
| rename dest AS id
| eval dest=id
| fields id, lat, lon, dest, max_cpu_load, breach_count, datacenter
| sort - breach_count
| head 10000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true
  max(All_Performance.cpu_load_percent) AS max_cpu_load,
  count AS breach_count FROM
  datamodel=Performance.All_Performance WHERE earliest=-24h
  All_Performance.cpu_load_percent>80 BY All_Performance.dest,
  _time span=5m`** — accelerated CIM Performance aggregation
  filtered to CPU breach events, grouped by host + 5-minute time
  bucket. The 5-minute span matches the typical CIM Performance
  acceleration cadence (most installs accelerate the model at
  5-minute spans) and gives a fine-grained breach-bucket count
  without the per-event scan cost.
- **`| stats max(max_cpu_load) AS max_cpu_load, count AS
  breach_count BY All_Performance.dest`** — collapse to one
  row per host across the 24h window. `max_cpu_load` becomes
  the worst-of-day CPU reading; `breach_count` becomes the
  count of 5-minute buckets the host spent above 80%. A host
  with `breach_count=47` was hot for ~4 hours of the day; a
  host with `breach_count=288` was constantly pegged.
- **`where breach_count >= 3`** — filter out transient
  spikes (one or two 5-minute buckets at 81% is typically a
  cron job, not infrastructure pressure). The 3-bucket
  threshold (~15 minutes of sustained pressure) is the
  portfolio-overview default; tune up to `>= 12` (1 hour) for
  stricter executive-grade signal or down to `>= 1` for
  comprehensive coverage.
- **`| lookup asset_lookup_by_str dest AS dest OUTPUT lat AS
  asset_lat, lon AS asset_lon, datacenter`** — geo + datacenter
  enrichment via ES Asset & Identity framework. Same lookup as
  the markers companion §2; see that recipe's §6 Gotchas for
  the ES-vs-CIM-only-tenants caveat and alternate
  enrichment options.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop un-
  geocoded hosts. Un-mapped assets surface in a companion
  table panel for the SRE team to backfill in the asset
  lookup.
- **`rename dest AS id`** + **`eval dest=id`** — adopt Better
  Map's `id` canonical alias for drilldown stability, then
  re-create `dest` for the popup (the rename consumed it).
- **`sort - breach_count`** — most-pressured hosts first (the
  supercluster layer doesn't care about input order but the
  sort keeps the rendering deterministic and the popup
  drilldown order intuitive).
- **`head 10000`** — render-cap. Typical enterprise deployments
  carry 500-5000 monitored hosts; cloud-native shops can reach
  10k+. Supercluster scales gracefully to 10k+ rows via client-
  side aggregation. Above 25k hosts, switch to the
  [cim-performance/h3](./h3.md) companion which pre-aggregates
  per H3 cell in SPL.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example       |
|---------------|---------|---------------|
| id            | string  | web-prod-01   |
| lat           | number  | 37.7749       |
| lon           | number  | -122.4194     |
| dest          | string  | web-prod-01   |
| max_cpu_load  | number  | 82.4          |
| breach_count  | integer | 47            |
| datacenter    | string  | us-west-2     |

Seven fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — forces zoom-adaptive
  aggregation unconditionally. At world zoom 10k hosts render
  as ~20 cluster pills (one per major cloud region or
  on-prem datacenter); progressively splits as the user zooms.
- **`idField: "id"`** — explicit override (Better Map's
  canonical alias).
- **No `markerColor` override.** Cluster pills don't honor
  per-feature color; the cluster-count badge carries the
  primary visual signal (count of hot hosts per region). For
  worst-CPU-coloured panels at exec zoom, switch to the
  [cim-performance/heat](./heat.md) companion which ramps
  colour by aggregated CPU intensity.
- **Popup auto-renders `dest`, `max_cpu_load`, `breach_count`,
  `datacenter` from feature properties** at city zoom when
  the cluster fully splits into individual host markers. No
  `popupTemplate` override needed.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce by pasting the §2
SPL into a Dashboard Studio map panel, applying the §4
formatter JSON, and zooming from world to region — at world
zoom expect ~15-25 cluster pills clustered around major cloud
regions / on-prem datacenters, at country zoom expect per-
metro splits, at city zoom individual host markers with CPU /
breach-count popups._

## 6. Gotchas

- **CIM Performance acceleration MUST be enabled.** Same
  contract as the [cim-performance/markers](./markers.md) §6
  ES A&I dependency discussion — confirm in Settings → Data
  models → Performance → Acceleration. If OFF,
  `summariesonly=true` returns zero rows.
- **`asset_lookup_by_str` is an Enterprise Security artefact.**
  Tenants without ES need a replacement lookup. See
  [cim-performance/markers](./markers.md) §6 for alternative
  enrichment patterns (ITSI entity collection, customer-
  curated `host_inventory_geo.csv`, or the same lookup the
  [cim-performance/paths](./paths.md) sibling uses).
- **`breach_count >= 3` filter excludes transient spikes.**
  The 3-bucket threshold (~15 minutes) is tuned to the
  portfolio-overview audience. For action-grade alerting,
  the [cim-performance/markers](./markers.md) companion's
  15-minute window with `latest()` is the right shape; this
  recipe is deliberately retrospective.
- **`head 10000` defensive cap.** Typical enterprise
  deployments return 50-500 rows under the
  `breach_count >= 3` filter (most hosts don't spend 15+
  minutes pegged); the cap rarely fires. Above 10k hot
  hosts, infrastructure pressure is widespread enough that
  per-region aggregation (the [cim-performance/h3](./h3.md)
  companion) is the better panel.
- **Cluster aggregate semantics.** Cluster pill counts
  reflect host COUNT per region, NOT aggregated breach
  intensity. For intensity-weighted portfolio summaries
  (where you want "which region carries the most breach-
  hours"), switch to the [cim-performance/h3](./h3.md)
  companion with `aggField` set to `sum(breach_count)` or
  `max(max_cpu_load)`.
- **Cloud-elastic hosts.** Auto-scaling fleets produce
  short-lived hosts that may appear in the 24h window but
  no longer exist at render time. The `asset_lookup_by_str`
  enrichment will typically lag behind cloud-API truth by
  the lookup's refresh cadence (often 15 minutes); short-
  lived hosts get dropped silently when un-enriched. For
  cloud-native shops, swap the lookup for a per-cloud
  region geo-table (`cloud_regions.csv` mapping
  `us-east-1` → city/state/lat/lon) and group by
  `cloud_region` rather than per-host.
- **No OT safety dependency.** Same as the
  [cim-performance/paths](./paths.md) sibling §6 — CIM
  Performance is by definition IT-system telemetry.
  OT-system performance (PLC scan times, drive uptimes,
  HMI latency) does not flow through this data model;
  use the [cyber-vision/heat](../cyber-vision/heat.md) or
  [ot-datastreamer/markers](../ot-datastreamer/markers.md)
  recipes for OT-asset infrastructure-health panels.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound and uses only Splunk built-ins (`tstats`,
`stats`, `lookup`, `eval`, `rename`, `where`, `fields`,
`sort`, `head`) on the accelerated CIM Performance data model
+ the ES `asset_lookup_by_str` automatic lookup. Verification
path mirrors [cim-performance/markers](./markers.md)
§"Verification status" — confirm acceleration ON, confirm
`asset_lookup_by_str` is populated for the test hosts,
dispatch via REST against a populated tenant carrying ≥100
monitored hosts with at least 20% having sustained CPU
breaches in the last 24h, drop into a Dashboard Studio panel
with the §4 formatter JSON, confirm cluster pills render at
world zoom and progressively split as the user zooms.
Promote to `status: verified` + fill in `verified_against`
in a follow-up PR.
