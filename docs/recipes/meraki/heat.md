---
schema_version: 1
id: meraki--heat
source:
  id: meraki
  display_name: "Cisco Meraki (devices)"
  pattern: splunk-vendor-ta
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_cisco_meraki"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "Q2XX-XXXX-XXXX"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: device_count
    type: integer
    example: "47"
  - name: weight
    type: number
    example: "0.84"
    drives_formatter_option: heatmapOpacity
  - name: alerting_count
    type: integer
    example: "3"
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: false
references:
  - description: "Companion recipes — same source, different layers (markers + h3)"
    path: "docs/recipes/meraki/markers.md"
  - description: "cisco-meraki-ta-setup skill — TA install, indexes, account config, input types"
    path: "~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md"
  - description: "cisco-products skill — Meraki sourcetypes, fields, sample queries"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco Meraki (devices) — heatmap

The continuous-density complement to the
[meraki/markers](./markers.md) and [meraki/h3](./h3.md)
recipes — same `meraki:devices` inventory feed, same
`lng`-to-`lon` rename, but rendered as a smooth weighted
heatmap rather than discrete markers or hex cells. The
heat layer answers the strategic question **"where on the
map is my Meraki fleet visually densest as a smooth
pressure gradient?"** — useful for executive briefings
and leadership slide decks where a hexagonal grid would
read as "engineering detail" but a smooth heat gradient
reads as "regional concentration story." This is the right
layer for **leadership / account-planning** views of the
fleet that need to land in a non-technical audience, NOT
for per-device investigation (use markers) and NOT for
per-region drilldown (use h3).

## 1. Source description

Same `meraki:devices` sourcetype from the **Cisco Meraki
Add-on for Splunk** (`Splunk_TA_cisco_meraki`, Splunkbase
ID 5580) as the companion [markers](./markers.md) /
[h3](./h3.md) recipes — the TA polls the Meraki Dashboard
REST API on a configurable cadence and indexes one event
per registered MR (wireless AP) / MS (switch) / MX
(security appliance) / MV (camera) / MT (sensor) per
polling cycle. Each event carries the device's lat / lng
plus operational metadata.

**Why heatmap for Meraki devices.** A markers view of a
500-device fleet at world zoom collapses every site to a
single clustered marker; an H3 hexbin shows discrete
regional cells with clickable drilldown. Neither shape
reads as cleanly in an executive deck as a smooth heat
gradient that shows "the warm Atlantic-seaboard glow
fades west into the cool Pacific" without per-site labels
or hex grid artifacts. The heatmap collapses individual
device locations into pixel-density blobs that read as
"fleet concentration" — the natural layer for
**CFO / CRO briefings** on global footprint and growth
trajectory, where the per-device detail (markers) and
per-region rankings (H3) would distract from the
high-level narrative.

**Markers vs heatmap vs H3 hexbin — when to choose which.**
For Meraki specifically:
- **markers**: per-device investigation, NetOps daily
  triage — "show me each AP / switch with status."
- **H3 hexbin**: per-region NetOps planning — "rank
  regions by device count and let me drill into the
  leader."
- **heatmap** (this recipe): executive briefings,
  leadership decks — "show me fleet concentration as
  a smooth pressure gradient."

**One-time setup before this recipe will return data:**

```bash
# Install + configure the TA, create the meraki index,
# register the organization, and enable the devices
# input. See the cisco-meraki-ta-setup skill for the
# full prerequisite list.
bash skills/cisco-meraki-ta-setup/scripts/setup.sh
bash skills/cisco-meraki-ta-setup/scripts/configure_account.sh \
  --name "MY_ORG" \
  --api-key-file /tmp/meraki_api_key \
  --org-id "<org_id>" \
  --region global \
  --auto-inputs \
  --index meraki
```

The setup steps are documentation only — they are NOT
the panel SPL. `scripts/check-recipe-schema.py` exempts
§1 fences from the pipe-per-line gate; the panel SPL is
in §2 and that one is enforced.

**Typical sourcetype / index:** `sourcetype="meraki:devices"`,
`index=meraki` (both are the TA defaults; if your install
renames the index, substitute below).

## 2. SPL recipe

