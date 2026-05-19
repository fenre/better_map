---
schema_version: 1
id: netflow-sflow-ipfix--paths
source:
  id: netflow-sflow-ipfix
  display_name: "NetFlow / sFlow / IPFIX (flow records)"
  pattern: splunk-vendor-ta
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: Splunk_TA_netflow
    optional: false
  - id: builtin:iplocation
    optional: false
expected_fields:
  - name: id
    type: string
    example: "203.0.113.45-198.51.100.7"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: src_ip
    type: string
    example: "203.0.113.45"
  - name: dest_ip
    type: string
    example: "198.51.100.7"
  - name: bytes
    type: number
    example: "184320000"
  - name: top_protocol
    type: string
    example: "tcp/443"
  - name: src_country
    type: string
    example: "US"
  - name: dest_country
    type: string
    example: "NL"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-destination drilldown)"
    path: "docs/recipes/netflow-sflow-ipfix/markers.md"
  - description: "Companion recipe — same source, H3 hexbin layer (per-cell roll-up)"
    path: "docs/recipes/netflow-sflow-ipfix/h3.md"
  - description: "Companion recipe — same source, heatmap layer (smoothed concentration)"
    path: "docs/recipes/netflow-sflow-ipfix/heat.md"
  - description: "Pattern reference — paths layer with iplocation src/dest endpoint pairs"
    path: "docs/recipes/cim-network-traffic/paths.md"
  - description: "Pattern reference — paths layer with append-branch endpoint vertex pattern"
    path: "docs/recipes/cyber-vision/paths.md"
  - description: "Splunk Network Explorer skill — NetFlow / sFlow / IPFIX collection patterns"
    path: "~/.cursor/skills/splunk-network-explorer/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# NetFlow / sFlow / IPFIX — paths

Render **top-talker flow polylines** by aggregating NetFlow / sFlow
/ IPFIX flow records per (src_ip, dest_ip, protocol) tuple, geocoding
BOTH endpoints via `iplocation`, and drawing one polyline per top
conversation. The canonical "NetOps top-talker overlay" panel —
when a NetOps analyst sees an 800 GB destination in the markers
companion, the paths panel shows them WHICH SOURCES are hitting
that destination (and from which countries). The sister panel to
[netflow-sflow-ipfix/markers](../netflow-sflow-ipfix/markers.md)
(per-destination volume), [netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md)
(smoothed-density), and [netflow-sflow-ipfix/h3](../netflow-sflow-ipfix/h3.md)
(per-cell roll-up) — together the four shapes give a NetOps team
target-, density-, jurisdiction-, AND flow-attribution views on
one NetFlow data source.

## 1. Source description

Same NetFlow / sFlow / IPFIX flow-record stream as the
[markers](../netflow-sflow-ipfix/markers.md),
[h3](../netflow-sflow-ipfix/h3.md), and
[heat](../netflow-sflow-ipfix/heat.md) companions — vendor-agnostic
at the flow-record layer because all three protocols encode the
same `(src_ip, dst_ip, sport, dport, protocol, bytes, packets)`
tuple. See the markers recipe §1 for the full sourcetype matrix
and collection-method discussion.

This recipe is the **flow-attribution view**: it aggregates per
unique (src_ip, dest_ip, protocol) tuple over a 1-hour window,
filters to bidirectional volumes above a meaningful threshold,
geocodes both endpoints, and emits two rows per conversation
(seq=0 for source, seq=1 for destination). The paths layer draws
one polyline per (src, dest) pair — the geometric equivalent of
"draw me the actual conversations happening on my network".

**Typical sourcetype / index:** `sourcetype="cisco:netflow"` /
`index=netflow`. Replace with vendor-specific sourcetypes as
documented in
[netflow-sflow-ipfix/markers](../netflow-sflow-ipfix/markers.md) §1.

## 2. SPL recipe

