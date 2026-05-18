---
schema_version: 1
id: cim-network-traffic--heat
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic"
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
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: dest_country
    type: string
    example: "US"
  - name: byte_count
    type: integer
    example: "184320000"
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
    path: "docs/recipes/cim-network-traffic/markers.md"
  - description: "Companion recipe — same source, different layer (H3 hexbin)"
    path: "docs/recipes/cim-network-traffic/h3.md"
  - description: "Splunk CIM skill — Network Traffic data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# CIM Network Traffic — heatmap

The aggregate-density complement to the
[cim-network-traffic/markers](./markers.md) and
[cim-network-traffic/h3](./h3.md) recipes — same CIM-accelerated
`Network_Traffic` data model, same `iplocation` geocoding of
destination IPs, but rendered as a weighted heatmap rather than
discrete markers or hexagonal cells. The heat layer surfaces
**network conversation PRESSURE** as smooth colour intensity:
hot blobs indicate regions transferring the most bytes; cool blobs
indicate quiet regions. This is the natural shape when the
dashboard question is "where on the world map is my traffic
volume concentrating right now?" rather than "which individual
destinations should I drill into?" (markers) or "which region
hexes are warmest?" (H3).

## 1. Source description

Same Splunk **Network Traffic** Common Information Model (CIM)
data model as the companion [markers](./markers.md) and
[h3](./h3.md) recipes — vendor-agnostic because the data model
normalises events from Palo Alto, Cisco ASA / FTD, Cisco SD-WAN,
Meraki MX flow data, Cisco Secure Firewall eStreamer, NetFlow /
sFlow / IPFIX, Splunk Stream wire-data, and any other source
tagged `network` + `communicate`.

**Why heatmap for CIM Network Traffic.** A markers view at world
zoom collapses dense egress regions (US-east hyperscaler CDNs,
Frankfurt cloud-region tenants, Singapore inter-region peering)
into overlapping circles that bury the "where is my traffic
volume going" signal under visual clutter. An H3 view answers
"which region cells are hot" but enforces a hexagonal grid that
some viewers find unfamiliar. A heatmap aggregates the
byte-volume weight into smooth Gaussian blobs that read as
"network pressure" — the layer for **NetOps capacity dashboards**,
**executive bandwidth-cost briefings**, and **traffic-trending
panels**, NOT for per-destination investigation (use markers)
or per-region drilldown (use H3).

**Typical sourcetype / index:** anything tagged
`network communicate` (check `| tstats values(sourcetype) WHERE
\`cim_Network_Traffic_indexes\` tag=network tag=communicate`);
typical index is `network` or the vendor-specific index
(`pan_logs`, `cisco_secure_fw`, etc.). This recipe queries the
data-model accelerated summary, so the source index does not
appear in the SPL — that is the whole point of CIM.

## 2. SPL recipe

```spl
| tstats summariesonly=true sum(All_Traffic.bytes) AS byte_count FROM datamodel=Network_Traffic WHERE All_Traffic.action="allowed" earliest=-24h latest=now BY All_Traffic.dest
| rename All_Traffic.dest AS dest
| where match(dest, "^\d+\.\d+\.\d+\.\d+$")
| iplocation dest
| where isnotnull(lat) AND isnotnull(lon)
| where byte_count >= 1048576
| eventstats max(byte_count) AS max_byte_count
| eval weight=round(log10(byte_count) / log10(max_byte_count), 2)
| rename dest AS id, Country AS dest_country
| fields id, lat, lon, dest_country, byte_count, weight
| sort - byte_count
| head 5000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true sum(All_Traffic.bytes) AS
  byte_count FROM datamodel=Network_Traffic`** — reads the
  CIM-accelerated data model summary, NOT raw events. The
  heatmap weights BLOBS by bandwidth, not by flow count, so the
  aggregate is `sum(bytes)` rather than `count` (the markers
  and h3 recipes use `count` because for those layers each
  feature represents a destination, not a volume metric).
  Switching from `count` to `sum(bytes)` changes the panel's
  semantic from "where am I making the most connections?" to
  "where am I sending the most data?" — capacity-planning's
  natural question.
