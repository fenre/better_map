---
schema_version: 1
id: cim-performance--markers
source:
  id: cim-performance
  display_name: "CIM Performance (CPU / memory / facilities)"
  pattern: splunk-cim
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_SA_CIM"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "web-prod-01"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: dest
    type: string
    example: "web-prod-01"
  - name: cpu_load_percent
    type: number
    example: "82.4"
    drives_formatter_option: markerColor
  - name: mem_used_percent
    type: number
    example: "67.1"
  - name: signal_count
    type: integer
    example: "3"
references:
  - description: "splunk-cim skill — Performance data model schema, dataset tags, dest/cpu/memory contracts"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "splunk-datamodels-conf skill — CIM acceleration and tstats summariesonly tradeoffs"
    path: "~/.cursor/skills/splunk-datamodels-conf/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
required_formatter_options:
  - pointRenderer
  - idField
  - markerColor
ot_safety_relevant: false
---

# CIM Performance — markers

Render every monitored host that is currently breaching any
performance threshold (CPU > 80 %, memory > 80 %, or storage
> 85 %) as a marker, positioned at the host's datacenter, sized
by the count of distinct performance signals it has fired,
coloured by worst-current CPU. The canonical "where are my
infrastructure hot-spots?" SRE / ITops overview panel — the
sister panel to the [ITSI service-health recipe](../itsi-kpi-base/markers.md)
but built on raw infrastructure telemetry rather than the ITSI
KPI roll-up, so it works for tenants without ITSI licence.

## 1. Source description

The **CIM Performance data model** normalises infrastructure
telemetry from every monitored host — Splunk Universal Forwarder
`*nix`/Windows TA, Splunk Infrastructure Monitoring agent, Cisco
Catalyst Center `cisco:dnac:device` health, AWS CloudWatch, Azure
Monitor, GCP Stackdriver, any vendor TA that emits `performance`
+ subcategory tags. The model has six datasets:

| Dataset | Tags | Key fields |
|---|---|---|
| CPU | `performance`, `cpu` | `cpu_load_percent`, `cpu_load_mhz`, `cpu_user_percent`, `cpu_system_percent` |
| Memory | `performance`, `memory` | `mem`, `mem_free`, `mem_used`, `mem_used_percent` |
| Storage | `performance`, `storage` | `storage`, `storage_free`, `storage_used`, `storage_used_percent` |
| Network | `performance`, `network` | `thruput`, `thruput_max` |
| Facilities | `performance`, `facilities` | `temperature`, `power`, `fan_speed` |
| Uptime | `performance`, `os`, `uptime` | `uptime` (seconds since boot) |

Every dataset shares the `dest` field as the entity identifier
(the hostname being measured). The model is typically
accelerated (5 min spans, retained 6 weeks) — `tstats
summariesonly=true` against the model is the fast path.

This recipe runs three accelerated `tstats` queries (CPU,
Memory, Storage) over the last 15 min, picks the freshest
sample per host with `latest()`, applies threshold tests
(CPU > 80 %, Memory > 80 %, Storage > 85 %), and counts how
many of the three a host is currently breaching. Hosts
breaching at least one signal are joined against an asset
inventory lookup (the ES Asset & Identity `asset_lookup_by_str`
or any customer-curated equivalent that maps hostname → lat/lon)
and rendered as markers. The `signal_count` (1, 2, or 3) and
the worst current CPU drive the visual encoding.

**Typical sourcetype / index:** the Performance data model can
draw from many sourcetypes (`nix:cpu`, `Perfmon:CPU`,
`cisco:dnac:device`, `cloudwatch:host`, `azure:monitor:metric`,
`vmware:vsphere:host:performance`, ...) — that's the whole
point of CIM. The TA app context required is just
`Splunk_SA_CIM`. The asset lookup is operator-maintained; the
recipe shows two common forms (ES A&I, ITSI entity collection)
in §6 Gotchas.

## 2. SPL recipe

```spl
| tstats summariesonly=true latest(Performance.cpu_load_percent) AS cpu_load_percent FROM datamodel=Performance.CPU WHERE earliest=-15m latest=now BY Performance.dest
| rename Performance.dest AS dest
| append [
    | tstats summariesonly=true latest(Performance.mem_used_percent) AS mem_used_percent FROM datamodel=Performance.Memory WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| append [
    | tstats summariesonly=true latest(Performance.storage_used_percent) AS storage_used_percent FROM datamodel=Performance.Storage WHERE earliest=-15m latest=now BY Performance.dest
    | rename Performance.dest AS dest
  ]
| stats latest(cpu_load_percent) AS cpu_load_percent, latest(mem_used_percent) AS mem_used_percent, latest(storage_used_percent) AS storage_used_percent BY dest
| eval cpu_signal=if(cpu_load_percent>80, 1, 0)
| eval mem_signal=if(mem_used_percent>80, 1, 0)
| eval storage_signal=if(storage_used_percent>85, 1, 0)
| eval signal_count=cpu_signal+mem_signal+storage_signal
| where signal_count >= 1
| lookup asset_lookup_by_str src AS dest OUTPUT lat AS lat, long AS lon
| where isnotnull(lat) AND isnotnull(lon)
| eval cpu_load_percent=round(cpu_load_percent, 1)
| eval mem_used_percent=round(mem_used_percent, 1)
| eval storage_used_percent=round(storage_used_percent, 1)
| eval id=dest
| fields id, lat, lon, dest, cpu_load_percent, mem_used_percent, storage_used_percent, signal_count
| sort - signal_count, - cpu_load_percent
| head 1000
```

