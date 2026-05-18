---
schema_version: 1
id: splunk-stream--heat
source:
  id: splunk-stream
  display_name: "Splunk Stream (wire data)"
  pattern: splunk-stream
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: Splunk_TA_stream
    optional: false
  - id: splunk_app_stream
    optional: true
  - id: builtin:iplocation
    optional: false
expected_fields:
  - name: id
    type: string
    example: "203.0.113.45"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: dest_country
    type: string
    example: "US"
  - name: bytes_out
    type: integer
    example: "892160000"
  - name: weight
    type: number
    example: "0.74"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/splunk-stream/markers.md"
  - description: "Splunk Stream skill — wire-data capture and protocol analytics"
    path: "~/.cursor/skills/splunk-stream/SKILL.md"
  - description: "Splunk Stream setup skill — TA_stream + splunkapp_stream"
    path: "~/.cursor/skills/splunk-stream-setup/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# Splunk Stream (wire data) — heatmap

The aggregate-density complement to the
[splunk-stream/markers](./markers.md) recipe — same
`stream:tls` wire-data sourcetype, same `iplocation` geocoding
of destination IPs, but rendered as a weighted heatmap rather
than discrete markers. The heat layer surfaces **data egress
PRESSURE** as colour intensity: hot blobs indicate regions /
cities receiving the most outbound bytes from your network;
cool blobs indicate quiet regions. This is the natural shape
when the dashboard question is "where geographically is most
of my data going?" rather than "which specific destinations
should I investigate?".

## 1. Source description

Same Splunk Stream **TLS session** (`stream:tls`) sourcetype
as the companion [markers](./markers.md) recipe — passive wire-
data capture from a SPAN / mirror / cloud VPC mirror,
indexed to the customer's wire-data index (default
`wire_data`).

**Why heatmap for wire data.** A markers view at world zoom
collapses dense regional destination clusters (one panel
covering an entire CDN edge fleet — Cloudflare, Akamai,
Fastly POPs by the hundreds, or AWS / Azure / GCP regional
egress endpoints) into overlapping circles that bury the
"which region is hottest" signal under visual clutter. A
heatmap aggregates the byte-volume weight into smooth
Gaussian blobs that read as "egress pressure" — the layer
for **executive data-exfiltration risk reviews** and
**high-level data-residency briefings** on where your
network's outbound traffic actually goes, NOT for per-
destination IR triage (use markers for that).

**Typical sourcetype / index:** `sourcetype="stream:tls"` /
`index=wire_data` (per `splunk-stream-setup`'s default app
context).

## 2. SPL recipe

```spl
index=wire_data sourcetype="stream:tls"
| stats sum(bytes_out) AS bytes_out BY dest_ip
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| where bytes_out >= 1048576
| eventstats max(bytes_out) AS max_bytes_out
| eval weight=round(log10(bytes_out) / log10(max_bytes_out), 2)
| rename dest_ip AS id, Country AS dest_country
| fields id, lat, lon, dest_country, bytes_out, weight
| sort - bytes_out
| head 5000
```

Why this exact shape, line by line:

- **`index=wire_data sourcetype="stream:tls"`** — base
  search. The TLS decoder is the right sourcetype for "where
  on Earth does my outbound traffic go" — TLS covers ~90 %
  of modern outbound flows and the SNI / dest_ip pair gives
  us both the application identity and the geo join key.
  See the companion markers recipe for the rationale.
- **`stats sum(bytes_out) AS bytes_out BY dest_ip`** —
  collapse from per-session events to one row per destination
  IP, weighted by total outbound bytes. The markers recipe
  groups by `(src_ip, dest_ip, dest_port)` for per-session
  investigation; the heat recipe drops `src_ip` and
  `dest_port` because the heatmap question is "where is the
  egress going?" not "who is sending it where?". If you also
  want per-port stratification, restore `dest_port` to the
  `BY` clause — but the heat blob's spatial resolution
  (Gaussian over `heatmapRadius` pixels) makes per-port
  distinction visually meaningless at world zoom anyway.
