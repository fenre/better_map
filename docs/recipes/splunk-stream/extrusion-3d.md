---
schema_version: 1
id: splunk-stream--extrusion-3d
source:
  id: splunk-stream
  display_name: "Splunk Stream (wire data)"
  pattern: splunk-stream
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-25"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_stream"
    optional: false
  - id: "splunk_app_stream"
    optional: true
  - id: "builtin:iplocation"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "CA"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "California"
  - name: value
    type: integer
    example: "12847291"
    drives_formatter_option: extrusionHeightField
  - name: bytes_out
    type: integer
    example: "12847291"
  - name: session_count
    type: integer
    example: "8421"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-session drilldown)"
    path: "docs/recipes/splunk-stream/markers.md"
  - description: "Companion recipe — same source, h3 / heat / supercluster / paths layers"
    path: "docs/recipes/splunk-stream/h3.md"
  - description: "Pattern reference — extrusion-3d on CIM Network Traffic (sibling extrusion recipe)"
    path: "docs/recipes/cim-network-traffic/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on Meraki (sibling extrusion recipe)"
    path: "docs/recipes/meraki/extrusion-3d.md"
  - description: "Splunk Stream skill — wire-data capture and protocol analytics"
    path: "~/.cursor/skills/splunk-stream/SKILL.md"
  - description: "Splunk Stream setup skill — TA_stream + splunk_app_stream"
    path: "~/.cursor/skills/splunk-stream-setup/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
---

# Splunk Stream (wire data) — US states 3D extrusion

Extrude the bytes-out volume of every outbound TLS session,
aggregated by US state of the destination IP, as a **per-state
vertical prism** over the bundled `us-states.pmtiles` preset.
Tall states are major egress sinks; short states are minor or
quiet; absent states have zero matched outbound traffic. The
canonical **"where is my data going, visually" panel** for any
team that has Splunk Stream forwarders on a SPAN port and wants
the answer pre-attentively, not requiring colour-legend
interpretation.

The **6th extrusion-3d recipe in the matrix** — joining
[geo-us-states](../geo-us-states/extrusion-3d.md),
[cim-network-traffic](../cim-network-traffic/extrusion-3d.md),
[meraki](../meraki/extrusion-3d.md),
[cim-authentication](../cim-authentication/extrusion-3d.md), and
[cim-alerts](../cim-alerts/extrusion-3d.md) — and the **FIRST
extrusion-3d recipe sourced from wire-data**, which makes it the
canonical demo for "you can render any wire-data telemetry as a
3D extruded choropleth, not just data-model summaries". This
advances the extrusion-3d layer column from 5 cells to 6.

## 1. Source description

