---
schema_version: 1
id: splunk-stream--choropleth
source:
  id: splunk-stream
  display_name: "Splunk Stream (wire data)"
  pattern: splunk-stream
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-31"
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
  - name: bytes_out
    type: integer
    example: "12847291"
  - name: session_count
    type: integer
    example: "8421"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, extrusion-3d layer (height-encoded sibling — same SPL, prism rendering)"
    path: "docs/recipes/splunk-stream/extrusion-3d.md"
  - description: "Companion recipe — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/splunk-stream/markers.md"
  - description: "Pattern reference — choropleth on CIM Network Traffic (sibling state-aggregation recipe — same iplocation + Region path)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Pattern reference — choropleth on ThousandEyes (sibling iplocation + USPS-code pattern, per-state agent counts)"
    path: "docs/recipes/thousandeyes/choropleth.md"
  - description: "Pattern reference — choropleth on CIM Performance (sibling US-states preset, breaching-host count)"
    path: "docs/recipes/cim-performance/choropleth.md"
  - description: "Pattern reference — choropleth on bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/choropleth.md"
  - description: "Splunk Stream skill — wire-data capture and protocol analytics"
    path: "~/.cursor/skills/splunk-stream/SKILL.md"
  - description: "Splunk Stream setup skill — TA_stream + splunk_app_stream"
    path: "~/.cursor/skills/splunk-stream-setup/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enableChoropleth, featureJoinPreset, palette"
    path: "docs/_machine/formatter-schema.json"
---

# Splunk Stream (wire data) — US states choropleth

The flat-fill companion to the
[splunk-stream/extrusion-3d](./extrusion-3d.md) recipe — same wire-
data source, same per-state aggregation, same `us-states` PMTiles
preset, but per-state shading uses **colour saturation alone**
(no vertical extrusion). The right shape for **executive
egress-distribution briefings** where the question is "which US
states are receiving our outbound TLS traffic, ranked by byte
volume" — the choropleth answer is more legible at small panel
sizes than the extrusion sibling (which can occlude smaller states
when the camera pitch is high), and renders correctly in
print-export / PDF-export scenarios where 3D camera state is lost.

The **8th choropleth recipe in the matrix** — joining
[geo-us-states](../geo-us-states/choropleth.md),
[cim-network-traffic](../cim-network-traffic/choropleth.md),
[cim-authentication](../cim-authentication/choropleth.md),
[cim-alerts](../cim-alerts/choropleth.md),
[cim-performance](../cim-performance/choropleth.md),
[thousandeyes](../thousandeyes/choropleth.md), and
[itsi-kpi-base](../itsi-kpi-base/choropleth.md). This advances the
choropleth layer column from 7 cells to 8, and brings the
splunk-stream source row from 6 cells to 7 (markers, h3, heat,
supercluster, paths, extrusion-3d, plus choropleth now) — the
**first wire-data choropleth recipe**, where the metric being
shaded is **observed wire-level byte volume** rather than
event-count aggregations (CIM Network Traffic) or device inventory
(ThousandEyes / Meraki). It is the canonical demo for "you can
render any wire-data telemetry as a flat-fill choropleth, not just
as point-density layers".

## 1. Source description

