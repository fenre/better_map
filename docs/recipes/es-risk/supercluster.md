---
schema_version: 1
id: es-risk--supercluster
source:
  id: es-risk
  display_name: "ES Risk-Based Alerting (risk index)"
  pattern: splunk-premium-es
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "SplunkEnterpriseSecuritySuite"
    optional: false
  - id: "Splunk_SA_CIM"
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
    example: "82"
  - name: risk_event_count
    type: integer
    example: "5"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (high-risk drilldown)"
    path: "docs/recipes/es-risk/markers.md"
  - description: "Companion recipe — same source, H3 hexbin"
    path: "docs/recipes/es-risk/h3.md"
  - description: "Companion recipe — same source, heatmap"
    path: "docs/recipes/es-risk/heat.md"
  - description: "Pattern reference — supercluster on CIM Authentication"
    path: "docs/recipes/cim-authentication/supercluster.md"
  - description: "splunk-rba skill — Risk-Based Alerting framework (risk index schema, rules, RIRs)"
    path: "~/.cursor/skills/splunk-rba/SKILL.md"
  - description: "splunk-enterprise-security skill — Asset & Identity framework, identities.csv schema"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# ES Risk-Based Alerting — supercluster

Render every entity that has accumulated ANY risk (not just high-
risk like the markers companion) over the last 24 h as a
**zoom-adaptive supercluster** on a world map, one row per
`risk_object`, with cluster pills at regional zoom that
progressively split into per-entity markers as the user zooms.
The canonical "global risk portfolio overview" panel for SecOps
leadership — when an enterprise has thousands of entities with
any non-zero risk and needs a single-pane "where is my risk
geographically concentrated" view without overwhelming the
renderer.

Sister recipe to [es-risk/markers](../es-risk/markers.md) (the
high-risk drilldown view at `total_risk >= 50`),
[es-risk/h3](../es-risk/h3.md) (per-cell roll-up), and
[es-risk/heat](../es-risk/heat.md) (smoothed concentration). The
four shapes together give a SOC team investigative-, density-,
hot-spot-, AND scale-tolerant cluster views on one ES RBA feed.

## 1. Source description

Same ES Risk-Based Alerting (RBA) source as the
[markers](../es-risk/markers.md) companion — see that recipe
§1 for the full discussion of the `risk` index schema, the
`risk_object` / `risk_score` / `annotations.mitre_attack{}`
fields, the `action.risk = 1` adaptive-response action that
populates the index, and the ES Asset & Identity (A&I)
framework used for geo-resolution.

This recipe is the **portfolio-scale overview**: same
aggregation as the markers companion but with the
`total_risk >= 50` filter LOWERED to `total_risk >= 10`
(captures any entity with at least one moderate-confidence
detection), rendered through supercluster instead of markers.
Where the markers companion answers "WHO is on fire right
now" (50+ point threshold), this recipe answers "WHERE is risk
GEOGRAPHICALLY DISTRIBUTED across my entire user/asset
population" (much wider net).

**Typical sourcetype / index:** `index=risk` via the ES `risk`
macro. Same A&I lookup contract (`identity_lookup_expanded` +
`asset_lookup_by_str`) as the markers companion.

## 2. SPL recipe

```spl
`risk` earliest=-24h latest=now
| stats sum(risk_score) AS total_risk,
    count AS risk_event_count
  BY risk_object, risk_object_type
| where total_risk >= 10
| lookup identity_lookup_expanded identity AS risk_object OUTPUT lat AS identity_lat, long AS identity_lon
| lookup asset_lookup_by_str src AS risk_object OUTPUT lat AS asset_lat, long AS asset_lon
| eval lat=coalesce(identity_lat, asset_lat)
| eval lon=coalesce(identity_lon, asset_lon)
| where isnotnull(lat) AND isnotnull(lon)
| rename risk_object AS id
| fields id, lat, lon, risk_object, risk_object_type, total_risk, risk_event_count
| sort - total_risk
| head 5000
```

Why this exact shape, line by line:

- **`` `risk` earliest=-24h latest=now ``** — ES `` `risk` ``
  macro, identical to the markers companion §2. Always use the
  macro (never hard-code `index=risk`).
- **`stats sum(risk_score), count BY risk_object, risk_object_type`** —
  two-aggregate rollup: total accumulated risk + raw event count.
  Distinguishes from the markers companion (which also pulls
  `values(annotations.mitre_attack{})` and `values(source_search)`)
  — supercluster pills don't render per-row popup arrays
  effectively at the cluster-aggregate zoom level, so the
  multi-value pulls are dead weight here.
- **`where total_risk >= 10`** — LOWERED threshold vs the
  markers companion's `>= 50`. The recipe's purpose is the
  portfolio overview, not the high-fidelity SOC drilldown.
  At `>= 10`, virtually every entity that fired even ONE
  correlation search appears — typical enterprise ES tenant
  has 500-2000 such entities per 24 h. This is exactly the
  cardinality supercluster is designed for.