```spl
index=meraki sourcetype="meraki:devices" earliest=-1h latest=now
| dedup serial sortby - _time
| where isnotnull(lat) AND isnotnull(lng)
| eval is_alerting=if(status=="alerting", 1, 0)
| rename serial AS id, lng AS lon
| stats count AS device_count, sum(is_alerting) AS alerting_count BY lat, lon
| eventstats max(device_count) AS max_device_count
| eval weight=round(device_count / max_device_count, 2)
| eval id=lat."_".lon
| fields id, lat, lon, device_count, weight, alerting_count
| sort - device_count
| head 5000
```

Why this exact shape, line by line:

- **`index=meraki sourcetype="meraki:devices"`** — same
  TA defaults as the markers / h3 companions. If your
  install renamed the index, substitute.
- **`earliest=-1h latest=now`** — covers 5–6 polling
  cycles. The `dedup serial sortby -_time` on the next
  line keeps the freshest snapshot per device.
- **`| dedup serial sortby -_time`** — one row per
  device, taking the newest snapshot. Same canonical
  pattern as the markers / h3 companions.
- **`| where isnotnull(lat) AND isnotnull(lng)`** —
  drop devices not yet placed on the Meraki Dashboard
  map.
- **`| eval is_alerting=if(status=="alerting", 1, 0)`**
  — pre-compute the alerting flag as an integer so the
  next `stats` can SUM it. This feeds `alerting_count`
  into the per-site popup so the operator can see
  "this hot heat blob has 47 devices, 3 alerting" on
  hover. (The heatmap doesn't drilldown per blob the
  way H3 hexbin drills down per cell, but the
  per-aggregated-row popup still surfaces the count.)
- **`| rename serial AS id, lng AS lon`** — adopt
  Better Map's canonical aliases. Same `lng` → `lon`
  gotcha as the markers / h3 companions.
- **`| stats count AS device_count, sum(is_alerting)
  AS alerting_count BY lat, lon`** — **aggregate per
  unique site coordinate**. This is the key difference
  vs the h3 recipe (which keeps `BY id, lat, lon` with
  `value=1` per row): the heatmap layer pre-aggregates
  to one row per site BEFORE the layer renders, so
  multiple devices at the same building location
  contribute a single weighted heat point with
  proportional intensity. Without this stats stage,
  a 50-device office would contribute 50 OVERLAPPING
  heat points at the exact same pixel — the heatmap
  renderer would multiply their additive intensity but
  the `weight` normalisation (next line) would not
  scale correctly.
- **`| eventstats max(device_count) AS
  max_device_count`** — adds the global maximum as a
  column on every row, so the next `eval` can
  normalise. `eventstats` (not `stats`) keeps the
  per-site rows and only ADDS the new column.
- **`| eval weight=round(device_count /
  max_device_count, 2)`** — normalise to a `[0, 1]`
  band so the heat layer's weight property has a
  predictable scale across panels. Rounded to 2
  decimal places for stable rendering. See §6 Gotchas
  for the log-scale alternative when one site dwarfs
  the rest by orders of magnitude.
- **`| eval id=lat."_".lon`** — adopt Better Map's
  canonical `id` alias. Each row is now a site-
  aggregate (not a per-device row), so the natural
  `id` is the site coordinate string. This is a
  deliberate departure from the markers / h3 recipes
  (which use the device serial) — the heatmap operates
  at site granularity, so the id reflects that.
- **`| head 5000`** — render budget. After site-
  aggregation, 5000 rows represent 5000 distinct
  building / site locations — vastly more than any
  enterprise Meraki deployment. The heat layer scales
  to thousands of points cleanly.

## 3. Expected fields

| field          | type    | example        |
|----------------|---------|----------------|
| id             | string  | Q2XX-XXXX-XXXX |
| lat            | number  | 37.7749        |
| lon            | number  | -122.4194      |
| device_count   | integer | 47             |
| weight         | number  | 0.84           |
| alerting_count | integer | 3              |

All six fields appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `weight` is the
heat-layer-required normalised intensity; `device_count`
and `alerting_count` are carried for the per-site popup.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 28
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer only switches
  to heatmap above ~200 features; pinning makes the
  panel intent visible and stable even for smaller
  deployments.