```spl
index=netflow sourcetype="cisco:netflow" earliest=-1h latest=now
| stats sum(bytes) AS bytes,
    sum(packets) AS packets,
    values(protocol) AS protocols,
    values(dest_port) AS dest_ports,
    min(_time) AS first_seen
  BY src_ip, dest_ip
| where bytes >= 10485760
| iplocation src_ip prefix=src_
| iplocation dest_ip
| where isnotnull(src_lat) AND isnotnull(src_lon)
    AND isnotnull(lat) AND isnotnull(lon)
| eval top_protocol=case(
    mvfind(protocols, "tcp") >= 0 AND mvfind(dest_ports, "443") >= 0, "tcp/443",
    mvfind(protocols, "tcp") >= 0 AND mvfind(dest_ports, "80") >= 0, "tcp/80",
    mvfind(protocols, "udp") >= 0 AND mvfind(dest_ports, "443") >= 0, "udp/443",
    mvfind(protocols, "tcp") >= 0, "tcp/other",
    mvfind(protocols, "udp") >= 0, "udp/other",
    true(), "other")
| eval flow_id=src_ip . "-" . dest_ip
| eval src_country=src_Country, dest_country=Country
| eval lat_src=src_lat, lon_src=src_lon
| eval lat_dest=lat, lon_dest=lon
| eval lat=lat_src, lon=lon_src, seq=0
| append [
    search index=netflow sourcetype="cisco:netflow" earliest=-1h latest=now
    | stats sum(bytes) AS bytes,
        sum(packets) AS packets,
        values(protocol) AS protocols,
        values(dest_port) AS dest_ports
      BY src_ip, dest_ip
    | where bytes >= 10485760
    | iplocation src_ip prefix=src_
    | iplocation dest_ip
    | where isnotnull(src_lat) AND isnotnull(src_lon)
        AND isnotnull(lat) AND isnotnull(lon)
    | eval top_protocol=case(
        mvfind(protocols, "tcp") >= 0 AND mvfind(dest_ports, "443") >= 0, "tcp/443",
        mvfind(protocols, "tcp") >= 0 AND mvfind(dest_ports, "80") >= 0, "tcp/80",
        mvfind(protocols, "udp") >= 0 AND mvfind(dest_ports, "443") >= 0, "udp/443",
        mvfind(protocols, "tcp") >= 0, "tcp/other",
        mvfind(protocols, "udp") >= 0, "udp/other",
        true(), "other")
    | eval flow_id=src_ip . "-" . dest_ip
    | eval src_country=src_Country, dest_country=Country
    | eval seq=1
  ]
| rename flow_id AS id
| fields id, seq, lat, lon, src_ip, dest_ip, bytes, top_protocol, src_country, dest_country
| sort id, + seq
| head 2000
```

Why this exact shape, line by line:

- **`stats sum(bytes) ... BY src_ip, dest_ip`** — aggregate per
  unique source-destination pair. The 1-hour window keeps the
  cardinality bounded; multiplied by the volume threshold below,
  this yields the "top conversations" set.
- **`where bytes >= 10485760`** — 10 MB minimum threshold. Drops
  noise traffic (DNS queries, NTP sync, ARP discovery, …) and
  keeps the panel focused on conversations worth visualising.
  Adjust for your environment — for a busy enterprise edge bump
  to 100 MB; for a small branch drop to 1 MB.
- **`iplocation src_ip prefix=src_`** + **`iplocation dest_ip`** —
  geocode both endpoints. The `prefix=src_` parameter writes
  `src_lat`, `src_lon`, `src_Country` (etc.) so the destination
  fields (`lat`, `lon`, `Country`) don't collide. The destination
  geo is left unprefixed because the paths-layer auto-binding
  prefers `lat`/`lon` for the primary vertex coordinates.
- **First branch (seq=0 = source vertex)** — `eval lat=lat_src,
  lon=lon_src, seq=0` writes the source endpoint as the first
  vertex of the polyline.
- **`append` branch (seq=1 = destination vertex)** — re-runs the
  full aggregation + iplocation pipeline and emits the destination
  as the second vertex. Same canonical `append`-branch pattern
  as
  [`cyber-vision/paths`](../cyber-vision/paths.md) (the
  pattern reference for endpoint-pair polylines).
- **`rename flow_id AS id`** + **`sort id, + seq`** — adopt
  Better Map's `id` alias and lock per-flow vertex ordering.
- **`head 2000`** — render-cap matching the markers companion.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example                            |
|---------------|---------|------------------------------------|
| id            | string  | 203.0.113.45-198.51.100.7          |
| seq           | integer | 0                                  |
| lat           | number  | 37.7749                            |
| lon           | number  | -122.4194                          |
| src_ip        | string  | 203.0.113.45                       |
| dest_ip       | string  | 198.51.100.7                       |
| bytes         | number  | 184320000                          |
| top_protocol  | string  | tcp/443                            |
| src_country   | string  | US                                 |
| dest_country  | string  | NL                                 |

