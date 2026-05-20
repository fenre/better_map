---
schema_version: 1
id: itsi-kpi-base--choropleth
source:
  id: itsi-kpi-base
  display_name: "ITSI service health (KPI base searches)"
  pattern: splunk-premium-itsi
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-29"
verified_against: null
splunk_apps_required:
  - id: "SA-ITOA"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "CA"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "California"
  - name: value
    type: integer
    example: "78"
  - name: avg_health_score
    type: integer
    example: "78"
  - name: service_count
    type: integer
    example: "12"
  - name: critical_service_count
    type: integer
    example: "2"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-service drilldown)"
    path: "docs/recipes/itsi-kpi-base/markers.md"
  - description: "Companion recipe — same source, H3 hexbin (service density at scale)"
    path: "docs/recipes/itsi-kpi-base/h3.md"
  - description: "Companion recipe — same source, heatmap (smoothed service density)"
    path: "docs/recipes/itsi-kpi-base/heat.md"
  - description: "Companion recipe — same source, supercluster (zoom-adaptive)"
    path: "docs/recipes/itsi-kpi-base/supercluster.md"
  - description: "Companion recipe — same source, paths (service-dependency arcs)"
    path: "docs/recipes/itsi-kpi-base/paths.md"
  - description: "Pattern reference — choropleth via iplocation + us-states preset (cim-network-traffic)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Pattern reference — choropleth via geom + us-states (cim-performance, per-state breach count)"
    path: "docs/recipes/cim-performance/choropleth.md"
  - description: "Pattern reference — choropleth via iplocation + us-states (thousandeyes, per-state agent count)"
    path: "docs/recipes/thousandeyes/choropleth.md"
  - description: "splunk-itsi skill — itsi_summary schema, SHKPI- service health, entity attributes"
    path: "~/.cursor/skills/splunk-itsi/SKILL.md"
  - description: "splunk-itsi-content skill — ITSI service / KPI / entity content packaging"
    path: "~/.cursor/skills/splunk-itsi-content/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enableChoropleth, featureJoinPreset, palette"
    path: "docs/_machine/formatter-schema.json"
---

# ITSI service health — US states choropleth

Aggregate the ITSI service portfolio by US state and render as a
**flat-fill choropleth** over the bundled `us-states.pmtiles`
preset, with per-state shading driven by the **average service
health score** (0-100) across all services geographically attributed
to each state. The canonical **"where is my business healthy
right now?"** panel for an SRE leader or CIO — the dark states
are where service health is degraded, the light states are where
operations are running normally.

The **7th choropleth recipe in the matrix** — joining
[geo-us-states](../geo-us-states/choropleth.md),
[cim-network-traffic](../cim-network-traffic/choropleth.md),
[cim-authentication](../cim-authentication/choropleth.md),
[cim-alerts](../cim-alerts/choropleth.md),
[cim-performance](../cim-performance/choropleth.md), and
[thousandeyes](../thousandeyes/choropleth.md). This advances the
choropleth layer column from 6 cells to 7, and brings the
itsi-kpi-base source row from 5 cells to 6 (markers, h3, heat,
supercluster, paths, plus choropleth now). It is the **first
choropleth recipe built on ITSI premium content** — joining the
ITSI source row that previously only carried point-level layers.

## 1. Source description

