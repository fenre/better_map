---
schema_version: 1
id: cim-alerts--heat
source:
  id: cim-alerts
  display_name: "CIM Alerts"
  pattern: splunk-cim
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
  - id: "builtin:iplocation"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "web-prod-04.example.com"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: alert_count
    type: integer
    example: "47"
  - name: max_severity
    type: string
    example: "critical"
  - name: weight
    type: number
    example: "0.84"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/cim-alerts/markers.md"
  - description: "Companion recipe — same source, different layer (H3 hexbin)"
    path: "docs/recipes/cim-alerts/h3.md"
  - description: "Splunk CIM skill — Alerts data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — notable events + correlation searches generate CIM Alerts"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# CIM Alerts — heatmap

The aggregate-density complement to the
[cim-alerts/markers](./markers.md) and
[cim-alerts/h3](./h3.md) recipes — same CIM-accelerated
`Alerts` data model, same `iplocation` geocoding of
`Alerts.dest`, but rendered as a weighted heatmap rather
than discrete markers or hexagonal cells. The heat layer
surfaces **alert PRESSURE** as smooth colour intensity:
hot blobs indicate regions hosting the noisiest hosts;
cool blobs indicate quiet regions. This is the natural
shape when the SOC question is "show me where the
company's alert volume is concentrating right now" rather
than "which individual host should I drill into?"
(markers) or "which region hex is hottest?" (H3).

This recipe completes the **cim-alerts source-row triplet**
(markers + h3 + heat) shipped across waves 6, 11, and 14.

## 1. Source description

Same Splunk **Alerts** Common Information Model (CIM)
data model as the [cim-alerts/markers](./markers.md) and
[cim-alerts/h3](./h3.md) companions — vendor-agnostic
because the data model normalises every event tagged
`alert` regardless of producer (ES correlation searches,
ITSI notable events, Mission Control episodes,
third-party SIEM forwarders, IDS / IPS / EDR appliances).
See the markers companion for the full list of
contributing sourcetypes.

