---
schema_version: 1
id: ot-datastreamer--vector-tile-join
source:
  id: ot-datastreamer
  display_name: "OT Datastreamer / Edge Hub (Modbus / OPC-UA / BACnet)"
  pattern: splunk-edge-hub
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-27"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_oti"
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
    example: "14"
  - name: hub_count
    type: integer
    example: "14"
  - name: site_count
    type: integer
    example: "8"
  - name: active_hub_count
    type: integer
    example: "13"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/ot-datastreamer/markers.md"
  - description: "Pattern reference — vector-tile-join on Meraki (sibling vendor-TA + iplocation/lookup country aggregation)"
    path: "docs/recipes/meraki/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with KV Store metric source (lookup-source sibling for the world-countries PMTiles join contract)"
    path: "docs/recipes/kvstore-latlon/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with CSV lookup (lookup-source sibling)"
    path: "docs/recipes/csv-lookup-geo/vector-tile-join.md"
  - description: "splunk-edge-hub skill — Edge Hub indexes, sourcetypes, protocol-specific sources"
    path: "~/.cursor/skills/splunk-edge-hub/SKILL.md"
  - description: "splunk-oti-datastreamer skill — OTI Datastreamer ingest pipeline, HEC tuning"
    path: "~/.cursor/skills/splunk-oti-datastreamer/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (Rule 5: SIS asset list = read-only mirror of customer SRS)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# OT Datastreamer / Edge Hub — vector-tile join (world-countries PMTiles)

Aggregate the Splunk Edge Hub fleet by **country** (via the
customer-owned hub asset register) and render as a **flat-fill
choropleth** over a customer-hosted **world-countries PMTiles
tileset**. The **global-coverage executive view** for any
multinational OT operator: "in how many countries do we have
plants instrumented with Edge Hubs, where are our blind spots,
which countries dominate our OT footprint?".

The **6th vector-tile-join recipe in the matrix** — joining
[meraki/vector-tile-join](../meraki/vector-tile-join.md),
[thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md),
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md),
and [kvstore-latlon/vector-tile-join](../kvstore-latlon/vector-tile-join.md).
This advances the vector-tile-join layer column from 5 cells to 6,
and brings the ot-datastreamer source row from 5 cells to 6
(markers, h3, heat, supercluster, paths, plus vector-tile-join
now). The recipe is the canonical "global OT footprint" panel
for plant-operations executive summaries and OT-zone
compliance / jurisdictional reviews.

