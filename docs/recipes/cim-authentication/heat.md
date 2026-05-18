---
schema_version: 1
id: cim-authentication--heat
source:
  id: cim-authentication
  display_name: "CIM Authentication"
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
    example: "203.0.113.45"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "52.3676"
  - name: lon
    type: number
    example: "4.9041"
  - name: src_country
    type: string
    example: "NL"
  - name: failure_count
    type: integer
    example: "417"
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
    path: "docs/recipes/cim-authentication/markers.md"
  - description: "Splunk CIM skill — Authentication data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — risk-based alerting context for credential abuse"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# CIM Authentication — heatmap

The aggregate-density complement to the
[cim-authentication/markers](./markers.md) recipe — same
CIM-accelerated `Authentication` data model, same `iplocation`
geocoding of failed-login source IPs, but rendered as a weighted
heatmap rather than discrete markers. The heat layer surfaces
**failed-authentication attack PRESSURE** as colour intensity:
hot blobs indicate regions / cities producing the most failed
attempts; cool blobs indicate quiet regions. This is the
natural shape when the dashboard question is "which parts of
the world are hitting my identity surface hardest right now?"
rather than "which individual source IPs should I investigate?".

## 1. Source description

Same Splunk **Authentication** Common Information Model (CIM)
data model as the companion [markers](./markers.md) recipe —
vendor-agnostic because the data model normalises Active
Directory, Entra ID / M365, Okta, AWS CloudTrail, Cisco Duo,
Cisco ISE, Linux PAM, Workday, Salesforce, GitHub Enterprise,
and every other authentication source tagged
`tag=authentication`.

**Why heatmap for CIM Authentication.** A markers view at world
zoom collapses dense regional clusters (Eastern European
residential proxies, AWS `us-east-1` cloud egress, large
mobile-carrier NATs) into overlapping circles that bury the
"which region is hottest" signal under visual clutter. A
heatmap aggregates the failure-count weight into smooth
Gaussian blobs that read as "pressure" — the layer for
**SOC leadership dashboards** and **executive briefings**
on identity attack volume, NOT for per-IP investigation
(use markers for that).

