---
schema_version: 1
id: cim-alerts--paths
source:
  id: cim-alerts
  display_name: "CIM Alerts"
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
    example: "203.0.113.42__1747534800"
    drives_formatter_option: pathIdField
  - name: seq
    type: integer
    example: "0"
    drives_formatter_option: timeField
  - name: lat
    type: number
    example: "47.6062"
  - name: lon
    type: number
    example: "-122.3321"
  - name: src
    type: string
    example: "203.0.113.42"
  - name: dest
    type: string
    example: "web-prod-04.example.com"
  - name: signature
    type: string
    example: "T1190-exploit-public-app"
  - name: severity
    type: string
    example: "high"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-dest alert volume)"
    path: "docs/recipes/cim-alerts/markers.md"
  - description: "Companion recipe — same source, heatmap layer (alert density)"
    path: "docs/recipes/cim-alerts/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (jurisdictional roll-up)"
    path: "docs/recipes/cim-alerts/h3.md"
  - description: "Pattern reference — paths layer with iplocation-geocoded hops"
    path: "docs/recipes/thousandeyes/paths.md"
  - description: "Pattern reference — paths layer with first/last vertex append"
    path: "docs/recipes/cim-network-traffic/paths.md"
  - description: "Splunk CIM skill — Alerts data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — correlation searches + risk-based alerting kill-chain mapping"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "MITRE ATT&CK skill — alert-to-technique mapping for kill-chain reconstruction"
    path: "~/.cursor/skills/splunk-mitre-attack/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# CIM Alerts — paths

Render **alert progression chains** by geocoding alert `src` (the
attacker / source IP) and stringing chronologically-firing alerts
from the same `src` into a polyline. The canonical "kill-chain
reconstruction" panel: when a SOC analyst sees a marker firing 47
alerts on `web-prod-04`, the paths panel shows them WHERE those
alerts came from (IPs across 3 countries) AND in what order (recon
scan → public-app exploit → credential theft → lateral movement).
The sister panel to [`cim-alerts/markers`](../cim-alerts/markers.md)
(per-target overview), [`cim-alerts/heat`](../cim-alerts/heat.md)
(target-density smoothing), and [`cim-alerts/h3`](../cim-alerts/h3.md)
(jurisdictional roll-up) — together the four shapes give a SOC team
target-, density-, jurisdiction-, AND attacker-attribution views on
one CIM data model.

## 1. Source description

Splunk's **Alerts** Common Information Model (CIM) data model
normalizes alerts from any source — saved-search alerts, ES
correlation searches, ITSI notable events, third-party SIEM
forwarders, IDS/IPS engines, EDR platforms — into a stable schema
keyed on the `tag=alert` event tag. See
[`cim-alerts/markers`](../cim-alerts/markers.md) for the full list
of contributing sourcetypes and the CIM Alerts data model contract.

This recipe is the **attacker-attribution view**: it accelerates
the same CIM Alerts data model used by markers / heat / h3, but
groups events by `src` (source IP) instead of `dest` (target host),
geocodes the source IP via `iplocation`, and uses `streamstats` to
generate a per-source monotonic sequence number. The polyline
formatter draws one line per `src`, vertex-ordered by alert
firing time — the geometric equivalent of "draw me the path this
attacker walked".

**Typical sourcetype / index:** anything tagged `alert`. Same
detection-engine sources as
[`cim-alerts/markers`](../cim-alerts/markers.md) — ES correlation,
ITSI episodes, Mission Control cases, SIEM forwarders, IDS/IPS,
EDR. The recipe assumes CIM Alerts data model acceleration is
enabled; without it, `summariesonly=true` returns zero rows.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS alert_count,
    values(Alerts.signature) AS signatures,
    values(Alerts.severity) AS severities,
    min(_time) AS first_seen,
    max(_time) AS last_seen
  FROM datamodel=Alerts WHERE earliest=-24h
  BY Alerts.src, Alerts.dest, Alerts.signature, _time span=1m