All ten fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#2ca02c",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit. Same alignment as
  [cyber-vision/paths](../cyber-vision/paths.md) and
  [cim-alerts/paths](../cim-alerts/paths.md).
- **`timeField: "seq"`** — monotonic vertex ordering (0 for
  source, 1 for destination) from the two-branch SPL.
- **`pathColor: "#2ca02c"`** — Tableau muted-green. NetFlow
  paths are NetOps-infrastructure traffic, not threat / alert
  signals — green reads cleanly against urban + ocean base maps
  without the "warning" connotation of red. For
  bidirectional-flow comparison panels (egress vs ingress), use
  two separate Better Map layers with `#2ca02c` for egress and
  `#1f77b4` (blue) for ingress.
- **`pathArrows: true`** — render direction-of-travel chevrons.
  The arrows show "src → dest" direction at a glance — essential
  for distinguishing inbound from outbound on the same panel.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic NetFlow corpus seeded with geographically-
distributed source / destination pairs for path stability._

## 6. Gotchas

- **Both endpoints must geocode.** The `where isnotnull(src_lat)
  AND isnotnull(src_lon) AND isnotnull(lat) AND isnotnull(lon)`
  filter drops rows where either side is private-IP / RFC 1918 /
  cannot be resolved. For internal-to-internal flows (e.g.,
  data-centre east-west traffic), this recipe drops every row —
  use a CMDB lookup against an internal-hosts table instead of
  `iplocation` on the private-IP side, or use the
  [cim-network-traffic/paths](../cim-network-traffic/paths.md)
  recipe which has the same iplocation contract but works
  off the CIM Network Traffic data model where some
  organizations have already enriched src/dest fields.
- **`bytes >= 10485760` (10 MB) threshold is environment-specific.**
  Too low and the panel is overwhelmed by noise; too high and
  the panel hides interesting medium-volume flows. Start at
  10 MB for branch-office volumes; scale up to 100 MB or 1 GB
  for enterprise-edge / data-centre volumes.
- **The `append` branch doubles SPL execution time.** The
  endpoint-pair pattern re-runs the same aggregation +
  iplocation pipeline twice. For very-busy NetFlow tenants
  (>10M flow records/hour), this can push search latency above
  the dashboard auto-refresh interval. Alternatives: pre-
  aggregate in a saved-search / summary index and read from
  the summary, or accept the latency cost (NetFlow paths
  panels are typically operator-pull rather than auto-
  refreshing).
- **Asymmetric routing makes path direction ambiguous.** NetFlow
  records the direction the flow was OBSERVED on the recording
  interface. Asymmetric routing (typical in BGP-multi-homed
  networks) means inbound and outbound halves of the same
  conversation can be recorded at different interfaces with
  different `src_ip` / `dest_ip` orientations. The `head 2000`
  cap usually preserves both halves; the paths panel shows
  them as two separate polylines unless you `eval id=min(src_ip,
  dest_ip) . "-" . max(src_ip, dest_ip)` to canonicalise.
- **`iplocation prefix=src_` syntax.** The `prefix=` parameter
  is Splunk 8.0+. On older Splunk versions, use two separate
  `iplocation` invocations against renamed intermediate fields
  (`src_ip` → rename → iplocation → rename back).
- **No OT safety dependency.** Same boundary discussion as the
  markers companion §6 — NetFlow is IT-layer flow data. OT-zone
  flow observability uses the
  [cyber-vision/paths](../cyber-vision/paths.md) recipe which
  is built on the OT-safety-compliant passive-DPI reference
  design.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`stats`, `iplocation`,
`eval`, `case`, `mvfind`, `where`, `rename`, `append`, `sort`,
`fields`, `head`). Verification path mirrors the markers
companion §"Verification status" — confirm `Splunk_TA_netflow`
is installed and NetFlow is flowing, dispatch via REST, drop
into a Dashboard Studio panel with the §4 formatter JSON,
confirm polylines render. Promote to `status: verified` + fill
in `verified_against` in a follow-up PR.