Same **Splunk Stream** wire-data source as the
[markers](./markers.md), [extrusion-3d](./extrusion-3d.md),
[h3](./h3.md), [heat](./heat.md), [supercluster](./supercluster.md),
and [paths](./paths.md) companions — see
[splunk-stream/markers §1](./markers.md#1-source-description) for
the full platform background (`streamfwd`, the `stream:tls`
sourcetype, the SPAN/mirror-port capture model, and why TLS is the
right protocol for outbound-destination panels).

The relevant distinction for THIS recipe: identical SPL to the
[extrusion-3d companion](./extrusion-3d.md) (`iplocation dest_ip`
→ `Region` → USPS code mapping), but the formatter config (§4)
disables `enable3DExtrusion` and the result is a flat-fill
choropleth. Same `bytes_out`-driven shading, different geometry
rendering mode.

**Why choropleth for wire data.** The
[extrusion-3d sibling](./extrusion-3d.md) is the gold standard
for "show me where my egress goes" panels at full size — height
preserves rank visibility even when colour saturates. But there
are operational contexts where the choropleth is the right
choice:

1. **Print / PDF export views.** Dashboard Studio's PDF-export
   renders the panel at its current camera state. If the user
   exported the extrusion-3d sibling at a high camera pitch,
   neighbouring smaller states get occluded by tall prisms in
   the print copy. The choropleth has no camera-state dependency
   — flat polygons render identically at any pitch.
2. **Multi-panel dashboards at small panel sizes.** When the
   panel is one of 8-12 tiles in a grid layout, the
   choropleth's "colour-encoded fill" reads correctly even at
   sub-300px panel widths. The extrusion needs ≥500px panel
   width and visible camera-tilt UI to be useful at small
   sizes.
3. **Print briefings + slide decks.** The choropleth lifts
   cleanly into a static screenshot for inclusion in an
   executive deck without losing information; the extrusion-3d
   sibling requires the reader to be looking at the live panel
   with the camera tilted to extract full value.
4. **Accessibility (low-vision users).** A high-contrast
   colour ramp (e.g., `palette: "magma"`) gives stronger
   visual differentiation than a height-extrusion at fixed
   camera pitch for users with reduced depth-perception
   capabilities.

For the inverse "I want maximum visual impact, multiple states
will saturate the ramp" use case, ship the
[extrusion-3d sibling](./extrusion-3d.md). Both recipes can
co-exist in the same dashboard — same SPL backing both panels
via a data-source reference, different formatter configs per
panel.

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

Identical to the
[extrusion-3d companion §2](./extrusion-3d.md#2-spl-recipe) —
same two-stage `iplocation dest_ip` + `Region` → USPS code
mapping path. The only difference between the two recipes lives
in the formatter config (§4); the data pipeline is shared.

For an **inbound / ingress view** (where the question is "where
are our public-facing services receiving traffic from" rather
than "where is our egress going to"), substitute `stats sum(bytes_in)
... BY src_ip` for the first stage and `iplocation src_ip` for
the geocoding stage. The downstream USPS-code mapping is
unchanged. Useful for SaaS-customer-distribution panels and
public-service-IP-reach panels.

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

Five fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `value` drives the choropleth
shading; `state_name` / `bytes_out` / `session_count` flow
through as feature properties on the joined polygon for popups.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this minimal config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). Same preset as all 7 existing
  choropleth recipes.
- **`enableChoropleth: "true"`** — switches the join layer
  from neutral polygon outline to colour-graded fill driven by
  the `value` SPL column.
- **`palette: "viridis"`** — perceptually-uniform,
  colour-blind-safe default. Match the
  [extrusion-3d companion §4](./extrusion-3d.md#4-recommended-formatter-config)
  for visual consistency when both recipes ship side-by-side in
  the same dashboard.

For a **security-framed view** ("data exfiltration suspected
— where is the spike"), swap to `palette: "magma"`
(warm-equates-with-danger semantics, matching the
[cim-alerts/choropleth](../cim-alerts/choropleth.md) companion's
threat-detection framing). For an **accessibility-first view**
(low-vision users on the dashboard), swap to
`palette: "cividis"` (the
[viridis-family palette specifically tuned for protanopia /
deuteranopia / tritanopia colour-vision profiles](https://github.com/marcosci/cividis)).

For a **session-count choropleth variant** (where the question
is "where are we connecting to most often" rather than "where
are we sending most bytes to"), modify the SPL `eval
value=bytes_out` to `eval value=session_count`. No formatter
change needed — the choropleth shading auto-scales to the
`value` field's range. Useful for connection-pattern panels
where outlier short connections (e.g., a probe sweep) matter
more than aggregate byte transfer.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by following the
[extrusion-3d companion's §5 walkthrough](./extrusion-3d.md#5-screenshot)
verbatim, then applying the §4 formatter JSON above (instead of
the extrusion-3d companion's extrusion JSON). The choropleth
should shade US states proportional to `bytes_out`, with the
major SaaS / CDN states (CA, VA, WA — Cloudflare, AWS us-east-1,
AWS us-west-2) typically the darkest. Unlike the extrusion-3d
sibling, the choropleth has no camera-pitch dependency — the
default top-down view shows the full picture immediately._

## 6. Gotchas

- **Saturation ceiling.** The single most important caveat for
  the choropleth-flavour of wire-data egress panels: a few major
  destination states (CA / VA / WA, hosting AWS / Cloudflare /
  Azure regions) typically absorb 80-90% of outbound TLS bytes,
  and the colour ramp can't distinguish them once they all
  exceed the 80th percentile. Mitigations:
  - **Pair with the [extrusion-3d sibling](./extrusion-3d.md)
    in the same dashboard.** The extrusion preserves rank
    visibility above the saturation ceiling; the choropleth
    is the readable / print-friendly default; pairing both
    in side-by-side panels gives both audiences their canonical
    view of the same data.
  - **Switch to log-scale shading.** Replace the SPL `eval
    value=bytes_out` with `eval value=log(bytes_out)` (or
    `log10`). The log transform compresses the
    1-MB-to-1-TB range into a 6-7-unit linear scale that the
    palette ramp can shade smoothly. Cost: the popup's
    `value` field now reads "12.37" rather than "12,847,291",
    so the original `bytes_out` field carries the raw count
    for popup display.
  - **Drop the top decile from the choropleth.** Add `| where
    bytes_out < <90th_percentile_threshold>` between the
    second `stats` and the `eval id`. This makes the
    choropleth shading sensitive to the LOWER 90% of states
    (the interesting question — "which mid-tier states are
    growing?"). Pair with a separate single-value /
    radial-gauge panel that surfaces the top 10% by absolute
    bytes.

- **`bytes_out` semantics.** Same caveat as the
  [extrusion-3d companion §6](./extrusion-3d.md#6-gotchas):
  the `bytes_out` field on `stream:tls` reflects bytes
  **observed at the SPAN port**, which includes the TLS
  encryption envelope (header + record-layer framing). For
  application-layer payload bytes, post-decryption via Stream's
  SSL inspection module (if licensed) gives a closer-to-payload
  number; without inspection, treat `bytes_out` as "wire bytes
  including ~5-10% encryption overhead".

- **`iplocation Country="United States"` excludes US
  territories.** Same caveat as all US-states choropleth /
  extrusion recipes: Puerto Rico, Guam, US Virgin Islands,
  American Samoa, Northern Mariana Islands all have
  `Country="United States"` in the MaxMind data but their
  `Region` field is the territory name, not a state — the
  USPS-code mapping in §2 falls through to `substr(Region, 1, 2)`
  which produces "PU", "GU", "US", "AM", "NO" — these don't
  match any USPS code in the bundled `us-states.pmtiles`
  preset, so territories silently drop. To include territories,
  extend the `case` mapping in §2 with explicit `Region=="Puerto
  Rico","PR"` / `Region=="Guam","GU"` / etc. entries; the
  bundled PMTiles preset includes USPS codes for "PR" and
  "DC" but not for the four other territories (they would
  show up in the SPL output but render as unmatched-grey
  polygons — which is technically the correct visual
  behaviour, just not what most viewers expect).

- **`stream:tls` requires Splunk Stream + SPAN port.** This
  recipe assumes the customer has deployed Splunk Stream's
  `streamfwd` agent on a host receiving a SPAN / mirror port
  copy of the outbound link. Cloud-native customers who use
  AWS VPC Flow Logs / Azure NSG Flow Logs / GCP VPC Flow Logs
  for the same use case should pair with the
  [cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
  companion instead, which reads `tag=network` events from
  the CIM Network Traffic data model (those flow-log sources
  carry CIM tags via their respective TAs).

- **Saved-search summary indexing recommended for production.**
  Same caveat as the
  [extrusion-3d companion §6](./extrusion-3d.md#6-gotchas):
  a 24-hour Stream summary can hit 30-60 second search-head
  time on a busy SPAN aggregate (>1 GB / day of TLS sessions).
  For production dashboard refresh, schedule a saved-search
  every 15 minutes that runs the SPL above + outputs to
  either an `outputlookup` CSV or a `collect`-based summary
  index, then point the dashboard panel at the lookup /
  summary index. Sub-second panel refresh, same data.

- **No OT-safety dependency.** Same posture as all
  splunk-stream companions: Splunk Stream captures IT-network
  wire-data from SPAN / mirror ports on IT infrastructure (not
  Level-0/1/2 OT-zone networks, which have their own
  air-gapped capture). No OT carve-out applies. If a customer
  DOES place a Splunk Stream forwarder on an OT-zone SPAN port
  to ingest OT-protocol wire data (Modbus / DNP3 / OPC-UA
  observed at Level 3 to Level 2), apply
  [`~/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1-3: set `ot_safety_relevant: true` on the OT-aware
  recipe variant; document the safety-related signal handling
  in §6; ensure any downstream containment runbook explicitly
  excludes Level-0/1/2 actions.

## Verification status

`status: unverified` in the frontmatter — the SPL is identical
to the
[extrusion-3d companion](./extrusion-3d.md) (same `iplocation
dest_ip` + `Region` → USPS code mapping path); the formatter
change (no `enable3DExtrusion`, no `extrusionScale`) is covered
by Better Map's own `featureJoin` module unit tests for the
choropleth path, proven in the
[cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md),
[cim-performance/choropleth](../cim-performance/choropleth.md),
and [geo-us-states/choropleth](../geo-us-states/choropleth.md)
companions. A maintainer with a populated `stream:tls` index
should follow the verification steps in the
[extrusion-3d companion's §Verification status](./extrusion-3d.md#verification-status)
(substituting this recipe's §4 choropleth formatter for the
extrusion-3d formatter), then promote both this recipe AND the
extrusion-3d companion to `status: verified` + fill in
`verified_against` in a follow-up PR.
