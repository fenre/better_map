---
schema_version: 1
id: netflow-sflow-ipfix--markers
source:
  id: netflow-sflow-ipfix
  display_name: "NetFlow / sFlow / IPFIX (flow records)"
  pattern: splunk-vendor-ta
layer:
  id: markers
  display_name: Markers
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
    example: "203.0.113.45"
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
  - name: bytes
    type: number
    example: "184320000"
  - name: flow_count
    type: integer
    example: "1284"
  - name: top_protocol
    type: string
    example: "tcp/443"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, different layer (H3 hexbin)"
    path: "docs/recipes/netflow-sflow-ipfix/h3.md"
  - description: "Companion recipe — same source, different layer (heatmap)"
    path: "docs/recipes/netflow-sflow-ipfix/heat.md"
  - description: "Splunk Network Explorer skill — NetFlow / sFlow / IPFIX collection patterns"
    path: "~/.cursor/skills/splunk-network-explorer/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# NetFlow / sFlow / IPFIX (flow records) — markers

The per-destination drilldown complement to the
[netflow-sflow-ipfix/h3](./h3.md) and
[netflow-sflow-ipfix/heat](./heat.md) recipes — same NetFlow /
sFlow / IPFIX flow records, same `iplocation` geocoding of
destination IPs, but rendered as discrete markers sized by byte
volume so each individual top-talker is clickable for
investigation. The markers layer surfaces **per-destination
traffic** as one circle per remote endpoint: marker size encodes
byte count, marker colour encodes country (or top protocol via
formatter config). This is the natural shape when the dashboard
question is "which specific destination is consuming my egress
capacity?" rather than "where is my traffic concentrated?"
(heatmap) or "which region cells are warmest?" (H3).

## 1. Source description

Same NetFlow / sFlow / IPFIX flow-record stream as the companion
[h3](./h3.md) and [heat](./heat.md) recipes — vendor-agnostic at
the flow-record layer because all three protocols encode the
same `(src_ip, dst_ip, sport, dport, protocol, bytes, packets)`
tuple. Collected via `Splunk_TA_netflow` for Cisco devices
(`sourcetype="cisco:netflow"` for v9/IPFIX), or via vendor-
specific sourcetypes for HPE / Aruba / Arista sFlow, Juniper
J-Flow, Huawei NetStream, and others.

