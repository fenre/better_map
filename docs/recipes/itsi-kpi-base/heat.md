---
schema_version: 1
id: itsi-kpi-base--heat
source:
  id: itsi-kpi-base
  display_name: "ITSI service health (KPI base searches)"
  pattern: splunk-premium-itsi
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "SA-ITOA"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "DC-AMS-01"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "53.5511"
  - name: lon
    type: number
    example: "9.9937"
  - name: unhealthy_services
    type: integer
    example: "7"
  - name: total_services
    type: integer
    example: "23"
  - name: weight
    type: number
    example: "1.0"
    drives_formatter_option: heatmapWeight
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-service identity)"
    path: "docs/recipes/itsi-kpi-base/markers.md"
  - description: "Pattern reference — heatmap with weight normalisation on lookup-anchored sites"
    path: "docs/recipes/kvstore-latlon/heat.md"
  - description: "Pattern reference — alert-density heatmap (same eventstats max pattern)"
    path: "docs/recipes/es-risk/heat.md"
  - description: "splunk-itsi skill — itsi_summary schema, SHKPI- service health, entity attributes"
    path: "~/.cursor/skills/splunk-itsi/SKILL.md"
  - description: "splunk-itsi-content skill — ITSI service / KPI / entity content packaging"
    path: "~/.cursor/skills/splunk-itsi-content/SKILL.md"
  - description: "Layer reference — heatmap"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius, heatmapWeight"
    path: "docs/_machine/formatter-schema.json"
---

# ITSI service health — heatmap

The per-site density complement to the
[itsi-kpi-base/markers](./markers.md) recipe — same
`itsi_summary` ⋈ `itsi_services` join, but instead of one marker
per service the panel aggregates BY (`lat`, `lon`) site and
renders the per-site UNHEALTHY-SERVICE-COUNT as a smooth
Gaussian heat surface. The canonical "where is service-health
pressure CONCENTRATED right now?" panel for an ITSI / SRE
leadership briefing — think of it as the ITSI Service Analyzer
view zoomed out from "every dot" to "which DATACENTER is on
fire?"

## 1. Source description

Same `itsi_summary` index + `itsi_services` KV-Store collection
as the [markers companion](./markers.md). The recipe assumes the
same prerequisite — that the operator has populated `info_lat` +
`info_lon` as custom service attributes via the ITSI UI
(Configuration → Service Templates → custom attributes) or via
the ITSI REST API. Without that, both recipes return zero rows.

The DIFFERENCE between the markers companion and this heat
recipe is the per-site aggregation regime:

- **Markers layer** renders one marker per service, coloured
  by `alert_level` and sized by `health_score`. Per-service
  identity is preserved — the operator can click a marker and
  drill into the ITSI Service Analyzer for that specific
  service. Right for **per-service investigation panels** and
  **"which specific service is degraded?"** workflows.
- **Heat layer** (this recipe) AGGREGATES services by their
  shared (`lat`, `lon`) site — the typical large ITSI install
  has 200-500 services running across 5-20 datacenters, so
  every datacenter is a single (`lat`, `lon`) point with
  20-50 services attached. The heatmap renders one weighted
  blob per site, with `weight ∝ unhealthy_services` (services
  with `alert_level ≥ 3` — Medium / High / Critical). Right
  for:
  - **Executive / leadership health briefings.** "The AMS-01
    datacenter has 7 unhealthy services right now (vs DUB-01
    with 1)" reads as a hot-vs-warm gradient on the map, no
    per-service detail required.
  - **Multi-datacenter capacity planning.** "Every EU
    datacenter is in the orange zone; we should not migrate
    more services to EMEA this quarter."
  - **Incident-response correlation panels.** During a
    region-wide cloud outage, the heat surface shows the
    blast radius at a glance — every site in the affected
    region lights up simultaneously.

See §6 Gotchas "Layer choice" table for heat-vs-markers-vs-
(future)-h3 decision guidance.

