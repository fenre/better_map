---
schema_version: 1
id: es-risk--choropleth
source:
  id: es-risk
  display_name: "ES Risk-Based Alerting (risk index)"
  pattern: splunk-premium-es
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-06-01"
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
    example: "CA"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "California"
  - name: value
    type: integer
    example: "412"
  - name: total_risk
    type: integer
    example: "412"
  - name: risky_entity_count
    type: integer
    example: "14"
  - name: distinct_techniques
    type: integer
    example: "7"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, vector-tile-join layer (global world-countries sibling — same A&I IP chain, country-resolution variant)"
    path: "docs/recipes/es-risk/vector-tile-join.md"
  - description: "Companion recipes — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/es-risk/markers.md"
  - description: "Pattern reference — choropleth on CIM Performance (sibling A&I lookup chain, US-states preset, asset-pressure metric)"
    path: "docs/recipes/cim-performance/choropleth.md"
  - description: "Pattern reference — choropleth on CIM Alerts (sibling US-states preset, severity-weighted alerting metric)"
    path: "docs/recipes/cim-alerts/choropleth.md"
  - description: "Pattern reference — choropleth on Cyber Vision (sibling US-states preset, attention-framed OT exposure metric)"
    path: "docs/recipes/cyber-vision/choropleth.md"
  - description: "splunk-rba skill — Risk-Based Alerting framework (risk index schema, rules, RIRs)"
    path: "~/.cursor/skills/splunk-rba/SKILL.md"
  - description: "splunk-enterprise-security skill — Asset & Identity framework, identities.csv / assets.csv schema"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "splunk-mitre-attack skill — annotations.mitre_attack contract"
    path: "~/.cursor/skills/splunk-mitre-attack/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enableChoropleth, featureJoinPreset, palette"
    path: "docs/_machine/formatter-schema.json"
---

# ES Risk-Based Alerting — US states choropleth

Render the **US-jurisdictional distribution of ES Risk-Based
Alerting (RBA) accumulated risk** by joining the `risk` index
aggregated to entity home state (via the ES Asset & Identity
framework's `identities.csv` / `assets.csv` lookups extended
with an `ip` field, then `iplocation` → `Region` → USPS
2-letter code chain) against the bundled `us-states.pmtiles`
preset. Per-state colour saturation encodes the **total
accumulated risk score** of risky entities (`entity_risk >=
50`) whose A&I-recorded IP geocodes to that US state. The
**US-jurisdictional companion** to the
[es-risk/vector-tile-join](./vector-tile-join.md) recipe — same
RBA scoring engine, same A&I-driven entity geocoding, but
aggregated by US state instead of by country.

