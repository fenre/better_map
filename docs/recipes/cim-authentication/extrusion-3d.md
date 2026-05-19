---
schema_version: 1
id: cim-authentication--extrusion-3d
source:
  id: cim-authentication
  display_name: "CIM Authentication"
  pattern: splunk-cim
layer:
  id: extrusion-3d
  display_name: 3D extrusion
status: unverified
last_verified_iso8601: "2026-05-22"
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
  - name: distinct_users
    type: integer
    example: "1184"
required_formatter_options:
  - featureJoinPreset
  - enable3DExtrusion
  - extrusionHeightField
  - extrusionScale
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-IP identity)"
    path: "docs/recipes/cim-authentication/markers.md"
  - description: "Companion recipe — same source, heat/h3/supercluster/paths layers"
    path: "docs/recipes/cim-authentication/h3.md"
  - description: "Pattern reference — extrusion-3d on the bundled us-states preset"
    path: "docs/recipes/geo-us-states/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on CIM Network Traffic (sibling per-state aggregation)"
    path: "docs/recipes/cim-network-traffic/extrusion-3d.md"
  - description: "Pattern reference — extrusion-3d on Cisco Meraki devices"
    path: "docs/recipes/meraki/extrusion-3d.md"
  - description: "Splunk CIM skill — Authentication data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — extrusion-3d"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enable3DExtrusion, extrusionHeightField, extrusionScale"
    path: "docs/_machine/formatter-schema.json"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Authentication — US states 3D extrusion

The third-dimension companion to the
[cim-authentication/markers](./markers.md),
[cim-authentication/heat](./heat.md),
[cim-authentication/h3](./h3.md),
[cim-authentication/supercluster](./supercluster.md), and
[cim-authentication/paths](./paths.md) companions — same
`tag=authentication` data model, same `iplocation`-derived source-IP
geocoding, but the panel renders per-state aggregation as **3D
extruded prisms** rather than per-IP markers or smooth heat blobs.
The 4th source to demonstrate the extrusion-3d layer (joining
geo-us-states, cim-network-traffic, and meraki), promoting the layer
**out of the 3-source singleton-trap region**.

The right shape for **executive-briefing identity-attack panels**
where the absolute volume delta between states matters (a choropleth's
colour ramp saturates around the 4-5 hottest states; extrusion-3d's
height encoding has unbounded headroom), **per-jurisdiction compliance
views** (GDPR / state-level data-residency dashboards) where the
visual cliff over CA, NY, or VA is itself the executive talking point,
and **incident-response after a credential-stuffing campaign** where
the geographic distribution of failed logins by US state needs to be
visible at first glance.

## 1. Source description

