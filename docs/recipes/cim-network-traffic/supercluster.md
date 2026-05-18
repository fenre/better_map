---
schema_version: 1
id: cim-network-traffic--supercluster
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic"
  pattern: splunk-cim
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: Splunk_SA_CIM
    optional: false
expected_fields:
  - name: id
    type: string
    example: "203.0.113.42"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: dest_country
    type: string
    example: "US"
  - name: dest_city
    type: string
    example: "San Francisco"
  - name: bytes
    type: number
    example: "1048576"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source family, individual-marker layer"
    path: "docs/recipes/cim-network-traffic/markers.md"
  - description: "Companion recipe — same source family, aggregate H3 hex layer"
    path: "docs/recipes/cim-network-traffic/h3.md"
  - description: "Companion recipe — same supercluster layer over CSV data"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Splunk CIM skill — Network Traffic data model"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — supercluster (Cluster layer, supercluster-backed)"
    path: "docs/reference/layers.md"
  - description: "Cluster layer source (supercluster index, MapLibre cluster: true)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js"
---

# CIM Network Traffic — supercluster

The **high-cardinality drilldown** companion to the
[cim-network-traffic/markers](./markers.md) and
[cim-network-traffic/h3](./h3.md) recipes. Same CIM-accelerated
`Network_Traffic` data model query and same `iplocation`
enrichment, but the panel ships with the **supercluster-backed
cluster renderer** instead of individual markers — the right
layer when the volume of unique remote IPs in your `dest_ip`
distribution exceeds ~500 (typical for any internet-facing
firewall or proxy). Compared to the existing `h3` recipe, the
supercluster layer **preserves per-IP drilldown affordance**
that hexbin collapses; compared to the existing `markers`
recipe, it **stays performant at 10k+ unique destinations**
where individual markers visually collapse into illegible "dot
soup."

## 1. Source description

Any data routed into the **`Network_Traffic`** CIM data model
— Cisco ASA / FTD, Palo Alto, Fortinet, Check Point, OPNsense,
AWS VPC Flow Logs (via the AWS TA), zScaler, Cloudflare, or
any other vendor app that maps to the
[CIM Network Traffic schema](https://docs.splunk.com/Documentation/CIM/latest/User/NetworkTraffic).
This recipe queries the data model directly via `tstats` for
acceleration; pre-acceleration `stats`-on-raw alternatives are
available — see `cim-network-traffic/markers` §6 for the
fallback path.

**Typical sourcetype / index:** depends on the source vendor.
`cisco:asa`, `pan:traffic`, `aws:cloudwatchlogs:vpcflow`,
`zscaler:nss`, etc. The data model abstracts these — `tstats`
returns the same field shape regardless of the underlying
source. The recipe is `dest_ip`-centric (i.e. external
destinations as seen from your perimeter).

## 2. SPL recipe

```spl
| tstats summariesonly=true
    sum(All_Traffic.bytes) AS bytes,
    sum(All_Traffic.packets) AS packets,
    count AS event_count
  FROM datamodel=Network_Traffic.All_Traffic
  WHERE earliest=$global_time.earliest$ latest=$global_time.latest$
    AND nodename=All_Traffic
    AND All_Traffic.action="allowed"
  BY All_Traffic.dest_ip
| rename All_Traffic.dest_ip AS dest_ip
| where isnotnull(dest_ip) AND NOT cidrmatch("10.0.0.0/8", dest_ip)
    AND NOT cidrmatch("172.16.0.0/12", dest_ip)
    AND NOT cidrmatch("192.168.0.0/16", dest_ip)
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| rename dest_ip AS id, Country AS dest_country, City AS dest_city
| fields id, lat, lon, dest_country, dest_city, bytes, packets, event_count
| sort - bytes
| head 10000
```

Why this exact shape:

- **`| tstats summariesonly=true … FROM datamodel=Network_Traffic.All_Traffic`**
  — accelerated CIM query, orders of magnitude faster than
  `stats`-on-raw. Requires the `Network_Traffic` data model
  to be accelerated in your tenant (Settings → Data models →
  Network_Traffic → Acceleration: enabled). `summariesonly=true`
  is the contract — without it `tstats` falls back to raw scan
  on un-summarised time windows. Set to `false` only during
  acceleration backfill.
- **`AND All_Traffic.action="allowed"`** — filter to permitted
  traffic only. Denied / blocked flows are still useful
  (security panel, threat-hunting) but mix two different
  semantic populations on the same map; a separate "blocked"
  panel is the cleaner architecture.
- **`BY All_Traffic.dest_ip`** — aggregate per destination IP
  so each row becomes one map point. Repeat-connection volume
  rolls into `bytes`, `packets`, `event_count`.
- **`| where isnotnull(dest_ip) AND NOT cidrmatch(…)`** — drop
  RFC1918 private space. Private IPs do not geolocate (no
  routable assignment) and `iplocation` returns null lat/lon
  for them anyway; explicit filtering is faster than the
  later `isnotnull(lat)` drop and keeps the popup data clean.
  Add a `cidrmatch("100.64.0.0/10", …)` clause to your filter
  if you carry CGNAT traffic.
- **`| iplocation dest_ip`** — geolocate via MaxMind's bundled
  Splunk GeoIP database. Adds `Country`, `City`, `Region`,
  `lat`, `lon`, `Continent` columns; the recipe only keeps
  the four it needs.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — defensive
  second pass for any rows the RFC1918 filter missed (TOR
  exit nodes, certain VPN ranges, very-recently-allocated
  IPv4 blocks). Drop instead of fall back to `(0, 0)` —
  Atlantic-Ocean dots are visual noise.
- **`| rename dest_ip AS id, Country AS dest_country, City AS dest_city`**
  — adopt Better Map's `id` alias (drives per-IP drilldown
  when the cluster expands to individuals) and namespace the
  geographic context with `dest_` so a future "src ↔ dest"
  comparison panel does not collide.
