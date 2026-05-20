---
schema_version: 1
id: es-risk--vector-tile-join
source:
  id: es-risk
  display_name: "ES Risk-Based Alerting (risk index)"
  pattern: splunk-premium-es
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-31"
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
    example: "USA"
    drives_formatter_option: idField
  - name: country_name
    type: string
    example: "United States"
  - name: value
    type: integer
    example: "847"
  - name: total_risk
    type: integer
    example: "847"
  - name: risky_entity_count
    type: integer
    example: "23"
  - name: distinct_techniques
    type: integer
    example: "11"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-entity drilldown — author this recipe to mirror its A&I lookup chain)"
    path: "docs/recipes/es-risk/markers.md"
  - description: "Companion recipe — same source, h3 / heat / supercluster / paths layers"
    path: "docs/recipes/es-risk/h3.md"
  - description: "Pattern reference — vector-tile-join on CIM Network Traffic (sibling iplocation + iso_country_codes chain, event-source pattern)"
    path: "docs/recipes/cim-network-traffic/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join on CIM Performance (sibling A&I lookup + iplocation chain, host-source pattern)"
    path: "docs/recipes/cim-performance/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join on Meraki (sibling per-country aggregation, device-inventory metric)"
    path: "docs/recipes/meraki/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join on ThousandEyes (sibling per-country aggregation, agent-inventory metric)"
    path: "docs/recipes/thousandeyes/vector-tile-join.md"
  - description: "splunk-rba skill — Risk-Based Alerting framework (risk index schema, rules, RIRs)"
    path: "~/.cursor/skills/splunk-rba/SKILL.md"
  - description: "splunk-enterprise-security skill — Asset & Identity framework, identities.csv / assets.csv schema"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "splunk-mitre-attack skill — annotations.mitre_attack contract"
    path: "~/.cursor/skills/splunk-mitre-attack/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# ES Risk-Based Alerting — vector-tile join (customer PMTiles, world countries)

Render the global distribution of ES Risk-Based Alerting (RBA)
accumulated risk by joining **the `risk` index aggregated to
entity home country** (via the ES Asset & Identity framework's
`identities.csv` / `assets.csv` lookups extended with an `ip`
field, then `iplocation` → `Country` → `iso_country_codes` →
`iso_a3` chain) against a **customer-hosted world-countries
PMTiles vector tileset**. The **global companion** to the
[es-risk/markers](./markers.md) recipe — same RBA scoring
engine, same A&I-driven entity geocoding, but instead of one
marker per risky entity, the panel aggregates total accumulated
risk per country.

The **9th vector-tile-join recipe in the matrix** — joining
[csv-lookup-geo](../csv-lookup-geo/vector-tile-join.md),
[kvstore-latlon](../kvstore-latlon/vector-tile-join.md),
[cim-network-traffic](../cim-network-traffic/vector-tile-join.md),
[meraki](../meraki/vector-tile-join.md),
[ot-datastreamer](../ot-datastreamer/vector-tile-join.md),
[netflow-sflow-ipfix](../netflow-sflow-ipfix/vector-tile-join.md),
[thousandeyes](../thousandeyes/vector-tile-join.md), and
[cim-performance](../cim-performance/vector-tile-join.md). This
advances the vector-tile-join layer column from 8 cells to 9,
and brings the es-risk source row from 5 cells to 6 (markers,
h3, heat, supercluster, paths, plus vector-tile-join now). The
recipe is the canonical **global SecOps executive surface** —
"which countries are accumulating the most risk this hour?" —
designed for SOCs whose user base, datacenter footprint, and
adversary surface all span multiple continents.

## 1. Source description