**Why markers for NetFlow.** A heatmap blurs neighbouring
destinations into smooth blobs — perfect for the "where is the
pressure" question but useless for "which AS / hostname / VRF
contributed that hot blob?" The H3 layer answers per-cell
drilldown but collapses multiple destinations inside the cell
into a single aggregate. Markers preserve **per-destination
identity**: each circle is one destination IP, clickable for
drilldown into the per-flow records, the resolved hostname, the
ASN, the in-tenant business context. The right layer for
**NetOps capacity-planning investigation** ("we saw 800 GB to
198.51.100.42 yesterday — what is that endpoint?"),
**security investigation** ("which specific destinations did
the compromised host exfiltrate to?"), and **chargeback /
billing** ("which destinations does this department's CIDR
talk to most?"), NOT for executive bandwidth summaries (use
heatmap) or region-scale capacity overviews (use H3).

**Typical sourcetype / index:** `sourcetype="cisco:netflow"` /
`index=netflow`. Replace with `sourcetype="huawei:netstream"`,
`sourcetype="sflow"`, etc., to match your vendor. See the
[`splunk-network-explorer` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-network-explorer.mdc)
for the per-vendor sourcetype matrix.

## 2. SPL recipe

```spl
index=netflow sourcetype="cisco:netflow" earliest=-1h latest=now
| stats sum(bytes) AS bytes, dc(src_ip) AS flow_count, values(protocol) AS protocols, values(dest_port) AS dest_ports BY dest_ip
| where bytes >= 1048576
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| eval top_protocol=case(mvfind(protocols, "tcp") >= 0 AND mvfind(dest_ports, "443") >= 0, "tcp/443", mvfind(protocols, "tcp") >= 0 AND mvfind(dest_ports, "80") >= 0, "tcp/80", mvfind(protocols, "udp") >= 0 AND mvfind(dest_ports, "443") >= 0, "udp/443", mvfind(protocols, "tcp") >= 0, "tcp/other", mvfind(protocols, "udp") >= 0, "udp/other", true(), "other")
| rename dest_ip AS id, Country AS dest_country
| fields id, lat, lon, dest_country, bytes, flow_count, top_protocol
| sort - bytes
| head 2000
```

What the pipeline does, stage by stage:

- **`index=netflow sourcetype="cisco:netflow" earliest=-1h
  latest=now`** — bind to the NetFlow index. The `earliest=-1h`
  is the conservative starting time-range for a per-destination
  investigation panel; an executive overview would use
  `-24h`, but `-1h` keeps the marker count under ~2000 for
  most enterprise edge volumes which fits comfortably in the
  markers layer's interactive zoom budget. Adjust on dashboard
  wiring with `earliest=$earliest$`.
- **`| stats sum(bytes) AS bytes, dc(src_ip) AS flow_count,
  values(protocol) AS protocols, values(dest_port) AS
  dest_ports BY dest_ip`** — aggregates per-flow records into
  one row per destination IP. `sum(bytes)` is the byte total.
  `dc(src_ip)` answers "how many distinct internal hosts
  talked to this destination?" (a destination talked to by 200
  internal hosts behaves very differently from one talked to
  by 1 host; popups can surface this). `values(protocol)` and
  `values(dest_port)` are multi-valued and feed the
  `top_protocol` derivation below — `values` (not `dc`)
  because the per-flow records carry the exact protocol /
  port pair the SOC analyst needs to see.
- **`| where bytes >= 1048576`** — 1 MiB floor. Drops the
  long tail of single-byte ICMP probes, DNS bursts, and
  SYN-ACK retransmits that would clutter the panel with
  meaningless dots. Tune to the tenant's baseline: smaller
  for branch-office tenants, larger for hyperscaler-egress
  enterprises. The markers layer's interactive budget caps
  at ~2k features cleanly; this filter is the primary lever
  for keeping the result count inside that envelope.
- **`| iplocation dest_ip`** — Splunk's built-in MaxMind
  GeoLite2 geocoder. No outbound network call. RFC-1918
  destinations get null lat / lon; the next line drops them.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drop
  private-range internal traffic and unresolvable allocations
  (very recently allocated blocks, TOR exits, anycast IPs
  with ambiguous geography). Without this, every east-west
  conversation lands at Null Island.
- **`| eval top_protocol=case(...)`** — classify each
  destination by its dominant protocol / port pair so popups
  can show "tcp/443" or "udp/443" at a glance. The `case`
  chain prioritises well-known service ports (HTTPS, HTTP)
  and falls through to coarser categories for anything else.
  Replace the case chain with a richer mapping (a lookup
  against your service-classification CSV) if your tenant
  has named services beyond the IANA standard ports. Note:
  `mvfind` returns the index of the first match (≥0 means
  found, -1 means not found), so `>= 0` is the membership
  test for multi-valued fields.
- **`| rename dest_ip AS id, Country AS dest_country`** —
  adopt Better Map's canonical `id` alias. `dest_country`
  flows through as a feature property; popups can render it
  for at-a-glance geographic context.
- **`| sort - bytes`** — biggest-talker-first so when markers
  visually overlap (CDN POPs in Ashburn, AWS `us-east-1`
  endpoints), the higher-volume marker draws on top and is
  the one you click.
- **`| head 2000`** — render budget. The markers layer renders
  10k points smoothly per ROADMAP §7c, but for an investigation
  panel that the analyst clicks through one marker at a time
  the visual budget is much lower — 2000 markers at world zoom
  is the upper bound for a panel that still feels "scannable"
  rather than "wall of dots." Raise to 5000 for a forensic
  deep-dive view; for anything > 5k switch to the H3 or heatmap
  sibling recipes.

## 3. Expected fields

| field         | type    | example         |
|---------------|---------|-----------------|
| id            | string  | 203.0.113.45    |
| lat           | number  | 37.7749         |
| lon           | number  | -122.4194       |
| dest_country  | string  | US              |
| bytes         | number  | 184320000       |
| flow_count    | integer | 1284            |
| top_protocol  | string  | tcp/443         |

All seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`bytes` is the operator's interpretation column (popup, sort);
`flow_count` and `top_protocol` are auxiliary metadata for
investigation context.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **Auto-detect handles lat / lon / id.** The SPL's `rename`
  aligns every binding field to Better Map's canonical-alias
  list (`lat`, `lon`, `id`), so no `latField` / `lonField` /
  `idField` override is needed. `dataFitness.js` picks them
  up automatically.
- **`pointRenderer: "cluster"`** — at world zoom the markers
  will overlap heavily in CDN-dense regions (US-east, Frankfurt,
  Dublin, Tokyo). Clustering buckets nearby markers into a
  single numbered circle; click to zoom in and split. For an
  intentionally non-clustered view (e.g. an executive
  "showcase the few specific named destinations" panel),
  switch to `"none"` or `"point"` and curate the SPL down to
  ~50 markers.
- **`bytes` drives marker SIZE automatically.** Better Map's
  `dataFitness.js` size-encoding picks up the `value` /
  `bytes` / `count` fields by name. If your panel needs a
  different size encoding (e.g. size by `flow_count` rather
  than `bytes`), rename `flow_count AS value` in the SPL's
  final `rename` stage.
- **`top_protocol` flows through automatically** as a feature
  property. It can drive a per-protocol colour ramp via the
  `palette` formatter option, or be rendered in marker popups
  / tooltips with no further config. For a security-focused
  panel where you want UDP/non-standard ports to stand out
  visually, configure a per-`top_protocol` colour ramp via
  the `palette` formatter option.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce the panel by
pasting the SPL above into a Dashboard Studio map panel with
Better Map as the visualization, applying the formatter JSON
in §4, and confirming that (a) marker clusters appear in the
expected hyperscaler regions at world zoom (Ashburn / Dublin /
Frankfurt / Singapore), (b) zooming into one cluster splits it
into per-destination markers, and (c) clicking a marker opens
a popup with `id` (destination IP), `dest_country`, `bytes`,
`flow_count`, and `top_protocol`._

## 6. Gotchas

- **Markers vs heatmap vs H3 — when to choose which.** Three
  answers to "what is my egress doing":

  | Layer | Best for | Loses |
  |---|---|---|
  | `markers` (this recipe) | Per-destination drilldown, investigation, chargeback | Aggregate pressure read at world zoom |
  | `heatmap` (per [netflow-sflow-ipfix/heat](./heat.md)) | Smooth aggregate-density pressure read for executive panels | Per-destination identity, click-through drilldown |
  | `h3` (per [netflow-sflow-ipfix/h3](./h3.md)) | Area-neutral per-cell aggregation with click-to-drilldown | Smooth gradient, per-destination identity |

  All three coexist in the same dashboard via Better Map's
  BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
  `reset`) toggled from a dashboard input. A common pattern:
  default ON = heatmap (executive read), checkbox to enable
  markers (analyst drilldown), checkbox to enable H3 (regional
  capacity).

