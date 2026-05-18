---
schema_version: 1
id: itsi-kpi-base--markers
source:
  id: itsi-kpi-base
  display_name: "ITSI service health (KPI base searches)"
  pattern: splunk-premium-itsi
layer:
  id: markers
  display_name: Markers
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
    drives_formatter_option: markerColor
  - name: alert_level
    type: integer
    example: "3"
  - name: critical_kpi_count
    type: integer
    example: "1"
references:
  - description: "splunk-itsi skill — itsi_summary schema, SHKPI- service health, entity attributes"
    path: "~/.cursor/skills/splunk-itsi/SKILL.md"
  - description: "splunk-itsi-content skill — ITSI service / KPI / entity content packaging"
    path: "~/.cursor/skills/splunk-itsi-content/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
required_formatter_options:
  - pointRenderer
  - idField
  - markerColor
ot_safety_relevant: false
---

# ITSI service health — markers

Render every ITSI service that has been tagged with a geographic
location as a marker, positioned at the service's home
datacenter / region / site, sized to its current health score
(0–100), coloured by alert level (Normal / Low / Medium / High /
Critical). The canonical "where are my services healthy /
unhealthy right now?" panel for an SRE or NetOps overview —
think of it as the ITSI Service Analyzer's globe view.

## 1. Source description

**Splunk IT Service Intelligence (ITSI)** is the AIOps overlay
on Splunk Enterprise: services aggregate KPIs (each KPI is a
saved search that emits a numeric `alert_value` every N
minutes), KPI severities aggregate into a service health score
(0–100, where 100 is healthy), service trees aggregate into
business-service health. The aggregation cadence is
configurable per KPI (default 5 minutes).

The data home is the `itsi_summary` index, populated by every
ITSI KPI search and by the per-service health-score computation
(stored as a synthetic KPI with id starting with `SHKPI-`). Each
event in `itsi_summary` carries:

- `kpi_id` — the unique KPI identifier (`SHKPI-<service_id>`
  for service-health events, an alphanumeric id for individual
  KPIs)
- `entity_key` — the entity the measurement is attributed to,
  or the literal string `"N/A"` for service-level aggregates
- `service_title` — human-readable service name (`"Payments
  (EU region)"`)
- `alert_value` — the numeric value the KPI emitted (for a
  service-health KPI, the 0–100 health score)
- `alert_level` — the severity bucket (0=Info, 1=Normal,
  2=Low, 3=Medium, 4=High, 5=Critical)
- `itsi_service_id` — the KV store id of the parent service

This recipe queries the most recent service-level health-score
event per service (the `SHKPI-` events where `entity_key="N/A"`),
joins against the ITSI service KV store collection
(`itsi_services`) to retrieve the `info` block (where the
operator stored the service's lat/lon as `info_lat` / `info_lon`
custom attributes), and renders one marker per geocoded service.