Same **Risk-Based Alerting (RBA)** data source as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), and [paths](./paths.md)
companions — see
[es-risk/markers §1](./markers.md#1-source-description) for the
full RBA platform background, the `risk` index schema, the
`action.risk = 1` adaptive-response contract, and the ES Asset
& Identity (A&I) lookup chain.

The relevant distinction for THIS recipe: instead of per-entity
markers (markers companion) or per-region density bucketing
(h3 / heat companions), the panel aggregates **per country**.
Per-entity risk accumulation (the `stats sum(risk_score) BY
risk_object` rollup from markers) is computed first, then the
entity is joined against the A&I framework to get an IP address,
then `iplocation ip` derives the country, then `iso_country_codes`
maps country name to ISO 3166-1 alpha-3 code for the PMTiles
join.

**Why use an IP-keyed A&I extension instead of lat/lon.** The
[markers companion §1](./markers.md#1-source-description)
documents the canonical A&I extension contract: extend
`identities.csv` and `assets.csv` with `lat` / `long` columns
for direct per-entity geocoding. THIS recipe needs a coarser
resolution (country, not site), and many ES tenants who haven't
yet populated lat/lon for every user DO already have an `ip`
field populated on `assets.csv` (the IP of the user's home
office subnet, the datacenter management IP for hosts). The IP
chain via `iplocation` is therefore lower-friction than the
lat/lon chain for tenants whose A&I extension is partial.

For tenants with FULL lat/lon coverage on A&I, an equivalent
recipe would substitute the `iplocation ip` stage with `lookup
asset_lookup_by_str src AS risk_object OUTPUT lat AS lat, long
AS lon` + `geom geo_world_countries featureIdField="iso_a3"
latitude=lat longitude=lon` — see §6 Gotchas for the
substitution sketch.

**Why vector-tile-join (custom PMTiles) for ES Risk.** A US-states
choropleth answers "which US states host the most risky entities"
— useful for US-centric tenants. But for a global SOC (multi-
national enterprise / SaaS vendor / managed-security provider),
the US-only view answers the wrong question; entire continents
render as the unmatched-grey fallback fill and the executive
viewer can't tell whether "grey = no risk" or "grey = no
coverage at all". A world-countries vector-tile-join surfaces
both questions correctly: shaded countries have accumulated
risk above the threshold; unshaded countries are operationally
"no risk above threshold there" (which itself is informative —
"we have no high-risk entities in LATAM this hour, that's a
posture validation").

Typical use cases:

- **Global SOC shift handover briefings** — "Where is the
  accumulated risk concentrated as the EU shift hands off to
  the US shift? Are EMEA-tagged users carrying more risk than
  AMER-tagged users right now?"
- **Multi-regional SecOps incident retros** — "Risk accumulation
  spiked in Brazil and Argentina during the campaign window;
  the SOC pivot was correctly regional."
- **Executive cyber-risk distribution reports** — "Per-country
  total risk score, suitable for quarterly board reporting where
  per-jurisdiction risk metrics need geographic context."
- **Sales-engineering RFP risk-visibility visuals** — "We
  surface risky-entity behaviour across 60 countries; the heat
  map shows where our SOC drives the most signal today."

**Typical sourcetype / index:** `` `risk` `` macro (resolves to
`index=risk`, possibly sharded). The TA app context is
`SplunkEnterpriseSecuritySuite`; the recipe also requires
`Splunk_SA_CIM` and an A&I lookup extended with an `ip` field
(matching the asset / identity to a public IP).

**No add-on required beyond ES** for the `risk` index data,
Splunk's built-in `iplocation` for the country geocoding, and
a customer-managed `iso_country_codes` lookup (one-time
bootstrap from the Natural Earth countries dataset, documented
in the
[cim-network-traffic/vector-tile-join §6 Gotchas](../cim-network-traffic/vector-tile-join.md#6-gotchas)
companion). The PMTiles file is customer-hosted (on the Splunk
app's own `appserver/static/` folder for air-gapped tenants, or
on a customer CDN for non-air-gapped). No external API calls.
Fully air-gap compatible per ROADMAP §1a when the PMTiles file
is bundled into the app.

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
| where isnotnull(Country) AND Country != ""
| stats sum(entity_risk) AS total_risk,
    count AS risky_entity_count,
    dc(mvjoin(techniques_mv, ",")) AS distinct_techniques
  BY Country
| lookup iso_country_codes country_name AS Country OUTPUT iso_a3 AS id
| where isnotnull(id) AND id != ""
| eval value=total_risk
| rename Country AS country_name
| fields id, country_name, value, total_risk, risky_entity_count, distinct_techniques
| sort - value
```

Why this exact shape, line by line:

- **`` `risk` earliest=-24h latest=now ``** — the ES macro that
  resolves to `index=risk` (and any optional risk index shards
  the tenant has split out). Same posture as the
  [markers companion §2](./markers.md#2-spl-recipe): always use
  the macro, never hard-code `index=risk`.
- **`stats sum(risk_score) AS entity_risk,
  values(annotations.mitre_attack{}) AS techniques_mv BY
  risk_object, risk_object_type`** — the standard RBA per-entity
  aggregator. Two aggregates per entity: total accumulated risk,
  and the multi-value set of MITRE techniques that contributed.
  See the [markers companion §2](./markers.md#2-spl-recipe) for
  the full RBA aggregator background.
- **`where entity_risk >= 50`** — signal-to-noise filter, same
  threshold as the markers companion (RBA default medium-
  priority). Match this to whatever threshold the tenant's RIR
  framework uses.
- **`lookup identity_lookup_expanded identity AS risk_object
  OUTPUT ip AS identity_ip`** — first leg of the A&I IP lookup
  for user-typed entities (`risk_object_type="user"`,
  `alice@example.com`). The ES identity lookup default-ships
  with an `ip` column the customer populates with the user's
  home office subnet OR the most-recent VPN-egress IP from
  the last 24 h of EDR/VPN telemetry. The renamed `identity_ip`
  avoids collision with the asset lookup leg below.
- **`lookup asset_lookup_by_str src AS risk_object OUTPUT ip
  AS asset_ip`** — second leg of the A&I IP lookup for
  system-typed entities (`risk_object_type="system"`,
  `web-server-01`). The ES asset lookup ships with an `ip`
  column populated with the asset's primary IP from the
  customer CMDB / cloud inventory.
- **`eval entity_ip=coalesce(identity_ip, asset_ip)`** — fall
  back from identity to asset. Most user-typed `risk_object`
  values resolve via identity; most machine `risk_object`
  values resolve via asset. The coalesce-fallback pattern is
  identical to the
  [markers companion §2](./markers.md#2-spl-recipe)
  lat/lon coalesce-fallback (just IP-keyed instead of
  lat/lon-keyed).
- **`where isnotnull(entity_ip) AND entity_ip != ""`** — drop
  entities not resolved in EITHER A&I lookup. Same posture as
  the markers companion: surface the gap in a companion table
  panel ("Risky entities lacking A&I IP: <count>") so the SOC
  team sees the A&I coverage gap, don't silently drop
  unresolved entities.
- **`iplocation entity_ip`** — Splunk's bundled MaxMind GeoLite2
  geocoder. Populates `Country` (e.g., "United States",
  "Germany", "Japan") plus `Region` / `City` / lat/lng. RFC-
  1918 / private IPs resolve to null `Country` and are filtered
  out by the next stage. **Identical to the
  [cim-network-traffic/vector-tile-join §2](../cim-network-traffic/vector-tile-join.md#2-spl-recipe)
  geocoding pattern** — the only difference vs that companion
  is the upstream source (entity IP from A&I lookup vs event-
  side dest_ip on every network event).
- **`where isnotnull(Country) AND Country != ""`** — drop
  internal-IP entities so they don't pile up under a synthetic
  "unknown country" bucket. For tenants with a heavy internal-
  IP-only entity inventory (i.e., the A&I lookup `ip` column is
  populated with RFC-1918 subnets), this is the #1 way to
  ensure the choropleth shading is accurate: only public-IP
  entities contribute. To surface the internal-IP entities
  separately, add a companion table panel with the same SPL
  minus this filter, grouped by `if(isnull(Country), "Internal",
  Country)`.
- **`stats sum(entity_risk) AS total_risk, count AS
  risky_entity_count, dc(mvjoin(techniques_mv, ",")) AS
  distinct_techniques BY Country`** — second aggregation pass:
  per-country total risk + entity count + distinct-technique
  count. The `dc(mvjoin(techniques_mv, ","))` is the
  cardinality of the merged technique set; useful to
  distinguish "10 entities all from one technique" (likely a
  campaign / pivot) from "10 entities each from a different
  technique" (a broader concern / coverage validation
  question).
- **`lookup iso_country_codes country_name AS Country OUTPUT
  iso_a3 AS id`** — maps the MaxMind country NAME to the ISO
  3166-1 alpha-3 CODE the world-countries PMTiles `promoteId`
  uses. **Identical lookup to the
  [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
  [meraki/vector-tile-join](../meraki/vector-tile-join.md),
  [thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md),
  and [cim-performance/vector-tile-join](../cim-performance/vector-tile-join.md)
  companions** — the 250-row CSV bootstrap is documented in any
  of those recipes' §6 Gotchas. If the tileset uses ISO 3166-1
  alpha-2 codes (`iso_a2`, "US" / "DE" / "JP") instead, change
  `OUTPUT iso_a3 AS id` to `OUTPUT iso_a2 AS id` and update the
  §4 `featureJoinPromoteId` accordingly.
- **`where isnotnull(id) AND id != ""`** — drop countries that
  didn't resolve in the lookup. Same caveat as all VTJ
  companions: typical drops are MaxMind edge-case names
  ("Korea, Republic of" vs Natural Earth's "South Korea")
  that don't exact-match the 250-row table; surface these in
  a companion table panel so the operator can extend the
  `iso_country_codes` lookup with bidirectional aliases.
- **`eval value=total_risk`** — alias the per-country total
  risk to Better Map's canonical `value` field for choropleth
  shading. To shade by ENTITY COUNT instead of TOTAL RISK,
  change to `eval value=risky_entity_count`. To shade by
  TECHNIQUE DIVERSITY (the SOC-fatigue-signal proxy),
  change to `eval value=distinct_techniques`.
- **`rename Country AS country_name`** — popup-friendly alias
  matching the
  [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
  popup contract.
- **`fields ...`** — explicit projection, six columns: the
  join key (`id`), the popup label (`country_name`), the
  shading driver (`value`), and three feature-property fields
  (`total_risk`, `risky_entity_count`, `distinct_techniques`)
  for popup detail.
- **`sort - value`** — highest-risk countries first.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field                | type    | example       |
|----------------------|---------|---------------|
| id                   | string  | USA           |
| country_name         | string  | United States |
| value                | integer | 847           |
| total_risk           | integer | 847           |
| risky_entity_count   | integer | 23            |
| distinct_techniques  | integer | 11            |

Six fields, all in `expected_fields` in the frontmatter and
cross-checked by `scripts/check-recipe-schema.py`. `value`
drives the choropleth shading; `country_name` / `total_risk` /
`risky_entity_count` / `distinct_techniques` flow through as
feature properties on the joined polygon for popups (a hover
over "Germany" reads e.g., "Germany — total risk 412, 8 risky
entities, 5 distinct MITRE techniques").

The polygon geometry itself is NOT a field — Better Map fetches
it internally from the PMTiles URL configured in §4.

## 4. Recommended formatter config

```json
{
  "featureJoinUrl": "https://cdn.example.com/tilesets/world-countries.pmtiles",
  "featureJoinPromoteId": "iso_a3",
  "featureJoinSourceLayer": "countries",
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why these settings (identical contract to the
[cim-performance/vector-tile-join companion §4](../cim-performance/vector-tile-join.md#4-recommended-formatter-config)
and [cim-network-traffic/vector-tile-join companion §4](../cim-network-traffic/vector-tile-join.md#4-recommended-formatter-config)
— the PMTiles join contract is layer-driven, not source-driven):

- **`featureJoinUrl`** — the customer-hosted world-countries
  PMTiles URL. Public-domain Natural Earth tileset from
  [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
  is the canonical starting point. For air-gapped tenants,
  copy the `.pmtiles` file into
  `better_map/appserver/static/visualizations/better_map/presets/`
  and use `featureJoinPreset: "<your-preset-name>"` instead.
- **`featureJoinPromoteId: "iso_a3"`** — the property name on
  each tileset feature whose value matches the `id` field
  from the SPL. For Natural Earth / OpenStreetMap-derived
  country tilesets, `iso_a3` is canonical. Inspect via
  `pmtiles show <file>.pmtiles`.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. Inspect via `pmtiles tile
  <file>.pmtiles 0 0 0 | jq '.layers | keys'`.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" to "value-shaded fill".
- **`palette: "magma"`** — warm-colour-equates-with-attention
  semantics, matching the
  [cim-performance/vector-tile-join](../cim-performance/vector-tile-join.md)
  and [cim-alerts/choropleth](../cim-alerts/choropleth.md)
  companions. Every shaded country has accumulated risk above
  the threshold — a magma ramp (black-purple-red-yellow) reads
  intuitively as "darker countries need urgent SOC attention".
  For an executive-briefing view where magma red is too
  alarming, swap to `viridis` (the neutral perceptually-
  uniform default).

For an **ENTITY-COUNT shading variant** (where the question is
"which countries have the LARGEST POPULATION of risky entities"
rather than "highest TOTAL RISK"), change the SPL `eval
value=total_risk` to `eval value=risky_entity_count`. Useful
when risk scores vary widely per entity (one entity at 200
risk vs ten entities at 50 each = same total risk, very
different operational story).

For a **TECHNIQUE-DIVERSITY shading variant** (where the question
is "which countries have the MOST DIVERSE adversary surface"),
change to `eval value=distinct_techniques`. Useful for MITRE
ATT&CK coverage reviews — high distinct-technique countries are
where the SOC is generating the broadest detection-coverage
signal.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). Until
then, reproduce by (a) staging a small world-countries PMTiles
file (the public-domain Natural Earth countries tileset from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
is the canonical starting point), (b) populating an
`iso_country_codes` CSV lookup with the 250-row name → alpha-3
mapping (one-time bootstrap documented in the
[cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas)),
(c) ensuring the ES A&I lookups (`identity_lookup_expanded`,
`asset_lookup_by_str`) have populated `ip` field values for
the risky-entity population, (d) confirming the `risk` index
has 24 h of data, (e) pasting the §2 SPL into a Dashboard Studio
map panel with Better Map as the visualization and applying
the §4 formatter JSON. The choropleth should shade countries
that host risky entities (typically United States, United
Kingdom, Germany, India for global SaaS / multinational
tenants) darkest._

## 6. Gotchas

- **A&I lookups need an `ip` column — it does NOT default-
  populate for every entity.** The ES `identity_lookup_expanded`
  and `asset_lookup_by_str` lookups ship with `ip` as a defined
  schema column, but the column is operator-populated. Identity
  records typically populate it via VPN-egress IP tracking
  (last-seen IP per user per 24 h) or via static office-subnet
  assignment; asset records populate it from CMDB / cloud
  inventory. Tenants with partial A&I coverage will see silent
  entity drops at `where isnotnull(entity_ip)`. Surface the gap
  via a companion panel: run the same SPL up to the
  `coalesce(identity_ip, asset_ip)` line, then
  `eval has_ip=if(isnotnull(entity_ip), "yes", "no") | stats
  count BY has_ip` — the "no" row count tells the SOC team
  how many risky entities are missing IP attribution.

- **`risk_object` schema variations.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas): some ES
  installs use `MitreAttack` (camelCase, no `{}`) rather than
  `annotations.mitre_attack{}`. Run `| risk | head 1 | fields
  *` against the tenant to confirm the field name AND the
  multi-value bracketing in YOUR data; substitute the SPL
  accordingly.

- **`iso_country_codes` lookup is REQUIRED but NOT bundled.**
  Same caveat as all world-countries VTJ recipes
  (`cim-network-traffic`, `cim-performance`, `meraki`,
  `thousandeyes`, `ot-datastreamer`). The lookup is a 250-row
  CSV mapping `country_name` (matching MaxMind / `iplocation`
  output) → `iso_a3` (matching the PMTiles `promoteId`).
  One-time bootstrap from the Natural Earth countries dataset
  is documented in the
  [cim-network-traffic/vector-tile-join §6 Gotchas](../cim-network-traffic/vector-tile-join.md#6-gotchas)
  with a `| makeresults`-based seed snippet (explicitly a
  one-time setup script, NOT panel SPL). Alternatively,
  install [Splunk_TA_iplocation](https://splunkbase.splunk.com/app/3845)
  which ships an equivalent lookup with broader coverage.

- **Lat/lon substitution for tenants with full A&I geocoding.**
  For tenants whose A&I extension carries full lat/lon (not just
  ip), substitute the
  `lookup ... OUTPUT ip AS identity_ip / asset_ip` chain with:

  ```spl
  | lookup identity_lookup_expanded identity AS risk_object OUTPUT lat AS identity_lat, long AS identity_lon
  | lookup asset_lookup_by_str src AS risk_object OUTPUT lat AS asset_lat, long AS asset_lon
  | eval entity_lat=coalesce(identity_lat, asset_lat)
  | eval entity_lon=coalesce(identity_lon, asset_lon)
  | where isnotnull(entity_lat) AND isnotnull(entity_lon)
  | geom geo_world_countries featureIdField="iso_a3" latitude=entity_lat longitude=entity_lon
  | where isnotnull(featureId)
  | rename featureId AS id
  ```

  This drops the `iplocation` stage AND the `iso_country_codes`
  lookup — `geom geo_world_countries` (if the geometry lookup is
  available on the tenant) does both in one step. Cost: requires
  a `geo_world_countries` bundled lookup (Splunk Core does NOT
  ship one — it ships `geo_us_states`; you'd need to import a
  Natural Earth shapefile via `| inputlookup geo_world_countries`
  or via the [`Splunk_TA_geo`](https://splunkbase.splunk.com/app/2868)
  add-on family). Not zero-cost; document the tradeoff for the
  tenant.

- **Internal-IP entities silently drop.** Same caveat as all
  `iplocation`-based VTJ recipes: entities whose `entity_ip` from
  the A&I lookup is RFC-1918 private (10/8, 172.16/12, 192.168/16),
  carrier-NAT (100.64/10), or loopback (127/8) resolve to null
  `Country` and drop at `where isnotnull(Country)`. For tenants
  with a large internal-IP-only entity inventory (typical for
  internal-only LANs without VPN-egress tracking), this is the
  #1 way to ensure the choropleth shading reflects only the
  externally-resolvable entity population.

- **MaxMind country-name vs Natural Earth country-name drift.**
  Same caveat as all world-countries VTJ recipes: MaxMind's
  country naming sometimes drifts from Natural Earth's
  (e.g., "Korea, Republic of" vs "South Korea"; "Czech
  Republic" vs "Czechia" post-2016). Bidirectional CSV
  bootstrap recommended — see the
  [cim-network-traffic/vector-tile-join §6](../cim-network-traffic/vector-tile-join.md#6-gotchas)
  gap-detection panel pattern for the canonical mitigation.

- **`risk` index acceleration.** ES does NOT accelerate the
  `risk` index by default (it's a summary index, not raw data).
  A 24 h `stats sum(risk_score)` is usually fast enough (RBA
  was designed for thousands of events per day, not millions).
  If the tenant generates >100k risk events per day, the
  recipe will slow down; consider scheduling a daily summary
  search that pre-aggregates to `risk_summary` and pointing
  the panel at the summary instead.

- **Time range.** Hard-coded `earliest=-24h latest=now` matches
  the default RBA scoring horizon. Match the panel window to
  the RIR window in your tenant; otherwise the panel shows
  entities that have already been notable'd OR that haven't
  aggregated long enough to be operationally interesting.

- **PII / GDPR posture.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas): the
  COUNTRY-LEVEL aggregation in this recipe inherently
  anonymises the per-entity PII (a country shading "847 total
  risk, 23 entities" doesn't disclose any individual
  user / host). This is a STRONGER privacy posture than the
  markers companion which surfaces individual `risk_object`
  values. However, the underlying SPL still PROCESSES the
  per-entity PII (the A&I lookups, the entity-level stats);
  restrict via Splunk RBAC on the `risk` index for audiences
  without "see risky entities" authorisation.

- **No OT-safety dependency.** Same posture as the
  [markers companion §6](./markers.md#6-gotchas): pure IT
  identity-and-system risk. If the ES install ALSO scores
  OT-zone entities (passive DPI alerts from Cisco Cyber
  Vision feeding ES correlation searches), keep them in a
  SEPARATE recipe with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — a risky PLC needs a fundamentally different
  response than a risky laptop, and the panel should reflect
  that.

## Verification status

`status: unverified` in the frontmatter — every component is
proven elsewhere: the RBA aggregation block mirrors the
[markers companion](./markers.md) (verified against the
documented RBA contract from
[`~/.cursor/skills/splunk-rba/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/es-risk/markers.md));
the A&I `coalesce` fallback mirrors the markers companion's
lat/lon coalesce-fallback (just IP-keyed instead of lat/lon-
keyed); the `iplocation` + `iso_country_codes` chain mirrors
the [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
geocoding pattern; the `featureJoinUrl` + `featureJoinPromoteId`
+ `featureJoinSourceLayer` contract is exercised by every
world-countries VTJ recipe in the matrix. A maintainer with
REST auth to an ES-licensed tenant carrying RBA active AND an
A&I extension with populated `ip` columns AND the
`iso_country_codes` CSV bootstrap AND a hosted world-countries
PMTiles tileset can promote this recipe to `status: verified`
+ fill in `verified_against` in a follow-up PR — verification
steps mirror the
[markers companion §Verification status](./markers.md#verification-status),
substituting the §4 formatter JSON for the world-countries
variant and confirming non-US countries shade correctly.