Same **Splunk Stream** wire-data source as the
[markers companion](./markers.md) — see
[splunk-stream/markers §1](./markers.md#1-source-description)
for the full platform background (`streamfwd`, the
`stream:tls` sourcetype, the SPAN/mirror-port capture model,
and why TLS is the right protocol for outbound-destination
panels).

The relevant distinction for THIS recipe: instead of one marker
per `(dest_ip, dest_port)` tuple, the panel aggregates by US
state of the destination IP (via `iplocation dest_ip`) and
renders one extruded polygon per state with the prism height
encoding `bytes_out`. The bytes counter — not session count —
drives the extrusion because for a data-egress / exfiltration
view, volume is the metric the SOC / compliance reviewer cares
about, not session count (a single 10 GB upload looks identical
to a 100-byte heartbeat in a count-only panel; the extrusion
makes the volume gap obvious).

**Why extrusion-3d for wire data.** A choropleth saturates
quickly with wire-data: a few major SaaS / CDN states (CA, VA,
WA — Cloudflare, AWS us-east-1, AWS us-west-2) absorb 80-90% of
outbound bytes, and the colour ramp can't distinguish them
visually. Extrusion-3d preserves rank visibility because
height-encoding has unbounded headroom — a state with 10 GB of
egress is **100x taller** than a state with 100 MB, and that
gap is visually obvious. Combined with the additive choropleth
(height + colour encode the same `value` — see §4), the panel
becomes double-encoded: height for absolute rank, colour for
ordinal "where is the heat".

This recipe is the right shape for **data-exfiltration
detection panels** (a sudden tall prism over an
unexpected state is itself the talking point), **capacity-
planning panels** ("how much of our egress goes to AWS
us-east-1 vs us-west-2 vs Cloudflare?"), and **compliance-
attribution panels** (per-state egress maps to per-jurisdiction
data-export reporting under GDPR / CCPA).

**Typical sourcetype / index:** `sourcetype="stream:tls"` /
`index=wire_data` (defaults per the
[splunk-stream-setup skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-stream-setup.mdc)).

**No add-on required beyond `Splunk_TA_stream`** for the wire-
data capture, the bundled `us-states.pmtiles` preset for the
polygons, and Splunk's built-in `iplocation` for the dest_ip
geocoding. Fully air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
index=wire_data sourcetype="stream:tls" earliest=-24h latest=now
| stats sum(bytes_out) AS bytes_out,
    count AS session_count
  BY dest_ip
| iplocation dest_ip
| where Country="United States" AND isnotnull(Region)
| stats sum(bytes_out) AS bytes_out,
    sum(session_count) AS session_count
  BY Region
| eval id=upper(case(
    Region=="California","CA",
    Region=="New York","NY",
    Region=="Texas","TX",
    Region=="Washington","WA",
    Region=="Illinois","IL",
    Region=="Florida","FL",
    Region=="Massachusetts","MA",
    Region=="Virginia","VA",
    Region=="Colorado","CO",
    Region=="Oregon","OR",
    Region=="Pennsylvania","PA",
    Region=="New Jersey","NJ",
    Region=="Georgia","GA",
    Region=="North Carolina","NC",
    Region=="Ohio","OH",
    Region=="Michigan","MI",
    Region=="Arizona","AZ",
    Region=="Minnesota","MN",
    Region=="Indiana","IN",
    Region=="Tennessee","TN",
    Region=="District of Columbia","DC",
    true(),substr(Region,1,2)))
| eval value=bytes_out
| rename Region AS state_name
| fields id, state_name, value, bytes_out, session_count
| sort - value
```

Why this exact shape, line by line:

- **`index=wire_data sourcetype="stream:tls"`** — same TLS
  session sourcetype as the
  [markers companion §2](./markers.md#2-spl-recipe). TLS
  carries the dest IP and the bytes counters needed for the
  panel.
- **`earliest=-24h latest=now`** — typical operational window
  for an egress-volume panel. For a real-time SOC overlay,
  narrow to `-15m`; for a weekly executive review, widen to
  `-7d` (be aware that a 7-day Stream summary can be expensive
  on a busy SPAN aggregate — see §6 Gotchas).
- **`stats sum(bytes_out) AS bytes_out, count AS session_count
  BY dest_ip`** — first aggregation pass: per-dest_ip
  byte-and-session totals. Reduces the (potentially millions
  per hour) per-session events to one row per destination IP
  BEFORE the `iplocation` lookup — same per-event-vs-per-host
  optimization as the
  [markers companion §2](./markers.md#2-spl-recipe).
- **`iplocation dest_ip`** — Splunk's bundled MaxMind GeoLite2
  geocoder. Populates `Country`, `Region` (state name), `lat`,
  `lon`. RFC-1918 / private IPs resolve to null `Country`.
- **`where Country="United States" AND isnotnull(Region)`** —
  US-only guard. The bundled `us-states.pmtiles` is the 50
  states + DC; non-US dest IPs drop here. For global per-
  country aggregation, see §6 Gotchas for the
  `featureJoinUrl` + world-countries PMTiles path.
- **`stats sum(bytes_out) AS bytes_out, sum(session_count) AS
  session_count BY Region`** — second aggregation pass:
  per-state totals. The first stats was per-dest_ip to make
  `iplocation` cheap; this one collapses to ~50 state rows for
  the panel.
- **`eval id=upper(case(...))`** — same `Region` → USPS two-
  letter code mapping as all `us-states` choropleth /
  extrusion recipes
  ([cim-network-traffic](../cim-network-traffic/extrusion-3d.md),
  [meraki](../meraki/extrusion-3d.md),
  [geo-us-states](../geo-us-states/extrusion-3d.md)). The
  `promoteId` on the bundled `us-states` PMTiles is `stusps`
  (two-letter USPS code).
- **`eval value=bytes_out`** — bytes drive the extrusion. For
  a session-count extrusion variant (where the question is
  "where are we connecting to most often" rather than "where
  are we sending most bytes to"), swap to `eval
  value=session_count` and re-tune `extrusionScale` (§4)
  accordingly.
- **`rename Region AS state_name`** — popup-friendly alias for
  the full state name.
- **`fields ...`** — explicit projection.
- **`sort - value`** — biggest-bytes states first. The
  extrusion renderer is row-order-agnostic, but a sorted
  result is easier to debug.
- **No `head` cap.** Maximum row count is 51, well under any
  render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field         | type    | example      |
|---------------|---------|--------------|
| id            | string  | CA           |
| state_name    | string  | California   |
| value         | integer | 12847291     |
| bytes_out     | integer | 12847291     |
| session_count | integer | 8421         |

All five fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the `extrusionHeightField` formatter option;
`state_name`, `bytes_out`, and `session_count` flow through as
feature properties on the joined polygon for popups.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": true,
  "extrusionHeightField": "value",
  "extrusionScale": 0.1,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this specific config (mirrors the
[cim-network-traffic/extrusion-3d companion §4](../cim-network-traffic/extrusion-3d.md#4-recommended-formatter-config)
with one tuning change — the `extrusionScale` value):

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). Same preset as all extrusion
  /choropleth recipes that target US states.
- **`enable3DExtrusion: true`** — switches the join layer from
  flat polygon fill to extruded prism rendering. Per the
  formatter-schema documentation, "pitch and rotate are
  already enabled by default" — the user can tilt the camera
  by right-dragging to see the extrusion in 3D as soon as
  this is on.
- **`extrusionHeightField: "value"`** — points the extrusion
  height to the `value` field from the SPL. Explicit pinning
  survives any future field-name changes.
- **`extrusionScale: 0.1`** — multiplier. For wire-data
  `bytes_out` values in the 1 MB - 1 TB per-state range
  (typical 24-hour window for a mid-size customer), 0.1 keeps
  the tallest state at ~10000-100000 metres tall: visible at
  globe zoom but not so tall it occludes neighbouring states
  at city zoom. **Bytes scales DOWN, not up**: the
  [cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
  recipe uses scale 12.0 because its `value` is event-count in
  the 1k-1M range; bytes are 6-9 orders of magnitude larger,
  so the scale comes down proportionally. Tune to your data:
  `scale = (target_max_metres / max(value))`. A formula sanity
  check: if your tenant's tallest state is 100 GB
  (1e11 bytes), a target of 10000 m gives
  `scale = 10000 / 1e11 = 1e-7`. For a 1 GB-tallest tenant,
  `scale = 10000 / 1e9 = 1e-5`. The recipe default of `0.1`
  assumes a smaller "1 MB - 1 GB tallest state" range; tune
  up or down by orders of magnitude as needed.
- **`enableChoropleth: "true"`** combined with
  **`palette: "viridis"`** — the surface-layer choropleth
  shading is ADDITIVE with the extrusion. Height + colour
  encode the same `value` (bytes), so reading either dimension
  answers the question. The viridis palette is perceptually
  uniform (accessible to all colour-vision profiles); for a
  SECURITY-framed view ("data exfiltration suspected, where's
  the spike") swap to `magma` (warm-equates-with-danger).
- **`state_name`, `bytes_out`, `session_count` flow through
  automatically** as feature properties for the popup.

For a **session-count extrusion variant** (where the question
is "where are we connecting to most often" rather than "where
are we sending most bytes to"), swap the SPL `eval
value=bytes_out` for `eval value=session_count` and tune
`extrusionScale` up to ~10.0 (session counts are 3-4 orders of
magnitude smaller than byte counts).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). The
3D extrusion is best demoed with the camera tilted ~35° via the
on-map camera widget (which honours `allowPitch: true`, the
formatter-schema default per
[`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json));
a flat-top screenshot loses the entire 3D-extrusion signal. A
maintainer can reproduce by pasting the SPL above into a
Dashboard Studio map panel with Better Map as the visualization,
applying the formatter JSON in §4, and right-dragging the panel
to tilt the view. The right demo data: a Splunk Stream
deployment with ≥1 GB / day of outbound TLS traffic distributed
across major SaaS / CDN states (Cloudflare regions, AWS
us-east-1, AWS us-west-2), so the extrusion shows clear rank
ordering between high-egress states and the long tail._

