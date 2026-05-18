---
schema_version: 1
id: cim-alerts--markers
source:
  id: cim-alerts
  display_name: "CIM Alerts"
  pattern: splunk-cim
layer:
  id: markers
  display_name: Markers
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
    example: "alert-host-a-2026-05-18T11:23:45"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: dest
    type: string
    example: "web-prod-04.example.com"
  - name: alert_count
    type: integer
    example: "47"
    drives_formatter_option: markerColor
  - name: max_severity
    type: string
    example: "critical"
  - name: distinct_signatures
    type: integer
    example: "8"
  - name: top_app
    type: string
    example: "splunk_enterprise_security"
required_formatter_options:
  - pointRenderer
  - markerColor
ot_safety_relevant: false
references:
  - description: "Splunk CIM skill — Alerts data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — notable events + correlation searches generate CIM Alerts"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
  - description: "Sibling — CIM Authentication markers (source-IP geocoding for credential abuse)"
    path: "docs/recipes/cim-authentication/markers.md"
---

# CIM Alerts — markers

Render alert volume by destination host on a world map by geocoding
the `dest` field with Splunk's built-in `iplocation` command. One
marker per affected host, sized and coloured by alert count, with
severity escalation pushed into "alert red" for any host above a
critical threshold. The canonical "which hosts are firing alerts
right now, and where are they geographically" panel for a NOC /
SOC overview.

## 1. Source description

Splunk's **Alerts** Common Information Model (CIM) data model
normalizes alerts from any source — saved-search alerts, ES
correlation searches, ITSI notable events, third-party SIEM
forwarders, IDS/IPS engines, EDR platforms — into a stable schema.
Any sourcetype that maps the CIM-required fields (`signature`,
`severity`, `dest`, `app`, `vendor_product`) and is tagged `alert`
participates in the data model — meaning this recipe is
**vendor-agnostic** at the SPL layer. It runs against:

- Splunk Enterprise Security correlation searches (`stash`
  sourcetype tagged `alert`)
- Splunk ITSI episodes / notable events
  (`stash_itsi_notable`)
- Splunk Mission Control case-management episodes
- Saved-search alert actions writing to `_audit` (system-level)
  or a per-app `summary` index
- Third-party SIEM forwarders (Splunk_TA_paloalto for
  PAN-OS threat logs, Splunk_TA_crowdstrike for Falcon
  detections, Splunk_TA_microsoft-cloudservices for
  Sentinel alerts)
- IDS/IPS appliances (Snort, Suricata, Cisco Firepower
  IDS events tagged `alert`)
- EDR platforms (CrowdStrike Falcon, SentinelOne,
  Microsoft Defender for Endpoint)

The unifying contract: `tag=alert` selects every event the CIM
Alerts data model has been told about. The CIM Alerts data model
is **acceleration-eligible** — when accelerated (typical in any
ES install), the `tstats summariesonly=true` form below runs in
seconds even across millions of alerts.

**Typical sourcetype / index:** anything tagged `alert` (check
`| tstats values(sourcetype) WHERE `cim_Alerts_indexes`
tag=alert`). Typical indexes: `notable` (ES correlation results),
`itsi_tracked_alerts` (ITSI), `summary` (saved-search aggregation),
and the SIEM-forwarder indexes (`pan_logs`, `crowdstrike`, etc.).

The CIM Alerts data model is documented in the
[Splunk CIM skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-cim/SKILL.md);
the field-reference table there enumerates every required +
optional CIM-Alerts field with vendor mapping examples.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS alert_count,
    dc(Alerts.signature) AS distinct_signatures,
    values(Alerts.severity) AS severities,
    values(Alerts.app) AS apps
  FROM datamodel=Alerts WHERE earliest=-24h
  BY Alerts.dest
| rename "Alerts.dest" AS dest
| iplocation dest
| where isnotnull(lat) AND isnotnull(lon)
| eval max_severity=case(
    mvfind(severities, "^critical$") >= 0, "critical",
    mvfind(severities, "^high$") >= 0, "high",
    mvfind(severities, "^medium$") >= 0, "medium",
    mvfind(severities, "^low$") >= 0, "low",
    mvfind(severities, "^informational$") >= 0, "informational",
    true(), "unknown")
| eval top_app=mvindex(apps, 0)
| eval id=dest . "-" . strftime(now(), "%Y-%m-%dT%H:%M:%S")
| fields id, lat, lon, dest, alert_count, max_severity,
    distinct_signatures, top_app
