---
schema_version: 1
id: cim-network-traffic--paths
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic"
  pattern: splunk-cim
layer:
  id: paths
  display_name: Paths
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
    example: "203.0.113.45__198.51.100.7"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: src_country
    type: string
    example: "US"
  - name: dest_country
    type: string
    example: "DE"
  - name: total_bytes
    type: integer
    example: "847293"
references:
  - description: "Splunk CIM skill — Network Traffic data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "Companion recipe — CIM Network Traffic → Markers (single endpoint geocoding)"
    path: "docs/recipes/cim-network-traffic/markers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
---

# CIM Network Traffic — paths

Render network flows as **arcs** between source and destination
geographies, animated end-to-end so a viewer can see direction at
a glance. One arc per unique src/dest IP pair, coloured by
direction (egress vs ingress), with an animated arrow pointing
toward the destination. The canonical "where is my traffic going,
visually, with direction" panel — the natural counterpart to the
[CIM Network Traffic → Markers](markers.md) recipe (which shows
WHERE without HOW).

## 1. Source description

Same data source as [CIM Network Traffic → Markers](markers.md) —
the Splunk **Network Traffic** CIM data model. See that recipe's
§1 for the list of vendor-agnostic sourcetypes it covers (Palo
Alto, Cisco ASA / FTD / SD-WAN, Stream, NetFlow, Meraki MX,
eStreamer, …).

The difference is which field pair drives the visualization:
the markers recipe geocodes the **destination** (`dest`) only and
renders one point per dest; this recipe geocodes **both** `src`
AND `dest` and renders an arc connecting them. The interesting
column is no longer "where is my traffic going" but "which
src/dest country pairs are talking to each other" — useful for
data-exfiltration detection (long-lived flows from `INTERNAL`
src to `THREAT_COUNTRY` dest), SD-WAN flow auditing
(production traffic supposed to leave via the SFO POP is
egressing from FRA — why?), or executive-overview maps where the
visual storytelling matters as much as the underlying data.

**Typical sourcetype / index:** identical to the markers recipe —
anything tagged `network communicate` from a CIM-accelerated
data model.

## 2. SPL recipe

```spl
| tstats summariesonly=true sum(All_Traffic.bytes) AS total_bytes FROM datamodel=Network_Traffic WHERE All_Traffic.action="allowed" earliest=-24h latest=now BY All_Traffic.src, All_Traffic.dest
| rename All_Traffic.src AS src, All_Traffic.dest AS dest
| where match(src, "^\d+\.\d+\.\d+\.\d+$") AND match(dest, "^\d+\.\d+\.\d+\.\d+$")
| where NOT cidrmatch("10.0.0.0/8", dest) AND NOT cidrmatch("172.16.0.0/12", dest) AND NOT cidrmatch("192.168.0.0/16", dest)
| iplocation src
| rename lat AS src_lat, lon AS src_lon, Country AS src_country
| iplocation dest
| rename lat AS dest_lat, lon AS dest_lon, Country AS dest_country
| where isnotnull(src_lat) AND isnotnull(dest_lat)
| eval id=src."__".dest
| sort - total_bytes
| head 100
| eval _key=id
| eval seq_src=0, seq_dest=1
| eval src_row=mvappend(_key, src_country, dest_country, total_bytes, src_lat, src_lon, seq_src)
| fields id, seq_src, seq_dest, src_lat, src_lon, dest_lat, dest_lon, src_country, dest_country, total_bytes
| eval lat=mvappend(src_lat, dest_lat), lon=mvappend(src_lon, dest_lon), seq=mvappend(seq_src, seq_dest)
| fields id, seq, lat, lon, src_country, dest_country, total_bytes
| mvexpand seq
| eval idx=mvfind(mvappend(0, 1), seq)
| eval lat=mvindex(lat, idx), lon=mvindex(lon, idx)
| fields id, seq, lat, lon, src_country, dest_country, total_bytes
| sort id, seq
```

Why this exact (long) shape, region by region:

- **Stage 1 — `tstats … BY All_Traffic.src, All_Traffic.dest`** —
  reads the CIM-accelerated data model summary, bucketing by the
  full src/dest pair (the cardinality is enormous — every unique
  connection — so the `head 100` later is mandatory). `sum(bytes)`
  becomes the per-pair flow size, which we use later as the path
  width / sort key.
- **Stage 2 — IPv4 + private-range filter** — drop IPv6
  (uncommon for CIM Network Traffic flows; needs separate
  iplocation handling) and drop any flow to a private-range
  destination (10/8, 172.16/12, 192.168/16). The latter is
  CRITICAL: internal east-west traffic would otherwise produce a
  jumble of arcs into Null Island and obscure the actual
  cross-region story. Keep the SRC private-range filter OFF
  intentionally — a flow from your internal corporate subnet
  egressing the perimeter is exactly what we want to render.