Why this exact shape, line by line:

- **Three `tstats summariesonly=true` against
  `datamodel=Performance.CPU` / `.Memory` / `.Storage`** — one
  per subdataset. Each pulls only the freshest sample per host
  via `latest()`. `summariesonly=true` REQUIRES the data model
  to be accelerated (which it usually is for production
  tenants); see §6 Gotchas if your tenant runs raw events. The
  15 min window matches the typical 5 min accel span × 3
  (covers one missed sample).
- **`rename Performance.dest AS dest`** — the data model
  exposes everything under the `Performance.<dataset>` prefix;
  `dest` is the universal entity key shared across all three
  datasets, so renaming it once per subsearch gives us a clean
  join key.
- **`append`** instead of `join` — three results sets are
  appended row-wise. The subsequent `stats ... BY dest`
  collapses to one row per host with all three measurements
  available via `latest()` (only one of the three will be
  non-null per source row, so `latest()` per-field picks the
  one that does). Avoids `join`'s 50K row × 60 s subsearch
  truncation per the SPL quality rules.
- **Three `eval *_signal=if(...>threshold, 1, 0)`** — binary
  thresholds, summed into `signal_count`. The thresholds (80 %
  CPU, 80 % memory, 85 % storage) are the industry-typical
  "yellow zone" — tune per tenant SLO. A host with 0 signals
  is healthy; 1-3 signals positions it on the map with worsening
  severity.
- **`where signal_count >= 1`** — drop healthy hosts. The
  panel intentionally surfaces only the problem set; healthy
  hosts get counted in a separate "Healthy host count: <N>"
  panel.
- **`lookup asset_lookup_by_str src AS dest OUTPUT lat,
  long AS lon`** — the ES Asset & Identity asset lookup (same
  contract as the [es-risk](../es-risk/markers.md) recipe).
  ES's column is `long`, renamed to Better Map's `lon`. If
  your tenant doesn't have ES, see Gotchas for the ITSI
  entity-attribute alternative and the inventory-lookup
  alternative.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop hosts
  with no geographic attribution. Real performance problems
  without geographic representation are surfaced in a
  companion table panel.
- **Three `eval *=round(*, 1)`** — round to one decimal for
  display (the underlying CIM values are float-precise from
  the raw telemetry).
- **`eval id=dest`** — adopt Better Map's `id` alias. The
  hostname IS the identifying key; no transformation needed.
- **`sort - signal_count, - cpu_load_percent`** — worst hosts
  first (most signals, then highest CPU as tiebreaker).
- **`head 1000`** — render budget. Most tenants run hundreds
  to thousands of monitored hosts; even at scale fewer than a
  few hundred will breach any threshold at any given time. 1000
  is defensive for very large fleets with permissive thresholds.

## 3. Expected fields

| field                | type    | example   |
|----------------------|---------|-----------|
| id                   | string  | web-prod-01 |
| lat                  | number  | 37.7749   |
| lon                  | number  | -122.4194 |
| dest                 | string  | web-prod-01 |
| cpu_load_percent     | number  | 82.4      |
| mem_used_percent     | number  | 67.1      |
| signal_count         | integer | 3         |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.
`storage_used_percent` also flows through as a feature property
for the popup but isn't in the contract (it's contextual
information, not required for the panel to render).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#ff7f0e"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — hosts cluster geographically
  by datacenter (one location commonly has dozens to hundreds
  of monitored hosts). World-zoom collapses to per-DC clusters;
  DC-zoom fans out to individual hosts.
- **`idField: "id"`** — explicit override. The auto-detector
  might prefer `dest`; pinning to the renamed `id` keeps
  drilldown URLs stable.
- **`markerColor: "#ff7f0e"`** — Tableau warning-orange
  default, reading as "attention required" — every marker is
  by definition a host breaching a performance signal. The
  per-marker colour can additionally ramp by `signal_count`
  via the `palette` formatter option
  (`{"1": "#ffbb78", "2": "#ff7f0e", "3": "#d62728"}` for
  one-signal / two-signal / three-signal hosts), so a host
  with all three breaching pops red against the orange
  baseline.
