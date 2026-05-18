---
schema_version: 1
id: netflow-sflow-ipfix--heat
source:
  id: netflow-sflow-ipfix
  display_name: "NetFlow / sFlow / IPFIX (flow records)"
  pattern: splunk-vendor-ta
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: Splunk_TA_netflow
    optional: false
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
  - name: bytes
    type: number
    example: "184320000"
  - name: weight
    type: number
    example: "0.78"
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source family, aggregate H3 hex layer"
    path: "docs/recipes/netflow-sflow-ipfix/h3.md"
  - description: "Companion recipe — same heatmap layer over wire-data (Splunk Stream)"
    path: "docs/recipes/splunk-stream/heat.md"
  - description: "Splunk Network Explorer skill — NetFlow / sFlow / IPFIX collection patterns"
    path: "~/.cursor/skills/splunk-network-explorer/SKILL.md"
  - description: "Layer reference — heatmap (continuous density)"
    path: "docs/reference/layers.md"
  - description: "heatmap layer source (weighted GL heatmap layer)"
    path: "better_map/appserver/static/visualizations/better_map/src/lib/layers/heatmap.js"
---

# NetFlow / sFlow / IPFIX (flow records) — heatmap

The **continuous-density** companion to the
[netflow-sflow-ipfix/h3](./h3.md) recipe. Same flow-data
source, same `iplocation` enrichment, same `sum(bytes) BY
dest_ip` aggregation — but rendered as a **MapLibre GL
weighted heatmap** instead of discrete hex cells. The right
layer when the audience is executive ("show me the global
egress landscape at a glance") rather than operational ("which
hex cell crossed threshold this hour"). Where hexbin gives
sharp polygonal boundaries and per-cell drilldown, the
heatmap gives a smooth gradient that reads at any zoom level
and emphasises the *shape* of the egress geography rather than
the *count* per region.

## 1. Source description

Same as the
[H3 sibling recipe](./h3.md#1-source-description) — see that
file for the full discussion of NetFlow / sFlow / IPFIX
collection patterns, Splunk_TA_netflow sourcetype mapping, and
vendor-specific variations.

**Typical sourcetype / index:** `sourcetype="cisco:netflow"` /
`index=netflow` (the Cisco-equivalents discussed in the H3
recipe apply identically here).

**Why a heatmap for flow data:** raw flow records, even after
per-destination aggregation, produce hundreds-to-thousands of
distinct lat/lon points scattered across the globe. A heatmap
is the right visualisation when:
- The audience cares about **regional pressure** rather than
  per-IP identity (executive briefings, capacity-planning,
  data-residency discussions).
- The byte distribution is **long-tailed** (a handful of
  top-talkers dwarf the rest in raw volume) — a log-scale
  `weight` (introduced below) prevents the top-talkers from
  monopolising the visual signal.
- The dashboard runs at **multiple zoom levels** — heatmap
  reads naturally at country, continent, and global zoom;
  hex cells need resolution adjustment for the same
  experience.

## 2. SPL recipe

```spl
index=netflow sourcetype="cisco:netflow"
| stats sum(bytes) AS bytes BY dest_ip
| iplocation dest_ip
| where isnotnull(lat) AND isnotnull(lon)
| where bytes >= 1048576
| eventstats max(bytes) AS max_bytes
| eval weight=if(max_bytes > 1,
    round(log10(bytes + 1) / log10(max_bytes + 1), 2),
    1.0)
| rename dest_ip AS id, Country AS dest_country
| fields id, lat, lon, dest_country, bytes, weight
| sort - bytes
| head 10000
```

What the pipeline does, stage by stage:

- **`stats sum(bytes) AS bytes BY dest_ip`** — rolls up
  potentially millions of per-flow records into one row per
  destination IP. Same first stage as the H3 recipe; the
  difference is downstream.
- **`iplocation dest_ip`** — Splunk's built-in MaxMind
  GeoLite2 lookup. Populates `lat`, `lon`, `Country` →
  aliased to `dest_country`. RFC-1918 destinations get null
  lat/lon; the next `where` drops them.
- **`where isnotnull(lat) AND isnotnull(lon)`** — defensive
  filter for the small fraction of public IPs that MaxMind
  cannot place (very-recently-allocated blocks, TOR exits,
  some VPN ranges).
- **`where bytes >= 1048576`** — drop destinations under 1 MB
  total over the time window. Heatmap rendering is more
  computationally expensive than hexbin (the GL fragment
  shader integrates every point's contribution at every
  display pixel); pre-filtering to "destinations that
  actually matter" is the single biggest performance lever
  for this layer. Adjust the threshold for your traffic
  baseline: 1 KB for a small-office tenant, 1 GB for a
  global enterprise.
- **`eventstats max(bytes) AS max_bytes`** — compute the
  per-search maximum so the next stage can normalise. The
  `eventstats` (not `stats`) preserves all rows; it appends
  `max_bytes` as a constant column.
- **`eval weight = ... log10(bytes + 1) / log10(max_bytes + 1)`**
  — the **log-scale `weight` pattern** introduced in the
  [splunk-stream/heat sibling recipe](../splunk-stream/heat.md#2-spl-recipe).
  NetFlow byte distributions span 6+ orders of magnitude
  (5 KB DNS-query bursts vs 5 GB bulk transfers), so linear
  normalisation makes every destination except the absolute
  top-talker visually invisible (`weight ≈ 0.001` for
  everything-but-the-peak). Log-normalisation compresses
  the long tail into a usable 0-1 range. The `if(max_bytes
  > 1, ..., 1.0)` guard prevents a divide-by-near-zero when
  the search returns a single low-volume destination (or
  in dev tenants with no real flow data).
- **`rename dest_ip AS id, Country AS dest_country`** —
  adopt Better Map's `id` alias and namespace the country
  field for downstream popup templating.
- **`fields id, lat, lon, dest_country, bytes, weight`** —
  explicit projection. Six fields downstream — `weight`
  is the layer-required input; the others are popup metadata.
- **`sort - bytes`** — most-traffic-first so the topmost-
  weighted point in any overlapping cluster renders on top.
- **`head 10000`** — defensive cap. The MapLibre heatmap
  layer comfortably handles 10k weighted points at 60fps on
  a modern laptop; 100k starts to drop frames on
  intermediate zoom levels (the gradient is integrated per
  pixel, not per point). The H3 sibling recipe scales to
  much higher row counts because hexbin aggregates server-
  side; heatmap weighs every input point client-side.

## 3. Expected fields

| field        | type   | example         |
|--------------|--------|-----------------|
| id           | string | 203.0.113.45    |
| lat          | number | 37.7749         |
| lon          | number | -122.4194       |
| dest_country | string | US              |
| bytes        | number | 184320000       |
| weight       | number | 0.78            |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.7,
  "heatmapRadius": 28
}
```

Why these specific values:

- **`pointRenderer: "heatmap"`** — explicit pin. The default
  `pointRenderer: "auto"` switches to heatmap at 10000+
  features but at 1000-10000 features it stays on cluster;
  for an executive-pressure panel you want heatmap behaviour
  regardless of the rolling flow-count, so pin it.
- **`heatmapOpacity: 0.7`** — slightly translucent so the
  basemap labels (country names, ocean labels) remain
  legible behind dense heatmap blobs. For a dark-themed
  dashboard, lower to 0.55-0.65; for light themes, 0.75
  reads cleanly.
- **`heatmapRadius: 28`** — pixel radius of each point's
  density contribution. 28 px at default zoom gives smooth
  continental-scale gradients without isolated points
  showing as small bullseyes. Lower to 16-20 for finer-grain
  city-level analysis; raise to 36-48 for global
  data-residency briefings where the audience reads at the
  continent level.
- **`weight` is read automatically** because the SPL named
  it `weight` (Better Map's contract for the heatmap
  layer's input intensity). The MapLibre layer maps `weight
  ∈ [0,1]` to its `heatmap-weight` paint property, then
  applies its standard `heatmap-color` ramp on top.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP
§3 D5). The heatmap is best demoed at continent-level zoom
showing concentrated blobs over major cloud-provider regions
(US-East, EU-West, Asia-Pacific) — the audience-takeaway shape
("most of our egress is concentrated in these three regions")
appears immediately, vs the H3 sibling which requires reading
discrete hex cells. A maintainer can reproduce by pasting the
SPL into a Dashboard Studio map panel with Better Map as the
visualization, applying the formatter JSON in §4, and setting
the time-range token to `-24h@h,now` (the heatmap needs at
least a few hundred destinations to render a meaningful
gradient)._

## 6. Gotchas

- **Heatmap vs hexbin — which to pick.** Two answers to
  "where is the egress concentrated":

  | Layer | Best for | Loses |
  |---|---|---|
  | `heatmap` (this recipe) | "Show me the regional pressure landscape at a glance, smooth at any zoom" | Per-cell drilldown affordance, discrete count threshold |
  | `hexbin` (see [netflow-sflow-ipfix/h3](./h3.md)) | "Area-neutral aggregate per stable hex cell, with click-to-drilldown" | Smooth gradient, multi-zoom continuity |

  Both coexist in the same dashboard via Better Map's
  BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
  `reset`) toggled from dashboard inputs. A common pattern
  is "heatmap as the default panel, hexbin available via
  toggle for the analyst who wants to drill into a specific
  region's flow contribution."

- **Log-scale `weight` safety.** The
  `if(max_bytes > 1, ..., 1.0)` guard handles dev tenants
  with very low volume; if your tenant has even one
  destination over a few MB the guard never fires. If
  every destination is under 1 KB (highly unusual — a
  measurement glitch is more likely), the heatmap will
  render every point at `weight = 1.0` and lose the
  intensity gradient — surface that case via a companion
  saved search that alerts on "no destinations exceed 1 MB
  over 24h" rather than letting the dashboard silently
  degrade.
- **Heatmap renders performance.** The MapLibre GL heatmap
  layer integrates each point's `heatmapRadius` contribution
  across every pixel inside that radius — i.e. the cost is
  approximately `O(N × R²)` where N is the number of points
  and R is the radius in pixels. At `N = 10000` and `R = 28`
  the cost is ~8M pixel evaluations per frame, well within
  60fps on a 2020+ laptop's GPU. At `N = 50000` and `R = 40`
  the cost rises to ~80M and starts to drop frames on
  zoom-in. The defensive `head 10000` + `where bytes >=
  1048576` pre-filters in §2 keep this layer comfortably
  inside the performance envelope.
- **CDN destinations smear across POPs.** A single
  Cloudflare or AWS Global Accelerator destination IP
  (e.g. `1.1.1.1`, `13.249.0.0/16`) may rapidly shift
  between MaxMind-assigned cities as the underlying
  anycast announcement changes. Heatmap is more forgiving
  of this than hexbin (the smooth gradient absorbs small
  per-search variations) but a CDN-heavy panel may show
  visually-noisy gradient changes across re-renders. If
  the dashboard's purpose is "where is CDN traffic going"
  rather than "which destinations are we talking to,"
  pre-aggregate to CDN provider via a lookup that maps
  destination IP ranges to provider name.
- **MaxMind GeoIP freshness.** Splunk Enterprise / Cloud
  ships with a MaxMind GeoLite2 database that is updated
  on the Splunk release cadence (quarterly-ish). For
  data-residency-sensitive dashboards, install the
  commercial MaxMind GeoIP2 City database which updates
  weekly — instructions in the
  [splunk-network-explorer skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-network-explorer.mdc).
  Freshness matters most for newly-allocated IPv4 blocks
  and recently-relocated cloud data centres.
- **GDPR / data-residency posture.** External destination
  IPs ARE technically personal data under GDPR Recital 30
  when correlated with a subscriber identity. For pure
  flow-data dashboards (no subscriber correlation), the
  panel falls outside individual-identity scope. The
  heatmap visualisation actively HELPS the GDPR posture
  by collapsing individual destinations into aggregate
  density (the smooth gradient is, by construction, not
  an individual identifier). If your dashboard ALSO joins
  to authentication or user data, apply the same
  role-based access pattern documented in
  [cim-authentication/heat §6 Gotchas](../cim-authentication/heat.md#6-gotchas).
- **No OT safety dependency.** This recipe queries IT
  NetFlow / sFlow / IPFIX data — perimeter, cloud, and
  enterprise-internal flows. For OT-zone flow observability
  use a passive-DPI tool (Cisco Cyber Vision, Nozomi
  Networks, Claroty) per `ot-safety.mdc` Rule 1. If your
  `Splunk_TA_netflow` collector is fed from an OT-zone
  SPAN/TAP (passive collection, which IS valid), the
  visualisation is still render-only — no SOAR write-back
  may target a Level-0/1/2 destination from this panel,
  per Rule 3.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented NetFlow ingestion
and SPL contracts, and references only Splunk built-ins +
`Splunk_TA_netflow`. The formatter options (`pointRenderer:
heatmap`, `heatmapOpacity`, `heatmapRadius`) are all present
in `docs/_machine/formatter-schema.json` and cross-checked by
`scripts/check-formatter-coverage.py`. The recipe has not been
dispatched against a real netflow-indexed tenant in the
v1.7-prep development cycle (the lab tenant does not have a
populated NetFlow collector). A maintainer with write access
to a Splunk tenant ingesting NetFlow / sFlow / IPFIX data
should:

1. Confirm `Splunk_TA_netflow` is installed and at least one
   day of flow records has been indexed
   (`| metadata type=sourcetypes index=netflow`).
2. Run the panel SPL with `earliest=-24h@h, latest=now` and
   confirm at least 500 rows return with the six documented
   fields and a `weight` distribution that spans the 0-1
   range (a `| stats min(weight), max(weight), perc50(weight)`
   tail will surface degenerate cases).
3. Apply the formatter JSON in §4 to a Dashboard Studio map
   panel; zoom in and out; confirm the heatmap renders
   smoothly across continent → country → city zoom levels;
   confirm the gradient intensity tracks the actual
   geographic pressure landscape (top-3 cloud provider
   regions should dominate the visual signal for a typical
   enterprise).
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (e.g. "Splunk Enterprise 9.4 against
   Cisco ASR1000 NetFlow v9, 24h window, ~8200 unique
   destinations"), and submit a follow-up PR. The CI gate
   `scripts/check-recipe-schema.py` will accept the change
   without touching the schema.
