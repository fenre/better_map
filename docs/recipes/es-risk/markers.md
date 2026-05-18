---
schema_version: 1
id: es-risk--markers
source:
  id: es-risk
  display_name: "ES Risk-Based Alerting (risk index)"
  pattern: splunk-premium-es
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-18"
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
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: risk_object
    type: string
    example: "alice@example.com"
  - name: risk_object_type
    type: string
    example: "user"
  - name: total_risk
    type: integer
    example: "147"
    drives_formatter_option: markerColor
  - name: techniques
    type: string
    example: "T1059.001,T1547.001"
references:
  - description: "splunk-rba skill — Risk-Based Alerting framework (risk index schema, rules, RIRs)"
    path: "~/.cursor/skills/splunk-rba/SKILL.md"
  - description: "splunk-enterprise-security skill — Asset & Identity framework, identities.csv schema"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "splunk-mitre-attack skill — annotations.mitre_attack contract"
    path: "~/.cursor/skills/splunk-mitre-attack/SKILL.md"
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

# ES Risk-Based Alerting — markers

Render every entity that has accumulated risk in the last 24 h as
a marker, positioned at the entity's home location (corporate
office for an employee, datacenter for a server), sized by total
accumulated risk score, coloured by severity. The canonical "who
is on fire right now?" SecOps overview, driven directly by
Splunk Enterprise Security's Risk-Based Alerting (RBA) data
model — the same scoring engine that produces the ES Notable
Events ranked feed, surfaced geographically.

## 1. Source description

**Risk-Based Alerting (RBA)** is the modern Splunk ES detection
pattern: instead of every correlation search firing a notable
event (alert fatigue), correlation searches emit small **risk
modifiers** that accumulate on an entity (`risk_object`) over
time. A **Risk Incident Rule (RIR)** then watches the
accumulator and fires a single notable when the total crosses a
threshold — "alice@example.com accumulated 147 risk points in
the last 24 h, contributed by 6 distinct techniques across 4
detections" is a much higher-signal alert than 6 separate
notables.

The data home is the `risk` index, populated by the **`action.risk = 1`**
adaptive-response action attached to ES correlation searches.
Each event in `risk` carries:

- `risk_object` — the entity the score is attributed to
  (username, hostname, IP, asset tag, identity)
- `risk_object_type` — `"user"`, `"system"`, `"other"`
- `risk_score` — the per-event modifier (integer; per-rule
  baseline)
- `risk_message` — human-readable context (`"$process_name$
  wrote to System32 from $parent_process_name$ on $dest$"`-
  style)
- `annotations.mitre_attack{}` — MITRE technique IDs attached to
  the rule (`["T1059.001"]`)
- `source_search` — the savedsearch / detection that emitted
  this risk event

This recipe groups by `risk_object` over a 24 h window, sums the
risk, joins against the ES **Asset & Identity (A&I)** framework
to get a home location for the entity, geocodes the home
location, and renders one marker per entity. It is intentionally
ONE STEP DOWNSTREAM from the RIR: the RIR creates the notable;
this panel shows the geographic distribution of every entity
ABOUT to trigger an RIR (or that already has).

**Typical sourcetype / index:** `index=risk`. The TA app context
is `SplunkEnterpriseSecuritySuite`; the recipe also requires
`Splunk_SA_CIM` (for `iplocation`-on-the-search-tier features
that ES inherits) and an A&I lookup populated with at least
the `identity`, `lat`, and `lon` columns. The `identities.csv` /
`assets.csv` lookups DEFAULT-ship without lat/lon columns —
those are user-supplied extensions. If your A&I lookups do not
carry lat/lon, see §6 Gotchas for the fallback path
(geocode-by-IP rather than entity-home).

## 2. SPL recipe

```spl
`risk` earliest=-24h latest=now
| stats sum(risk_score) AS total_risk, values(annotations.mitre_attack{}) AS techniques_mv, values(source_search) AS contributing_searches BY risk_object, risk_object_type
| where total_risk >= 50
| lookup identity_lookup_expanded identity AS risk_object OUTPUT lat AS identity_lat, long AS identity_lon, priority
| lookup asset_lookup_by_str src AS risk_object OUTPUT lat AS asset_lat, long AS asset_lon
| eval lat=coalesce(identity_lat, asset_lat)
| eval lon=coalesce(identity_lon, asset_lon)
| where isnotnull(lat) AND isnotnull(lon)
| eval techniques=mvjoin(techniques_mv, ",")
| rename risk_object AS id
| fields id, lat, lon, risk_object_type, total_risk, techniques, contributing_searches, priority
| sort - total_risk
| head 500
```

Why this exact shape, line by line:

- **`` `risk` earliest=-24h latest=now ``** — `` `risk` `` is the
  ES macro that resolves to `index=risk` (and any optional risk
  index your install has split out, like `risk_long`). Always
  use the macro, never hard-code `index=risk` — ES tenants
  sometimes shard the index for performance and the macro tracks
  the sharding.