- **`| fields id, lat, lon, dest_country, dest_city, bytes, packets, event_count`**
  — explicit projection. The data model carries 60+ fields;
  the cluster renderer only needs the seven.
- **`| sort - bytes`** — most-traffic-first for cluster
  expansion priority. Inside a cluster the first marker
  rendered (and the one whose popup appears on a single-
  cluster click) is the largest destination by volume.
- **`| head 10000`** — defensive cap. The cluster renderer
  scales to ~250k features per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md);
  10k is the comfortable ceiling for a mid-sized enterprise
  perimeter over a 24h window. Raise to 50k for global SOC
  panels with hour-long lookbacks; raise to 100k+ only after
  testing performance on the target browser fleet.

## 3. Expected fields

| field        | type   | example         |
|--------------|--------|-----------------|
| id           | string | 203.0.113.42    |
| lat          | number | 37.7749         |
| lon          | number | -122.4194       |
| dest_country | string | US              |
| dest_city    | string | San Francisco   |
| bytes        | number | 1048576         |

`packets` and `event_count` are also produced by the SPL and
flow through as feature properties (popup fields once a cluster
expands to an individual marker); they are not declared in
`expected_fields` because Better Map's contract treats them
as optional popup metadata, not core layer inputs.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — explicit pin to the cluster
  renderer (the supercluster-backed strategy per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md)).
  The default `pointRenderer: "auto"` would already switch
  to cluster at 200+ features and to heatmap at 10000+; pinning
  to `cluster` preserves the per-IP drilldown affordance
  heatmap loses, regardless of the rolling feature count
  (which fluctuates panel-to-panel as the time-range token
  changes).
- **`id` carries through automatically** because the SPL
  renamed `dest_ip AS id` — single-marker popups (after
  cluster expansion) show the destination IP as the popup
  title.
- **`dest_country`, `dest_city`, `bytes`, `packets`, and
  `event_count` flow through as feature properties** —
  reference them by name in custom popup templates (a
  `dashboardInputs` token can drive a separate "destination
  details" panel keyed on `dest_ip`).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The cluster renderer is best demoed at country-level zoom
showing several large clusters over major cloud-provider hubs
(US-East: AWS, US-West: GCP, EU-West: Azure), then zoom into one
cluster to demonstrate per-IP expansion. A maintainer can
reproduce by pasting the SPL into a Dashboard Studio map panel
with Better Map as the visualization, applying the formatter JSON
in §4, setting the time-range token to `-24h@h,now`, and scroll-
zooming the panel from continent to street level._

## 6. Gotchas

- **Acceleration requirement.** `summariesonly=true` returns
  zero rows if the `Network_Traffic` data model is not
  accelerated. Verify with:
  ```spl
  | rest /services/data/models
  | search title="Network_Traffic"
  | table title, acceleration.enabled, acceleration.cron_schedule
  ```
  If acceleration is disabled, either enable it (Settings →
  Data models → Network_Traffic) or change `summariesonly=true`
  to `summariesonly=false` in the recipe — but expect 10-100x
  slower dispatch on the SPL.
- **Cluster vs heatmap vs hexbin — which to pick for
  network-traffic data.** Three high-cardinality strategies,
  three answers:

  | Layer | Best for | Loses |
  |---|---|---|
  | `cluster` (this recipe) | "Which destinations are talked to AND let me drill into each one to see bytes / packets" | Continuous density signal at intermediate zoom |
  | `heatmap` | "Show me the global egress pressure landscape" | Per-destination identity (cannot click a heatmap blob) |
  | `hexbin` (see [cim-network-traffic/h3](./h3.md)) | "Area-neutral density per geographic cell with stable bin boundaries for week-over-week comparison" | Per-destination identity and finer geographic precision |

  All three coexist in the same dashboard via Better Map's
  BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
  `reset`) toggled from dashboard inputs.

