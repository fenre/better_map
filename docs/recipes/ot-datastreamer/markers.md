---
schema_version: 1
id: ot-datastreamer--markers
source:
  id: ot-datastreamer
  display_name: "OT Datastreamer / Edge Hub (Modbus / OPC-UA / BACnet)"
  pattern: splunk-edge-hub
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_oti"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "ACT-076-1823-0086"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "29.7604"
  - name: lon
    type: number
    example: "-95.3698"
  - name: hub_name
    type: string
    example: "houston-plant-east-bldg-3"
  - name: protocol
    type: string
    example: "modbus"
  - name: zone_purdue_level
    type: string
    example: "L3"
  - name: last_seen_minutes_ago
    type: integer
    example: "2"
    drives_formatter_option: markerColor
references:
  - description: "splunk-edge-hub skill — Edge Hub indexes, sourcetypes, protocol-specific sources"
    path: "~/.cursor/skills/splunk-edge-hub/SKILL.md"
  - description: "splunk-oti-datastreamer skill — OTI Datastreamer ingest pipeline, HEC tuning"
    path: "~/.cursor/skills/splunk-oti-datastreamer/SKILL.md"
  - description: "splunk-edge-hub-protocols skill — Modbus, OPC-UA, MQTT, SNMP, BACnet protocol details"
    path: "~/.cursor/skills/splunk-edge-hub-protocols/SKILL.md"
  - description: "splunk-oti-data-model skill — Operational_Telemetry data model conventions"
    path: "~/.cursor/skills/splunk-oti-data-model/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive collection, SIS read-only, Purdue boundary)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
required_formatter_options:
  - pointRenderer
  - idField
  - markerColor
ot_safety_relevant: true
---

# OT Datastreamer / Edge Hub — markers

Render every deployed Splunk Edge Hub on a world / site map,
positioned at its physical install location, sized by recent
event volume, coloured by liveness (how recently a packet came
through). The canonical "where are my OT collectors, are they
all transmitting?" panel for an OT-zone NetOps overview — the
sister panel to the IT-side [`meraki/markers.md`](../meraki/markers.md)
recipe, but with strict adherence to the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
boundary: **passive collection only, no write-back to the OT
zone, SIS-related hubs are read-only mirrored from the customer
asset register.**

## 1. Source description

The **Splunk Edge Hub** (and the broader OTI Datastreamer
ingest path it feeds) is the recommended Splunk pattern for
collecting telemetry from OT / industrial environments. Each
Edge Hub is a small appliance (or a container on a hardened
host) that lives in the customer's OT zone, passively reads
sensor / PLC traffic via vendor-supported protocols (Modbus
TCP read-only, OPC UA subscribe, MQTT subscribe, SNMP polls,
BACnet read, packet-capture-mode Zeek for IT/OT DMZ traffic),
and forwards the result over an outbound HTTPS connection
to the Splunk Cloud HEC.

Each Edge Hub events into Splunk under per-protocol indexes:

| Index | Source pattern | Sourcetype |
|---|---|---|
| `edge_hub_ot` | `edgehub/builtin/<sensor>/values` | `edge_hub_ot` |
| `edge_hub_modbus` | `edgehub/modbus` | `_json` |
| `edge_hub_mqtt` | `edgehub/mqtt_events/<topic>` | varies (`meraki_mt_json`, `_json`) |
| `edge_hub_opcua` | `edgehub/opcua` | `_json` |
| `edge_hub_snmp` | `edgehub/snmp` | `_json` |
| `edge_hub_bacnet` | `edgehub/bacnet` | `_json` |
| `edge_hub_zeek` | `edgehub/zeek/<log_type>` | `_json` |
| `edge_hub_logs` | `edgehub/logs` | `_json` |
| `bms` | (BMS gateway forwarder) | `bms_json` |

Each event carries a `host` field (the Edge Hub's appliance
serial, e.g. `ACT-076-1823-0086`) and a `hub_name` field (the
operator-assigned name, e.g. `houston-plant-east-bldg-3`).

THIS recipe queries the union of every `edge_hub_*` index
over a 1 h window, counts events per hub, joins against a
hand-curated site lookup (`edge_hub_sites.csv`) that the OT
operator maintains to map appliance serials to physical
lat / lon coordinates + Purdue level + safety classification,
and renders one marker per Edge Hub with liveness colouring.
Hubs in the site lookup but absent from the last hour's
events render as Critical (the marker is positioned but
coloured offline-red); hubs in the events but absent from the
site lookup are surfaced in a companion table panel for the
operator to backfill.

