---
schema_version: 1
id: cyber-vision--markers
source:
  id: cyber-vision
  display_name: "Cisco Cyber Vision (components + vulnerabilities)"
  pattern: splunk-vendor-ta
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "TA-cisco-cybervision"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "PLC-FLOOR3-A02"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "29.7604"
  - name: lon
    type: number
    example: "-95.3698"
  - name: asset_name
    type: string
    example: "PLC-FLOOR3-A02"
  - name: vendor
    type: string
    example: "Siemens"
  - name: zone_purdue_level
    type: string
    example: "L1"
  - name: max_cvss
    type: number
    example: "8.4"
    drives_formatter_option: markerColor
references:
  - description: "cisco-products skill — Cisco Cyber Vision sourcetypes, components/flows/events/vulnerabilities"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "cisco-splunk-integration skill — Cyber Vision passive DPI, API endpoints, integration patterns"
    path: "~/.cursor/skills/cisco-splunk-integration/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive DPI is the reference design, Rule 1)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
required_formatter_options:
  - pointRenderer
  - idField
  - markerColor
ot_safety_relevant: true
---

# Cisco Cyber Vision — markers

Render every OT asset that Cisco Cyber Vision has discovered
via passive DPI as a marker, positioned at its physical site
(plant / cell / room), sized by event volume, coloured by the
maximum CVSS score of any unpatched vulnerability tagged to
that asset. The canonical "where are my OT assets and which
ones are most exposed?" OT-NetOps + OT-SecOps overview panel
— the sister panel to the
[ot-datastreamer/markers](../ot-datastreamer/markers.md) recipe
(which shows the COLLECTORS) but here showing the ASSETS those
collectors observe. Strict adherence to the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
boundary: Cyber Vision is the **reference passive-DPI design**
per Rule 1; this recipe surfaces its discoveries without ever
querying the OT zone.

## 1. Source description

**Cisco Cyber Vision** is a passive deep-packet-inspection
platform for OT networks. A Cyber Vision sensor mirrors traffic
from an OT-zone SPAN port (or sits on a network TAP), decodes
industrial protocols (Modbus, EtherNet/IP, PROFINET, S7, DNP3,
OPC UA, BACnet, IEC 61850, ...), and emits four streams of
metadata to the Cyber Vision Center: components (discovered
assets), flows (observed conversations), events (security
findings), and vulnerabilities (CVE matches against the asset
inventory). The Center forwards all four streams to Splunk via
the `TA-cisco-cybervision` add-on, which lands them under four
sourcetypes:

| Sourcetype | Content | Key fields |
|---|---|---|
| `cisco:cybervision:components` | Asset inventory | `asset_id`, `asset_name`, `asset_vendor`, `asset_model`, `mac`, `ip`, `protocols` |
| `cisco:cybervision:flows` | Network flows | `src_ip`, `dest_ip`, `protocol`, `bytes` |
| `cisco:cybervision:events` | Security events | `event_type`, `severity`, `src_asset`, `dest_asset` |
| `cisco:cybervision:vulnerabilities` | CVE data | `cve_id`, `cvss_score`, `asset_id` |

This recipe is the **asset-centric overview**: it queries
`components` over a 24 h window (dedup by `asset_id`), joins
against the `vulnerabilities` sourcetype for the maximum CVSS
score per asset, counts the recent events on each asset, and
joins against an operator-maintained site lookup
(`cybervision_sites.csv`) for physical lat / lon coordinates +
Purdue level + safety classification. The recipe is `ot_safety_relevant: true` because OT-zone assets are by definition
safety-relevant — see §6 Gotchas for the full safety contract.

**Typical sourcetype / index:** `index=cybervision`
sourcetype-prefixed as `cisco:cybervision:*`. The TA is
`TA-cisco-cybervision`. The site lookup is operator-maintained
(no automated way to derive plant-floor coordinates from the
network metadata Cyber Vision exposes).

## 2. SPL recipe

```spl
index=cybervision sourcetype="cisco:cybervision:components" earliest=-24h latest=now
| dedup asset_id sortby - _time
| rename asset_id AS id, asset_name AS asset_name, asset_vendor AS vendor, asset_model AS model
| join type=left id [
    search index=cybervision sourcetype="cisco:cybervision:vulnerabilities" earliest=-24h latest=now
    | stats max(cvss_score) AS max_cvss, dc(cve_id) AS cve_count BY asset_id
    | rename asset_id AS id
  ]
| join type=left id [
    search index=cybervision sourcetype="cisco:cybervision:events" earliest=-24h latest=now
    | stats count AS event_count BY src_asset
    | rename src_asset AS id
  ]
| fillnull value=0 max_cvss cve_count event_count
| lookup cybervision_sites.csv asset_id AS id OUTPUT lat, lon, zone_purdue_level, safety_related, site_name
| where isnotnull(lat) AND isnotnull(lon)
| eval max_cvss=round(max_cvss, 1)
| fields id, lat, lon, asset_name, vendor, model, zone_purdue_level, safety_related, max_cvss, cve_count, event_count, site_name
| sort - max_cvss, - cve_count, asset_name
| head 1000
```

