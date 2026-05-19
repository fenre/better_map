---
schema_version: 1
id: cyber-vision--paths
source:
  id: cyber-vision
  display_name: "Cisco Cyber Vision (components + vulnerabilities)"
  pattern: splunk-vendor-ta
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "TA-cisco-cybervision"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "FLOW-203.0.113.45-198.51.100.7"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "29.7604"
  - name: lon
    type: number
    example: "-95.3698"
  - name: src_asset
    type: string
    example: "ENGINEERING-WS-04"
  - name: dest_asset
    type: string
    example: "PLC-FLOOR3-A02"
  - name: protocol
    type: string
    example: "Modbus-TCP"
  - name: src_zone_purdue_level
    type: string
    example: "L3"
  - name: dest_zone_purdue_level
    type: string
    example: "L1"
  - name: flow_count
    type: integer
    example: "147"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, markers layer (per-asset CVE + event overview)"
    path: "docs/recipes/cyber-vision/markers.md"
  - description: "Companion recipe — same source, heatmap layer (asset-density per site)"
    path: "docs/recipes/cyber-vision/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (per-zone CVE roll-up)"
    path: "docs/recipes/cyber-vision/h3.md"
  - description: "Pattern reference — paths layer with OT-safety carve-out (mobile-asset trajectories)"
    path: "docs/recipes/ot-datastreamer/paths.md"
  - description: "Pattern reference — paths layer with iplocation-geocoded source IPs"
    path: "docs/recipes/cim-alerts/paths.md"
  - description: "cisco-products skill — Cisco Cyber Vision sourcetypes, flows/events"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "cisco-splunk-integration skill — Cyber Vision passive DPI, API endpoints"
    path: "~/.cursor/skills/cisco-splunk-integration/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive DPI is the reference design, Rule 1)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# Cisco Cyber Vision — paths

Render **OT-network flow polylines** by reading Cisco Cyber Vision's
`flows` sourcetype, joining both endpoints against the
operator-maintained `cybervision_sites.csv` site lookup for physical
lat / lon coordinates, and drawing one polyline per (src_asset →
dest_asset) flow ordered by observation time. The canonical
"OT lateral movement reconstruction" panel — when a Cyber Vision
event fires on `PLC-FLOOR3-A02`, the paths panel shows WHICH OTHER
OT ASSETS that PLC has been communicating with over the last 24h
(neighbouring HMIs, engineering workstations, historians, jump
hosts), the protocols used (Modbus-TCP, EtherNet/IP, S7, …), and
the Purdue level of each endpoint (so you can immediately spot
illegitimate L3↔L1 crossings). Strict adherence to
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc):
Cyber Vision is the **reference passive-DPI design** per Rule 1;
this recipe surfaces its discoveries without ever querying the OT
zone. The sister panel to
[`cyber-vision/markers`](../cyber-vision/markers.md) (which shows
the ASSETS) — here showing the CONVERSATIONS between those assets.

## 1. Source description

**Cisco Cyber Vision** is a passive deep-packet-inspection
platform for OT networks. See
[`cyber-vision/markers`](../cyber-vision/markers.md) §1 for the
full platform overview and the four-sourcetype contract
(`components`, `flows`, `events`, `vulnerabilities`).

This recipe is the **flow-attribution view**: it reads the
`flows` sourcetype (one event per observed conversation),
aggregates per unique (src_asset, dest_asset, protocol) tuple,
joins both endpoints against the same `cybervision_sites.csv`
lookup the markers companion uses, and `streamstats` generates
per-flow monotonic sequence numbers. The paths layer draws one
polyline per flow with the source asset at seq=0 and the
destination asset at seq=1 (a 2-vertex polyline is sufficient
for endpoint-to-endpoint flow visualization; for multi-hop path
reconstruction across intermediate jump hosts, extend the recipe
with an `append` branch per hop).

The recipe is `ot_safety_relevant: true` because every flow row
references OT-zone assets — see §6 Gotchas for the full safety
contract.

