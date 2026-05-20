---
schema_version: 1
id: cyber-vision--choropleth
source:
  id: cyber-vision
  display_name: "Cisco Cyber Vision (components + vulnerabilities)"
  pattern: splunk-vendor-ta
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-31"
verified_against: null
splunk_apps_required:
  - id: "TA-cisco-cybervision"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "TX"
    drives_formatter_option: idField
  - name: state_name
    type: string
    example: "Texas"
  - name: value
    type: integer
    example: "12"
  - name: vulnerable_asset_count
    type: integer
    example: "12"
  - name: total_asset_count
    type: integer
    example: "47"
  - name: vulnerable_ratio
    type: number
    example: "0.26"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, markers layer (per-asset drilldown — author this recipe to mirror its asset / vulnerability join shape)"
    path: "docs/recipes/cyber-vision/markers.md"
  - description: "Companion recipe — same source, h3 / heat / supercluster / paths layers"
    path: "docs/recipes/cyber-vision/h3.md"
  - description: "Pattern reference — choropleth on CIM Performance (sibling US-states preset, breaching-host count → reusable geom geo_us_states chain)"
    path: "docs/recipes/cim-performance/choropleth.md"
  - description: "Pattern reference — choropleth on CIM Alerts (sibling US-states preset, severity-weighted alerting metric)"
    path: "docs/recipes/cim-alerts/choropleth.md"
  - description: "cisco-products skill — Cisco Cyber Vision sourcetypes, components / flows / events / vulnerabilities"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "cisco-splunk-integration skill — Cyber Vision passive DPI, API endpoints, integration patterns"
    path: "~/.cursor/skills/cisco-splunk-integration/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive DPI is the reference design, Rule 1)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enableChoropleth, featureJoinPreset, palette"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco Cyber Vision — US states choropleth

Aggregate the Cisco-Cyber-Vision-discovered OT asset fleet by US
state (via the operator-maintained `cybervision_sites.csv` lookup
extended with lat/lon) and render as a **flat-fill choropleth**
over the bundled `us-states.pmtiles` preset. Per-state colour
saturation encodes the **count of OT assets with at least one
high-CVSS vulnerability** (`max_cvss >= 7.0` — the NIST
"high"-severity threshold). The right shape for **OT-SecOps
executive briefings** and **US-fleet vulnerability-coverage
reviews** where the question is "which US states host our most
exposed OT infrastructure?" — not "which individual PLCs are
vulnerable" (use [markers](./markers.md) for that), and not
"where is asset density highest" (use [h3](./h3.md) for that).