- **`iplocation dest_ip`** — Splunk's built-in MaxMind
  GeoLite2 geocoder, server-side, no outbound network call.
  See the companion markers recipe for the MaxMind freshness
  discussion.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  destinations that don't geocode (RFC-1918, multicast,
  link-local). For a wire-data heatmap, dropping un-geocoded
  destinations is correct: they're typically other
  cloud-internal services that share a private routing
  domain with your egress point and have no public-Earth
  position.
- **`where bytes_out >= 1048576`** — 1 MiB floor. The
  long-tail of TLS handshakes-only or single-request-and-
  done destinations would otherwise dominate row count
  (thousands of micro-flows that contribute pixels of
  heat) without contributing the actual byte-volume signal
  the heatmap is trying to surface. Tune by tenant: a
  bandwidth-light SMB tenant might drop the floor to 64
  KiB; a high-throughput SaaS perimeter might raise it to
  64 MiB to focus on bulk transfer destinations only.
- **`eventstats max(bytes_out) AS max_bytes_out`** — adds
  the global maximum byte-volume as a column on every row,
  so the next `eval` can normalise. `eventstats` (not
  `stats`) is the right command here because it KEEPS the
  per-destination rows and only ADDS the new column.
- **`eval weight=round(log10(bytes_out) /
  log10(max_bytes_out), 2)`** — **log-scale normalisation**.
  Bytes-out distributions in wire data span 6+ orders of
  magnitude (a TLS handshake is ~5 KB; a multi-GB software
  update is ~5 GB — that's 6 orders of magnitude in one
  flow set). Linear normalisation
  (`bytes_out / max_bytes_out`) would render every
  destination but the heaviest as `weight ≈ 0.00`,
  visually invisible. Log-scale gives every band in the
  long-tail a readable weight in the `[0, 1]` band. See
  §6 Gotchas for the linear-normalisation fallback when
  the dataset is naturally narrow-range (e.g. a single-
  application backend with uniform request sizes).
