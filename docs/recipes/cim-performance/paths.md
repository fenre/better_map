---
schema_version: 1
id: cim-performance--paths
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "us-west-2a__470745"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: dest
    type: string
    example: "web-prod-01"
  - name: datacenter
    type: string
    example: "us-west-2a"
  - name: cpu_load_percent
    type: number
    example: "89.2"
  - name: hops_in_incident
    type: integer
    example: "5"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-host drilldown)"
    path: "docs/recipes/cim-performance/markers.md"
  - description: "Companion recipe — same source, H3 hexbin layer"
    path: "docs/recipes/cim-performance/h3.md"
  - description: "Companion recipe — same source, heatmap layer"
    path: "docs/recipes/cim-performance/heat.md"
  - description: "Pattern reference — paths layer with streamstats cascade-ordering"
    path: "docs/recipes/cim-alerts/paths.md"
  - description: "splunk-cim skill — Performance data model schema, dataset tags"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "splunk-datamodels-conf skill — CIM acceleration and tstats summariesonly tradeoffs"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# CIM Performance — paths

Render **incident-cascade polylines** across hosts in the same
datacenter / availability zone that breached the same performance
threshold within a 1-hour window, with vertices ordered
chronologically by `_time`. The canonical "blast-radius
reconstruction" panel for SRE / ITOps incident-response — when
a regional incident propagates through the infrastructure
(`storage-01` runs out of disk → `db-01` queues → `web-01-04`
saturate CPU), the paths panel shows the geographic and temporal
order in which hosts failed.

Sister recipe to [cim-performance/markers](../cim-performance/markers.md)
(per-host snapshot view), [cim-performance/h3](../cim-performance/h3.md)
(per-cell density roll-up), and
[cim-performance/heat](../cim-performance/heat.md) (smoothed
hot-spot detection). The four shapes together give an SRE team
investigative-, density-, hot-spot-, AND incident-cascade views
on one CIM Performance data feed.

## 1. Source description

Same CIM Performance data model source as the
[markers](../cim-performance/markers.md) companion — see that
recipe §1 for the full discussion of the six performance
datasets (CPU, Memory, Storage, Network, Facilities, Uptime),
the `dest` entity identifier convention, the `Splunk_SA_CIM`
app dependency, and the asset-lookup contract for resolving
`dest` → lat/lon.

This recipe is the **incident-cascade view**: instead of showing
the current snapshot per host (markers companion does that), it
groups hosts in the same datacenter that breached CPU > 80 %
within a 1-hour window, orders them chronologically by `_time`
of first breach, and renders one polyline per (datacenter,
hour-bucket) incident. The polyline's vertex order shows which
host failed FIRST, which followed, and so on — the geometric
equivalent of a cascade reconstruction.

**Typical sourcetype / index:** the Performance data model
draws from the same broad sourcetype set documented in the
markers companion §1.

## 2. SPL recipe

```spl
| tstats summariesonly=true latest(Performance.cpu_load_percent) AS cpu_load_percent FROM datamodel=Performance.CPU WHERE earliest=-1h latest=now BY Performance.dest, _time span=5m
| rename Performance.dest AS dest
| where cpu_load_percent > 80
| lookup asset_lookup_by_str dest OUTPUT lat AS lat, long AS lon, datacenter
| where isnotnull(lat) AND isnotnull(lon) AND isnotnull(datacenter)
| eval hour_bucket=floor(_time / 3600)
| eval incident_id=datacenter . "__" . tostring(hour_bucket)
| sort 0 incident_id, _time
| streamstats current=true count AS seq BY incident_id
| eventstats count AS hops_in_incident BY incident_id
| where hops_in_incident >= 2
| rename incident_id AS id
| fields id, seq, lat, lon, dest, datacenter, cpu_load_percent, hops_in_incident
| sort id, + seq
| head 2000
```

Why this exact shape, line by line:

- **`tstats summariesonly=true latest(Performance.cpu_load_percent) ... BY Performance.dest, _time span=5m`** —
  accelerated query over the CPU dataset, bucketing samples
  into 5-minute windows per host. `summariesonly=true` enforces
  the accelerated path (fail-fast if acceleration is broken).
  `latest()` picks the freshest sample per (host, 5-min)
  bucket.
- **`where cpu_load_percent > 80`** — only keep buckets where
  the host was breaching the CPU threshold. This is the "fire"
  signal. Adjust threshold per your environment.
- **`lookup asset_lookup_by_str dest OUTPUT lat AS lat, long AS lon, datacenter`** —
  ES Asset & Identity lookup pulling lat/lon/datacenter. If you
  use a different asset inventory (CMDB, ITSI entity collection),
  swap the lookup name and OUTPUT mapping. The `datacenter`
  field is the critical grouping key for incident-cascade
  reconstruction.