- **Two `lookup` lines** — identical to the markers companion
  §2 — both `identity_lookup_expanded` and `asset_lookup_by_str`
  because RBA emits BOTH `risk_object_type="user"` and
  `risk_object_type="system"` events.
- **`coalesce(identity_lat, asset_lat)` + `coalesce(...)`** —
  same fall-back pattern as the markers companion §2.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  entities with no home location. Same A&I-gap discipline as
  the markers companion §2.
- **`rename risk_object AS id`** — Better Map's `id` alias.
- **`sort - total_risk`** — worst entities first; determines
  render order in cluster-pill breakdown popups.
- **`head 5000`** — generous render cap. Supercluster handles
  5000 rows comfortably; raise to 10000 for very large ES
  tenants if needed.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field            | type    | example              |
|------------------|---------|----------------------|
| id               | string  | alice@example.com    |
| lat              | number  | 47.6062              |
| lon              | number  | -122.3321            |
| risk_object      | string  | alice@example.com    |
| risk_object_type | string  | user                 |
| total_risk       | integer | 82                   |
| risk_event_count | integer | 5                    |

All seven appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.

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
  Essential for the 5000-row payload — drawing 5000 individual
  markers at world zoom would freeze the browser for ~2-3
  seconds and produce an unreadable speckle pattern.
- **`idField: "id"`** — explicit. Same alignment as the
  markers companion §4 — the SPL assembles `id` from
  `risk_object` so making it explicit avoids any field-
  auto-detect ambiguity at drilldown time.

For severity-tinted cluster pills, add `colorField: "total_risk"`
plus a `quantPalette` (e.g., `viridis` or `inferno`) — the
renderer will average `total_risk` within each cluster and tint
the pill accordingly. Without `colorField`, cluster pills render
in Better Map's default neutral colour — still useful, just not
severity-tinted.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic ES RBA corpus seeded with geographically-
distributed risk objects for cluster-density verification._

## 6. Gotchas

- **`total_risk >= 10` is the portfolio-overview threshold.**
  This is intentionally lower than the markers companion's
  `>= 50`. The recipe is the wide-net "where is risk
  geographically distributed" view, not the narrow-net "who
  is on fire" view. For a single-pane combined view, pair
  this recipe (background supercluster at `>= 10`) with the
  markers companion (foreground individual markers at
  `>= 50`) in adjacent panels.
- **Same A&I dependency as the markers companion.** Entities
  without `lat` / `lon` in identity_lookup_expanded /
  asset_lookup_by_str silently drop. Surface the gap in a
  companion table panel (see markers companion §6).
- **Cluster pill aggregate semantics are zoom-level dependent.**
  At world zoom, a single pill over Seattle might contain 20
  risky entities with mixed risk scores. The pill shows the
  count (20), not an aggregate risk score — averaging risk
  across unrelated entities is misleading. For per-region
  risk-aggregate views, use the [es-risk/h3](../es-risk/h3.md)
  companion which deliberately aggregates within hex cells.
- **`head 5000` is a render cap, not a security cap.** Very
  large ES tenants (>10k risky entities/24h) need the cap
  raised. The renderer scales gracefully past 5000; the
  conservative cap is defensive against initial-page-load
  latency, not algorithmic.
- **No MITRE / contributing-search context in popups.** The
  markers companion adds `values(annotations.mitre_attack{})`
  and `values(source_search)` via the same `stats` — this
  recipe deliberately omits both because supercluster pills
  don't render per-row popup arrays at the cluster zoom
  level. For per-entity MITRE / detection context, click-
  through to the markers companion as the drilldown target.
- **No OT safety dependency.** ES RBA is an IT-security
  detection framework; the recipe doesn't interact with any
  OT control-zone signal. OT-zone risk modelling (when ES
  is layered onto an OT environment) uses the same RBA
  framework but tags risk objects with OT-asset-IDs — the
  recipe still applies but the `asset_lookup_by_str` must
  resolve to OT-zone coordinates, which is an A&I-extension
  contract beyond stock ES.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk + ES built-ins (`` `risk` `` macro,
`stats`, `lookup`, `eval`, `coalesce`, `where`, `rename`,
`sort`, `fields`, `head`). Verification path mirrors the
markers companion §"Verification status" — confirm
`SplunkEnterpriseSecuritySuite` is installed, ES is licensed,
the `risk` index is populated, A&I lookups carry lat/lon,
dispatch via REST, drop into a Dashboard Studio panel with
the §4 formatter JSON, confirm cluster pills render at world
zoom and split correctly when zooming. Promote to
`status: verified` + fill in `verified_against` in a follow-up
PR.