| rename "Alerts.src" AS src, "Alerts.dest" AS dest, "Alerts.signature" AS signature
| iplocation src
| where isnotnull(lat) AND isnotnull(lon)
| eval severity=mvindex(severities, 0)
| eval path_id=src . "__" . tostring(relative_time(now(), "-24h"))
| sort 0 path_id, _time
| streamstats current=true count AS seq BY path_id
| eval seq=seq-1
| eventstats count AS hops_in_path BY path_id
| where hops_in_path >= 2
| rename path_id AS id
| fields id, seq, lat, lon, src, dest, signature, severity, alert_count, _time
| sort id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true ... BY Alerts.src, Alerts.dest,
  Alerts.signature, _time span=1m`** — accelerated CIM Alerts
  aggregation grouped by source IP + target + signature + 1-minute
  time bucket. The `_time span=1m` is the key: it gives each
  unique (src, dest, signature) combo per minute its own row,
  preserving the chronological sequence needed for the paths
  layer. Without `_time span=1m`, all alerts from the same src
  would collapse into one row and the path would have only 1
  vertex (useless).
- **`| iplocation src`** — geocode the source IP. Public-internet
  attacker IPs typically resolve; internal-LAN source IPs
  (private RFC 1918 ranges) resolve to null and get filtered by
  the `where` clause on the next line. For internal lateral
  movement reconstruction (where `src` is a compromised internal
  host), replace `iplocation` with a join against a customer-
  curated `internal_hosts_geo.csv` lookup.
- **`eval path_id=src . "__" . tostring(relative_time(now(),
  "-24h"))`** — synthesise the path identifier from the source
  IP + the start-of-window timestamp. All events from the same
  src in the same 24h window land in the same path; restarting
  the panel tomorrow gives every src a new path_id (no cross-
  day contamination). For per-incident analysis, narrow the
  window to the incident span and the `path_id` collapses to
  one per attacker per incident.
- **`sort 0 path_id, _time`** + **`streamstats current=true
  count AS seq BY path_id`** — the canonical paths-layer
  sequence pattern. `sort 0` skips the row-cap default; the
  per-path-id `count` becomes a monotonic vertex number,
  preferred over `_time` because immune to clock skew across
  multi-source SIEM forwarders. `eval seq=seq-1` zero-indexes
  the sequence (the paths layer prefers 0-based for cleaner
  axis labels).
- **`eventstats count AS hops_in_path BY path_id`** +
  **`where hops_in_path >= 2`** — discard single-vertex paths
  (a `src` that fired only one alert isn't a "path"; it's a
  point — surface those in the `cim-alerts/markers` panel
  instead). The 2-hop minimum is the geometric definition of
  a polyline.
- **`head 5000`** — render-cap for 24h windows on busy ES
  tenants. A typical enterprise ES install firing 50k alerts/day
  rarely exceeds 1k unique sources, but a credential-stuffing
  campaign or DDoS-detection window can spike to 50k+ sources;
  the cap keeps render time <500ms. Narrow the time window for
  denser environments.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field        | type    | example                          |
|--------------|---------|----------------------------------|
| id           | string  | 203.0.113.42__1747534800         |
| seq          | integer | 0                                |
| lat          | number  | 47.6062                          |
| lon          | number  | -122.3321                        |
| src          | string  | 203.0.113.42                     |
| dest         | string  | web-prod-04.example.com          |
| signature    | string  | T1190-exploit-public-app         |
| severity     | string  | high                             |

All eight fields appear in `expected_fields` in the frontmatter and
are cross-checked by `scripts/check-recipe-schema.py`. `alert_count`
and `_time` also flow through as feature properties for the popup.

## 4. Recommended formatter config

```json
{
  "pathIdField": "id",
  "timeField": "seq",
  "pathColor": "#d62728",
  "pathArrows": true
}
```

Why this specific config:

- **`pathIdField: "id"`** — explicit. Auto-detect would land on
  `id` too (Better Map's canonical alias), but pinning prevents
  ambiguity if future SPL adds another `id`-suffixed field.
- **`timeField: "seq"`** — the paths layer needs a monotonic
  ordering field per `pathIdField`; `seq` from `streamstats` is
  always clean (immune to clock skew between SIEM forwarders).
- **`pathColor: "#d62728"`** — Tableau "alert red", same colour
  family as
  [`cim-alerts/markers`](../cim-alerts/markers.md) for visual
  cohesion in a multi-panel SOC dashboard. The red lines read as
  "attacker progression" against any base-map backdrop.
- **`pathArrows: true`** — render direction-of-travel chevrons.
  Essential for kill-chain panels: without arrows, the polyline
  is ambiguous (which end is recon, which is exfil?); with
  arrows, the panel reads as "the attacker came FROM here and
  went TO there".

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic ES correlation-search corpus seeded with
geographically-distributed source IPs for kill-chain stability._

## 6. Gotchas

- **CIM Alerts data-model acceleration MUST be enabled.** Same
  contract as
  [`cim-alerts/markers`](../cim-alerts/markers.md) §6 —
  confirm in Settings → Data models → Alerts → Acceleration. If
  OFF, the panel returns zero rows. The `_time span=1m` bucket
  in this recipe requires accel to be reasonably fresh (default
  5-minute rebuild interval); incidents reconstructed within
  the last 5 minutes may be incomplete.
- **`Alerts.src` is sometimes null.** Not every alert has a
  source IP (e.g., behavioral / risk-based alerts derived from
  internal user activity carry no `src`). Those rows are
  filtered by `where isnotnull(lat) AND isnotnull(lon)`. For
  comprehensive coverage including no-src alerts, use the
  markers companion (which uses `dest`).
- **Private-IP sources collapse silently.** Internal-LAN source
  IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) resolve to
  null via `iplocation` and drop out. For internal-lateral-
  movement panels, this is the WRONG recipe — use a per-customer
  `internal_hosts_geo.csv` lookup join instead of `iplocation`.
- **24-hour window is intentional.** Longer windows (7d / 30d)
  conflate distinct campaigns into one path (e.g., a botnet IP
  re-used by a different campaign 3 weeks later would appear
  on the same polyline). Narrower windows (1h / 15m) lose the
  multi-stage kill-chain shape (a typical APT operation
  unfolds over hours-to-days). 24h is the SOC-shift default.
- **`hops_in_path >= 2` discards isolated alerts.** A `src`
  firing one alert isn't a "path" — it's a point. Surface
  those rows in the markers companion. If you want to see
  isolated alerts alongside multi-hop paths on the same panel,
  add a second Better Map layer with `pointRenderer:
  "markers"` filtered to `hops_in_path == 1` (the paths layer
  alone cannot render single-vertex geometries).
- **MITRE ATT&CK technique mapping is downstream.** The
  `signature` field surfaces detection-engine signature names
  (e.g., `T1190-exploit-public-app` for ES correlation searches
  that follow the MITRE naming convention). Per the
  [splunk-mitre-attack skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-mitre-attack/SKILL.md),
  correlation-search authors SHOULD tag their searches with
  `action.correlationsearch.annotations` carrying the
  ATT&CK technique ID; if those annotations are present, add a
  `| eval mitre_technique=...` line before the `fields` clause
  to surface them in the popup.
- **No OT safety dependency.** Same boundary discussion as
  [`cim-alerts/markers`](../cim-alerts/markers.md) §6 — this
  recipe consumes Level-3/4 SIEM artefacts, never reads
  Level-0/1/2 directly. For OT alert paths, use the
  [`cyber-vision/paths`](../cyber-vision/paths.md) recipe
  which is built on the OT-safety-compliant passive-DPI
  reference design.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`tstats`, `iplocation`,
`eval`, `sort`, `streamstats`, `eventstats`, `where`, `fields`,
`head`) on the accelerated CIM Alerts data model. Verification
path mirrors
[`cim-alerts/markers`](../cim-alerts/markers.md) §"Verification
status" — confirm acceleration is ON, seed test data via
`Splunk_SA_CIM/tutorialdata.tgz` if no live correlation searches
are firing, dispatch via REST, drop into a Dashboard Studio panel
with the §4 formatter JSON, confirm polylines render. Promote
to `status: verified` + fill in `verified_against` in a follow-up
PR.
