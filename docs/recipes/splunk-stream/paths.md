---
schema_version: 1
id: splunk-stream--paths
source:
  id: splunk-stream
  display_name: "Splunk Stream (wire data)"
  pattern: splunk-stream
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-19"
verified_against: null
splunk_apps_required:
  - id: Splunk_TA_stream
    optional: false
  - id: builtin:iplocation
    optional: false
expected_fields:
  - name: id
    type: string
    example: "FLOW-10.0.0.42-203.0.113.45-443"
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
    example: "10.0.0.42"
  - name: dest_ip
    type: string
    example: "203.0.113.45"
  - name: dest_port
    type: integer
    example: "443"
  - name: bytes_out
    type: integer
    example: "184320"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-destination geo enrichment)"
    path: "docs/recipes/splunk-stream/markers.md"
  - description: "Companion recipe — same source, H3 hexbin (per-cell destination density)"
    path: "docs/recipes/splunk-stream/h3.md"
  - description: "Companion recipe — same source, heatmap (smoothed destination density)"
    path: "docs/recipes/splunk-stream/heat.md"
  - description: "Companion recipe — same source, supercluster (zoom-adaptive)"
    path: "docs/recipes/splunk-stream/supercluster.md"
  - description: "Pattern reference — paths layer with append-based 2-vertex polylines (OT-safety)"
    path: "docs/recipes/cyber-vision/paths.md"
  - description: "Pattern reference — paths layer with iplocation-geocoded source IPs"
    path: "docs/recipes/cim-alerts/paths.md"
  - description: "Splunk Stream skill — wire-data capture and protocol analytics"
    path: "~/.cursor/skills/splunk-stream/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
---

# Splunk Stream (wire data) — paths