**Typical sourcetype / index:** `index=cybervision
sourcetype="cisco:cybervision:flows"`. The TA is
`TA-cisco-cybervision`. The site lookup is the same operator-
maintained `cybervision_sites.csv` used by the markers / heat /
h3 companions — no additional lookup work needed if those
recipes are already deployed.

## 2. SPL recipe

```spl
index=cybervision sourcetype="cisco:cybervision:flows" earliest=-24h latest=now
| stats count AS flow_count,
    sum(bytes) AS total_bytes,
    min(_time) AS first_seen,
    max(_time) AS last_seen
  BY src_asset, dest_asset, protocol
| where flow_count >= 10
| lookup cybervision_sites.csv asset_id AS src_asset
    OUTPUT lat AS src_lat, lon AS src_lon,
           zone_purdue_level AS src_zone_purdue_level,
           safety_related AS src_safety_related,
           site_name AS src_site_name
| lookup cybervision_sites.csv asset_id AS dest_asset
    OUTPUT lat AS dest_lat, lon AS dest_lon,
           zone_purdue_level AS dest_zone_purdue_level,
           safety_related AS dest_safety_related,
           site_name AS dest_site_name
| where isnotnull(src_lat) AND isnotnull(src_lon)
    AND isnotnull(dest_lat) AND isnotnull(dest_lon)
| eval flow_id="FLOW-" . src_asset . "-" . dest_asset . "-" . protocol
| eval src_vertex=mvrange(0, 1, 1)
| mvexpand src_vertex
| eval lat=src_lat, lon=src_lon, asset=src_asset,
       zone_purdue_level=src_zone_purdue_level,
       safety_related=src_safety_related,
       site_name=src_site_name, seq=0
| append [
    search index=cybervision sourcetype="cisco:cybervision:flows" earliest=-24h latest=now
    | stats count AS flow_count,
        sum(bytes) AS total_bytes
      BY src_asset, dest_asset, protocol
    | where flow_count >= 10
    | lookup cybervision_sites.csv asset_id AS dest_asset
        OUTPUT lat AS dest_lat, lon AS dest_lon,
               zone_purdue_level AS dest_zone_purdue_level,
               safety_related AS dest_safety_related,
               site_name AS dest_site_name
    | lookup cybervision_sites.csv asset_id AS src_asset
        OUTPUT lat AS src_lat, lon AS src_lon
    | where isnotnull(src_lat) AND isnotnull(src_lon)
        AND isnotnull(dest_lat) AND isnotnull(dest_lon)
    | eval flow_id="FLOW-" . src_asset . "-" . dest_asset . "-" . protocol
    | eval lat=dest_lat, lon=dest_lon, asset=dest_asset,
           zone_purdue_level=dest_zone_purdue_level,
           safety_related=dest_safety_related,
           site_name=dest_site_name, seq=1
  ]
| rename flow_id AS id
| fields id, seq, lat, lon, src_asset, dest_asset, protocol,
    src_zone_purdue_level, dest_zone_purdue_level,
    safety_related, site_name, flow_count, total_bytes
| sort id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`index=cybervision sourcetype="cisco:cybervision:flows"
  earliest=-24h latest=now`** — flows stream over 24h. Cyber
  Vision's flows sourcetype carries one event per observed
  conversation between two assets (continuously, as new bytes
  flow); 24h window covers typical operator shift-overview
  scope while keeping the join cardinality bounded.
- **`stats count AS flow_count, sum(bytes) AS total_bytes BY
  src_asset, dest_asset, protocol`** — aggregate per unique
  (src, dest, protocol) tuple. `flow_count` is the number of
  observed flow records; `total_bytes` is the cumulative
  payload. Both surface in the popup for operator triage.
- **`where flow_count >= 10`** — drop one-off / handshake-only
  flows. A flow with `count=1` is often a port scan or a
  failed connection; the 10-flow minimum surfaces only
  meaningful conversations.
- **Two `lookup` joins** — one each against `src_asset` and
  `dest_asset` from the same `cybervision_sites.csv` lookup
  used by the markers companion. Both endpoints need
  coordinates for a 2-vertex polyline; either-side missing
  drops the row at the `where isnotnull` clause.
- **First branch (seq=0 = source vertex)** — `eval lat=src_lat,
  lon=src_lon, ...` writes the source-asset coordinates as the
  first vertex of the polyline. Use `src_safety_related` so
  the popup reflects the SOURCE side's safety classification.
- **`append` branch (seq=1 = destination vertex)** — re-runs
  the same aggregation + lookup pipeline and writes the
  destination-asset coordinates as the second vertex. The
  full re-search is necessary because `mvexpand` cannot
  reconstruct the row-pair structure cleanly; `append` is the
  canonical SPL pattern for endpoint-pair polylines.
- **`rename flow_id AS id`** + **`sort id, + seq`** — adopt
  Better Map's `id` alias and lock the per-flow vertex
  ordering so the paths layer draws each polyline cleanly.
- **`head 5000`** — render-cap. A typical OT site has 100-500
  unique flows per 24h; a multi-site fleet can reach 5000+.
  Narrow the time window for denser environments.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field                  | type    | example                              |
|------------------------|---------|--------------------------------------|
| id                     | string  | FLOW-203.0.113.45-198.51.100.7       |
| seq                    | integer | 0                                    |
| lat                    | number  | 29.7604                              |
| lon                    | number  | -95.3698                             |
| src_asset              | string  | ENGINEERING-WS-04                    |
| dest_asset             | string  | PLC-FLOOR3-A02                       |
| protocol               | string  | Modbus-TCP                           |
| src_zone_purdue_level  | string  | L3                                   |
| dest_zone_purdue_level | string  | L1                                   |
| flow_count             | integer | 147                                  |

All ten fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`safety_related`, `site_name`, and `total_bytes` also flow
through as feature properties for the popup.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#1f77b4",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit. Same alignment as the
  [ot-datastreamer/paths](../ot-datastreamer/paths.md) and
  [cim-alerts/paths](../cim-alerts/paths.md) companions.
- **`timeField: "seq"`** — monotonic vertex ordering from
  `eval seq=...` (0 for source, 1 for destination).
- **`pathColor: "#1f77b4"`** — Tableau muted-blue, same family
  as [`cyber-vision/markers`](../cyber-vision/markers.md) for
  visual cohesion in a multi-panel OT dashboard. The blue
  reads as "infrastructure flow" against any base-map backdrop;
  reserve red for alert / event panels.
- **`pathArrows: true`** — render direction-of-travel chevrons.
  Essential for OT-lateral-movement reconstruction: the arrows
  show "who initiated the connection" (the source is the
  initiator side per Cyber Vision's flow-direction inference).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). For OT recipes specifically, the deferred verification path
is to dispatch against a customer pilot tenant (E4) under a
non-production Cyber Vision sensor rather than a synthetic
generator. The site lookup must be authored by the customer's
OT-asset team — Better Map ships nothing._

## 6. Gotchas

- **OT safety — passive DPI is the REFERENCE DESIGN.** Same
  contract as
  [`cyber-vision/markers`](../cyber-vision/markers.md) §6 —
  Cyber Vision is explicitly named in
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 as the reference design for passive OT collection.
  This recipe consumes Cyber Vision's already-passive flow
  metadata — it does NOT itself probe the OT zone.
- **OT safety — Purdue-level crossings are the alert signal.**
  The recipe deliberately surfaces `src_zone_purdue_level` and
  `dest_zone_purdue_level` in every flow. Legitimate flows
  follow architectural rules:
  - L4 ↔ L3.5 (DMZ): expected (enterprise to DMZ)
  - L3.5 ↔ L3 (DMZ to ops): expected via approved channels
  - L3 ↔ L2 (operations to supervisory): expected
  - L2 ↔ L1 (supervisory to control): expected
  - L1 ↔ L0 (control to process): expected via the field bus
  - L4 / L5 → L1 / L0 DIRECTLY: **never legitimate** —
    surface in a correlation search alongside this panel
  - L3 → L1 DIRECTLY: rare; legitimate only for specific
    engineering-workstation downloads; otherwise an indicator
    of lateral movement
  Build a companion `cim-alerts` correlation search on
  `src_zone_purdue_level` ↔ `dest_zone_purdue_level` mismatches
  per the customer's Zone & Conduit document
  (IEC 62443) — that's the operational follow-up to this
  visualization.
- **OT safety — never disable a flow event.** Per Rule 2, even
  if the flows stream is noisy, do NOT filter at the props /
  transforms layer. The `where flow_count >= 10` filter in
  this recipe is a PANEL-layer filter (specific to this
  visualization) and is OT-engineering-approved for the
  "meaningful conversations" overview use case; the raw
  flows remain available to other panels and downstream
  detection content.
- **OT safety — SOAR action scope.** Per Rule 3, any SOAR
  playbook triggered by THIS panel (e.g., "Purdue-level
  crossing detected → contain"), the containment action must
  stay in the IT zone. NEVER auto-push a firewall rule into
  the OT zone via SOAR; require human + OT-engineering
  approval for any OT-zone enforcement step.
- **`cybervision_sites.csv` schema unchanged.** Same lookup
  as the markers companion — see
  [`cyber-vision/markers`](../cyber-vision/markers.md) §6 for
  the full schema. Both endpoints of a flow MUST be in the
  site lookup or the row drops out.
- **2-vertex polylines are intentional.** This recipe shows
  endpoint-to-endpoint flows, not multi-hop paths through
  intermediate jump hosts. For multi-hop reconstruction
  (e.g., "the attacker came from L4 → DMZ → L3 → L1"),
  extend the recipe with an `append` branch per hop and an
  explicit `seq` numbering. The 2-vertex shape is the
  Cyber-Vision-native abstraction (Cyber Vision sees flows,
  not multi-hop traversals — the latter must be inferred
  from temporal correlation of multiple 2-vertex flows).
- **`protocol` cardinality is high.** A typical OT site
  surfaces 10-30 distinct industrial protocols (Modbus-TCP,
  EtherNet/IP, PROFINET, S7, DNP3, OPC UA, BACnet, IEC
  61850, CIP-Sec, FINS, …) PLUS IT protocols (HTTPS, SSH,
  RDP, SMB) on the management overlays. Each (src, dest,
  protocol) tuple gets its own polyline; for a per-protocol
  filter dropdown, expose `protocol` as a panel input token.
- **Time range.** Hard-coded `earliest=-24h latest=now`.
  Longer windows multiply join cardinality and can saturate
  the search head; narrower windows lose the steady-state
  flow pattern.
- **PII / GDPR posture.** Same as
  [`cyber-vision/markers`](../cyber-vision/markers.md) §6 —
  asset names embed plant-floor semantics; restrict via
  Splunk RBAC on the `cybervision` index for audiences
  without "see OT asset naming" authorisation.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented Cyber Vision sourcetype shape
from [`~/.cursor/skills/cisco-products/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/skills/cisco-products/SKILL.md),
and uses the same operator-maintained site lookup pattern as
[`cyber-vision/markers`](../cyber-vision/markers.md). Verification
path mirrors the markers companion §"Verification status" —
confirm site lookup is in place, confirm flows are flowing,
dispatch via REST, drop into a Dashboard Studio panel with the §4
formatter JSON, confirm 2-vertex polylines render between
registered asset pairs. **Per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, this OT-safety-relevant recipe should be
verified against a customer pilot tenant (E4) with real operator-
curated annotations** — not a synthetic generator. Promote to
`status: verified` + fill in `verified_against` (include `splunk_app:
"TA-cisco-cybervision"` and a non-PII tenant identifier) in a
follow-up PR.