## 6. Gotchas

- **`bytes_out` semantics.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas):
  Stream's `bytes_out` is bytes FROM the source TO the
  destination, i.e. egress from your network. For a data
  exfiltration map this is the right metric. If you want total
  session size, use `bytes_total = bytes_in + bytes_out` — but
  that double-counts a download (which inflates the prism for
  every CDN endpoint your users hit). Stick with `bytes_out`
  for security-framed panels.

- **`extrusionScale` is dataset-dependent — wire-data is the
  most extreme case.** A scale of 0.1 works for `bytes_out`
  values in the 1 MB - 1 GB per-state range. For 1 TB-class
  tenants (large enterprise with heavy egress to AWS / Azure
  /GCP), drop to `0.001`; for 1 MB-class tenants (small
  business with mostly HTTPS web browsing), bump to `10.0`.
  Calculate explicitly: `scale = target_max_height_metres /
  max(value)`. Tall-thin extrusions over the largest egress
  state can clip out of the MapLibre rendering frustum at low
  zoom — pitch the camera down or reduce the scale if the
  state visually disappears.

- **Pitch / camera tilt UX.** Same caveat as the
  [cim-network-traffic/extrusion-3d companion §6](../cim-network-traffic/extrusion-3d.md#6-gotchas):
  3D extrusion is only visible when the camera is pitched.
  `allowPitch` defaults to `true` so the user CAN tilt by
  right-dragging, but does NOT auto-tilt on load. For
  dashboards where 3D-readability is primary, instruct readers
  via a `splunk.markdown` panel that they can right-drag to
  tilt, OR wait for the v1.8 `initialPitch` formatter option
  to default to a tilted view on panel load.

- **MAUP — extrusion exaggerates large-state bias even more
  for wire-data.** Same posture as the choropleth-on-CIM-
  network-traffic gotcha — California and Virginia (Cloudflare
  HQ + AWS us-east-1) absorb the bulk of wire-data egress.
  Combined with extrusion's visual amplification, the panel
  may overstate the actual "geographic" attribution of egress
  by 30-40% (Cloudflare's IP allocation isn't really
  geographic at all — anycast routing means the same IP can
  serve traffic from any continent). Document this caveat in
  the dashboard's surrounding markdown, OR shift to the
  [splunk-stream/h3 companion](./h3.md) at
  `hexbinResolution: 2-3` for area-neutral aggregation.

- **TLS 1.3 SNI encryption (ECH).** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas):
  Encrypted Client Hello hides the SNI from Stream. The
  decoder will populate `server_name="(encrypted)"` for
  affected sessions; the bytes counter still works (so the
  extrusion height is accurate), but you lose the identity
  of the destination service. There is no Stream-side
  workaround — join from the DNS-resolution path
  (`stream:dns`) for SNI attribution if needed.