**Typical sourcetype / index:** anything tagged
`authentication` (check `| tstats values(sourcetype) WHERE
\`cim_Authentication_indexes\` tag=authentication`); typical
index is `authentication`, `wineventlog`, `okta`, `o365`, or
the vendor-specific index. This recipe queries the data-model
accelerated summary, so the source index does not appear in
the SPL.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS failure_count FROM datamodel=Authentication WHERE Authentication.action="failure" earliest=-24h latest=now BY Authentication.src
| rename Authentication.src AS src
| where match(src, "^\d+\.\d+\.\d+\.\d+$")
| iplocation src
| where isnotnull(lat) AND isnotnull(lon)
| where failure_count >= 5
| eventstats max(failure_count) AS max_failure_count
| eval weight=round(failure_count / max_failure_count, 2)
| rename src AS id, Country AS src_country
| fields id, lat, lon, src_country, failure_count, weight
| sort - failure_count
| head 5000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true count AS failure_count FROM
  datamodel=Authentication`** — reads the CIM-accelerated
  data model summary, NOT raw events. Single aggregate (the
  failure count per source IP) is all the heat layer needs;
  the markers recipe additionally pulls `distinct_users` for
  the password-spray vs brute-force distinction, but the
  heatmap collapses individual source IPs into pixel-density
  blobs so the per-source distinction is lost anyway. Keeping
  the SPL lean saves search-head CPU.
- **`WHERE Authentication.action="failure"`** — filter at the
  data-model layer. Change to `"success"` to flip the panel
  to a "where, geographically, are most of my successful
  logins coming from?" posture-monitoring view — useful for
  spotting a sudden geographic shift (e.g. "why are 30 %
  of our logins suddenly coming from Brazil this week?").
- **`BY Authentication.src`** — one row per unique source IP.
  The heat blob density per blob then depends on how many
  failures EACH source IP contributes — i.e. one hot blob
  in Amsterdam might be ONE source IP with 10000 failures,
  or 100 source IPs with 100 failures each. The popup will
  not disambiguate this — that's the markers recipe's job.
- **`| where match(src, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4-only
  filter. Drop or relax for IPv6-heavy environments.
- **`| iplocation src`** — Splunk's built-in MaxMind GeoLite2
  geocoder. No outbound network call. RFC-1918 sources get
  null lat / lon; the next line drops them.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — critical
  for THIS recipe because RDP-from-inside-the-LAN failures
  (legitimate ops staff fat-fingering passwords) would
  otherwise pile up at Null Island and visually dominate
  the heatmap.
- **`| where failure_count >= 5`** — signal-to-noise filter,
  same as the markers recipe. Tune to your tenant's baseline
  failure noise floor.
- **`| eventstats max(failure_count) AS max_failure_count`**
  — adds the global maximum as a column on every row, so the
  next `eval` can normalise. `eventstats` (not `stats`) is
  the right command here because it KEEPS the per-source-IP
  rows and only ADDS the new column.
- **`| eval weight=round(failure_count / max_failure_count,
  2)`** — normalise to a `[0, 1]` band so the heat layer's
  weight property has a predictable scale across panels.
  Rounded to 2 decimal places for stable rendering and clean
  popup formatting. See §6 Gotchas for the log-scale
  alternative when failure counts span orders of magnitude.
- **`| rename src AS id, Country AS src_country`** — adopt
  Better Map's canonical `id` alias. `src_country` flows
  through as a feature property (useful for a "filter heatmap
  to one country" dashboard input).
- **`| head 5000`** — render budget. The heat layer scales
  to thousands of points cleanly. 5000 covers a busy enterprise
  identity surface (most tenants see < 1000 unique source IPs
  per 24 h above the `failure_count >= 5` threshold).

## 3. Expected fields

| field         | type    | example     |
|---------------|---------|-------------|
| id            | string  | 203.0.113.45 |
| lat           | number  | 52.3676     |
| lon           | number  | 4.9041      |
| src_country   | string  | NL          |
| failure_count | integer | 417         |
| weight        | number  | 0.84        |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`src_country` is carried through for filter / drilldown but is
not strictly required by the heat layer.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 24
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer only switches to
  heatmap above ~200 features, so for quieter tenants the
  recipe needs an explicit pin to force the heat rendering
  even when the source-IP count drops (off-hours, weekends,
  post-incident lull).
- **`heatmapOpacity: 0.75`** — sweet spot from the
  formatter-schema (range 0.0-1.0). At 1.0 the heat blobs
  fully occlude the underlying basemap labels; at 0.5 the
  heat is too washed out to read at low zoom. 0.75 lets the
  SOC analyst read both the heat colour ramp AND the
  city / country labels underneath at globe zoom — critical
  for "is that Moscow or Saint Petersburg pressure?" at-a-
  glance reading.
- **`heatmapRadius: 24`** — pixel radius at low zoom. The
  formatter-schema documents the range as 2-64 px. 24 px is
  appropriate for a "world attack surface" view where blobs
  from neighbouring source IPs SHOULD merge at world zoom
  (giving a regional pressure read), and resolve to per-IP
  blobs at country / city zoom. A radius of 8 (the schema
  placeholder) is sharper but produces isolated dots at
  world zoom that read as markers rather than heat —
  defeating the layer's purpose. For a single-region or
  single-city view (e.g. "show me identity attack pressure
  inside Western Europe only"), drop to 12-16.
- **`weight` drives heat intensity automatically.** The heat
  layer renderer auto-picks the `weight` field by name (per
  Better Map's `dataFitness.js` field aliasing). If you
  rename `weight` in the SPL, also set the formatter's
  `heatField` option (or whichever name the formatter
  schema uses — check
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce the panel by
pasting the SPL above into a Dashboard Studio map panel with
Better Map as the visualization, applying the formatter JSON
in §4, and varying the time range to confirm the heatmap
shifts with attack pressure (e.g. compare a quiet weekend
window vs the Monday-morning password-reset spike — the
heatmap should brighten markedly in residential proxy regions
between the two)._

## 6. Gotchas

- **CIM data-model acceleration MUST be enabled** on the
  `Authentication` data model for `summariesonly=true` to
  return anything. Confirm in Settings → Data models →
  Authentication → Acceleration. If accel is OFF, the
  dashboard panel returns ZERO results (the correct, fail-
  safe behaviour). If you cannot enable acceleration in
  your tenant, change the recipe to `summariesonly=false`
  (much slower; not recommended for any panel that auto-
  refreshes).
- **`weight` normalisation gotcha.** The normalisation uses
  the SINGLE max across the panel window. If one attacker
  IP is 10000× louder than the rest (e.g. a botnet C2
  hammering one user's account), every other source IP's
  `weight` rounds to 0.00 and the heat layer renders them
  as invisible. For multi-source heatmaps where the
  failure-count distribution spans orders of magnitude,
  replace the `eval weight=...` with
  `eval weight=round(log10(failure_count) /
  log10(max_failure_count), 2)` (log-scale normalisation),
  or drop the heaviest 1 % with a
  `where failure_count < percentile99(failure_count)`
  prefilter — but only AFTER opening a P1 against the
  loudest source IP (a 10000× outlier is news, not noise).
- **Heatmap vs markers — when to choose which.** Heatmap is
  the right layer for "show me the attack pressure"
  questions (SOC leadership, executive briefing, threat-
  briefing dashboards). Markers (per
  [cim-authentication/markers](./markers.md)) are the right
  layer for "show me each attacker individually" questions
  (SOC analyst investigation, IR triage). Both can coexist
  in the same dashboard with the same data — the heat layer
  goes underneath (rendered first in the panel), markers
  go on top (rendered second), and the operator gets BOTH
  the pressure surface AND the per-IP drilldown affordance.
  Use Better Map's BM-CT-1 layer contract
  (`setEnabled` / `isEnabled` / `reset`) to toggle each
  layer independently from a dashboard input.
- **Heatmap is NOT good for "show me each event".** Every
  failure from a single source IP collapses to a single
  feature (one row in the panel). If the dashboard question
  is "show me each individual failed login on the map," use
  a marker layer over the raw event stream (not over the
  per-source-IP stats). The heat layer is fundamentally a
  per-feature-density renderer — pre-aggregate to one row
  per heat blob you want rendered.
- **`tag=authentication` membership.** If your IdP / VPN
  events are NOT being tagged for the data model (a common
  Splunk Cloud finding — bring-your-own-app pipelines often
  skip `eventtypes.conf` and `tags.conf`), they will be
  invisible to this recipe. Check `| tstats count WHERE
  \`cim_Authentication_indexes\` tag=authentication BY
  sourcetype`. Any sourcetype you EXPECT to see that does
  NOT appear is a CIM-compliance gap, NOT a Better Map bug
  — fix the TA / `eventtypes.conf` and re-run.
- **`failure_count >= 5` threshold is workload-dependent.**
  Same advice as the markers recipe: tune so the heat ramp
  is dominated by ATTACKERS, not by Monday-morning Active-
  Directory password-reset traffic. A 500-employee company
  sees ~50 legitimate "wrong password" failures a day; a
  50,000-employee company sees ~5,000. For more
  sophisticated noise-filtering, see the RBA skill (
  [`~/.cursor/skills/splunk-rba/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-rba.mdc)
  ).
- **MaxMind database licensing.** Splunk Enterprise ships
  with the free MaxMind GeoLite2 database. For higher
  accuracy / commercial use, swap in MaxMind GeoIP2 via the
  Splunk admin UI. The recipe is unchanged — `iplocation`
  reads whichever database is configured.
- **Time range.** The recipe hard-codes `earliest=-24h
  latest=now` so it works in a panel without a dashboard
  time picker. Replace with `earliest=$earliest$
  latest=$latest$` once you wire the recipe into a
  dashboard with a time-range input. For executive briefings,
  `earliest=-7d` over a 7-day window is more common and
  smooths over the weekend-quiet effect.
- **VPN / proxy egress IPs distort the picture.** Same as
  the markers recipe — a heavy enterprise VPN concentrator
  emits failures from a single publish IP, and one such IP
  inside a heat blob can make legitimate ops traffic look
  like an attack centre. Add `NOT src IN ("198.51.100.0/24")`
  or join against a known-good corporate IP allow-list
  before rendering. The RBA framework's `corporate_ip`
  lookup is the standard pattern.
- **PII / GDPR posture.** Per ROADMAP §1a (binding), Better
  Map NEVER sends event data outside `splunkd:8089`.
  `iplocation` runs server-side against the local MaxMind
  database — no outbound geocoding API call. `src` IPs are
  pseudonymous; do NOT join against `identities.csv` (the
  ES Asset & Identity framework lookup) in this recipe —
  the username column would land in a public-facing
  dashboard and surface PII. The heat layer is BROADER than
  the markers layer (one blob covers an entire region's
  worth of source IPs), so this layer is generally LOWER-
  risk for privacy-sensitive deployments — but the same
  identifiability rules apply.
- **No OT safety dependency.** This recipe is pure IT
  identity-and-access. If your tenant ALSO logs OT operator
  console logins (RSLogix, FactoryTalk View, Wonderware
  InTouch, Siemens TIA Portal) under the `Authentication`
  data model, filter THOSE sourcetypes out of THIS panel
  (`NOT sourcetype IN ("rslogix:audit", "factorytalk:*")`)
  and put them in a DEDICATED recipe with explicit OT-
  safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — a failed login to an HMI on a SIS bypass is a
  safety-relevant signal, NOT an IT credential-abuse signal,
  and rendering it as a low-priority "heat blob in
  Switzerland" alongside botnet pressure from Eastern
  Europe is exactly the kind of categorisation error Rule 6
  is designed to prevent.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented Splunk CIM
Authentication contract plus the canonical
`eventstats max + eval normalise` heat-weight pattern, and
uses only shipping Splunk built-ins (`tstats`, `iplocation`,
`eventstats`, `Splunk_SA_CIM`). It has not been dispatched
against the v1.7-prep lab tenant in this PR because non-
interactive admin auth is not present in the agent
workspace. A maintainer with REST auth to a CIM-accelerated
tenant should:

1. Run the recipe SPL with `summariesonly=false` first to
   confirm the Authentication data model has data for the
   queried time range and `action="failure"` is populated.
2. Re-run with `summariesonly=true` (the recipe shape) to
   confirm acceleration is alive and returns the same shape.
3. Tune `failure_count >= 5` for the tenant's baseline noise
   floor (see Gotchas).
4. Run the markers companion recipe side by side and
   confirm the hottest heatmap blobs correspond to the
   loudest markers (sanity check on the normalisation
   formula and the `head 5000` truncation).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
