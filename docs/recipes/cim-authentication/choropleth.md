---
schema_version: 1
id: cim-authentication--choropleth
source:
  id: cim-authentication
  display_name: "CIM Authentication (data model)"
  pattern: splunk-cim
layer:
  id: choropleth
  display_name: Choropleth
status: unverified
last_verified_iso8601: "2026-05-23"
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
    example: "1842"
  - name: failure_count
    type: integer
    example: "1842"
required_formatter_options:
  - featureJoinPreset
  - enableChoropleth
  - palette
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-event identity)"
    path: "docs/recipes/cim-authentication/markers.md"
  - description: "Companion recipe — same source, heatmap layer (smooth density)"
    path: "docs/recipes/cim-authentication/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (jurisdictional sum-aggregation)"
    path: "docs/recipes/cim-authentication/h3.md"
  - description: "Companion recipe — same source, supercluster layer (zoom-adaptive grouping)"
    path: "docs/recipes/cim-authentication/supercluster.md"
  - description: "Companion recipe — same source, paths layer (failed-login sequence)"
    path: "docs/recipes/cim-authentication/paths.md"
  - description: "Companion recipe — same source, extrusion-3d layer (state failure-volume bars)"
    path: "docs/recipes/cim-authentication/extrusion-3d.md"
  - description: "Pattern reference — choropleth with bundled us-states preset (CIM Network Traffic)"
    path: "docs/recipes/cim-network-traffic/choropleth.md"
  - description: "Pattern reference — choropleth with bundled us-states preset (geo-us-states)"
    path: "docs/recipes/geo-us-states/choropleth.md"
  - description: "CIM Authentication data model reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — choropleth"
    path: "docs/reference/layers.md"
  - description: "featureJoin layer (us-states PMTiles preset; promoteId=stusps)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/featureJoin.js"
---

# CIM Authentication — US states choropleth

The per-state aggregation lens for CIM Authentication failures.
Same `tag=authentication action=failure` data-model filter as
the [cim-authentication/markers](./markers.md),
[heat](./heat.md), [h3](./h3.md), and
[extrusion-3d](./extrusion-3d.md) companions — but instead of
rendering individual failed-login events / smooth density /
hex bins / 3D bars, the recipe geocodes each event's `src`
(source IP) via Splunk's `iplocation`, filters to US events,
and shades the bundled `us-states` vector-tile preset by
per-state failed-login count.

The right shape for **"where is our authentication-attack
pressure concentrated by jurisdiction" executive briefings**,
**state-by-state credential-stuffing posture views** (which
states' employees are getting hit hardest by external
brute-force attempts), and **compliance-jurisdiction
reporting** (state-AG breach-notification preparation; many
state laws specifically require per-state failed-login
counts in any breach disclosure).

The CIM Authentication source row now has **6 layer cells**
(markers / heat / h3 / supercluster / paths / extrusion-3d
from waves 6-29, plus choropleth now). Choropleth is the
**second polygon-derived recipe** on this source (alongside
extrusion-3d), and the first "shade-by-value" polygon recipe
— extrusion-3d uses height for the value channel, choropleth
uses colour. Pair the two on a single dashboard for a
"colour + height" dual-encoded jurisdictional view of
authentication failure pressure.

## 1. Source description

