---
schema_version: 1
id: netflow-sflow-ipfix--supercluster
source:
  id: netflow-sflow-ipfix
  display_name: "NetFlow / sFlow / IPFIX (flow records)"
  pattern: splunk-vendor-ta
layer:
  id: supercluster
  display_name: Supercluster
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
    example: "198.51.100.7"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: dest_ip
    type: string
    example: "198.51.100.7"
  - name: dest_country
    type: string
    example: "US"
  - name: bytes
    type: number
    example: "92160000"
  - name: flow_count
    type: integer
    example: "428"
  - name: distinct_src
    type: integer
    example: "37"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-destination drilldown)"
    path: "docs/recipes/netflow-sflow-ipfix/markers.md"
  - description: "Companion recipe — same source, heatmap layer"
    path: "docs/recipes/netflow-sflow-ipfix/heat.md"
  - description: "Companion recipe — same source, paths layer (top-talker flows)"
    path: "docs/recipes/netflow-sflow-ipfix/paths.md"
  - description: "Pattern reference — supercluster on Splunk Stream wire-data destinations"
    path: "docs/recipes/splunk-stream/supercluster.md"
  - description: "Splunk Network Explorer skill — NetFlow / sFlow / IPFIX collection patterns"
    path: "~/.cursor/skills/splunk-network-explorer/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# NetFlow / sFlow / IPFIX — supercluster

Render every NetFlow / sFlow / IPFIX destination IP as a
**zoom-adaptive supercluster** on a world map, one row per
`dest_ip`, with cluster pills at regional zoom that progressively
split into per-destination markers as the user zooms. The
canonical "global NetOps destination footprint" panel — when a
NetOps team needs a single-pane "where is my flow traffic going
RIGHT NOW" view that gracefully collapses 10k+ destinations into
navigable cluster pills instead of overwhelming the renderer
with a marker dump.

Sister recipe to
[netflow-sflow-ipfix/markers](../netflow-sflow-ipfix/markers.md)
(per-destination drilldown),
[netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md)
(smoothed-density), and
[netflow-sflow-ipfix/paths](../netflow-sflow-ipfix/paths.md)
(top-talker flows). The four shapes together give a NetOps team
target-, density-, attribution-, AND scale-tolerant cluster
views on one NetFlow data feed.

## 1. Source description

Same NetFlow / sFlow / IPFIX flow-record stream as the
[markers](../netflow-sflow-ipfix/markers.md) and
[paths](../netflow-sflow-ipfix/paths.md) companions — vendor-
agnostic at the flow-record layer because all three protocols
encode the same `(src_ip, dst_ip, sport, dport, protocol,
bytes, packets)` tuple. See the markers recipe §1 for the full
sourcetype matrix and collection-method discussion.

This recipe is the **scale-tolerant overview**: instead of
emitting one row per `(dest_ip)` and rendering as individual
markers (which the markers companion does — and which can
overwhelm panels at very-high-cardinality NetFlow tenants), it
extends the cardinality cap to 10000 and forces
`pointRenderer: "cluster"` so the supercluster algorithm
progressively aggregates destinations as the user zooms out.
At world zoom a 10k-destination payload renders as ~20 cluster
pills (one per major region); at street zoom each pill expands
to individual destination markers.

**Typical sourcetype / index:** `sourcetype="cisco:netflow"` /
`index=netflow`. Replace with vendor-specific sourcetypes as
documented in
[netflow-sflow-ipfix/markers](../netflow-sflow-ipfix/markers.md)
§1.

## 2. SPL recipe

```spl
index=netflow sourcetype="cisco:netflow" earliest=-1h latest=now
| stats sum(bytes) AS bytes,
    dc(src_ip) AS distinct_src,
    count AS flow_count
  BY dest_ip
| where bytes >= 1048576
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| eval id=dest_ip
| fields id, lat, lon, dest_ip, dest_country, bytes, flow_count, distinct_src
| sort - bytes
| head 10000
```

Why this exact shape, line by line:

- **`earliest=-1h latest=now`** — 1-hour window. Same cadence
  as the markers and paths companions. Adjust to `-15m` for
  real-time NetOps panels; to `-24h` for executive-overview
  panels (cap may need raising at longer windows).
- **`stats sum(bytes), dc(src_ip), count BY dest_ip`** — one row
  per destination IP. Three measures: total bytes (volume),
  distinct source IPs (fan-in cardinality), raw flow count
  (frequency). The combination gives operational context — a
  high-bytes / high-distinct-src destination is a popular
  CDN / SaaS endpoint; a high-bytes / single-distinct-src
  destination is one host pulling a lot from one endpoint
  (worth investigating for data exfiltration or backup-misroute).