- **`rename dest_ip AS id, Country AS dest_country`** —
  adopt Better Map's canonical `id` alias. `dest_country`
  flows through as a feature property for dashboard
  filtering ("show me only destinations in CN", "exclude
  US-domiciled traffic").
- **`sort - bytes_out`** — heaviest destinations first;
  combined with `head 5000` this gives the heatmap its
  busiest blobs even when the long-tail exceeds the
  render budget.
- **`head 5000`** — render budget. The heat layer scales
  to thousands of points cleanly. 5000 covers a busy
  perimeter with thousands of distinct TLS destinations
  per 24 h above the 1 MiB threshold (typical tenant:
  500-2000 distinct heavy egress IPs per day, comfortably
  under the cap).

Note every `|` starts its own physical line per the SPL pipe-
per-line contract.

## 3. Expected fields

| field        | type    | example       |
|--------------|---------|---------------|
| id           | string  | 203.0.113.45  |
| lat          | number  | 37.7749       |
| lon          | number  | -122.4194     |
| dest_country | string  | US            |
| bytes_out    | integer | 892160000     |
| weight       | number  | 0.74          |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`dest_country` is carried through for filter / drilldown but
is not strictly required by the heat layer.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.7,
  "heatmapRadius": 28
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer switches to heatmap
  above ~200 features, so for quieter tenants (overnight,
  weekend, single-site SMB) the recipe needs an explicit
  pin to force the heat rendering even when the
  destination-IP count drops.
- **`heatmapOpacity: 0.7`** — slightly less opaque than
  the cim-authentication/heat recipe's `0.75` because
  wire-data heat blobs tend to cluster densely in cloud
  hubs (AWS `us-east-1`, GCP `europe-west1`, Azure
  `eastus`) — the lower opacity lets the underlying
  basemap city labels survive even where the blob density
  saturates. At 1.0 the heat fully occludes the city
  underlay; at 0.5 the heat is too washed out to read
  at low zoom; 0.7 is the wire-data sweet spot.
- **`heatmapRadius: 28`** — slightly larger pixel radius
  than the cim-authentication/heat recipe's `24` because
  egress traffic tends to be more spatially concentrated
  in cloud regions (which are physically large city
  metros covering 50+ km — Northern Virginia for AWS
  `us-east-1`, Quincy Washington for AWS `us-west-2`).
  A larger radius merges all the in-region destinations
  into a single readable "hub" blob at world zoom and
  resolves to per-region clusters at country zoom. For
  a single-region or single-city view (e.g. "show me
  what's leaving the network to non-cloud destinations
  only"), drop to 14-18.
- **`weight` drives heat intensity automatically.** The
  heat layer renderer auto-picks the `weight` field by
  name (per Better Map's `dataFitness.js` field aliasing).
  If you rename `weight` in the SPL, also set the
  formatter's `heatField` option (or whichever name the
  formatter schema uses — check
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker harness (ROADMAP §3
D5 Phase 1 SHIPPED — Playwright Phase 2 still pending). Until
then, a maintainer with a `Splunk_TA_stream` install can
reproduce the panel by pasting the SPL above into a Dashboard
Studio map panel with Better Map as the visualization and
applying the formatter JSON in §4. The cyber-incidents demo
preset
([formatter dropdown — D6 SHIPPED](https://github.com/fenre/better_map/blob/main/docs/recipes/index.md))
renders a structurally similar view if you don't have Stream
data on hand. Vary the time range to confirm the heatmap
shifts with traffic patterns (e.g. compare a workday-business-
hours window vs an overnight backup-window — the heatmap
should brighten markedly in backup-destination regions and
dim in user-facing-SaaS regions between the two)._

## 6. Gotchas

- **Log-scale normalisation gotcha.** The log-scale
  `weight` formula assumes `max_bytes_out > 1` (so
  `log10(max_bytes_out) > 0` — denominator is non-zero).
  If the heaviest destination is itself ≤ 1 byte (only
  possible in extreme edge cases — a panel filtered to a
  single destination that only handshook), the eval
  silently produces `weight=NaN`, and the heat layer
  drops the row. For absolute safety, swap the eval to
  `eval weight=if(max_bytes_out>10, round(log10(bytes_out)
  / log10(max_bytes_out), 2), round(bytes_out /
  max_bytes_out, 2))` — log-scale when the dataset spans
  orders of magnitude, linear-scale when it's narrow-
  range.
- **Heatmap vs markers — when to choose which.** Heatmap
  is the right layer for "show me the egress pressure"
  questions (executive briefing, data-residency review,
  high-level threat-briefing dashboards). Markers (per
  [splunk-stream/markers](./markers.md)) are the right
  layer for "show me each destination individually"
  questions (SOC analyst investigation, IR triage,
  per-flow forensics). Both can coexist in the same
  dashboard with the same data — the heat layer goes
  underneath (rendered first in the panel), markers
  go on top (rendered second), and the operator gets
  BOTH the egress pressure surface AND the per-IP
  drilldown affordance. Use Better Map's BM-CT-1 layer
  contract (`setEnabled` / `isEnabled` / `reset`) to
  toggle each layer independently from a dashboard input.
- **Heatmap is NOT good for "show me each session".**
  Every byte from every session to a single destination
  IP collapses to a single feature (one row in the panel).
  If the dashboard question is "show me each individual
  TLS session on the map," use the markers recipe over
  per-session aggregation, NOT this heat recipe over
  per-destination aggregation. The heat layer is
  fundamentally a per-feature-density renderer.
- **CDN destination smearing.** A single CDN provider
  (Cloudflare, Fastly, Akamai) operates POPs in 200+
  cities worldwide. Your egress to that CDN will land
  in WHICHEVER POP your nearest router sends you to —
  geographically dispersed across continents. The
  resulting heat blob is correctly distributed across
  every CDN POP your network touches, NOT concentrated
  at the CDN's HQ. This is the right answer for an
  egress-pressure map ("we send 5 TB/day to Cloudflare,
  distributed across 30 cities") but is sometimes
  surprising to executives who expect "all Cloudflare
  egress lights up at the Cloudflare HQ pin." If you
  need a CDN-grouped view, enrich `dest_ip` with an
  ASN lookup (`| iplocation dest_ip allfields=true`)
  and aggregate `BY as_name` BEFORE the geocoding step.
- **MaxMind GeoLite2 freshness.** Same as the companion
  markers recipe. Splunk ships GeoLite2 but its refresh
  cadence is tied to the Splunk release train, not
  MaxMind's. If geo accuracy matters at the city level,
  refresh the database via `splunk cmd splunkd cmd
  geoip-update` or point `iplocation` at a fresher
  MaxMind / GeoIP2 file via `transforms.conf` `[geoip]`
  stanza. For country-level heatmaps the default
  freshness is fine — country boundaries don't move
  often.
- **`stream:tls` privacy / compliance.** Wire-data
  capture is a GDPR / HIPAA scope expander on most
  customers' compliance surface. The
  [`splunk-compliance` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-compliance.mdc)
  documents the controls. The heat layer is BROADER
  than the markers layer (one blob covers an entire
  region's worth of destinations), so this layer is
  generally LOWER-risk for privacy-sensitive
  deployments — but the same identifiability rules
  apply.
- **Time range.** Hard-coded `earliest=-1h latest=now`
  is NOT a default for this recipe — the base
  `index=wire_data sourcetype="stream:tls"` search uses
  the dashboard's panel-default time range. Wire-data
  indexes are HIGH-volume; if you point a heatmap at a
  24 h window without an index-level acceleration, the
  search-head CPU cost is substantial. Constrain the
  time range explicitly in the dashboard input AND
  consider summary-indexing the per-destination roll-up
  if the panel auto-refreshes more often than every
  5 min — the SPL above is search-time-friendly because
  `stats` happens before `iplocation`, but the underlying
  raw-event scan is still O(events × seconds).
- **No OT safety dependency, BUT.** This recipe is IT-
  only by design — same as the companion markers
  recipe. If your Stream forwarders are mirrored against
  an OT/ICS environment, the
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rules 1 + 2 apply: Stream IS the canonical passive
  collection method for OT (no active probes) but the
  resulting `dest_ip` set will contain Level-0/1/2 PLCs
  and HMIs. A heatmap of those endpoints MUST NOT be
  wired to any SOAR / drilldown that could send a write
  back. Render-only is fine; render-and-act is not. Use
  the dedicated `cyber-vision` recipe wave (E5 Phase 3)
  for OT-aware wire-data presentation.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound and follows the documented Splunk Stream
contracts plus the canonical `eventstats max + eval log10
normalise` heat-weight pattern. It has not been dispatched
against a real `stream:tls` index in the v1.7-prep
development cycle (the lab tenant does not have Splunk
Stream forwarders deployed). A maintainer with a Splunk
tenant carrying Stream data should:

1. Confirm Stream data is flowing: `index=wire_data
   sourcetype="stream:tls" earliest=-1h | stats count`.
2. Run the recipe SPL and confirm the panel renders at
   least 100 heat blobs over a 24-hour window with all six
   documented fields populated for the non-RFC-1918
   destinations.
3. Run the markers companion recipe side by side and
   confirm the hottest heatmap blobs correspond to the
   loudest markers (sanity check on the log-scale
   normalisation formula and the `head 5000` truncation).
4. Tune the `bytes_out >= 1048576` threshold to the
   tenant's baseline traffic profile (see Gotchas).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 10.0 with
   Splunk_TA_stream 9.0.1 against a 5-host SPAN aggregate"),
   and submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change
   without touching the schema.

The D5 Phase 1 harness (`docker/`) makes this a 2-minute
round-trip once an operator has Stream data to point it at
— see the
[local Splunk harness operator guide](https://github.com/fenre/better_map/blob/main/docs/development/local-splunk-harness.md).
