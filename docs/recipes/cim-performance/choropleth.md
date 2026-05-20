---
schema_version: 1
id: cim-performance--choropleth
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-25"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
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
    example: "47"
  - name: signal_host_count
    type: integer
    example: "47"
  - name: total_host_count
    type: integer
    example: "212"
  - name: signal_ratio
    type: number
    example: "0.22"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-host drilldown)"
    path: "docs/recipes/cim-performance/markers.md"
  - description: "Companion recipe — same source, h3 / heat / supercluster / paths layers"
    path: "docs/recipes/cim-performance/h3.md"
  - description: "Pattern reference — choropleth on CIM Network Traffic (sibling state-aggregation recipe)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Pattern reference — choropleth on CIM Authentication (sibling state-aggregation recipe)"
    path: "docs/recipes/cim-authentication/choropleth.md"
  - description: "Pattern reference — choropleth on CIM Alerts (sibling state-aggregation recipe)"
    path: "docs/recipes/cim-alerts/choropleth.md"
  - description: "splunk-cim skill — Performance data model schema, dataset tags, dest/cpu/memory contracts"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "splunk-datamodels-conf skill — CIM acceleration and tstats summariesonly tradeoffs"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — enableChoropleth, featureJoinPreset, palette"
    path: "docs/_machine/formatter-schema.json"
---

# CIM Performance — US states choropleth

Aggregate the monitored-host fleet by US state (via the host's
datacenter latitude/longitude in the ES Asset & Identity asset
lookup) and render as a **flat-fill choropleth** over the
bundled `us-states.pmtiles` preset. Per-state colour saturation
encodes the **count of hosts currently breaching at least one
performance threshold** (CPU > 80%, Memory > 80%, Storage > 85%
— the same thresholds the [cim-performance/markers](./markers.md)
recipe uses). The right shape for **executive infrastructure-
health briefings** and **multi-region capacity reviews** where
the question is "which US states host our most pressured
infrastructure" — not "which individual hosts are in trouble"
(use [markers](./markers.md) for that), not "where is fleet
density highest" (use [h3](./h3.md) for that), and not "how
much aggregate pressure is distributed across the geography"
(use [heat](./heat.md) for that).

The **6th choropleth recipe in the matrix** — joining
[geo-us-states](../geo-us-states/choropleth.md),
[cim-network-traffic](../cim-network-traffic/choropleth.md),
[thousandeyes](../thousandeyes/choropleth.md),
[cim-authentication](../cim-authentication/choropleth.md), and
[cim-alerts](../cim-alerts/choropleth.md). This advances the
choropleth layer column from 5 cells to 6, and brings the
cim-performance source row from 5 cells to 6 (markers, h3,
heat, supercluster, paths, plus choropleth now). The recipe
is the canonical demo for "you can summarise infrastructure
fleet health geographically at the executive level, not just
per-host", which is the operational layer that's been missing
from the cim-performance source coverage.

## 1. Source description

