---
schema_version: 1
id: itsi-kpi-base--supercluster
source:
  id: itsi-kpi-base
  display_name: "ITSI service health (KPI base searches)"
  pattern: splunk-premium-itsi
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "SA-ITOA"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "svc_payments_eu"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "53.5511"
  - name: lon
    type: number
    example: "9.9937"
  - name: service_title
    type: string
    example: "Payments (EU region)"
  - name: health_score
    type: integer
    example: "78"
  - name: alert_level
    type: integer
    example: "3"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (drilldown)"
    path: "docs/recipes/itsi-kpi-base/markers.md"
  - description: "Companion recipe — same source, H3 hexbin (per-cell roll-up)"
    path: "docs/recipes/itsi-kpi-base/h3.md"
  - description: "Companion recipe — same source, heatmap (smoothed density)"
    path: "docs/recipes/itsi-kpi-base/heat.md"
  - description: "Pattern reference — supercluster on Splunk Stream"
    path: "docs/recipes/splunk-stream/supercluster.md"
  - description: "splunk-itsi skill — itsi_summary schema, SHKPI- service health, entity attributes"
    path: "~/.cursor/skills/splunk-itsi/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# ITSI service health — supercluster

Render every geo-tagged ITSI service as a **zoom-adaptive
supercluster** on a world map, one row per service, with cluster
pills at regional / continental zoom that progressively split
into per-service markers as the user zooms in. The canonical
"executive global-portfolio service-health" panel — when a CIO,
SRE manager, or business-services lead has 200+ services across
multiple continents and needs a single-pane "where is my health
right now" view that gracefully collapses dense regions (e.g.,
"EU west: 47 services, mostly green; one critical in
Stockholm") into navigable cluster pills.

Sister recipe to
[itsi-kpi-base/markers](../itsi-kpi-base/markers.md) (per-
service drilldown), [itsi-kpi-base/h3](../itsi-kpi-base/h3.md)
(per-cell roll-up), and
[itsi-kpi-base/heat](../itsi-kpi-base/heat.md) (smoothed-density
hot-spot detection). The four shapes together give an SRE /
platform team executive-, hex-, density-, AND scale-tolerant
cluster views on one ITSI service-health feed.

## 1. Source description

Same ITSI `itsi_summary` source and `SHKPI-` service-health
event shape as the
[markers](../itsi-kpi-base/markers.md) companion — see that
recipe §1 for the full discussion of ITSI service / KPI
aggregation cadence, the `SHKPI-<service_id>` synthetic KPI
convention, the `entity_key="N/A"` filter for service-level
roll-ups, the `itsi_services` KV store schema, and the
`info_lat` / `info_lon` operator-extension pattern.

This recipe is the **portfolio-scale overview**: same per-
service health-score and alert-level data as the markers
companion, but rendered through supercluster instead of
individual markers. Where the markers companion is the right
choice for ≤50 services (one zoom level reveals all), this
recipe is the right choice for 50–500 services across multiple
geographic regions where zoom-driven aggregation is the only
way to read the panel without visual overload.

**Typical sourcetype / index:** `index=itsi_summary`. Same
`itsi_services` KV store lookup contract as the markers
companion.

## 2. SPL recipe

```spl
index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A" earliest=-15m latest=now
| stats latest(alert_value) AS health_score,
    latest(alert_level) AS alert_level,
    latest(service_title) AS service_title
  BY itsi_service_id
| lookup itsi_services _key AS itsi_service_id OUTPUT info_lat AS lat, info_lon AS lon, identifying_name
| where isnotnull(lat) AND isnotnull(lon)
| eval health_score=round(health_score, 0)
| eval alert_level=tonumber(alert_level)
| eval id=coalesce(identifying_name, itsi_service_id)
| fields id, lat, lon, service_title, health_score, alert_level
| sort - alert_level, service_title
| head 1000
```

Why this exact shape, line by line:

- **`index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A"`** —
  service-health-aggregate filter, identical to the markers
  companion §2. `SHKPI-` is ITSI's synthetic-service-health
  KPI prefix; `entity_key="N/A"` keeps service-level events
  and drops per-entity rows.
- **`earliest=-15m latest=now`** — 15-min window guarantees ≥2
  snapshots at the default 5-min KPI cadence. `latest()` picks
  the freshest per service.
- **`stats latest(...) BY itsi_service_id`** — one row per
  service. The supercluster renderer wants one row per
  rendered point, so the per-entity rollup is essential.