- **`stats sum(risk_score) AS total_risk, values(annotations.mitre_attack{}) AS techniques_mv, values(source_search) AS contributing_searches BY risk_object, risk_object_type`** —
  the standard RBA aggregator (this is the exact shape the
  built-in RIR `RBA: Daily Risk Tally` uses, documented in
  `~/.cursor/skills/splunk-rba/SKILL.md`). Three aggregates per
  entity: total accumulated risk, the set of MITRE techniques
  that contributed, and the set of correlation searches that
  fired. The popup will surface all three.
- **`where total_risk >= 50`** — signal-to-noise filter, matches
  the default RBA medium-priority threshold. A single low-
  fidelity detection emits 10–30 risk; an entity has to have
  multiple kill-chain stages to clear 50. Drop to 20 for an
  earlier-warning view, raise to 100 for an executive-overview
  "definitely on fire" view. The RIR thresholds in your tenant
  are the canonical reference — match this filter to whatever
  threshold your team agreed on.
- **Two `lookup` lines** — the ES Asset & Identity contract is
  TWO lookups: `identity_lookup_expanded` (users) and
  `asset_lookup_by_str` (systems / hosts / IPs). RBA emits both
  `risk_object_type="user"` AND `risk_object_type="system"`
  events, so we look BOTH up and `coalesce()` the
  coordinates — whichever lookup hits wins. The default
  lookup names ship with ES; if your install renamed them
  (some Splunk Cloud tenants prefix with the customer code),
  substitute the actual names.
- **`coalesce(identity_lat, asset_lat)` + `coalesce(identity_lon, asset_lon)`** —
  fall back from identity to asset. Most user-typed
  `risk_object` values (`alice@example.com`) resolve via the
  identity lookup; most machine `risk_object` values
  (`web-server-01`, `10.50.20.7`) resolve via the asset lookup.
  An entity that resolves in NEITHER lookup is filtered out by
  the next `where isnotnull`.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop entities
  with no home location. These are real RBA hits (the entity
  IS accumulating risk) but they have no geographic
  representation — surface them in a companion table panel
  ("Risky entities lacking home location: <count>") so the
  operator sees the A&I gap.
- **`mvjoin(techniques_mv, ",")`** — flatten the MITRE technique
  multi-value into a comma-joined string so it survives the
  trip through the formatter (Better Map's popup binding does
  not natively render multi-value fields; string is safer).
- **`rename risk_object AS id`** — adopt Better Map's `id` alias.
  The identity (`alice@example.com`) IS the unique key the user
  wants to drilldown on, so binding it to `id` makes drilldown
  ergonomic.
- **`head 500`** — render budget per ROADMAP §7c. Most ES
  tenants accumulate <100 risk-object aggregates over 24 h
  above the default threshold; 500 is comfortably above the
  worst-case noisy day. Raise carefully if you drop the
  threshold below 20.

## 3. Expected fields

| field             | type    | example                  |
|-------------------|---------|--------------------------|
| id                | string  | alice@example.com        |
| lat               | number  | 47.6062                  |
| lon               | number  | -122.3321                |
| risk_object       | string  | alice@example.com        |
| risk_object_type  | string  | user                     |
| total_risk        | integer | 147                      |
| techniques        | string  | T1059.001,T1547.001      |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#d62728"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — entities cluster geographically
  by office / datacenter. World-zoom view collapses every site to
  a single marker (which is exactly the right resolution for
  "where is risk concentrated?"); zoom in to a site to see
  individual user / host markers.
- **`idField: "id"`** — explicit override. Auto-detect would
  prefer `risk_object` (also a candidate ID column with the
  same content), but pinning `idField` to the renamed `id`
  makes the drilldown URL stable regardless of which alias the
  detector picks.
- **`markerColor: "#d62728"`** — Tableau alert-red default,
  consistent with the [`cim-authentication/markers.md`](../cim-authentication/markers.md)
  recipe — every marker here is by definition an entity
  accumulating risk, so the panel should read as "warning
  surface" the moment it loads. The per-marker colour can
  additionally be ramped by `total_risk` via the `palette`
  formatter option (`["#fee08b","#fdae61","#f46d43","#d73027",
  "#a50026"]` for low/med/high/critical/extreme); the
  `markerColor` is the base / unsized swatch.
