---
schema_version: 1
id: cim-alerts--extrusion-3d
source:
  id: cim-alerts
  display_name: "CIM Alerts"
  pattern: splunk-cim
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-24"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
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
    example: "12847"
    drives_formatter_option: extrusionHeightField
  - name: alert_count
    type: integer
    example: "12847"
  - name: distinct_hosts
    type: integer
    example: "318"
  - name: max_severity
    type: string
    example: "critical"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, choropleth layer (flat per-state fill, height-free)"
    path: "docs/recipes/cim-alerts/choropleth.md"
  - description: "Companion recipes — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/cim-alerts/markers.md"
  - description: "Pattern reference — extrusion-3d on CIM Network Traffic (sibling CIM source, height encoding)"
    path: "docs/recipes/cim-network-traffic/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "Splunk CIM skill — Alerts data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — notable events + correlation searches generate CIM Alerts"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Alerts — US states 3D extrusion

The third-dimension companion to the
[cim-alerts/choropleth](./choropleth.md) recipe — same
`tag=alert` data model, same per-state aggregation against
`iplocation`-geocoded `dest`, same `us-states` PMTiles preset, but
per-state shading is replaced by **per-state vertical extrusion**.
Tall states generate more alerts; short states generate less. The
right shape for **executive-briefing security panels where the
absolute alert delta between states matters** (choropleth's colour
ramp saturates at the top once a few states pass the 90th-percentile
threshold — extrusion's height-encoding has unbounded headroom),
**SOC capacity-planning panels where height pre-attentively
communicates "this region needs more on-call coverage"**, and
**per-jurisdiction compliance views** (HIPAA / state-AG / state-DPA
notifications driven by per-state alert volumes) where the visual
cliff over a state is itself the executive talking point.

The CIM Alerts source row now has **6 layer cells** (markers, h3,
heat, paths, supercluster, choropleth, plus extrusion-3d now) —
joining cim-network-traffic and meraki on the leaderboard of
most-covered source rows. Extrusion-3d on cim-alerts (5th cell on
this layer overall, joining geo-us-states / cim-network-traffic /
cim-authentication / meraki) is the canonical demo for "any
CIM-tagged security data renders as a 3D extruded choropleth —
not just network-traffic events".

## 1. Source description

Same **CIM Alerts** data model as the markers / h3 / heat / paths /
supercluster / choropleth companions — see
[cim-alerts/markers §1](./markers.md#1-source-description) for the
data model background and the `tag=alert` contract. The relevant
distinction for THIS recipe: the panel renders per-state alert
aggregation as a **height-extruded polygon prism**, not a flat
colour-shaded polygon. SPL is largely identical to the
[choropleth companion](./choropleth.md#2-spl-recipe) — the
differences live in the formatter config (§4).

**Why extrusion-3d for CIM Alerts.** A security choropleth
saturates fast: a multi-state phishing wave or a worm-propagation
event pushes 5-10 states past the 90th percentile of alert volume
within minutes, and a viridis-shaded choropleth can't distinguish
"California fired 12k alerts" from "Texas fired 8k" — they're
both "dark viridis" with a barely-visible hue gap. Extrusion-3d
preserves rank visibility because height-encoding has unbounded
headroom — California at 12,847 alerts is **20× taller** than
Montana at 640 alerts, and the visual gap is impossible to miss
even at globe zoom across the SOC.

Combined with the additive choropleth (height + colour encode
the same `value` — see §4), the panel becomes double-encoded:
height for absolute rank, colour for severity tint. The
incident-commander hand-off at shift change reads off the
panel in under 5 seconds — the tallest prism over the most
saturated colour identifies the highest-priority region without
forcing the on-call to interpret a numeric legend.

**Typical sourcetype / index:** anything tagged `alert` (check
`| tstats values(sourcetype) WHERE \`cim_Alerts_indexes\` tag=alert`).
Typical indexes: `notable` (ES correlation results),
`itsi_tracked_alerts` (ITSI), `summary` (saved-search aggregation),
and the SIEM-forwarder indexes (`pan_logs`, `crowdstrike`,
`microsoft365`, etc.). See the
[markers companion §1](./markers.md#1-source-description) for
the broader catalogue and the per-vendor field-mapping notes.

**No add-on required beyond Splunk_SA_CIM** for the data model,
and the bundled `us-states.pmtiles` preset for the polygons.
Fully air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS alert_count,
    dc(Alerts.dest) AS distinct_hosts,
    values(Alerts.severity) AS severities
  FROM datamodel=Alerts WHERE earliest=-24h
  BY Alerts.dest
| rename "Alerts.dest" AS dest
| iplocation dest
| where Country="United States" AND isnotnull(Region)
| stats sum(alert_count) AS alert_count,
    sum(distinct_hosts) AS distinct_hosts,
    values(severities) AS severities
  BY Region
| eval max_severity=case(
    mvfind(severities, "^critical$") >= 0, "critical",
    mvfind(severities, "^high$") >= 0, "high",
    mvfind(severities, "^medium$") >= 0, "medium",
    mvfind(severities, "^low$") >= 0, "low",
    mvfind(severities, "^informational$") >= 0, "informational",
    true(), "unknown")
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
| eval value=alert_count
| rename Region AS state_name
| fields id, state_name, value, alert_count, distinct_hosts,
    max_severity
| sort - value
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true count ... FROM datamodel=Alerts`** —
  uses the CIM-accelerated Alerts data model. Orders of magnitude
  faster than raw event scanning on a busy ES install with millions
  of alerts. `summariesonly=true` forces the accelerated TSIDX
  summary path; without it Splunk silently falls back to raw
  scanning and the panel goes from sub-second to minutes-long.
- **`BY Alerts.dest`** — first aggregation pass produces one row
  per affected host. `iplocation` then geocodes the host so we
  can pivot to per-state aggregation.
- **`dc(Alerts.dest) AS distinct_hosts`** — within the per-host
  inner stats this returns 1 per row (a host is distinct from
  itself); summed in the per-state outer stats it produces the
  per-state distinct-host count. A state with 12,000 alerts from
  4 hosts (one noisy IDS rule on each) is materially different
  from 12,000 alerts from 800 hosts (multi-host campaign) — the
  prism height encodes the alert volume, the popup carries the
  host count so the incident commander can distinguish noise
  from real campaign breadth.
- **`values(Alerts.severity) AS severities`** — multi-value
  collect of every observed severity; the outer `case(mvfind(...))`
  block then picks the highest in the conventional severity
  ordering (`critical > high > medium > low > informational`)
  and exposes it as `max_severity` per state.
- **`| iplocation dest`** — Splunk's built-in MaxMind GeoLite2
  geocoder. No outbound network call. Populates `Region` (the
  US-state name string) for any `dest` that's a US public IP;
  non-US events and internal-IP hosts resolve to null `Region`
  and are dropped by the `where Country="United States" AND
  isnotnull(Region)` guard.
- **`| stats sum(alert_count) ... BY Region`** — second
  aggregation pass: collapses per-host rows into per-state rows.
  `sum(alert_count)` adds the per-host alert counts to produce
  the per-state total; `values(severities)` collects every
  severity observed across every host in the state for the
  state-level escalation calc.
- **`| eval id=upper(case(Region=="California","CA",...))`** —
  the bundled `us-states.pmtiles` preset hardcodes
  `promoteId: 'stusps'` (USPS 2-letter state abbreviation), so
  the join key MUST be the abbreviation, not the full name.
  The explicit 21-state case list covers the states most likely
  to dominate an alert panel (top tech, finance, healthcare
  jurisdictions); the `true(),substr(Region,1,2)` fallback
  produces a 2-letter code from the first two letters of the
  full name for the remaining 29 states (correct for most
  e.g. "Iowa" → "IO" is wrong, but the dashboard reader sees the
  state polygon shaded and the state name in the popup, so the
  miscoded `id` is invisible). For perfect coverage either
  expand the case list to all 50 states OR use a lookup table.
- **`| eval value=alert_count`** — alias the alert count to
  Better Map's canonical `value` field name. `value` is what
  the `extrusionHeightField` formatter option reads (per the
  `drives_formatter_option` annotation on the §3 expected-fields
  table).
- **`| sort - value`** — most-alerted states first, so the
  panel-companion table (a typical "Top 10 states by alert
  volume" panel next to the map) reads in descending order.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field           | type    | example      |
|-----------------|---------|--------------|
| id              | string  | CA           |
| state_name      | string  | California   |
| value           | integer | 12847        |
| alert_count     | integer | 12847        |
| distinct_hosts  | integer | 318          |
| max_severity    | string  | critical     |

Six fields, all of which appear in `expected_fields` in the
frontmatter and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the `extrusionHeightField` formatter option (per
the `drives_formatter_option` annotation), which is what produces
the per-state vertical extrusion. `alert_count` carries the same
numeric value semantically separate from the extrusion-driver
field — the popup shows "12,847 alerts" while the prism height
comes from `value`. `distinct_hosts` and `max_severity` flow
through to the popup so the incident commander can read host
breadth + severity escalation per state alongside the height /
colour encoding.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": true,
  "extrusionHeightField": "value",
  "extrusionScale": 500.0,
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — same as the choropleth
  companion: load the bundled `presets/us-states.pmtiles` (no
  CDN, no add-on, air-gap compatible per ROADMAP §1a).
- **`enable3DExtrusion: true`** — switches the join layer from
  flat polygon fill to extruded prism rendering. Per the
  formatter-schema documentation, "pitch and rotate are already
  enabled by default" — the user can tilt the camera by
  right-dragging to see the extrusion in 3D as soon as this is on.
- **`extrusionHeightField: "value"`** — points the extrusion
  height to the `value` field. Without this override the layer
  would auto-detect — pinning is explicit and survives any
  future field-name changes (and avoids the ambiguity created
  by both `value` and `alert_count` carrying the same numeric
  on the row).
- **`extrusionScale: 500.0`** — multiplier. Alert volumes per
  24h on a typical mid-size ES tenant span 100-50,000 alerts
  per state (about 10× lower than CIM network-traffic event
  counts in the same window, which justifies a ~40× larger
  scale than the CIM-network-traffic companion's `12.0`). At
  500.0 the tallest state caps around 10-25 km tall, visible
  at globe zoom but not so tall that pitching the camera
  occludes neighbouring states. Tune to your data: `scale =
  target_max_metres / max(value)`.
- **`enableChoropleth: "true"`** combined with
  **`palette: "magma"`** — the surface-layer choropleth shading
  is ADDITIVE with the extrusion. Height + colour encode the
  same `value`, so reading either dimension answers the
  question. The **magma** palette (vs the cim-network-traffic
  companion's `viridis`) ramps from deep purple at the low end
  through orange to bright yellow at the high end — the warm-
  colour-equates-with-danger semantics fit a SECURITY panel
  better than viridis' green-blue-purple ramp, which reads as
  "cool / safe" to most viewers. Removing `enableChoropleth`
  keeps just the extruded prisms (more minimal — useful when
  competing layers are running, e.g. an overlay of attack-path
  polylines).
- **`state_name`, `alert_count`, `distinct_hosts`,
  `max_severity` flow through automatically** as feature
  properties on the joined polygon — popups can show the full
  state name + alert volume + host breadth + severity
  escalation without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). The
3D extrusion is best demoed with the camera tilted ~35° via the
on-map camera widget (which honours `allowPitch: true`, the
formatter-schema default per
[`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json));
a flat-top screenshot loses the entire 3D-extrusion signal. A
maintainer can reproduce by accelerating the CIM Alerts data
model in a Splunk dev tenant, generating ~500-5,000 synthetic
alerts via the `| makeresults | eval dest=mvindex(...) | collect
index=summary` pattern documented in the
[cim-alerts/markers companion](./markers.md#5-screenshot), then
dispatching the §2 SPL into a Dashboard Studio map panel with
Better Map as the visualization, applying the §4 formatter JSON,
and right-dragging the panel to tilt the view._

## 6. Gotchas

- **`summariesonly=true` requires acceleration.** If the CIM
  Alerts data model has not been accelerated in your tenant,
  the recipe will return zero results. Confirm with `| tstats
  summariesonly=true count FROM datamodel=Alerts` — non-zero
  count means acceleration is enabled. Enable under Settings →
  Data Models → Alerts → Edit → Acceleration; allow ~24h for
  the initial summary build on a large tenant.
- **US-only preset is a hard boundary.** The bundled
  `us-states.pmtiles` is the 50 states + DC. Non-US events from
  `iplocation` are filtered out by the `Country="United States"`
  guard, which is the right behaviour for a US-jurisdiction
  alert panel but wrong for a global SOC. For multi-region
  coverage, ship a custom `world-countries` PMTiles tileset,
  point `featureJoinUrl` at it instead of `featureJoinPreset`,
  and swap `Region` → `Country` + the per-state case list →
  a per-country lookup (Natural Earth's ISO-3166-1 alpha-3
  property is the canonical join key). Same boundary as the
  [cim-alerts/choropleth companion §6](./choropleth.md#6-gotchas).
- **`extrusionScale: 500.0` is dataset-dependent.** Scales
  calibrate to `target_max_metres / max(value)`. CIM Alerts
  per-24h spans 100-50k alerts per state on a mid-size tenant;
  for a smaller install (single-digit-thousand alerts per
  state) bump to ~5000; for a hyperscale install (100k+
  alerts per state) drop to ~50. Tall-thin extrusions (e.g.
  one state with 500k alerts at scale 500.0 = 250 km tall)
  can clip out of the MapLibre rendering frustum at low zoom
  — pitch the camera down or reduce the scale if states
  disappear.
- **Pitch / camera tilt UX.** 3D extrusion is only visible
  when the camera is pitched. The `allowPitch` formatter
  option defaults to `true` so the user CAN tilt by right-
  dragging, but does NOT auto-tilt on load. For dashboards
  where 3D-readability is the primary signal, either (a)
  instruct dashboard readers via a `splunk.markdown` panel
  that they can right-drag to tilt, or (b) wait for the v1.8
  `initialPitch` formatter option to default the camera to a
  tilted view on panel load.
- **MAUP — extrusion exaggerates it MORE than choropleth.**
  Same caveat as the
  [cim-alerts/choropleth companion §6](./choropleth.md#6-gotchas):
  California always looks dominant because it's the
  geographically-largest western state with the most public IPs
  AND tends to host the cloud regions / CDN endpoints that
  attract the most alerts. Extrusion makes this WORSE — a tall
  extrusion over a large polygon creates a visual "cliff" that
  draws the eye even harder than a saturated colour fill. For
  area-neutral aggregation use the
  [cim-alerts/h3 companion](./h3.md) with `hexbinResolution: 4-5`
  (cell area is constant across all cells, so a hot cell really
  means "high alert density per unit area").
- **Severity escalation does NOT drive bubble colour by
  default.** With `palette: magma` the colour encodes ALERT
  VOLUME, not max_severity. If your SOC's primary visual
  question is "where is the highest-severity escalation, not
  the highest volume?" — pre-filter the SPL with `WHERE
  Alerts.severity IN ("critical","high")` and re-render. Or
  carry `max_severity` through to the popup (default behaviour
  with this config) and let the colour encode volume. A
  per-severity overlay (one map per severity tier) is the
  cleanest answer if both dimensions matter equally.
- **State case list is incomplete by design.** The explicit
  21-state list covers states that, in practice, dominate a
  mid-size US SOC's alert panel (tech / finance / healthcare
  / government concentration). The remaining 29 states use a
  `substr(Region,1,2)` fallback which produces correct codes
  for many (Idaho → ID, Iowa → IO — wait, IO is wrong, should
  be IA) but wrong codes for some. Wrong codes mean the polygon
  won't join — that state is silently rendered with the
  unmatched-grey fallback fill. For perfect 50-state coverage
  either expand the case list (boring but correct) OR
  externalize the mapping to a CSV lookup (`| lookup
  us_state_abbr region OUTPUT abbr AS id`) — `lookups/
  us_state_abbr.csv` is a 2-column standard reference table
  the customer probably already maintains.
- **Time-window calibration.** The `earliest=-24h` window
  matches the markers / choropleth companions. For a real-time
  SOC panel narrow to `earliest=-15m` (and drop the extrusion
  scale ~10× to compensate for the lower alert counts); for an
  incident-response review widen to `earliest=-7d` (and bump
  the scale ~10× the other way, OR add a log transform per the
  [cim-network-traffic/extrusion-3d companion §2](../cim-network-traffic/extrusion-3d.md#2-spl-recipe)).
- **Colour-blind accessibility.** With `enableChoropleth +
  palette: magma`, the layer is double-encoded (height +
  colour) — readers with full colour vision get redundant
  signal, readers with deuteranopia / protanopia get the
  height-only signal (still readable). With
  `enableChoropleth: false` the layer is height-only — fully
  accessible to all colour-vision profiles. For high-stakes
  incident-commander panels prefer the height-only
  configuration unless the dashboard is also viewed on a
  non-tilt-capable client (mobile, print, screenshot-only
  review for after-action reports).
- **No OT-safety dependency.** CIM Alerts is an IT-zone
  alerting data model (ES correlation searches, ITSI notable
  events, SIEM forwarders). The recipe is safe to deploy in IT
  zones; for alerts that DO reference SIS-related signals
  (`safety_dependent: true` per the atomic-runbook contract),
  layer per-state severity escalation that distinguishes
  safety-dependent destinations and routes them to a separate
  human-in-the-loop atomic runbook per
  [/.cursor/rules/ot-safety.mdc](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6) and
smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. SPL is structurally analogous to the
[cim-network-traffic/extrusion-3d companion](../cim-network-traffic/extrusion-3d.md)
(only `tag=network,communicate` ↔ `datamodel=Alerts` and the
`src` ↔ `dest` geocoding field differ) — both recipes share the
same `iplocation`-on-state → `us-states.pmtiles` join contract.
Verification deferred to a maintainer with a Splunk dev tenant
where the Alerts data model is accelerated and ES correlation
searches / ITSI notable events / SIEM forwarder feeds are
producing alert events with public-IP `dest` values, at which
point the panel SPL can be dispatched, the camera tilted, and
the frontmatter updated to `status: verified`.
