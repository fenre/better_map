---
schema_version: 1
id: cyber-vision--heat
source:
  id: cyber-vision
  display_name: "Cisco Cyber Vision (components + vulnerabilities)"
  pattern: splunk-vendor-ta
layer:
  id: heat
  display_name: Heatmap
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
  - name: max_cvss
    type: number
    example: "9.8"
  - name: cve_count
    type: integer
    example: "12"
  - name: safety_related
    type: boolean
    example: "true"
  - name: weight
    type: number
    example: "0.94"
    drives_formatter_option: heatmapOpacity
required_formatter_options:
  - pointRenderer
  - heatmapOpacity
  - heatmapRadius
ot_safety_relevant: true
references:
  - description: "Companion recipe — same source, different layer (markers)"
    path: "docs/recipes/cyber-vision/markers.md"
  - description: "Companion recipe — same source, different layer (H3 hexbin)"
    path: "docs/recipes/cyber-vision/h3.md"
  - description: "cisco-products skill — Cisco Cyber Vision sourcetypes, components/flows/events/vulnerabilities"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "cisco-splunk-integration skill — Cyber Vision passive DPI, API endpoints, integration patterns"
    path: "~/.cursor/skills/cisco-splunk-integration/SKILL.md"
  - description: "Cursor rule — ot-safety.mdc (passive DPI is the reference design, Rule 1)"
    path: ".cursor/rules/ot-safety.mdc"
  - description: "Layer reference — heat"
    path: "docs/reference/layers.md"
  - description: "Formatter schema — heatmapOpacity, heatmapRadius"
    path: "docs/_machine/formatter-schema.json"
---

# Cisco Cyber Vision — heatmap

The aggregate-density complement to the
[cyber-vision/markers](./markers.md) and
[cyber-vision/h3](./h3.md) recipes — same Cyber Vision
passive-DPI metadata stream (components +
vulnerabilities), same operator-maintained
`cybervision_sites.csv` for physical lat / lon, but
rendered as a weighted heatmap rather than discrete
markers or hexagonal cells. The heat layer surfaces
**OT vulnerability PRESSURE** as smooth colour intensity:
hot blobs indicate plant regions with the highest
aggregate CVE exposure; cool blobs indicate well-patched
or sparsely-asset facilities. The natural shape when the
plant-leadership / CISO question is "where across our
plant footprint is OT vulnerability concentrating right
now?" rather than "show me each PLC individually"
(markers) or "which plant SITE is hottest?" (H3).

This recipe completes the **cyber-vision source-row
triplet** (markers + h3 + heat) shipped across waves 4b,
11, and 14.

