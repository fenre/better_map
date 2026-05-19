---
schema_version: 1
id: itsi-kpi-base--paths
source:
  id: itsi-kpi-base
  display_name: "ITSI service health (KPI base searches)"
  pattern: splunk-premium-itsi
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: "SA-ITOA"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "DEP-svc_payments_eu-svc_authdb_us"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "53.5511"
  - name: lon
    type: number
    example: "9.9937"
  - name: service_id
    type: string
    example: "svc_payments_eu"
  - name: service_title
    type: string
    example: "Payments (EU region)"
  - name: role
    type: string
    example: "parent"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-service drilldown)"
    path: "docs/recipes/itsi-kpi-base/markers.md"
  - description: "Companion recipe — same source, H3 hexbin (per-cell roll-up)"
    path: "docs/recipes/itsi-kpi-base/h3.md"
  - description: "Companion recipe — same source, heatmap (smoothed density)"
    path: "docs/recipes/itsi-kpi-base/heat.md"
  - description: "Companion recipe — same source, supercluster (zoom-adaptive)"
    path: "docs/recipes/itsi-kpi-base/supercluster.md"
  - description: "Pattern reference — paths layer for kill-chain reconstruction"
    path: "docs/recipes/es-risk/paths.md"
  - description: "Pattern reference — paths layer with append-based 2-vertex polylines"
    path: "docs/recipes/cyber-vision/paths.md"
  - description: "splunk-itsi skill — itsi_services KV store schema, service_dependencies multi-value field"
    path: "~/.cursor/skills/splunk-itsi/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
---

# ITSI service health — service-dependency paths

