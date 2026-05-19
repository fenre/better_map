---
schema_version: 1
id: splunk-stream--supercluster
source:
  id: splunk-stream
  display_name: "Splunk Stream (wire data)"
  pattern: splunk-stream
layer:
  id: supercluster
  display_name: Supercluster
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: Splunk_TA_stream
    optional: false
  - id: splunk_app_stream
    optional: true
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
  - name: dest_ip
    type: string
    example: "203.0.113.45"
  - name: dest_country
    type: string
    example: "US"
  - name: session_count
    type: integer
    example: "428"
  - name: bytes_out
    type: integer
    example: "184320000"
  - name: distinct_src
    type: integer
    example: "47"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-destination drilldown)"
    path: "docs/recipes/splunk-stream/markers.md"
  - description: "Companion recipe — same source, H3 hexbin layer"
    path: "docs/recipes/splunk-stream/h3.md"
  - description: "Companion recipe — same source, heatmap layer"
    path: "docs/recipes/splunk-stream/heat.md"
  - description: "Pattern reference — supercluster layer with same iplocation pipeline (Meraki)"
    path: "docs/recipes/meraki/supercluster.md"
  - description: "Pattern reference — supercluster on CIM Authentication"
    path: "docs/recipes/cim-authentication/supercluster.md"
  - description: "Splunk Stream skill — wire-data capture and protocol analytics"
    path: "~/.cursor/skills/splunk-stream/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# Splunk Stream (wire data) — supercluster

Render every outbound destination captured by Splunk Stream as a
**zoom-adaptive supercluster** on a world map, one row per
`dest_ip`, with weight derived from total bytes_out per
destination. The canonical "global wire-data destination
footprint" panel — when a security or NetOps team wants a
single-pane "where is my network talking to RIGHT NOW" view that
gracefully collapses 10k+ destinations into a navigable cluster
tree instead of overwhelming the renderer with a marker dump.

Sister recipe to
[splunk-stream/markers](../splunk-stream/markers.md) (per-
endpoint drilldown), [splunk-stream/h3](../splunk-stream/h3.md)
(per-cell roll-up), and
[splunk-stream/heat](../splunk-stream/heat.md) (smoothed
density). The four shapes together give a wire-data team
investigative-, hex-, density-, AND scale-tolerant cluster views
on one Splunk Stream data feed.

## 1. Source description

Same Splunk Stream `stream:tls` source as the
[markers](../splunk-stream/markers.md) companion — see that
recipe §1 for the full discussion of `streamfwd`, SPAN-port
collection, the TLS session decoder, and why this recipe binds
to `stream:tls` over the other Stream sourcetypes
(`stream:http`, `stream:dns`, `stream:tcp`, …).

This recipe is the **scale-tolerant overview**: instead of
emitting one row per `(src_ip, dest_ip, dest_port)` tuple (which
the markers companion does — and which can balloon to 10k+ rows
at a busy SaaS perimeter), it rolls up to one row per `dest_ip`,
counts sessions and source-IP cardinality, and renders the
result through supercluster. The supercluster algorithm groups
nearby points into cluster pills at low zoom levels and
progressively splits them as the user zooms in — so a single
"500 destinations in San Francisco" pill at world zoom becomes
500 individual markers at street zoom.

**Typical sourcetype / index:** `sourcetype="stream:tls"` /
`index=wire_data`.

## 2. SPL recipe

```spl
index=wire_data sourcetype="stream:tls" earliest=-1h latest=now
| stats sum(bytes_out) AS bytes_out,
    count AS session_count,
    dc(src_ip) AS distinct_src
  BY dest_ip
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| eval id=dest_ip
| fields id, lat, lon, dest_ip, dest_country, session_count, bytes_out, distinct_src
| sort - bytes_out
| head 10000
```

Why this exact shape, line by line:

- **`earliest=-1h latest=now`** — 1-hour window. Long enough
  to surface meaningful destinations, short enough to keep the
  aggregation fast on busy tenants. Adjust upward (`-4h`,
  `-24h`) for executive-overview panels; downward (`-15m`) for
  real-time SOC views.