Same **CIM Authentication** data model as the markers / heat /
h3 / supercluster / paths / extrusion-3d companions — see
[cim-authentication/markers §1](./markers.md#1-source-description)
for the data model background, the `tag=authentication` contract,
the action sub-filter convention (`success` / `failure` /
`pending`), and the broader catalogue of CIM-conformant
sourcetypes (`bro:ssh`, `linux_secure`, `WinEventLog:Security`,
`okta:*`, `azuread:audit`, etc.).

The relevant distinction for THIS recipe: the panel renders
per-state failed-login aggregation as a polygon choropleth (the
bundled `us-states` PMTiles preset), not per-event markers,
smooth density, hex bins, or 3D height bars.

**Why choropleth for CIM Authentication.** A markers panel shows
per-event identity but is bandwidth-limited at credential-
stuffing attack volumes (10k+ events/min during an active
attack). A heatmap shows smooth density but obscures
jurisdictional boundaries (a hot blob crossing CA / NV doesn't
tell you "Nevada specifically"). An H3 hexbin shows hard-bordered
jurisdictional sum-aggregation but the cell boundaries are
H3-defined, not political. An extrusion-3d shows per-state
3D height bars but at extreme zoom-out the height differences
are hard to read across more than ~10 states. A choropleth
solves the political-boundary question with colour: every
failed-login event inside a state's polygon contributes to
that state's tally, the renderer shades the polygon by the
tally, and the result maps cleanly onto state-AG
breach-notification reporting and per-state security-posture
views.

**Typical sourcetype / index:** any sourcetype tagged
`authentication` in your CIM tag config — `bro:ssh`,
`linux_secure`, `WinEventLog:Security`, `okta:syslog`,
`azuread:signin`, `cisco:ise:syslog`, `duo:authentication`,
etc. See the [markers companion](./markers.md#1-source-description)
for the broader catalogue. The recipe uses `tag=authentication
action=failure` directly so it inherits whatever CIM-conformant
sourcetypes the customer has onboarded.

**No add-on required beyond Splunk_SA_CIM** for the data model,
and the bundled `us-states.pmtiles` preset for the polygons.
Fully air-gap compatible per ROADMAP §1a.

## 2. SPL recipe

```spl
tag=authentication action=failure earliest=-24h latest=now
| iplocation src
| where Country="United States" AND isnotnull(Region)
| stats count AS failure_count BY Region
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
| eval value=failure_count
| rename Region AS state_name
| fields id, state_name, value, failure_count
| sort - value
```

Why this exact shape, line by line:

- **`tag=authentication action=failure`** — directly query the
  CIM Authentication data model (`Authentication` accelerated
  data model). Both predicates are required: `tag=authentication`
  identifies the data type, `action=failure` filters to the
  failed-login subset (drops success and pending). For a
  "total auth volume by state" panel, drop the `action=failure`
  predicate; for a "successful-login-by-state" panel, swap to
  `action=success`. Inherits whatever CIM-conformant
  sourcetypes the customer has tagged.
- **`earliest=-24h latest=now`** — a 24-hour window for the
  daily / executive briefing. Adjust to `-1h` (active-attack
  triage), `-7d` (weekly posture review), or bind to a
  dashboard `$global_time$` token. Smaller windows show
  "right now" attack hotspots; larger windows show baseline
  attacker geographic distribution.
- **`| iplocation src`** — Splunk's built-in geocoder against
  the source IP. `iplocation` is local (no outbound network
  call), uses Splunk's bundled MaxMind database. The result
  populates `Country` and `Region` (= state name). Use `dest`
  instead of `src` ONLY if you want to choropleth the
  destination-side (e.g., "which states' apps are being
  attacked" — useful for distributed multi-region SaaS
  deployments, less useful for centralized on-prem AD).
- **`| where Country="United States" AND isnotnull(Region)`** —
  filter to US events only (the bundled preset is `us-states`,
  not world-countries; non-US events would silently render
  with the unmatched-grey fallback fill). The
  `isnotnull(Region)` guard drops events whose MaxMind lookup
  resolved to country but not state (~5-10% of US public IPs
  lack state-level geocoding due to anonymous proxies / VPNs).
  For a global "attacker country" view, swap to a custom
  `world-countries` PMTiles tileset (see §6 Gotchas).
- **`| stats count AS failure_count BY Region`** — one row per
  state. `failure_count` carries the absolute count for the
  popup; `value` (set in the next eval) is the choropleth
  intensity-driver.
- **`| eval id=upper(case(...))`** — defensive USPS two-letter
  normalisation. The `us-states` PMTiles preset's `promoteId`
  is `stusps` (USPS two-letter, all caps). The `case(...)`
  branches explicitly map the 20 most-populous states + DC;
  the `true(),substr(Region,1,2)` catch-all takes the first
  two characters of any other region name. The explicit enum
  covers the famous ambiguities — "Mississippi" vs "Missouri"
  vs "Minnesota" all share an "MI" prefix in the catch-all but
  are correctly disambiguated to "MS" / "MO" / "MN".
- **`| eval value=failure_count`** — alias `failure_count` →
  `value`, the field name Better Map's `featureJoin` module
  hardcodes as the value-property to shade by. Keeping both
  fields means the popup can show "1,842 failed logins" (from
  `failure_count`) while the polygon fill comes from `value`
  (numerically identical but semantically separate, so a
  future `value=log10(failure_count)` log-scale variant
  changes ONE without breaking the popup).
- **`| rename Region AS state_name`** — Better Map's canonical
  alias (same convention as `lat`/`lon`/`id` for point layers).
  Surfaces in the popup as "California" rather than the
  internal-only `Region`.
- **`| fields id, state_name, value, failure_count`** —
  explicit projection. Drops `Country` (filtered to USA),
  `City`, `lat`, `lon` (point-level fields not needed for
  polygon fill), `src` (the source IP itself — privacy
  hygiene; per-IP detail belongs on the markers / paths
  companions, not the choropleth).
- **`| sort - value`** — most-failures states first (matters
  for the companion "Top 10 states by failed-login count"
  table panel; the choropleth renderer itself is
  row-order-agnostic).

Every `|` starts its own physical line per the SPL pipe-per-line
contract.

## 3. Expected fields

| field         | type    | example     |
|---------------|---------|-------------|
| id            | string  | CA          |
| state_name    | string  | California  |
| value         | integer | 1842        |
| failure_count | integer | 1842        |

All four fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`value` drives the polygon fill; `failure_count` is the
popup-display field. They carry the same numeric value but are
kept semantically separate so a future variant
(`value=log10(failure_count)` for log-scale colouring, or
`value=failure_count/state_population` for per-capita normalisation)
can change ONE without breaking the other.

## 4. Recommended formatter config

```json
{
  "featureJoinPreset": "us-states",
  "enableChoropleth": "true",
  "palette": "magma"
}
```

Why this specific config:

- **`featureJoinPreset: "us-states"`** — tells Better Map to
  load the bundled `presets/us-states.pmtiles` tileset and use
  it as the polygon source. No external CDN, no Splunk add-on,
  no outbound network call — fully air-gap compatible per
  ROADMAP §1a.
- **`enableChoropleth: "true"`** — switches the rendering mode
  from "outline only" (default for joined tilesets) to
  "value-shaded fill". Without this, polygons render as
  outlined borders only (no fill colour) regardless of `value`.
- **`palette: "magma"`** — chosen for SECURITY context
  (different from the CIM Network Traffic choropleth's
  `viridis`). Magma's black → purple → orange → yellow ramp
  reads as "darker = more threat" which aligns with the
  security audience's mental model (whereas Viridis's
  blue → green → yellow ramp can read as "growth / good"
  to a non-security audience). For a multi-panel
  authentication dashboard, pair magma here with red-shifted
  status colours on KPIs and amber on alert panels for a
  cohesive security palette.
- **`state_name` flows through automatically.** `state_name`
  is carried as a feature property on the joined polygon —
  popups and tooltips can reference it without further config.

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
  global attacker-distribution analysis (which is the
  HIGH-VALUE view for authentication-attack telemetry —
  most credential-stuffing campaigns originate from non-US
  IP ranges), ship a custom `world-countries` PMTiles
  tileset, point `featureJoinUrl` at it, and swap the
  `iplocation` `Region` → `Country` field in the SPL.
- **`iplocation` MaxMind accuracy on attacker IPs.** Splunk's
  bundled MaxMind database resolves US public IPs to
  state-level with ~80-90% accuracy. ATTACKER IPs are
  systematically less accurate: VPN / proxy / Tor exit nodes
  resolve to the EXIT NODE'S geographic location (often a
  hosting-provider datacenter, NOT the actual attacker
  location); compromised residential IPs (botnets, "residential
  proxy" services) DO resolve to real states but tell you
  about the COMPROMISED HOSTS, not the attacker. For
  high-fidelity attacker attribution, layer in threat-intel
  enrichment (Cisco Talos, Recorded Future, Mandiant) via a
  custom lookup that supplements `iplocation`.
- **Failed-login != attack.** The recipe shades by raw
  `failure_count`. A state with 1000 legitimate users typing
  the wrong password once = 1000 failures, indistinguishable
  from a state being actively brute-forced. For
  attack-vs-baseline differentiation, layer in a baseline
  comparison: `| stats count AS failure_count BY Region |
  appendcols [search ... failures from -7d-1h to -1h | stats
  avg(count) AS baseline BY Region] | eval
  value=failure_count/baseline` (failure_count as a multiple
  of the baseline; >2x is suspicious).
- **MAUP — Modifiable Areal Unit Problem.** Choropleth shades
  pre-defined polygons by an aggregate value — so California
  always looks dominant because it has the most residents
  AND the most authentication endpoints AND the most
  geographic surface area. For an area-neutral density view,
  use the [H3 hexbin companion](./h3.md) (cell area is
  constant across all cells). For a per-capita view, divide
  `failure_count` by a per-state-population lookup before the
  choropleth render — typically out of scope for this recipe
  unless you have a specific per-capita-failures dashboard
  requirement.
- **District of Columbia is `DC` (not `WA`).** "Washington"
  in `Region` could be either Washington State or Washington,
  D.C. The recipe's `case(...)` explicitly maps "District of
  Columbia" → `DC` so the catch-all `substr(..., 1, 2)`
  doesn't mis-classify it. If your raw data calls it
  "Washington DC" or "D.C.", add another explicit branch.
- **Choropleth + extrusion-3d pairing.** The
  [cim-authentication/extrusion-3d](./extrusion-3d.md)
  companion uses HEIGHT to encode failure count on the
  identical PMTiles preset. For a dual-encoded view (colour
  intensity + 3D height), put both panels side-by-side in a
  Dashboard Studio dashboard. Some operators prefer the
  redundancy (colour redundantly encoded as height is more
  accessible to colour-blind users); others find the
  redundancy busy. The choice is audience-driven.
- **No OT-safety dependency.** CIM Authentication events are
  IT-identity events (AD, IdP, SSH, sudo, RADIUS, SAML, OIDC).
  No OT carve-out applies. If your environment includes
  Level-2 HMI or OT engineering-workstation logins
  (vendor-specific, often outside the CIM Authentication
  scope), those would be aggregated invisibly into the
  per-state count — which may be an OT-asset-visibility issue
  but is not a safety-action issue, since Better Map never
  takes action against any asset surfaced through this panel.

## Verification status

**Status: unverified.** Recipe follows the wave-13 generalised
recipe contract (`schema_version: 1` + frontmatter + §1-§6)
and smoke-tests locally against `build-recipe-index.py` +
`check-recipe-schema.py`. Has NOT been live-tested against a
real CIM-tagged authentication tenant. Verification deferred to
wave 30+ pending D5 harness landing — at which point the
bundled `us-states.pmtiles` preset will be confirmed present
and the recipe re-run end-to-end against real
`tag=authentication action=failure` events from at least one
source type (`bro:ssh`, `linux_secure`, or `WinEventLog:Security`
all serve as reasonable verification targets).