> **OT-safety boundary.** This recipe operates entirely on
> Edge-Hub-emitted metadata and the customer-owned hub asset
> register. It performs ZERO active probes against PLCs, HMIs,
> SIS logic-solvers, or any Level-0/1/2 asset (per
> [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
> Rules 1, 2, 4). The country geocoding comes from the
> read-only asset register, not from network attribution of
> control-zone traffic (Rule 5). The recipe is therefore safe
> to deploy in any OT engagement that has a populated
> `edge_hub_inventory.csv` lookup — no additional safety review
> required beyond the existing Phase-1 sign-offs for the
> Edge Hub deployment.

## 1. Source description

Same **Splunk Edge Hub** (`Splunk_TA_oti`) source as all
ot-datastreamer companions — see
[ot-datastreamer/markers §1](./markers.md#1-source-description)
for the full deployment background, the Purdue-level boundary,
the per-protocol indexes (`edge_hub_modbus`, `edge_hub_opcua`,
`edge_hub_bacnet`, `edge_hub_mqtt`, `edge_hub_snmp`,
`edge_hub_metadata`), and the passive-collection contract.

The relevant distinction for THIS recipe: instead of one marker
per hub (markers companion) or one hex per regional density
bucket (h3 companion), the panel aggregates **per country** via
the customer-owned `edge_hub_inventory.csv` asset register
lookup. The country-aggregated row set then joins against a
customer-hosted world-countries PMTiles tileset to render as a
polygon choropleth.

**Why the asset-register lookup, NOT `iplocation`.** The
sibling [meraki/vector-tile-join](../meraki/vector-tile-join.md)
and [thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md)
recipes use `iplocation` on the device's public IP for country
attribution. For Edge Hubs, this is the WRONG path for three
reasons:

1. **Hubs typically egress through a single OT/IT DMZ NAT
   gateway** per site (one MX or one customer-owned firewall
   per plant). `iplocation hub_public_ip` would aggregate every
   hub in the plant under the country of that single egress
   gateway. For a multinational OT operator with one plant in
   Mexico and one in Brazil whose NAT egress both terminate at
   a US cloud VPN concentrator, `iplocation` reports "USA, USA"
   — flatly wrong.

2. **OT-safety Rule 5 mandates the SIS asset list is a
   read-only mirror of the customer-owned asset register.** The
   customer-maintained `edge_hub_inventory.csv` lookup IS that
   mirror. Pulling country from any other source (MaxMind,
   active probe, third-party geocoder) would bypass the
   read-only-mirror contract and introduce a second source of
   truth — which Rule 5 explicitly forbids.

3. **Air-gap compatibility.** `iplocation` requires the bundled
   MaxMind GeoLite2 lookup, which is present on standard Splunk
   Enterprise but not on minimum-footprint air-gapped
   deployments where the OT operator has stripped non-essential
   add-ons. The asset-register-based lookup is air-gap-clean —
   it ships inside the customer's own app package.

**Typical sourcetype / index:** `sourcetype="edge_hub:metadata"`,
`index=edge_hub_metadata` (the TA defaults — see the
[markers companion §1](./markers.md#1-source-description) for
the per-protocol index catalogue). The recipe reads ONLY the
metadata index, which carries hub heartbeats / startup events.
The per-protocol payload indexes (`edge_hub_modbus`,
`edge_hub_opcua`, etc.) are NOT touched by this recipe — they
carry the control-zone sensor data that Rule 1 mandates we
treat as read-only-passive.

**Asset register schema.** The recipe assumes an
operator-maintained `edge_hub_inventory.csv` lookup with the
following columns (the same shape used across the
ot-datastreamer recipe family — see
[markers companion §1](./markers.md#1-source-description)):

| column          | example                  | required |
|-----------------|--------------------------|----------|
| hub_id          | `ACT-076-1823-0086`      | yes      |
| hub_name        | `houston-plant-east-bldg-3` | yes  |
| site_id         | `HOU-EAST`               | yes      |
| site_name       | `Houston Plant — East`   | yes      |
| country_iso3    | `USA`                    | yes      |
| country_name    | `United States`          | yes      |
| lat             | `29.7604`                | yes      |
| lon             | `-95.3698`               | yes      |
| zone_purdue_level | `L3`                   | yes      |

The lookup is a **read-only mirror** of the customer's SIS
asset register (per Rule 5). Updates flow customer → lookup,
never the other way. Stale entries (decommissioned hubs)
should be retained for historical-search purposes; the recipe
filters out hubs that haven't emitted metadata in the last
24 h to avoid surfacing ghost rows.

## 2. SPL recipe

```spl
index=edge_hub_metadata sourcetype="edge_hub:metadata" earliest=-24h latest=now
| dedup hub_id sortby - _time
| eval last_seen_minutes_ago=round((now() - _time) / 60, 0)
| eval is_active=if(last_seen_minutes_ago <= 60, 1, 0)
| lookup edge_hub_inventory hub_id OUTPUT country_iso3, country_name, site_id
| where isnotnull(country_iso3) AND country_iso3 != ""
| stats count AS hub_count,
    dc(site_id) AS site_count,
    sum(is_active) AS active_hub_count,
    values(country_name) AS country_name
  BY country_iso3
| eval value=hub_count
| rename country_iso3 AS id
| fields id, country_name, value, hub_count, site_count, active_hub_count
| sort - value
```

Why this exact shape, line by line:

- **`index=edge_hub_metadata sourcetype="edge_hub:metadata"`** —
  the metadata index only, NOT the per-protocol payload indexes.
  Per OT-safety Rule 1 (passive collection only) and Rule 4
  (never write back to PLCs / HMIs), the recipe must avoid any
  query path that could be construed as an active probe.
  Metadata events are hub heartbeats / startup notifications —
  passive observation of the collector itself, not of the
  control-zone data it routes.
- **`earliest=-24h latest=now`** — long enough to capture hubs
  that emit metadata only on configuration change (typical for
  silent-mode hubs). The downstream `is_active` flag separates
  "ever seen in 24h" from "seen in the last hour".
- **`dedup hub_id sortby -_time`** — one row per hub, freshest
  metadata event. Same pattern as the
  [markers companion §2](./markers.md#2-spl-recipe).
- **`eval last_seen_minutes_ago=round((now() - _time) / 60,
  0)`** — minutes since the freshest metadata event. Used as
  the liveness signal.
- **`eval is_active=if(last_seen_minutes_ago <= 60, 1, 0)`** —
  0/1 flag for the next `stats` to SUM. A hub seen in the last
  hour is "active"; a hub last seen 6 hours ago is
  operationally a partial-outage signal but not yet a full
  decommissioning. The recipe surfaces both: `hub_count` is
  the total seen in 24h, `active_hub_count` is the subset seen
  in the last hour.
- **`lookup edge_hub_inventory hub_id OUTPUT country_iso3,
  country_name, site_id`** — the read-only asset-register
  join. ALL geocoding for this recipe flows through this single
  lookup; the recipe does NOT use `iplocation`, `geom`, or any
  other geocoding pathway (see §1 for the OT-safety rationale).
  The lookup is keyed on `hub_id` (the immutable serial number
  of the Edge Hub appliance) — guaranteed stable across the
  hub's lifecycle.
- **`where isnotnull(country_iso3) AND country_iso3 != ""`** —
  drop hubs the asset register doesn't recognise. This SHOULD
  return zero rows in a healthy deployment; a non-empty result
  means a hub is reporting metadata but isn't in the asset
  register — a serious operational gap (it could be an
  unauthorised hub installed without going through the
  asset-management process). Surface the dropped count in a
  companion panel:
  ```spl
  index=edge_hub_metadata sourcetype="edge_hub:metadata"
  earliest=-24h
  | dedup hub_id sortby - _time
  | lookup edge_hub_inventory hub_id OUTPUT country_iso3
  | where isnull(country_iso3)
  | stats count AS unregistered_hubs
  ```
- **`stats count AS hub_count, dc(site_id) AS site_count,
  sum(is_active) AS active_hub_count, values(country_name) AS
  country_name BY country_iso3`** — one row per country with
  three metrics: total hubs, distinct sites, and active-in-the-
  last-hour hubs. `values(country_name)` carries the
  human-readable country name through for popup display.
  `dc(site_id)` is the executive-summary metric — "we have
  Edge Hubs at 8 sites in the United States" reads more
  naturally than "we have 14 hubs in the United States".
- **`eval value=hub_count`** — explicit copy. The choropleth
  layer reads `value` per the formatter contract. This is the
  absolute-count view; countries with the most hubs shade
  darkest. For a SITE-COUNT view (highlights countries with
  the most distinct plants), swap to `eval value=site_count`.
  For an LIVENESS view (highlights countries where the
  largest fraction of hubs are healthy right now), swap to
  `eval value=ceil((active_hub_count*1.0/hub_count) * 100)`.
- **`rename country_iso3 AS id`** — adopt Better Map's `id`
  alias contract; `featureJoin` matches `id` against the
  `iso_a3` `promoteId` on the PMTiles country features.
- **`fields ...`** — explicit projection of the six fields
  declared in `expected_fields` frontmatter.
- **`sort - value`** — biggest-fleet countries first.
- **No `head` cap.** Maximum row count is ~250 (ISO 3166-1
  country count), well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field             | type    | example         |
|-------------------|---------|-----------------|
| id                | string  | USA             |
| country_name      | string  | United States   |
| value             | integer | 14              |
| hub_count         | integer | 14              |
| site_count        | integer | 8               |
| active_hub_count  | integer | 13              |

All six fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`. `value`
drives the choropleth shading; the other four flow through as
feature properties on the joined polygon for popups.

## 4. Recommended formatter config

```json
{
  "featureJoinUrl": "https://cdn.example.com/tilesets/world-countries.pmtiles",
  "featureJoinPromoteId": "iso_a3",
  "featureJoinSourceLayer": "countries",
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this minimal config (identical to the
[meraki/vector-tile-join](../meraki/vector-tile-join.md#4-recommended-formatter-config)
companion — the row source differs, the PMTiles join contract
does not):

- **`featureJoinUrl`** — the customer-hosted PMTiles URL. For
  air-gapped OT deployments (the typical Edge Hub case), drop
  the `.pmtiles` file into
  `better_map/appserver/static/visualizations/better_map/presets/`
  and substitute `featureJoinPreset: "<preset-name>"`. This is
  the **recommended pattern for OT engagements** — keeps the
  panel renderable without any outbound CDN fetch, which
  aligns with the typical "OT zone has no internet egress"
  baseline.
- **`featureJoinPromoteId: "iso_a3"`** — the per-feature
  property whose value matches the SPL `id` column.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from outline-only to value-shaded fill.
- **`palette: "viridis"`** — perceptually-uniform default;
  reads neutrally for a "footprint" semantic. The recipe is
  not alerting-framed — it counts hubs, not problems — so
  `viridis` is the right default. For an OUTAGE-FOCUSED view
  (highlight countries where the largest fraction of hubs is
  inactive), swap the `eval value=` line per §2 AND switch to
  `magma` for the warm-colour-equates-with-attention semantic.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by (a) deploying ≥10 Edge Hubs across
≥3 countries per the
[splunk-edge-hub skill](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/markers.md),
(b) populating the `edge_hub_inventory.csv` asset register with
matching `hub_id` → `country_iso3` rows, (c) bundling a
`world-countries.pmtiles` file from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
into the app's `presets/` folder (the air-gap-safe pattern), and
(d) pasting the SPL above into a Dashboard Studio map panel with
Better Map as the visualization + applying the §4 formatter JSON
(swapping `featureJoinUrl` for `featureJoinPreset` if running
air-gapped). The choropleth should shade countries proportional
to their Edge Hub count, with the operator's largest OT
deployments typically the darkest._

## 6. Gotchas

- **OT safety — `safety_related=true` rows are READ-ONLY
  mirrored from the customer's Safety Requirements
  Specification (SRS).** Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5, VISTA NEVER authors the SRS. This recipe consumes the
  customer-owned `edge_hub_inventory.csv` lookup verbatim — see
  the per-rule gotchas below for the granular Rule 1-8 contract
  applied to each pipeline stage.

- **OT-safety Rule 5 — the asset register is the ONLY source
  of geocoding.** Do NOT add `iplocation`, `geom`, or any
  third-party geocoder to this recipe. The hub's physical
  install country MUST come from the customer-owned
  `edge_hub_inventory.csv` lookup, which is itself a read-only
  mirror of the customer's SIS asset register per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5. Adding a second geocoding pathway introduces a
  second source of truth, which can create silent divergence
  between the SIS register and the dashboard — exactly the
  failure mode Rule 5 exists to prevent.

- **OT-safety Rule 1 — read the metadata index, never the
  payload indexes.** The recipe MUST stay on
  `index=edge_hub_metadata sourcetype="edge_hub:metadata"`.
  Querying `index=edge_hub_modbus` or `index=edge_hub_opcua`
  in a country-aggregation pattern would aggregate control-
  zone payload counts per country — operationally
  interesting, but Rule 1 mandates passive collection of
  SIS-related signals stays read-only-passive at the
  collector level, not the analytics level. A "control-zone
  payload count per country" view should be a SEPARATE
  recipe with explicit OT-engineering sign-off, NOT a casual
  variant of this footprint recipe.

- **Unregistered hubs invisibly drop.** Hubs reporting
  metadata but NOT present in the asset register are dropped
  by the `where isnotnull(country_iso3)` guard. This is a
  serious operational signal (could be an unauthorised hub
  installation) — surface it via the companion panel SPL
  documented in §2's `lookup` walkthrough. Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 8, any unregistered hub should be escalated through
  the customer's change-control procedure before its data is
  routed into production dashboards.

- **Stale asset-register rows.** If `edge_hub_inventory.csv`
  carries decommissioned hubs (kept for historical search
  per the OT-safety read-only-mirror contract), the recipe's
  24 h window correctly excludes them (a decommissioned hub
  has no metadata events in the last 24 h, so the `dedup`
  drops it). If the dashboard panel shows fewer hubs per
  country than the asset register suggests, that's the
  expected behaviour — the panel surfaces ACTIVE hubs only.
  For a "asset-register coverage" panel that shows ALL hubs
  including decommissioned, query the lookup directly:
  ```spl
  | inputlookup edge_hub_inventory
  | stats count AS registered_hubs BY country_iso3
  ```
  and render as a SEPARATE panel labelled "Asset register
  coverage" to distinguish from the live-fleet view.

- **`country_iso3` must be ISO 3166-1 alpha-3 in the asset
  register.** The recipe joins on `country_iso3` AS the
  `id` field, which the PMTiles `promoteId: "iso_a3"` matches
  against. If the asset register carries
  `country_iso2` (Cisco / Meraki convention) or a country
  name string, the join will return zero rows. Maintain the
  asset register with the alpha-3 code OR add a normalisation
  step:
  ```spl
  | lookup edge_hub_inventory hub_id OUTPUT country
  | lookup iso_country_codes country_iso2 AS country OUTPUT iso_a3 AS country_iso3
  ```

- **Customers with single-country OT footprints.** For an
  operator with all plants in one country (e.g., a regional
  utility), the world-countries choropleth shows 1 coloured
  country + 245 grey — visually misleading. Such operators
  should use the per-region CSV-driven pattern from
  [csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
  (region_metrics CSV → vector-tile join → choropleth, swap the
  CSV's key column for a finer subdivision such as IEC 62443
  zone-and-conduit IDs), or the
  [ot-datastreamer/markers](./markers.md) per-hub view at
  building zoom.

- **OT-safety Rule 3 (SOAR scope ends at IT/OT DMZ) applies
  to drilldowns.** If this recipe is used in a dashboard that
  routes panel clicks into a SOAR playbook (e.g., "click a
  country to launch a SOAR investigation against its hubs"),
  the playbook target zone MUST stay in the IT or IT/OT DMZ
  per Rule 3 — SOAR must NOT take containment actions
  against Level 0/1/2 OT assets. Configure the drilldown to
  open a Splunk Investigation, NOT a SOAR containment
  playbook.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, follows the proven `edge_hub:metadata` schema from the
[splunk-edge-hub skill](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/markers.md),
respects OT-safety Rules 1, 2, 4, 5, 8 by relying exclusively on
the customer-owned asset register for geocoding, and uses only
Splunk built-ins (`dedup`, `eval`, `lookup`, `stats`, `where`,
`rename`, `fields`, `sort`). The PMTiles fetch + choropleth fill
behaviour is covered by Better Map's own `featureJoin` module
unit tests. The end-to-end "this recipe's SPL against a real
multi-country Edge Hub deployment + a populated
`edge_hub_inventory.csv` asset register + a bundled
`world-countries.pmtiles` preset renders a per-country choropleth
in a Splunk Dashboard Studio panel" path has not been dispatched
against the v1.7-prep lab tenant in this PR because the lab
tenant carries only a single-country (US) Edge Hub deployment. A
maintainer with a multi-country OT operator engagement should
follow the verification steps in the
[meraki/vector-tile-join §Verification status](../meraki/vector-tile-join.md#verification-status)
(substituting the Edge Hub SPL for the Meraki SPL, and the
`edge_hub_inventory.csv` lookup for the `iso_country_codes`
lookup), get OT-engineering sign-off per Rule 6, then promote
to `status: verified` + fill in `verified_against` in a
follow-up PR.