Same **CIM Performance** data model as the
[markers](./markers.md), [h3](./h3.md), [heat](./heat.md),
[supercluster](./supercluster.md), and [paths](./paths.md)
companions — see
[cim-performance/markers §1](./markers.md#1-source-description)
for the full data model background, the six datasets (CPU,
Memory, Storage, Network, Facilities, Uptime), and the
acceleration / `tstats summariesonly=true` contract.

The relevant distinction for THIS recipe: instead of one marker
per breaching host (markers companion) or one hex per regional
density bucket (h3 companion), the panel aggregates **per US
state**. Per-host pressure detection (the three-threshold
logic from markers) is computed first, then breaching hosts are
joined against an asset inventory lookup to get lat/long, then
`iplocation` derives the US state from the lookup-derived lat/
long pair (via a workaround — see §6 Gotchas for why we don't
just use `geom` directly), and finally aggregated per state.

**Why choropleth for CIM Performance.** A markers panel shows
WHICH hosts are in trouble; a heat panel shows aggregate
pressure as a smooth gradient. But neither answers the
**executive-distribution question**: "across the 50 US states,
which ones host the most pressured infrastructure?" A
choropleth solves this in one panel: states with ≥1 breaching
host get coloured, states with zero are blank (or rendered in
the neutral fallback fill). This is the right shape for
**CIO infrastructure-budget reviews** ("which regions need
the next capacity investment?"), **executive incident
summaries** ("the outage was concentrated in our Virginia
datacenter — visible as the darkest state on the panel"), and
**regional account-planning views** (per-state breaching-host
count is the proxy for "where is our infrastructure most
pressured by service demand").

**Why use the asset-lookup-derived lat/long rather than
direct geometry lookup.** The `geom geo_us_states` command
takes a `latitude` / `longitude` pair and returns the state
polygon containing it — that's the most direct path. BUT it
requires the `Splunk_TA_geo_us_states` add-on (a 100MB+
add-on that's not typically pre-installed on Splunk Cloud
tenants without explicit request). The
[cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
and [meraki/extrusion-3d](../meraki/extrusion-3d.md)
companions use `iplocation` instead, which gives `Country` +
`Region` (state name) directly from the IP — that's the
zero-add-on path. THIS recipe is in a bind: the `dest` field
in CIM Performance is a hostname, NOT an IP, so `iplocation
dest` would not work. The workaround is to chain via the asset
lookup: get lat/long FROM the asset lookup, then use Splunk's
`geom` point-in-polygon command (which IS bundled with the
core platform for `geom_us_states` — confirm via
`| inputlookup geo_us_states | head 1` on your tenant) to
derive the state from the lat/long. See §6 Gotchas for the
alternative paths if `geom_us_states` is not present on your
install.

**Typical sourcetype / index:** Same broad catalogue as the
[markers companion](./markers.md#1-source-description) —
`nix:cpu`, `Perfmon:CPU`, `cisco:dnac:device`,
`cloudwatch:host`, `azure:monitor:metric`,
`vmware:vsphere:host:performance`, etc. The TA app context
required is `Splunk_SA_CIM`. The asset lookup is
operator-maintained.

## 2. SPL recipe

```spl
| tstats summariesonly=true latest(Performance.cpu_load_percent) AS cpu_load_percent FROM datamodel=Performance.CPU WHERE earliest=-15m latest=now BY Performance.dest
| rename Performance.dest AS dest
| append [
    | tstats summariesonly=true latest(Performance.mem_used_percent) AS mem_used_percent FROM datamodel=Performance.Memory WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| append [
    | tstats summariesonly=true latest(Performance.storage_used_percent) AS storage_used_percent FROM datamodel=Performance.Storage WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| stats latest(cpu_load_percent) AS cpu_load_percent, latest(mem_used_percent) AS mem_used_percent, latest(storage_used_percent) AS storage_used_percent BY dest
| eval cpu_signal=if(cpu_load_percent>80, 1, 0)
| eval mem_signal=if(mem_used_percent>80, 1, 0)
| eval storage_signal=if(storage_used_percent>85, 1, 0)
| eval signal_count=cpu_signal+mem_signal+storage_signal
| eval is_signalling=if(signal_count >= 1, 1, 0)
| lookup asset_lookup_by_str src AS dest OUTPUT lat AS lat, long AS lon
| where isnotnull(lat) AND isnotnull(lon)
| geom geo_us_states featureIdField="stusps" latitude=lat longitude=lon
| where isnotnull(featureId)
| stats sum(is_signalling) AS signal_host_count,
    count AS total_host_count,
    values(state_name) AS state_name
  BY featureId
| eval signal_ratio=round(signal_host_count / total_host_count, 2)
| eval value=signal_host_count
| rename featureId AS id
| fields id, state_name, value, signal_host_count, total_host_count, signal_ratio
| sort - value
```

Why this exact shape, line by line:

- **Three `tstats summariesonly=true` against
  `datamodel=Performance.CPU` / `.Memory` / `.Storage`** —
  same triple-tstats pattern as the
  [markers companion §2](./markers.md#2-spl-recipe). Each pulls
  the freshest sample per host via `latest()`; the 15 min
  window covers ≥3 acceleration spans. `summariesonly=true`
  REQUIRES acceleration; see the markers companion §6 Gotchas
  for the fallback.
- **`rename Performance.dest AS dest`** — same per-subsearch
  rename pattern.
- **`append`** + the outer **`stats latest(...) BY dest`** —
  same multi-dataset merge pattern as markers. Avoids `join`
  per SPL quality rules.
- **Three `eval *_signal=if(...>threshold, 1, 0)`** + **`eval
  signal_count=...`** + **`eval is_signalling=if(signal_count
  >= 1, 1, 0)`** — binary breach detection per host, then a
  binary "is this host breaching at all" rollup. The
  is_signalling flag is what gets SUM'd per state (the
  numerator). Total host count comes from the `count` in the
  next stats (the denominator).
- **Key difference from markers companion: NO `where
  signal_count >= 1` filter.** The markers recipe drops
  healthy hosts before the lookup (only the unhealthy ones
  get rendered). THIS recipe needs the healthy hosts too,
  because the per-state denominator (total host count) is the
  scale reference for the signal ratio. Filtering happens at
  the choropleth layer via the `value` field instead.
- **`lookup asset_lookup_by_str src AS dest OUTPUT lat AS lat,
  long AS lon`** — same ES A&I asset lookup as the markers
  companion. See the markers companion §6 Gotchas for the
  three substitution patterns (ITSI entity, DNS/CMDB CSV,
  geocode-by-DNS) for non-ES tenants.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop hosts
  with no geographic attribution.
- **`geom geo_us_states featureIdField="stusps" latitude=lat
  longitude=lon`** — Splunk's built-in point-in-polygon
  command. Takes the lat/long pair, finds the US state
  polygon containing it, and adds the `featureId` field
  (set to the `stusps` two-letter USPS code per the
  `featureIdField` argument) AND a `state_name` field
  (the full state name from the bundled `geo_us_states`
  lookup table). See §6 Gotchas if `geo_us_states` is not on
  your tenant.
- **`where isnotnull(featureId)`** — drop hosts whose lat/long
  falls OUTSIDE the US (e.g., a customer with EMEA / APAC
  datacenters in the same asset lookup) or in a region
  `geo_us_states` doesn't cover (Puerto Rico, territories).
  For multi-region tenants, this is the US-only filter that
  makes the bundled `us-states.pmtiles` preset the right
  choice.
- **`stats sum(is_signalling) AS signal_host_count, count AS
  total_host_count, values(state_name) AS state_name BY
  featureId`** — final per-state aggregation. `signal_host_count`
  is the sum of breaching hosts; `total_host_count` is the
  scale denominator; `values(state_name)` carries the human-
  readable name through for popup display (it's a single-
  valued field within a state, but `values()` lets stats
  emit it).
- **`eval signal_ratio=round(signal_host_count /
  total_host_count, 2)`** — the percent-of-fleet-breaching
  per state. Useful for a "20% of California's fleet is
  breaching, vs 3% of Texas's" comparison view; carried as a
  popup property.
- **`eval value=signal_host_count`** — explicit copy. The
  choropleth layer reads `value` per the formatter contract.
  This is the BREACHING-COUNT view — a state with 50 total
  hosts and 25 breaching shows a darker fill than a state
  with 5000 total hosts and 100 breaching, EVEN THOUGH the
  ratio is 50% vs 2%. For a RATIO-based view (which gives the
  smaller-fleet-but-more-stressed states more visual
  prominence), swap `value=signal_host_count` for `value=ceil
  (signal_ratio * 100)`. The choropleth still shades; the
  underlying semantic shifts from "absolute breaching count"
  to "percent of fleet breaching".
- **`rename featureId AS id`** — adopt Better Map's `id`
  alias contract.
- **`fields ...`** — explicit projection.
- **`sort - value`** — biggest-breach-count states first. The
  choropleth itself is row-order-agnostic; sorting helps when
  the same data feeds a companion "Top 10 states by breaching
  host count" table panel.
- **No `head` cap.** Maximum row count is 51 (50 states + DC),
  well under any render budget.

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field             | type    | example     |
|-------------------|---------|-------------|
| id                | string  | CA          |
| state_name        | string  | California  |
| value             | integer | 47          |
| signal_host_count | integer | 47          |
| total_host_count  | integer | 212         |
| signal_ratio      | number  | 0.22        |

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
  compatible per ROADMAP §1a). Same preset as all
  US-state choropleth / extrusion recipes.
- **`enableChoropleth: "true"`** — switches the join layer from
  neutral polygon outline to colour-graded fill. The SPL MUST
  produce a `value` field; rows with no `value` render with
  the unmatched-grey fallback fill.
- **`palette: "magma"`** — warm-colour-equates-with-attention
  semantics. The recipe surfaces hosts in trouble, so a magma
  ramp (black-purple-red-yellow as values increase) reads
  intuitively as "darker states need attention". This diverges
  from the `viridis` default of the
  [cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
  and [thousandeyes/choropleth](../thousandeyes/choropleth.md)
  companions — both of which surface neutral metrics (event
  count, agent count) where `viridis`'s perceptually-uniform
  ramp is the better default. CIM Performance is intrinsically
  alerting-framed (every breaching host is a problem), so
  `magma` is the recommended swap. For an executive-briefing
  view where the magma red is too alarming, swap back to
  `viridis`.

For a **RATIO-based view** (percent of fleet breaching per
state), set the SPL `eval value=signal_host_count` to `eval
value=ceil(signal_ratio * 100)` and the choropleth shifts
semantics from "absolute breaching count" to "percent of
fleet breaching" — same formatter config works for both.

For an **extrusion + choropleth double-encoded view** (3D
height = breach count, colour = breach count), enable
`enable3DExtrusion: true` + `extrusionHeightField: "value"`
+ `extrusionScale: 20000.0` (tunable to fleet size). Same
recipe-level tweak as the
[cim-network-traffic/extrusion-3d](../cim-network-traffic/extrusion-3d.md)
companion.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). A
maintainer can reproduce by (a) confirming CIM Performance is
accelerated (`Settings → Data Models → Performance → Edit →
Acceleration`), (b) seeding the `asset_lookup_by_str` ES A&I
lookup with at least 50 hosts distributed across ≥5 US states
with lat/long populated, (c) pasting the SPL above into a
Dashboard Studio map panel with Better Map as the
visualization, and applying the §4 formatter JSON. The
choropleth should shade states proportional to their
breaching-host count, with the largest hosting states (CA, VA,
TX, NY, WA) typically darkest if their fleets are pressured._

## 6. Gotchas

- **Acceleration is mandatory for `summariesonly=true`.** Same
  caveat as the [markers companion §6](./markers.md#6-gotchas):
  if CIM Performance is not accelerated, the SPL returns zero
  rows. Enable acceleration (5 min span, 6-week retention) OR
  drop `summariesonly=true` and pay the raw-event query cost.

- **`asset_lookup_by_str` is the ES A&I asset lookup — requires
  ES.** Same caveat and three substitution patterns as the
  [markers companion §6](./markers.md#6-gotchas): ITSI entity
  collection, DNS/CMDB CSV lookup, or geocode-by-DNS for
  tenants without ES.

- **`geom geo_us_states` requires the `geo_us_states` bundled
  geometry lookup — which ships with Splunk Enterprise but may
  not be present on minimal Splunk Cloud trials.** Confirm via:
  ```spl
  | inputlookup geo_us_states | head 1
  ```
  If absent, three substitution paths:
  1. Install the
     [Splunk_TA_geo_us_states](https://splunkbase.splunk.com/app/2868)
     add-on (the most-direct fix; bundles the `geo_us_states`
     KML / KMZ).
  2. Use the `iplocation` workaround: forward-resolve the
     hostname via `| dnsLookup hostname=dest` (requires the
     `dnsLookup` TA), then `| iplocation dest_ip` to get
     `Region`, then map Region → USPS code as the
     [cim-network-traffic/choropleth](../cim-network-traffic/choropleth.md)
     and [thousandeyes/choropleth](../thousandeyes/choropleth.md)
     recipes do.
  3. Add a `state` column to the asset lookup directly (the
     ES A&I `asset_lookup_by_str` SUPPORTS a `state` field;
     check via `| inputlookup asset_lookup_by_str | fields
     state | head 1`). If populated, skip the `geom` step and
     read `state` straight from the lookup output.

- **State mismatch between Splunk and PMTiles tilesets.** The
  bundled `geo_us_states` lookup uses USPS 2-letter codes
  (`stusps` field, "CA" / "TX" / "NY"). The bundled
  `us-states.pmtiles` preset's `promoteId` is ALSO `stusps`
  (this is no accident — both were chosen for consistency).
  If you swap to a custom PMTiles preset whose `promoteId` is
  a different field (e.g., `state_name`, `iso_3166_2`),
  ALSO update the `geom featureIdField=...` argument to match,
  OR add a `case()` mapping AFTER `geom`. The recipe's default
  works only because both ends agree on `stusps`.

- **MAUP — state-area bias.** Same caveat as all US-state
  choropleths: California hosts the largest tech fleets (AWS
  US-West, GCP us-west, multiple Azure regions), Virginia
  hosts AWS US-East and government cloud, Texas hosts a
  growing share of cloud + on-prem fleets. The choropleth
  will tend to read these three states as the darkest
  regardless of per-host pressure — because the absolute
  breach count is correlated with absolute fleet count. For
  a ratio-based view that normalises out fleet-size bias,
  swap to the RATIO variant (`eval value=ceil(signal_ratio *
  100)` per §4); Texas with 80% fleet breach reads darker
  than California with 20% fleet breach, even though the
  absolute counts are reversed.

- **`asset_lookup_by_str` cardinality mismatch.** The ES A&I
  asset lookup is keyed on the `src` column with `dest` as
  the join input. Real lookups often have `src` populated as
  IP addresses (not hostnames), where the CIM Performance
  `dest` field is a hostname. If the lookup join silently
  returns zero matches, the panel renders empty. Confirm:
  ```spl
  | inputlookup asset_lookup_by_str
  | where like(src, "%web-prod-01%")
  | head 5
  ```
  If the lookup is IP-keyed, prefix the recipe SPL with a
  `| dnsLookup hostname=dest` to resolve hostname → IP before
  the lookup.

- **No OT-safety dependency.** Same caveat as the
  [markers companion §6](./markers.md#6-gotchas): pure IT
  infrastructure performance. If the CIM Performance model
  also ingests OT-zone equipment (PLC CPU, HMI memory),
  filter those hosts OUT here (`NOT dest IN ("plc-*",
  "hmi-*", "rtu-*")`) and put them in a SEPARATE recipe
  with `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6. A CPU-bound PLC needs a fundamentally different
  operator response than a CPU-bound web server, and the
  two should not visually compete on the same map.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented CIM Performance schema and
`tstats` contract from
[`~/.cursor/skills/splunk-cim/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/cim-performance/markers.md),
and uses Splunk built-ins (`tstats`, `geom`, `iplocation`,
`stats`, `eval`, `where`, `lookup`, `rename`, `fields`,
`sort`). The PMTiles fetch + choropleth fill behaviour is
covered by Better Map's own `featureJoin` module unit tests.
The end-to-end "this recipe's CIM Performance SPL + an
ES A&I lookup with lat/long + the bundled `geo_us_states`
geometry lookup + the bundled `us-states.pmtiles` preset
renders a per-state choropleth in a Splunk Dashboard Studio
panel" path has not been dispatched against the v1.7-prep lab
tenant in this PR because the lab tenant does not carry a
populated `asset_lookup_by_str` with lat/long for ≥50 hosts.
A maintainer with REST auth and a populated asset lookup
should follow the verification steps in the
[markers companion §Verification status](./markers.md#verification-status)
(substituting this recipe's §2 per-state aggregation SPL for
the markers companion's per-host SPL), then promote to
`status: verified` + fill in `verified_against` in a follow-up
PR.