- **`heatmapOpacity: 0.75`** — same value as the
  cim-authentication/heat recipe. At 1.0 the heat blobs
  fully occlude the underlying basemap labels; at 0.5
  the heat is too washed out for a leadership deck.
  0.75 lets the executive audience read both the heat
  colour ramp AND the city / region labels underneath
  at globe zoom — critical for "is that Boston or NYC
  density?" at-a-glance reading in a slide.
- **`heatmapRadius: 28`** — pixel radius at low zoom.
  The formatter-schema documents the range as 2-64 px.
  28 px is slightly larger than the cim-authentication/
  heat recipe's 24 (because Meraki sites are typically
  more sparsely distributed than identity-attack
  source IPs, so the blobs need a wider radius to
  merge into a regional gradient at world zoom). For a
  single-country or single-state Meraki view, drop to
  16-20.
- **`weight` drives heat intensity automatically.** The
  heat layer renderer auto-picks the `weight` field by
  name (per Better Map's `dataFitness.js` field
  aliasing). The SPL above already names the
  normalised intensity column `weight`; no further
  formatter config needed.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce the panel by
pasting the SPL above into a Dashboard Studio map panel
with Better Map as the visualization, applying the
formatter JSON in §4, and confirming that a multi-site
fleet renders as a smooth gradient with bright spots over
the HQ / major-office regions and faint glow over branch
offices. The visual sanity check: a one-region deployment
should NOT render as a heatmap (all weight values
normalize to 1.0 against a single max, producing a flat-
colour blob — switch to markers for single-region fleets)._

## 6. Gotchas

- **`lng` vs `lon` is still the #1 mistake.** Same
  trap as the markers / h3 companions — Meraki's REST
  API and the TA emit the longitude field as **`lng`**
  (three letters). Better Map's auto-detect only looks
  for `lon` / `longitude` / `long`. Forget the
  `rename lng AS lon` and the panel renders nothing.
- **`Splunk_TA_cisco_meraki` must be installed AND the
  `devices` input enabled.** This is NOT a vanilla-
  Splunk recipe — the TA is mandatory. The
  [`cisco-meraki-ta-setup` skill](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-app-packaging.mdc)
  documents the complete install + configure flow.
- **Heatmap vs H3 hexbin vs markers — when to choose
  which.** See §1 above. The summary: heatmap is the
  layer for SMOOTH-GRADIENT executive narratives; H3
  hexbin is the layer for PER-REGION drilldown; markers
  is the layer for PER-DEVICE investigation. All three
  can coexist via the BM-CT-1 layer contract in a
  multi-layer dashboard with the operator toggling the
  layer that matches the current question.
- **Site-aggregation `stats BY lat, lon` is mandatory
  for heatmap.** This is the recipe's biggest
  divergence from the markers / h3 companions. Heatmap
  intensity is additive per pixel; without site
  aggregation, a 50-device office produces 50
  overlapping heat points at the same exact lat/lon
  and the heatmap renderer renders them as a single
  saturated pixel instead of a 50× weighted blob. The
  `stats` collapses to one row per unique site
  coordinate so each site contributes a SINGLE
  weighted heat point.
- **`weight` normalisation gotcha.** The normalisation
  uses the SINGLE max device_count across the panel
  window. If one HQ has 500 devices and every branch
  office has 5, every branch office's `weight` rounds
  to 0.01 and renders as invisible. For multi-site
  heatmaps where the device-count distribution spans
  orders of magnitude, replace the `eval weight=...`
  with `eval weight=round(log10(device_count) /
  log10(max_device_count), 2)` (log-scale
  normalisation). This is the same trap the
  cim-authentication/heat and splunk-stream/heat
  recipes flag and solve the same way.
- **Single-site fleets render badly as heatmap.** A
  one-region deployment normalises every weight to
  1.0 against itself and produces a flat-colour blob
  with no gradient — defeats the heatmap's purpose.
  Use markers instead for single-region fleets;
  promote to heatmap only when the fleet spans ≥3
  distinct regions.
- **Time range.** The recipe hard-codes
  `earliest=-1h latest=now` to keep the dedup window
  small and fast. Replace with `earliest=$earliest$
  latest=$latest$` once you wire the recipe into a
  dashboard with a time-range input — but constrain
  the upper bound: a 30-day dedup is expensive AND
  not meaningful for an "is this fleet here NOW?"
  panel.