**Typical sourcetype / index:** `index=itsi_summary` (the only
ITSI index this recipe touches, same as the markers companion).
The service KV-Store lookup is either a direct `| inputlookup`
against the `itsi_services` collection or the ITSI built-in
service-lookup macro (`` `itsi_services` ``) if the install
exposes it. The service attribute model (storing lat/lon in
`info_lat`/`info_lon`) is a documented ITSI extension pattern
— see [`~/.cursor/skills/splunk-itsi/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/itsi-kpi-base/heat.md)
on entity / service attribute schemas.

## 2. SPL recipe

```spl
index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A" earliest=-15m latest=now
| stats latest(alert_level) AS alert_level BY itsi_service_id
| lookup itsi_services _key AS itsi_service_id OUTPUT info_lat AS lat, info_lon AS lon
| where isnotnull(lat) AND isnotnull(lon)
| eval alert_level=tonumber(alert_level)
| eval is_unhealthy=if(alert_level >= 3, 1, 0)
| stats sum(is_unhealthy) AS unhealthy_services, count AS total_services BY lat, lon
| eventstats max(unhealthy_services) AS max_unhealthy
| eval weight=round(if(max_unhealthy > 0, unhealthy_services / max_unhealthy, 0), 2)
| eval id=lat . "_" . lon
| fields id, lat, lon, unhealthy_services, total_services, weight
| sort - unhealthy_services
| head 5000
```

Why this exact shape, line by line:

- **`index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A"`** —
  same prefix filter as the [markers companion §2](./markers.md#2-spl-recipe).
  `SHKPI-` is ITSI's prefix for synthetic service-health KPIs
  (one per service); `entity_key="N/A"` filters out per-entity
  rows.
- **`earliest=-15m latest=now`** — same 3× KPI-cadence
  window as the markers companion (service-health roll-ups
  emit every 5 min by default). Do NOT widen for the heat
  layer specifically — the panel question is "where is
  pressure RIGHT NOW?" not "over the last hour?".
- **`stats latest(alert_level) AS alert_level BY itsi_service_id`** —
  drop everything except the freshest `alert_level` per
  service. The heat recipe DOESN'T need `health_score`
  because the panel signal is binary per-service ("unhealthy
  vs healthy"), not the continuous 0-100 number.
- **`lookup itsi_services ... OUTPUT info_lat AS lat, info_lon AS lon`** —
  same join as markers. The heat recipe pulls FEWER fields
  (no `identifying_name` or `service_title`) because per-
  service identity is intentionally discarded by the per-site
  aggregation below.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  services without geographic attribution (same as markers).
  Surface the dropped count in a companion table panel so the
  ITSI admin sees the attribute gap.
- **`eval alert_level=tonumber(alert_level)`** — string-to-
  number coercion. Without this the `>= 3` comparison would
  silently misclassify ("10" < "3" lexicographically).
- **`eval is_unhealthy=if(alert_level >= 3, 1, 0)`** — the
  per-service binary flag. `alert_level >= 3` is the
  conventional "Medium-or-worse" threshold (3=Medium,
  4=High, 5=Critical); levels 0-2 (Info / Normal / Low) count
  as "healthy enough." The threshold IS adjustable — change
  to `>= 4` for a "High-or-Critical only" panel that's less
  noisy but slower to flag emerging degradation. Document the
  threshold choice in the dashboard description so operators
  understand what "unhealthy" means in their context.
- **`stats sum(is_unhealthy) AS unhealthy_services, count AS total_services BY lat, lon`** —
  THE pivotal line. Switch from per-service to per-site
  aggregation. `sum(is_unhealthy)` counts how many services
  at this (`lat`, `lon`) are in Medium+ severity right now;
  `count` counts the total services at the site (the
  denominator if you want to render a percentage instead of
  an absolute count — see §6 Gotchas for the percentage
  variant). One row per geographic site, regardless of how
  many services share that site.
- **`eventstats max(unhealthy_services) AS max_unhealthy`** —
  Better Map's heat-layer expects `weight ∈ [0, 1]`;
  `eventstats` computes the dataset-wide max WITHOUT
  collapsing rows (vs `stats max` which would reduce to one
  row and break the per-site aggregation). Matches the
  [kvstore-latlon/heat](../kvstore-latlon/heat.md) and
  [es-risk/heat](../es-risk/heat.md) normalisation pattern.
- **`eval weight=round(if(max_unhealthy > 0, unhealthy_services / max_unhealthy, 0), 2)`** —
  per-site weight on `[0, 1]`. The `if` guard avoids
  NaN-divide when every service is healthy (max=0 → empty
  heat panel, correct behaviour).
- **`eval id=lat . "_" . lon`** — heat layer doesn't strictly
  need `id` (per-feature identity is moot for a density
  grid), but the formatter `idField` enables the per-site
  hover popup. The `lat_lon` concatenation is stable because
  two sites cannot share both lat AND lon.
- **`fields ...`** — explicit projection. Drops `alert_level`
  (already used in `is_unhealthy`) and transient lookup
  columns.
- **`sort - unhealthy_services`** — most-stressed first
  (matters for the companion "Top 10 sites" table panel; the
  heat renderer itself is row-order-agnostic).
- **`head 5000`** — safety net. Largest ITSI installs run
  500 services across 20-40 datacenters; 5000 is 100× the
  realistic upper bound on per-site rows.

## 3. Expected fields

| field              | type    | example   |
|--------------------|---------|-----------|
| id                 | string  | DC-AMS-01 |
| lat                | number  | 53.5511   |
| lon                | number  | 9.9937    |
| unhealthy_services | integer | 7         |
| total_services     | integer | 23        |
| weight             | number  | 1.0       |

All six appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`. The `id`
shown in the example column (`DC-AMS-01`) is illustrative — the
actual SPL derives `id = lat . "_" . lon` (e.g.
`53.5511_9.9937`) because the source data doesn't carry a
human-readable per-site label. If your install supplies one
(e.g. via a second `info_datacenter_code` service attribute),
pull it through the lookup and use it as `id` instead — see §6
Gotchas.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 32
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the heat
  renderer. The `auto` renderer would pick markers (≤ 200
  features), then cluster (200-10000), then heat (≥ 10000);
  this recipe typically returns 5-40 per-site rows (well below
  the auto-heat threshold), so `auto` would default to
  markers — which is the markers companion's job, not this
  recipe's. Always pin explicitly.
- **`heatmapOpacity: 0.75`** — matches the
  [kvstore-latlon/heat](../kvstore-latlon/heat.md) and
  [es-risk/heat](../es-risk/heat.md) recipes. At 1.0 the
  heatmap fully occludes the basemap labels (city / region
  names disappear under the heat surface); at 0.5 the
  surface is washed out and the colour ramp loses precision;
  0.75 is the sweet spot for an executive / SRE audience
  that needs both the per-site pressure surface AND the
  underlying geography context.
- **`heatmapRadius: 32`** — slightly larger than the
  [kvstore-latlon/heat](../kvstore-latlon/heat.md) default
  of 24px because ITSI service deployments cluster MORE
  tightly geographically (3-5 datacenters per continent vs
  20-100 sites for an events-density panel). A 32px radius
  ensures adjacent datacenters in the same metro (e.g.
  AMS-01 + AMS-02 in the Amsterdam metro) blend into a
  single pressure blob rather than rendering as two
  disjoint dots; cross-continental sites still render
  independently. For globally-distributed installs with
  20+ datacenters per continent, drop to 24px to recover
  per-site separation.
- **`weight` drives heat intensity automatically.** The heat
  layer renderer auto-picks the `weight` field by name (per
  Better Map's `dataFitness.js` field aliasing). If you
  rename `weight` in the SPL (e.g. `eval unhealthy_pct =
  unhealthy_services / total_services` for a percentage-
  based heat), set the formatter's `heatmapWeight` option
  accordingly.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5) + an ITSI-licensed verification tenant. The
panel requires the same ITSI + `itsi_services` collection
setup as the [markers companion](./markers.md#5-screenshot);
both recipes will be validated against the same tenant.
Reproduction steps: seed `itsi_services` with 5-20 services
distributed across at least 3 datacenters (each datacenter
shared by 3-5 services); seed `itsi_summary` with SHKPI-
events at a mix of alert levels (some with `alert_level >=
3`); paste the SPL above into a Dashboard Studio map panel
with Better Map as the visualization; apply the formatter
JSON in §4; confirm each datacenter renders as a coloured
heat blob with intensity proportional to its unhealthy-
service count._

## 6. Gotchas

- **Same `info_lat` / `info_lon` prerequisite as markers.** If
  your tenant has not added `info_lat` and `info_lon` as
  custom ITSI service attributes (Configuration → Service
  Templates → custom attributes, or bulk-loaded via the ITSI
  REST API), this recipe returns ZERO results. The diagnostic
  query: `| inputlookup itsi_services | where isnotnull(info_lat) | stats count`.
  If the count is 0, the recipe cannot render. See [markers
  §6 "Entity-attribute fallback"](./markers.md#6-gotchas) for
  the alternative shape that aggregates BY entity location
  instead of service location.
- **`alert_level >= 3` threshold IS your panel definition.**
  Recipe defaults to "Medium or worse" (the conventional ITSI
  threshold). Adjustable: `>= 2` for an early-warning panel
  (wider coverage, more noise); `>= 4` for a strict "fire
  only" panel (less noise, slower to flag); `>= 5` for an
  incident-only panel (Critical = on-call-page severity,
  should be empty most of the time). Document your choice
  in the dashboard panel description.
- **Per-site labels — use `info_datacenter_code` if present.**
  The recipe's `eval id=lat . "_" . lon` produces stable but
  unfriendly identifiers (e.g. `53.5511_9.9937`). If your
  ITSI install has populated a per-site label attribute on
  EVERY service (e.g. `info_datacenter_code` = "AMS-01" on
  all 23 services in Amsterdam), promote it into the lookup
  OUTPUT and use it as the site identifier:
  ```spl
  | lookup itsi_services _key AS itsi_service_id OUTPUT info_lat AS lat, info_lon AS lon, info_datacenter_code AS site_code
  ...
  | stats sum(is_unhealthy) AS unhealthy_services, count AS total_services, values(site_code) AS site_codes BY lat, lon
  | eval id=mvindex(site_codes, 0)
  ```
  The `values()` aggregate de-duplicates site_codes within
  the (`lat`, `lon`) group; `mvindex(..., 0)` picks the first
  one (typically all services at a site share the same
  code).
- **Percentage variant.** Replace `eval weight = ... /
  max_unhealthy` with `eval weight = unhealthy_services /
  total_services` to render heat intensity as the PER-SITE
  UNHEALTHY PERCENTAGE (`weight ∈ [0, 1]` directly, no
  normalisation needed). A datacenter with 1 unhealthy of 5
  services renders the SAME as a datacenter with 20
  unhealthy of 100 services (both 20%). This is right for
  "blast radius proportional to fleet size" questions, wrong
  for "absolute pressure where it matters most" questions.
  For the default recipe (absolute pressure), the larger
  datacenter dominates the heat surface — which is usually
  the right operational signal.
- **Layer choice — heat vs markers vs (future) h3.**

  | Layer | Shape | Best for |
  |---|---|---|
  | `markers` ([itsi-kpi-base/markers](./markers.md)) | Per-service marker with severity colour + health-score size | Per-service investigation, drilldown to ITSI Service Analyzer |
  | `heat` (this recipe) | Smooth per-site Gaussian blobs | Executive briefings, multi-datacenter capacity planning, incident-response blast-radius |
  | `h3` (future itsi-kpi-base/h3) | Hard hexagonal partition at fixed resolution | Regional pressure ranking, board-level deployment-scope maps |

  Heat + markers can coexist on the same dashboard with the
  same underlying SPL — markers on top (per-service identity,
  click-to-drilldown), heat underneath (per-site smooth
  pressure surface). Toggle each layer independently via
  Better Map's BM-CT-1 layer contract (`setEnabled` /
  `isEnabled` / `reset`).
- **`eventstats max(unhealthy_services)` cardinality risk —
  per-panel only.** The `eventstats max` is over the
  PER-PANEL result set, so the weight band is panel-local —
  a snapshot with peak `unhealthy_services=2` will produce a
  saturated red heat surface even though the absolute
  pressure is low. This is intentional for the recipe's
  primary use case (the panel shows RELATIVE pressure within
  the current snapshot — "this datacenter is the WORST right
  now"), but wrong for cross-panel / cross-window comparison.
  For "absolute pressure with a fixed scale" replace
  `eventstats max` with `eval max_unhealthy = 50` (or
  whatever the absolute "fully on fire" threshold is for
  your install) — that gives a deterministic colour ramp
  across snapshots / time windows.
- **`SHKPI-` event delivery lag.** Same as markers — ITSI's
  service-health aggregator runs SLIGHTLY after the
  underlying KPI searches finish, and can lag 30-60 seconds
  on busy search heads. The 15 min `earliest=-15m` window
  absorbs this; do not narrow below 10 min in high-volume
  tenants. The heat layer is more forgiving here than
  markers — a single missing service-health snapshot rarely
  changes the per-site aggregate noticeably.
- **`itsi_services` lookup name.** Same as markers — the
  recipe assumes the default ITSI collection name. Splunk
  Cloud multi-tenant deployments sometimes prefix with the
  customer code (e.g. `acme_itsi_services`). Confirm with
  `| rest /servicesNS/-/-/storage/collections/config | search collection=*itsi*`.
- **Time range.** Hard-coded `earliest=-15m latest=now` so
  the panel works without a dashboard time picker and stays
  scoped to "current pressure, not historical." Avoid
  parameterising — this panel is a "right now" view; an
  hour-old aggregate is a different question (use a trend
  chart, not a heat map).
- **PII / GDPR posture.** Per ROADMAP §1a, Better Map never
  sends event data outside `splunkd:8089`. The heat recipe
  is INHERENTLY LESS PII-exposing than the markers
  companion — per-service identity (`service_title`,
  `identifying_name`) is intentionally discarded by the
  per-site aggregation, so the popup payload is just
  per-site counts. This makes the heat recipe a SAFER
  default for dashboards shown in executive briefings or
  shared with broader audiences.
- **No OT safety dependency.** Same boundary as markers —
  this is pure IT service-health. If your ITSI install ALSO
  monitors OT-zone services (an SIS health-roll-up KPI, a
  Modbus telegram-rate KPI), filter those services OUT of
  THIS recipe (`NOT itsi_service_id IN ("svc_sis_*")` after
  the initial `stats`) and put them in a DEDICATED recipe
  with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6. Visually-mixing IT and OT pressure on the same
  heat surface is dangerous because per-site aggregation
  obscures the safety-vs-operational distinction.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, mirrors the verified-pattern shapes of
the [markers companion](./markers.md),
[kvstore-latlon/heat](../kvstore-latlon/heat.md) (`eventstats
max` normalisation), and [es-risk/heat](../es-risk/heat.md)
(per-site `stats sum` + `eventstats max`), matches the
documented ITSI schemas from
[`~/.cursor/skills/splunk-itsi/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/itsi-kpi-base/heat.md),
but has NOT been dispatched against an ITSI-licensed tenant
with geocoded services. A maintainer with REST auth should
verify the geo-attribute prerequisite (same diagnostic queries
as [markers verification](./markers.md#verification-status)),
confirm 2+ services share a (`lat`, `lon`) site (otherwise
heat degenerates to markers-like per-service rendering), run
the SPL, toggle the `alert_level >= N` threshold (3 → 4 → 5)
to verify the heat surface shrinks correspondingly, then
update frontmatter to `status: verified` with
`verified_against: splunk_app: "SA-ITOA"`.
