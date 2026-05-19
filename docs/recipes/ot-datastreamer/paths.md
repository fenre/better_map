---
schema_version: 1
id: ot-datastreamer--paths
source:
  id: ot-datastreamer
  display_name: "OT Datastreamer / Edge Hub (Modbus / OPC-UA / BACnet)"
  pattern: splunk-edge-hub
layer:
  id: paths
  display_name: Paths
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_oti"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "AGV-007__1747534800"
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
  - name: asset_id
    type: string
    example: "AGV-007"
  - name: zone_purdue_level
    type: string
    example: "L2"
  - name: speed_mps
    type: number
    example: "1.8"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, markers layer (point-in-time AP / sensor inventory)"
    path: "docs/recipes/ot-datastreamer/markers.md"
  - description: "Companion recipe — same source, heatmap layer (smooth telemetry-density)"
    path: "docs/recipes/ot-datastreamer/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (per-zone roll-up)"
    path: "docs/recipes/ot-datastreamer/h3.md"
  - description: "Pattern reference — paths layer with iplocation-geocoded hops"
    path: "docs/recipes/thousandeyes/paths.md"
  - description: "Pattern reference — paths layer with first/last vertex append"
    path: "docs/recipes/cim-network-traffic/paths.md"
  - description: "splunk-edge-hub skill — Edge Hub indexes, sourcetypes, GPS-tagged mobile asset patterns"
    path: "~/.cursor/skills/splunk-edge-hub/SKILL.md"
  - description: "splunk-oti-datastreamer skill — OTI Datastreamer ingest pipeline, HEC tuning"
    path: "~/.cursor/skills/splunk-oti-datastreamer/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive collection, SIS read-only, Purdue boundary)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — paths (time-scrubber / comet trail)"
    path: "docs/reference/layers.md"
---

# OT Datastreamer / Edge Hub — paths (mobile-asset trajectories)

Render the **historical trajectory** of mobile OT assets (AGVs,
forklifts, mobile inspection robots, vehicle telematics, drones,
roving workers wearing GPS-tagged safety beacons) as polylines
on a facility / yard / outdoor-fleet map. Each polyline shows
one asset's path over a time window — vertices are timestamped
position samples from a GPS or beacon-based location source
that the Edge Hub ingests passively. Distinct from the
[ot-datastreamer/markers](./markers.md) recipe (which renders
point-in-time AP / sensor inventory — fixed-location collectors,
not mobile assets), the [heat](./heat.md) companion (which
renders smooth telemetry density across a facility), and the
[h3](./h3.md) companion (which renders per-zone roll-up).