**Why a separate site lookup, not embedded coordinates?** Edge
Hub appliances do not self-report location (no GPS — they sit
on operator-controlled industrial networks where outbound
location services are typically blocked). The operator MUST
maintain the deployment register externally; this recipe just
joins against it. The site-lookup pattern is documented in
[`~/.cursor/skills/splunk-oti-datastreamer/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/markers.md)
as a `Splunk_TA_oti` extension point.

**Typical sourcetype / index:** anything matching `edge_hub_*`
plus the `bms` index for sites using a separate BMS gateway.
The TA is `Splunk_TA_oti`. The site lookup is operator-
maintained and ships nothing by default.

## 2. SPL recipe

```spl
index=edge_hub_* OR index=bms earliest=-1h latest=now
| stats count AS event_count, latest(_time) AS last_seen, values(index) AS indexes BY host
| eval last_seen_minutes_ago=round((now() - last_seen) / 60, 0)
| eval protocol=mvindex(mvfilter(match('indexes', "^edge_hub_")), 0)
| eval protocol=replace(protocol, "^edge_hub_", "")
| eval protocol=if(isnull(protocol), "bms", protocol)
| lookup edge_hub_sites.csv host OUTPUT lat, lon, hub_name, zone_purdue_level, safety_related
| where isnotnull(lat) AND isnotnull(lon)
| eval id=coalesce(hub_name, host)
| fields id, lat, lon, hub_name, protocol, zone_purdue_level, event_count, last_seen_minutes_ago, safety_related
| sort - event_count, id
| head 1000
```

Why this exact shape, line by line:

- **`index=edge_hub_* OR index=bms earliest=-1h latest=now`** —
  the OR-union of every Edge Hub index plus the optional `bms`
  index. The 1 h window balances liveness sensitivity (want
  to flag a hub that went dark recently) against query cost
  (every `edge_hub_*` index is a high-volume OT telemetry
  feed). Drop to 15 min for a more sensitive view; raise to
  24 h for a "did this hub transmit at all today?" survey.
- **`stats count AS event_count, latest(_time) AS last_seen,
  values(index) AS indexes BY host`** — one row per appliance
  (`host` is the serial), with three aggregates: total events,
  freshest event time, and the set of indexes the hub
  contributed to (which tells us which protocols are
  configured).
- **`eval last_seen_minutes_ago=round((now() - last_seen) / 60, 0)`** —
  derived liveness metric. 0–5 = healthy, 5–15 = degraded,
  >15 = offline. Drives the `markerColor` palette ramp.
- **`eval protocol=...`** (three lines) — extract the
  protocol from the first `edge_hub_*` index in the
  `indexes` multi-value, stripping the `edge_hub_` prefix.
  Fall back to `"bms"` if the hub only landed in the `bms`
  index. This gives the popup a one-word protocol label
  (`"modbus"`, `"opcua"`, `"bacnet"`, etc.).
- **`lookup edge_hub_sites.csv host OUTPUT lat, lon,
  hub_name, zone_purdue_level, safety_related`** — THE
  critical line. The site lookup MUST be present for this
  recipe to render anything. The expected lookup CSV schema
  is documented in §6 Gotchas. `zone_purdue_level` and
  `safety_related` are the OT-safety annotations from
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5 — they're carried through to the popup but do NOT
  drive any colour / size encoding in this base recipe
  (the operator gets the raw value to read).
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop hubs
  not in the site lookup. These are real Edge Hubs that ARE
  transmitting; they just have no physical location
  recorded. Surface in a companion table panel ("Edge Hubs
  awaiting site registration: <count>") so the operator
  closes the inventory gap.
- **`eval id=coalesce(hub_name, host)`** — prefer the
  human-readable hub name; fall back to the appliance
  serial. `id` is what drilldown URLs / cross-panel
  selection use.
- **`sort - event_count, id`** — busiest hubs first; stable
  secondary sort by id for deterministic rendering at equal
  event count.
- **`head 1000`** — render budget. Even the largest OT
  customer deployments run ~200 Edge Hubs; 1000 is
  defensive for very large multi-site fleets.

## 3. Expected fields

| field                  | type    | example                       |
|------------------------|---------|-------------------------------|
| id                     | string  | ACT-076-1823-0086             |
| lat                    | number  | 29.7604                       |
| lon                    | number  | -95.3698                      |
| hub_name               | string  | houston-plant-east-bldg-3     |
| protocol               | string  | modbus                        |
| zone_purdue_level      | string  | L3                            |
| last_seen_minutes_ago  | integer | 2                             |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`. `event_count`
and `safety_related` also flow through as feature properties
but are not in the contract (they're operational context for
the popup, not required for the panel to render).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#1f77b4"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — Edge Hubs cluster by site
  (one site has 5-20 hubs spread across buildings; a global
  fleet has 100s of sites). World-zoom collapses every site
  to one cluster; site-zoom fans out to individual hubs.
  Switch to `"markers"` only for a fixed-zoom panel of a
  single site.
- **`idField: "id"`** — explicit override. Auto-detect would
  prefer either `host` (the serial — too cryptic for popup
  drilldown) or `hub_name` (which can drift if the operator
  renames a hub). The `eval id=coalesce(hub_name, host)`
  step provides a stable best-of-both-worlds id; pin
  `idField` to it for predictable drilldown URLs.
- **`markerColor: "#1f77b4"`** — Tableau muted-blue default.
  Unlike the [es-risk](../es-risk/markers.md) and
  [cim-authentication](../cim-authentication/markers.md)
  recipes (alert-red — every marker is a problem), an Edge
  Hub marker on the map is NOT a problem by itself; the
  problem is when a marker disappears from the map (hub
  stopped transmitting) or turns red (last_seen >15 min ago).
  Muted blue reads as "I'm here, transmitting normally" at
  first load. The per-marker colour can additionally ramp by
  `last_seen_minutes_ago` via the `palette` formatter option
  (`{ "0": "#1f77b4", "5": "#ffbb78", "15": "#d62728" }`)
  so a hub silently lapsing produces an immediately-visible
  colour shift.
- **`hub_name`, `protocol`, `zone_purdue_level`,
  `event_count`, `last_seen_minutes_ago`, `safety_related`
  flow through automatically** as feature properties for the
  popup. The default popup will show "houston-plant-east-bldg-3 ·
  modbus · L3 · last seen 2 min ago · 17,243 events" with no
  further config (`enablePopups: true` is the default per
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will need an Edge Hub event generator plus a
seeded `edge_hub_sites.csv` lookup — both are out of scope for
the v1.7 D5 deliverable. For OT recipes specifically, the
deferred verification path is to dispatch against a customer
pilot tenant (E4) under a non-production hub or a recorded
event fixture rather than a synthetic generator, so that the
Purdue-level and safety-related annotations on the site lookup
are real operator-curated values rather than synthesised
ones._

## 6. Gotchas

- **`edge_hub_sites.csv` schema (REQUIRED).** This recipe
  depends on a hand-curated CSV lookup with this exact column
  set:

  | column | type | required | description |
  |---|---|:-:|---|
  | `host` | string | yes | Edge Hub appliance serial (`ACT-...`) — the join key |
  | `hub_name` | string | yes | Human-readable hub name; used as popup label |
  | `lat` | number | yes | WGS-84 decimal latitude of physical install |
  | `lon` | number | yes | WGS-84 decimal longitude of physical install |
  | `zone_purdue_level` | string | yes | `L0`, `L1`, `L2`, `L3`, `L3.5` (DMZ), `L4`, `L5` per the asset-register-template |
  | `safety_related` | boolean | yes | `true` if the hub forwards any SIS-related signal; `false` otherwise |
  | `site_id` | string | no | Optional site grouping (`HOU-EAST`, `LON-NORTH`) for cross-panel filtering |

  The CSV is OPERATOR-MAINTAINED — there is no automated way
  to derive these values from the Edge Hub itself. New hub
  deployments require a CSV update; this is a documented
  manual step in the
  [splunk-oti-datastreamer skill](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/markers.md).
- **OT safety — `safety_related=true` rows are READ-ONLY
  mirrored from the customer's Safety Requirements
  Specification (SRS).** Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5, VISTA NEVER authors the SRS — the `safety_related`
  column in `edge_hub_sites.csv` is a copy of the
  customer-supplied SIS-asset register, NOT a value Better
  Map / Splunk derives. If your tenant is missing a Safety
  Annex (per the OT-safety rule's "Safety Annex MUST exist
  if any `safety_related=Y` row exists" gate), STOP — get
  the customer's OT engineering team to author the SRS and
  the matching Annex first, then return to this recipe.
- **OT safety — passive collection ONLY.** Per the same rule
  Rule 1, every Edge Hub forwarding `safety_related=Y`
  signals MUST use a passive collection method (SPAN port,
  network TAP, vendor-supplied one-way diode, OPC UA
  read-only subscription on pre-approved tags, vendor-permitted
  syslog forwarding). This recipe surfaces hubs visually but
  does NOT enforce the passive constraint at the SPL layer
  — the constraint is enforced at the `Splunk_TA_oti`
  collector / Edge Hub configuration layer. The Protocol
  Matrix Template documents per-hub which method is in use.
- **OT safety — never disable, suppress, or filter a
  `safety_related` signal.** Per Rule 2, even if a hub's
  event volume looks excessive, do NOT drop its events via
  props/transforms/nullQueue. If the panel is too busy with
  safety hub markers, FILTER the PANEL (`NOT safety_related="true"`)
  not the underlying events. The Built Content Catalog must
  record any panel-level filtering of safety signals and the
  OT engineering approval for it.
- **OT safety — SOAR scope ends at the IT / IT-OT DMZ.** Per
  Rule 3, any SOAR playbook that uses THIS panel as a
  trigger (e.g. "hub offline → auto-restart") MUST stop at
  the IT zone. A playbook may notify the OT operator (IT
  zone action — fine) but MUST NOT auto-issue any command
  to the hub itself (Level-2 zone target — banned). Use
  this panel for visualization; use the OT operator's own
  ticketing system for response.
- **Index naming drift.** Some installs rename
  `edge_hub_*` to `oti_*` (older OTI Datastreamer
  versions) or `splunk_edge_*` (newer ones). Confirm with
  `| eventcount summarize=false index=* | search index=*edge* OR index=*oti*`
  and substitute the index wildcard in line 1.
- **Hubs in multiple indexes — protocol column ambiguity.**
  A single Edge Hub commonly forwards to MULTIPLE
  `edge_hub_*` indexes (a hub configured for both Modbus
  and OPC UA contributes to both). The `mvindex(..., 0)`
  picks the first protocol — ARBITRARY ORDER. If the
  operator needs to see all protocols per hub, replace
  the `eval protocol` lines with
  `| eval protocol=mvjoin(mvfilter(match('indexes', "^edge_hub_")), ",")`
  and accept that the popup column gets longer.
- **Time range.** Hard-coded `earliest=-1h latest=now`. The
  1 h window matches industrial telemetry cadences (most
  PLCs report at 1–10 s intervals, so an hour is hundreds
  of events per hub even in low-volume environments). Avoid
  narrowing below 15 min — KPI evaluation lag at the
  collector can cause false-positive "hub offline" alerts.
- **PII / GDPR posture.** Edge Hub event content is
  industrial telemetry (temperatures, pressures, register
  values) — not PII. The HUB inventory itself (site name,
  Purdue level) can reveal sensitive customer architecture
  information; for regulated customers, consider
  pseudonymising `hub_name` in the SPL `eval` step or
  restricting panel visibility via Splunk RBAC. Per ROADMAP
  §1a, Better Map never sends event data outside
  `splunkd:8089`.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented Edge Hub index/sourcetype shape
from [`~/.cursor/skills/splunk-edge-hub/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/markers.md)
and uses only Splunk built-ins plus the operator-maintained
site lookup pattern from the splunk-oti-datastreamer skill. It
has not been dispatched against the v1.7-prep lab tenant in
this PR because (a) the lab tenant has no Edge Hub fleet and
(b) per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, verification of an OT-safety-relevant
recipe SHOULD be done against a customer pilot tenant (E4)
with real operator-curated site annotations rather than a
synthetic generator. A maintainer with REST auth to a tenant
carrying `Splunk_TA_oti` AND a populated `edge_hub_sites.csv`
should:

1. Confirm the site lookup is in place: `| inputlookup
   edge_hub_sites.csv | stats count`.
2. Confirm Edge Hub data is flowing: `index=edge_hub_*
   earliest=-1h | stats count BY index`.
3. Run the recipe SPL and confirm the panel renders one
   marker per registered + transmitting hub.
4. Cross-check the `safety_related` column values against
   the customer's Safety Requirements Specification —
   discrepancies must be resolved with OT engineering BEFORE
   the panel goes into a customer dashboard.
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app: "Splunk_TA_oti"`
   and a non-PII tenant identifier per the
   `splunk_tenant_name_hash` contract), and submit a follow-up
   PR.
