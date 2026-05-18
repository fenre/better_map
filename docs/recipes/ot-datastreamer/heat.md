---
schema_version: 1
id: ot-datastreamer--heat
source:
  id: ot-datastreamer
  display_name: "OT Datastreamer / Edge Hub (Modbus / OPC-UA / BACnet)"
  pattern: splunk-edge-hub
layer:
  id: heat
  display_name: Heatmap
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_oti"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "houston-plant-east-bldg-3"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "29.7604"
  - name: lon
    type: number
    example: "-95.3698"
  - name: site_id
    type: string
    example: "HOU-EAST"
  - name: event_count
    type: integer
    example: "742183"
  - name: weight
    type: number
    example: "0.81"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/ot-datastreamer/markers.md"
  - description: "splunk-edge-hub skill — Edge Hub indexes, sourcetypes, protocol-specific sources"
    path: "~/.cursor/skills/splunk-edge-hub/SKILL.md"
  - description: "splunk-oti-datastreamer skill — OTI Datastreamer ingest pipeline, HEC tuning"
    path: "~/.cursor/skills/splunk-oti-datastreamer/SKILL.md"
  - description: "splunk-edge-hub-protocols skill — Modbus, OPC-UA, MQTT, SNMP, BACnet protocol details"
    path: "~/.cursor/skills/splunk-edge-hub-protocols/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive collection, SIS read-only, Purdue boundary)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# OT Datastreamer / Edge Hub — heatmap

The aggregate-density complement to the
[ot-datastreamer/markers](./markers.md) recipe — same
`edge_hub_*` index union, same operator-maintained
`edge_hub_sites.csv` lookup for physical lat / lon, but
rendered as a weighted heatmap rather than discrete markers.
The heat layer surfaces **OT telemetry PRESSURE** as colour
intensity per geographic site: hot blobs indicate sites
producing the most events (high-protocol-count installs,
busy production lines, dense sensor populations); cool blobs
indicate quiet sites. This is the natural shape when the
dashboard question is "which of my industrial sites is
generating the most OT telemetry load?" rather than "which
individual Edge Hub appliance should I investigate?".

**OT safety boundary (this recipe is `ot_safety_relevant:
true`).** Like the companion markers recipe, this panel
rests on the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
contract: passive collection only, SIS-related signals
read-only, no write-back to Level-0/1/2 zones, no SOAR
actions wired to a Level-0/1/2 target. The heatmap form
is BROADER than markers (a blob covers an entire site, not
a per-appliance pin) but EVERY rule still applies — see
§6 Gotchas.

## 1. Source description

Same Splunk **Edge Hub / OTI Datastreamer** event union as
the companion [markers](./markers.md) recipe — the OR of
every `edge_hub_*` index plus the optional `bms` index,
joined against the operator-maintained `edge_hub_sites.csv`
lookup for physical lat / lon + Purdue level + safety
classification.

**Why heatmap for OT telemetry.** A markers view at world
zoom collapses dense site clusters (a multi-site refining
operator with 50 hubs per refinery × 20 refineries on three
continents) into overlapping circles that bury the "which
site is hottest" signal under visual clutter. A heatmap
aggregates the event-count weight into smooth Gaussian
blobs that read as "telemetry load" — the layer for **OT
operations leadership dashboards** and **NetOps capacity-
planning briefings** on where industrial telemetry actually
concentrates, NOT for per-hub liveness investigation (use
markers for that — markers carry the per-appliance
`last_seen_minutes_ago` liveness colouring that the heatmap
cannot represent).

**Typical sourcetype / index:** anything matching
`edge_hub_*` plus the `bms` index. The TA is
`Splunk_TA_oti`. The site lookup is operator-maintained.

## 2. SPL recipe

```spl
index=edge_hub_* OR index=bms earliest=-1h latest=now
| stats count AS event_count BY host
| lookup edge_hub_sites.csv host OUTPUT lat, lon, hub_name, site_id, zone_purdue_level, safety_related
| where isnotnull(lat) AND isnotnull(lon)
| stats sum(event_count) AS event_count, values(zone_purdue_level) AS purdue_levels, max(safety_related) AS site_has_safety_hub BY site_id, lat, lon
| eventstats max(event_count) AS max_event_count
| eval weight=round(log10(event_count + 1) / log10(max_event_count + 1), 2)
| eval id=site_id
| fields id, lat, lon, site_id, event_count, weight, purdue_levels, site_has_safety_hub
| sort - event_count
| head 2000
```