The right shape for **fleet movement audit panels** ("where did
our AGV fleet move during last shift?"), **yard-management
visibility** ("where are the trucks queued at our shipping
yard right now?"), **safety-incident reconstruction** ("what
was the trajectory of the mobile-inspection-robot leading up to
the e-stop event?"), and **OT-asset chain-of-custody trails**
("which equipment was moved where, when, and by which operator").

This is the **4th layer cell on the ot-datastreamer source
row**, completing markers / heat / h3 → markers / heat / h3 /
paths. **OT-safety relevant** — see §6 Gotchas for the strict
passive-collection / Level-0-not-Level-1-or-2 / SIS-related
asset carve-out.

## 1. Source description

The **Splunk Edge Hub** (and the broader OTI Datastreamer
ingest path it feeds) can passively ingest GPS-tagged mobile
asset telemetry from a variety of sources:

| Asset class | Wire protocol | Edge Hub input | Resulting fields |
|---|---|---|---|
| AGV / mobile robot | MQTT (manufacturer SDK) | `edge_hub_mqtt` | `asset_id`, `lat`, `lon`, `speed_mps`, `heading_deg`, `_time` |
| Vehicle telematics | OBD-II → MQTT | `edge_hub_mqtt` | `vehicle_id`, `lat`, `lon`, `speed_kph`, `_time` |
| GPS-tagged worker beacon | LoRaWAN → MQTT | `edge_hub_mqtt` | `beacon_id`, `lat`, `lon`, `battery_pct`, `_time` |
| Drone (DJI / Parrot SDK) | Manufacturer SDK → MQTT | `edge_hub_mqtt` | `drone_id`, `lat`, `lon`, `altitude_m`, `_time` |
| Fixed-position sensor with sub-meter movement (e.g. crane positioning) | OPC UA | `edge_hub_opcua` | `node_id`, `position_x`, `position_y`, `position_z`, `_time` (would need OPC-UA-side coordinate-system → WGS84 transform) |

All sources have in common: **a unique asset identifier
(asset_id, vehicle_id, beacon_id, drone_id), a timestamp
(_time or a dedicated field), and a lat/lon pair**. The recipe
groups rows by asset_id, orders by _time, and emits the polyline
contract the paths layer consumes.

**Why paths for OT.** Per-asset trajectories are useful for:
- **Operational visibility** — "Where is AGV-007 right now,
  and where has it been in the last shift?"
- **Safety reconstruction** — "What was the path leading up
  to the incident timestamp?" (post-incident trajectory
  replay is a core OT safety-investigation pattern, per
  ISA/IEC 62443-2-4 §SR 6.1 "audit record generation")
- **Process-optimization analysis** — "Which AGV routes
  generate the most idle-time? Are there path bottlenecks
  we should address with floor-layout changes?"
- **Anomaly detection** — "Has any mobile asset entered a
  zone it shouldn't be in, or stayed in a zone too long?"

Distinct from a markers panel (one dot per asset at last
known position) and a heatmap panel (smooth density of where
assets have been). Paths surface the TEMPORAL ORDERING that
markers and heat both collapse.

**Typical sourcetype / index:** `sourcetype="edge_hub_mqtt"`,
`index=edge_hub_mqtt` (Edge Hub default for MQTT-based
ingest). Source path: `edgehub/mqtt_events/<asset-topic>`.

## 2. SPL recipe

```spl
index=edge_hub_mqtt sourcetype="edge_hub_mqtt" source="edgehub/mqtt_events/agv/*" earliest=-1h latest=now
| where isnotnull(lat) AND isnotnull(lon)
| where isnotnull(asset_id)
| eval path_id=asset_id."__".tostring(relative_time(now(), "-1h"))
| sort 0 asset_id, _time
| streamstats current=true count AS seq BY path_id
| eval seq=seq-1
| eval zone_purdue_level=coalesce(zone_purdue_level, "L2")
| rename path_id AS id
| fields id, seq, lat, lon, asset_id, zone_purdue_level, speed_mps, _time
| head 5000
```

Why this exact shape, line by line:

- **`index=edge_hub_mqtt sourcetype="edge_hub_mqtt"
  source="edgehub/mqtt_events/agv/*"`** — narrow to the
  MQTT-AGV input only (the source path is the Edge Hub
  convention for per-topic-class routing — see the
  `splunk-edge-hub` skill (`~/.cursor/skills/splunk-edge-hub/SKILL.md`)
  for the full path schema). For a multi-asset-class
  trajectory panel (AGVs + vehicles + drones), broaden
  the source pattern to `edgehub/mqtt_events/(agv|vehicle|drone)/*`
  and add an `asset_class` field via `eval`.
- **`earliest=-1h latest=now`** — a 1-hour window for a
  shift-overview panel. For a per-asset incident
  reconstruction, narrow to the 5-10 minute window
  around the incident timestamp; for a daily-summary
  panel, broaden to `-24h`.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  rows missing coordinates. MQTT topics can publish
  partial messages (e.g. battery-only updates without
  GPS); without this filter the polyline would render
  with gaps.
- **`where isnotnull(asset_id)`** — drop rows missing
  the per-asset identifier. Defensive — without `asset_id`
  the `path_id` would be NULL and all rows would collapse
  into a single tangled polyline.
- **`eval path_id=asset_id."__".tostring(relative_time(now(), "-1h"))`** —
  the synthetic `pathIdField` value. Each asset gets ONE
  polyline per hour-window, identified by `<asset_id>__<windowstart_epoch>`.
  This prevents per-asset polylines from different time
  windows from being conflated if the panel time-window
  changes (the `relative_time(now(), "-1h")` value is
  stable for the duration of a search).
- **`sort 0 asset_id, _time`** — group rows by asset,
  then order chronologically within each asset. The
  `sort 0` directive disables the result-row cap (default
  10000); for a 1-hour window with 30-second GPS samples
  across 50 AGVs the row count is ~6000 — well within the
  unbounded sort budget.
- **`streamstats current=true count AS seq BY path_id`** —
  assign a per-path sequence number to each vertex. The
  paths layer renders polylines in `seq` order (or `_time`
  order if `timeField=_time`); using `seq` gives stable
  ordering even when GPS samples have duplicate timestamps
  (common with high-frequency sources).
- **`eval seq=seq-1`** — make `seq` zero-indexed (start
  vertex = 0). Matches the convention from the
  [thousandeyes/paths](../thousandeyes/paths.md) and
  [cim-network-traffic/paths](../cim-network-traffic/paths.md)
  companions.
- **`eval zone_purdue_level=coalesce(zone_purdue_level, "L2")`** —
  defensive fallback for the Purdue-zone field. The Edge
  Hub MQTT input may NOT populate this field for non-OT-
  enriched topics; default to "L2" (operations / SCADA-
  HMI zone) is the safe assumption for an AGV fleet (AGVs
  are L2 assets per ISA-95). Document the convention in
  the panel description.
- **`rename path_id AS id`** — Better Map's canonical
  `id` alias for the per-polyline grouping field.
- **`fields ...`** — explicit projection. Drops MQTT
  envelope fields (`mqtt_topic`, `mqtt_qos`, `client_id`)
  and Edge Hub metadata (`hub_name`, `protocol`) that
  don't help the polyline render. Keeps the Purdue-zone
  field for popup display.
- **`head 5000`** — render budget. The paths layer
  scales to ~50k vertices × 200 frames per the
  [layers reference](https://github.com/fenre/better_map/blob/main/docs/reference/layers.md);
  5000 vertices comfortably covers 50 assets × 100
  vertices/asset (33 seconds per vertex × 1 hour
  window). Raise to 25000 for a large fleet (200+
  assets) or a longer window.

Every `|` starts its own physical line per the SPL pipe-
per-line contract.

## 3. Expected fields

| field             | type    | example              |
|-------------------|---------|----------------------|
| id                | string  | AGV-007__1747531200  |
| seq               | integer | 0                    |
| lat               | number  | 29.7604              |
| lon               | number  | -95.3698             |
| asset_id          | string  | AGV-007              |
| zone_purdue_level | string  | L2                   |
| speed_mps         | number  | 1.8                  |

Seven fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
Multiple rows per `id`: one row per (asset, time) vertex,
all sharing the same `id`. The polyline is rendered by
joining vertices in `seq` order. `asset_id` and `speed_mps`
flow through to the per-vertex popup; `zone_purdue_level`
drives the OT-safety annotation overlay.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#10b981",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — tells Better Map which field
  groups rows into one polyline. Every row with the same
  `id` value becomes one connected polyline. Required —
  without this, all rows render as a single tangled
  multi-asset polyline.
- **`timeField: "seq"`** — tells Better Map which field
  to order vertices by within each polyline. Using `seq`
  (the streamstats-derived sequence number) is more
  reliable than `_time` because it's strictly monotonic
  even when GPS samples have duplicate timestamps.
- **`pathColor: "#10b981"`** — emerald green, chosen
  for OT-fleet trajectories (distinct from the
  ThousandEyes-purple `#9333ea` and the CIM-network-traffic
  blue `#3b82f6` paths recipes). For a multi-asset-class
  panel with different colours per class, drive `pathColor`
  via a per-row eval (`eval pathColor=case(asset_class=="agv","#10b981",asset_class=="vehicle","#f59e0b",...)`)
  and pin `pathColorField` in the formatter.
- **`pathArrows: true`** — directional arrows along the
  polyline indicate the asset's direction of travel.
  Critical for safety-reconstruction panels where the
  direction of approach to an incident location matters
  (e.g. "did the AGV approach from north or south?").

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5) + a real Edge Hub + MQTT-AGV simulation.
Reproduces the panel via the
[`~/.cursor/skills/cisco-edge-intelligence/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/paths.md)
demo data generator (AGV trajectories around a synthetic
warehouse floor)._

## 6. Gotchas

- **OT-SAFETY: passive collection only.** The recipe
  assumes the Edge Hub ingests AGV / vehicle / mobile-
  asset GPS telemetry via PASSIVE means only — MQTT
  subscribe to a topic the asset publishes to, OPC UA
  subscribe to a tag the PLC reads from, syslog forwarder
  from a vendor's telematics platform. NEVER configure
  the Edge Hub to ACTIVELY query a mobile asset (no
  Modbus write, no OPC UA write, no SCADA poll-induced
  load). Mobile assets in OT zones are often coupled to
  safety-critical processes (an AGV in a chemical plant
  shares the floor with safety-instrumented-system-
  managed processes), and any active query introduces
  latency / load on the asset's safety controller. See
  [`.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 for the full passive-collection-only contract.
- **OT-SAFETY: Better Map renders trajectory ONLY — no
  write-back.** Better Map is a read-only visualisation
  layer. The recipe shows where assets ARE / HAVE BEEN;
  it does NOT (and cannot) signal an asset to reroute,
  stop, or take any control action. For a control action
  (e.g. "halt all AGVs in zone X" in response to a
  detected anomaly), the operator MUST use the asset's
  native control interface (the WMS / fleet manager UI,
  the safety operator panel, the e-stop). See
  [`.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 4 for the full read-only / no-write-back contract.
- **OT-SAFETY: SIS-related mobile assets are read-only
  mirrored.** If any mobile asset surfaced by this panel
  is part of the customer's Safety Instrumented System
  (e.g. a mobile inspection robot whose presence is a
  required input to a SIS interlock), the asset MUST
  appear in the customer's asset register with
  `safety_related: true`. The recipe is then permitted
  to render the asset's trajectory in a READ-ONLY manner
  (passive ingest → display) but MUST NOT contribute the
  trajectory data to any closed-loop control flow. See
  [`.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5 for the SRS-mirror contract.
- **OT-SAFETY: Purdue zone field annotation is
  defensive, not authoritative.** The `eval
  zone_purdue_level=coalesce(zone_purdue_level, "L2")`
  defaults to L2 (operations) for un-tagged AGVs. This
  is a safe default but does NOT replace authoritative
  zone classification from the customer's Purdue model
  / IEC 62443 zone-and-conduit specification. For a
  panel deployed in a safety-critical environment, the
  Edge Hub input MUST be configured with explicit per-
  topic zone tagging (`edge_hub_mqtt` supports
  `tags::zone_purdue_level = L2` per inputs.conf
  stanza), and the recipe should `where isnotnull(zone_purdue_level)`
  to filter out any un-tagged asset rather than
  defaulting them to L2.
- **Polyline jitter from low-precision GPS.** Consumer-
  grade GPS on AGVs / vehicles has 3-5m horizontal
  accuracy; the polyline will show micro-jitter even
  when the asset is stationary (the position oscillates
  within the GPS-precision circle). For a clean
  trajectory, apply a low-pass filter in SPL (e.g.
  `streamstats window=5 avg(lat) AS lat_smooth, avg(lon) AS lon_smooth BY asset_id`
  and render with the smoothed coords). For sub-meter
  precision, use RTK-GPS or UWB-beacon-based positioning
  (which the Edge Hub can ingest via MQTT or OPC UA).
- **Polyline length budget.** A 1-hour window with
  30-second GPS samples produces 120 vertices per asset.
  A 50-asset fleet × 120 vertices = 6000 vertices, well
  under the `head 5000` cap (raise the cap or narrow
  the window for a larger fleet). For a multi-shift
  window (8-12 hours), reduce the GPS sample rate at
  ingest (`edge_hub_mqtt` supports
  `interval = 60` for one-sample-per-minute throttling)
  or use a `bin _time span=1m | stats latest(lat),
  latest(lon) BY asset_id, _time` aggregation pre-render.
- **Per-asset polyline identity is per-window.** The
  `path_id` includes the window-start timestamp, so the
  same asset gets a different polyline if you re-run the
  panel with a different time window. This is intentional
  — without the timestamp, asset polylines from
  overlapping time windows would conflate. For a "show me
  the same asset across multiple time windows" panel,
  override `pathIdField` to `asset_id` directly.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6) and
smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. Has NOT been live-tested against a
real Edge Hub + MQTT-AGV deployment. Verification deferred to
wave 21+ pending D5 harness landing + an MQTT-AGV simulator
fixture in the demo data generator. Once verified, the recipe
becomes the canonical reference for OT mobile-asset trajectory
panels — including the OT-safety carve-out language for §6.