Strict adherence to the
[`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
contract is mandatory because Cyber Vision data
inherently represents Level-2 / Level-3 OT assets and
because the heatmap layer's smoothing makes
safety-related anomalies HARDER to disambiguate than
markers or H3 — see §6 for the OT-safety call-outs that
matter MOST for this layer.

## 1. Source description

Same **Cisco Cyber Vision** data home as the
[cyber-vision/markers](./markers.md) and
[cyber-vision/h3](./h3.md) companions — the passive-DPI
metadata stream from a Cyber Vision Center, ingested via
`TA-cisco-cybervision` and routed to
`index=cybervision` under `sourcetype="cisco:cybervision:
components"` (asset inventory) and
`sourcetype="cisco:cybervision:vulnerabilities"` (CVE
exposure). See the markers companion §1 for the full
Cyber Vision primer and the passive-DPI / read-only
acquisition contract.

**Why heatmap for Cyber Vision CVE pressure.** The
markers view is the right shape for OT-engineering
investigation ("which specific PLC has the worst CVE?")
and the H3 view is the right shape for plant-leadership
site comparison ("which sites have the highest CVE
density?"). A heatmap aggregates per-asset CVE pressure
into smooth Gaussian blobs that read as **regional /
campus-wide CVE pressure** — the layer for **CISO /
plant-leadership executive briefings** ("show me where
our OT CVE exposure is concentrating across our global
plant footprint"), **board-deck slides on OT cyber
risk** ("here's our OT vulnerability distribution"), and
**vulnerability-management sprint planning** ("the
Houston metro complex is now our hottest CVE region —
prioritise patching"), NOT for per-asset triage (use
markers) or per-site rollup (use H3).

**Heatmap vs markers vs H3 for Cyber Vision — when to choose which.**

| Layer | Best for | Why |
|---|---|---|
| `markers` ([cyber-vision/markers](./markers.md)) | OT-engineering investigation, IR | Each asset individually clickable with full CVE / Purdue-level / safety context |
| `h3` ([cyber-vision/h3](./h3.md)) | Plant-leadership site review, multi-site consolidation | Per-site asset density / CVE rollup with stable hex cells |
| `heat` (this recipe) | CISO / board briefings, vulnerability-management sprint planning | Smooth regional CVE-pressure landscape, intentionally aggregated |

All three coexist in the same dashboard via Better Map's
BM-CT-1 layer contract (`setEnabled` / `isEnabled` /
`reset`) toggled from dashboard inputs — a single
OT-cyber dashboard can carry the engineering view
(markers default), the site-rollup view (H3), and the
leadership view (heat) on the same data.

**Typical sourcetype / index:** `index=cybervision`
sourcetype-prefixed as `cisco:cybervision:*`. The TA is
`TA-cisco-cybervision`. The site lookup
(`cybervision_sites.csv`) is operator-maintained, no
defaults shipped — same contract as the markers / H3
siblings. See §6 Gotchas for the schema.

## 2. SPL recipe

```spl
index=cybervision sourcetype="cisco:cybervision:components" earliest=-24h latest=now
| dedup asset_id sortby - _time
| rename asset_id AS id
| join type=left id [
    search index=cybervision sourcetype="cisco:cybervision:vulnerabilities" earliest=-24h latest=now
    | stats max(cvss_score) AS max_cvss, dc(cve_id) AS cve_count BY asset_id
    | rename asset_id AS id
  ]
| fillnull value=0 max_cvss cve_count
| lookup cybervision_sites.csv asset_id AS id OUTPUT lat, lon, zone_purdue_level, safety_related, site_name
| where isnotnull(lat) AND isnotnull(lon)
| eval max_cvss=round(max_cvss, 1)
| eval cve_intensity=max_cvss * cve_count
| eventstats max(cve_intensity) AS max_intensity
| eval weight=round(log10(cve_intensity + 1) / log10(max_intensity + 1), 2)
| fields id, lat, lon, max_cvss, cve_count, safety_related, zone_purdue_level, site_name, weight
| sort - cve_intensity, id
| head 5000
```

Why this exact shape, line by line:

- **`index=cybervision sourcetype="cisco:cybervision:
  components" earliest=-24h latest=now`** — components
  stream over 24 h, identical to the markers / H3
  siblings.
- **`dedup asset_id sortby - _time`** — one row per
  asset (the freshest record). Same dedup as the markers
  / H3 companions.
- **`rename asset_id AS id`** — adopt Better Map's
  canonical `id` alias up front.
- **`join` subsearch (vulnerabilities)** — count CVEs
  per asset and pick the worst CVSS. Bounded to the
  same 24 h window. Identical to the H3 sibling. Heat-
  layer aggregation needs BOTH the per-asset CVE count
  and the per-asset worst CVSS so the `cve_intensity`
  product below can produce a meaningful "CVE pressure"
  metric.
- **`fillnull value=0 max_cvss cve_count`** — assets
  with no CVEs get NULL from the join; promote to 0 so
  the `cve_intensity` product is well-defined for
  CVE-clean assets (they get weight 0 in the heatmap and
  effectively don't contribute to any blob).
- **`lookup cybervision_sites.csv ...`** — THE critical
  line, identical to the markers / H3 siblings. The site
  lookup is operator-maintained (no defaults shipped);
  the contract is documented in §6 Gotchas.
  `zone_purdue_level` and `safety_related` are the
  OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5 — read-only mirrored from the customer's
  Safety Requirements Specification.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  assets without site registration. Same defensive filter
  as the markers / H3 companions.
- **`eval max_cvss=round(max_cvss, 1)`** — round to one
  decimal for display.
- **`eval cve_intensity=max_cvss * cve_count`** — **CVE
  pressure metric**. One asset with one CVSS-10 CVE
  produces `intensity=10`; one asset with ten CVSS-3
  CVEs produces `intensity=30`. Both signals matter for
  CVE-pressure visualisation, and the product captures
  BOTH severity AND breadth in a single scalar. The
  heat layer will then Gaussian-blend per-asset
  intensities across geographically-nearby assets into
  regional blobs.
- **`eventstats max(cve_intensity) AS max_intensity`** —
  adds the per-tenant maximum intensity as a column on
  every row, so the next `eval` can normalise.
  `eventstats` (not `stats`) is the right command
  because it KEEPS the per-asset rows and ADDS the new
  column. Same pattern used in every other heat recipe
  in the matrix.
- **`eval weight=round(log10(cve_intensity + 1) /
  log10(max_intensity + 1), 2)`** — **log-scale**
  normalisation. CVE intensity values in real OT
  installs span 2-3 orders of magnitude (a well-patched
  asset is 0-2; a long-tail unpatched legacy PLC can hit
  100+). Linear normalisation would render every
  modestly-vulnerable asset as `weight ≈ 0.01` and
  produce a heatmap with one bright blob over the worst
  legacy device and nothing else visible. The log-scale
  formula preserves the rank order while compressing
  dynamic range so the third-most-vulnerable region
  remains visible alongside the worst. The `+ 1` guards
  against `log10(0) = -inf` for CVE-clean assets (whose
  `cve_intensity=0`). Same canonical pattern shared
  across every heat recipe in the matrix
  ([cim-network-traffic/heat](../cim-network-traffic/heat.md),
  [netflow-sflow-ipfix/heat](../netflow-sflow-ipfix/heat.md),
  [splunk-stream/heat](../splunk-stream/heat.md),
  [ot-datastreamer/heat](../ot-datastreamer/heat.md),
  [meraki/heat](../meraki/heat.md),
  [kvstore-latlon/heat](../kvstore-latlon/heat.md),
  [cim-authentication/heat](../cim-authentication/heat.md),
  [es-risk/heat](../es-risk/heat.md),
  [cim-alerts/heat](../cim-alerts/heat.md) — sibling
  shipped same wave).
- **`| head 5000`** — render budget. Same as the H3
  sibling. Bump to 10000 for global enterprise
  deployments with 50+ sites and 1000+ assets per site.

Every `|` starts its own physical line per the SPL
pipe-per-line contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field          | type    | example         |
|----------------|---------|-----------------|
| id             | string  | PLC-FLOOR3-A02  |
| lat            | number  | 29.7604         |
| lon            | number  | -95.3698        |
| max_cvss       | number  | 9.8             |
| cve_count      | integer | 12              |
| safety_related | boolean | true            |
| weight         | number  | 0.94            |

Seven fields appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `weight` is the
heat-layer-required normalised intensity field;
`max_cvss`, `cve_count`, `safety_related`,
`zone_purdue_level`, and `site_name` flow through as
feature properties for per-region drilldown popup (if
the operator zooms in and hovers over a blob region, the
popup will show the worst contributing asset and its
safety / Purdue-level annotation).

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
  heatmap renderer. The `auto` renderer only switches to
  heatmap above ~10000 features, so for the typical OT
  install (a few thousand assets across 10-30 sites) the
  recipe NEEDS the explicit pin — without it, `auto`
  would render markers and silently invert the panel's
  intent.
- **`heatmapOpacity: 0.7`** — slightly less opaque than
  the cim-alerts / es-risk heat siblings (0.75) because
  OT assets cluster MUCH more tightly geographically
  (one Houston plant = one ~1-2 km radius) and a more
  transparent heatmap lets the basemap show through to
  contextualise WHICH plant is hot (port complex?
  refinery zone? manufacturing park?). The formatter-
  schema range is 0.0-1.0.
- **`heatmapRadius: 28`** — smaller than the cim-alerts
  (30 px) and es-risk (32 px) heat siblings because OT
  asset geographic concentration is tighter (one plant
  fits in 1-2 km, not 10-30 km). 28 px lets each plant
  blob remain visually distinct without merging adjacent
  plants in the same metro area — preserves the
  per-plant CVE-pressure signal. For a multi-continent
  panel showing inter-plant distribution, raise to 32-36
  px; for a single-plant campus zoom showing intra-plant
  CVE distribution, drop to 12-18 px. The formatter-
  schema range is 2-64 px.
- **`weight` drives heat intensity automatically.** The
  heat layer renderer auto-picks the `weight` field by
  name (per Better Map's `dataFitness.js` field aliasing).
  Same convention as every other heat recipe in the
  matrix.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose
harness (ROADMAP §3 D5). For OT recipes specifically,
the deferred verification path is to dispatch against a
customer pilot tenant (E4) under a non-production Cyber
Vision sensor rather than a synthetic generator. The
site lookup must be authored by the customer's OT-asset
team — Better Map ships nothing._

## 6. Gotchas

- **OT safety — passive DPI is the REFERENCE DESIGN.**
  Same as the markers / H3 companions. Cyber Vision is
  explicitly named in
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 as the reference design for passive OT
  collection. This recipe consumes Cyber Vision's
  already-passive metadata stream — it does NOT itself
  probe the OT zone in any way.
- **OT safety — heatmap blurs safety-related signal
  more than markers or H3.** This is the MOST
  important OT-safety-specific call-out for THIS layer:
  the Gaussian-blob aggregation that makes heatmap good
  for "regional CVE pressure" rendering ALSO makes it
  WORSE than markers or H3 at surfacing a single
  `safety_related=Y` asset's CVE among hundreds of
  IT-zone CVEs at the same plant. A blob over Houston
  could be 500 IT-zone Level-3 PCs with run-of-the-mill
  Windows CVEs, OR could conceal one Level-2 historian
  with a critical SIS-adjacent CVE that needs immediate
  OT-engineering attention. Per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6, every `safety_related=Y` asset MUST be
  triaged via its OT-engineering escalation runbook —
  this heat panel should NEVER be the only surface a
  SOC operator uses for safety-related triage. Pair
  this heat panel with the cyber-vision/markers panel
  (per-asset visibility with `safety_related` flag
  visible) AND filter the heat layer with `| where
  NOT safety_related="true"` if you want a "non-SIS
  CVE pressure" view that won't mask safety-relevant
  data — author a SEPARATE companion panel that
  filters `| where safety_related="true"` for SIS-only
  visibility, never combine them.
- **OT safety — every asset row is read-only mirrored
  from the customer SRS.** Per Rule 5, the
  `safety_related` column in `cybervision_sites.csv`
  is a copy of the customer-supplied SIS-asset register,
  NEVER authored by VISTA. If the Safety Annex (per
  the OT-safety gate) is missing for any
  `safety_related=Y` row, STOP and get the customer's
  OT engineering team to author the SRS first.
- **OT safety — never disable / suppress / filter a
  Cyber Vision asset at the props/transforms layer.**
  Per Rule 2, even though the heatmap aggregation
  collapses individual assets into smooth blobs, do
  NOT drop assets at the props/transforms layer — drop
  at the PANEL layer (e.g. add a `| where
  safety_related="false"` filter to the SPL above to
  exclude SIS-related assets from THIS panel, while
  still letting them surface in the cyber-vision/markers
  drilldown panel).
- **`cybervision_sites.csv` schema (operator-
  maintained).** Same contract as the markers / H3
  companions:

  ```csv
  asset_id,site_name,lat,lon,zone_purdue_level,safety_related
  PLC-FLOOR3-A02,Houston-East,29.7604,-95.3698,2,true
  HISTORIAN-01,Houston-East,29.7604,-95.3698,3,false
  ```

  `safety_related` MUST be `true` or `false` exactly
  (per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 5). `zone_purdue_level` MUST be an integer 0–5
  matching the IEC 62443 Purdue Reference Model.
- **Log-scale weight is INTENTIONAL.** Same rationale as
  every other heat recipe in the matrix — CVE intensity
  values span 2-3 orders of magnitude; linear
  normalisation would collapse 80 % of assets to
  invisibility. The log-scale formula preserves rank
  order while compressing dynamic range. The trade-off
  is that the weight values feel less intuitive in
  popups (a "weight" of 0.7 doesn't read as "70 % of
  max" — read it as the log-scale rank, or expose
  `cve_intensity`, `max_cvss`, or `cve_count` directly
  in the popup template instead of `weight`).
- **`cve_intensity = max_cvss × cve_count` is one
  reasonable scalarisation — other choices exist.**
  Alternatives that change the panel's emphasis: `eval
  cve_intensity=max_cvss` (worst-CVSS-only, ignores
  breadth — favours "find the one critical CVE" over
  "find the asset with many CVEs"); `eval cve_intensity=
  cve_count` (breadth-only, ignores severity — favours
  "asset with many CVEs" regardless of how bad each
  one is); `eval cve_intensity=
  exp(max_cvss/3)*cve_count` (exponential severity
  weighting — disproportionately emphasises CVSS 8+
  CVEs). Pick the scalarisation that matches the
  vulnerability-management programme's prioritisation
  policy.
- **`cve_count` is BOUNDED by the join window.** The
  join subsearch over the same 24 h window means the
  count reflects CVEs PUBLISHED OR REPORTED in 24 h,
  not the asset's lifetime CVE exposure. For lifetime
  exposure (recommended for vulnerability-management
  panels), widen the subsearch time range
  (e.g. `earliest=-365d`) while keeping the components
  search at `-24h` for currently-active inventory.
- **Heatmap vs markers vs H3 — when to choose which**
  (see §1 above). Heatmap is the right layer when the
  audience is **CISO / leadership / board**, when the
  question is **"where is OT CVE pressure
  concentrating?"** (not "which asset?" or "which
  plant site?"), and when **per-asset drilldown is NOT
  expected** from this panel. If the OT engineering
  team wants to click a blob and see the contributing
  asset list, render the markers companion on the same
  dashboard and toggle layers via BM-CT-1 — do NOT add
  drilldown to the heatmap panel itself (heatmap blobs
  don't carry per-feature click-through, and trying to
  retrofit it creates a confusing UX).
- **Time range.** Hard-coded `earliest=-24h` matches the
  default Cyber Vision Center re-publication cadence
  for asset state. For "current vulnerability landscape"
  CISO briefings, this is the right window — assets
  patched in the last 24 h won't appear on the heatmap
  blob (the components stream re-publishes the asset
  but the vulnerability subsearch over the same 24 h
  shows the CVE as cleared). For "historical CVE
  pressure trend" panels, widen to `-7d` or `-30d`.
- **PII / GDPR posture.** Cyber Vision asset IDs are
  internal OT equipment identifiers, not personal data
  — generally outside GDPR scope. Note that some
  industrial workflows associate operator/maintenance-
  engineer identities with specific equipment; if
  `cybervision_sites.csv` is enriched with operator
  names (NOT recommended — keep operator-identity in a
  separate access-controlled lookup), additional GDPR
  considerations apply. The heatmap layer is the
  lowest-risk of the three cyber-vision layers for
  operator-identity privacy because individual asset
  identifiers are collapsed into anonymous regional
  pressure (the popup CAN expose per-asset identifiers
  on hover — set `popupTemplate` to `"OT CVE pressure:
  {{weight}}"` to fully anonymise for CISO briefings).
  Per ROADMAP §1a (binding), Better Map NEVER sends
  data outside `splunkd:8089`.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, matches the documented Cyber Vision
sourcetype contract from
[`~/.cursor/skills/cisco-splunk-integration/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/cisco-splunk-integration.mdc),
follows the `ot-safety.mdc` Rule 1 / Rule 5 passive-DPI
and read-only-SRS contract, and reuses the same
canonical `eventstats max + log10 eval normalise`
heat-weight pattern as every other heat recipe in the
matrix. It has NOT been dispatched against a customer
Cyber Vision pilot tenant. A maintainer with REST auth
to such a tenant should:

1. Confirm the components and vulnerabilities streams
   are flowing: `index=cybervision sourcetype=
   "cisco:cybervision:components" | stats count` and
   the same for `:vulnerabilities`.
2. Confirm `cybervision_sites.csv` carries the lookup
   keys: `| inputlookup cybervision_sites.csv | where
   isnotnull(lat) | stats count`.
3. Confirm the customer's Safety Annex (per the
   OT-safety gate) accompanies every `safety_related=Y`
   row in the lookup before any panel renders.
4. Run the recipe SPL and confirm the heatmap renders
   blobs over the customer's plant sites with sensible
   intensity gradients (the worst-CVSS plant should
   visually dominate; the most-patched plant should be
   nearly invisible).
5. Render the markers / H3 / heat panels side by side
   and confirm the hottest heat regions correspond to
   the assets with worst CVSS and highest CVE count
   (sanity check on the `cve_intensity = max_cvss ×
   cve_count` scalarisation and the log-scale
   normalisation).
6. Vary `heatmapRadius` between 16 and 48 to find the
   sweet spot for the tenant's plant geographic
   spread (single-region tenants: 16-24; multi-
   continent enterprises: 32-48).
7. Update the frontmatter to `status: verified`, fill
   in `verified_against`, and submit a follow-up PR.