- **All other fields flow through** as feature properties for
  the popup. The popup will show "alice@example.com · user · 147
  risk · T1059.001, T1547.001" with no further config
  (`enablePopups: true` is the default per [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will need ES installed plus an A&I lookup seeded
with lat/lon — both are out of scope for the v1.7 D5 deliverable,
so this recipe will be the first to validate against an
ES-licensed verification tenant rather than the default D5 lab
environment._

## 6. Gotchas

- **A&I lookups need lat/lon columns — they do NOT ship that
  way.** `identity_lookup_expanded` and `asset_lookup_by_str`
  default-ship with no geographic columns. The customer's ES
  admin has to extend the underlying `identities.csv` and
  `assets.csv` with `lat` and `long` columns (the ES schema
  uses `long`, not `lon` — see next gotcha) and re-import. If
  your tenant has not done this, this recipe returns ZERO
  results — see "Geocode-by-IP fallback" below for the
  alternative shape.
- **A&I schema uses `long` (not `lon` or `longitude`).** ES's
  identity / asset CSV columns are named `lat` and `long` by
  convention (matching the rest of the splunk-enterprise-
  security skill). Better Map auto-detect looks for `lon` /
  `longitude` / `long`, so `long` IS recognised — but the SPL
  renames `long AS identity_lon` for clarity. If you copy the
  recipe and shortcut the rename, the lookup ALIAS in
  `transforms.conf` decides what the field is actually called
  in the result set; verify with `| inputlookup
  identity_lookup_expanded | head 1` against your tenant.
- **`source_search` cardinality can be huge.** A noisy
  detection (every endpoint EDR alert, every Windows event)
  can produce hundreds of risk events per entity per day. The
  `values()` aggregator returns the SET, which is bounded —
  but the popup will render a long comma-list. If your
  detection portfolio is large, consider replacing
  `values(source_search)` with
  `dc(source_search) AS contributing_search_count` and
  surfacing the count instead of the list.
- **Geocode-by-IP fallback.** If your A&I lookups have no
  lat/lon, the only geographic signal available from the
  `risk` index alone is when `risk_object_type="system"` AND
  `risk_object` happens to be an IP address. In that case
  substitute the A&I lookup with:

  ```spl
  | where risk_object_type="system" AND match(risk_object, "^\d+\.\d+\.\d+\.\d+$")
  | iplocation risk_object
  | where isnotnull(lat) AND isnotnull(lon)
  ```

  This loses every `risk_object_type="user"` entity (no IP to
  geocode), so the panel becomes "where are my risky systems?"
  not "where are my risky entities?" — a meaningfully narrower
  story.
- **`risk` index acceleration.** ES does NOT accelerate the
  `risk` index by default (it is a summary index, not a raw
  data source). A 24 h `stats sum(risk_score)` is usually fast
  enough (the `risk` index is small — RBA was designed for
  thousands of events per day, not millions). If your install
  generates >100k risk events per day, the recipe will slow
  down; consider scheduling a daily summary search that
  pre-aggregates to `risk_summary` and pointing the panel at
  the summary instead.
- **MITRE technique field semantics.** `annotations.mitre_attack{}`
  is a multi-value field. The `{}` syntax matters — it tells
  `tstats` to flatten the JSON array into a multi-value field.
  In some ES versions the field is `annotations.mitre_attack`
  (no `{}`), in others it is `MitreAttack` (camelCase). Run
  `| risk | head 1` against your tenant to confirm the column
  name in YOUR data; substitute in the SPL if needed.
- **Time range.** Hard-coded `earliest=-24h latest=now` so the
  panel works without a dashboard time picker. The 24 h window
  matches the default RBA scoring horizon — match the panel
  window to the RIR window in your tenant, otherwise the panel
  shows entities that have already been notable'd or that
  haven't aggregated long enough to be interesting.
- **PII / GDPR posture.** Per ROADMAP §1a, Better Map never
  sends event data outside `splunkd:8089`. `risk_object`
  values for `risk_object_type="user"` are by definition PII
  (usernames / emails). If the panel will be viewed by an
  audience without "see risky users" authorisation, restrict
  via Splunk RBAC (role-based search-time filtering on the
  `risk` index) OR pre-hash the `risk_object` in SPL
  (`eval risk_object=md5(risk_object)`). Do NOT rely on the
  client-side panel to hide PII — the SPL result set IS the
  source of truth.
- **No OT safety dependency.** This recipe is pure IT identity-
  and-system risk. If your ES install ALSO scores OT-zone
  entities (passive DPI alerts from Cisco Cyber Vision feeding
  ES correlation searches), keep them in a SEPARATE recipe
  with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — a risky PLC needs a fundamentally different
  response than a risky laptop, and the panel should reflect
  that.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented ES RBA contract from
[`~/.cursor/skills/splunk-rba/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/es-risk/markers.md)
and the A&I lookup conventions in
[`~/.cursor/skills/splunk-enterprise-security/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/es-risk/markers.md),
but it has NOT been dispatched against a tenant carrying both ES
licence AND a lat/lon-extended A&I lookup. The v1.7-prep lab
tenant is search-only without ES. A maintainer with REST auth to
an ES-licensed tenant with RBA active and A&I extended with
lat/lon should:

1. Verify the A&I extension is in place: `| inputlookup
   identity_lookup_expanded | where isnotnull(lat) | stats
   count`.
2. Confirm the `risk` index has data: `` | `risk` earliest=-24h
   | stats count ``.
3. Run the recipe SPL and confirm the panel renders at least 1
   marker per known-risky entity.
4. Tune the `where total_risk >= 50` threshold to the tenant's
   RIR threshold (see Gotchas).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "SplunkEnterpriseSecuritySuite"`), and submit a follow-up
   PR.