Why this exact shape, line by line:

- **`index=cybervision sourcetype="cisco:cybervision:components"
  earliest=-24h latest=now`** — components stream over 24 h.
  Cyber Vision Center re-publishes the asset inventory
  periodically (default every 5 min for changed records); 24 h
  guarantees every active asset is in the sample, even those
  re-published only on changes.
- **`dedup asset_id sortby - _time`** — one row per asset
  (the freshest record). Cyber Vision re-publishes the entire
  asset record on changes, so the freshest row carries the
  current vendor / model / firmware / IP / MAC.
- **`rename asset_id AS id, ...`** — adopt Better Map's `id`
  alias up front. `asset_name` and `vendor`/`model` are
  preserved for the popup.
- **First `join` subsearch (vulnerabilities)** — count CVEs
  per asset and pick the worst CVSS. Bounded to the same
  24 h window. `max(cvss_score)` drives the colour ramp;
  `dc(cve_id)` gives the popup the count. Properly split
  across physical lines for the SPL pipe-per-line contract.
- **Second `join` subsearch (events)** — count events where
  this asset was the source. The events stream is by default
  much higher cardinality than vulnerabilities; an asset
  with many events is "noisy" (could be benign or an actual
  protocol anomaly — surfaced for operator triage). Also
  bounded to 24 h and split for pipe-per-line.
- **`fillnull value=0 max_cvss cve_count event_count`** —
  assets with no CVEs and no events get NULL from both
  joins; promote NULL to 0 so the popup reads "0 CVEs · 0
  events" instead of blanks.
- **`lookup cybervision_sites.csv asset_id AS id OUTPUT lat,
  lon, zone_purdue_level, safety_related, site_name`** — THE
  critical line. The site lookup is operator-maintained and
  ships nothing by default; the contract is documented in
  §6 Gotchas. `zone_purdue_level` and `safety_related` are
  the OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5 — read-only mirrored from the customer's Safety
  Requirements Specification.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  assets without site registration. Surface in a companion
  table panel for the OT-asset team to backfill.
- **`eval max_cvss=round(max_cvss, 1)`** — round to one
  decimal for display.
- **`sort - max_cvss, - cve_count, asset_name`** —
  highest-severity assets first; secondary sort by CVE
  count and asset name for deterministic rendering.
- **`head 1000`** — render budget. Large OT installs
  typically discover 500-2000 assets per Cyber Vision
  sensor; 1000 covers a fleet of 4-5 sensors at a
  consolidated SOC view.

## 3. Expected fields

