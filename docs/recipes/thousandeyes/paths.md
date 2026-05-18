---
schema_version: 1
id: thousandeyes--paths
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (path visualization)"
  pattern: splunk-vendor-ta
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "ta_cisco_thousandeyes"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "12345__1747534800"
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
  - name: test_name
    type: string
    example: "SFO → AWS us-east-1"
  - name: hop_ip
    type: string
    example: "203.0.113.45"
  - name: avg_latency_ms
    type: number
    example: "47.3"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "ThousandEyes setup skill — sourcetypes, indexes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Cisco products skill — ThousandEyes data model and example SPL"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "Companion recipe — CIM Network Traffic → paths (same layer, src/dest endpoint pattern)"
    path: "docs/recipes/cim-network-traffic/paths.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
---

# Cisco ThousandEyes (path visualization) — paths

Render Cisco ThousandEyes' hop-by-hop network path measurements
as connected polylines on the map. The canonical "show me how
my traffic actually traverses the internet" panel — answers
questions like "is the AWS path from our SFO agent still
transiting through Equinix LA?", "which BGP transit provider
is on the critical path to our European customers?", and "did
that DNS-resolution latency spike correspond to a path change
through a new hop?".

This recipe is the multi-vertex generalisation of the
[cim-network-traffic/paths](../cim-network-traffic/paths.md)
sibling — instead of a src→dest two-vertex arc derived from
NetFlow / wire data, each ThousandEyes path is the full
geocoded hop sequence (typically 5-15 vertices) measured
end-to-end by an active probe.

## 1. Source description

**Cisco ThousandEyes** is a digital-experience-monitoring (DEM)
platform: it runs active probes ("tests") from globally
distributed measurement agents to user-defined targets (web,
DNS, voice, BGP, ...) and emits structured per-probe results.
Path visualization tests specifically traceroute the path, hop
by hop, on every measurement interval.

The Cisco ThousandEyes App for Splunk
(`ta_cisco_thousandeyes`) lands path-visualization data under
the `thousandeyes_pathvis` index with sourcetype
`cisco:thousandeyes:path-vis`. Each event is one probe
measurement and carries:

- `test_id`, `test_name` — test identifier and human label
- `agent_id`, `agent_name`, `agent_lat`, `agent_lon` — the
  source measurement agent
- `hops` — multi-value field; each entry is one hop with
  `hop_number`, `hop_ip`, `hop_host_name`, `response_time_ms`,
  `loss_percent`
- `_time` — measurement timestamp

The recipe expands the `hops` multi-value field into one row
per hop, geocodes each `hop_ip` via Splunk's built-in
`| iplocation` command, prepends the agent vertex (`seq=0`),
and emits the polyline contract the paths layer consumes.