Render **outbound TLS session flows** as polylines on a world
map by reading Splunk Stream's `stream:tls` sourcetype,
`iplocation`-geocoding the destination IP (the source IP is
typically RFC-1918 and won't geo), and drawing one 2-vertex
polyline per (src, dest) pair with the source's customer-
supplied office coordinates as vertex 0 and the destination's
geocoded location as vertex 1.

The right shape for **security-investigation panels** where
the SOC needs to see "which OFFICES are talking to which
INTERNET DESTINATIONS" at-a-glance — markers show the
endpoints, but paths show the CONNECTIONS. Pair with the
[cim-authentication/paths](../cim-authentication/paths.md)
recipe to overlay both auth-trajectory (impossible-travel)
polylines and wire-data flow polylines on the same map.

The **5th layer cell on the splunk-stream source row** —
completing markers / heat / h3 / supercluster / paths for
Splunk Stream.

## 1. Source description

Same **Splunk Stream** wire-data source as the
[markers](./markers.md), [heat](./heat.md), [h3](./h3.md),
and [supercluster](./supercluster.md) companions — see
[splunk-stream/markers §1](./markers.md#1-source-description)
for the streamfwd / `Splunk_TA_stream` reference architecture
and the rationale for binding to `sourcetype="stream:tls"` as
the canonical session-aware feed.

The relevant distinction for THIS recipe: it draws ONE
polyline per (src_ip, dest_ip, dest_port) tuple, with two
vertices (source and destination). Source-side vertices need
geographic attribution: since `src_ip` is typically
RFC-1918 private space (10/8 / 172.16/12 / 192.168/16) and
`iplocation` returns NULL on these, the recipe joins
against a customer-maintained `office_sites.csv` lookup
that maps source IP subnets to office coordinates. The
destination vertex uses `iplocation` on `dest_ip` directly.

**Why paths for Splunk Stream.** A markers panel renders the
destinations as endpoints — but loses the source attribution
that makes wire-data investigations actionable. A
data-exfiltration alert ("250 GB to AWS Mumbai in 2 hours")
benefits dramatically from seeing the SOURCE OFFICE that
exfiltrated the data — "is this our Dublin office that
should be talking to AWS Mumbai for legitimate business, or
is this our Tokyo office that has no business reaching that
region?". The paths layer makes this immediate. This is the
right shape for **DLP investigation panels**,
**lateral-movement detection across multi-office WANs**,
and **traffic-pattern audits** where the source-destination
pair is the unit of investigation.

**Typical sourcetype / index:** `sourcetype="stream:tls"`,
`index=wire_data` (defaults per the
[splunk-stream-setup](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-stream-setup/SKILL.md)
skill).

## 2. SPL recipe

```spl
index=wire_data sourcetype="stream:tls" earliest=-1h latest=now
| stats sum(bytes_out) AS bytes_out,
    latest(app) AS app,
    latest(server_name) AS sni,
    count AS session_count
  BY src_ip, dest_ip, dest_port
| where session_count >= 3
| lookup office_sites.csv src_subnet AS src_ip
    OUTPUT lat AS src_lat, lon AS src_lon, site_name AS src_site_name
| iplocation dest_ip
| where isnotnull(src_lat) AND isnotnull(src_lon)
    AND isnotnull(lat) AND isnotnull(lon)
| rename lat AS dest_lat, lon AS dest_lon, Country AS dest_country
| eval id="FLOW-" . src_ip . "-" . dest_ip . "-" . dest_port
| eval vertex=mvrange(0, 2, 1)
| mvexpand vertex
| eval vertex_num=tonumber(vertex)
| eval lat=case(vertex_num=0, src_lat, vertex_num=1, dest_lat),
       lon=case(vertex_num=0, src_lon, vertex_num=1, dest_lon),
       role=case(vertex_num=0, "src", vertex_num=1, "dest"),
       seq=vertex_num
| fields id, seq, lat, lon, src_ip, dest_ip, dest_port, app, sni, bytes_out, session_count, role, src_site_name, dest_country
| sort 0 id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`index=wire_data sourcetype="stream:tls" earliest=-1h
  latest=now`** — 1h window. Stream's session events accumulate
  fast (thousands per hour per forwarder); 1h keeps the join
  cardinality manageable while still covering recent activity.
  For investigation widening, override to 4h / 24h via the
  panel time-input token.
- **`stats sum(bytes_out) AS bytes_out, latest(app) AS app,
  latest(server_name) AS sni, count AS session_count BY src_ip,
  dest_ip, dest_port`** — aggregate per (src, dest, port)
  tuple. `bytes_out` is cumulative volume; `session_count`
  is the number of distinct TLS sessions; `app` and `sni`
  flow through to the popup for connection-context.
- **`where session_count >= 3`** — drop one-shot connections.
  A `session_count=1` is often a port probe or DNS-lookup-then-
  abandon; the 3-session minimum surfaces meaningful repeat
  connections.
- **`lookup office_sites.csv src_subnet AS src_ip OUTPUT lat
  AS src_lat, lon AS src_lon, site_name AS src_site_name`** —
  the critical source-attribution line. Joins the source IP
  against a customer-maintained CSV lookup whose `src_subnet`
  column contains CIDR strings (e.g., "10.0.0.0/16"
  = "Dublin office", "10.1.0.0/16" = "Tokyo office"). The
  lookup MUST be configured with `match_type =
  CIDR(src_subnet)` in `transforms.conf` so the lookup
  matches IPs to subnet ranges. Without this lookup, the
  recipe has no way to assign a geographic source.
- **`iplocation dest_ip`** — Splunk's built-in MaxMind lookup
  for the destination. Returns NULL on private IPs (which
  shouldn't appear in dest_ip for outbound TLS — but if they
  do, the next `where` drops them).
- **`where isnotnull(src_lat) AND isnotnull(src_lon) AND
  isnotnull(lat) AND isnotnull(lon)`** — both endpoints must
  geocode for a 2-vertex polyline.
- **`rename lat AS dest_lat, lon AS dest_lon, Country AS
  dest_country`** — disambiguate the `iplocation` output
  fields (which are bare `lat`/`lon`) so the upcoming
  `case()` can pick src vs dest coordinates.
- **`eval id="FLOW-" . src_ip . "-" . dest_ip . "-" .
  dest_port`** — unique polyline ID per (src, dest, port)
  tuple.
- **`eval vertex=mvrange(0, 2, 1)` + `mvexpand vertex`** —
  fan out one row per (flow, vertex) pair. Same canonical
  pattern as the [itsi-kpi-base/paths](../itsi-kpi-base/paths.md)
  and [csv-lookup-geo/paths](../csv-lookup-geo/paths.md)
  recipes.
- **`eval vertex_num=tonumber(vertex)`** — cast for the
  `case()` numeric comparison.
- **`eval lat=case(...), lon=case(...), role=case(...), seq=vertex_num`** —
  pick src or dest attributes per vertex.
- **`fields ...`** — explicit projection with the
  per-flow popup attributes carried through to both
  vertices (so popup-on-vertex shows the same flow context).
- **`sort 0 id, + seq`** — group all vertices for one flow
  contiguously, ordered seq=0 (src) then seq=1 (dest).
- **`head 5000`** — render cap. A typical 1h window produces
  500-2000 distinct flows; 5000 covers heavy-traffic SOC
  reviews.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example                              |
|---------------|---------|--------------------------------------|
| id            | string  | FLOW-10.0.0.42-203.0.113.45-443      |
| seq           | integer | 0                                    |
| lat           | number  | 37.7749                              |
| lon           | number  | -122.4194                            |
| src_ip        | string  | 10.0.0.42                            |
| dest_ip       | string  | 203.0.113.45                         |
| dest_port     | integer | 443                                  |
| bytes_out     | integer | 184320                               |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`app`, `sni`, `session_count`, `role`, `src_site_name`,
`dest_country` also flow through as feature properties for
the popup.

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

- **`pathIdField: "id"`** — explicit. The
  `FLOW-<src>-<dest>-<port>` format makes each polyline
  uniquely identifiable.
- **`timeField: "seq"`** — monotonic vertex ordering (0 for
  source office, 1 for internet destination).
- **`pathColor: "#2ca02c"`** — Tableau muted-green. Distinct
  from the blue used by Cyber Vision OT-flow polylines
  ([cyber-vision/paths](../cyber-vision/paths.md)), the red
  used by ATO kill-chain trajectories
  ([cim-authentication/paths](../cim-authentication/paths.md)),
  and the purple used by ITSI service-dependency edges
  ([itsi-kpi-base/paths](../itsi-kpi-base/paths.md)). Green
  reads as "infrastructure flow / business-as-usual" against
  any base-map; the SOC reserves red for active-investigation
  panels.
- **`pathArrows: true`** — render direction-of-travel chevrons.
  Arrows point from source office to internet destination,
  matching the data-flow direction (egress traffic). For
  bidirectional volume visualization, swap to `pathArrows:
  false` and use a sister panel for inbound flows.

For volume-tinted polylines (red for high-bandwidth flows,
green for low), set `colorField: "bytes_out"` with a
sequential palette — a v1.8 candidate. The static green is
the appropriate starting point for the multi-flow audit view.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The reference demo data: a multi-office customer with
Stream forwarders at 3-5 offices and outbound TLS traffic to
a global mix of cloud destinations. The paths panel renders
~50-500 polylines fanning out from the offices to destinations
across major cloud regions. A maintainer can reproduce by
pasting the SPL into a Dashboard Studio map panel with Better
Map as the visualization and applying the formatter JSON in
§4._

## 6. Gotchas

- **`office_sites.csv` lookup is operator-maintained.** This
  recipe REQUIRES a customer-supplied CSV lookup mapping
  source subnets to office coordinates. The lookup MUST be
  configured with `match_type = CIDR(src_subnet)` in
  `transforms.conf` (per the
  [splunk-lookups skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-lookups/SKILL.md))
  so source IPs match subnet ranges. Without this lookup,
  every row drops at the `where isnotnull(src_lat)` filter
  and the panel renders empty. Suggested schema: columns
  `src_subnet`, `lat`, `lon`, `site_name` — one row per
  office subnet. Operator can build via REST `inputlookup`
  / `outputlookup` flows.
- **Source IP attribution accuracy depends on NAT topology.**
  If the customer NATs all traffic out a single edge router,
  `src_ip` in stream:tls events will be the internal address
  of the NAT'd host (good — distinguishes by office subnet)
  AS LONG AS Stream is capturing the SPAN traffic BEFORE NAT.
  If Stream's SPAN port is AFTER NAT (capturing the public
  egress traffic), `src_ip` becomes the carrier's outside
  address and every flow shows the same source. The standard
  reference architecture per the
  [splunk-stream skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-stream/SKILL.md)
  is to SPAN before NAT for exactly this reason.
- **TLS sessions vs raw flows.** This recipe binds to
  `stream:tls` (the protocol-decoded session view). For raw
  TCP flows (`stream:tcp`), the SPL is identical except for
  the sourcetype + the `sni`/`app` field changes (drop the
  `latest(server_name) AS sni` and `latest(app) AS app` lines
  — `stream:tcp` doesn't decode them). For non-TLS protocol
  visibility (DNS / HTTP / SMTP), bind to the corresponding
  `stream:dns` / `stream:http` / `stream:smtp` sourcetypes.
- **`session_count >= 3` is a tunable noise floor.** Too low
  (1-2) surfaces every probe / scan. Too high (10+) misses
  short-burst exfil. The 3-session minimum is the sweet spot
  for typical office traffic. For high-fidelity DLP /
  exfiltration panels, drop to 1 (every single connection
  matters); for "what destinations do we routinely talk to"
  panels, raise to 50 or higher.
- **2-vertex polylines are intentional.** This recipe shows
  source-to-destination flows, not multi-hop paths through
  intermediate routers. For multi-hop visibility (which
  network egress / SD-WAN path the flow took), use the
  [thousandeyes/paths](../thousandeyes/paths.md) companion
  which renders hop-by-hop traceroute polylines from
  ThousandEyes path-vis tests.
- **Time range.** Hard-coded `earliest=-1h latest=now` for
  the default panel. Replace with `earliest=$earliest$
  latest=$latest$` once the recipe is wired into a dashboard
  with a time-range input — but be mindful of the join
  cardinality: a 24h window can produce 10000+ flows on a
  large customer, exceeding the `head 5000` cap.
- **PII / GDPR posture.** `sni` (TLS Server Name Indication)
  reveals the destination hostname customer's browsers are
  attempting to reach. This is operationally useful for SOC
  but legally PII in some jurisdictions when joined with
  source IP. Restrict via Splunk RBAC on the `wire_data`
  index for audiences without "see TLS SNI" authorisation;
  consider an `eval sni=sha256(sni)` hash-redaction for
  audit-only views.
- **No OT-safety dependency.** Splunk Stream captures IT/web
  wire data; no OT carve-out applies. For OT-network flow
  visualization, use the
  [cyber-vision/paths](../cyber-vision/paths.md) recipe
  which consumes Cisco Cyber Vision's passive DPI output
  per the `/.cursor/rules/ot-safety.mdc` Rule 1 reference
  design.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound and uses only Splunk + Stream built-ins
(`stats`, `lookup`, `iplocation`, `eval`, `case`, `mvrange`,
`mvexpand`, `where`, `tonumber`, `sort`). Verification path:
install `Splunk_TA_stream`, configure stream forwarder, populate
`office_sites.csv` with at least one subnet→site mapping,
dispatch via REST, drop into a Dashboard Studio panel with the
§4 formatter JSON, confirm 2-vertex polylines render between
configured offices and `iplocation`-geocoded destinations.
Promote to `status: verified` + fill in `verified_against`
(include `splunk_app: "Splunk_TA_stream"` and a non-PII tenant
identifier) in a follow-up PR.