- **`lookup itsi_services _key AS itsi_service_id ...`** — the
  critical line, same contract as the markers companion §2.
  Joins the service-health event against the `itsi_services`
  KV store to pull operator-set `info_lat` / `info_lon` /
  `identifying_name`.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  services without geographic attribution. These services ARE
  being monitored — they just don't have lat/lon set in the
  service `info` block. Surface in a companion table panel
  ("Services lacking location data: <count>") so the ITSI
  admin sees the attribute gap.
- **No `join` for `critical_kpi_count`.** The supercluster
  rendering doesn't show per-row popups by default at the
  cluster-pill zoom level — the cluster pill shows
  contained-marker count, not per-row attributes. Dropping
  the `join` (vs the markers companion) keeps the SPL fast on
  large portfolios. For drilldown context on individual
  services, click-through to the markers companion panel.
- **`eval id=coalesce(identifying_name, itsi_service_id)`** —
  Better Map's `id` alias. Prefer human-readable
  `identifying_name`; fall back to the KV store `_key`.
- **`sort - alert_level, service_title`** — worst services
  first. Determines render order in the cluster-pill
  breakdown popup.
- **`head 1000`** — generous render cap. Largest ITSI
  installations run ~200 top-level services; 1000 covers
  nested business-service trees + edge cases without
  overflow. The supercluster renderer scales gracefully past
  this cap if needed.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example              |
|---------------|---------|----------------------|
| id            | string  | svc_payments_eu      |
| lat           | number  | 53.5511              |
| lon           | number  | 9.9937               |
| service_title | string  | Payments (EU region) |
| health_score  | integer | 78                   |
| alert_level   | integer | 3                    |

All six appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — explicit supercluster mode.
  The renderer groups markers by spatial proximity at each
  zoom level, drawing cluster pills with the contained-marker
  count and progressively splitting them as the user zooms.
  This is the entire point of the recipe — at world zoom, a
  500-service portfolio renders as ~12 cluster pills (one
  per major datacenter region), each showing the contained-
  service count.
- **`idField: "id"`** — explicit. Same alignment as the
  markers companion §4 — the SPL assembles `id` so making it
  explicit avoids any field-auto-detect ambiguity at
  drilldown time.

For severity-tinted cluster pills (a Splunk-side extension), add
`colorField: "alert_level"` plus a `categoricalPalette` mapping
0 → green, 1 → green, 2 → yellow, 3 → amber, 4 → red, 5 →
crimson (the standard ITSI severity scale). Without
`colorField`, cluster pills render in Better Map's default
neutral colour — still useful, just not severity-tinted.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic ITSI service portfolio seeded with
geographically-distributed services for cluster-density
verification._

## 6. Gotchas

- **Same `info_lat` / `info_lon` operator-extension dependency
  as the markers companion.** If the ITSI admin hasn't
  populated lat/lon in the service `info` block, this recipe
  silently filters every row out. The migration path is
  documented in the markers companion §6 — either a
  one-time `inputlookup … | eval info_lat=… | outputlookup
  itsi_services` patch, or a per-service UI edit at
  Configuration → Services → <service> → Info tab.
- **Cluster pill aggregate semantics are zoom-level dependent.**
  At world zoom, a single pill over Frankfurt might contain
  47 services with mixed health scores. The pill shows the
  count (47), not an aggregate health score — because
  averaging health scores across unrelated services is
  misleading. For a per-region health-aggregate view, use
  the [itsi-kpi-base/h3](../itsi-kpi-base/h3.md) companion
  which deliberately aggregates within hex cells.
- **`head 1000` is the render cap — the SPL itself is fast.**
  The 15-min window + per-service rollup typically returns
  <500 rows even at the largest customer installations. The
  1000-row cap is defensive; rendering load scales well
  beyond it.
- **No critical-KPI context in popups.** The markers companion
  adds `critical_kpi_count` via a join — this recipe
  deliberately omits the join because supercluster pills
  don't render per-row popup data at the cluster-aggregate
  level. For per-service operational context, click through
  to the markers companion as the drilldown target.
- **No OT safety dependency.** ITSI service health is an
  IT-services / business-services concept; the recipe
  doesn't interact with any OT control-zone signal.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk + ITSI built-ins (`stats`, `lookup`,
`eval`, `where`, `coalesce`, `tonumber`, `sort`, `fields`,
`head`). Verification path mirrors the markers companion §
"Verification status" — confirm `SA-ITOA` is installed, ITSI is
running, services exist with `info_lat` / `info_lon` populated,
dispatch via REST, drop into a Dashboard Studio panel with the
§4 formatter JSON, confirm cluster pills render at world zoom
and split correctly when zooming. Promote to `status: verified`
+ fill in `verified_against` in a follow-up PR.