- **`bytes` semantics depend on the flow exporter's accounting.**
  Cisco IOS-XE NetFlow v9 typically exports byte counters per
  flow record (one record = aggregated flow). sFlow exports
  SAMPLED packet records that need extrapolation via the
  sampling rate. IPFIX has flexible templates — the byte field
  may be `octetDeltaCount` (per-record bytes) or
  `octetTotalCount` (cumulative bytes since flow start).
  Confirm with `| stats values(*) BY sourcetype | table sourcetype, *` against
  a one-minute window of your actual data. If sFlow, multiply
  `bytes` by the sampling rate (typically 1000 or 2048) in
  the `stats` aggregation to recover total bytes.

- **`dc(src_ip)` cardinality.** The recipe surfaces `flow_count`
  as "how many distinct internal hosts talked to this
  destination," which is operationally interesting (a destination
  talked to by 200 internal hosts is a shared service like a
  DNS resolver or a SaaS endpoint; a destination talked to by 1
  internal host is a 1:1 conversation worth investigating). If
  your environment has multi-stage NAT, `src_ip` may be the NAT
  edge address rather than the original client — adjust by
  joining against your NAT translation table before the
  `stats` if you need original-client cardinality.

- **Protocol classification is intentionally coarse.** The
  `top_protocol` `case` chain covers tcp/443, tcp/80, udp/443
  (HTTP/3 / QUIC), and falls through to tcp/other / udp/other /
  other. For richer classification (per-port service names like
  "Microsoft 365 SharePoint" vs "GitHub" vs "Datadog"), join
  the destination against a service-classification CSV / KV
  Store lookup that maps (IP, port) → service name. The
  Splunkbase `Splunk Network Explorer` app ships an extensive
  one; the `splunk-network-explorer` skill documents how to
  wire it.

- **Hyperscaler concentration in Ashburn.** As noted in the
  heatmap sibling recipe, AWS `us-east-1`, Azure East US, GCP
  `us-east1`, and major CDNs all geocode to the
  Ashburn / Northern-Virginia area. Markers within that cluster
  will OVERLAP visually — clustering (`pointRenderer:
  "cluster"`) is the right answer for the default panel. For
  a panel that needs to disambiguate hyperscaler-A vs
  hyperscaler-B traffic, add `iplocation -allfields` and split
  on `asn_owner` to render colour-by-ASN rather than
  colour-by-country.

