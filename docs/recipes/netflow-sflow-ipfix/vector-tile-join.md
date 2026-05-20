---
schema_version: 1
id: netflow-sflow-ipfix--vector-tile-join
source:
  id: netflow-sflow-ipfix
  display_name: "NetFlow / sFlow / IPFIX (flow records)"
  pattern: splunk-vendor-ta
layer:
  id: vector-tile-join
  display_name: Vector-tile join (customer PMTiles)
status: unverified
last_verified_iso8601: "2026-05-29"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_netflow"
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
    type: number
    example: "184320000000"
  - name: total_bytes
    type: number
    example: "184320000000"
  - name: flow_count
    type: integer
    example: "8472913"
  - name: peer_count
    type: integer
    example: "4112"
required_formatter_options:
  - featureJoinUrl
  - featureJoinPromoteId
  - featureJoinSourceLayer
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, H3 hex layer (point-level density)"
    path: "docs/recipes/netflow-sflow-ipfix/h3.md"
  - description: "Companion recipe — same source, heatmap layer (smoothed continuous density)"
    path: "docs/recipes/netflow-sflow-ipfix/heat.md"
  - description: "Companion recipe — same source, markers layer (per-destination drilldown)"
    path: "docs/recipes/netflow-sflow-ipfix/markers.md"
  - description: "Companion recipe — same source, paths layer (top-talker great-circle arcs)"
    path: "docs/recipes/netflow-sflow-ipfix/paths.md"
  - description: "Companion recipe — same source, supercluster layer (zoom-adaptive)"
    path: "docs/recipes/netflow-sflow-ipfix/supercluster.md"
  - description: "Pattern reference — vector-tile-join via iplocation publicIp / src_ip / dest_ip + world-countries PMTiles (cim-network-traffic)"
    path: "docs/recipes/cim-network-traffic/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with vendor-TA inventory source (Cisco Meraki publicIp)"
    path: "docs/recipes/meraki/vector-tile-join.md"
  - description: "Pattern reference — vector-tile-join with synthetic-test fleet (ThousandEyes agent_ip)"
    path: "docs/recipes/thousandeyes/vector-tile-join.md"
  - description: "Splunk Network Explorer skill — flow-data collection patterns and field contracts"
    path: "~/.cursor/skills/splunk-network-explorer/SKILL.md"
  - description: "Layer reference — feature join (custom PMTiles backdrop)"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer source (promoteId + source-layer + URL contract)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# NetFlow / sFlow / IPFIX — vector-tile join (customer PMTiles)

Aggregate observed network-flow bytes by destination country and
render against a **customer-hosted world-countries PMTiles vector
tileset**. The right shape for **global egress / ingress geography**
panels — "of the petabytes our network moved this week, which
countries received them?" — the standard executive view for capacity
planning, regional-cost allocation, and data-sovereignty / GDPR
audit reviews.

The **6th vector-tile-join recipe in the matrix** (joining
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
[csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md),
[kvstore-latlon/vector-tile-join](../kvstore-latlon/vector-tile-join.md),
[thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md),
and [meraki/vector-tile-join](../meraki/vector-tile-join.md)) — and
the **FIRST flow-data VTJ recipe**, where the metric being shaded is
**observed byte volume** rather than device inventory
(meraki / thousandeyes) or per-event-aggregation
(cim-network-traffic). This advances the vector-tile-join layer
column from 6 cells to 7, and brings the netflow-sflow-ipfix source
row from 5 cells to 6 (markers, heat, h3, supercluster, paths, plus
vector-tile-join now).

## 1. Source description