- **`where isnotnull(lat) AND isnotnull(lon) AND isnotnull(datacenter)`** —
  drop hosts without asset records. Surface in a companion
  table panel ("Hosts breaching without asset records:
  <count>") so the asset-lookup admin sees the gap.
- **`eval hour_bucket=floor(_time / 3600)`** — bucket events into
  hour-aligned windows. This is the **incident-windowing**
  primitive — hosts that breach in the same hour-bucket within
  the same datacenter are treated as a single incident.
  Narrow to 15-min (`floor(_time / 900)`) for finer-grained
  cascade reconstruction; widen to 4-hour for slow-burn
  incidents.
- **`eval incident_id=datacenter . "__" . tostring(hour_bucket)`** —
  the per-incident identifier. Same datacenter + same hour =
  same incident. This is the `pathIdField` value.
- **`sort 0 incident_id, _time`** — order vertices per
  incident by chronological `_time`. `sort 0` disables Splunk's
  10000-row default cap (otherwise per-incident polylines might
  be truncated mid-cascade).
- **`streamstats current=true count AS seq BY incident_id`** —
  per-incident monotonic vertex sequence. The paths layer's
  `timeField` contract requires a numeric ordering field;
  `streamstats` is preferred over raw `_time` because it
  always yields a clean integer sequence regardless of
  clock skew between collectors.
- **`eventstats count AS hops_in_incident BY incident_id`** +
  **`where hops_in_incident >= 2`** — discard single-host
  incidents (geometric definition: a polyline needs ≥2
  vertices). Single-host CPU breaches belong in the markers
  companion, not the paths companion.
- **`rename incident_id AS id`** — adopt Better Map's `id`
  alias.
- **`sort id, + seq`** — lock per-incident vertex ordering for
  deterministic rendering.
- **`head 2000`** — render cap. 2000 polyline vertices
  comfortably handles ~50 multi-host incidents per hour
  (typical large-fleet SRE burn rate).

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field             | type    | example             |
|-------------------|---------|---------------------|
| id                | string  | us-west-2a__470745  |
| seq               | integer | 0                   |
| lat               | number  | 37.7749             |
| lon               | number  | -122.4194           |
| dest              | string  | web-prod-01         |
| datacenter        | string  | us-west-2a          |
| cpu_load_percent  | number  | 89.2                |
| hops_in_incident  | integer | 5                   |

All eight appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#ff7f0e",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit. Same alignment as the
  cyber-vision/paths and cim-alerts/paths companions.
- **`timeField: "seq"`** — monotonic vertex ordering from
  `streamstats`.
- **`pathColor: "#ff7f0e"`** — Tableau warning-orange.
  Performance-incident cascades are SRE / ITOps signals — orange
  reads as "elevated severity but not threat" (red would
  conflate with security signals like the cim-alerts/paths
  companion uses `#d62728`).
- **`pathArrows: true`** — render direction-of-travel chevrons.
  Arrows show the chronological order of failures at a glance —
  essential for incident-response triage to identify the
  "patient zero" host (first arrow's tail).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic CIM Performance corpus seeded with
multi-host cascading-incident scenarios for path verification._

## 6. Gotchas

- **CIM acceleration is required.** `summariesonly=true` is
  set explicitly — if the Performance data model isn't
  accelerated, the search returns 0 rows. Verify with
  `| datamodel Performance summariesonly=true | stats count`
  before deploying the dashboard.
- **`datacenter` field is asset-lookup-dependent.** This
  recipe assumes the asset inventory carries a `datacenter`
  column (typical for ES A&I and most CMDB exports). If your
  lookup uses a different field (`region`, `availability_zone`,
  `site`, `pop`), swap the `OUTPUT` clause and the `incident_id`
  eval. For multi-cloud deployments, prefer `availability_zone`
  over `datacenter` to align with cloud-provider conventions.
- **Hour-bucket window is environment-specific.** The
  `floor(_time / 3600)` 1-hour bucket is the right cadence
  for slow-burn cascades (storage-driven cascades typically
  take 20-60 minutes to fully propagate). For fast-burn
  scenarios (DNS / network-loop cascades, which can saturate
  a fleet in <5 minutes), narrow to `floor(_time / 300)`
  (5-minute buckets). The trade-off: narrower buckets create
  more (smaller) incidents; wider buckets risk conflating
  unrelated cascades.
- **The `head 2000` cap is conservative.** A very large fleet
  with multiple concurrent regional incidents can easily
  exceed 2000 polyline vertices in an hour. Bump to 5000 or
  10000 if you see paths truncating; the renderer handles
  this scale gracefully.
- **Single-source-of-truth cascade interpretation.** The
  paths panel shows cascade ORDER, not cascade CAUSALITY. A
  host appearing 4th in a polyline isn't necessarily caused
  by hosts 1-3; it's just the 4th to breach the threshold
  in chronological order. Causality requires
  application-dependency-aware reasoning (ServiceNow CMDB
  service-graph, Istio mesh telemetry) beyond what CIM
  Performance alone provides. Use the panel for
  incident-triage *ordering*, then correlate with
  application telemetry to establish causality.
- **CPU-only filter.** This recipe filters only on the CPU
  dataset (`cpu_load_percent > 80`). Mixed-signal cascades
  (storage → memory → CPU) require additional `append`
  branches per dataset, similar to the markers companion's
  3-dataset pattern but with the cascade-windowing
  preserved. For incident-response panels in a
  storage-pressure-heavy environment, swap the base search
  to the Storage dataset.
- **No OT safety dependency.** CIM Performance is an IT-fleet
  infrastructure-telemetry model; the recipe doesn't
  interact with any OT control-zone signal.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk + CIM built-ins (`tstats`, `rename`,
`where`, `lookup`, `eval`, `streamstats`, `eventstats`,
`fields`, `sort`, `head`). Verification path mirrors the
markers companion §"Verification status" — confirm
`Splunk_SA_CIM` is installed and the Performance data model is
accelerated, dispatch via REST, drop into a Dashboard Studio
panel with the §4 formatter JSON, confirm polylines render
when ≥2 hosts in the same datacenter breach within the same
hour. Promote to `status: verified` + fill in
`verified_against` in a follow-up PR.