| field              | type    | example         |
|--------------------|---------|-----------------|
| id                 | string  | PLC-FLOOR3-A02  |
| lat                | number  | 29.7604         |
| lon                | number  | -95.3698        |
| asset_name         | string  | PLC-FLOOR3-A02  |
| vendor             | string  | Siemens         |
| zone_purdue_level  | string  | L1              |
| max_cvss           | number  | 8.4             |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`. `model`,
`safety_related`, `cve_count`, `event_count`, and `site_name`
also flow through as feature properties for the popup.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#1f77b4"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — OT assets cluster
  geographically by site / cell / room (one site has dozens
  to hundreds; a global fleet has thousands across sites).
  Clustering collapses to per-site clusters at world zoom,
  fans out at site zoom.
- **`idField: "id"`** — explicit override. Auto-detect
  would prefer either `asset_id` (the renamed `id`,
  identical content) or `asset_name` (the human-readable
  display); pinning to `id` keeps drilldown URLs stable
  against any future asset-name changes.
- **`markerColor: "#1f77b4"`** — Tableau muted-blue
  default. Cyber Vision assets are NOT problems by
  themselves; the problem is when an asset's `max_cvss`
  exceeds a threshold (a `palette` ramp by `max_cvss`
  surfaces this). The recipe deliberately matches the
  [ot-datastreamer/markers](../ot-datastreamer/markers.md)
  baseline colour so an operator viewing both panels side
  by side reads them as "OT infrastructure" first,
  "alerting layer" second.
- **`asset_name`, `vendor`, `zone_purdue_level`,
  `safety_related`, `max_cvss`, `cve_count`, `event_count`,
  `site_name` flow through automatically** as feature
  properties for the popup (`enablePopups: true` is the
  default).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). For OT recipes specifically, the deferred verification path
is to dispatch against a customer pilot tenant (E4) under a
non-production Cyber Vision sensor rather than a synthetic
generator. The site lookup must be authored by the customer's
OT-asset team — Better Map ships nothing._

## 6. Gotchas

- **OT safety — passive DPI is the REFERENCE DESIGN.** Cyber
  Vision is explicitly named in
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 as the reference design for passive OT collection.
  This recipe consumes Cyber Vision's already-passive
  metadata stream — it does NOT itself probe the OT zone in
  any way. Every field in the result set is derived from
  Cisco-validated passive DPI.
- **OT safety — every asset row is read-only mirrored from
  the customer SRS.** Per Rule 5, the `safety_related`
  column in `cybervision_sites.csv` is a copy of the
  customer-supplied SIS-asset register, NEVER authored by
  VISTA. If the Safety Annex (per the OT-safety gate) is
  missing for any `safety_related=Y` row, STOP and get the
  customer's OT engineering team to author the SRS first.
- **OT safety — never disable / suppress / filter a Cyber
  Vision event.** Per Rule 2, even if the events stream is
  noisy, do NOT filter at the props/transforms layer —
  filter at the PANEL layer if needed (`NOT
  safety_related="true"`), and record the panel-level
  filtering decision in the Built Content Catalog with OT
  engineering approval.
- **OT safety — SOAR action scope.** Per Rule 3, any SOAR
  playbook triggered by THIS panel (e.g. "high-CVSS asset
  → page on-call") must keep its containment actions in
  the IT zone. Notify the OT operator; do NOT auto-issue
  any command to the asset itself.
- **`cybervision_sites.csv` schema (REQUIRED).** Operator-
  maintained CSV lookup, no defaults shipped:

  | column | type | required | description |
  |---|---|:-:|---|
  | `asset_id` | string | yes | Cyber Vision component id — the join key |
  | `lat` | number | yes | WGS-84 decimal latitude of physical install |
  | `lon` | number | yes | WGS-84 decimal longitude of physical install |
  | `zone_purdue_level` | string | yes | `L0`, `L1`, `L2`, `L3`, `L3.5` (DMZ), `L4`, `L5` per asset-register-template |
  | `safety_related` | boolean | yes | `true` if the asset is in the SIS scope; `false` otherwise |
  | `site_name` | string | no | Human-readable site grouping (`HOU-EAST`, `LON-NORTH`) for cross-panel filtering |

  When a new asset is discovered by Cyber Vision but is not
  yet in the site lookup, it's correctly filtered out by
  `where isnotnull(lat)` — surface in a companion table
  panel for the OT-asset team to backfill.
- **`asset_id` cardinality drift.** Cyber Vision sometimes
  re-issues `asset_id` after a sensor restart (rare, but
  documented in the Cyber Vision admin guide). Cross-check
  with `asset_mac` if drift is suspected — MAC addresses
  are stable across sensor restarts. If your tenant has
  experienced `asset_id` drift, key the site lookup on
  `asset_mac` instead and join with `OUTPUT lat, lon` from
  the MAC join.
- **CVSS join cardinality.** A single asset can carry many
  CVEs (especially older PLCs with unpatched firmware).
  `max(cvss_score)` is intentional — we surface the WORST
  per asset. Surface the COUNT (`cve_count`) in the popup
  so the operator can distinguish "one critical CVE" from
  "dozens of medium CVEs that aggregate to the same risk".
- **Events stream noise.** The events stream is volume-
  heavy (every protocol anomaly, every new-MAC discovery,
  every flow-pattern change). The `event_count` figure
  isn't a quality indicator; it's a "is this asset doing
  things?" indicator. A quiet asset with `event_count=0`
  is normal; a chatty asset with `event_count=1000` may
  be a legitimately-active PLC or may be a Cyber Vision
  false-positive. Use the popup as triage entry, not as
  alert source.
- **Time range.** Hard-coded `earliest=-24h latest=now`.
  Cyber Vision's components stream re-publishes only on
  change; 24 h covers slow-changing inventory while keeping
  the events and vulnerabilities joins bounded to a sane
  window. Avoid narrowing below 1 h (assets that haven't
  re-published in the window drop off the map).
- **PII / GDPR posture.** Asset names embed plant-floor
  semantics (`PLC-FLOOR3-PAINT-A02`) — REGULATED information
  in some jurisdictions. Restrict via Splunk RBAC on the
  `cybervision` index for audiences without "see OT asset
  naming" authorisation. Per ROADMAP §1a, Better Map never
  sends event data outside `splunkd:8089`.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented Cyber Vision sourcetype shape
from [`~/.cursor/skills/cisco-products/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/cyber-vision/markers.md)
and uses only Splunk built-ins plus the operator-maintained site
lookup pattern that mirrors the `ot-datastreamer/markers` recipe.
It has not been dispatched against the v1.7-prep lab tenant
because (a) the lab has no Cyber Vision Center and (b) per the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
Safety Annex contract, OT-safety-relevant recipes should be
verified against a customer pilot tenant (E4) with real
operator-curated annotations. A maintainer with REST auth to a
tenant carrying `TA-cisco-cybervision` AND a populated
`cybervision_sites.csv` should:

1. Confirm site lookup is in place:
   `| inputlookup cybervision_sites.csv | stats count`.
2. Confirm Cyber Vision components are flowing:
   `index=cybervision sourcetype="cisco:cybervision:components"
   earliest=-24h | stats dc(asset_id)`.
3. Run the recipe SPL and confirm the panel renders one
   marker per registered + discovered asset.
4. Cross-check the `safety_related` column values against the
   customer's Safety Requirements Specification — discrepancies
   must be resolved with OT engineering BEFORE the panel goes
   into a customer dashboard.
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "TA-cisco-cybervision"` and a non-PII tenant identifier),
   and submit a follow-up PR.