- **`WHERE All_Traffic.action="allowed"`** — filter at the
  data-model layer; only allowed traffic represents real
  bandwidth use. For a security-focused "where was traffic
  denied?" view, flip to `"blocked"` (which incidentally also
  reframes the panel as a control-effectiveness map rather
  than a capacity-planning map).
- **`BY All_Traffic.dest`** — one row per unique destination
  IP. As in the heat-recipe sibling for Authentication, the
  heat blob per region then depends on how many destinations
  EACH region attracts — one hot blob in Ashburn might be ONE
  high-volume CDN endpoint or 100 medium-volume cloud APIs.
  The popup will not disambiguate this — that's the markers
  recipe's job.
- **`| where match(dest, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4-only
  filter. Drop or relax for IPv6-heavy environments; modern
  cloud egress is often dual-stack and the v6 leg may carry
  the bulk of the bandwidth.
- **`| iplocation dest`** — Splunk's built-in MaxMind GeoLite2
  geocoder. No outbound network call. Private-range IPs get
  null lat / lon; the next line drops them.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drops
  RFC-1918 destination IPs (internal east-west traffic,
  RFC-6598 carrier-grade NAT, etc.) that have no geographic
  meaning on a public-internet map. Without this, every
  internal-LAN flow lands at Null Island.
- **`| where byte_count >= 1048576`** — 1 MiB floor. Removes
  the long tail of single-byte SYN-ACK retransmits, opportunistic
  DNS bursts, and ICMP probes that produce thousands of
  features with no real bandwidth signal. Tune to the tenant's
  baseline. Most enterprise NetOps tenants see a clean separation
  between < 100 KiB chatter and > 1 MiB actual conversation.
- **`| eventstats max(byte_count) AS max_byte_count`** — adds
  the global maximum byte volume as a column on every row, so
  the next `eval` can normalise. `eventstats` (not `stats`) is
  the right command because it KEEPS the per-destination rows
  and only ADDS the new column.
- **`| eval weight=round(log10(byte_count) /
  log10(max_byte_count), 2)`** — **log-scale** normalisation,
  because byte counts in real networks span many orders of
  magnitude (1 MiB to 100 GiB per destination). A linear-scale
  normalisation (as in cim-authentication/heat) would collapse
  90 % of destinations to `weight < 0.01` and render them
  invisible in the heatmap. The log-scale formula keeps every
  destination above the 1 MiB floor visible while still putting
  the heaviest hitters at the top of the colour ramp. See §6
  Gotchas for the trade-offs.
- **`| rename dest AS id, Country AS dest_country`** — adopt
  Better Map's canonical `id` alias. `dest_country` flows
  through as a feature property (useful for a "filter heatmap
  to one country" dashboard input or a per-country drilldown).
- **`| head 5000`** — render budget. The heat layer scales to
  thousands of points cleanly. 5000 covers a busy enterprise
  egress surface (most tenants see < 1500 unique destination
  IPs per 24 h above the 1 MiB floor).

## 3. Expected fields

| field        | type    | example         |
|--------------|---------|-----------------|
| id           | string  | 203.0.113.45    |
| lat          | number  | 37.7749         |
| lon          | number  | -122.4194       |
| dest_country | string  | US              |
| byte_count   | integer | 184320000       |
| weight       | number  | 0.84            |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`dest_country` is carried through for filter / drilldown but is
not strictly required by the heat layer.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.7,
  "heatmapRadius": 28
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the heatmap
  renderer. The `auto` renderer only switches to heatmap above
  ~200 features, so for quieter tenants (overnight, holidays,
  smaller ones) the recipe needs an explicit pin to force the
  heat rendering even when the destination-IP count drops.
- **`heatmapOpacity: 0.7`** — slightly lower than the
  Authentication-heatmap default (0.75) because Network Traffic
  heatmaps tend to be MORE saturated (more concentrated in
  cloud-hyperscaler regions like Ashburn, Dublin, Frankfurt,
  Singapore) and at 0.75 those concentrations occlude the
  country / city labels underneath. 0.7 keeps the basemap
  geography legible while still putting the heat ramp in the
  visual foreground. The formatter-schema range is 0.0-1.0.
- **`heatmapRadius: 28`** — slightly larger than the
  Authentication-heatmap default (24 px) because Network
  Traffic heat blobs typically need to MERGE across
  metro-scale CDN footprints (e.g. AWS `us-east-1` spans
  multiple availability zones with discrete IP ranges that
  should read as one regional blob). 28 px is appropriate for
  a global egress view. For a single-region view (e.g. "show
  me egress inside Europe only"), drop to 14-18 px so individual
  data-centres become visible. The formatter-schema range is
  2-64 px.
- **`weight` drives heat intensity automatically.** The heat
  layer renderer auto-picks the `weight` field by name (per
  Better Map's `dataFitness.js` field aliasing). If you rename
  `weight` in the SPL, also set the formatter's `heatField`
  option (or whichever name the formatter schema uses — check
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce the panel by
pasting the SPL above into a Dashboard Studio map panel with
Better Map as the visualization, applying the formatter JSON
in §4, and varying the time range to confirm the heatmap shifts
with traffic patterns (e.g. compare a Sunday-quiet window vs
the Tuesday-morning office-VPN spike — the heatmap should
brighten markedly across the egress-CDN regions between the
two)._

## 6. Gotchas

- **CIM data-model acceleration MUST be enabled** on the
  `Network_Traffic` data model for `summariesonly=true` to
  return anything. Confirm in Settings → Data models →
  Network Traffic → Acceleration. If accel is OFF, the
  dashboard panel returns ZERO results (the correct, fail-safe
  behaviour). If you cannot enable acceleration in your
  tenant, change the recipe to `summariesonly=false` (much
  slower; not recommended for any panel that auto-refreshes).
- **Log-scale weight is INTENTIONAL — do not "fix" it.** Network
  byte volumes in production span 6+ orders of magnitude (a
  1 MiB DNS-over-HTTPS conversation vs a 1 TiB cloud-backup
  egress). The linear normalisation used in the Authentication
  heatmap recipe (`weight = failure_count / max_failure_count`)
  would collapse every destination below the loudest single
  endpoint to `weight ≈ 0`, leaving the heatmap rendering as
  one bright pixel in Ashburn and nothing else visible. The
  log-scale formula (`weight = log10(byte_count) /
  log10(max_byte_count)`) preserves the rank order while
  compressing the dynamic range so destinations that move
  1 MiB and destinations that move 100 GiB are BOTH visible
  on the heatmap. The trade-off is that the weight values
  feel less intuitive in popups (a "weight" of 0.7 doesn't
  read as "70 % of max" — read it as the log-scale rank, or
  expose `byte_count` directly in the popup template instead
  of `weight`).
- **Heatmap vs markers vs H3 — when to choose which.** Heatmap
  is the right layer for "show me bandwidth pressure across
  regions" questions (NetOps capacity dashboards, executive
  bandwidth-cost briefings, traffic-trending panels). Markers
  (per [cim-network-traffic/markers](./markers.md)) are the
  right layer for "show me each destination individually"
  questions (NetOps investigation, IR triage). H3
  ([cim-network-traffic/h3](./h3.md)) sits between the two
  with per-cell drilldown but stable hex-cell geometry that
  the heat layer's smooth blobs lack. All three can coexist
  in the same dashboard with the same data source by toggling
  layers via the BM-CT-1 contract
  (`setEnabled` / `isEnabled` / `reset`) from a dashboard
  input.
- **Hyperscaler concentration distorts the picture.** AWS
  `us-east-1`, Azure East US, GCP `us-east1`, Cloudflare's
  edge POPs, Akamai's Ashburn cluster — they ALL pile up in
  the Ashburn / Northern-Virginia heat blob. If your dashboard
  question is "where do I actually transfer data geographically?"
  consider joining the destination ASN (`asn_owner` from
  `iplocation -allfields` or a separate ASN lookup) and
  faceting the heatmap on ASN rather than on raw IP geocoding
  — otherwise the panel reads as "98 % of my traffic goes to
  the eastern United States" when the operational reality is
  "98 % of my traffic terminates at a global CDN that happens
  to register its anycast IPs in Ashburn."
- **`tag=network communicate` membership.** If your data is
  classified for the data model under DIFFERENT tags (some
  Splunk Cloud tenants override the CIM tag stanzas), check
  `| eventtypes` for your sourcetype and re-tag if needed.
  This is a CIM-compliance issue, not a Better Map issue.
- **`sum(All_Traffic.bytes)` semantics.** The CIM
  Network_Traffic data model maps `bytes` to the SUM of
  `bytes_in` and `bytes_out` for the flow, NOT to one
  direction or the other. If your panel question is
  specifically "show me egress" or "show me ingress," replace
  the aggregate with `sum(All_Traffic.bytes_out)` or
  `sum(All_Traffic.bytes_in)` and rename the panel accordingly.
- **MaxMind database licensing.** Splunk Enterprise ships with
  the free MaxMind GeoLite2 database. For higher accuracy /
  commercial use, swap in MaxMind GeoIP2 via the Splunk admin
  UI. The recipe is unchanged — `iplocation` reads whichever
  database is configured.
- **Time range.** The recipe hard-codes `earliest=-24h
  latest=now` so it works in a panel without a dashboard time
  picker. Replace with `earliest=$earliest$ latest=$latest$`
  once you wire the recipe into a dashboard with a time-range
  input. For executive briefings, `earliest=-7d` over a 7-day
  window is more common and smooths over the weekend-quiet
  effect.
- **PII / GDPR posture.** Per ROADMAP §1a (binding), Better
  Map NEVER sends event data outside `splunkd:8089`.
  `iplocation` runs server-side against the local MaxMind
  database — no outbound geocoding API call. Destination IPs
  are not personal data on their own, but `byte_count` per
  destination is metadata about user behaviour — a heatmap
  that's hot on Pornhub or a specific personal-banking IP
  identifies the user with the high egress. Treat the
  RESULTING panel as a privacy-sensitive artefact even though
  no individual field IS personal data. Aggregating up to ASN
  or country before rendering (`stats sum(byte_count) BY
  dest_country` before the `iplocation` step) eliminates this
  concern at the cost of losing per-IP resolution.
- **No OT safety dependency.** This recipe is pure IT network
  traffic. If your `Network_Traffic` data model ALSO ingests
  passive DPI of an OT zone (Cisco Cyber Vision, Claroty),
  filter THOSE sourcetypes out of this panel (`NOT sourcetype
  IN ("cisco:cv:*", "claroty:*")`) and put them in a DEDICATED
  recipe with explicit OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6. A hot heatmap blob over a manufacturing plant region
  could conceal a low-volume but safety-relevant OT exfiltration
  attempt — the markers / cell-by-cell layers surface that;
  the heatmap blurs it.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, follows the documented Splunk CIM Network_Traffic contract
plus the canonical `eventstats max + log10 eval normalise`
heat-weight pattern, and uses only shipping Splunk built-ins
(`tstats`, `iplocation`, `eventstats`, `Splunk_SA_CIM`). It has
not been dispatched against the v1.7-prep lab tenant in this PR
because non-interactive admin auth is not present in the agent
workspace. A maintainer with REST auth to a CIM-accelerated
tenant should:

1. Run the recipe SPL with `summariesonly=false` first to confirm
   the Network_Traffic data model has data for the queried time
   range and `action="allowed"` is populated.
2. Re-run with `summariesonly=true` (the recipe shape) to confirm
   acceleration is alive and returns the same shape.
3. Tune `byte_count >= 1048576` for the tenant's baseline byte
   floor (see Gotchas — `>= 1024` may be appropriate for a
   small-business tenant, `>= 104857600` may be appropriate for
   a hyperscaler-heavy enterprise).
4. Run the markers / H3 companion recipes side by side and
   confirm the hottest heatmap blobs correspond to the loudest
   markers / fullest H3 cells (sanity check on the log-scale
   normalisation and the `head 5000` truncation).
5. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