- **`stream:tls` privacy / compliance.** Same posture as the
  [markers companion §6](./markers.md#6-gotchas): wire-data
  capture is a GDPR / HIPAA scope expander. Route `wire_data`
  to its own index with restricted RBAC, mask `src_ip` for
  non-IR users, and document the data-retention period in
  the customer's data inventory. Better Map renders what it
  receives; the SPL above does NOT mask `src_ip` (which is
  not in the projected `fields` list, so it does not appear
  in the panel anyway, but the underlying search history
  retains it).

- **`iplocation` performance at scale.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas):
  always `stats` BEFORE `iplocation` (the recipe does — first
  pass collapses to per-dest_ip totals). For high-volume
  tenants (>10M TLS sessions / 24h), consider summary-indexing
  the per-state aggregate via a scheduled saved search
  (`| outputlookup state_egress_summary.csv`) and pointing the
  panel at the summary lookup — same lookup-source pattern as
  [csv-lookup-geo/vector-tile-join](../csv-lookup-geo/vector-tile-join.md).

- **No OT-safety dependency BY DEFAULT.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas):
  if your Stream forwarders are mirrored against an OT/ICS
  environment, the
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 2 apply (Stream IS the canonical passive
  collection method for OT, but a per-state extrusion panel
  rendering PLC / HMI dest IPs must NOT be wired to any SOAR
  / drilldown that could send a write back). Render-only is
  fine; render-and-act is not. Filter OT dest IPs OUT of this
  recipe (`NOT dest_ip IN ("10.0.100.*", "10.0.200.*", ...)`)
  and put them in a SEPARATE recipe with
  `ot_safety_relevant: true`.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`stats`, `iplocation`,
`eval`, `where`, `rename`, `fields`, `sort`) plus the same
`featureJoinPreset` / `enable3DExtrusion` formatter contract
exercised by the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
and [meraki/extrusion-3d](../meraki/extrusion-3d.md)
companions. The end-to-end "this recipe's wire-data SPL
renders as a tilted 3D US-states extrusion in a Splunk
Dashboard Studio panel" path has not been dispatched against
the v1.7-prep lab tenant in this PR because the lab tenant
does not have Splunk Stream forwarders deployed (no SPAN
mirror available). A maintainer with Stream data should follow
the verification steps in the
[markers companion §Verification status](./markers.md#verification-status)
(substituting this recipe's §2 per-state aggregation SPL for
the markers companion's per-session SPL), then promote to
`status: verified` + fill in `verified_against` in a follow-up
PR.