The **9th choropleth recipe in the matrix** — joining
[geo-us-states](../geo-us-states/choropleth.md),
[cim-network-traffic](../cim-network-traffic/choropleth.md),
[cim-authentication](../cim-authentication/choropleth.md),
[cim-alerts](../cim-alerts/choropleth.md),
[cim-performance](../cim-performance/choropleth.md),
[thousandeyes](../thousandeyes/choropleth.md),
[itsi-kpi-base](../itsi-kpi-base/choropleth.md), and
[splunk-stream](../splunk-stream/choropleth.md). This advances
the choropleth layer column from 8 cells to 9, and brings the
cyber-vision source row from 5 cells to 6 (markers, h3, heat,
supercluster, paths, plus choropleth now). The recipe is the
**first OT-safety-relevant choropleth in the matrix** — the
metric being shaded is `safety_related=Y`-marked OT asset
exposure, with the full
[`~/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
contract applied to the input data (passive-DPI-only collection
via Cyber Vision, no active probing of the OT zone, read-only
mirror of the customer SRS for safety-classification annotations).

## 1. Source description

Same **Cisco Cyber Vision** passive-DPI platform as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), and [paths](./paths.md)
companions — see
[cyber-vision/markers §1](./markers.md#1-source-description)
for the full platform background, the four sourcetype streams
(`cisco:cybervision:components` / `:flows` / `:events` /
`:vulnerabilities`), and the OT-safety boundary (Rule 1: Cyber
Vision is the reference passive-DPI design; this recipe
consumes its already-passive metadata stream).

The relevant distinction for THIS recipe: instead of one marker
per OT asset (markers companion) or one hex per regional density
bucket (h3 companion), the panel aggregates **per US state**.
Per-asset vulnerability detection (the `max(cvss_score)` rollup
from markers) is computed first, then assets are joined against
the operator-maintained `cybervision_sites.csv` lookup to get
lat/lon, then Splunk's `geom geo_us_states` point-in-polygon
command derives the US state from the lat/lon pair, and finally
aggregated per state.

**Why choropleth for Cyber Vision.** A markers panel shows
WHICH assets are vulnerable; a heat panel shows aggregate
density. But neither answers the **executive-distribution
question**: "across the 50 US states, which ones host our
most-exposed OT infrastructure?" A choropleth solves this in
one panel: states with ≥1 vulnerable asset get coloured, states
with zero are blank. This is the right shape for **OT-SecOps
patching-priority reviews** ("which plant region needs the next
PLC firmware refresh?"), **executive incident retros** ("the
breach pivot was concentrated in our Texas plants — visible as
the darkest state on the panel"), and **regional compliance
posture views** (per-state vulnerable-asset count as the proxy
for "where is the IEC 62443 / NERC CIP exposure highest?").

**Why the bundled `us-states.pmtiles` preset.** Same air-gap
posture as the
[cim-performance/choropleth](../cim-performance/choropleth.md)
and [splunk-stream/choropleth](../splunk-stream/choropleth.md)
companions: bundled preset, no CDN, no add-on beyond Splunk
Core's `geo_us_states` lookup, fully air-gap compatible per
ROADMAP §1a. For tenants with a global OT footprint (multi-
national manufacturing / energy), pair this with the future
`cyber-vision/vector-tile-join` recipe (customer-hosted world-
countries PMTiles + per-country aggregation via the asset's
plant_country field). For most US-centric tenants the
50-states-plus-DC view is the operationally-correct resolution
— OT plants are typically clustered by region rather than
distributed globally.

**Typical sourcetype / index:** Same as the
[markers companion §1](./markers.md#1-source-description) —
`index=cybervision`, sourcetype-prefixed `cisco:cybervision:*`.
The TA is `TA-cisco-cybervision`. The site lookup is operator-
maintained (no automated way to derive plant-floor coordinates
from Cyber Vision metadata) and MUST be extended with `lat` /
`lon` columns per the
[markers companion §6 Gotchas](./markers.md#6-gotchas) site
lookup schema.

**No add-on required beyond `TA-cisco-cybervision`** for the
Cyber Vision data and Splunk Core's bundled `geo_us_states`
geometry lookup for the point-in-polygon step. Fully air-gap
compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
index=cybervision sourcetype="cisco:cybervision:components" earliest=-24h latest=now
| dedup asset_id sortby - _time
| rename asset_id AS id
| join type=left id [
    search index=cybervision sourcetype="cisco:cybervision:vulnerabilities" earliest=-24h latest=now
    | stats max(cvss_score) AS max_cvss BY asset_id
    | rename asset_id AS id
  ]
| fillnull value=0 max_cvss
| eval is_vulnerable=if(max_cvss >= 7.0, 1, 0)
| lookup cybervision_sites.csv asset_id AS id OUTPUT lat, lon, safety_related, site_name
| where isnotnull(lat) AND isnotnull(lon)
| geom geo_us_states featureIdField="stusps" latitude=lat longitude=lon
| where isnotnull(featureId)
| stats sum(is_vulnerable) AS vulnerable_asset_count,
    count AS total_asset_count,
    values(state_name) AS state_name
  BY featureId
| eval vulnerable_ratio=round(vulnerable_asset_count / total_asset_count, 2)
| eval value=vulnerable_asset_count
| rename featureId AS id
| fields id, state_name, value, vulnerable_asset_count, total_asset_count, vulnerable_ratio
| sort - value
```

Why this exact shape, line by line:

- **`index=cybervision sourcetype="cisco:cybervision:components"
  earliest=-24h latest=now`** — components stream over 24 h.
  Same window choice as the
  [markers companion §2](./markers.md#2-spl-recipe): Cyber
  Vision re-publishes the asset inventory periodically (default
  every 5 min for changed records); 24 h guarantees every
  active asset is in the sample even when re-published only
  on changes.
- **`dedup asset_id sortby - _time`** — one row per asset
  (freshest record). Same pattern as markers companion.
- **`rename asset_id AS id`** — adopt Better Map's `id` alias.
- **`join type=left id` subsearch (vulnerabilities)** — same
  vulnerability-rollup pattern as the markers companion, but
  reduced to just `max(cvss_score)` per asset (the choropleth
  doesn't need the per-asset `cve_count` — only the binary "is
  this asset vulnerable" flag). `type=left` keeps assets with
  no CVEs (the denominator counts ALL assets, not just the
  vulnerable ones).
- **`fillnull value=0 max_cvss`** — assets with no CVEs get
  NULL from the join; promote to 0 so the `eval` predicate
  evaluates cleanly.
- **`eval is_vulnerable=if(max_cvss >= 7.0, 1, 0)`** — the
  binary breach flag per asset. **7.0** is the NIST CVSS
  v3.x cutoff between "Medium" (4.0-6.9) and "High" (7.0-8.9);
  9.0+ is "Critical". Choose 7.0 for "show me anything
  patchable-now-priority", 9.0 for "show me only emergencies",
  4.0 for "show me anything with a CVE at all". The choropleth
  shading is sensitive to this threshold; document the
  threshold in companion table panels so the operator knows
  which severity tier the colours encode.
- **`lookup cybervision_sites.csv asset_id AS id OUTPUT lat,
  lon, safety_related, site_name`** — the operator-maintained
  site lookup, schema documented in the
  [markers companion §6 Gotchas](./markers.md#6-gotchas).
  This recipe needs lat/lon (for `geom` aggregation) PLUS
  `safety_related` (for the OT-safety contract — see §6
  below) PLUS `site_name` (popup display). `zone_purdue_level`
  is OMITTED from the projection because per-state aggregation
  collapses Purdue levels into a single state-level number —
  if the operator wants per-Purdue-level breakdown, that's a
  separate recipe with `BY featureId, zone_purdue_level`.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop assets
  not registered in the site lookup. Same posture as the
  markers companion: surface the gap in a companion table
  panel for the OT-asset team to backfill, don't silently
  drop unregistered assets from the executive view.
- **`geom geo_us_states featureIdField="stusps" latitude=lat
  longitude=lon`** — Splunk Core's built-in point-in-polygon.
  Same shape as the
  [cim-performance/choropleth §2](../cim-performance/choropleth.md#2-spl-recipe).
  Adds `featureId` (the USPS 2-letter state code) AND
  `state_name` (full state name from the bundled lookup).
- **`where isnotnull(featureId)`** — drop assets whose lat/lon
  falls OUTSIDE the US (multi-region tenants with EMEA/APAC
  plants in the same site lookup). The `us-states.pmtiles`
  preset can't render a foreign plant; the bundled `geom
  geo_us_states` returns NULL `featureId` for non-US
  coordinates, and this `where` filter is the explicit drop
  that makes the panel US-only by construction.
- **`stats sum(is_vulnerable) AS vulnerable_asset_count, count
  AS total_asset_count, values(state_name) AS state_name BY
  featureId`** — final per-state aggregation.
  `vulnerable_asset_count` is the sum of high-CVSS assets;
  `total_asset_count` is the scale denominator;
  `values(state_name)` carries the human-readable name
  through for popup display (single-valued within a state).
- **`eval vulnerable_ratio=round(vulnerable_asset_count /
  total_asset_count, 2)`** — the percent-of-state-fleet-
  vulnerable. Useful for a "20% of Texas's OT fleet has
  high-CVSS exposure vs 3% of California's" comparison view;
  carried as a popup property.
- **`eval value=vulnerable_asset_count`** — explicit copy. The
  choropleth layer reads `value` per the formatter contract.
  This is the **ABSOLUTE-COUNT** view (the executive number).
  For a **RATIO-based view** (which gives smaller-fleet-but-
  more-exposed states more visual prominence), swap to `eval
  value=ceil(vulnerable_ratio * 100)`.
- **`rename featureId AS id`** — adopt Better Map's `id` alias
  contract.
- **`fields ...`** — explicit projection.
- **`sort - value`** — biggest-count states first. The
  choropleth itself is row-order-agnostic; sorting helps when
  the same data feeds a companion "Top 10 states by vulnerable
  OT asset count" table panel.
- **No `head` cap.** Maximum row count is 51 (50 states + DC),
  well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field                    | type    | example     |
|--------------------------|---------|-------------|
| id                       | string  | TX          |
| state_name               | string  | Texas       |
| value                    | integer | 12          |
| vulnerable_asset_count   | integer | 12          |
| total_asset_count        | integer | 47          |
| vulnerable_ratio         | number  | 0.26        |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the choropleth shading; the other four flow
through as feature properties on the joined polygon for popups.

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
  compatible per ROADMAP §1a). Same preset as all eight other
  US-state choropleth / extrusion recipes in the matrix.
- **`enableChoropleth: "true"`** — switches the join layer
  from neutral polygon outline to colour-graded fill driven
  by the `value` SPL column. The SPL MUST produce a `value`
  field for shading; rows with no `value` render with the
  unmatched-grey fallback fill.
- **`palette: "magma"`** — warm-colour-equates-with-attention
  semantics, matching the
  [cim-performance/choropleth](../cim-performance/choropleth.md)
  and [cim-alerts/choropleth](../cim-alerts/choropleth.md)
  companions. This recipe surfaces OT assets with high-severity
  CVEs — every coloured state has a real patching backlog. A
  magma ramp (black-purple-red-yellow as values increase) reads
  intuitively as "darker states need urgent attention". For an
  executive-briefing view where magma red is too alarming, swap
  to `viridis` (the neutral perceptually-uniform default).

For a **RATIO-based view** (percent of state's OT fleet
vulnerable), set the SPL `eval value=vulnerable_asset_count` to
`eval value=ceil(vulnerable_ratio * 100)` and the choropleth
shifts semantics from "absolute vulnerable count" to "percent
of fleet vulnerable" — same formatter config works for both.
Useful when the OT fleet is heterogeneous across states (e.g.,
500 PLCs in Texas vs 30 in Iowa) — the ratio answers "is
Iowa's tiny fleet under MORE exposure pressure than Texas's
large one?".

For a **NERC-CIP-framed view** (where the question is "which
states have BES-cyber-system assets with high-CVSS exposure"
rather than "all OT assets"), add a `where safety_related="N"
OR is_BES_cyber_system="Y"` filter to the SPL after the site
lookup. This requires the `cybervision_sites.csv` lookup be
extended with an `is_BES_cyber_system` column per the NERC CIP
asset-classification contract. Document the customer's BES-
classification decisions in the Built Content Catalog per the
OT-safety Rule 5 contract.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). For
OT recipes specifically, the deferred verification path is to
dispatch against a customer pilot tenant (E4) under a
non-production Cyber Vision sensor rather than a synthetic
generator — the same posture as the
[markers companion §5](./markers.md#5-screenshot). A maintainer
can reproduce by (a) confirming Cyber Vision components are
flowing, (b) seeding the `cybervision_sites.csv` lookup with
≥50 OT assets distributed across ≥5 US states with lat/lon
and safety_related populated, (c) pasting the §2 SPL into a
Dashboard Studio map panel with Better Map as the visualization
and applying the §4 formatter JSON. The choropleth should shade
states proportional to their vulnerable-asset count, with the
manufacturing-belt states (TX, OH, MI, IN, PA) typically darkest
if their OT firmware backlogs are high._

## 6. Gotchas

- **OT safety — passive DPI is the REFERENCE DESIGN (Rule 1).**
  Same posture as the
  [markers companion §6](./markers.md#6-gotchas): Cyber Vision
  is explicitly named in
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 as the reference design for passive OT collection.
  This recipe consumes Cyber Vision's already-passive metadata
  stream — it does NOT itself probe the OT zone. Every
  `vulnerable_asset_count` value is derived from Cisco-validated
  passive DPI.

- **OT safety — every asset row is read-only mirrored from the
  customer SRS (Rule 5).** Same posture as the markers companion:
  the `safety_related` column in `cybervision_sites.csv` is a
  read-only copy of the customer-supplied SIS-asset register,
  NEVER authored by VISTA. If the Safety Annex is missing for
  any `safety_related=Y` row, STOP and get the customer's OT
  engineering team to author the SRS first.

- **OT safety — never disable a Cyber Vision event in the
  pipeline (Rule 2).** The choropleth aggregates vulnerabilities;
  if a customer asks to "hide" certain CVEs from the panel
  (e.g., known-accepted-risk asset classes), do the filtering
  at the PANEL level via SPL (`| where NOT (vendor="Vendor X"
  AND model="Model Y")`), NEVER at the props/transforms layer.
  Record any panel-level vulnerability filtering in the Built
  Content Catalog with OT engineering approval.

- **OT safety — SOAR action scope (Rule 3).** Same posture as
  markers companion: any SOAR playbook triggered by THIS panel
  (e.g., "high-vulnerable-asset state → page on-call patching
  team") must keep its containment actions in the IT zone.
  Notify the OT operator; do NOT auto-issue any firmware push,
  any ACL change, or any patch command to the OT assets
  themselves.

- **`cybervision_sites.csv` MUST be extended with lat/lon.** The
  markers companion documents the canonical schema (asset_id,
  lat, lon, zone_purdue_level, safety_related, site_name); the
  lat/lon columns are OPERATOR-MAINTAINED — Cyber Vision does
  not emit physical coordinates for OT assets (it observes them
  on the network, not in the physical plant). The OT-asset team
  populates lat/lon during the asset-onboarding workflow; this
  recipe degrades gracefully (silent zero-row panel) if the
  lookup lacks lat/lon. Confirm via `| inputlookup
  cybervision_sites.csv | where isnotnull(lat) | stats count`.

- **`geom geo_us_states` requires the bundled geometry lookup.**
  Same caveat as the
  [cim-performance/choropleth §6 Gotchas](../cim-performance/choropleth.md#6-gotchas):
  Splunk Enterprise ships `geo_us_states` by default, but
  minimal Splunk Cloud trials may not. Confirm via
  `| inputlookup geo_us_states | head 1`. If absent, install
  the [`Splunk_TA_geo_us_states`](https://splunkbase.splunk.com/app/2868)
  add-on OR add a `state` column directly to
  `cybervision_sites.csv` (the OT-asset team typically already
  knows which state a plant is in — populating a 2-letter `state`
  field is one column in the same lookup, faster than the
  per-asset lat/lon geocoding workflow).

- **CVSS threshold semantics.** The `>= 7.0` threshold matches
  NIST CVSS v3.x "High" severity. CVSS v2 used a different
  scale; tenants with legacy CVE feeds may have v2 scores in
  the `cvss_score` field that don't align with v3 semantics.
  Confirm with the customer's vulnerability-management team
  which CVSS version Cyber Vision is emitting (typically v3.x
  for assets discovered in the last 2 years; v2 for older
  inherited CVE backlog). If v2 mixed with v3, normalize via
  an `eval cvss_v3=case(cvss_version=="3.0",cvss_score,
  cvss_version=="2.0",cvss_score*1.0,true(),cvss_score)`
  stage before the `is_vulnerable` predicate.

- **State-area bias (MAUP).** Same caveat as all US-state
  choropleths: California, Texas, and Ohio host the largest
  manufacturing footprints by absolute count (auto OEMs,
  energy infrastructure, chemical plants). The choropleth will
  tend to read these three states as darkest regardless of
  per-asset patching cadence — because the absolute vulnerable
  count is correlated with the absolute fleet count. For a
  ratio-based view that normalises out fleet-size bias, swap to
  the RATIO variant (`eval value=ceil(vulnerable_ratio * 100)`
  per §4); Iowa with 80% fleet vulnerable reads darker than
  California with 20% fleet vulnerable, even though the
  absolute counts are reversed.

- **24 h time-range alignment.** Hard-coded `earliest=-24h
  latest=now` for both the components and vulnerabilities
  subsearches. Cyber Vision's vulnerabilities stream re-
  publishes whenever NVD adds a new CVE that matches an
  inventoried asset (typically daily); 24 h is the smallest
  window that catches the most-recent NVD sync. Avoid narrowing
  below 12 h (assets with vulnerabilities re-published earlier
  in the day may drop off the panel). Avoid widening beyond
  7 days (some Cyber Vision installs prune older
  vulnerabilities records and the panel will under-count).

- **PII / GDPR posture.** Same as markers companion: asset
  names embed plant-floor semantics regulated in some
  jurisdictions. Restrict via Splunk RBAC on the `cybervision`
  index for audiences without "see OT asset state distribution"
  authorisation. Per ROADMAP §1a, Better Map never sends event
  data outside `splunkd:8089`.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, mirrors the documented Cyber Vision sourcetype shape from
[`~/.cursor/skills/cisco-products/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/cyber-vision/markers.md)
verbatim through the `dedup` and `join` stages, and uses Splunk
built-ins (`tstats`, `dedup`, `join`, `lookup`, `geom`, `stats`,
`eval`, `where`, `rename`, `fields`, `sort`) plus the operator-
maintained `cybervision_sites.csv` site lookup pattern that
mirrors the
[markers companion §6](./markers.md#6-gotchas) schema. The
panel has not been dispatched against the v1.7-prep lab tenant
because (a) the lab has no Cyber Vision Center and (b) per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, OT-safety-relevant recipes should be
verified against a customer pilot tenant (E4) with real
operator-curated annotations. A maintainer with REST auth to a
tenant carrying `TA-cisco-cybervision` AND a populated
`cybervision_sites.csv` (with lat/lon extended) should:

1. Confirm site lookup is populated:
   `| inputlookup cybervision_sites.csv | where isnotnull(lat)
   | stats count`.
2. Confirm Cyber Vision components are flowing:
   `index=cybervision sourcetype="cisco:cybervision:components"
   earliest=-24h | stats dc(asset_id)`.
3. Confirm `geo_us_states` is on the tenant:
   `| inputlookup geo_us_states | head 1`.
4. Run the recipe SPL and confirm the panel renders one shaded
   state per US state hosting ≥1 high-CVSS asset.
5. Cross-check the `safety_related` column values against the
   customer's Safety Requirements Specification — discrepancies
   must be resolved with OT engineering BEFORE the panel goes
   into a customer dashboard.
6. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "TA-cisco-cybervision"` and a non-PII tenant identifier),
   and submit a follow-up PR.