**Typical sourcetype / index:** `index=itsi_summary` (the only
ITSI index this recipe touches). The service KV store lookup is
either a direct `| inputlookup` against the `itsi_services`
collection or the ITSI built-in service-lookup macro
(`` `itsi_services` ``) if the install exposes it. The service
attribute model (storing lat/lon in `info_lat`/`info_lon`) is a
documented ITSI extension pattern — see [`~/.cursor/skills/splunk-itsi/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/itsi-kpi-base/markers.md)
on entity / service attribute schemas.

## 2. SPL recipe

```spl
index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A" earliest=-15m latest=now
| stats latest(alert_value) AS health_score, latest(alert_level) AS alert_level, latest(service_title) AS service_title BY itsi_service_id
| lookup itsi_services _key AS itsi_service_id OUTPUT info_lat AS lat, info_lon AS lon, identifying_name
| where isnotnull(lat) AND isnotnull(lon)
| eval health_score=round(health_score, 0)
| eval alert_level=tonumber(alert_level)
| join type=left itsi_service_id [
    search index=itsi_summary kpi_id!="SHKPI-*" entity_key="N/A" earliest=-15m latest=now alert_level>=4
    | stats dc(kpi_id) AS critical_kpi_count BY itsi_service_id
  ]
| fillnull value=0 critical_kpi_count
| eval id=coalesce(identifying_name, itsi_service_id)
| fields id, lat, lon, service_title, health_score, alert_level, critical_kpi_count
| sort - alert_level, - critical_kpi_count, service_title
| head 500
```

Why this exact shape, line by line:

- **`index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A"`** —
  filter to service-health-aggregate events only. `SHKPI-` is
  ITSI's prefix convention for synthetic service-health KPIs
  (one per service); `entity_key="N/A"` filters out per-entity
  rows (a service-health roll-up is service-wide, not per-
  entity).
- **`earliest=-15m latest=now`** — KPI cadence defaults to 5
  min, so a 15 min window guarantees at least 2 snapshots per
  service. `latest()` then picks the freshest per service.
  Raising to `-1h` is fine for an executive view; dropping
  below 10 min risks "no data" rows during KPI evaluation
  delays (per [`~/.cursor/skills/splunk-itsi/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/itsi-kpi-base/markers.md)
  troubleshooting).
- **`stats latest(...) BY itsi_service_id`** — one row per
  service, taking the freshest of each field. `itsi_service_id`
  is the KV store id — the join key for the next stage.
- **`lookup itsi_services _key AS itsi_service_id OUTPUT info_lat AS lat, info_lon AS lon, identifying_name`** —
  THE critical line. The ITSI service collection has each
  service's `_key` (the KV store id) and an `info` block
  where the operator stored custom attributes. The recipe
  assumes the operator has populated `info_lat` and
  `info_lon` (the standard ITSI extension pattern — see
  Gotchas for the migration path if those fields are not
  populated). `identifying_name` is the canonical service
  identifier (e.g. `svc_payments_eu`); fall back to
  `itsi_service_id` if the field is null.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop services
  without a geographic attribution. These are real ITSI
  services and they ARE being monitored; they just have no
  geographic representation. Surface in a companion table
  panel ("Services lacking location data: <count>") so the
  ITSI admin sees the attribute gap.
- **`eval health_score=round(health_score, 0)`** — ITSI emits
  health scores as floats (`78.3471...`); round to integer for
  display. The underlying score is still float-precise; the
  rounding is cosmetic.
- **`eval alert_level=tonumber(alert_level)`** — `alert_level`
  is emitted as a string in some ITSI versions; coerce to
  integer so the formatter's colour-ramp by `alert_level`
  works (palette lookups want numeric keys).
- **The `join` subsearch** — count how many INDIVIDUAL KPIs on
  this service are currently in the Critical bucket
  (`alert_level >= 4`, which is High or Critical). This adds
  important context to the popup ("Health 78; 1 KPI currently
  Critical"); without it the operator can't tell whether the
  78 is "mostly OK with one tiny problem" or "rapidly
  degrading multi-KPI cascade". The join is bounded by the
  same 15 min window and the same `itsi_service_id` join key,
  so it scales linearly with service count.
- **`fillnull value=0 critical_kpi_count`** — services with no
  Critical KPIs get `critical_kpi_count=NULL` from the join;
  promote NULL to 0 so the popup reads "0 critical KPIs"
  instead of "NaN" / blank.
- **`rename` to `id`** — adopt Better Map's `id` alias. The
  `identifying_name` is more human-readable than the KV store
  `_key`; fall back to `_key` if the operator hasn't
  configured an identifying name.
- **`sort - alert_level, - critical_kpi_count, service_title`** —
  worst services first. Stable sort by service title for
  deterministic rendering at equal severity.
- **`head 500`** — render budget. Even the largest ITSI
  installs run ~200 top-level services; 500 covers nested
  business-service views without overflow.

## 3. Expected fields

| field              | type    | example                       |
|--------------------|---------|-------------------------------|
| id                 | string  | svc_payments_eu               |
| lat                | number  | 53.5511                       |
| lon                | number  | 9.9937                        |
| service_title      | string  | Payments (EU region)          |
| health_score       | integer | 78                            |
| alert_level        | integer | 3                             |
| critical_kpi_count | integer | 1                             |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#2ca02c"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — services in large
  installations cluster geographically (one POP per major
  region; multiple business services share an underlying
  datacenter). Clustering buckets nearby markers and zooms in
  to split. Switch to `"markers"` only if the install is small
  and rendered at a fixed zoom.
- **`idField: "id"`** — explicit override. The auto-detector
  might prefer `service_title` (also a candidate ID column),
  but the rename'd `id` is the immutable KV store
  `identifying_name` and is what drilldown URLs should use.
- **`markerColor: "#2ca02c"`** — Tableau healthy-green
  default, reading as "all services nominal" at first load.
  Override the per-marker colour via the `palette` formatter
  option keyed off `alert_level`
  (`{ "0": "#2ca02c", "1": "#2ca02c", "2": "#ffbb78",
  "3": "#ff7f0e", "4": "#d62728", "5": "#7f0e7f" }` for
  Info / Normal / Low / Medium / High / Critical). The
  `markerColor` is the base / unsized swatch — when the panel
  loads and every service is Normal, the map is green; when
  one service degrades, that marker pops red against the
  baseline.
- **`service_title`, `health_score`, `alert_level`,
  `critical_kpi_count` flow through automatically** as feature
  properties for the popup. The default popup will show
  "`svc_payments_eu` · Payments (EU region) · Health 78 ·
  alert_level 3 · 1 critical KPI" with no further config
  (`enablePopups: true` is the default per [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will need ITSI installed plus the
`itsi_services` collection seeded with at least one service
carrying `info_lat`/`info_lon` attributes — both are out of
scope for the v1.7 D5 deliverable, so this recipe (like the
[`es-risk/markers.md`](../es-risk/markers.md) recipe) will be
validated against an ITSI-licensed verification tenant rather
than the default D5 lab environment._

## 6. Gotchas

- **`info_lat` / `info_lon` are NOT default ITSI service
  attributes.** ITSI ships with no geographic attribute model
  for services; the operator has to add `info_lat` and
  `info_lon` as custom service attributes via the ITSI UI
  (Configuration → Service Templates → custom attributes) or
  by bulk-loading via the ITSI REST API. If your tenant has
  not done this, this recipe returns ZERO results — see
  "Entity-attribute fallback" below for the alternative shape.
- **ITSI version drift in the `info` field.** Some ITSI 4.x
  installs store custom attributes inline on the service KV
  store record (`info_lat` is a direct field); 4.13+ stores
  them inside a nested `info` JSON blob (the lookup auto-
  flattens with `info_lat` as the resolved column name). The
  recipe assumes the auto-flattened shape. If `| inputlookup
  itsi_services | head 1` shows an `info` column containing
  raw JSON, switch to `| spath input=info path=lat output=lat
  | spath input=info path=lon output=lon` before the lookup.
- **Entity-attribute fallback.** If services aren't geocoded
  but ENTITIES are (the `itsi_entities` collection has
  per-entity location data, which is more common —
  datacenter / rack / room labels are an entity attribute),
  invert the recipe: aggregate `itsi_summary` BY
  `entity_key` instead of `itsi_service_id`, lookup against
  `itsi_entities`, and render one marker PER ENTITY rather
  than per service. The visual story is different ("which
  hosts are unhealthy?" vs "which services are unhealthy?")
  but the SPL transformation is straightforward.
- **`SHKPI-` event delivery lag.** ITSI's service-health
  aggregator runs SLIGHTLY after the underlying KPI searches
  finish (the aggregator subscribes to the KPI search-job
  completion bus). On a busy SH the aggregator can lag 30-60
  seconds. The 15 min `earliest=-15m` window absorbs this; do
  not narrow below 10 min in high-volume tenants.
- **`alert_level` numeric encoding varies.** The default ITSI
  severity map is 0=Info, 1=Normal, 2=Low, 3=Medium, 4=High,
  5=Critical. Custom severity templates can extend this (a
  6-level "Catastrophic" or a 0-level "Unknown"). If your
  install uses a custom severity template, adjust the
  palette in §4 to match. `index=itsi_summary | stats values(alert_level)`
  enumerates the in-use values.
- **`itsi_services` lookup name.** The recipe assumes the
  default ITSI collection name. Some installs rename
  collections (Splunk Cloud multi-tenant deployments
  sometimes prefix with the customer code, e.g.
  `acme_itsi_services`). Confirm with `| rest
  /servicesNS/-/-/storage/collections/config | search
  collection=*itsi*`.
- **The join subsearch is the most-expensive line.** A
  tenant with 500 services × 20 KPIs each × 15 min × 5 min
  cadence = 30,000 events to evaluate. The subsearch IS
  bounded (`alert_level>=4` filters first) but is the
  performance ceiling. If your tenant exceeds this, replace
  the join with a precomputed summary search that emits one
  row per service-with-critical-KPIs every minute and join
  against THAT.
- **Time range.** Hard-coded `earliest=-15m latest=now` so
  the panel works without a dashboard time picker and stays
  scoped to "current health, not historical". Avoid
  parameterising — this panel is a "right now" view; an
  hour-old health score is a different question (use a
  trend chart, not a marker map).
- **PII / GDPR posture.** Per ROADMAP §1a, Better Map never
  sends event data outside `splunkd:8089`. Service titles
  can embed organisational structure (`Payments - Acme
  Bank - EU - DR site`); this surfaces in popups. If service
  titles are themselves regulated information, restrict via
  Splunk RBAC on the `itsi_summary` index OR rename services
  to anonymous identifiers in the SPL `eval` step.
- **No OT safety dependency.** This recipe is pure IT
  service-health. If your ITSI install ALSO monitors OT-zone
  services (an SIS health-roll-up KPI, a Modbus telegram-rate
  KPI), filter those services OUT of THIS recipe (`NOT
  itsi_service_id IN ("svc_sis_*")`) and put them in a
  DEDICATED recipe with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — an unhealthy SIS service warrants a fundamentally
  different operator response than an unhealthy IT service,
  and they should not visually compete on the same map.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented ITSI `itsi_summary` schema and
service KV store collection contract from
[`~/.cursor/skills/splunk-itsi/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/itsi-kpi-base/markers.md),
but it has NOT been dispatched against a tenant carrying both
ITSI licence AND services with populated `info_lat`/`info_lon`
attributes. The v1.7-prep lab tenant is search-only without
ITSI. A maintainer with REST auth to an ITSI-licensed tenant
should:

1. Verify the `itsi_services` collection has at least one
   service with `info_lat` and `info_lon` populated:
   `| inputlookup itsi_services | where isnotnull(info_lat) |
   stats count`.
2. Confirm `itsi_summary` has data: `index=itsi_summary kpi_id="SHKPI-*"
   earliest=-15m | stats count BY itsi_service_id`.
3. Run the recipe SPL and confirm the panel renders at least 1
   marker per geocoded service.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app: "SA-ITOA"`), and
   submit a follow-up PR.