- **`Splunk_TA_netflow` field name drift.** Older versions of
  the TA used `dest_ip` (with underscore); newer 4.x versions
  may emit `dest`. Confirm with `| tstats values(*) WHERE
  index=netflow sourcetype="cisco:netflow"` and adjust the SPL's
  `BY` field name accordingly. The CIM Network_Traffic data
  model normalises to `All_Traffic.dest`, but this recipe
  intentionally queries the raw NetFlow index for the per-flow
  attributes (`protocol`, `dest_port`, source-cardinality)
  that the CIM data model collapses into per-destination
  summaries.

- **Time range.** The recipe hard-codes `earliest=-1h
  latest=now` so it works in a panel without a dashboard time
  picker. Replace with `earliest=$earliest$ latest=$latest$`
  once you wire the recipe into a dashboard with a time-range
  input. For investigation workflows, `-1h` is the natural
  default (operator just noticed a spike); for chargeback
  reports, `-24h` or `-7d` is more common — bump the
  `bytes >= 1048576` floor proportionally for longer windows
  or the marker count explodes past the interactive budget.

- **MaxMind database licensing.** Splunk Enterprise ships with
  the free MaxMind GeoLite2 database. For higher accuracy /
  commercial use, swap in MaxMind GeoIP2 via the Splunk admin
  UI. The recipe is unchanged — `iplocation` reads whichever
  database is configured.

- **PII / GDPR posture.** Per ROADMAP §1a (binding), Better
  Map NEVER sends event data outside `splunkd:8089`.
  `iplocation` runs server-side against the local MaxMind
  database — no outbound geocoding API call. Destination IPs
  are not personal data on their own, but a marker for
  `198.51.100.X` clearly labelled "1.2 GB at 03:14 UTC"
  combined with knowledge of the source `src_ip` (an
  identifiable employee workstation) becomes identifiable
  user-behaviour data. Do NOT include `src_ip` in this panel's
  popup template; the recipe deliberately omits it. If your
  dashboard wraps THIS panel beside one that DOES show
  `src_ip`, audit the combination against tenant privacy
  policy (the markers panel alone is destination-only and
  generally permissible; the join is what creates the privacy
  exposure).

- **No OT safety dependency.** This recipe is pure IT NetFlow.
  If your NetFlow collectors ALSO observe traffic on OT zone
  boundaries (a SPAN port mirroring a Level-3 / Level-4 IT-OT
  conduit), filter THOSE flows out of this panel (`NOT src_ip
  IN (<ot_subnets>) AND NOT dest_ip IN (<ot_subnets>)`) and
  put OT-boundary flows in a DEDICATED recipe with explicit
  OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 (passive only) and Rule 6 (safety-dependent
  detection metadata). A marker for "10 GB egress from
  PLC-controller-04 to an external IP" is a safety-impacting
  finding that must surface via the OT-zone runbook, not
  alongside cat-video CDN traffic in a NetOps capacity panel.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, follows the documented `Splunk_TA_netflow` field contract
plus the canonical `stats sum + iplocation + eval case`
markers pattern shared by the markers siblings in
`cim-network-traffic/`, `cim-authentication/`, and the prior
NetFlow h3 + heat siblings. It uses only shipping Splunk
built-ins (`stats`, `iplocation`, `eval`, `mvfind`, `case`,
plus the `Splunk_TA_netflow` parsing). It has not been
dispatched against the v1.7-prep lab tenant in this PR because
non-interactive admin auth + a live NetFlow exporter are not
present in the agent workspace. A maintainer with REST auth to
a NetFlow-ingesting tenant should:

1. Confirm the NetFlow exporter is sending records by checking
   `| metadata type=sourcetypes index=netflow | search
   sourcetype="cisco:netflow" | sort - lastTime` shows a
   recent timestamp.
2. Run the recipe SPL and confirm the result row count is
   under the `head 2000` cap (if not, raise the
   `bytes >= 1048576` floor proportionally).
3. Validate the `top_protocol` case chain matches the
   protocols actually present in the data — use
   `| stats values(protocol), values(dest_port) BY dest_ip |
   head 20` to spot-check.
4. Run the heatmap and H3 sibling recipes side by side and
   confirm the loudest markers correspond to the hottest
   heatmap blobs and the fullest H3 cells (sanity check on
   the markers `head 2000` truncation vs the
   heatmap `head 10000` and H3 unbounded).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