The right shape for **US-only SOC executive briefings**, **per-
state regulatory-notification reviews** (where state Attorney-
General notification laws drive risk-distribution reporting —
California's CCPA, Virginia's CDPA, Colorado's CPA, etc.), and
**incident-retro panels** ("the campaign pivot was concentrated
in our California and Texas user populations"). For tenants
with a global user base, use the
[es-risk/vector-tile-join](./vector-tile-join.md) sibling
instead — same SPL shape, swapped to ISO 3166-1 alpha-3 country
codes against a customer-hosted world-countries PMTiles.

The **10th choropleth recipe in the matrix** — joining
[geo-us-states](../geo-us-states/choropleth.md),
[cim-network-traffic](../cim-network-traffic/choropleth.md),
[cim-authentication](../cim-authentication/choropleth.md),
[cim-alerts](../cim-alerts/choropleth.md),
[cim-performance](../cim-performance/choropleth.md),
[thousandeyes](../thousandeyes/choropleth.md),
[itsi-kpi-base](../itsi-kpi-base/choropleth.md),
[splunk-stream](../splunk-stream/choropleth.md), and
[cyber-vision](../cyber-vision/choropleth.md). This advances the
choropleth layer column from 9 cells to 10, and brings the
es-risk source row from 6 cells to 7 (markers, h3, heat,
supercluster, paths, vector-tile-join, plus choropleth now).

## 1. Source description

Same **Risk-Based Alerting (RBA)** data source as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), [paths](./paths.md), and
[vector-tile-join](./vector-tile-join.md) companions — see
[es-risk/markers §1](./markers.md#1-source-description) for the
full RBA platform background, the `risk` index schema, the
`action.risk = 1` adaptive-response contract, and the ES Asset
& Identity (A&I) lookup chain.

The relevant distinction for THIS recipe: instead of per-entity
markers (markers companion) or per-country aggregation
(vector-tile-join companion), the panel aggregates **per US
state**. Per-entity risk accumulation (the `stats sum(risk_score)
BY risk_object` rollup from markers) is computed first, then the
entity is joined against the A&I framework to get an IP address,
then `iplocation ip` derives the US state via `Region`, then
mapped to USPS 2-letter codes for the `us-states.pmtiles` join.

The SPL is structurally identical to the
[vector-tile-join companion §2](./vector-tile-join.md#2-spl-recipe)
through the `iplocation` stage; the divergence is at the
geographic-resolution step — VTJ aggregates by `Country` and
maps to `iso_a3`, this recipe aggregates by `Region` and maps
to `stusps`.

**Why choropleth for ES Risk.** A vector-tile-join answers "which
COUNTRIES carry the most accumulated risk" — the global SOC
question. A US-states choropleth answers the US-jurisdictional
variant: "across the 50 US states, which carry the most risk?"
This matters for:

- **Multi-state US enterprises** — a US-headquartered company
  with VPN-egress IPs concentrated across multiple states wants
  the per-state risk distribution, not the per-country roll-up.
  At the country level the answer is always "United States 95%,
  others 5%"; the per-state choropleth answers the actually-
  actionable "which state is the SOC focus this hour?".
- **Per-state regulatory notification readiness** — CCPA
  (California), CDPA (Virginia), CPA (Colorado), CTDPA
  (Connecticut), UCPA (Utah) all require state-AG
  notification on certain risk-realisation thresholds. A
  choropleth surfacing per-state accumulated risk is the proxy
  for "which state's regulator might we be filing with this
  quarter".
- **Multi-region executive briefings** — when the global VTJ
  view is too coarse (all US risk collapsed into one country
  cell) and the per-entity markers view is too noisy (5,000
  individual entities), the US-states choropleth is the
  Goldilocks zone: 51 cells (50 states + DC), each pre-
  attentively readable, with the geographic context that
  matters for US-jurisdictional incident response.

**Why the bundled `us-states.pmtiles` preset.** Same air-gap
posture as the
[cim-performance/choropleth](../cim-performance/choropleth.md)
and [cim-alerts/choropleth](../cim-alerts/choropleth.md)
companions: bundled preset, no CDN, no add-on beyond Splunk
Core's `iplocation` for the state geocoding, fully air-gap
compatible per ROADMAP §1a.

**Typical sourcetype / index:** `` `risk` `` macro (resolves to
`index=risk`, possibly sharded). The TA app context is
`SplunkEnterpriseSecuritySuite`; the recipe also requires
`Splunk_SA_CIM` and an A&I lookup extended with an `ip` field
(matching the asset / identity to a public IP).

**No add-on required beyond ES** for the `risk` index data and
Splunk's built-in `iplocation` for the state geocoding. Fully
air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
`risk` earliest=-24h latest=now
| stats sum(risk_score) AS entity_risk,
    values(annotations.mitre_attack{}) AS techniques_mv
  BY risk_object, risk_object_type
| where entity_risk >= 50
| lookup identity_lookup_expanded identity AS risk_object OUTPUT ip AS identity_ip
| lookup asset_lookup_by_str src AS risk_object OUTPUT ip AS asset_ip
| eval entity_ip=coalesce(identity_ip, asset_ip)
| where isnotnull(entity_ip) AND entity_ip != ""
| iplocation entity_ip
| where Country="United States" AND isnotnull(Region) AND Region != ""
| stats sum(entity_risk) AS total_risk,
    count AS risky_entity_count,
    dc(mvjoin(techniques_mv, ",")) AS distinct_techniques
  BY Region
| eval id=upper(case(
    Region=="California","CA",
    Region=="New York","NY",
    Region=="Texas","TX",
    Region=="Washington","WA",
    Region=="Illinois","IL",
    Region=="Florida","FL",
    Region=="Massachusetts","MA",
    Region=="Virginia","VA",
    Region=="Colorado","CO",
    Region=="Oregon","OR",
    Region=="Pennsylvania","PA",
    Region=="New Jersey","NJ",
    Region=="Georgia","GA",
    Region=="North Carolina","NC",
    Region=="Ohio","OH",
    Region=="Michigan","MI",
    Region=="Arizona","AZ",
    Region=="Minnesota","MN",
    Region=="Indiana","IN",
    Region=="Tennessee","TN",
    Region=="District of Columbia","DC",
    true(),substr(Region,1,2)))
| eval value=total_risk
| rename Region AS state_name
| fields id, state_name, value, total_risk, risky_entity_count, distinct_techniques
| sort - value
```

Why this exact shape, line by line (the first six stages are
identical to the
[vector-tile-join companion §2](./vector-tile-join.md#2-spl-recipe);
see that recipe for the per-stage RBA-aggregator / A&I-coalesce
rationale):

- **`` `risk` earliest=-24h latest=now ``** through
  **`| iplocation entity_ip`** — identical to the
  [vector-tile-join companion §2](./vector-tile-join.md#2-spl-recipe),
  same RBA aggregation, same A&I IP coalesce, same MaxMind
  geocoder. See that recipe for the per-stage walkthrough.
- **`where Country="United States" AND isnotnull(Region) AND
  Region != ""`** — the US-jurisdictional filter. THIS is the
  recipe's divergence from the VTJ companion: VTJ keeps all
  countries; this recipe restricts to US-resident entities so
  the per-state aggregation is meaningful. Same posture as the
  [cim-alerts/choropleth §2](../cim-alerts/choropleth.md#2-spl-recipe)
  US-only filter.
- **`stats sum(entity_risk) AS total_risk, count AS
  risky_entity_count, dc(mvjoin(techniques_mv, ",")) AS
  distinct_techniques BY Region`** — per-state aggregation
  instead of per-country (VTJ companion uses `BY Country`).
  Same three aggregates (total risk + entity count + distinct
  techniques) as the VTJ companion; the only swap is the
  group-by dimension.
- **`eval id=upper(case(Region=="California","CA", ...))`** —
  maps the MaxMind US-state NAME to the USPS 2-letter CODE the
  `us-states.pmtiles` `promoteId` uses (`stusps`). Same
  21-state explicit case list as the
  [cim-alerts/choropleth §2](../cim-alerts/choropleth.md#2-spl-recipe)
  — covers states most likely to dominate an RBA panel (tech /
  finance / healthcare / government concentration), with a
  `substr(Region,1,2)` fallback for the remaining 29 states.
  Same imperfect-fallback caveat as the cim-alerts companion
  (Iowa → "IO" is wrong, should be "IA") — for perfect
  50-state coverage, expand the case list or use a CSV
  lookup; the §6 Gotchas documents both.
- **`eval value=total_risk`** — alias the per-state total risk
  to Better Map's canonical `value` field for choropleth
  shading. To shade by ENTITY COUNT instead of TOTAL RISK,
  change to `eval value=risky_entity_count`. To shade by
  TECHNIQUE DIVERSITY (the SOC-fatigue-signal proxy),
  change to `eval value=distinct_techniques`. Same three
  shading-driver variants as the
  [vector-tile-join companion §4](./vector-tile-join.md#4-recommended-formatter-config).
- **`rename Region AS state_name`** — popup-friendly alias
  matching the
  [cim-performance/choropleth](../cim-performance/choropleth.md)
  popup contract.
- **`fields ...`** — explicit projection, six columns: the
  join key (`id`), the popup label (`state_name`), the
  shading driver (`value`), and three feature-property fields
  (`total_risk`, `risky_entity_count`, `distinct_techniques`).
- **`sort - value`** — highest-risk states first.
- **No `head` cap.** Maximum row count is 51 (50 states + DC).

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field                | type    | example       |
|----------------------|---------|---------------|
| id                   | string  | CA            |
| state_name           | string  | California    |
| value                | integer | 412           |
| total_risk           | integer | 412           |
| risky_entity_count   | integer | 14            |
| distinct_techniques  | integer | 7             |

Six fields, all in `expected_fields` in the frontmatter and
cross-checked by `scripts/check-recipe-schema.py`. `value`
drives the choropleth shading; `state_name` / `total_risk` /
`risky_entity_count` / `distinct_techniques` flow through as
feature properties on the joined polygon for popups (a hover
over "California" reads e.g., "California — total risk 412, 14
risky entities, 7 distinct MITRE techniques").

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why this minimal config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). Same preset as all nine other
  US-state choropleth recipes in the matrix.
- **`enableChoropleth: "true"`** — switches the join layer from
  neutral polygon outline to colour-graded fill driven by the
  `value` SPL column. The SPL MUST produce a `value` field for
  shading; rows with no `value` render with the unmatched-grey
  fallback fill.
- **`palette: "magma"`** — warm-colour-equates-with-attention
  semantics, matching the
  [cim-alerts/choropleth](../cim-alerts/choropleth.md),
  [cim-performance/choropleth](../cim-performance/choropleth.md),
  and [cyber-vision/choropleth](../cyber-vision/choropleth.md)
  companions. Every shaded state has accumulated risk above the
  threshold — a magma ramp (black-purple-red-yellow) reads
  intuitively as "darker states need urgent SOC attention". For
  an executive-briefing view where magma red is too alarming,
  swap to `viridis` (the neutral perceptually-uniform default).

For an **ENTITY-COUNT shading variant** (where the question is
"which states have the LARGEST POPULATION of risky entities"
rather than "highest TOTAL RISK"), change the SPL `eval
value=total_risk` to `eval value=risky_entity_count`. Useful
when risk scores vary widely per entity.

For a **TECHNIQUE-DIVERSITY shading variant** (where the
question is "which states have the MOST DIVERSE adversary
surface"), change to `eval value=distinct_techniques`. Useful
for MITRE ATT&CK coverage reviews.

For an **extrusion + choropleth double-encoded view** (3D
height = total risk, colour = total risk), enable
`enable3DExtrusion: true` + `extrusionHeightField: "value"`
+ `extrusionScale: 50.0` (tunable to entity population). Same
recipe-level tweak as the
[cim-performance/extrusion-3d](../cim-performance/extrusion-3d.md)
companion.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by (a) confirming the ES `risk` index
has 24 h of data with `| risk | stats count`, (b) confirming
the A&I lookups (`identity_lookup_expanded`,
`asset_lookup_by_str`) have populated `ip` field values for the
risky-entity population, (c) confirming `iplocation` resolves
public IPs (`| makeresults | eval ip="8.8.8.8" | iplocation ip
| fields Region`), (d) pasting the §2 SPL into a Dashboard
Studio map panel with Better Map as the visualization and
applying the §4 formatter JSON. The choropleth should shade
states proportional to their accumulated risk, with the largest
tech / finance hosting states (CA, NY, TX, VA, WA) typically
darkest._

## 6. Gotchas

- **A&I lookups need an `ip` column — it does NOT default-
  populate for every entity.** Same caveat as the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  the ES `identity_lookup_expanded` and `asset_lookup_by_str`
  lookups ship with `ip` as a defined schema column, but the
  column is operator-populated. See the VTJ companion for the
  gap-detection panel pattern.

- **`risk_object` schema variations.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas) and the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  some ES installs use `MitreAttack` (camelCase, no `{}`)
  rather than `annotations.mitre_attack{}`. Run `| risk |
  head 1 | fields *` against the tenant to confirm the field
  name AND the multi-value bracketing in YOUR data; substitute
  the SPL accordingly.

- **State case list is incomplete by design.** Same caveat as
  the [cim-alerts/choropleth §6](../cim-alerts/choropleth.md#6-gotchas):
  the explicit 21-state list covers states that dominate a
  mid-size US SOC's risk panel; the remaining 29 states use a
  `substr(Region,1,2)` fallback which produces correct codes
  for many (Idaho → ID) but wrong codes for some (Iowa → IO,
  should be IA). Wrong codes mean the polygon won't join —
  that state is silently rendered with the unmatched-grey
  fallback fill. For perfect 50-state coverage either expand
  the case list (boring but correct) OR externalize the
  mapping to a CSV lookup (`| lookup us_state_abbr region
  OUTPUT abbr AS id`).

- **Internal-IP entities silently drop.** Same caveat as the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  entities whose `entity_ip` from the A&I lookup is RFC-1918
  private, carrier-NAT, or loopback resolve to null `Country`
  and drop at `where Country="United States"`. For tenants
  with a large internal-IP-only entity inventory, this is the
  #1 way to ensure the choropleth shading reflects only the
  externally-resolvable entity population.

- **Non-US entities silently drop.** Same posture as the
  [cim-alerts/choropleth §6](../cim-alerts/choropleth.md#6-gotchas):
  the bundled `us-states.pmtiles` is the 50 states + DC. Non-US
  entities from `iplocation` (e.g., risky entities resolving
  to UK, Germany, Japan) are filtered out by the
  `Country="United States"` guard. For a global risk-
  distribution view, use the
  [vector-tile-join companion](./vector-tile-join.md) sibling
  instead — same SPL shape, swapped to ISO 3166-1 alpha-3
  country codes against a customer-hosted world-countries
  PMTiles.

- **MAUP — state-area bias.** Same caveat as all US-state
  choropleths: California, New York, Texas, and Virginia host
  the largest VPN-egress and cloud-egress populations, so they
  will tend to read darkest regardless of per-entity risk-score
  intensity. For a normalised view, swap `value=total_risk` for
  `value=ceil(total_risk / risky_entity_count)` (the AVERAGE
  per-entity risk per state) — a state where 2 entities
  averaging 200 risk each reads darker than a state where 50
  entities average 20 risk each, even though the latter has
  more total risk.

- **`risk` index acceleration.** Same caveat as the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  ES does NOT accelerate the `risk` index by default. If the
  tenant generates >100k risk events per day, consider a daily
  summary search.

- **Time range.** Same caveat as the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  hard-coded `earliest=-24h latest=now` matches the default
  RBA scoring horizon. Match the panel window to the RIR
  window in your tenant.

- **PII / GDPR posture.** Same caveat as the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  the STATE-LEVEL aggregation in this recipe inherently
  anonymises the per-entity PII (a state shading "412 total
  risk, 14 entities" doesn't disclose any individual user /
  host). This is a STRONGER privacy posture than the markers
  companion. However, the underlying SPL still PROCESSES the
  per-entity PII; restrict via Splunk RBAC on the `risk`
  index for audiences without "see risky entities"
  authorisation.

- **No OT-safety dependency.** Same posture as the
  [vector-tile-join companion §6](./vector-tile-join.md#6-gotchas):
  pure IT identity-and-system risk. If the ES install ALSO
  scores OT-zone entities, keep them in a SEPARATE recipe with
  `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

`status: unverified` in the frontmatter — every component is
proven elsewhere: the RBA aggregation block + A&I `coalesce`
fallback mirrors the
[vector-tile-join companion §2](./vector-tile-join.md#2-spl-recipe)
verbatim through the `iplocation` stage; the `eval id=upper(case
(Region=...))` USPS-mapping pattern is the
[cim-alerts/choropleth §2](../cim-alerts/choropleth.md#2-spl-recipe)
pattern verbatim (same 21-state case list, same substr fallback);
the `featureJoinPreset: "us-states"` + `enableChoropleth` +
`palette: "magma"` contract is the canonical US-states-magma
choropleth shape exercised by 9 other recipes in the matrix. A
maintainer with REST auth to an ES-licensed tenant carrying RBA
active AND an A&I extension with populated `ip` columns can
promote this recipe to `status: verified` + fill in
`verified_against` in a follow-up PR — verification steps mirror
the
[vector-tile-join companion §Verification status](./vector-tile-join.md#verification-status)
(substituting this recipe's §4 us-states formatter for the
world-countries VTJ formatter and confirming US states shade
correctly).
