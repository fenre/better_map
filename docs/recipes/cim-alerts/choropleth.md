---
schema_version: 1
id: cim-alerts--choropleth
source:
  id: cim-alerts
  display_name: "CIM Alerts"
  pattern: splunk-cim
layer:
  id: choropleth
  display_name: Choropleth
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
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, extrusion-3d layer (height-encoded sibling)"
    path: "docs/recipes/cim-alerts/extrusion-3d.md"
  - description: "Companion recipes — same source, markers / h3 / heat / supercluster / paths layers"
    path: "docs/recipes/cim-alerts/markers.md"
  - description: "Pattern reference — choropleth on CIM Network Traffic (sibling CIM source, viridis palette)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Pattern reference — choropleth on CIM Authentication (sibling CIM source, magma palette)"
    path: "docs/recipes/cim-authentication/choropleth.md"
  - description: "Pattern reference — choropleth on the bundled us-states preset (canonical demo)"
    path: "docs/recipes/geo-us-states/choropleth.md"
  - description: "Splunk CIM skill — Alerts data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — notable events + correlation searches generate CIM Alerts"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Alerts — US states choropleth

The per-state aggregation lens for CIM Alerts. Same `tag=alert`
data model as the
[cim-alerts/markers](./markers.md),
[h3](./h3.md),
[heat](./heat.md),
[paths](./paths.md), and
[supercluster](./supercluster.md) companions — but instead of
rendering individual alerts / smooth density / hex bins / cluster
bubbles, the recipe geocodes each alert's `dest` IP via Splunk's
`iplocation`, filters to US events, and shades the bundled
`us-states` vector-tile preset by per-state alert volume. The
right shape for **executive "where is my alert pressure
concentrated by jurisdiction" briefings**, **per-state HIPAA /
state-DPA notification triage** (per-state alert volume drives
the regulator's reach), and **per-state SOC capacity-planning
panels** (which states justify expanded on-call coverage).

The CIM Alerts source row now has **6 layer cells** (markers, h3,
heat, paths, supercluster, plus choropleth now). Choropleth is
the FIRST POLYGON-DERIVED layer cell on this source (markers / h3
/ heat / supercluster are all point-derived; paths is polyline-
derived; choropleth is the first polygon-shaded layer cell on
cim-alerts — making this the source-row equivalent of the
cim-network-traffic full polygon-shape diversity row). The
[extrusion-3d companion](./extrusion-3d.md) lands in the same
wave and stacks height on top of the same per-state
aggregation — this recipe is the height-free sibling.

## 1. Source description

Same **CIM Alerts** data model as the markers / h3 / heat / paths
/ supercluster companions — see
[cim-alerts/markers §1](./markers.md#1-source-description) for
the data model background and the `tag=alert` contract. The
relevant distinction for THIS recipe: the panel renders per-state
alert aggregation as a polygon choropleth (the bundled
`us-states` PMTiles preset), not per-event markers, smooth
density, hex bins, or cluster bubbles.

**Why choropleth for CIM Alerts.** A markers panel shows
per-host identity but is bandwidth-limited at high alert volumes
and visually noisy. A heatmap shows smooth density but obscures
jurisdictional boundaries (a hot blob crossing CA / NV doesn't
tell you "Nevada specifically"). An H3 hexbin shows
hard-bordered jurisdictional sum-aggregation but the cell
boundaries are H3-defined, not political — useless for a
state-AG-investigation panel that needs to answer "how many
alerts hit California-resident systems this quarter". A choropleth
solves the political-boundary question: every alert whose `dest`
IP geocodes inside a state's polygon contributes to that state's
tally, the renderer shades the polygon by the tally, and the
result maps cleanly onto a compliance / regulatory / per-state
business view.

The 5-minute "tactical NOC hand-off — where is alert pressure
concentrated right now by US state" answer reads off the
choropleth panel from across the SOC at a glance; the operator
then clicks the darkest state to drill into per-host attribution
via the companion markers / supercluster panels.

**Typical sourcetype / index:** anything tagged `alert` (check
`| tstats values(sourcetype) WHERE \`cim_Alerts_indexes\` tag=alert`).
Typical indexes: `notable` (ES correlation results),
`itsi_tracked_alerts` (ITSI), `summary` (saved-search aggregation),
and the SIEM-forwarder indexes (`pan_logs`, `crowdstrike`,
`microsoft365`, etc.). See the
[markers companion §1](./markers.md#1-source-description) for the
broader catalogue.

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

The SPL is **deliberately identical** to the
[cim-alerts/extrusion-3d companion](./extrusion-3d.md#2-spl-recipe)
— the only differences live in the formatter config (§4). This
is the recipe matrix's "one CIM source, two polygon-derived
layers, two views" demo: the dashboard author swaps `choropleth`
for `extrusion-3d` (or combines both as the additive default
config does) without any SPL re-authoring.

Why each line is shaped this way is documented in the
[extrusion-3d companion §2](./extrusion-3d.md#2-spl-recipe) —
the line-by-line "`tstats summariesonly=true` → per-host
aggregation → `iplocation` → US filter → per-state re-aggregation
→ state-abbr derivation → `value` alias → trim + sort" pipeline
applies verbatim. Only the choropleth-specific notes are below:

- **No log transform needed for choropleth.** Per-state alert
  counts for a typical 24h SOC window span 100-50k alerts. The
  viridis / magma palette interpolates colour across that
  ~500× range cleanly — readers can distinguish California
  (dark) from Texas (lighter dark) at globe zoom. Add a log
  transform (`| eval value=ceil(log10(alert_count+1)*1000)`)
  only if your span exceeds 4 orders of magnitude (e.g., a
  CDN-fronted ES tenant with one outlier state at 1M alerts
  and most states at 100-1k).
- **Pre-filtering by severity is the SOC's first lever.** If
  the panel is too noisy (every state shaded dark because
  low-severity alerts dominate the count) add `WHERE
  Alerts.severity IN ("critical","high")` to the inner
  `tstats`. The colour ramp re-saturates against the high-
  severity subset, which is usually the more actionable
  question anyway.

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
`value` drives the choropleth shading; `alert_count`,
`distinct_hosts`, `max_severity`, and `state_name` flow through
as feature properties on the joined polygon for popups.

The polygon geometry itself is NOT a field — Better Map fetches
it internally from the `us-states.pmtiles` preset configured in
§4.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why this minimal config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap
  compatible per ROADMAP §1a). The preset hardcodes
  `promoteId: 'stusps'` (USPS 2-letter state abbreviation),
  which is why the §2 SPL produces an `id` field that contains
  the abbreviation rather than the full state name.
- **`enableChoropleth: "true"`** — switches the joined-polygon
  layer from "outline only" (default for `featureJoin` layers
  without choropleth enabled) to "value-shaded fill". The SPL
  MUST produce a `value` field for shading; rows with no
  `value` render with the unmatched-grey fallback fill.
- **`palette: "magma"`** — perceptually uniform palette
  ramping from deep purple (low alert volume) through orange
  to bright yellow (high alert volume). The warm-colour-
  equates-with-danger semantics fit a SECURITY panel better
  than the cim-network-traffic companion's `viridis` (green-
  blue-purple, which reads as "cool / safe / informational"
  to most viewers). For diverging data (e.g., "this week's
  alert volume vs the 30-day baseline, positive or negative")
  switch to `rdbu` and set `colorScaleMid` to the baseline
  value — but for raw-volume views (the typical case), `magma`
  is the right default.
- **`state_name`, `alert_count`, `distinct_hosts`,
  `max_severity` flow through automatically** as feature
  properties on the joined polygon — popups show the full
  state name + alert volume + distinct-host breadth +
  max-severity escalation without further config.

For double-encoded panels (height + colour driven by the same
`value`), use the [extrusion-3d companion](./extrusion-3d.md)
config instead — same SPL, formatter adds `enable3DExtrusion:
true` + `extrusionHeightField: "value"` + `extrusionScale: 500.0`.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by accelerating the CIM Alerts data
model in a Splunk dev tenant, generating ~500-5,000 synthetic
alerts via the `| makeresults | eval dest=mvindex(...) | collect
index=summary` pattern documented in the
[cim-alerts/markers companion](./markers.md#5-screenshot), then
dispatching the §2 SPL into a Dashboard Studio map panel with
Better Map as the visualization and applying the §4 formatter
JSON. The choropleth should shade California, Texas, New York,
and other major-cloud-region states darker than rural states._

## 6. Gotchas

- **`summariesonly=true` requires acceleration.** Same caveat
  as the [extrusion-3d companion §6](./extrusion-3d.md#6-gotchas):
  if the CIM Alerts data model is not accelerated, the recipe
  returns zero results. Enable under Settings → Data Models →
  Alerts → Edit → Acceleration; allow ~24h for the initial
  summary build on a large tenant.
- **US-only preset is a hard boundary.** Same as the
  [cim-network-traffic/choropleth companion §6](../cim-network-traffic/choropleth.md#6-gotchas):
  the bundled `us-states.pmtiles` is the 50 states + DC. Non-US
  events from `iplocation` are filtered out by the
  `Country="United States"` guard. For global SOC coverage,
  ship a custom `world-countries` PMTiles tileset, point
  `featureJoinUrl` at it instead of `featureJoinPreset`, and
  swap the per-state `Region` aggregation → `Country`
  aggregation + the explicit case list → a per-country
  ISO-3166-1 alpha-3 lookup (the Natural Earth countries
  tileset's `iso_a3` property is the canonical join key).
- **Colour ramp saturates.** A multi-state phishing wave or
  worm-propagation event pushes 5-10 states past the
  90th-percentile alert volume within minutes, and the magma
  ramp can't distinguish "California fired 12k alerts" from
  "Texas fired 8k" — they're both "bright yellow" with a
  barely-visible hue gap. The
  [extrusion-3d companion](./extrusion-3d.md) is the answer for
  panels where the absolute rank between top states matters
  — height-encoding has unbounded headroom where the colour
  ramp does not. For choropleth-only panels under colour
  saturation, pre-filter the SPL by severity (`WHERE
  Alerts.severity="critical"` only) to thin the per-state
  counts back into the discriminable range.
- **MAUP — choropleth amplifies geographic bias.** Same
  caveat as the
  [cim-network-traffic/choropleth companion §6](../cim-network-traffic/choropleth.md#6-gotchas):
  California always looks dominant because it's the
  geographically-largest western state with the most public
  IPs AND tends to host the cloud regions / CDN endpoints that
  attract the most alerts. The dashboard's surrounding markdown
  should explicitly document that the rendered choropleth
  reflects POPULATION-WEIGHTED alert density (more public IPs
  ≈ more alerts ≈ darker shade), not per-capita risk. For
  area-neutral aggregation use the
  [cim-alerts/h3 companion](./h3.md) with `hexbinResolution:
  4-5` (cell area is constant across all cells, so a hot cell
  really means "high alert density per unit area").
- **`iplocation` accuracy varies by IP type.** Same caveat as
  the [extrusion-3d companion §6](./extrusion-3d.md#6-gotchas).
  Splunk's bundled MaxMind GeoLite2 database resolves US
  public IPs to state-level with ~80-90% accuracy. Hosting-
  provider IPs (AWS, Azure, GCP, Cloudflare) often resolve to
  where the PROVIDER is headquartered (often CA / WA / VA)
  regardless of which datacenter actually served the request.
  Combined with the choropleth's visual amplification, the
  rendered "California spike" may overstate California's true
  alert share by 30-40%. Document this caveat in the
  dashboard's surrounding markdown.
- **State case list is incomplete by design.** Same caveat as
  the [extrusion-3d companion §6](./extrusion-3d.md#6-gotchas):
  the explicit 21-state list covers states that dominate a
  mid-size US SOC's alert panel; the remaining 29 states use a
  `substr(Region,1,2)` fallback which is correct for many but
  wrong for some (Iowa → IO instead of IA, etc.). Wrong codes
  mean the polygon won't join — that state is silently
  rendered with the unmatched-grey fallback fill. For perfect
  50-state coverage expand the case list to all 50 states OR
  externalize the mapping to a CSV lookup (`| lookup
  us_state_abbr region OUTPUT abbr AS id`).
- **Time-window calibration.** The `earliest=-24h` window
  matches the markers / extrusion-3d companions. For a
  real-time SOC panel narrow to `earliest=-15m`; for an
  incident-response review widen to `earliest=-7d`. The
  choropleth re-renders correctly at any time window without
  formatter-config changes — only the colour ramp's calibration
  shifts (a 7-day window will have ~7× higher per-state counts
  than a 24h window, so the relative ranking is preserved but
  the absolute alert-count popup numbers change).
- **No OT-safety dependency.** Same posture as the
  [cim-alerts/extrusion-3d companion §6](./extrusion-3d.md#6-gotchas):
  CIM Alerts is an IT-zone alerting data model. For alerts
  that reference SIS-related signals (`safety_dependent: true`),
  layer per-state severity escalation that distinguishes
  safety-dependent destinations and routes them to a separate
  human-in-the-loop atomic runbook per
  [/.cursor/rules/ot-safety.mdc](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6) and
smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. SPL is structurally identical to the
[cim-alerts/extrusion-3d companion](./extrusion-3d.md) (only
formatter options differ). Verification deferred to a maintainer
with a Splunk dev tenant where the Alerts data model is
accelerated and ES correlation searches / ITSI notable events
/ SIEM forwarder feeds are producing alert events with public-IP
`dest` values.