- **`where bytes >= 1048576`** — 1 MB minimum threshold.
  LOWERED vs the paths companion's 10 MB because supercluster
  handles the higher row count cleanly. Drops trivial DNS /
  NTP / discovery traffic that would inflate the cluster pills.
- **`iplocation dest_ip`** — built-in MaxMind geocoding. Same
  contract as the markers + paths companions.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop RFC-1918
  destinations (internal-to-internal east-west flows don't
  geocode).
- **`eval id=dest_ip`** — Better Map's `id` alias.
- **`sort - bytes`** + **`head 10000`** — supercluster handles
  10k rows comfortably (clustering pass is O(n log n), runs
  once per zoom level). 10000 caps total Splunk → JS payload
  at ~600 KB compressed, well under the dashboard panel
  limit.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example         |
|---------------|---------|-----------------|
| id            | string  | 198.51.100.7    |
| lat           | number  | 37.7749         |
| lon           | number  | -122.4194       |
| dest_ip       | string  | 198.51.100.7    |
| dest_country  | string  | US              |
| bytes         | number  | 92160000        |
| flow_count    | integer | 428             |
| distinct_src  | integer | 37              |

All eight appear in `expected_fields` in the frontmatter and
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
  This is the entire point of the recipe — at world zoom, a
  10k-destination payload renders as ~20 cluster pills (one
  per major region); at city zoom each expands to ~50-200
  individual destinations.
- **`idField: "id"`** — explicit. Same alignment as the
  markers companion §4 — the SPL assembles `id` from
  `dest_ip` so making it explicit avoids any field-auto-
  detect ambiguity at drilldown time.

For volume-tinted cluster pills, add `colorField: "bytes"` plus
a `quantPalette` (e.g., `viridis`) — the renderer will sum
`bytes` within each cluster and tint the pill accordingly.
Without `colorField`, cluster pills render in Better Map's
default neutral colour — still useful, just not volume-tinted.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic NetFlow corpus seeded with geographically-
distributed destinations for cluster-density verification._

## 6. Gotchas

- **MaxMind precision varies by destination type.** Same
  caveat as the splunk-stream/supercluster companion §6 —
  CDN destinations (Cloudflare, Akamai, Fastly) geo-locate to
  the POP they happen to advertise — which can flip between
  hours. Cluster pills over `1.1.1.1` may shift by hundreds
  of km between dashboard refreshes; this is MaxMind reality,
  not a Better Map bug.
- **`head 10000` is a render cap, not a security cap.** A
  high-traffic data-centre perimeter can easily see >50k
  distinct destinations per hour. Sorting by `- bytes` and
  capping at 10000 surfaces the top decile by volume —
  sufficient for most overview panels but not exhaustive.
  For audit-grade coverage, raise the cap (renderer cost
  scales gracefully up to ~30k rows) or partition the
  dashboard by destination-port band.
- **`bytes >= 1048576` (1 MB) threshold is environment-
  specific.** LOWERED vs the paths companion's 10 MB because
  supercluster's progressive aggregation can absorb the
  higher cardinality. Tune up to 10 MB for very busy data-
  centre NetFlow; down to 100 KB for branch-office NetFlow.
- **`pointRenderer: "cluster"` is different from `"auto"`.**
  The markers companion uses `"auto"` — which falls back from
  individual markers to clusters when row count exceeds a
  threshold. This recipe forces clusters unconditionally
  because at the 10000-row scale, individual-marker rendering
  is never the right choice. If you want the falling-back
  behaviour, use `"auto"` and copy the markers companion SPL.
- **No flow-direction context.** This recipe aggregates per
  `dest_ip` regardless of `src_ip` — it can't distinguish
  "many sources hitting one destination" (fan-in) from "one
  source hitting one destination repeatedly" (whale flow).
  The `distinct_src` field surfaces this discrimination in
  the popup; for visual discrimination across panels, use
  the paths companion (which aggregates per src/dest tuple).
- **No OT safety dependency.** Same boundary discussion as
  the markers + paths companions — NetFlow is IT-layer flow
  data. OT-zone flow observability uses the
  [cyber-vision/paths](../cyber-vision/paths.md) recipe which
  is built on the OT-safety-compliant passive-DPI reference
  design.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`stats`, `iplocation`,
`eval`, `where`, `sort`, `fields`, `head`). Verification path
mirrors the markers companion §"Verification status" — confirm
`Splunk_TA_netflow` is installed and NetFlow is flowing,
dispatch via REST, drop into a Dashboard Studio panel with the
§4 formatter JSON, confirm cluster pills render at world zoom
and split correctly when zooming. Promote to `status: verified`
+ fill in `verified_against` in a follow-up PR.