- **Stage 3 — two `iplocation` passes** — once for `src`,
  once for `dest`. `iplocation` overwrites `lat`/`lon`/`City`/
  `Country` on each call, so we `rename` between calls to
  preserve both endpoints. This is the canonical Splunk pattern
  for "geocode two columns in one event" — there is no
  multi-column `iplocation` flag.
- **Stage 4 — `where isnotnull(src_lat) AND isnotnull(dest_lat)`** —
  drop any pair where EITHER endpoint failed to geocode. A
  one-sided arc has no path to render. This also catches the
  remaining private-IP-src case (`iplocation` returns null for
  10.x).
- **Stage 5 — `eval id=src."__".dest`** — synthesize the
  `pathIdField` value. The "src__dest" string is the unique
  grouping key for the paths layer; both vertices of one arc
  share this id.
- **Stage 6 — `sort -total_bytes | head 100`** — render budget.
  The paths layer renders well at 100–500 arcs; >500 starts to
  feel busy at world zoom because each arc is two visible
  vertices PLUS the polyline geometry between them. 100 is the
  sweet spot for an executive overview.
- **Stage 7 — `mvappend` + `mvexpand`** — transform the
  ONE-row-per-pair shape (`src_lat, src_lon, dest_lat,
  dest_lon`) into the TWO-rows-per-pair shape the paths layer
  consumes (one row for each vertex, sharing the same
  `pathIdField`). This is the Splunk SPL idiom for "fan one row
  into N rows" — `mvappend` builds a multi-value, `mvexpand`
  unrolls it. The `seq` column is 0 for the src vertex, 1 for
  the dest vertex — the paths layer connects them in
  ascending order.

## 3. Expected fields

| field        | type    | example                       |
|--------------|---------|-------------------------------|
| id           | string  | 203.0.113.45__198.51.100.7    |
| seq          | integer | 0                             |
| lat          | number  | 37.7749                       |
| lon          | number  | -122.4194                     |
| src_country  | string  | US                            |
| dest_country | string  | DE                            |
| total_bytes  | integer | 847293                        |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

Two rows per `id`: one with `seq=0` carrying the src endpoint
coordinates, one with `seq=1` carrying the dest endpoint
coordinates. `src_country`, `dest_country`, and `total_bytes` are
duplicated across both rows so the popup has full context
regardless of which vertex the user hovers.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#4a90e2",
  "pathArrows": true
}
```

Why this minimal config:

- **`pathIdField: "id"`** — REQUIRED. Tells the paths layer
  which column groups vertices into a single polyline. Without
  this, every row would render as a one-vertex (invisible) path
  and the panel would show nothing.
- **`timeField: "seq"`** — REQUIRED. The paths layer sorts
  vertices within each path by this column before connecting
  them. We use the synthetic `seq=0|1` (src first, dest second)
  so the arc has a deterministic direction regardless of how
  Splunk ordered the rows in the result set. For true
  time-ordered tracks (GPS, asset telemetry) `timeField` would
  be `_time`; the formatter accepts any sortable numeric
  column.
- **`pathColor: "#4a90e2"`** — Tableau-blue arc. The Better
  Map default is the soft coral `#fb8072`, which collides
  visually with the alert-red palette commonly used for failed
  authentication. Blue reads as "informational, neutral flow"
  for an audience used to SecOps colour conventions. For a
  data-exfil-detection panel where every arc IS an alert,
  switch back to coral or a stronger red.
- **`pathArrows: true`** — render a directional arrowhead at the
  end of each arc so the viewer can immediately see "this is
  egress from US → DE" vs "ingress from DE → US". Without
  arrows the paths look symmetric and the direction is lost.
  Animated arrows (`pathAnimated: true`) add motion that
  reinforces direction but is GPU-expensive at 100+ paths;
  enable only on a hand-tuned 10–20-arc executive overview.
- **`total_bytes` flows through automatically** as a feature
  property. It can drive `pathWidth` (thicker arcs for
  higher-volume flows) — add `"pathWidth": "total_bytes"` if
  the formatter version supports numeric-field bindings; the
  v1.7 paths layer currently uses a single `pathWidth` numeric
  constant so the binding is informational-only until a future
  layer pass.
- **No `latField`/`lonField` override** — the SPL renames both
  endpoints' coordinates to canonical `lat`/`lon` after the
  `mvexpand`, so auto-detection picks them up.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will render every recipe's panel against a