**Why heatmap for CIM Alerts.** A markers view at world
zoom collapses every site (corporate HQ, branch offices,
datacenter regions) into overlapping clusters that bury
the "where is alert pressure concentrated" signal. An H3
view answers "which site cells are hot" with stable hex-
cell geometry, but the hexagonal grid can read as
analytically rigorous / operationally cold for
executive-briefing audiences. A heatmap aggregates per-
host alert counts into smooth Gaussian blobs that read
as "alert pressure" — the layer for **SOC leadership
dashboards** ("show me where the company's alerts are
concentrating this week"), **board-deck slides** ("here's
our global noise distribution"), and **hand-off briefings
between SOC shifts** ("the day shift left a hot blob over
US-East — investigate"), NOT for per-host investigation
(use markers) or per-site drilldown (use H3).

**Heatmap vs markers vs H3 for CIM Alerts — when to choose which.**

| Layer | Best for | Why |
|---|---|---|
| `markers` ([cim-alerts/markers](./markers.md)) | SOC analyst investigation, IR triage | Each host is individually clickable with full alert context |
| `h3` ([cim-alerts/h3](./h3.md)) | SOC stand-up, site comparison | Per-region alert totals with stable hex cells + per-cell drilldown |
| `heat` (this recipe) | SOC leadership / board briefings, shift hand-off | Smooth global alert-pressure landscape, intentionally aggregated |

All three coexist in the same dashboard via Better Map's
BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
`reset`) toggled from dashboard inputs — a single dashboard
can carry the analyst view (markers default), with
leadership / hand-off layers toggled on demand.

**Typical sourcetype / index:** anything tagged `alert`
(check `| tstats values(sourcetype) WHERE
``cim_Alerts_indexes`` tag=alert`); typical indexes are
`notable` (ES correlation results), `itsi_tracked_alerts`
(ITSI), `summary` (saved-search aggregation), and the
SIEM-forwarder indexes. This recipe queries the data-model
accelerated summary, so the source index does not appear
in the SPL.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS alert_count, values(Alerts.severity) AS severities FROM datamodel=Alerts WHERE earliest=-24h BY Alerts.dest
| rename "Alerts.dest" AS dest
| iplocation dest
| where isnotnull(lat) AND isnotnull(lon)
| where alert_count >= 1
| eval max_severity=case(mvfind(severities, "^critical$") >= 0, "critical", mvfind(severities, "^high$") >= 0, "high", mvfind(severities, "^medium$") >= 0, "medium", mvfind(severities, "^low$") >= 0, "low", mvfind(severities, "^informational$") >= 0, "informational", true(), "unknown")
| eventstats max(alert_count) AS max_alert_count
| eval weight=round(log10(alert_count + 1) / log10(max_alert_count + 1), 2)
| rename dest AS id
| fields id, lat, lon, alert_count, max_severity, weight
| sort - alert_count
| head 10000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true count AS alert_count,
  values(Alerts.severity) AS severities FROM
  datamodel=Alerts`** — reads the CIM-accelerated Alerts
  data model summary. Two aggregates per destination:
  alert count (drives heat intensity via the
  log-normalised `weight` field below) and severity
  multi-value set (folded to `max_severity` for popup
  display on hover-into-blob if your dashboard wires it
  up). Drops the `dc(Alerts.signature)` aggregate the H3
  companion uses because the heat layer renders aggregate
  PRESSURE, not per-cell signature breakdowns — signature
  diversity would be invisible inside a smoothed blob.
- **`WHERE earliest=-24h`** — bind to the same 24 h
  window as the markers / H3 siblings. Matches the
  typical SOC stand-up cadence.
- **`BY Alerts.dest`** — one row per unique destination
  host. The heat layer then Gaussian-blends per-host
  weight across nearby hosts into regional blobs.
- **`| iplocation dest`** — Splunk's built-in MaxMind
  GeoLite2 geocoder. Same caveat as the markers / H3
  companions: hostname `dest` values (internal hostnames
  without DNS suffix) silently fail to geocode and get
  filtered. For internal-host visibility, swap
  `iplocation` for a `lookup host_geocoded.csv` join on
  a customer-curated asset CMDB.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drop
  RFC-1918 internal sources so they don't pile up at
  Null Island. Same defensive filter as the H3 sibling.
- **`| where alert_count >= 1`** — defensive guard (the
  `tstats count` aggregation guarantees this post-
  aggregation, but the line makes intent explicit and
  survives any future fillnull rewrite). NOT a
  noise-floor filter — for that, raise the threshold to
  `>= 5` or higher per the tenant's baseline alert rate.
- **`| eval max_severity=case(...)`** — same severity
  folding as the H3 companion. Surfaces in the popup so
  the operator can distinguish a hot blob of
  `informational` alerts from a hot blob with one
  `critical` mixed in.
- **`| eventstats max(alert_count) AS max_alert_count`** —
  adds the per-tenant maximum alert count as a column on
  every row, so the next `eval` can normalise.
  `eventstats` (not `stats`) is the right command because
  it KEEPS the per-host rows and ADDS the new column.
  Same pattern used in every other heat recipe in the
  matrix ([cim-network-traffic/heat](../cim-network-traffic/heat.md),
  [netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md),
  [splunk-stream/heat](../splunk-stream/heat.md),
  [ot-datastreamer/heat](../ot-datastreamer/heat.md),
  [meraki/heat](../meraki/heat.md),
  [kvstore-latlon/heat](../kvstore-latlon/heat.md),
  [cim-authentication/heat](../cim-authentication/heat.md),
  [es-risk/heat](../es-risk/heat.md)).
- **`| eval weight=round(log10(alert_count + 1) /
  log10(max_alert_count + 1), 2)`** — **log-scale**
  normalisation. Alert counts in production ES tenants
  span 2-3 orders of magnitude (1-2 alerts for a
  quietly-correlating host vs 500+ for a runaway
  correlation search hitting the same host every minute).
  Linear normalisation would render every host below
  10 % of the noisiest entity as `weight ≈ 0.1` and
  produce a heatmap with one bright blob over the
  worst-affected site and nothing else visible. The
  log-scale formula preserves the rank order while
  compressing the dynamic range so the third-most-noisy
  region is still visible alongside the worst. The `+ 1`
  guards against `log10(0)` = `-inf` if `alert_count`
  ever lands at 0 (defensive — the `where alert_count
  >= 1` filter above already ensures this is not the
  case, but the `+ 1` pattern is the canonical defensive
  form across all heat recipes). See §6 Gotchas for the
  trade-offs.
- **`| rename dest AS id`** — adopt Better Map's
  canonical `id` alias.
- **`| head 10000`** — render budget. Heatmap rendering
  is fast even at 10000 features (smooth Gaussian blobs
  are cheap on the GPU). Same cap as the H3 sibling for
  consistency.

Every `|` starts its own physical line per the SPL
pipe-per-line contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field        | type    | example                |
|--------------|---------|------------------------|
| id           | string  | web-prod-04.example.com |
| lat          | number  | 47.6062                |
| lon          | number  | -122.3321              |
| alert_count  | integer | 47                     |
| max_severity | string  | critical               |
| weight       | number  | 0.84                   |

All six appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`.
`weight` is the heat-layer-required normalised intensity
field; `alert_count` and `max_severity` flow through as
feature properties for per-region drilldown popup (if the
SOC operator zooms in and hovers over a blob region, the
popup will show the strongest contributing host).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 30
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer only switches to
  heatmap above ~10000 features, so for the typical ES
  tenant (< 5000 hosts firing alerts in a 24h window)
  the recipe NEEDS the explicit pin — without it, `auto`
  would render markers and silently invert the panel's
  intent.
- **`heatmapOpacity: 0.75`** — same as the
  [es-risk/heat](../es-risk/heat.md) sibling because the
  alert-volume distribution shares the workforce-and-fleet
  spread shape (not the cloud-egress concentration shape
  of network-traffic). 0.75 keeps the heat blobs in the
  visual foreground without occluding the basemap
  geography. The formatter-schema range is 0.0-1.0.
- **`heatmapRadius: 30`** — between the network-traffic
  heatmap default (28 px) and the es-risk heatmap default
  (32 px). Alert pressure is per-HOST-at-a-SITE — one
  office may host 200 monitored hosts all contributing
  alerts to a single regional lat/lon (since
  `iplocation`'s GeoLite2 resolution is city-level, not
  street-level). 30 px provides comfortable cross-metro
  merging for "regional alert pressure" reading without
  bleeding into adjacent metros. For a single-city
  campus view, drop to 16-20 px. The formatter-schema
  range is 2-64 px.
- **`weight` drives heat intensity automatically.** The
  heat layer renderer auto-picks the `weight` field by
  name (per Better Map's `dataFitness.js` field aliasing).
  Same convention as every other heat recipe in the matrix.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). Like the markers / H3 companions, this
recipe will be validated against an ES-enabled verification
tenant rather than the default D5 lab environment — the D5
harness will not ship ES + a populated CIM Alerts data
model. A maintainer can reproduce by running the SPL
against an ES tenant with at least one active correlation
search, applying the formatter JSON in §4, and observing
that the heatmap brightens over the customer's regional
data-center / branch-office sites and dims over quiet
zones._

## 6. Gotchas

- **CIM data-model acceleration MUST be enabled.** Same
  as the markers / H3 siblings — if the Alerts data model
  is not accelerated, the `tstats summariesonly=true`
  query returns zero rows. Confirm in Settings → Data
  models → Alerts → Acceleration. The alternative
  `summariesonly=false` works but scans raw events —
  minutes to hours on busy ES installs.
- **Log-scale weight is INTENTIONAL.** Same rationale as
  every other heat recipe in the matrix — alert counts
  span 2-3 orders of magnitude; linear normalisation
  would collapse 80 % of hosts to invisibility. The
  log-scale formula preserves rank order while
  compressing dynamic range. The trade-off is that the
  weight values feel less intuitive in popups (a "weight"
  of 0.7 doesn't read as "70 % of max" — read it as the
  log-scale rank, or expose `alert_count` directly in the
  popup template instead of `weight`).
- **Heatmap vs markers vs H3 — when to choose which** (see
  §1 above). Heatmap is the right layer when the audience
  is **leadership / executive / board**, when the question
  is **"where is alert pressure concentrating?"** (not
  "which host?" or "which region?"), and when **per-host
  drilldown is NOT expected** from this panel. If the SOC
  analyst wants to click a blob and see the contributing
  host list, render the markers companion on the same
  dashboard and toggle layers via BM-CT-1 — do NOT add
  drilldown to the heatmap panel itself (heatmap blobs
  don't carry per-feature click-through, and trying to
  retrofit it creates a confusing UX).
- **Heatmap can mask single-alert criticals.** Same
  warning as the H3 companion's `sum` aggregate — a hot
  blob over an office region might be 200 hosts each
  firing 1 `informational` alert, OR 1 host firing 200
  `critical` alerts. The heatmap aggregates them
  identically. If your SOC question depends on
  distinguishing severity-weighted from count-weighted
  alert pressure, swap the `weight` formula for a
  severity-aware variant (e.g. `eval weight=
  case(mvfind(severities, "^critical$") >= 0, 1.0,
  mvfind(severities, "^high$") >= 0, 0.7, true(), 0.3)`)
  OR render the cim-alerts/h3 companion with
  `hexbinAggregate: "max"` (highlights worst host per
  cell).
- **OT-related alerts.** Same notes as the cim-alerts/h3
  companion §6 — if your ES correlation searches include
  OT-related signals (e.g. Cyber Vision IDS alerts on a
  Level-2 historian, ITSI episodes triggered by Edge Hub
  anomalies), the alerts ARE emitted from OT-adjacent
  detection, but the recipe never reads from a
  Level-0/1/2 source directly. The heatmap layer's
  smoothing makes the OT vs IT distinction MORE OPAQUE
  than for markers or H3 — a single OT-zone critical
  blended into 200 IT informational alerts visually
  disappears. Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6, OT-safety-dependent detections should carry
  `safety_dependent: true` metadata on the upstream
  correlation search and route to OT-engineering
  escalation via the runbook — those are upstream
  contracts of the alert authoring, not this recipe. If
  your tenant heavily mixes OT and IT alerts, render
  cim-alerts/markers (per-host visibility) or
  cyber-vision/heat (this wave's OT-specific heat
  recipe) for OT-specific situational awareness.
- **`Alerts.dest` is sometimes a hostname, sometimes an
  IP.** Same caveat as the markers / H3 companions.
  `iplocation` only geocodes IPs. Hostname rows render
  null lat/lon and get filtered by the `where isnotnull`
  clause — they silently disappear from the heat surface.
  For customers with a populated internal asset CMDB,
  replace the `iplocation` stage with a lookup join
  against a `host_geocoded.csv` lookup.
- **Severity nomenclature is vendor-specific.** Same
  caveat as the H3 companion. Some vendors emit
  `severity="3"` (integer), some `severity="HIGH"`
  (uppercase). The `case(...)` uses lowercase ordering —
  defensive against the typical `Splunk_SA_CIM`
  field-alias chain that normalises to lowercase. If
  your data is escaping that normalisation, add a `|
  eval severities=mvmap(severities, lower(x))` line
  before the `eval max_severity=case(...)`.
- **`alert_count` units depend on what generated the
  alerts.** Same as the markers / H3 companions. An ES
  correlation search firing once per matched event
  produces a different count semantic from an ITSI
  episode that groups N notable events. The heat layer
  aggregates them all identically — at the regional-
  pressure level this is the right semantic (region X
  has more total alerts than region Y, regardless of
  how each was grouped), but be aware when zooming in
  that the per-host counts may be heterogeneous.
- **Time range.** Hard-coded `earliest=-24h` matches the
  SOC stand-up cadence. For a 7-day "weekly alert
  landscape" leadership briefing, replace with
  `earliest=-7d`. The heatmap shape is generally stable
  across time-range adjustments — the panel just smooths
  out (longer windows produce more host contributions,
  larger blobs).
- **PII / GDPR posture.** `dest` is a hostname or IP —
  pseudonymous in most tenants. The heatmap layer is the
  **lowest-risk** of the three cim-alerts layers for
  privacy-sensitive deployments because heat blobs
  collapse identifying hostnames into anonymous regional
  pressure (the popup CAN still expose hostname-level
  data on hover, so set the `popupTemplate` formatter
  option to a category-only template like
  `"Alert pressure: {{weight}}"` to fully anonymise the
  panel for board-deck rendering). Per ROADMAP §1a
  (binding), Better Map NEVER sends event data outside
  `splunkd:8089`. `iplocation` runs server-side against
  the local MaxMind database.
- **No OT safety dependency for this layer.** This recipe
  consumes an alert (a Level-3 or Level-4 artefact
  produced by SIEM / ITSI / EDR) — not raw signals from
  a Level-0/1/2 source. Per the same Rule 6 note in the
  H3 companion, OT-safety obligations live on the
  upstream correlation search authoring, not on this
  visualization recipe.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented CIM Alerts
contract from
[`~/.cursor/skills/splunk-cim/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-cim.mdc)
and the ES correlation-search conventions in
[`~/.cursor/skills/splunk-enterprise-security/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-enterprise-security.mdc),
and reuses the same canonical
`eventstats max + log10 eval normalise` heat-weight pattern
as every other heat recipe in the matrix
([cim-network-traffic/heat](../cim-network-traffic/heat.md),
[netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md),
[splunk-stream/heat](../splunk-stream/heat.md),
[ot-datastreamer/heat](../ot-datastreamer/heat.md),
[meraki/heat](../meraki/heat.md),
[kvstore-latlon/heat](../kvstore-latlon/heat.md),
[cim-authentication/heat](../cim-authentication/heat.md),
[es-risk/heat](../es-risk/heat.md)). It has NOT been
dispatched against a tenant carrying both an active CIM
Alerts data model AND a populated set of correlation
searches. A maintainer with REST auth to such a tenant
should:

1. Run with `summariesonly=false` first to confirm the
   Alerts data model has data and `Alerts.dest` is
   populated.
2. Re-run with `summariesonly=true` (the recipe shape) to
   confirm acceleration is alive and returns the same
   shape.
3. Render the markers / H3 / heat panels side by side and
   confirm the hottest heat regions correspond to the
   loudest markers / fullest H3 cells (sanity check on
   the log-scale normalisation, the `head 10000`
   truncation, and the cross-layer consistency).
4. Vary `heatmapRadius` between 16 and 48 to find the
   sweet spot for the tenant's geographic footprint
   (concentrated single-region tenants: 16-24; multi-
   continent enterprises: 32-48).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