| sort - alert_count
| head 500
```

What the pipeline does, stage by stage:

- **`| tstats summariesonly=true count ... FROM datamodel=Alerts`** —
  uses the accelerated CIM Alerts data model. The
  `summariesonly=true` flag forces queries to use the accelerated
  TSIDX summaries — orders of magnitude faster than raw event
  scanning. Required for acceleration to engage; without it,
  Splunk silently falls back to raw scanning and the recipe goes
  from "seconds" to "minutes-to-hours" on a busy ES install.
- **`BY Alerts.dest`** — aggregates by destination host. The CIM
  schema's `dest` field is typically a hostname or IP; `iplocation`
  on the next line handles both (hostnames are resolved via the
  Splunk DNS lookup if available, otherwise null lat/lon).
- **`dc(Alerts.signature)`** — counts distinct alert signatures
  per host. A host firing 47 alerts of 1 signature (e.g., one
  noisy IDS rule) is materially different from a host firing 47
  alerts of 8 signatures (multi-pronged event). The
  `distinct_signatures` field surfaces this distinction in
  popups.
- **`values(Alerts.severity)`** — collects the multi-value
  severity set per host. The `eval max_severity=case(...)` then
  picks the highest-severity value in the conventional severity
  ordering (`critical > high > medium > low > informational`).
  This is the field that drives the colour ramp in §4.
- **`| iplocation dest`** — Splunk's built-in geo-enrichment
  (MaxMind GeoLite2; ships with Splunk Enterprise / Cloud out of
  the box). Populates `lat`, `lon`, `Country`, `City` for any
  `dest` that's a public IP. Internal hostnames typically resolve
  to null (no DNS suffix → no resolution); the `where isnotnull`
  filter on the next line drops them. For hosts with a private
  IP and a known geo (e.g., per-site internal hosts) use a
  customer-curated lookup join instead of `iplocation` (the
  `iplocation` command has no view into customer asset
  registries).
- **`| eval id=dest . "-" . strftime(now(), ...)`** — unique row
  id combining the destination host + the current timestamp. The
  marker layer dedups on `id`; without the timestamp suffix,
  panel auto-refresh would deduplicate consecutive snapshots into
  one marker (silent data loss).
- **`| sort - alert_count | head 500`** — defensive cap. On a
  busy ES install with thousands of unique `dest` hosts, the
  marker layer slows visibly above 500 markers. 500 is the
  pragmatic "top noisy hosts" view; bump to 1000 if your
  dashboard is dedicated to alert-volume analysis and panel
  responsiveness can be sacrificed.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field               | type    | example                                  |
|---------------------|---------|------------------------------------------|
| id                  | string  | alert-host-a-2026-05-18T11:23:45         |
| lat                 | number  | 47.6062                                  |
| lon                 | number  | -122.3321                                |
| dest                | string  | web-prod-04.example.com                  |
| alert_count         | integer | 47                                       |
| max_severity        | string  | critical                                 |
| distinct_signatures | integer | 8                                        |
| top_app             | string  | splunk_enterprise_security               |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "markers",
  "markerColor": "#d62728"
}
```

Why this minimal config:

- **Auto-detect handles lat / lon / id / value.** The SPL's
  `fields` selection aligns every binding field to Better Map's
  canonical-alias list (`lat`, `lon`, `id`). `alert_count` is in
  the VALUE alias list and drives marker sizing automatically —
  hosts with 1-2 alerts render small, hosts at the top of the
  distribution render large. (Compare to the bundled CIM
  Authentication markers recipe at
  [`docs/recipes/cim-authentication/markers.md`](https://fenre.github.io/better_map/recipes/cim-authentication/markers/)
  which follows the same pattern with `failure_count` as the
  value-alias-driven size.)
- **`pointRenderer: "markers"`** — pin the renderer to per-row
  markers explicitly. The `auto` renderer would demote to hexbin
  if row count crosses a threshold; pinning keeps the panel
  intent (per-host visibility for drilldown) consistent even
  when alert volume changes day-over-day.
- **`markerColor: "#d62728"`** — Better Map default is the soft
  teal `#8dd3c7`. For an alerts panel that default is too
  friendly — every marker is by definition an alert-firing host.
  Override to Tableau "alert red" so a SOC / NOC analyst reads
  the panel as "warning surface" the moment it loads. Use the
  diverging-palette `palette: "rdylbu"` only when alert volume
  is normalised against a "healthy" baseline (e.g., alert rate
  above-baseline vs below-baseline) — not in this raw-count
  panel.
- **Optional:** if you want data-driven colour ramp instead of a
  single static "alert red" — switch to the H3 hexbin recipe at
  [`docs/recipes/csv-lookup-geo/h3.md`](https://fenre.github.io/better_map/recipes/csv-lookup-geo/h3/)
  (or author a `cim-alerts/h3.md` follow-up). The hexbin layer
  honours `palette` for the colour ramp; the markers layer
  uses a static `markerColor` + value-driven size.
- **Optional:** add a popup template that surfaces `max_severity`
  and `top_app` for analyst triage. Better Map's default popup
  includes every emitted field, but the formatter's `popupTemplate`
  option lets you control ordering.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). Until then, a maintainer can reproduce the panel by pasting the
SPL above into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic ES correlation-search corpus seeded with
geographic diversity for screenshot stability._

## 6. Gotchas

- **CIM data-model acceleration MUST be enabled** on the `Alerts`
  data model for `summariesonly=true` to return anything. Confirm
  in Settings → Data models → Alerts → Acceleration. If accel
  is OFF, the dashboard panel returns zero rows even when alerts
  are firing live. The alternative `summariesonly=false` works
  but scans raw events, slowing the panel from sub-second to
  minutes on busy ES installs (typical ES tenants generate
  10k-100k+ alerts per day, all of which would need a raw scan).
- **`Alerts.dest` is sometimes a hostname, sometimes an IP.**
  `iplocation` only geocodes IPs. For hostname `dest` values,
  rows render with null lat/lon and get filtered out by the
  `where isnotnull` clause — they silently disappear from the
  map. For customers with a populated internal asset CMDB,
  replace the `iplocation` stage with a lookup join against a
  `host_geocoded.csv` lookup (one row per known internal host +
  its site lat/lon).
- **Severity nomenclature is vendor-specific.** Some vendors emit
  `severity="3"` (integer), some `severity="medium"` (string),
  some `severity="HIGH"` (uppercase). The recipe's `case(...)`
  uses lowercase ordering — defensive against the typical
  `Splunk_SA_CIM` field-alias chain that normalizes severity to
  lowercase. If your data is escaping that normalization, add a
  `| eval severities=mvmap(severities, lower(x))` line before
  the `eval max_severity=case(...)`.
- **`alert_count` units depend on what generated the alerts.**
  An ES correlation search that fires once per matched event
  produces a different count semantic from an ITSI episode that
  groups N notable events. The recipe sums them all the same
  way; surface the distinction in the popup by adding `top_app`
  (already done) or by computing a per-app split with
  `stats count BY Alerts.app`.
- **The 500-row `head` cap will hide hosts on very busy installs.**
  An ES install processing 100k+ alerts/day can have 5k+ unique
  `dest` hosts. The `head 500` keeps the top noisy hosts on the
  map but truncates the long tail. For long-tail-aware panels,
  drop the `head` and let the marker layer auto-aggregate (which
  it will, falling back to hexbin above ~10k markers — at which
  point this becomes the `cim-alerts/h3` recipe, not this one).
- **No OT safety dependency.** The `Alerts` data model is a
  general-purpose alert aggregator. If your ES correlation
  searches include OT-related signals (e.g., Cyber Vision IDS
  alerts on a Level-2 historian, ITSI episodes triggered by
  Edge Hub anomalies), the alerts ARE emitted from OT-adjacent
  detection, but the recipe never reads from a Level-0/1/2
  source directly — the alert (a Level-3 or Level-4 artefact
  produced by the SIEM / ITSI / EDR engine) is the input. Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6, any OT-safety-dependent detection should carry
  `safety_dependent: true` metadata in the correlation search /
  ITSI policy AND its runbook should include an OT-engineering
  escalation step — those are upstream contracts of the alert
  authoring, not this recipe.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`tstats`, `iplocation`,
`case`, `mvfind`, `mvindex`, `eval`, `fields`, `sort`, `head`).
The CIM Alerts data model is a core Splunk Enterprise Security
artefact; the recipe assumes acceleration is enabled. It has not
been dispatched against the v1.7-prep lab tenant in this PR
because (a) non-interactive admin auth is not present in the
agent workspace, and (b) the v1.7-prep lab tenant does not carry
a populated CIM Alerts data model (no ES install, no correlation
searches). A maintainer with REST auth and an ES-enabled tenant
should:

1. Confirm `Splunk_SA_CIM` is installed and the Alerts data model
   is enabled.
2. Confirm Alerts acceleration is ON (Settings → Data models →
   Alerts → Acceleration).
3. Dispatch the recipe SPL via REST and confirm at least one row
   is returned (any ES install with active correlation searches
   will produce rows; for a fresh ES install with no firing
   correlation searches yet, seed test data via
   `Splunk_SA_CIM`'s `tutorialdata.tgz`).
4. Drop the panel into a Dashboard Studio dashboard with the
   formatter JSON in §4 and confirm markers render with
   colour-by-alert-count.
5. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