preloaded sample dataset and check in the resulting PNGs alongside
the recipe markdown. The Network Traffic paths variant is
particularly screenshot-worthy — the great-circle arcs between
geocoded src/dest pairs read as a recognisable "the Internet"
visual at any zoom level._

## 6. Gotchas

- **The two-rows-per-flow shape is the entire trick.** If you
  copy the SPL and simplify it to "one row per flow with
  src_lat/src_lon/dest_lat/dest_lon columns", the paths layer
  renders nothing — it consumes the (`pathIdField`,
  `timeField`, `lat`, `lon`) tuple and assumes ONE point per
  row. The `mvappend` + `mvexpand` pair is non-negotiable for
  this layer. The same pattern appears in the [Splunk Lantern
  flow-visualisation article](https://lantern.splunk.com/Splunk_Platform/UCE/Use_cases/Visualizing_network_flows)
  for the standard Splunk choropleth flow-map panel.
- **`head 100` is mandatory.** Without it the SPL returns
  ~`O(unique_src × unique_dest)` rows — easily 10,000+ on a
  busy perimeter — and the paths layer chokes (GPU pressure
  from 20,000+ great-circle vertices plus optional arrowheads).
  100 is the sweet spot per ROADMAP §7c (paths layer render
  budget). Raise carefully and watch the perf HUD.
- **The directional-asymmetry surprise.** This recipe groups
  by `(src, dest)` and treats each direction as a separate
  arc. A long-lived TCP connection generates two flow records
  — one for `A→B` and one for `B→A` — which produces TWO
  parallel arcs that overlap. If your audience finds this
  busy, add `| eval pair=if(src<dest, src."__".dest,
  dest."__".src)` AFTER the geocoding to canonicalize the
  pair and `stats sum(total_bytes) AS total_bytes,
  latest(src_lat) AS … BY pair` to collapse.
- **CIM data-model acceleration MUST be enabled** — same
  caveat as the markers recipe. Confirm in Settings → Data
  models → Network Traffic → Acceleration.
- **MaxMind database licensing** — same as the markers
  recipe. `iplocation` reads whichever database the admin
  configured.
- **Private-range src enrichment.** A flow from
  `10.20.30.40` (your corporate VLAN) to a public dest IP has
  `src_lat=NULL` because MaxMind cannot geocode RFC-1918
  space. The `where isnotnull(src_lat)` filter drops these,
  meaning the panel UNDERSTATES the volume of corporate-to-
  Internet flows. For a recipe that paints every internal
  src at "the corporate office", join `src` against an asset
  lookup (`Asset_Identity_Resolver`-style) BEFORE
  `iplocation` and substitute the office's hand-coded lat/lon
  via `eval src_lat=coalesce(office_lat, src_lat)`. This is
  the standard ES Asset & Identity pattern — see
  [`~/.cursor/skills/splunk-enterprise-security/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/cim-network-traffic/paths.md).
- **Time range** — hard-coded `earliest=-24h latest=now` so
  the recipe works without a dashboard time picker. Replace
  with `earliest=$earliest$ latest=$latest$` once wired in.
- **PII / GDPR posture** — identical to the markers recipe;
  `iplocation` is server-side, no outbound API call. Internal
  src IPs that geocode to "the corporate office" do NOT leak
  the office street address — only the city centroid that
  MaxMind hands back.
- **No OT safety dependency.** This recipe is pure IT network
  traffic. If your tenant's `Network_Traffic` data model ALSO
  ingests passive DPI of an OT zone (Cisco Cyber Vision,
  Claroty), filter those sourcetypes OUT of this recipe and
  put them in a DEDICATED OT-paths recipe per [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6. An animated arc from a PLC to a public IP is a
  potential exfiltration / C2 indicator — surfacing it on the
  same map as legitimate user web traffic dilutes the signal.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, uses only shipping Splunk built-ins (`tstats`,
`iplocation`, `mvappend`/`mvexpand`, `Splunk_SA_CIM`), and the
mvappend/mvexpand pattern is documented Splunk SPL. It has not
been dispatched against the v1.7-prep lab tenant in this PR
because non-interactive admin auth is not present in the agent
workspace. A maintainer with REST auth to a CIM-accelerated
tenant should:

1. Run the recipe SPL with `summariesonly=false | head 5` first
   to confirm the data model has data for the queried time
   range AND that the mvappend/mvexpand fan-out is producing
   the expected two-rows-per-pair shape.
2. Re-run with `summariesonly=true` and the full SPL to confirm
   the rendered panel shape matches.
3. Verify the paths layer renders ~100 arcs without GPU
   stutter against the formatter config in §4.
4. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