Same **Splunk IT Service Intelligence (ITSI)** source as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), and [paths](./paths.md)
companions — see
[itsi-kpi-base/markers §1](./markers.md#1-source-description) for
the full discussion of the `itsi_summary` index schema,
`SHKPI-`-prefixed service-health events, the `itsi_services` KV
store collection, and the operator-managed `info_lat` / `info_lon`
custom attributes on each service.

The relevant distinction for THIS recipe: instead of rendering one
marker per geocoded service (markers companion), the panel
aggregates services BY US state — using the
`geom geo_us_states latitude=info_lat longitude=info_lon`
point-in-polygon path — and renders one polygon fill per state
coloured by AVERAGE health score across the services attributed to
that state. A state with five services at health [95, 88, 82, 80,
75] shades light (avg=84, healthy); a state with five services at
health [95, 22, 18, 10, 5] shades dark (avg=30, degraded).

**Why choropleth for ITSI service health.** A markers panel shows
WHERE individual services live and their per-service health colour
(red/amber/green). But this is the per-service operational view —
the right shape for the SRE on-call. The leadership view answers
the regional question instead: "across the 50 US states, where is
my business healthy this morning and where is it not?" A
choropleth solves this in one panel: states with majority-healthy
services shade light, states with one critical service drag the
state-average down to "dark amber", and states with multiple
critical services shade outright "dark red". This is the right
shape for **executive war-room views** (CEO asks "are we
operational across the country?"), **regional GM dashboards**
(per-state managers see their territory's health at a glance),
and **compliance / SLA-aggregated views** (per-state averaging
gives a per-jurisdiction SLA proxy without joining against the
SLA contract data directly).

**Why `geom + info_lat/info_lon` and not `iplocation`.** ITSI
services don't have natural IP attribution — a service is a
business abstraction (e.g., "Payments — EU region", "Mobile
Banking — West Coast"), not a network entity. The operator-managed
`info_lat` / `info_lon` custom attributes on the
[`itsi_services` KV store collection](https://github.com/fenre/better_map/blob/main/docs/recipes/itsi-kpi-base/markers.md)
are the canonical source for service location. This recipe assumes
the operator has populated those attributes per the
[markers companion §1](./markers.md#1-source-description) — see
§6 Gotchas for the migration path if `info_lat` / `info_lon` are
empty across the service portfolio.

**Typical sourcetype / index:** `index=itsi_summary` (the only
ITSI index this recipe touches). The service KV store lookup is
either a direct `| inputlookup itsi_services` against the
collection or the ITSI built-in service-lookup macro
(`` `itsi_services` ``) if the install exposes it. SA-ITOA is the
ITSI base app and is required for both the index and the KV store.

## 2. SPL recipe

```spl
index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A" earliest=-15m latest=now
| stats latest(alert_value) AS health_score,
    latest(alert_level) AS alert_level,
    latest(service_title) AS service_title
  BY itsi_service_id
| lookup itsi_services _key AS itsi_service_id OUTPUT info_lat AS lat, info_lon AS lon
| where isnotnull(lat) AND isnotnull(lon)
| eval health_score=tonumber(health_score)
| eval alert_level=tonumber(alert_level)
| geom geo_us_states featureIdField="stusps" latitude=lat longitude=lon
| where isnotnull(featureId)
| stats avg(health_score) AS avg_health_score,
    count AS service_count,
    sum(eval(if(alert_level>=4, 1, 0))) AS critical_service_count,
    values(state_name) AS state_name
  BY featureId
| eval avg_health_score=round(avg_health_score, 0)
| eval value=avg_health_score
| rename featureId AS id
| fields id, state_name, value, avg_health_score, service_count, critical_service_count
| sort value
```

Why this exact shape, line by line:

- **`index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A"`** —
  filter to service-health-aggregate events only. Same first
  stage as the
  [markers companion §2](./markers.md#2-spl-recipe). `SHKPI-` is
  ITSI's prefix convention for synthetic service-health KPIs (one
  per service); `entity_key="N/A"` selects only the
  service-level aggregates, not per-entity rows.
- **`earliest=-15m latest=now`** — ITSI KPI cadence is 5 min by
  default; a 15 min window guarantees ≥2 snapshots per service
  for the `latest()` aggregation.
- **First `stats latest(...) BY itsi_service_id`** — one row per
  service, picking the freshest health-score and alert-level
  values per service. `itsi_service_id` is the KV store id —
  the join key for the next stage.
- **`lookup itsi_services _key AS itsi_service_id OUTPUT info_lat
  AS lat, info_lon AS lon`** — THE critical line. Retrieves each
  service's operator-managed lat/lon attributes from the
  `itsi_services` KV store collection. The recipe assumes
  `info_lat` and `info_lon` are populated per the
  [markers companion §1](./markers.md#1-source-description)
  ITSI extension pattern (see §6 Gotchas for the migration path
  if those fields are empty).
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop services
  without geographic attribution. Real ITSI services that are
  being monitored but have no operator-set location attribute
  fall out here. Surface in a companion table panel ("Services
  lacking location data: <count>") so the ITSI admin sees the
  attribute gap.
- **`eval health_score=tonumber(health_score)` / `eval
  alert_level=tonumber(alert_level)`** — coerce both fields to
  numeric. ITSI emits these as strings in some versions; the
  downstream `avg()` and the `if(alert_level>=4, ...)` both
  require numeric.
- **`geom geo_us_states featureIdField="stusps" latitude=lat
  longitude=lon`** — Splunk's bundled point-in-polygon
  enrichment. Reads each service's lat/lon, queries the
  bundled `geo_us_states` geometry lookup, and populates
  `featureId` (the USPS 2-letter code — "CA", "VA", etc.) plus
  `state_name` (the full state name — "California", "Virginia",
  etc.). Same pattern as the
  [cim-performance/choropleth](../cim-performance/choropleth.md)
  companion's per-host attribution.
- **`where isnotnull(featureId)`** — drops services whose
  lat/lon falls outside the 50 states + DC (Canada, Mexico,
  international datacenters, points in oceans from bad data).
  Without this guard those rows aggregate under a synthetic
  null-state bucket that confuses the downstream `BY featureId`.
- **Second `stats ... BY featureId`** — roll up per-service
  rows into per-state rows. `avg(health_score)` is the
  headline metric (the per-state average drives the colour
  fill); `count` is the service count (popup detail);
  `sum(eval(...))` counts critical services in the state via
  inline boolean coercion (popup detail — "3 services in
  California are critical right now"); `values(state_name)`
  preserves the human-readable state name from the geom
  enrichment.
- **`eval avg_health_score=round(..., 0)`** — round the average
  to integer for display. The underlying score is still
  float-precise; the rounding is cosmetic for popup formatting.
- **`eval value=avg_health_score`** — explicit copy. The
  choropleth layer reads `value` per the formatter contract.
- **`rename featureId AS id`** — adopt Better Map's canonical
  `id` alias to match the `featureJoinPreset: "us-states"`
  contract.
- **`fields ...`** — explicit projection of the six fields
  declared in `expected_fields` frontmatter.
- **`sort value`** — UNHEALTHY-FIRST (ascending health score).
  Inverts the typical "sort -value" because health is
  high-is-good — the dashboard reader's eye should land on the
  worst-aggregated state first when scanning the result table.
- **No `head` cap.** Maximum row count is 51 (50 states + DC),
  well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field                  | type    | example     |
|------------------------|---------|-------------|
| id                     | string  | CA          |
| state_name             | string  | California  |
| value                  | integer | 78          |
| avg_health_score       | integer | 78          |
| service_count          | integer | 12          |
| critical_service_count | integer | 2           |

Six fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `value` drives the choropleth
shading; `state_name` / `service_count` / `critical_service_count`
flow through as feature properties on the joined polygon for
popups.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "RdYlGn"
}
```

Why this minimal config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). Same preset as all six existing
  choropleth recipes.
- **`enableChoropleth: "true"`** — switches the join layer from
  neutral polygon outline to colour-graded fill.
- **`palette: "RdYlGn"`** — diverging red-yellow-green palette.
  This is the **opposite default from the other choropleth
  recipes** (which use `viridis` for presence / `magma` for
  alerting). The reason: health scores are **directionally
  semantic** — high values are GOOD (healthy), low values are
  BAD (degraded). The RdYlGn diverging palette maps low → red
  ("alarm"), mid → yellow ("caution"), high → green ("OK") —
  the canonical traffic-light semantics that operations teams
  read pre-attentively. For a colour-blind-safe alternative,
  swap to `RdYlBu` (red-yellow-blue) which preserves the
  diverging directional semantic without relying on
  red-green discrimination. For a single-direction "lower is
  worse" framing (no green ceiling — useful when the executive
  view is "show me only the bottom decile"), switch to
  `magma` (warm-equals-attention, dark = degraded health).

For a **service-COUNT-driven view** (highlights states with
many services regardless of health — useful for capacity-planning
discussions about "where do we have the densest service
footprint?"), make the §2 SPL swap (`eval value=service_count`)
and switch `palette: "RdYlGn"` → `palette: "viridis"` (count is
not directionally semantic; viridis is neutral). For a
**critical-service-count view** (highlights states with active
problems — useful for incident-bridge framing), swap to
`eval value=critical_service_count` and `palette: "magma"` or
`"YlOrRd"`.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by (a) staging an ITSI lab tenant with
SA-ITOA, (b) populating the `itsi_services` KV store with a
representative service portfolio across US states (typically a
demo includes "Payments — CA", "Mobile Banking — NY", "Inventory
— TX", etc., with mixed health scores), (c) confirming
`info_lat` / `info_lon` are populated on each service via the
ITSI admin UI's service-attribute editor, and (d) pasting the
SPL above into a Dashboard Studio map panel with Better Map as
the visualization plus applying the §4 formatter JSON. The
choropleth should shade states diverging on health: at least
two-three states clearly red (degraded), several states green
(healthy), and the mid-tier in yellow._

## 6. Gotchas

- **`info_lat` / `info_lon` is the operator-managed extension
  pattern.** ITSI doesn't ship native lat/lon attributes on its
  services — the operator must populate them via the service
  template's "Info" tab (or via `| outputlookup itsi_services`
  bulk import). For a green-field install where these attributes
  are empty across the portfolio, three options:
  1. **Operator UI**: walk the service tree in the ITSI admin
     UI and set `info_lat` / `info_lon` per service. Tedious
     for large portfolios (50+ services).
  2. **Bulk seed via lookup**: maintain a
     `service_locations.csv` lookup with `service_id`, `lat`,
     `lon` columns, then `| inputlookup service_locations.csv
     | inputlookup itsi_services append=t | stats latest(lat)
     AS info_lat, latest(lon) AS info_lon, latest(_key) AS
     _key BY _key | outputlookup itsi_services`. One-time
     bootstrap.
  3. **Derive from entities**: if your services aggregate
     entities that DO have lat/lon (e.g., the entities are
     hosts with asset-lookup-derived locations), compute the
     service's lat/lon as the centroid of its entities and
     write back via `outputlookup`. Pattern documented in
     [`~/.cursor/skills/splunk-itsi/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-itsi/SKILL.md).

- **`avg(health_score)` can hide minority outliers.** A state
  with 10 services at health [95, 95, 95, 95, 95, 95, 95, 95,
  95, 5] averages to 86 — visually a "light" state in the
  choropleth, but one service is in catastrophic failure. The
  popup-detail `critical_service_count` is the signal here: a
  state with `critical_service_count >= 1` deserves a visual
  flag regardless of its average. Two mitigations:
  - **Dashboard pattern**: pair this choropleth with a side
    table panel filtered to `critical_service_count >= 1`
    rows from the same SPL, so the operator always sees the
    "states with active critical services" list alongside the
    averaged-fill choropleth.
  - **SPL pattern**: swap `eval value=avg_health_score` to
    `eval value=if(critical_service_count >= 1, 0,
    avg_health_score)` — this forces any state with a
    critical service to shade RED regardless of the rest of
    the portfolio's health. Trades nuance for safety; the
    right default for a "watch-floor / NOC" dashboard.

- **ITSI alert_level vs health_score independence.** Two
  distinct ITSI signals: `alert_level` (0-5 ordinal severity)
  and `health_score` (0-100 continuous). They're CORRELATED but
  not deterministic — a service with `alert_level=4` (High)
  typically has `health_score < 50`, but a custom-tuned KPI
  threshold model can decouple them (e.g., a service's health
  score remains high because all its KPIs are within band, but
  the SERVICE itself was manually marked High-severity by an
  on-call engineer for a reason invisible to the KPI math).
  This recipe surfaces `critical_service_count` from
  `alert_level`, which captures the manual-override case;
  `avg(health_score)` is the math-derived signal. Combining
  both in the popup gives the operator the full picture.

- **`geom geo_us_states` requires the bundled geometry lookup.**
  Same caveat as the
  [cim-performance/choropleth companion §6](../cim-performance/choropleth.md#6-gotchas):
  the bundled `geo_us_states` lookup is part of the core Splunk
  install. Three substitution paths (the
  `Splunk_TA_geo_us_states` add-on, the bundled
  `presets/us-states.pmtiles` via `geom_lookup`, or a custom
  lookup populated with USPS / state-name / WKT-polygon
  triples) are documented in the cim-performance gotchas.

- **US-only preset is a hard boundary.** Same caveat as all
  US-states choropleth recipes: the bundled
  `us-states.pmtiles` covers the 50 states + DC only. Non-US
  ITSI services (services deployed in EU / APAC datacenters)
  are filtered out by the `where isnotnull(featureId)` guard.
  For **global per-country service-health aggregation**, the
  pattern is the same as the
  [meraki/vector-tile-join](../meraki/vector-tile-join.md)
  and
  [thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md)
  companions: swap the `geom geo_us_states` step for a country
  aggregation step (currently this requires a
  service-location → country lookup since ITSI doesn't ship
  one, but the lookup is a simple `info_country` operator-set
  attribute or an `iplocation`-style coordinates-to-country
  helper). Ship in a future `itsi-kpi-base/vector-tile-join`
  recipe if the source row's coverage warrants it.

- **`itsi_services` KV store access requires SA-ITOA + correct
  RBAC.** The KV store collection is access-controlled via
  ITSI's role model. A user without `itoa_admin` or
  `itoa_user` capabilities (specifically `read_itsi_services`)
  can't `| lookup itsi_services` even though they have the
  base Splunk capabilities to run SPL. Surface "service health
  unavailable for this user" as a dashboard markdown banner
  when the SPL returns zero rows AND the user is logged in —
  the most common cause is RBAC, not data.

- **No OT-safety dependency in the base recipe.** ITSI is an
  IT-services overlay; the SHKPI- service health events
  aggregate IT-side KPIs (CPU, memory, response time, error
  rate, availability). However, **if your install has ITSI
  services that aggregate OT-zone KPIs** — a hybrid
  manufacturing-IT install where ITSI tracks "Plant 7
  Operations" as a service — apply
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 to the recipe: split into two recipes, set
  `ot_safety_relevant: true` on the OT-aware variant, document
  the SIS-dependency in the surrounding markdown, and ensure
  the SOAR / response runbook for any "service degraded"
  notable explicitly excludes Level-0/1/2 containment actions
  per Rule 3.

## Verification status

`status: unverified` in the frontmatter — the SPL uses only Splunk
built-ins (`stats`, `lookup`, `eval`, `where`, `geom`, `rename`,
`fields`, `sort`) plus SA-ITOA's `itsi_summary` index and
`itsi_services` KV store collection. The
[markers companion](./markers.md) (which uses the same
`itsi_summary` query + `itsi_services` lookup pattern) has not
been dispatched against the v1.7-prep lab tenant either (see its
own §Verification status for the same reasons). A maintainer with
REST auth and an ITSI install with populated `info_lat` /
`info_lon` service attributes should follow the verification
steps in the
[markers companion §Verification status](./markers.md#verification-status)
(substituting this recipe's §4 choropleth formatter for the
markers companion's marker formatter), then promote both this
recipe AND the markers companion to `status: verified` + fill in
`verified_against` in a follow-up PR.