Same **NetFlow / sFlow / IPFIX flow-record** source as the
[markers](./markers.md), [heat](./heat.md), [h3](./h3.md),
[supercluster](./supercluster.md), and [paths](./paths.md)
companions — see
[netflow-sflow-ipfix/heat §1](./heat.md#1-source-description) for
the full Splunk_TA_netflow / nfacctd / sflowtool collection
background and the per-flow `src_ip` / `dest_ip` / `bytes` /
`packets` field contract.

The relevant distinction for THIS recipe: the panel renders
**per-country** byte aggregation rather than per-destination-IP
density (the markers / heat / h3 / supercluster companions all
attribute to individual destinations). The aggregation key is the
country derived from `iplocation dest_ip`; the metric is
`sum(bytes)` over the time window. Same pattern as the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
companion's event-source aggregation — flow records are the
wire-data equivalent of CIM Network Traffic events.

**Why vector-tile-join (world-countries) for flow data.** A NetFlow
collector typically sees the operator's entire WAN egress — every
internet-bound TCP / UDP / ICMP flow that crosses a collecting router,
totalling hundreds of millions to billions of flows per day for a
large enterprise. The [markers](./markers.md) and
[supercluster](./supercluster.md) companions show
WHERE individual destinations are; the [h3](./h3.md) and
[heat](./heat.md) companions show their density. But the
**leadership view** — "of the 47 PB we moved last quarter, where did
it go in absolute terms by country?" — is best expressed as a
country-coloured choropleth. The shaded continent map answers
capacity-planning questions ("we're sending 12 PB to AWS us-east-1
in Virginia; do we need a dedicated direct-connect lane?"),
cost-allocation questions ("which BU's egress charges are highest
this quarter, by destination country?"), and compliance questions
("how much PHI/CHD traffic is leaving the EU jurisdiction?").

The vendor-agnostic pattern: NetFlow v5/v9, sFlow v5, and IPFIX all
expose source/destination IPs in their flow records; the same SPL
shape works regardless of which exporter the network gear runs.
Customers using cloud-native flow logs (`aws:cloudwatchlogs:vpcflow`,
`azure:nsg:flow`, `gcp:vpc:flow`) get the same panel via the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
companion (those sourcetypes carry CIM tags and use the
data-model-accelerated path).

**Typical sourcetype / index:** `sourcetype="cisco:netflow"`,
`sourcetype="cisco:asa:netflow"`, `sourcetype="sflow"`, or
`sourcetype="ipfix"` — depending on the exporter and the TA. The
canonical index is `netflow` for raw flows; if your flows are
already promoted to CIM, the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
companion is the right entry point. No add-on required beyond
`Splunk_TA_netflow` (or equivalent — `Splunk_TA_sflow`,
`splunk-add-on-for-ipfix`) for parsing and Splunk's built-in
`iplocation` for country geocoding.

## 2. SPL recipe

```spl
index=netflow sourcetype="cisco:netflow" earliest=-24h latest=now
| stats sum(bytes) AS total_bytes,
    count AS flow_count,
    dc(src_ip) AS peer_count
  BY dest_ip
| iplocation dest_ip
| where isnotnull(Country) AND Country != ""
| stats sum(total_bytes) AS total_bytes,
    sum(flow_count) AS flow_count,
    sum(peer_count) AS peer_count
  BY Country
| lookup iso_country_codes country_name AS Country OUTPUT iso_a3 AS id
| where isnotnull(id) AND id != ""
| eval value=total_bytes
| rename Country AS country_name
| fields id, country_name, value, total_bytes, flow_count, peer_count
| sort - value
```

Why this exact shape, line by line:

- **`index=netflow sourcetype="cisco:netflow"`** — TA defaults,
  same as all netflow-sflow-ipfix companions. Substitute
  `sourcetype="sflow"` / `sourcetype="ipfix"` for the matching
  exporter variant.
- **`earliest=-24h latest=now`** — flow records arrive continuously;
  24 h is the standard daily-egress-summary window. Narrow to `-1h`
  for an operational NOC panel; widen to `-7d` for a weekly capacity
  review.
- **First `stats sum(bytes) ... BY dest_ip`** — server-side
  pre-aggregation per destination IP. A busy NetFlow collector
  emits millions of per-flow records per minute; running
  `iplocation` on every raw flow would burn unnecessary CPU. The
  pre-aggregation collapses 100k+ flows to <10k unique destinations,
  then `iplocation` runs on the smaller set.
- **`iplocation dest_ip`** — Splunk's bundled MaxMind GeoLite2
  lookup. No outbound network call. Populates `Country` (e.g.,
  "United States", "Germany", "Japan") plus `lat` / `lon` / `City`
  fields we don't need for country aggregation. RFC-1918 destinations
  (internal subnets) resolve to null `Country` and are filtered out
  by the next stage.
- **`where isnotnull(Country) AND Country != ""`** — drops
  RFC-1918 / CGNAT / unrouteable destinations. Without this guard
  they accumulate under a synthetic "unknown country" bucket whose
  `id` lookup fails and which renders with the unmatched-grey
  fallback fill silently — the #1 source of "why is one of my
  states-equivalent grey?" debug tickets.
- **Second `stats sum(...) BY Country`** — roll up per-IP rows
  into per-country rows. `sum(total_bytes)` is the headline metric;
  `sum(flow_count)` counts the underlying flow records (popup
  detail); `sum(peer_count)` aggregates distinct source-IP peers
  per country (useful for "how spread is our egress to country X?"
  — a country with 1 PB traffic across 4,000 source-peers is a
  bulk-transfer / CDN destination, while a country with 1 PB across
  10 source-peers is a single high-volume site-to-site transfer).
- **`lookup iso_country_codes country_name AS Country OUTPUT
  iso_a3 AS id`** — maps the MaxMind country NAME ("United States",
  "Germany") to the ISO 3166-1 alpha-3 CODE ("USA", "DEU") that the
  world-countries PMTiles tileset uses as its `promoteId` join key.
  Same lookup as the
  [cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md),
  [thousandeyes/vector-tile-join](../thousandeyes/vector-tile-join.md),
  and [meraki/vector-tile-join](../meraki/vector-tile-join.md)
  companions — see the latter's §6 for the 250-row bootstrap
  recipe and the MaxMind-name-mismatch list.
- **`where isnotnull(id) AND id != ""`** — drop countries whose
  MaxMind name doesn't resolve in the lookup (~5-10 edge cases per
  global tenant; document in the dashboard's surrounding markdown).
- **`eval value=total_bytes`** — explicit copy. The choropleth
  layer reads `value` per the formatter contract. For a
  flow-COUNT view (highlights countries with the most distinct flow
  conversations rather than absolute byte volume — useful for
  "where are we talking the most, by chattiness?"), swap to
  `eval value=flow_count`. For a peer-COUNT view (highlights
  countries with the most distinct destination IPs — useful for
  "where are we connecting to the widest variety of services?"),
  swap to `eval value=peer_count`.
- **`rename Country AS country_name`** — adopt the Better Map
  snake_case convention for popup field names.
- **`fields ...`** — explicit projection of the six fields
  declared in `expected_fields` frontmatter.
- **`sort - value`** — biggest-byte-volume countries first.
- **No `head` cap.** Max row count is ~250 (ISO 3166-1 country
  count), well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field        | type    | example         |
|--------------|---------|-----------------|
| id           | string  | USA             |
| country_name | string  | United States   |
| value        | number  | 184320000000    |
| total_bytes  | number  | 184320000000    |
| flow_count   | integer | 8472913         |
| peer_count   | integer | 4112            |

Six fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `value` drives the choropleth
shading; `total_bytes` / `flow_count` / `peer_count` flow through
as feature properties on the joined polygon for popups.

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

Why this config (identical to the
[meraki/vector-tile-join §4](../meraki/vector-tile-join.md#4-recommended-formatter-config)
and
[cim-network-traffic/vector-tile-join §4](../cim-network-traffic/vector-tile-join.md#4-recommended-formatter-config)
companions — the metric being shaded changes, the PMTiles join
contract does not):

- **`featureJoinUrl`** — the customer-hosted PMTiles URL. For
  air-gapped tenants, drop the public-domain Natural Earth
  countries tileset from
  [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
  into `better_map/appserver/static/visualizations/better_map/presets/`
  and substitute `featureJoinPreset: "<preset-name>"`.
- **`featureJoinPromoteId: "iso_a3"`** — the per-feature property
  whose value matches the SPL `id` column. Natural-Earth-derived
  country tilesets canonically use `iso_a3`. Inspect via
  `pmtiles show <file>.pmtiles`.
- **`featureJoinSourceLayer: "countries"`** — the source-layer
  name inside the tileset. Inspect via
  `pmtiles tile <file>.pmtiles 0 0 0 | jq '.layers | keys'`.
- **`enableChoropleth: "true"`** — switches rendering from
  outline-only to value-shaded fill.
- **`palette: "viridis"`** — perceptually-uniform default;
  semantically neutral (the recipe surfaces capacity / footprint,
  not severity). For an alerting-framed variant (e.g., panel
  scoped to flows matching a threat-intel destination-IP feed),
  swap to `magma` (warm-colour-equates-with-attention) to match
  the [cim-alerts/choropleth](../cim-alerts/choropleth.md)
  companion's framing.

For a **3D-extruded double-encoded view** (height = bytes, colour =
bytes — pre-attentively communicates absolute byte volume rank
even when the colour ramp saturates), add `enable3DExtrusion:
true` + `extrusionHeightField: "value"` + `extrusionScale: 0.0001`
(byte volumes are 6-12 orders of magnitude — tune the scale so
the largest prism extends ~1/3 the screen height at default camera
pitch).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by (a) configuring a Splunk_TA_netflow
input against a NetFlow / sFlow / IPFIX exporter forwarding
production flow records (a busy enterprise WAN edge router or a
cloud-flow-log aggregator), (b) bootstrapping the
`iso_country_codes` CSV lookup per the
[meraki/vector-tile-join §6 setup hint](../meraki/vector-tile-join.md#6-gotchas)
(or the
[cim-network-traffic/vector-tile-join §6 bootstrap script](../cim-network-traffic/vector-tile-join.md#6-gotchas)),
(c) hosting a `world-countries.pmtiles` file from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)
on the customer CDN (or bundling into the app for air-gap), and
(d) pasting the SPL above into a Dashboard Studio map panel with
Better Map as the visualization plus applying the §4 formatter
JSON. The choropleth should shade countries proportional to
total byte volume, with the US, AWS-region-hosting countries
(Virginia → US, Ireland → IE, Frankfurt → DE), and major CDN
endpoints (Cloudflare's San Francisco / London / Singapore POPs)
typically the darkest._

## 6. Gotchas

- **Pre-aggregation BY dest_ip is mandatory at scale.** A
  one-stage `iplocation dest_ip | stats sum(bytes) BY Country`
  pipeline works on toy data but melts in production: every
  per-flow record gets a MaxMind lookup, then the stats blows up
  the search head's memory budget aggregating 100M rows. The
  two-stage shape (pre-aggregate BY `dest_ip`, then `iplocation`,
  then re-aggregate BY `Country`) keeps the `iplocation` cardinality
  at "distinct public destination IPs" (~tens-of-thousands), not
  "flow records" (~hundreds-of-millions). For very-large tenants
  even the pre-aggregated `dest_ip` cardinality is too high — see
  the next bullet.

- **For very-large tenants, summary indexing is mandatory.** A
  global enterprise's WAN edge can see 1M+ distinct destination
  IPs per hour. Even the pre-aggregated SPL runs 10-60 seconds on
  the search head. The right pattern: schedule a saved-search
  that runs the per-country aggregation every 15 minutes via
  `| stats sum(total_bytes) AS total_bytes ... BY Country |
  outputlookup country_egress_summary.csv` (or
  `| collect index=summary_netflow_country`), then point the
  dashboard panel at the lookup / summary index. Sub-second
  panel refresh, same data. The
  [csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md)
  companion shows the lookup-source pattern (point the panel at
  a CSV lookup that a separate saved-search refreshes).

- **`src_ip` vs `dest_ip` choice frames the question.** This
  recipe aggregates by destination — "where is our egress going?"
  Substitute `iplocation src_ip` (and adjust the pre-aggregation
  BY clause) for the inbound view — "where are our public-facing
  services being accessed from?" A SaaS vendor sees its egress
  panel as "what cloud regions are we delivering content to?"
  and its ingress panel as "where are our customers globally?"
  Both panels usually ship as side-by-side panels in the same
  dashboard.

- **NAT egress collapses src-side attribution.** When the flow
  collector sits INSIDE the customer's NAT boundary (the typical
  enterprise edge-router placement), source-IP attribution
  reflects per-host inside-NAT IPs (RFC-1918), not public-Internet
  identities. The `src_ip` variant of this recipe ONLY makes sense
  when the collector sees pre-NAT public addresses — i.e.,
  collector deployed at an upstream ISP / cloud-provider hop, or
  inbound traffic from the public Internet to a public-facing
  service IP. For inside-NAT internal-egress views, stick with
  the `dest_ip` recipe shape and accept that source-side
  attribution is "this customer's NAT block" not "individual
  end-user IPs".

- **Cloud regions concentrate egress in their home countries.**
  A typical SaaS customer's `dest_ip` egress concentrates in
  Virginia (AWS us-east-1 → United States), Ireland (AWS eu-west-1
  → Ireland), and Singapore (AWS ap-southeast-1 → Singapore).
  The choropleth shades the COUNTRIES of cloud regions, NOT the
  countries of the cloud-region's customers. To disaggregate
  "egress to AWS that's ultimately serving EU customers" from
  "egress to AWS that's ultimately serving US customers" the
  flow record alone is insufficient — you need a higher-layer
  signal (HTTP `Host:` header, TLS SNI, application-level
  customer ID). The choropleth shows the FIRST-HOP destination
  geography; downstream forwarding is invisible.

- **The remaining iso_country_codes / MaxMind-mismatch /
  PMTiles + customer-hosted-CDN / `featureJoinPreset` air-gap
  gotchas are identical to the
  [cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas)
  and the
  [meraki/vector-tile-join companion §6](../meraki/vector-tile-join.md#6-gotchas).**
  Specifically: `iso_country_codes` lookup is required and not
  bundled (one-time 250-row CSV bootstrap from Natural Earth);
  MaxMind name ≠ Natural Earth name for ~20 countries (canonical
  list in the cim-network-traffic gotchas); HTTP Range request
  support test (`curl -I -H "Range: bytes=0-1023"` must return
  `206 Partial Content`); Splunk Cloud CSP `connect-src 'self'`
  cross-origin gotcha; case-sensitivity of
  `featureJoinPromoteId`; unmatched-grey fallback semantics;
  `featureJoinPreset` air-gap alternative. Read those companions'
  §6 once; the contract is fully shared.

- **MAUP — country area amplifies large-country bias.** Same
  caveat as the
  [cim-network-traffic/vector-tile-join companion §6](../cim-network-traffic/vector-tile-join.md#6-gotchas):
  Russia is the largest country but rarely the largest egress
  destination; small high-traffic countries (Singapore,
  Netherlands, Ireland — major cloud-region hosts) shade
  visually small even when they carry petabytes of egress.
  Document the caveat in the dashboard's surrounding markdown,
  OR shift to the [h3 companion](./h3.md) with `hexbinResolution:
  2-3` for area-neutral aggregation at continental scales.

- **No OT-safety dependency.** Same posture as all
  netflow-sflow-ipfix companions: NetFlow / sFlow / IPFIX flow
  records are IT-network telemetry from routers / switches /
  firewalls. No OT carve-out applies — these collectors do not
  observe Level-0/1/2 OT-zone traffic by design (OT zones
  typically have their own air-gapped network with no IT-side
  flow collector).

## Verification status

`status: unverified` in the frontmatter — the SPL uses only Splunk
built-ins (`stats`, `iplocation`, `lookup`, `eval`, `where`,
`rename`, `fields`, `sort`) plus the customer-owned
`iso_country_codes` CSV lookup. The PMTiles fetch + join behaviour
is covered by Better Map's own `featureJoin` module unit tests
plus the production lab dispatch in the
[cim-network-traffic/vector-tile-join](../cim-network-traffic/vector-tile-join.md)
companion that uses the same join contract. The end-to-end "this
recipe's NetFlow SPL + a real customer PMTiles tileset + the
iso_country_codes lookup renders a per-country choropleth in a
Splunk Dashboard Studio panel" path has not been dispatched
against the v1.7-prep lab tenant in this PR because (a)
non-interactive admin auth is not present in the agent workspace,
(b) the lab tenant does not carry NetFlow ingest configured, and
(c) the lab tenant does not carry a registered world-countries
PMTiles URL. A maintainer with REST auth, a NetFlow exporter, and
a small custom PMTiles file should follow the verification steps
in the
[cim-network-traffic/vector-tile-join companion](../cim-network-traffic/vector-tile-join.md#verification-status)
(substituting this recipe's §2 SPL for the CIM-source SPL).