- **`stats sum(bytes_out), count, dc(src_ip) BY dest_ip`** —
  single-key rollup per destination. Three measures: total
  bytes (volume), session count (frequency), distinct source
  IPs (fan-in cardinality). The combination gives the popup
  meaningful operational context — a high-bytes / high-
  distinct-src destination is a popular CDN; a high-bytes /
  single-distinct-src destination is one host pulling a lot
  from one endpoint (worth investigating).
- **`iplocation dest_ip`** — built-in MaxMind geocoding. Same
  contract as the markers companion §2.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop RFC-1918
  destinations that don't geocode (internal-to-internal traffic
  is real but not visible on a world map).
- **`eval id=dest_ip`** — Better Map's `id` alias. One row per
  destination, so `dest_ip` is the natural unique key.
- **`sort - bytes_out`** + **`head 10000`** — supercluster
  handles 10k rows comfortably (the renderer's clustering pass
  is O(n log n) and runs once per zoom level). 10000 caps
  total Splunk → JS payload at ~600 KB compressed, well under
  the dashboard panel limit.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example         |
|---------------|---------|-----------------|
| id            | string  | 203.0.113.45    |
| lat           | number  | 37.7749         |
| lon           | number  | -122.4194       |
| dest_ip       | string  | 203.0.113.45    |
| dest_country  | string  | US              |
| session_count | integer | 428             |
| bytes_out     | integer | 184320000       |
| distinct_src  | integer | 47              |

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
  This is essential for the 10k-row payload — drawing 10k
  individual markers at world zoom would freeze the browser
  for ~3 seconds and produce an unreadable speckle pattern.
- **`idField: "id"`** — explicit. Same alignment as the
  markers companion §4 — the SPL assembles `id` so making it
  explicit avoids any field-auto-detect ambiguity.

For colour-by-destination-country, add a `colorField:
"dest_country"` option (and `categoricalPalette`); for size-
by-bytes, add `sizeField: "bytes_out"`. Neither is required —
the defaults render cleanly.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic Stream TLS corpus seeded with geographically-
distributed destinations for cluster-density verification._

## 6. Gotchas

- **MaxMind precision varies by destination type.** CDN
  destinations (Cloudflare, Akamai, Fastly) geo-locate to the
  POP they happen to advertise — which can flip between
  hours. Cluster pills over `1.1.1.1` may shift by hundreds of
  km between dashboard refreshes; this is MaxMind reality, not
  a Better Map bug.
- **`head 10000` is a render cap, not a security cap.** A
  high-traffic SaaS perimeter can easily see >50k distinct
  destinations per hour. Sorting by `- bytes_out` and capping
  at 10000 surfaces the top decile by volume — sufficient for
  most overview panels but not exhaustive. For audit-grade
  coverage, raise the cap (renderer cost scales gracefully up
  to ~30k rows) or partition the dashboard by destination-
  port band.
- **`pointRenderer: "cluster"` is different from `"auto"`.**
  The markers companion uses `"auto"` — which falls back from
  individual markers to clusters when row count exceeds a
  threshold. This recipe forces clusters unconditionally
  because at the 10000-row scale, individual-marker rendering
  is never the right choice. If you want the falling-back
  behaviour, use `"auto"` and copy the markers companion SPL.
- **`bytes_out` is wire bytes, not application bytes.** The
  Stream TLS decoder counts TCP-payload bytes including the
  TLS-record framing overhead (~5 bytes per record, ~40 bytes
  per handshake message). For application-layer byte counts,
  use the `stream:http` sourcetype's `bytes_in` / `bytes_out`
  fields (which are HTTP-body counts after TLS decryption,
  assuming Stream has the server's private key configured).
- **No OT safety dependency.** Same boundary discussion as the
  markers companion §6 — Splunk Stream is IT-perimeter wire-
  data and has no OT-zone exposure. OT-zone wire-data
  observability uses the
  [cyber-vision/paths](../cyber-vision/paths.md) recipe.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`stats`, `iplocation`,
`eval`, `where`, `sort`, `fields`, `head`). Verification path
mirrors the markers companion §"Verification status" — confirm
`Splunk_TA_stream` is installed and TLS sessions are flowing,
dispatch via REST, drop into a Dashboard Studio panel with the
§4 formatter JSON, confirm cluster pills render at world zoom
and split correctly when zooming. Promote to `status: verified`
+ fill in `verified_against` in a follow-up PR.