**Typical sourcetype / index:** `index=thousandeyes_pathvis
sourcetype="cisco:thousandeyes:path-vis"`. App required:
`ta_cisco_thousandeyes` (Splunkbase id 7719). The path-
visualization input must be enabled (default in the setup
script per [`~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/thousandeyes/paths.md)).

## 2. SPL recipe

```spl
index=thousandeyes_pathvis sourcetype="cisco:thousandeyes:path-vis" earliest=-1h latest=now
| dedup test_id sortby - _time
| eval path_id=test_id."__".tostring(_time)
| stats latest(test_name) AS test_name, latest(agent_name) AS agent_name, latest(agent_lat) AS agent_lat, latest(agent_lon) AS agent_lon, values(hops) AS hops, latest(_time) AS path_time BY path_id
| eval seq=0, lat=agent_lat, lon=agent_lon, hop_ip=agent_name
| append [
    search index=thousandeyes_pathvis sourcetype="cisco:thousandeyes:path-vis" earliest=-1h latest=now
    | dedup test_id sortby - _time
    | eval path_id=test_id."__".tostring(_time)
    | mvexpand hops
    | rex field=hops "hop_number=(?<hop_number>\d+).*?hop_ip=(?<hop_ip>[\d.]+).*?response_time_ms=(?<response_time_ms>[\d.]+).*?loss_percent=(?<loss_percent>[\d.]+)"
    | eval seq=tonumber(hop_number)
    | iplocation hop_ip
    | where isnotnull(lat) AND isnotnull(lon)
    | eval avg_latency_ms=tonumber(response_time_ms)
    | stats latest(test_name) AS test_name, latest(agent_name) AS agent_name, latest(seq) AS seq, latest(lat) AS lat, latest(lon) AS lon, latest(hop_ip) AS hop_ip, latest(avg_latency_ms) AS avg_latency_ms BY path_id, hop_number
  ]
| where isnotnull(lat) AND isnotnull(lon)
| rename path_id AS id
| fields id, seq, lat, lon, test_name, agent_name, hop_ip, avg_latency_ms
| sort id, + seq
| head 1000
```

Why this exact shape, line by line:

- **`index=thousandeyes_pathvis sourcetype=...`** — direct
  query against the path-visualization stream. 1 h window
  covers typical 5-minute test intervals across all enabled
  tests (12 measurements / test / hour). `earliest`/`latest`
  bind to `$global_time$` token in a dashboard.
- **`dedup test_id sortby - _time`** — one freshest
  measurement per test. The intent is "what does the path
  look like RIGHT NOW", not "all historical paths" — the
  recipe is the at-a-glance overview, not the time-series
  drilldown.
- **`eval path_id=test_id."__".tostring(_time)`** — the
  synthetic `pathIdField` value, embedding the measurement
  timestamp so re-dispatches don't collide (two tests with
  the same test_id but different measurements would render
  as overlapping arcs without the timestamp suffix).
- **First branch — agent vertex** — `stats latest(...)` to
  reduce to one row per path, emit `seq=0` with the agent's
  coordinates. This is the START vertex of every path.
- **Second branch — hops** — re-query the same data,
  `mvexpand hops` to one-row-per-hop, `rex` to parse the
  hop record into discrete fields (the on-the-wire shape
  varies across ThousandEyes API versions — see §6
  Gotchas), `iplocation` to geocode each hop IP, then
  `stats latest(...)` to deduplicate by `(path_id,
  hop_number)`.
- **`append`** — concatenates the agent vertex with the
  hop vertices into a single row stream. The result is
  one row per `(test, time, hop)` plus one row per `(test,
  time, agent)`, all sharing the `path_id`.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop any
  hop whose IP failed to geocode (private addresses,
  unrecognised public ranges, MaxMind misses). The path
  is rendered through the hops that DID geocode — a hop
  with no coordinates is silently skipped.
- **`rename path_id AS id`** — Better Map's canonical id
  alias, same convention as every other recipe.
- **`sort id, + seq`** — group rows by path, then order
  within each path by hop sequence. The paths layer
  connects vertices in `seq` order; sorting client-side
  guarantees the polyline draws in the right order.
- **`head 1000`** — render budget. A typical
  ThousandEyes deployment has 20-50 enabled
  path-visualization tests, each producing 5-15 hops,
  so 1000 rows comfortably covers 50 paths × 20 vertices.
  Raise to 5000 for global enterprise deployments with
  hundreds of tests.

## 3. Expected fields

| field            | type    | example                    |
|------------------|---------|----------------------------|
| id               | string  | 12345__1747534800          |
| seq              | integer | 0                          |
| lat              | number  | 37.7749                    |
| lon              | number  | -122.4194                  |
| test_name        | string  | SFO → AWS us-east-1        |
| hop_ip           | string  | 203.0.113.45               |
| avg_latency_ms   | number  | 47.3                       |

Seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
Multiple rows per `id`: one with `seq=0` carrying the agent
vertex, then one row per hop with `seq=1, 2, 3, ...` (per
the ThousandEyes hop_number). `test_name` and `agent_name`
are duplicated across all rows of one path so popups show
full context regardless of which vertex the user hovers;
`hop_ip` and `avg_latency_ms` vary per vertex (the per-hop
detail the popup surfaces).

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#9333ea",
  "pathArrows": true
}
```

Why this minimal config:

- **`pathIdField: "id"`** — REQUIRED. Tells the paths layer
  which column groups vertices into a single polyline. Same
  contract as the
  [cim-network-traffic/paths](../cim-network-traffic/paths.md)
  recipe.
- **`timeField: "seq"`** — REQUIRED. The paths layer sorts
  vertices within each path by this column before
  connecting them. Without it, hops would render in dataset
  order rather than network order — producing zigzag
  spaghetti instead of a clean traceroute polyline.
- **`pathColor: "#9333ea"`** — a saturated purple,
  intentionally different from the
  [cim-network-traffic/paths](../cim-network-traffic/paths.md)
  recipe's calm blue. Dashboards that show BOTH layers
  (NetFlow east-west traffic AND ThousandEyes active
  measurements) want the two layers visually
  distinguishable at a glance — purple reads as "active
  probe", blue as "observed traffic".
- **`pathArrows: true`** — render small arrows along the
  polyline indicating direction (agent → target). For
  traceroute data, direction is essential context —
  without arrows, an inbound and an outbound path look
  identical.
- **`test_name`, `agent_name`, `hop_ip`, `avg_latency_ms`
  flow through automatically** as feature properties on
  each vertex — popups can reference them.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The paths layer is best demoed at globe zoom (so
inter-region traceroutes show their full geographic shape) with
a single test selected via a `$test_id$` dropdown (so the
polyline is clearly distinguishable from siblings). A maintainer
can reproduce by pasting the SPL into a Dashboard Studio map
panel with Better Map as the visualization, applying the
formatter JSON in §4, and selecting any active path-visualization
test that has at least 3 geocodable hops._

## 6. Gotchas

- **Hop field name drift across ThousandEyes API versions.**
  The `hops` multi-value field's internal structure has
  changed across ThousandEyes API versions: pre-v6 used
  `hopNumber` / `hopIp` (camelCase, no separator); v6+ uses
  `hop_number` / `hop_ip` (snake_case). The `rex` line in
  §2 SPL is tuned for v6+. For pre-v6 deployments, swap
  the regex to: `(?<hop_number>\d+).*?hopIp=(?<hop_ip>[\d.]+)...`.
  Run `index=thousandeyes_pathvis | head 1 | table hops`
  to confirm which shape your tenant emits BEFORE adopting
  the recipe — a wrong-version regex produces empty
  `hop_ip` and the recipe silently drops all hops.
- **Hop geocoding hit rate.** Public IPs almost always
  geocode (MaxMind GeoLite2 covers all routed prefixes).
  Private IPs (10/8, 172.16/12, 192.168/16) NEVER geocode
  — they're correctly dropped by the `where isnotnull(lat)`
  filter. The first 1-2 hops on a typical traceroute are
  often private (the agent's local-network gateway, ISP
  edge router), so polylines typically start with `seq=0`
  (the agent) and the first hop with public IP is `seq=N`
  for some N≥2 — visually this looks like the polyline
  "skips" the early hops. If your dashboard's audience
  finds this confusing, add a `splunk.markdown` annotation
  to the panel explaining the geocoding-hit-rate posture.
- **`agent_lat` / `agent_lon` may NOT be in your events.**
  The recipe assumes these fields are present on the
  path-vis event (set by the ThousandEyes app's props.conf
  via a lookup against the agent inventory). If your
  install doesn't have them, fall back to an `| iplocation
  agent_ip` line BEFORE the first `stats` to derive
  coordinates from the agent's public IP. Many enterprise
  agents are NAT'd behind a corporate egress though, so
  the IP-derived agent location can be misleading — the
  ThousandEyes app's agent-inventory lookup is the
  authoritative source.
- **Path width / colour by latency or loss.** The recipe
  surfaces `avg_latency_ms` as a feature property but
  doesn't drive a per-vertex visual via it. To colour-
  ramp the polyline by hop latency, set `pathColorField:
  "avg_latency_ms"` and `palette: "viridis"` — but be
  aware that the paths layer applies path colour per
  POLYLINE (not per vertex), so the colour is averaged
  across hops, not gradiented along the path. For per-
  hop colour, add a `splunk.markers` overlay layer (NOT
  paths) on the same data and colour markers by latency.
- **Measurement interval ≠ polyline refresh rate.**
  ThousandEyes measurements run on 1m / 2m / 5m
  intervals (per-test configurable); the polyline
  re-renders on every dashboard refresh, picking the
  freshest measurement per test (the `dedup test_id
  sortby - _time` line). If you want a "trail" view
  (multiple paths over time, fading out), drop the
  dedup, retain the `path_id=test_id."__".tostring(_time)`
  uniqueness, and let the paths layer render every
  historical polyline simultaneously. Document the
  switch in the dashboard text — a "live current path"
  vs a "trail of recent paths" panel answers different
  questions.
- **No OT safety dependency.** This is an active
  measurement layer for IT-side network paths
  (internet, MPLS, cloud peering). ThousandEyes does
  NOT probe OT zone assets — its measurement model is
  fundamentally active, which is incompatible with the
  passive-only collection contract per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1. If a customer asks for ThousandEyes path
  measurements ACROSS the IT-OT boundary, STOP — the
  probe targets MUST be IT-side endpoints, never any
  asset in the OT zone.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented ThousandEyes
sourcetype shape per [`~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/thousandeyes/paths.md)
and [`~/.cursor/skills/cisco-products/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/thousandeyes/paths.md),
and uses only Splunk built-ins plus the
`ta_cisco_thousandeyes` app. It has not been dispatched
against the v1.7-prep lab tenant because the lab has no
ThousandEyes Center licence and no active measurement
agents. A maintainer with REST auth to a tenant carrying
`ta_cisco_thousandeyes` + at least one configured path-
visualization test should:

1. Confirm path-vis data is flowing:
   `index=thousandeyes_pathvis earliest=-1h | stats count`.
2. Confirm the on-the-wire `hops` field shape:
   `index=thousandeyes_pathvis | head 1 | table hops` —
   inspect to confirm `hop_number` / `hop_ip` snake_case
   or `hopNumber` / `hopIp` camelCase, adjust the §2
   `rex` line accordingly.
3. Run the recipe SPL and confirm at least one path
   renders with `seq=0` + ≥ 2 hop vertices.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "ta_cisco_thousandeyes"` and the agent/test counts),
   and submit a follow-up PR.