Why this exact shape, line by line:

- **`index=edge_hub_* OR index=bms earliest=-1h latest=now`**
  — same union and time window as the markers recipe. The
  1 h window balances liveness sensitivity (want recent
  data so the heatmap reflects current load, not 24 h
  averages) against query cost (every `edge_hub_*` index
  is a high-volume OT telemetry feed). Drop to 15 min for
  near-real-time pressure; widen to 24 h for a "which site
  generated the most telemetry today" capacity report.
- **`stats count AS event_count BY host`** — first
  aggregation: one row per Edge Hub appliance, with the
  raw event count. Identical to the markers recipe's
  first `stats` (just without the `latest(_time)` and
  `values(index)` columns the heatmap doesn't need).
- **`lookup edge_hub_sites.csv host OUTPUT lat, lon,
  hub_name, site_id, zone_purdue_level, safety_related`**
  — join against the operator-maintained site register.
  Returns the per-hub `lat`/`lon`, the human-readable
  `hub_name`, the `site_id` (operator-defined site
  grouping — `HOU-EAST`, `LON-NORTH`), the Purdue level
  classification, and the safety-related boolean. Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5, the `safety_related` column is read-only
  mirrored from the customer's Safety Requirements
  Specification (SRS) — never authored by Splunk or
  Better Map.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  hubs not in the site lookup (real hubs transmitting
  but with no recorded physical location — surface in a
  companion table panel for operator backfill, same as
  the markers recipe).
- **`stats sum(event_count) AS event_count, values(...)
  AS ..., max(safety_related) AS site_has_safety_hub BY
  site_id, lat, lon`** — **the heatmap-specific
  aggregation**. Collapses the per-hub rows to ONE row
  per site (`site_id` is the natural grouping). Sums the
  event counts so the heat blob weight reflects total
  site load, not per-hub load. `values(zone_purdue_level)`
  collects the set of Purdue levels active at the site
  (useful for popup display — a single site can host
  L1 PLCs, L2 SCADA, and L3 MES simultaneously).
  `max(safety_related)` (where `true=1, false=0`) is a
  boolean OR across the site's hubs — `1` if ANY hub
  at the site carries a safety-related signal, else `0`.
  This is critical for §6 Gotchas — the heatmap MUST
  carry the safety annotation per Rule 6.
- **`eventstats max(event_count) AS max_event_count`** —
  adds the global maximum site-level event count as a
  column on every row, so the next `eval` can normalise.
- **`eval weight=round(log10(event_count + 1) /
  log10(max_event_count + 1), 2)`** — **log-scale
  normalisation with `+1` numerical safety**. OT telemetry
  event counts span 4+ orders of magnitude (a low-volume
  remote pumping station might produce 1000 events/hour;
  a multi-line manufacturing plant might produce 10M
  events/hour). Linear normalisation would render every
  site but the heaviest as `weight ≈ 0.00`. The `+1`
  inside the `log10()` protects against `log10(0)` (a
  site with zero events would otherwise produce `-Inf`;
  the `+1` makes it `log10(1)=0`, the correct floor).
- **`eval id=site_id`** — adopt Better Map's canonical
  `id` alias. `site_id` is the natural identifier for a
  site-level heat blob; per-hub identifiers are
  collapsed by this point.
- **`sort - event_count`** — busiest sites first;
  combined with `head 2000` this gives the heatmap its
  busiest blobs first.
- **`head 2000`** — render budget. Even the largest
  multi-site OT operator deployments run ~200 sites
  globally; 2000 is heavily defensive for very large
  multi-national fleets (oil majors, global manufacturers,
  utility holding companies).

Note every `|` starts its own physical line per the SPL pipe-
per-line contract.

## 3. Expected fields

| field        | type    | example                       |
|--------------|---------|-------------------------------|
| id           | string  | HOU-EAST                      |
| lat          | number  | 29.7604                       |
| lon          | number  | -95.3698                      |
| site_id      | string  | HOU-EAST                      |
| event_count  | integer | 742183                        |
| weight       | number  | 0.81                          |

All six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`purdue_levels` and `site_has_safety_hub` also flow through
as feature properties but are popup metadata, not contract
fields.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "heatmap",
  "heatmapOpacity": 0.75,
  "heatmapRadius": 32
}
```

Why this specific config:

- **`pointRenderer: "heatmap"`** — explicit pin to the
  heatmap renderer. The `auto` renderer only switches to
  heatmap above ~200 features, so for smaller multi-site
  operators (10-50 sites globally) the recipe needs an
  explicit pin to force heat rendering.
- **`heatmapOpacity: 0.75`** — same opacity as the
  cim-authentication/heat recipe. At 1.0 the heat fully
  occludes the basemap labels; at 0.5 too washed out for
  low zoom; 0.75 is the sweet spot for site-name labels
  to survive the heat overlay.
- **`heatmapRadius: 32`** — **larger radius than IT
  recipes** (`24-28`) because OT site footprints are
  much larger than IT POPs. An industrial site
  (refinery, factory, port, mining operation) typically
  covers 1-10 km² of physical land area; a 32 px radius
  at world zoom merges all the hubs at one such site
  into a single readable blob. For single-region views
  (e.g. "show me only North American sites"), drop to
  20-24. For per-site detail zoom (e.g. "show me the
  hub-level distribution within one refinery"), this
  recipe is the WRONG layer — switch to the markers
  companion for per-hub granularity.
- **`weight` drives heat intensity automatically.** Same
  as every heat recipe — `dataFitness.js` auto-picks
  the `weight` field by name.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). The harness will need an Edge Hub event
generator plus a seeded `edge_hub_sites.csv` lookup — both
are out of scope for the v1.7 D5 deliverable. For OT
recipes specifically, the deferred verification path is to
dispatch against a customer pilot tenant (E4) under a non-
production hub or a recorded event fixture rather than a
synthetic generator, so that the Purdue-level and safety-
related annotations on the site lookup are real operator-
curated values rather than synthesised ones._

## 6. Gotchas

- **OT safety — heatmap MUST preserve the safety
  annotation.** Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6, every detection / panel that depends on a
  safety-related signal MUST carry the safety-dependent
  metadata. The SPL above does this via
  `max(safety_related) AS site_has_safety_hub` — a site
  with ANY safety-relevant hub will surface
  `site_has_safety_hub=1` in the popup. Dashboards
  rendering this heatmap MUST display the safety flag in
  the popup (or in a companion legend) so that operators
  know which heat blobs include SIS-related telemetry.
  NEVER strip the `safety_related` column from the
  lookup to "simplify" the panel — that violates Rule 2
  (NEVER disable, suppress, or filter a safety-related
  signal).
- **OT safety — passive collection ONLY.** Per Rule 1,
  every Edge Hub forwarding `safety_related=Y` signals
  MUST use a passive collection method. This recipe
  surfaces site-level event volumes; the constraint is
  enforced at the `Splunk_TA_oti` collector / Edge Hub
  configuration layer, NOT at the SPL or visualization
  layer.
- **OT safety — SOAR scope ends at the IT / IT-OT DMZ.**
  Per Rule 3, any SOAR playbook triggered FROM this
  panel MUST stop at the IT zone. A playbook may notify
  the OT operator (IT zone action — fine) but MUST NOT
  auto-issue any command to a Level-0/1/2 asset. A
  "hot site" detected here might mean "the PLC is
  thrashing under operator workload" — that's an OT
  engineering decision, NOT a SOAR target. Surface to
  the OT operator's own ticketing / SCADA HMI; do not
  auto-act.
- **OT safety — never let a safety hub disappear.** If
  a site has only safety-related hubs and they ALL stop
  transmitting, the site's `event_count` collapses to
  0 and the site drops below the heat layer's render
  threshold. This is correct behaviour for the visual
  layer (no events = no heat) but is CATASTROPHIC for
  OT operations — a silent SIS-related collector is a
  Rule 1 violation in the making (the customer needs to
  know IMMEDIATELY). Pair this heatmap with a
  companion alert / report panel that surfaces "sites
  in the lookup that produced ZERO events in the last
  hour, filtered to `safety_related=true`" — the
  heatmap visualises the loud sites; a separate alert
  watches for SAFETY-RELEVANT silent ones. The
  markers companion recipe surfaces silent hubs more
  naturally (their `last_seen_minutes_ago` colour
  goes red); this heatmap does not.
- **`edge_hub_sites.csv` schema — same as markers
  recipe.** See [ot-datastreamer/markers](./markers.md)
  §6 for the canonical schema. The heat recipe needs
  the same lookup with the additional `site_id`
  column populated (it's listed as OPTIONAL in the
  markers recipe schema; for THIS recipe it is
  REQUIRED — without `site_id` the per-site
  aggregation step has nothing to group by).
- **`site_id` granularity tuning.** The
  `BY site_id, lat, lon` aggregation assumes one
  `site_id` ↔ one `(lat, lon)` pair (every hub at the
  Houston East site shares the site's published
  coordinates). If your operator uses fine-grained
  `site_id` values (`HOU-EAST-REFINERY-CDU-1`,
  `HOU-EAST-REFINERY-CDU-2`) the heat blobs will be
  per-unit-process granular — useful for in-site
  capacity planning, not for global pressure
  visualisation. For the global view, normalise
  `site_id` to a coarser granularity first
  (`| eval site_id_global=mvindex(split(site_id,
  "-"), 0)."-".mvindex(split(site_id, "-"), 1)` →
  `HOU-EAST`).
- **Log-scale normalisation gotcha.** The `+1` inside
  `log10()` protects against zero-event sites (which
  shouldn't appear given the `index=edge_hub_*`
  filter, but defence-in-depth). For sites with truly
  uniform event-count distributions (e.g. all sites
  are pumping stations all running the same
  Modbus polling cadence), the log scale flattens the
  heatmap to near-uniform colour — switch to linear
  (`eval weight=round(event_count / max_event_count,
  2)`) for visually meaningful variance.
- **Index naming drift.** Same as the markers recipe.
  Some installs rename `edge_hub_*` to `oti_*` (older
  OTI Datastreamer versions) or `splunk_edge_*` (newer
  ones). Confirm with `| eventcount summarize=false
  index=* | search index=*edge* OR index=*oti*` and
  substitute the index wildcard in line 1.
- **Time range.** Hard-coded `earliest=-1h latest=now`.
  The 1 h window matches industrial telemetry cadences
  and gives the heatmap a meaningful pressure-of-
  recent-hour read. For "pressure across the workday"
  (8 h shift), widen to `-8h`. For "pressure across
  the last month for capacity reporting," widen to
  `-30d` AND switch the SPL to use a summary-indexed
  daily roll-up rather than raw `count` (the raw
  query at 30 d × 200 sites × ~1M events/hr would
  cost serious search-head CPU).
- **PII / GDPR posture — same as markers recipe.**
  Industrial telemetry is not PII, but site
  inventory data (site name, Purdue level, safety
  classification) CAN reveal sensitive customer
  architecture. Restrict via Splunk RBAC for
  regulated customers. Per ROADMAP §1a, Better Map
  never sends event data outside `splunkd:8089`.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented Edge Hub
index/sourcetype shape from
[`~/.cursor/skills/splunk-edge-hub/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/ot-datastreamer/heat.md)
and uses only Splunk built-ins plus the operator-
maintained site lookup pattern from the splunk-oti-
datastreamer skill. It has not been dispatched against
the v1.7-prep lab tenant in this PR because (a) the lab
tenant has no Edge Hub fleet and (b) per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, verification of an OT-safety-
relevant recipe SHOULD be done against a customer pilot
tenant (E4) with real operator-curated site annotations
rather than a synthetic generator. A maintainer with REST
auth to a tenant carrying `Splunk_TA_oti` AND a populated
`edge_hub_sites.csv` (including the `site_id` column)
should:

1. Confirm the site lookup is in place with `site_id`
   populated: `| inputlookup edge_hub_sites.csv | stats
   count BY site_id`.
2. Confirm Edge Hub data is flowing across multiple
   sites: `index=edge_hub_* earliest=-1h | stats count
   BY index`.
3. Run the recipe SPL and confirm the panel renders
   ONE heat blob per `site_id` (not per `host`) with
   meaningful weight variance across sites.
4. Cross-check that the popup carries
   `site_has_safety_hub` per Rule 6; confirm with the
   OT operator that the visible safety annotations
   match the customer's SRS.
5. Pair the panel with a "silent safety hubs" alert
   per the §6 Gotchas guidance — REQUIRED for any
   tenant with `safety_related=true` rows in the
   site lookup.
6. Update the frontmatter to `status: verified`, fill
   in `verified_against` (include `splunk_app:
   "Splunk_TA_oti"` and a non-PII tenant identifier),
   and submit a follow-up PR.
