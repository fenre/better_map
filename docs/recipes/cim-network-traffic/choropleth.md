---
schema_version: 1
id: cim-network-traffic--choropleth
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic (data model)"
  pattern: splunk-cim
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-18"
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
    example: "847291"
  - name: event_count
    type: integer
    example: "847291"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-event identity)"
    path: "docs/recipes/cim-network-traffic/markers.md"
  - description: "Companion recipe — same source, heatmap layer (smooth density)"
    path: "docs/recipes/cim-network-traffic/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (jurisdictional sum-aggregation)"
    path: "docs/recipes/cim-network-traffic/h3.md"
  - description: "Pattern reference — choropleth with bundled us-states preset"
    path: "docs/recipes/geo-us-states/choropleth.md"
  - description: "CIM Network Traffic data model reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Network Traffic — US states choropleth

The per-state aggregation lens for CIM Network Traffic. Same
`tag=network,communicate` data model as the
[cim-network-traffic/markers](./markers.md),
[heat](./heat.md), and
[h3](./h3.md) companions — but instead of rendering individual
events / smooth density / hex bins, the recipe geocodes each
event's `src` (or `dest`) IP via Splunk's `iplocation`, filters
to US events, and shades the bundled `us-states` vector-tile
preset by per-state event count. The right shape for **executive
"where is my traffic concentrated by jurisdiction" briefings**,
**regional NetOps capacity-planning panels** (which states
generate the most traffic to justify regional PoP placement),
and **compliance-jurisdiction views** (state-by-state event
counts for CCPA / state-AG-investigation reporting).

The CIM Network Traffic source row now has **5 layer cells**
(markers, heat, h3, supercluster, paths from waves 6-12, plus
choropleth now). Choropleth is the FIRST NON-POINT layer cell
on this source (markers / heat / h3 / supercluster are all
point-derived; paths is polyline-derived; choropleth is the
first polygon-derived recipe — the row demonstrates the full
formatter shape diversity).

## 1. Source description