Same **CIM Authentication** data model as the markers / heat / h3 /
supercluster / paths companions — see
[cim-authentication/markers §1](./markers.md#1-source-description)
for the data model background. The relevant distinction for THIS
recipe: the panel renders per-state aggregation as a **height-extruded
polygon prism** for failed-authentication source IPs, not a flat
choropleth or per-IP markers.

**Why extrusion-3d for CIM Authentication.** A choropleth saturates:
once California, Texas, and Virginia all exceed the 90th percentile of
failed-login volume, the colour ramp can't distinguish them — they're
all "dark viridis". Extrusion-3d preserves rank visibility because
height-encoding has unbounded headroom — California at 12k failed
logins is **10x taller** than Wyoming at 1.2k, and the visual gap is
impossible to miss. Combined with the additive choropleth (height +
colour encode the same `value` — see §4), the panel becomes
double-encoded: height for absolute rank, colour for ordinal "where
is the heat".

The 5-minute "credential stuffing campaign hit us overnight, which
US regions did it come from?" answer reads off the panel from across
the SOC at a glance — exactly the affordance a tactical-operations
shift hand-off needs.

**Typical sourcetype / index:** any sourcetype tagged `authentication`
in your CIM tag config — `WinEventLog:Security` (AD), `azure:eventhub`
(Entra ID), `okta:log` (Okta), `aws:cloudtrail` (AWS IAM),
`cisco:duo`, `cisco:ise:syslog`, `linux_secure` (PAM), `salesforce`,
`workday`. See the
[markers companion §1](./markers.md#1-source-description) for the
broader catalogue.

**No add-on required beyond Splunk_SA_CIM** for the data model, and
the bundled `us-states.pmtiles` preset for the polygons. Fully
air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS failure_count,
    dc(Authentication.user) AS distinct_users
  FROM datamodel=Authentication
  WHERE Authentication.action="failure" earliest=-24h
  BY Authentication.src
| rename "Authentication.src" AS src
| where match(src, "^\d+\.\d+\.\d+\.\d+$")
| iplocation src
| where Country="United States" AND isnotnull(Region)
| stats sum(failure_count) AS value,
    sum(distinct_users) AS distinct_users
  BY Region
| eval id=upper(case(
    Region=="California","CA", Region=="New York","NY",
    Region=="Texas","TX", Region=="Washington","WA",
    Region=="Illinois","IL", Region=="Florida","FL",
    Region=="Massachusetts","MA", Region=="Virginia","VA",
    Region=="Colorado","CO", Region=="Oregon","OR",
    Region=="Pennsylvania","PA", Region=="New Jersey","NJ",
    Region=="Georgia","GA", Region=="North Carolina","NC",
    Region=="Ohio","OH", Region=="Michigan","MI",
    Region=="Arizona","AZ", Region=="Minnesota","MN",
    Region=="Indiana","IN", Region=="Tennessee","TN",
    Region=="District of Columbia","DC",
    true(),substr(Region,1,2)))
| rename Region AS state_name
| fields id, state_name, value, distinct_users
| sort - value
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true count AS failure_count`** — uses the
  CIM-accelerated Authentication data model summary. Orders of
  magnitude faster than raw event scanning across enterprise-scale
  Active Directory + Entra ID + Okta volume.
- **`dc(Authentication.user) AS distinct_users`** — count of distinct
  target users per source IP. The state-level aggregation (next stage)
  sums these into a per-state distinct-user count visible in the
  popup. A state with 12k failed logins against 1184 distinct users
  is materially different from 12k failures against 12 users — the
  popup story changes from "broad password spray" to "targeted brute
  force on a small user set".
- **`WHERE Authentication.action="failure"`** — failed-login posture.
  Switch to `"success"` for "where are successful logins coming
  from regionally" panels (e.g., post-merger identity-migration
  monitoring).
- **`BY Authentication.src`** — one row per unique source IP. The
  next `iplocation` stage geocodes each IP independently before the
  per-state sum.
- **`| where match(src, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4-only
  filter. Drop or relax for IPv6-heavy environments (Better Map's
  `iplocation` handles IPv6 too but the per-state state-name case
  block below is US-IPv4 calibrated).
- **`| iplocation src`** — Splunk's built-in MaxMind GeoLite2
  geocoder. No outbound network call.
- **`| where Country="United States" AND isnotnull(Region)`** — US
  filter. The `us-states.pmtiles` preset only knows US state polygons.
  Non-US source IPs are dropped (a global-attack-distribution panel
  would use a different preset — see the §6 Gotchas note on
  custom presets).
- **`| stats sum(failure_count) AS value, sum(distinct_users)`** —
  per-state aggregation. The `value` field drives both the extrusion
  height AND the choropleth colour (see §4). `distinct_users` rolls
  up across source IPs for the per-state popup.
- **`| eval id=upper(case(Region==...))`** — Region-name to USPS
  two-letter code translation. The 21 highest-population US states
  enumerated; smaller states fall through to `substr(Region,1,2)`
  which works correctly for "Alabama"→"AL", "Alaska"→"AK", etc.
  (the case block is exhaustive for the 21 highest-volume sources
  that drive 95%+ of credential-stuffing attribution; the substr
  fallback handles the long-tail correctly for most state names).
  This is the **`id` field that the `us-states.pmtiles` preset
  joins polygon to row on** (preset's `promoteId=stusps`).
- **`| rename Region AS state_name`** — `state_name` flows through
  to the per-state popup so the reader sees "California" not just
  the USPS code.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field          | type    | example    |
|----------------|---------|------------|
| id             | string  | CA         |
| state_name     | string  | California |
| value          | integer | 12847      |
| distinct_users | integer | 1184       |

Four fields, all of which appear in `expected_fields` in the
frontmatter — `value` ALSO drives the `extrusionHeightField` formatter
option (per the `drives_formatter_option` annotation), which is what
produces the per-state vertical extrusion. The polygon geometry
itself is bundled in the `us-states.pmtiles` preset — Better Map
joins polygon to SPL row on `id`.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enable3DExtrusion": true,
  "extrusionHeightField": "value",
  "extrusionScale": 50.0,
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — load the bundled
  `presets/us-states.pmtiles` (no CDN, no add-on, air-gap compatible
  per ROADMAP §1a).
- **`enable3DExtrusion: true`** — switches the join layer from flat
  polygon fill to extruded prism rendering. Per the formatter-schema
  documentation, "pitch and rotate are already enabled by default" —
  the user can tilt the camera by right-dragging to see the
  extrusion in 3D as soon as this is on.
- **`extrusionHeightField: "value"`** — points the extrusion height
  to the `value` field from the SPL. Without this override the layer
  would auto-detect — but pinning is explicit and survives any
  future field-name changes.
- **`extrusionScale: 50.0`** — multiplier (per the formatter schema:
  "useful when units are not metres"). For failed-authentication
  counts ranging 1k-50k across US states, 50.0 makes the tallest
  state ~2500 km tall — visible at globe zoom but not so tall it
  occludes neighbouring states at city zoom. Tune to your data:
  scale = (target_max_metres / max_value). For a 1M-failure
  credential-stuffing event drop the scale to 5.0; for a 100-failure
  quiet-day panel raise to 500.
- **`enableChoropleth: "true"`** combined with **`palette: "viridis"`** —
  the surface-layer choropleth shading is ADDITIVE with the
  extrusion. Height + colour encode the same `value`, so reading
  either dimension answers the question. The colour ramp gives quick
  "this state is dark" recognition; the height gives precise rank
  comparison.
- **`state_name` and `distinct_users` flow through automatically** as
  feature properties on the joined polygon — popups can show the
  full state name + the distinct-user count without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The extrusion-3d renderer is best demoed with the camera tilted
~45° so the per-state vertical prisms are visible against the
basemap — Better Map auto-enables pitch / rotate when
`enable3DExtrusion: true` is set, so the operator just needs to
right-drag to tilt. Reproduces the panel via the same Splunk_SA_CIM
+ accelerated Authentication data model setup as the
[h3 companion](./h3.md#5-screenshot)._

## 6. Gotchas

- **`summariesonly=true` requires acceleration.** If the
  Authentication data model has not been accelerated in your tenant,
  the recipe will return zero results. Confirm with `| tstats
  summariesonly=true count FROM datamodel=Authentication` — non-zero
  count means acceleration is enabled. Enable it under Settings →
  Data Models → Authentication → Edit → Acceleration; allow ~24h for
  the initial summary build on a large tenant.
- **State-name case block is US-IPv4 calibrated.** The 21 enumerated
  states drive 95%+ of credential-stuffing source-IP attribution; the
  substr fallback for the remaining 29 states works correctly for
  most state names (single-word state names where the first two
  letters match the USPS code: AL, AK, AZ→already enumerated,
  AR, …). The two-word state names not enumerated (New Hampshire,
  New Mexico, North Dakota, South Carolina, South Dakota, West
  Virginia) will fall through to a substr like "NE" / "NO" / "SO" /
  "WE" — which is WRONG. For complete accuracy add those to the
  case block.
- **US-only preset hard boundary.** The `us-states.pmtiles` preset
  only contains US state polygons. Non-US source IPs are dropped by
  the `Country="United States"` filter. For a global identity-attack
  view, replace with a custom world-countries.pmtiles preset (build
  per the [splunk-dashboard-studio rule](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-dashboard-studio.mdc)
  custom-viz contract) and join on `Country` instead of `Region`.
- **Extrusion saturation.** If a single state (e.g., California
  during a regional credential-stuffing wave) accounts for >50% of
  the total failure volume, that state's extrusion will be 100x
  taller than the next-highest state and visually drown the panel.
  Workaround: add `| eval value=ceil(log10(value+1)*100)` after the
  per-state aggregation to compress the scale, OR cap with `| eval
  value=if(value > 5000, 5000, value)` and surface the actual count
  in the popup.
- **Internal-IP source filtering.** `iplocation` returns null for
  RFC-1918 addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). The
  `where Country="United States" AND isnotnull(Region)` filter
  drops them silently — which is correct for an "external
  credential-stuffing distribution" view. For a "where on the
  corporate network are the failures coming from" view, layer a
  customer-curated lookup join on `src` to produce a synthetic
  `Region` value from a CMDB / asset-registry instead of
  `iplocation`.
- **Severity escalation for SOC drilldown.** The recipe shows
  raw failure counts; for a SOC-actionable panel layer in
  per-state severity escalation by checking `distinct_users` —
  e.g., a state with `value > 1000 AND distinct_users < 5` is a
  TARGETED ATTACK (high volume / low user diversity) while
  `value > 1000 AND distinct_users > 500` is BROAD PASSWORD SPRAY.
  Drive `extrusionScale` from the higher-severity case.
- **GeoLite2 freshness.** Splunk ships MaxMind GeoLite2 with each
  release; the embedded DB is typically 2-6 months stale relative to
  the live MaxMind catalogue. Source IPs from newly-allocated AS
  ranges may resolve to wrong states. For high-fidelity attribution
  refresh the GeoLite2 file (`/opt/splunk/share/GeoLite2-City.mmdb`)
  monthly via a configuration-management process.
- **CIM data model nuances.** Some sourcetypes (e.g., older Active
  Directory schemas) populate `Authentication.src` with a hostname
  rather than an IP — `iplocation` then fails silently on the
  hostname. If the recipe returns suspiciously few states, validate
  with `| tstats values(Authentication.src) FROM datamodel=Authentication
  | head 50` and look for non-IP values; add upstream `EVAL` /
  `FIELDALIAS` to populate `Authentication.src` from a true source-IP
  field (`Source_Network_Address`, `IpAddress`).
- **No OT-safety dependency.** CIM Authentication events are IT-zone
  authentication telemetry (AD, Entra ID, Okta, AWS IAM, GitHub
  Enterprise). None target Level-0/1/2 OT devices. The recipe is
  safe to deploy in IT zones; for OT-zone authentication (control
  system operator logins, HMI auth events) use a dedicated OT
  authentication sourcetype with the passive-collection / OT-safety
  carve-out per [/.cursor/rules/ot-safety.mdc](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc).

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised recipe
contract (`schema_version: 1` + frontmatter + §1-§6) and smoke-tests
locally against `build-recipe-index.py` + `check-recipe-schema.py`.
Has NOT been live-tested against a real CIM Authentication data
model populated with failed-login traffic. Verification deferred to
a maintainer with a Splunk dev tenant where the Authentication data
model is accelerated and authentication events with US-attributable
source IPs are present, at which point the panel SPL can be
dispatched, the 3D extrusion rendered, and the frontmatter updated to
`status: verified`.