- **Geolocation precision is country-level, not host-level.**
  MaxMind's free GeoLite2 database (which Splunk's bundled
  `iplocation` lookup wraps) is high-quality at the country
  level (≥ 99.8%) and city level (≥ 80% for the US, lower
  for many other regions); but cluster markers will appear
  at the **centroid of the assigned city polygon**, NOT at
  the actual server location. A "Seattle" cluster may sit
  on the city centre even though the actual server is in
  the Bothell data centre 25 km north. For perimeter-traffic
  geographic summaries this is acceptable; for incident-
  response per-host pivoting, use the destination IP from
  the popup as the drilldown key (not the lat/lon).
- **CDN destinations smear across POPs.** A single
  Cloudflare destination IP (e.g. `1.1.1.1`) may rapidly
  shift between MaxMind-assigned cities as the underlying
  anycast announcement changes — clusters near the same
  CDN provider can visually "fluctuate" between adjacent
  cities across re-renders. Stabilise with `eval
  dest_ip_24h_bucket=substr(dest_ip,1,N)` aggregation if
  the dashboard's purpose is "where is CDN traffic going"
  rather than "which specific destinations are we talking
  to."
- **CGNAT and IPv6 considerations.** `cidrmatch` filters in
  the recipe handle IPv4 RFC1918 only. For tenants with
  significant IPv6 traffic, add an IPv6 fast-path:
  ```spl
  | where match(dest_ip, "^[0-9a-f]+:[0-9a-f]")
      OR (NOT cidrmatch("10.0.0.0/8", dest_ip)
          AND NOT cidrmatch("172.16.0.0/12", dest_ip)
          AND NOT cidrmatch("192.168.0.0/16", dest_ip)
          AND NOT cidrmatch("100.64.0.0/10", dest_ip))
  ```
  `iplocation` supports IPv6 in Splunk 8+ but the MaxMind
  IPv6 coverage is less complete than IPv4.
- **Cluster radius / max-zoom tuning (current limitation).**
  As documented in the
  [csv-lookup-geo/supercluster sibling](../csv-lookup-geo/supercluster.md#6-gotchas)
  recipe, `clusterMaxZoom` (default 14) and `clusterRadius`
  (default 48) are **hardcoded** in the
  [clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js)
  and not yet formatter-exposed. For perimeter-traffic data
  the defaults give comfortable visual behaviour; a global
  SOC panel with both Tokyo and Seoul destinations may
  benefit from a smaller `clusterRadius` (28-32) to keep
  the two cities visually distinct at country-level zoom.
  Tracked v1.8+ enhancement.
- **GDPR / data-residency posture.** External destination
  IPs ARE technically personal data under GDPR Recital 30
  when correlated with a subscriber identity. For pure
  network-traffic dashboards (no subscriber correlation),
  the panel falls outside individual-identity scope. If
  the dashboard ALSO joins to authentication or user data,
  apply the same masking / role-based access pattern
  documented in
  [cim-authentication/heat §6 Gotchas](../cim-authentication/heat.md#6-gotchas).
- **No OT safety dependency.** This recipe queries the IT
  CIM Network_Traffic data model — perimeter, cloud, and
  enterprise-internal traffic. For OT-network observability
  use the
  [ot-datastreamer/markers recipe](../ot-datastreamer/markers.md)
  or
  [cyber-vision/markers](../cyber-vision/markers.md) which
  are explicitly OT-zone aware. If your `Network_Traffic`
  data model ingests via an OT-zone SPAN/TAP (passive
  collection per `ot-safety.mdc` Rule 1, which IS valid),
  the visualisation is still render-only — no SOAR write-
  back may target a Level-0/1/2 destination from this
  panel, per Rule 3.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented CIM tstats and
SPL contracts, and only references Splunk built-ins +
`Splunk_SA_CIM` (which is bundled with Splunk Enterprise
and Splunk Cloud). The formatter options (`pointRenderer:
cluster`, `idField`) are all present in
`docs/_machine/formatter-schema.json` and cross-checked by
`scripts/check-formatter-coverage.py`. The recipe has not
been dispatched against a real `Network_Traffic`-accelerated
tenant in the v1.7-prep development cycle (the lab tenant
has CIM_NETWORK_TRAFFIC acceleration disabled). A maintainer
with write access to a Splunk tenant with the
`Network_Traffic` data model accelerated should:

1. Confirm acceleration is enabled
   (`| rest /services/data/models | search title=Network_Traffic`)
   and the latest summary completed recently.
2. Run the panel SPL with `earliest=-24h@h, latest=now` (the
   Studio token `$global_time.*$` resolves to these at runtime)
   and confirm at least 500 rows return with the six documented
   fields.
3. Apply the formatter JSON in §4 to a Dashboard Studio map
   panel; zoom in and out; confirm clusters collapse / expand
   at the `clusterMaxZoom` boundary; confirm individual marker
   popups fire on point click and show `id` (the destination
   IP) as the popup title plus `dest_country`, `dest_city`,
   `bytes`, `packets`, `event_count` as popup fields.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 9.4 against
   Cisco ASA traffic, 7-day accelerated dataset, ~12k unique
   destinations"), and submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change
   without touching the schema.