- **`cpu_load_percent`, `mem_used_percent`,
  `storage_used_percent`, `signal_count` flow through
  automatically** as feature properties for the popup
  (`enablePopups: true` is the default per
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will ship synthetic CIM Performance events from
the `*nix` TA, but the asset lookup (`asset_lookup_by_str` or
equivalent) must be seeded with at least one `lat`/`long` row.
Recipe verification path: dispatch against the D5 harness once
the asset lookup is bootstrapped._

## 6. Gotchas

- **Acceleration is mandatory for `summariesonly=true`.** If
  your tenant's CIM Performance data model is not accelerated
  (check `Settings → Data Models → Performance → Edit →
  Acceleration`), the `tstats summariesonly=true` query
  returns zero rows. Two fixes: (a) enable acceleration (5 min
  span, 6-week retention — the splunk-datamodels-conf skill
  defaults work); or (b) drop `summariesonly=true` and pay the
  raw-event query cost. Default the recipe to (a); document
  (b) as the fallback.
- **`asset_lookup_by_str` is the ES A&I asset lookup —
  requires ES.** Same as the [es-risk](../es-risk/markers.md)
  and [itsi-kpi-base](../itsi-kpi-base/markers.md) recipes —
  needs an A&I lookup populated with `lat`/`long` columns. If
  no ES, three substitutions in priority order:
  1. **ITSI entity collection** — `| lookup itsi_entities
     identifier AS dest OUTPUT info_lat AS lat, info_lon AS
     lon`. The most-common alternative for ITSI-licensed
     tenants without ES.
  2. **DNS-or-CMDB lookup** — `| lookup hosts_inventory_csv
     hostname AS dest OUTPUT lat, lon, datacenter`. The most-
     common alternative for tenants with neither ES nor ITSI
     — a hand-maintained CSV mapping each hostname to its
     datacenter coordinates.
  3. **Geocode-by-DNS** — `| iplocation dest`. The fallback
     fallback. Only works if `dest` is an IP address (rare
     for performance data — `dest` is usually a hostname); if
     it's a FQDN, prepend `| eval dest_ip=mvindex(split(dest,
     "."), 0) | dnsLookup hostname=dest_ip` (slow, requires
     DNS lookup TA).
- **Threshold tuning.** 80 % CPU and 85 % storage are
  industry conservatives. A burst-y batch-processing fleet
  routinely runs at 95 % CPU for legitimate work; raise to
  90 % to avoid noise. A read-mostly database fleet rarely
  exceeds 60 % CPU; drop to 70 % to surface anomalies
  earlier. The thresholds should match the customer's SLO
  documentation.
- **`Performance.dest` cardinality.** `dest` in the
  Performance model is typically a hostname (`web-prod-01`),
  not an FQDN (`web-prod-01.acme.example`) — the TA `host`
  field defaults to short hostname. If your asset lookup keys
  on FQDN, normalise with `| eval dest_short=mvindex(split(dest,
  "."), 0) | rename dest_short AS dest` BEFORE the lookup. The
  splunk-cim skill documents this nuance in its "Performance
  Data Model" section.
- **Time range.** Hard-coded `earliest=-15m latest=now`. 15
  min × 3 datasets = 45 sample windows per host (typical 5
  min accel span). `latest()` picks the freshest per host per
  dataset; if a host stopped reporting >15 min ago it's absent
  from the result set entirely (which is correct — a silent
  host is a different problem, surfaced in a "hosts not
  reporting" companion panel, not this one). Avoid widening
  below 5 min (causes false N/A on hosts mid-acceleration);
  avoid narrowing above 1 h (latency on the marker shifts to
  "what did this host look like an hour ago?", not "right
  now").
- **`append` vs `union`.** The recipe uses `append` (Splunk
  6.x+ pattern). If your tenant runs Splunk 7.0+ you can
  substitute `union` for slightly better optimizer behaviour
  (`union` lets the planner pipeline; `append` is strictly
  sequential). The output is identical; `union` is the
  modern best practice. Recipe uses `append` because it's
  the older, more-broadly-compatible primitive.
- **PII / GDPR posture.** Hostnames may embed regulated
  information (`payments-prod-frankfurt-pci-zone-3`).
  Restrict via Splunk RBAC on the CIM Performance indexes
  for audiences without "see infrastructure naming" auth.
  Per ROADMAP §1a, Better Map never sends event data outside
  `splunkd:8089`.
- **No OT safety dependency.** This recipe is pure IT
  infrastructure performance. If your CIM Performance model
  also ingests OT-zone equipment (PLC CPU, HMI memory),
  filter those hosts OUT here (`NOT dest IN ("plc-*", "hmi-*",
  "rtu-*")`) and put them in a SEPARATE recipe with
  `ot_safety_relevant: true` per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — a CPU-bound PLC needs a fundamentally different
  operator response than a CPU-bound web server, and the two
  should not visually compete on the same map.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented CIM Performance schema and tstats
contract from [`~/.cursor/skills/splunk-cim/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/cim-performance/markers.md),
but it has not been dispatched against a tenant with CIM
Performance accelerated AND an A&I lookup carrying lat/long. A
maintainer with REST auth to such a tenant should:

1. Confirm Performance is accelerated:
   `| datamodel Performance | head 1`.
2. Confirm the A&I lookup carries lat/long:
   `| inputlookup asset_lookup_by_str | where isnotnull(lat) |
   stats count`.
3. Run the recipe SPL and confirm the panel renders at least
   one marker per known-breaching host.
4. Tune the three thresholds to the tenant's SLO documentation.
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app: "Splunk_SA_CIM"`),
   and submit a follow-up PR.
