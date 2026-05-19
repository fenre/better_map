---
schema_version: 1
id: es-risk--paths
source:
  id: es-risk
  display_name: "ES Risk-Based Alerting (risk index)"
  pattern: splunk-premium-es
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: "SplunkEnterpriseSecuritySuite"
    optional: false
  - id: "Splunk_SA_CIM"
    optional: false
  - id: "builtin:iplocation"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "alice@example.com"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "3"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: risk_object
    type: string
    example: "alice@example.com"
  - name: risk_score
    type: integer
    example: "30"
  - name: source_search
    type: string
    example: "Suspicious PowerShell Process"
  - name: technique
    type: string
    example: "T1059.001"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-entity risk totals)"
    path: "docs/recipes/es-risk/markers.md"
  - description: "Companion recipe — same source, supercluster layer (portfolio overview)"
    path: "docs/recipes/es-risk/supercluster.md"
  - description: "Companion recipe — same source, H3 hexbin layer (regional risk aggregation)"
    path: "docs/recipes/es-risk/h3.md"
  - description: "Companion recipe — same source, heatmap layer (continuous risk density)"
    path: "docs/recipes/es-risk/heat.md"
  - description: "Pattern reference — paths layer with chronological vertices"
    path: "docs/recipes/cim-authentication/paths.md"
  - description: "splunk-rba skill — Risk-Based Alerting framework"
    path: "~/.cursor/skills/splunk-rba/SKILL.md"
  - description: "splunk-enterprise-security skill — Asset & Identity framework"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "splunk-mitre-attack skill — annotations.mitre_attack contract"
    path: "~/.cursor/skills/splunk-mitre-attack/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — pathIdField, timeField, pathColor, pathArrows"
    path: "docs/_machine/formatter-schema.json"
---

# ES Risk-Based Alerting — paths

The kill-chain-reconstruction companion to the
[es-risk/markers](./markers.md),
[h3](./h3.md), [heat](./heat.md), and
[supercluster](./supercluster.md) recipes — same
`` `risk` `` index source, same ES Asset & Identity (A&I)
enrichment, but the data shape changes from "aggregate per
entity" to "**chronologically-ordered chain of contributing
risk modifiers per entity**". The right shape for **SOC
post-incident investigation panels** where the question is not
"who is on fire?" (the markers panel answers that) but
"**HOW did this entity get on fire?** Which detections fired in
what order across which geographic locations?" — the
geographic trajectory of an attack's kill chain.

The es-risk source row now has **5 layer cells** (markers,
h3, heat, supercluster, plus paths now) — completing the
fifth cell on a security-source row alongside cim-
authentication and cim-performance. Paths is a NEW layer
shape for the es-risk source: where the markers panel shows
**where** entities are accumulating risk, this panel shows
**how** the risk accumulated geographically across time.

## 1. Source description