Same **CIM Network Traffic** data model as the markers / heat /
h3 / supercluster / paths companions — see
[cim-network-traffic/markers §1](./markers.md#1-source-description)
for the data model background. The relevant distinction for
THIS recipe: the panel renders per-state event aggregation as a
polygon choropleth (the bundled `us-states` PMTiles preset),
not per-event markers, smooth density, or hex bins.

**Why choropleth for CIM Network Traffic.** A markers panel
shows per-event identity but is bandwidth-limited at high
event volumes and visually noisy. A heatmap shows smooth
density but obscures jurisdictional boundaries (a hot blob
crossing CA / NV doesn't tell you "Nevada specifically").
An H3 hexbin shows hard-bordered jurisdictional sum-aggregation
but the cell boundaries are H3-defined, not political. A
choropleth solves the political-boundary question: every event
inside a state's polygon contributes to that state's tally,
the renderer shades the polygon by the tally, and the result
maps cleanly onto a compliance / regulatory / per-state
business view.

**Typical sourcetype / index:** any sourcetype tagged
`network,communicate` in your CIM tag config — `cisco:asa`,
`pan:traffic`, `aws:cloudwatchlogs:vpcflow`, `cisco:meraki:flow`,
`netflow` (after netflow-sflow-ipfix add-on), etc. See the
[markers companion](./markers.md#1-source-description) for the
broader catalogue. The recipe uses `tag=network` directly so it
inherits whatever CIM-conformant sourcetypes the customer has
onboarded.

**No add-on required beyond Splunk_SA_CIM** for the data model,
and the bundled `us-states.pmtiles` preset for the polygons.
Fully air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
tag=network tag=communicate earliest=-24h latest=now
| iplocation src
| where Country="United States" AND isnotnull(Region)
| stats count AS event_count BY Region
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
| eval value=event_count
| rename Region AS state_name
| fields id, state_name, value, event_count
| sort - value
```

Why this exact shape, line by line:

- **`tag=network tag=communicate`** — directly query the CIM
  Network Traffic data model (`Network_Traffic` accelerated
  data model). Both tags are required by the CIM contract:
  `network` identifies the data type, `communicate` identifies
  the action (data-in-flight, not configuration). Inherits
  whatever CIM-conformant sourcetypes the customer has tagged
  in their CIM tag config — works automatically with `cisco:asa`,
  `pan:traffic`, `aws:cloudwatchlogs:vpcflow`, etc.
- **`earliest=-24h latest=now`** — a 24-hour window for the
  daily / executive briefing. Adjust to `-1h`, `-7d`, `-30d`,
  or bind to a dashboard `$global_time$` token. Larger windows
  produce higher-contrast colour maps (more events differentiating
  the highest-traffic states from the lowest); smaller windows
  show "right now" hotspots.
- **`| iplocation src`** — Splunk's built-in geocoder against
  the source IP. `iplocation` is local (no outbound network
  call), uses Splunk's bundled MaxMind database. The result
  populates `Country` and `Region` (= state name). Use `dest`
  instead of `src` to choropleth the destination side (e.g.
  for a "which states is our traffic GOING TO" panel — typical
  for outbound-traffic analytics).
- **`| where Country="United States" AND isnotnull(Region)`** —
  filter to US events only (the bundled preset is `us-states`,
  not world-countries; non-US events would silently render
  with the unmatched-grey fallback fill). The `isnotnull(Region)`
  guard drops events whose MaxMind lookup resolved to country
  but not state (~5-10% of US public IPs lack state-level
  geocoding due to anonymous proxies / VPN / hosting providers).
  For a global choropleth, swap to a custom `world-countries`
  PMTiles tileset (see §6 Gotchas).
- **`| stats count AS event_count BY Region`** — one row per
  state. `event_count` carries the absolute count for the
  popup; `value` (set in the next eval) is the choropleth
  intensity-driver.
- **`| eval id=upper(case(...))`** — defensive USPS two-letter
  normalisation. The `us-states` PMTiles preset's `promoteId`
  is `stusps` (USPS two-letter, all caps). The `case(...)`
  branches explicitly map the 20 most-populous states + DC;
  the `true(),substr(Region,1,2)` catch-all takes the first
  two characters of any other region name (works for most;
  the explicit enum covers the famous ambiguities — "Mississippi"
  vs "Missouri" vs "Minnesota" all share an "MI" prefix in
  the catch-all but are correctly disambiguated to "MS", "MO",
  "MN" by the explicit branches).
- **`| eval value=event_count`** — alias `event_count` →
  `value`, which is the field name Better Map's `featureJoin`
  module hardcodes as the value-property to shade by. Keeping
  both fields means the popup can show "847,291 events" (from
  `event_count`) while the polygon fill comes from `value`
  (numerically identical but semantically separate).
- **`| rename Region AS state_name`** — Better Map's canonical
  alias (same convention as `lat`/`lon`/`id` for point layers).
  Surfaces in the popup as "California" rather than the
  internal-only `Region`.
- **`| fields id, state_name, value, event_count`** — explicit
  projection. Drops `Country` (filtered to USA), `City`,
  `lat`, `lon` (point-level fields not needed for polygon
  fill), `src` (the IP itself — privacy hygiene). Bound by
  the CIM contract.
- **`| sort - value`** — most-traffic states first (matters
  for the companion "Top 10 states by traffic" table panel;
  the choropleth renderer itself is row-order-agnostic).

Every `|` starts its own physical line per the SPL pipe-per-
line contract.

## 3. Expected fields

| field       | type    | example   |
|-------------|---------|-----------|
| id          | string  | CA        |
| state_name  | string  | California|
| value       | integer | 847291    |
| event_count | integer | 847291    |

All four fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the polygon fill; `event_count` is the popup-
display field. They carry the same numeric value but are kept
semantically separate so a future variant (`value=log10(event_count)`
for log-scale colouring) can change ONE without breaking the
other.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "viridis"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — tells Better Map to
  load the bundled `presets/us-states.pmtiles` tileset and use
  it as the polygon source. No external CDN, no Splunk add-on,
  no outbound network call — fully air-gap compatible per
  ROADMAP §1a.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" (default for joined tilesets) to "value-
  shaded fill". Without this, the polygons render as outlined
  borders only (no fill colour) regardless of `value`.
- **`palette: "viridis"`** — Viridis is the right default for
  quantitative single-direction data ("more is more"). Better
  Map ships several palettes (`viridis`, `magma`, `plasma`,
  `inferno`, `turbo`); Viridis is colour-blind-safe AND prints
  reasonably to black-and-white. For a diverging "above /
  below target" view (e.g. SLO compliance ± target), use a
  diverging palette like `RdBu`.
- **State name flows through automatically.** `state_name` is
  carried as a feature property on the joined polygon — popups
  and tooltips can reference it without further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). Reproduces the panel via the same
`Splunk_SA_CIM` + CIM-tagged sourcetype setup as the
[markers companion](./markers.md#5-screenshot)._

## 6. Gotchas

- **US-only preset is a hard boundary.** The bundled
  `us-states.pmtiles` is the 50 states + DC. It does NOT
  include Puerto Rico, Guam, US Virgin Islands, American
  Samoa, Northern Mariana Islands. Non-US events from
  `iplocation` are filtered out by the `Country="United
  States"` guard — but if you forget that guard, events
  from non-US source IPs will silently disappear from the
  panel without contributing to any rendered polygon. For
  global aggregation, ship a custom `world-countries`
  PMTiles tileset, point `featureJoinUrl` at it, and
  swap the `iplocation` `Region` → `Country` field in
  the SPL.
- **MAUP — Modifiable Areal Unit Problem.** Choropleth
  shades pre-defined polygons by an aggregate value — so
  California always looks dominant because it is geographically
  the largest western state AND has the most public IPs, NOT
  because it necessarily generates the most "per-capita" traffic.
  For an area-neutral density view, use the [H3 hexbin
  companion](./h3.md) with `hexbinResolution: 4-5` (cell
  area is constant across all cells, so a hot cell really
  means "high density per unit area"). For a per-capita
  view, divide `event_count` by a per-state population
  lookup before the choropleth render (out of scope for
  this recipe — would be a `cim-network-traffic/choropleth-
  per-capita.md` variant).
- **`iplocation` accuracy varies by IP type.** Splunk's
  bundled MaxMind database resolves US public IPs to
  state-level with ~80-90% accuracy. Hosting-provider IPs
  (AWS, Azure, GCP, Cloudflare) often resolve to where the
  PROVIDER is headquartered (often CA / WA / VA) regardless
  of which datacenter actually served the request. For
  high-fidelity geolocation, use a commercial IP geolocation
  feed (MaxMind GeoIP2 Enterprise, IP2Location, NetAcuity)
  via a custom lookup that replaces `iplocation`.
- **`src` vs `dest` semantic choice.** Choropleth-ing by
  `src` shows "where is the traffic COMING FROM" (typical
  for inbound-traffic analytics, attack-surface views,
  DDoS-source analysis). Choropleth-ing by `dest` shows
  "where is the traffic GOING TO" (typical for outbound-
  traffic analytics, regional CDN-utilisation views,
  GDPR-jurisdiction destination tracking). The recipe
  defaults to `src` because the most-common executive
  question is "where is our traffic coming from"; document
  the semantic choice in the panel title.
- **District of Columbia is `DC` (not `WA`).** "Washington"
  in `Region` could be either Washington State or Washington,
  D.C. The recipe's `case(...)` explicitly maps "District of
  Columbia" → `DC` so the catch-all `substr(..., 1, 2)`
  doesn't mis-classify it. If your raw data calls it
  "Washington DC" or "D.C.", add another explicit branch.
- **No OT-safety dependency.** CIM Network Traffic events
  are IT-network events (firewalls, proxies, switches, IPS).
  No OT carve-out applies. If the source data contains
  events from SIS-related assets (Level-0/1/2), they would
  be aggregated invisibly into the per-state count — which
  may be a control-plane visibility issue but is not a
  safety-action issue, since Better Map never takes action
  against any asset surfaced through this panel.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6)
and smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. Has NOT been live-tested against a
real CIM-tagged tenant. Verification deferred to wave 21+
pending D5 harness landing — at which point the bundled
`us-states.pmtiles` preset will be confirmed present and the
recipe re-run end-to-end against real CIM-tagged events.
