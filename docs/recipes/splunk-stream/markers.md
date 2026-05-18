---
schema_version: 1
id: splunk-stream--markers
source:
  id: splunk-stream
  display_name: "Splunk Stream (wire data)"
  pattern: splunk-stream
layer:
  id: markers
  display_name: Markers
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
    example: "203.0.113.45:443"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: src_ip
    type: string
    example: "10.0.0.42"
  - name: dest_ip
    type: string
    example: "203.0.113.45"
  - name: dest_country
    type: string
    example: "US"
  - name: app
    type: string
    example: "tls"
  - name: bytes_out
    type: integer
    example: "184320"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Splunk Stream skill — wire-data capture and protocol analytics"
    path: "~/.cursor/skills/splunk-stream/SKILL.md"
  - description: "Splunk Stream setup skill — TA_stream + splunkapp_stream"
    path: "~/.cursor/skills/splunk-stream-setup/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "dataFitness.js alias auto-detect (lat/lon/id auto-picked)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/dataFitness.js"
---

# Splunk Stream (wire data) — markers

Plot every outbound TLS session captured by Splunk Stream on a world
map, one marker per `(dest_ip, dest_port)` pair, sized by the bytes
that crossed the wire. The canonical security-visibility map for any
team that has Splunk Stream forwarders on a SPAN port — answers "who
is my network talking to right now and where on Earth do they live"
in one panel.

## 1. Source description

**Splunk Stream** is Splunk's passive wire-data capture engine: a
forwarder-side daemon (`streamfwd`) reads a SPAN/mirror port (or a
cloud VPC mirror), reassembles flows, decodes application-layer
protocols (TLS, HTTP, DNS, MySQL, Kafka, ...), and indexes the
resulting per-session events into Splunk. The reference architecture
is documented in the
[`splunk-stream` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-stream-setup.mdc)
(and the canonical app set `Splunk_TA_stream` + the optional UI app
`splunk_app_stream` for protocol-set tuning).

For a "where are my hosts talking to" map we want the TLS session
sourcetype (`stream:tls`) — it carries the source/destination IPs,
the negotiated SNI, the cipher suite, and the byte counters. We use
the destination IP for `iplocation` enrichment because the source is
typically on-prem private space (10/8 / 172.16/12 / 192.168/16) and
will not geo-locate.

The recipe binds to events with `sourcetype="stream:tls"` indexed
into the customer's wire-data index (default `wire_data` per
`splunk-stream-setup`).

**Typical sourcetype / index:** `sourcetype="stream:tls"` /
`index=wire_data`.

**Why TLS specifically:** in 2026, 90%+ of outbound traffic is TLS
1.2 or 1.3. Stream's TLS decoder gives you the SNI and the
destination, which is exactly the join key for `iplocation` — no
need to also onboard `stream:http`, `stream:dns`, `stream:tcp` for
this panel. The other Stream sourcetypes are valuable but for
different recipes (see the splunk-stream skill).

## 2. SPL recipe

```spl
index=wire_data sourcetype="stream:tls"
| stats sum(bytes_out) AS bytes_out, latest(app) AS app, latest(server_name) AS sni BY src_ip, dest_ip, dest_port
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| eval id=dest_ip.":".dest_port
| eval popup="<b>".dest_ip.":".dest_port."</b><br/>SNI: ".sni."<br/>".bytes_out." bytes from ".src_ip
| fields id, lat, lon, src_ip, dest_ip, dest_country, app, bytes_out, popup
```

What the pipeline does, stage by stage:

- **`stats sum(bytes_out) ... BY src_ip, dest_ip, dest_port`** —
  reduces the (potentially millions-per-hour) per-session events to
  one row per destination endpoint. Without this rollup the panel
  would receive a row per packet boundary, which is wasteful and
  almost never what the user wants.
- **`iplocation dest_ip`** — Splunk's built-in `iplocation` command
  uses the bundled MaxMind GeoLite2 database (ships with Splunk
  Enterprise / Cloud out of the box; no add-on needed) to populate
  `lat`, `lon`, `Country` (renamed to `dest_country` below by alias
  auto-detect), `Region`, `City`. RFC-1918 inputs get null lat/lon
  — the `where` filter on the next line drops them.
- **`eval id=dest_ip.":".dest_port`** — Better Map's drilldown and
  cross-panel coordination need a stable per-row identifier. The
  `dest_ip:dest_port` tuple is the natural one for a wire-data
  panel; embedded as `id` it is also what the formatter's
  `idField` picks up automatically (see §4).