- **Polling cadence vs panel auto-refresh.** Same as
  the markers / h3 companions — the `devices` input
  polls every 600 s by default. A panel auto-
  refreshing every 30 s adds load without value. Tune
  panel refresh to 10 min for a better signal-to-load
  ratio.
- **No CIM mapping.** Same as the markers / h3
  companions — `meraki:devices` is inventory data,
  not an event-stream sourcetype. The Cisco Meraki TA
  maps OTHER sourcetypes to CIM, but device inventory
  has no CIM home.
- **MV camera privacy flag.** Same as the markers / h3
  companions — some EU deployments hide MV camera
  locations from the REST API for GDPR reasons. MV
  serials simply won't appear in the heat layer.
- **PII / GDPR posture.** This heatmap recipe is
  generally LOWER-risk than the markers companion
  because the smooth gradient collapses identifying
  device names ("AP - John Smith desk") into anonymous
  per-site weighted intensity. The popup still shows
  the site-level aggregates (`device_count`,
  `alerting_count`), not per-device labels, so
  embedded-PII names do not leak through the heat
  panel. The heatmap is the right layer choice when
  the panel must be shareable with audiences that
  shouldn't see per-device naming.
- **`alerting_count` is carried but does NOT drive
  the heat intensity.** The heat layer renders by
  `weight` (which is normalised `device_count`), not
  by `alerting_count`. To DRIVE the heat colour by
  alerting count instead (a "where in the world are
  my Meraki devices ON FIRE right now?" panel),
  replace `eval weight=round(device_count /
  max_device_count, 2)` with
  `eval weight=round(alerting_count /
  max_alerting_count, 2)` and adjust the `eventstats`
  to match (`max(alerting_count) AS max_alerting_count`).
- **No OT safety dependency.** Same as the markers /
  h3 companions — Meraki devices are IT networking
  gear; MT sensors are IoT but not SIS-related. If
  your tenant integrates Meraki with an OT-zone
  monitoring program, route THOSE MT sensors to a
  dedicated `ot-datastreamer` recipe (per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6) rather than mixing them with the corporate
  Meraki inventory heat shown on this panel.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented
`meraki:devices` field shape from
[`~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-app-packaging.mdc),
and reuses the same proven `dedup serial sortby -_time`
+ `lng → lon` + `head 5000` pipeline as the markers / h3
companions plus the canonical `eventstats max + eval
normalise` heat-weight pattern from cim-authentication/
heat, splunk-stream/heat, and netflow-sflow-ipfix/heat.
It has not been dispatched against the v1.7-prep lab
tenant in this PR because non-interactive admin auth is
not present in the agent workspace and the lab tenant
does not currently have a Meraki organization
registered. A maintainer with REST auth to a Splunk
tenant that HAS `Splunk_TA_cisco_meraki` installed and a
configured multi-region Meraki account should:

1. Confirm `index=meraki sourcetype="meraki:devices"
   earliest=-1h | dedup serial sortby -_time | where
   isnotnull(lat) AND isnotnull(lng) | stats dc(lat)
   AS distinct_sites` returns ≥ 3 distinct sites
   (heatmap is meaningless for single-site fleets;
   switch to markers in that case).
2. Run the recipe SPL and confirm the panel renders a
   smooth gradient with bright spots over the largest
   sites (HQ, major datacenters) and faint glow over
   smaller branch offices.
3. Toggle the panel between heatmap (this recipe),
   H3 hexbin (h3 companion), and markers (markers
   companion) and confirm all three layers tell the
   same story at different abstraction levels.
4. Tune `heatmapRadius` to match the geographic spread
   of the fleet (a global fleet wants 28-32; a single-
   country fleet wants 16-20).
5. If the fleet is dominated by one giant HQ that
   dwarfs every branch (>10× the device count),
   switch the normalisation to log-scale per the
   Gotchas section.
6. Update the frontmatter to `status: verified`, fill
   in `verified_against` (include `splunk_app:
   "Splunk_TA_cisco_meraki"`), and submit a follow-up
   PR.