Render the **service-dependency edges** of an ITSI service tree
as polylines on a world map — for each parent service with
geographically-distributed child services, draw a path from the
parent's `info_lat`/`info_lon` to each child's. The canonical
"where do my service dependencies live?" panel — when a SRE
manager or platform-architecture lead needs an immediate-read
view of the multi-region dependency graph (e.g., "EU Payments
depends on US Auth-DB and APAC Risk-Engine; if any of those
regions degrades, EU Payments degrades too"), this panel makes
the cross-region cascade visually obvious.

The sister panel to
[itsi-kpi-base/markers](./markers.md) (which shows the SERVICES
themselves as points) — here showing the CONNECTIONS between
those services. The **5th layer cell on the itsi-kpi-base
source row** — completing markers / heat / h3 / supercluster /
paths for ITSI.

## 1. Source description

Same **ITSI `itsi_services` KV store + `itsi_summary` index**
source as the markers / heat / h3 / supercluster companions —
see [itsi-kpi-base/markers §1](./markers.md#1-source-description)
for the `SHKPI-<service_id>` synthetic KPI convention, the
`entity_key="N/A"` filter for service-level roll-ups, the
`itsi_services` KV store schema, and the `info_lat` /
`info_lon` operator-extension pattern.

The relevant distinction for THIS recipe: it reads the
`service_dependencies` multi-value field from the
`itsi_services` KV store (each row's list of parent service
keys it depends on), expands it via `mvexpand`, re-joins each
dependency to its own KV store row for the dependent service's
coordinates, and emits a 2-vertex row per (parent, child) pair
suitable for the paths layer. No `join` is needed — the second
lookup against `itsi_services` is a standard ITSI KV store
re-key.

**Why paths for ITSI service dependencies.** A markers panel
shows the services. A heat or H3 panel shows their density.
But neither shows the **dependency relationships** that drive
cascade failures. When EU Payments degrades because US Auth-DB
is down, the markers panel shows two red dots; the paths
panel shows the red dot in Frankfurt CONNECTED by a polyline
to the red dot in Virginia — making the cause-and-effect
visible at a glance. This is the right shape for **change-
management dashboards** (preview which services are downstream
of a planned maintenance), **incident-response panels** (show
all services downstream of a degraded one), and **capacity-
planning views** (identify cross-region dependencies that
should be replicated locally).

**Typical KV store:** `itsi_services` (in `SA-ITOA`). Each row
is one service; `service_dependencies` is a multi-value field
of `_key` values pointing to parent services. ITSI's UI
populates this field automatically when an operator builds a
service tree at Configuration → Services.

## 2. SPL recipe

```spl
| inputlookup itsi_services
| where isnotnull(info_lat) AND isnotnull(info_lon) AND isnotnull(service_dependencies)
| eval parent_id=_key,
       parent_lat=info_lat,
       parent_lon=info_lon,
       parent_title=identifying_name
| fields parent_id, parent_lat, parent_lon, parent_title, service_dependencies
| mvexpand service_dependencies
| where isnotnull(service_dependencies) AND service_dependencies!=""
| lookup itsi_services _key AS service_dependencies
    OUTPUT info_lat AS child_lat,
           info_lon AS child_lon,
           identifying_name AS child_title
| where isnotnull(child_lat) AND isnotnull(child_lon)
| eval id="DEP-" . parent_id . "-" . service_dependencies
| eval vertex=mvrange(0, 2, 1)
| mvexpand vertex
| eval vertex_num=tonumber(vertex)
| eval lat=case(vertex_num=0, parent_lat, vertex_num=1, child_lat),
       lon=case(vertex_num=0, parent_lon, vertex_num=1, child_lon),
       service_id=case(vertex_num=0, parent_id, vertex_num=1, service_dependencies),
       service_title=case(vertex_num=0, parent_title, vertex_num=1, child_title),
       role=case(vertex_num=0, "parent", vertex_num=1, "child"),
       seq=vertex_num
| fields id, seq, lat, lon, service_id, service_title, role
| sort 0 id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`| inputlookup itsi_services`** — read the ITSI service
  registry KV store directly. Each row is one service; the
  KV store is the authoritative source for service definitions,
  topology, and operator-extension fields (`info_lat`,
  `info_lon`, `service_dependencies`).
- **`where isnotnull(info_lat) AND isnotnull(info_lon) AND isnotnull(service_dependencies)`** —
  three gates: the parent service must have coordinates AND
  must depend on at least one other service. Leaf services
  (zero dependencies) and uncoordinated services are filtered
  here; they have nothing to draw.
- **`eval parent_id=_key, parent_lat=info_lat, ...`** — rename
  the parent-side fields with a `parent_` prefix so the
  upcoming `lookup` (which writes `child_lat` / `child_lon`)
  doesn't overwrite them. `_key` is the KV store's primary
  key (one service ID per row).
- **`fields parent_id, parent_lat, parent_lon, parent_title, service_dependencies`** —
  explicit projection. Drops every other field from
  `itsi_services` (sec_grp, base_service_template_id, kpis,
  entity_rules, etc.) — none are needed for the polyline.
- **`mvexpand service_dependencies`** — fans out one row per
  (parent, dependency) pair. A parent with 3 dependencies
  becomes 3 rows. The `mvexpand` is the canonical SPL pattern
  for "one input row per element of a multi-value field".
- **`where isnotnull(service_dependencies) AND service_dependencies!=""`** —
  defensive guard. `service_dependencies` can be an empty
  string when ITSI's UI initialises but no parent has been
  set; `mvexpand` keeps these rows, but they don't represent
  a real edge.
- **`lookup itsi_services _key AS service_dependencies ...`** —
  THE KEY LINE. Re-key against the same KV store, using
  the dependency value as the lookup key. Returns the child
  service's coordinates and human-readable name. No `join`
  needed — `lookup` is the canonical SPL pattern for
  enriching rows from a KV store.
- **`where isnotnull(child_lat) AND isnotnull(child_lon)`** —
  drop edges where the child service has no coordinates set.
  Surface in a companion table panel ("Services lacking
  location data: <count>") so the ITSI admin sees the
  attribute gap.
- **`eval id="DEP-" . parent_id . "-" . service_dependencies`** —
  unique polyline ID per edge. Prefix distinguishes from any
  other ID convention in the dashboard's multi-panel context.
- **`eval vertex=mvrange(0, 2, 1)`** — generate a multi-value
  field with values `[0, 1]`. Combined with the next
  `mvexpand`, this fans each edge row into two vertex rows
  (one per endpoint).
- **`mvexpand vertex`** — explode the vertex field. Each
  parent→child edge now becomes two rows: one for the parent
  vertex, one for the child vertex.
- **`eval vertex_num=tonumber(vertex)`** — `mvexpand` returns
  vertex as a string ("0" / "1"); cast to number for use in
  `case()` comparisons. Without this cast, `case(vertex=0,
  ...)` would evaluate `vertex` as string "0" vs numeric 0
  and silently mismatch.
- **`eval lat=case(...), lon=case(...), service_id=case(...), service_title=case(...), role=case(...), seq=vertex_num`** —
  pick the parent or child attributes based on vertex number.
  `seq=vertex_num` (0 for parent, 1 for child) is the path
  layer's `timeField` — gives a deterministic ordering of
  vertices along each polyline.
- **`fields id, seq, lat, lon, service_id, service_title, role`** —
  final projection. `role` ("parent" or "child") helps the
  popup explain which side of the dependency you're looking at.
- **`sort 0 id, + seq`** — group all vertices for one polyline
  contiguously, ordered seq=0 then seq=1. The paths layer
  needs vertices in this order to draw cleanly.
- **`head 5000`** — render budget. Typical ITSI service trees
  have 50-200 services × ~3-5 dependencies per parent = 150-
  1000 edges × 2 vertices = 300-2000 rows. 5000 covers even
  large enterprise trees.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example                                    |
|---------------|---------|--------------------------------------------|
| id            | string  | DEP-svc_payments_eu-svc_authdb_us          |
| seq           | integer | 0                                          |
| lat           | number  | 53.5511                                    |
| lon           | number  | 9.9937                                     |
| service_id    | string  | svc_payments_eu                            |
| service_title | string  | Payments (EU region)                       |
| role          | string  | parent                                     |

All seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#9467bd",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit. The `DEP-<parent>-<child>`
  format makes each polyline uniquely identifiable in the
  paths layer's internal grouping.
- **`timeField: "seq"`** — monotonic vertex ordering (0 for
  parent, 1 for child). The paths layer respects this for
  draw direction.
- **`pathColor: "#9467bd"`** — Tableau muted-purple, distinct
  from the blue used by Cyber Vision flows
  ([cyber-vision/paths](../cyber-vision/paths.md)) and the
  red used by ATO kill-chain trajectories
  ([cim-authentication/paths](../cim-authentication/paths.md)).
  Purple reads as "infrastructure relationship" against any
  base-map backdrop — appropriate semantic colour for
  service-architecture topology vs operational event flows.
- **`pathArrows: true`** — render direction-of-travel chevrons.
  Essential for dependency graphs: arrows point from PARENT
  to CHILD (dependent → dependency), making the cascade
  direction visible. "If the arrow's destination degrades,
  the arrow's source is at risk."

For severity-tinted edges (red for edges where EITHER endpoint
is currently critical), join against `itsi_summary` for current
alert_level per service and override `pathColor` to a dynamic
expression — a v1.8 candidate. The static purple is appropriate
for the static-architecture view this recipe ships.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). A maintainer can reproduce by pasting the SPL into a
Dashboard Studio map panel with Better Map as the visualization,
applying the formatter JSON in §4. Most effective demo data:
a multi-region service tree where parent and child services
live in different geographic regions (a "EU Payments depends on
US Auth-DB" scenario)._

## 6. Gotchas

- **Same `info_lat` / `info_lon` operator-extension
  dependency as all itsi-kpi-base companions.** If the ITSI
  admin hasn't populated lat/lon in the service `info` block,
  this recipe silently filters every row out. The migration
  path is documented in the
  [markers companion §6](./markers.md#6-gotchas) — either a
  one-time `inputlookup … | eval info_lat=… | outputlookup
  itsi_services` patch, or per-service UI edits at
  Configuration → Services → <service> → Info tab.
- **`service_dependencies` is a NULL multi-value field for
  root services.** Top-level business services (no parents)
  have an empty `service_dependencies`; the recipe correctly
  filters these out at the first `where`. To see root
  services on the map, use the
  [markers companion](./markers.md). Root services are not
  represented as path endpoints unless another service
  depends on them (then they appear as `role="child"`).
- **`mvexpand` on `service_dependencies` is the right
  pattern, not `mvjoin`/`mvfilter`.** A common mistake is
  `mvfilter(...)` which only filters values without creating
  one row per value. `mvexpand` is the canonical pattern for
  "fan out one row per multi-value field element".
- **Edge bidirectionality.** This recipe shows
  parent→child edges. ITSI's dependency model is
  unidirectional: a child service supports a parent service.
  The polyline arrow points from parent to child (consumer
  to provider), matching the cascade direction (if provider
  degrades, consumer is at risk). For a "consumer-to-many-
  providers" multi-arc view (one parent depending on 5
  providers), the panel naturally renders as a starburst
  — Better Map will draw all 5 polylines fanning out from
  the parent location.
- **Multi-hop dependencies are NOT chained.** This recipe
  shows ONE-HOP edges only. If service A depends on B which
  depends on C, the panel shows TWO polylines (A→B and B→C),
  not a single A→B→C polyline. For chained-cascade panels,
  extend the SPL with a second `lookup` pass and re-emit as
  3-vertex polylines.
- **KV store size matters at scale.** Reading `itsi_services`
  via `inputlookup` materializes the entire collection. For
  ITSI installs with 10000+ services (rare but possible), the
  first `inputlookup` can be slow (seconds-to-minutes).
  Workaround: pre-aggregate into a saved search that writes
  to a summary index, then point the recipe at the summary.
  Splunk Cloud + ITSI Premium installs in this scale should
  also have `accelerate_datamodel` enabled per the
  splunk-itsi skill recommendations.
- **`service_dependencies` is operator-curated.** ITSI's UI
  populates this field, but the field can be set
  programmatically via REST. Bad data (e.g., a dependency
  pointing at a `_key` that doesn't exist in `itsi_services`)
  causes the second `lookup` to return NULL, which is
  filtered out at the `where isnotnull(child_lat)` guard —
  no panel error, just silently-missing edges. To audit
  bad references: `| inputlookup itsi_services | mvexpand
  service_dependencies | lookup itsi_services _key AS
  service_dependencies OUTPUT identifying_name AS dep_name
  | where isnull(dep_name) AND service_dependencies!="" |
  stats count BY service_dependencies, _key`.
- **Time range.** The recipe ignores time entirely (KV
  store + dependency graph is static). For a "dependency
  graph as of last week" snapshot, use ITSI's KV store
  backup feature or query against a versioned snapshot
  index. The panel as-shipped reflects the current state of
  `itsi_services`.
- **No OT-safety dependency.** ITSI service health is an
  IT-services / business-services concept; the recipe doesn't
  interact with any OT control-zone signal.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk + ITSI built-ins (`inputlookup`,
`mvexpand`, `mvrange`, `lookup`, `eval`, `case`, `where`,
`tonumber`). Verification path: confirm `SA-ITOA` is installed,
ITSI is running, `itsi_services` has at least one row with
`service_dependencies` populated AND both endpoints with
`info_lat`/`info_lon` set, dispatch via REST, drop into a
Dashboard Studio panel with the §4 formatter JSON, confirm 2-
vertex polylines render between dependent services. Promote to
`status: verified` + fill in `verified_against` in a follow-up
PR.