- **`eval popup=...`** — Splunk-side HTML popup body. Better Map
  recognises `popup` as the popup-body field by default; assembling
  it in SPL keeps the panel's render fast (no per-row JS string
  building) and is consistent with the
  [`splunk-conf-and-spl.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-conf-and-spl.mdc)
  "build values in SPL, not in the visualization" guidance.

Note every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field        | type    | example                                  |
|--------------|---------|------------------------------------------|
| id           | string  | 203.0.113.45:443                         |
| lat          | number  | 37.7749                                  |
| lon          | number  | -122.4194                                |
| src_ip       | string  | 10.0.0.42                                |
| dest_ip      | string  | 203.0.113.45                             |
| dest_country | string  | US                                       |
| app          | string  | tls                                      |
| bytes_out    | integer | 184320                                   |

All eight fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "auto",
  "idField": "id"
}
```

Why this config:

- **`pointRenderer: "auto"`** — wire-data session counts vary
  wildly across customers (a quiet branch office might emit 50
  destinations per hour, a busy SaaS perimeter 50k). The `auto`
  renderer falls back from individual markers → supercluster →
  heatmap as the row count grows. A hand-pin (`"markers"`) is the
  right call only when you've measured your population and it sits
  in the 50–500 row band.
- **`idField: "id"`** — explicit, even though `id` is in the auto-
  detect alias list. The reason: the SPL above assembles the id
  from `dest_ip + ":" + dest_port`, so a future PR that renames
  the field in the SPL would silently break drilldown. Pinning
  the formatter option makes the contract visible.
- **`src_ip` / `dest_ip` / `dest_country` / `app` / `bytes_out`
  flow through automatically** as feature properties on the
  rendered GeoJSON — popups, tooltips, and drilldown actions can
  reference them by name. Better Map does NOT need `latField` /
  `lonField` overrides because `iplocation` produces canonical
  field names (`lat` / `lon`) that `dataFitness.js` picks up.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker harness (ROADMAP §3 D5
Phase 1 SHIPPED — Playwright Phase 2 still pending). Until then, a
maintainer can reproduce the panel by pasting the SPL above into a
Dashboard Studio map panel with Better Map as the visualization and
applying the formatter JSON in §4. The cyber-incidents demo preset
([formatter dropdown — D6 SHIPPED](https://github.com/fenre/better_map/blob/main/docs/recipes/index.md))
renders a structurally similar view if you don't have Stream data on
hand._

## 6. Gotchas

- **`bytes_out` semantics.** Stream's `bytes_out` is bytes FROM the
  source TO the destination, i.e. egress from your network. For a
  "data exfiltration" map this is the right metric. If you want
  total session size, use `bytes_total = bytes_in + bytes_out` —
  but that double-counts a download (which inflates the marker for
  every CDN endpoint your users hit). Stick with `bytes_out` for
  security panels.
- **MaxMind GeoLite2 freshness.** Splunk ships GeoLite2 but its
  refresh cadence is tied to the Splunk release train, not
  MaxMind's. If a tenant's geolocation accuracy matters, refresh
  the database via `splunk cmd splunkd cmd geoip-update` or point
  `iplocation` at a fresher MaxMind/GeoIP2 file via the
  `transforms.conf` `[geoip]` stanza — see the
  [`splunk-stream` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-stream-setup.mdc).
- **TLS 1.3 SNI encryption (ECH).** Encrypted Client Hello hides
  the SNI from Stream. The decoder will populate
  `server_name="(encrypted)"` for affected sessions; the marker
  still plots because `dest_ip` is on the wire, but you lose the
  identity of the destination service. There is no Stream-side
  workaround — the right answer is to source SNI from the DNS-
  resolution path (`stream:dns`) and join on `dest_ip` in SPL.
- **`stream:tls` privacy / compliance.** Wire-data capture is a
  GDPR / HIPAA scope expander on most customers' compliance
  surface. The
  [`splunk-compliance` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-compliance.mdc)
  documents the controls — at minimum, route `wire_data` to its
  own index with restricted RBAC, mask `src_ip` for non-IR users,
  and document the data-retention period in the customer's data
  inventory. Better Map renders what it receives; the SPL above
  does NOT mask `src_ip`.
- **No OT safety dependency, BUT.** This recipe is IT-only by
  design. If your Stream forwarders are mirrored against an
  OT/ICS environment, the
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 2 apply: Stream IS the canonical passive collection
  method for OT (no active probes) but the resulting `dest_ip`
  set will contain Level-0/1/2 PLCs and HMIs, and a map panel of
  those endpoints MUST NOT be wired to any SOAR / drilldown that
  could send a write back. Render-only is fine; render-and-act
  is not. Use the dedicated `cyber-vision` recipe wave (E5 Phase
  3) for OT-aware wire-data presentation.
- **`iplocation` performance at scale.** On indexer-side
  acceleration `iplocation` is cheap. On a search-head distributed
  search it is per-row — millions of rows × `iplocation` becomes
  the dominant cost of the panel. Always `stats` before
  `iplocation` (the SPL above does this — reduces N session events
  to N distinct destinations) and consider summary-indexing the
  result if the panel auto-refreshes more often than every 5
  minutes.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and follows the documented Splunk Stream contracts (see
references) but it has not been dispatched against a real `stream:tls`
index in the v1.7-prep development cycle (the lab tenant does not
have Splunk Stream forwarders deployed). A maintainer with a Splunk
tenant carrying Stream data should:

1. Run the SPL against `index=wire_data sourcetype="stream:tls"`
   (adjust the index name to match the install).
2. Confirm the panel returns ≥ 100 rows over a 24-hour window with
   all eight documented fields populated for the non-RFC-1918
   destinations.
3. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 10.0 with
   Splunk_TA_stream 9.0.1 against a 5-host SPAN aggregate"), and
   submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change without
   touching the schema.

The D5 Phase 1 harness (`docker/`) makes this a 2-minute round-trip
once an operator has Stream data to point it at — see the
[local Splunk harness operator guide](https://github.com/fenre/better_map/blob/main/docs/development/local-splunk-harness.md).