Same **Risk-Based Alerting (RBA)** data model as the
[markers companion](./markers.md#1-source-description) — see
that recipe for the full RBA framework background. The
relevant distinction for THIS recipe: instead of aggregating
all risk events per `risk_object` into a single point, the
panel **preserves the per-event detail** and chains them
chronologically into a polyline that traces the
geographic-temporal footprint of contributing detections.

**Why paths for RBA data.** The markers recipe is the
"who is on fire" answer; the h3 / heat recipes are the
"where is risk concentrated" answers. None of them carry
**temporal sequence** — they collapse the entity's risk
history into a single number (`total_risk`). The paths
recipe restores the sequence: each detection that fired on
the entity becomes a vertex, vertices are connected in
chronological order, and the polyline shape becomes the
kill-chain story. If `alice@example.com` triggered T1078
(Valid Accounts) from Seattle at 9am, then T1059.001
(PowerShell) from Seattle at 9:15am, then T1547.001
(Boot/Logon Autostart) from a Frankfurt VPN at 10:30am,
the polyline goes Seattle → Seattle → Frankfurt with arrows
showing the kill-chain progression — visually exposing the
**lateral / geographic movement** of the attack in a way
that no aggregate panel can.

**Typical sourcetype / index:** same `` index=risk `` (via the
`` `risk` `` macro) as the markers companion. Same ES + CIM +
A&I requirements. Same caveat about A&I lookups needing
lat/lon columns (see §6 Gotchas). The paths recipe additionally
requires events to span **multiple geographic locations per
entity** to produce visually-interesting paths — for a
small-footprint tenant (everything from one office),
the paths panel degenerates to a "tight cluster" point view;
the [markers companion](./markers.md) is the right tool when
geographic spread is minimal.

## 2. SPL recipe

```spl
`risk` earliest=-24h latest=now
| sort 0 risk_object, + _time
| streamstats current=true count AS seq BY risk_object
| eventstats sum(risk_score) AS total_risk_so_far, dc(source_search) AS contributing_searches_so_far BY risk_object
| where total_risk_so_far >= 50
| lookup identity_lookup_expanded identity AS risk_object OUTPUT lat AS identity_lat, long AS identity_lon
| lookup asset_lookup_by_str src AS risk_object OUTPUT lat AS asset_lat, long AS asset_lon
| eval lat=coalesce(identity_lat, asset_lat)
| eval lon=coalesce(identity_lon, asset_lon)
| where isnotnull(lat) AND isnotnull(lon)
| eventstats dc(round(lat,2) . "_" . round(lon,2)) AS distinct_locations BY risk_object
| where distinct_locations >= 2
| eval technique=mvindex(annotations.mitre_attack{}, 0)
| rename risk_object AS id
| fields id, seq, lat, lon, risk_object, risk_score, source_search, technique, _time
| sort 0 id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`` `risk` earliest=-24h latest=now ``** — same as the
  [markers companion](./markers.md#2-spl-recipe): the `risk`
  macro resolves to the configured ES risk index(es). 24h
  matches the default RBA scoring horizon.
- **`| sort 0 risk_object, + _time`** — group by entity, then
  order ASCENDING by event timestamp within each entity.
  Critical for the next `streamstats` step which assigns
  per-entity sequence numbers from the row order. The `0`
  argument disables the default 10000-row cap (we apply our
  own `head` later).
- **`| streamstats current=true count AS seq BY risk_object`** —
  per-entity vertex sequence. After this step, the first risk
  event for `alice@example.com` has `seq=1`, the second has
  `seq=2`, etc. `current=true` includes the current row in the
  count (so the first event gets `seq=1`, not `seq=0`).
- **`| eventstats sum(risk_score) AS total_risk_so_far, dc(source_search) AS contributing_searches_so_far BY risk_object`** —
  per-entity aggregate stats that flow back to EVERY row in
  the entity's chain. Allows the popup on any vertex to show
  "this entity has accumulated X total risk across Y
  detections" — context that the per-vertex `risk_score`
  alone cannot provide.
- **`| where total_risk_so_far >= 50`** — same threshold as
  the markers companion; matches the default RBA medium-
  priority threshold. Filters out entities that never
  accumulated enough to be operationally interesting. **Note**:
  this filters whole-entity (any entity whose CUMULATIVE risk
  stays below 50 across the 24h window is dropped entirely) —
  not per-event.
- **Two `lookup` lines + `coalesce`** — identical to the
  [markers companion](./markers.md#2-spl-recipe). Identity
  lookup first (most user-typed `risk_object` values resolve
  here), asset lookup second (most machine `risk_object`
  values resolve here), coalesce to pick whichever wins.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drop
  vertices with no home location. A path with a missing
  intermediate vertex will render as a polyline that "skips"
  the missing step — surface dropped vertices in a companion
  table for the A&I-coverage team.
- **`| eventstats dc(round(lat,2) . "_" . round(lon,2)) AS distinct_locations BY risk_object`** +
  **`| where distinct_locations >= 2`** — **critical
  signal-to-noise filter**. Only render paths for entities
  whose risk events span ≥ 2 distinct geographic locations
  (rounded to ~10 km precision via `round(lat,2)`). Without
  this filter, the panel renders a polyline for EVERY entity
  with multiple risk events — including the 95% of entities
  whose entire kill chain occurred in a single building
  (= a polyline that degenerates to a point). Filtering to
  ≥2 distinct locations isolates the genuine **lateral /
  geographic movement** signal — the high-signal "this attack
  moved across geography" subset of RBA hits.
- **`| eval technique=mvindex(annotations.mitre_attack{}, 0)`**
  — flatten the MITRE technique multi-value to the FIRST
  technique only (most RBA risk events have exactly one
  technique annotation; for the rare multi-technique event,
  the first is the primary). The paths popup surfaces ONE
  technique per vertex to keep the popup readable.
- **`| rename risk_object AS id`** — adopt Better Map's
  canonical `id` alias. The paths layer's `pathIdField`
  formatter option defaults to looking for `id`.
- **`| fields ...`** — explicit projection. `id` + `seq`
  drive the path geometry; `lat`/`lon` provide vertex
  coordinates; `risk_object`, `risk_score`, `source_search`,
  `technique`, `_time` carry through as feature properties
  for per-vertex popups.
- **`| sort 0 id, + seq`** — re-sort after the lookups (the
  lookups can reorder rows). Critical: the paths renderer
  connects vertices in row-order within each `pathIdField`
  group — out-of-order rows produce zigzag polylines.
- **`| head 5000`** — render budget. With the
  `distinct_locations >= 2` filter, the SPL typically returns
  far fewer rows than the markers companion's 500-entity cap
  — but a path-rendering panel has more total vertices
  (multiple per entity). 5000 caps the total vertex count;
  if your tenant exceeds this, tighten `distinct_locations`
  to `>= 3` or raise the `total_risk_so_far` threshold.

## 3. Expected fields

| field         | type    | example                       |
|---------------|---------|-------------------------------|
| id            | string  | alice@example.com             |
| seq           | integer | 3                             |
| lat           | number  | 47.6062                       |
| lon           | number  | -122.3321                     |
| risk_object   | string  | alice@example.com             |
| risk_score    | integer | 30                            |
| source_search | string  | Suspicious PowerShell Process |
| technique     | string  | T1059.001                     |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`id` drives `pathIdField` (groups vertices into paths per
`risk_object`); `seq` drives `timeField` (orders vertices
chronologically within each path); `lat`/`lon` provide
geometry; `risk_object`, `risk_score`, `source_search`,
`technique` flow through as feature properties for per-vertex
popups (click a vertex → see "alice@example.com — step 3 —
T1059.001 — Suspicious PowerShell Process — 30 risk").

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#d62728",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit override pinning the
  field that groups rows into paths. Auto-detect would pick
  `id` (Better Map's `dataFitness.js` recognises the canonical
  alias), but pinning makes the path-grouping stable across
  formatter-version upgrades.
- **`timeField: "seq"`** — explicit override pinning the
  field that orders vertices WITHIN each path. The
  [cim-authentication/paths](../cim-authentication/paths.md)
  companion uses the same `seq`-via-`streamstats` pattern
  for chronological ordering — same rationale here. Using
  `seq` rather than `_time` directly avoids the formatter
  having to parse epoch timestamps and keeps the ordering
  field type-stable (integer).
- **`pathColor: "#d62728"`** — Tableau alert-red, consistent
  with the [es-risk/markers](./markers.md#4-recommended-formatter-config)
  companion. Every polyline rendered here is by definition a
  kill-chain trajectory of an entity that accumulated
  significant risk — the panel should read as "warning
  surface" the moment it loads. For multi-entity panels where
  per-entity colour distinction matters (e.g. a 10-entity
  comparison view), swap to `categoryField: "id"` +
  `palette: "set3"` to colour each entity's path
  independently.
- **`pathArrows: true`** — render directional arrows on
  each polyline segment. **Critical** for kill-chain
  reconstruction where the **direction of attack progression
  through time** is the primary signal. Without arrows the
  polyline is bidirectional-ambiguous; the analyst can't
  tell which end was the initial-access vector vs the
  lateral-movement endpoint.
- **All other fields flow through automatically** as feature
  properties on each vertex — popups show the per-step
  detail (`source_search`, `technique`, `risk_score`,
  `_time`) without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). The harness will need ES installed plus an
A&I lookup seeded with lat/lon (same caveats as the
[markers companion §5](./markers.md#5-screenshot)) — plus
**multi-location risk events per entity** to produce visually-
interesting paths. A maintainer with ES verification access
can reproduce by running the recipe SPL and confirming at
least one entity returns ≥ 2 vertices spanning ≥ 2 distinct
geographic locations._

## 6. Gotchas

- **Single-location entities are deliberately dropped.** The
  `distinct_locations >= 2` filter is the recipe's signal-
  to-noise mechanism. An entity whose ALL risk events
  occurred in the same building (the common case — 95% of
  RBA hits) is filtered out. This is intentional: a polyline
  that degenerates to a point is visual noise; the
  [markers companion](./markers.md) is the right tool for
  single-location entities. If your panel returns zero rows,
  it does NOT mean "no entities have risk" — it means "no
  entities have geographically-distributed risk events". Run
  the markers panel alongside to confirm.
- **A&I lookups need lat/lon columns — same constraint as
  the markers companion.** See [markers §6](./markers.md#6-gotchas)
  for the full caveat. If your tenant has not extended
  `identities.csv` / `assets.csv` with lat/lon, this recipe
  returns zero rows.
- **Geographic precision (`round(lat,2)`) is ~10 km.** The
  `distinct_locations` calculation rounds coordinates to 2
  decimal places (~10 km grid). An entity whose risk events
  came from two offices in the same metro area (e.g. downtown
  Seattle vs Redmond) will resolve to the **same** rounded
  location and be filtered out as single-location. For metro-
  scale lateral-movement detection, tighten to `round(lat,3)`
  (~1 km). For continental-scale only, loosen to
  `round(lat,1)` (~100 km).
- **`_time` ordering vs `seq` ordering.** The recipe orders
  vertices by `_time` (event timestamp) via the initial
  `| sort` + `| streamstats`. If your RBA pipeline introduces
  artificial delays (batched correlation searches, scheduled
  every-15-min instead of real-time), the `_time` ordering
  may NOT match the actual chronological order of the
  underlying detection events. For high-fidelity kill-chain
  reconstruction, prefer real-time correlation searches
  (`cron_schedule = */1 * * * *`) where the `_time` field
  closely tracks the detection moment.
- **`source_search` cardinality can be huge.** A noisy
  detection portfolio (every EDR alert, every Windows event)
  can produce hundreds of risk events per entity per day.
  The path will have hundreds of vertices, most of which
  cluster on the same 1-2 home locations — the polyline
  becomes a tangled blob. Mitigate by either (a) tightening
  the `total_risk_so_far` threshold to >= 100 or >= 200, or
  (b) filtering the SPL to specific high-fidelity detection
  searches via `| search source_search IN ("Critical Detection
  1", "Critical Detection 2", ...)`.
- **Geographic geolocation accuracy.** Same `iplocation` and
  A&I-lookup accuracy caveats apply as in the
  [markers companion §6](./markers.md#6-gotchas). For paths
  specifically, geo-noise produces fake "lateral movement" —
  the same entity at the same office appearing in two
  different metro areas across two risk events. Tighten
  `round(lat,2)` to `round(lat,1)` if your A&I lookup has
  city-level precision.
- **Dateline-crossing kill chains.** A path from Tokyo to Los
  Angeles will render as a polyline that goes WESTWARD across
  Asia + Europe + Atlantic, NOT eastward across the Pacific.
  Same gotcha as [csv-lookup-geo/paths §6](../csv-lookup-geo/paths.md#6-gotchas).
  Workaround: insert an intermediate vertex at the dateline.
  A v1.8+ formatter option for great-circle rendering is on
  the roadmap.
- **PII / GDPR posture.** Same constraint as the
  [markers companion §6](./markers.md#6-gotchas) — the path
  layer renders `risk_object` values which for user entities
  are PII (usernames / emails). Restrict via Splunk RBAC or
  pre-hash in SPL if the panel will be viewed by an audience
  without "see risky users" authorisation. The path's
  visual structure (sequence + geography) ITSELF can be
  privacy-sensitive even if the `risk_object` is hashed —
  consider whether the kill-chain pattern alone could
  re-identify the underlying user in your threat model.
- **No OT safety dependency.** Pure IT identity-and-system
  risk paths. If your ES install also scores OT-zone
  entities (passive DPI from Cisco Cyber Vision feeding ES
  correlation searches), keep them in a SEPARATE recipe with
  `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — an OT kill-chain trajectory has fundamentally
  different operational semantics than an IT kill-chain
  trajectory.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented ES RBA contract
and inherits all the A&I-lookup conventions from the
[markers companion](./markers.md#verification-status). The
`distinct_locations` signal-to-noise filter is novel to this
recipe (the markers companion doesn't need it because
aggregate-per-entity panels degrade gracefully on single-
location entities; paths panels do not). The recipe has NOT
been dispatched against a tenant carrying both ES licence
AND a lat/lon-extended A&I lookup AND multi-location risk
events. Verification deferred pending an ES-licensed lab
tenant. Same maintainer reproduction steps apply as for the
[markers companion](./markers.md#verification-status) — plus
confirm that the `distinct_locations >= 2` filter returns a
non-empty result on the verification tenant's actual RBA
data.
