---
schema_version: 1
id: cim-network-traffic--markers
source:
  id: cim-network-traffic
  display_name: "CIM Network Traffic"
  pattern: splunk-cim
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-17"
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
  - name: value
    type: integer
    example: "847"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Splunk CIM skill — Network Traffic data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# CIM Network Traffic — markers

Render outbound (or inbound) network flows on a world map by
geocoding the `dest` IP with Splunk's built-in `iplocation` command
(MaxMind GeoLite2). One cluster per geographic region, sized by
event count, coloured by country. The canonical "where is my
traffic going?" panel for a SecOps tenant.

## 1. Source description

Splunk's **Network Traffic** Common Information Model (CIM) data
model normalizes events from firewalls, proxies, IDS / IPS, NetFlow
exporters, and packet brokers into a stable schema. Any sourcetype
that maps the CIM-required fields (`src`, `dest`, `bytes`, `action`,
`transport`, …) and is tagged `network` + `communicate` participates
in the data model — meaning this recipe is **vendor-agnostic** at
the SPL layer. It runs against:

- Palo Alto Firewall (`pan:traffic`), Cisco ASA, Cisco FTD
- Splunk Stream wire-data (`stream:ip`, `stream:tcp`)
- Cisco SD-WAN flow data, Meraki MX flow data
- NetFlow / sFlow / IPFIX via `Splunk_TA_netflow`
- Cisco Secure Firewall eStreamer (`cisco:secure-firewall:connection`)

The unifying contract: `tag=network tag=communicate` selects every
event the CIM Network Traffic data model has been told about.

**Typical sourcetype / index:** anything tagged `network communicate`
(check `| tstats values(sourcetype) WHERE \`cim_Network_Traffic_indexes\`
tag=network tag=communicate`); typical index is `network` or the
vendor-specific index (`pan_logs`, `cisco_secure_fw`, etc.). This
recipe queries the data-model accelerated summary, so the source
index does not appear in the SPL — that is the whole point of CIM.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS event_count FROM datamodel=Network_Traffic WHERE All_Traffic.action="allowed" earliest=-24h latest=now BY All_Traffic.dest
| rename All_Traffic.dest AS dest
| where match(dest, "^\d+\.\d+\.\d+\.\d+$")
| iplocation dest
| where isnotnull(lat) AND isnotnull(lon)
| rename dest AS id, Country AS dest_country, event_count AS value
| fields id, lat, lon, dest_country, value
| sort - value
| head 500
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true … FROM datamodel=Network_Traffic`** —
  reads the CIM-accelerated data model summary, NOT raw events. On
  a CIM-compliant install this returns the same answer as a raw
  search in 1/10th the time and 1/100th the load. `summariesonly=true`
  is the explicit promise "I want accelerated data only" — falls
  through cleanly to zero results (not raw scan) if acceleration is
  not enabled, which is a SAFER failure than a 20-minute raw scan
  the dashboard never finishes.
- **`WHERE All_Traffic.action="allowed"`** — filter at the
  data-model layer; otherwise a `where action=...` after `stats`
  re-reads every summary row. Change to `"blocked"` to flip the
  panel to a "where was traffic denied?" SOC view.
- **`BY All_Traffic.dest`** — the bucketing key; one row per unique
  destination IP.
- **`| where match(dest, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4-only
  filter. Drop this if your environment is IPv6-heavy; replace with
  a more permissive regex or pass to `iplocation` directly (which
  handles v6).
- **`| iplocation dest`** — Splunk's built-in command. Returns
  `City`, `Region`, `Country`, `lat`, `lon`. No third-party API,
  no outbound network call — uses the MaxMind GeoLite2 database
  shipped with Splunk Enterprise/Cloud.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drop
  private-range IPs (10.x, 172.16.x, 192.168.x) that `iplocation`
  cannot resolve. They render at `(0, 0)` if you do not filter —
  the infamous "Null Island" cluster.
- **`| rename dest AS id, Country AS dest_country, event_count AS
  value`** — adopt Better Map's auto-detected aliases. `id` is in
  the ID alias list (drilldown / cross-panel works without
  configuring `idField`); `lat` / `lon` are already canonical; and
  `value` is in the VALUE alias list (drives the size encoding
  automatically in renderers that consume it).
- **`| head 500`** — render budget. The markers layer renders 10k
  points smoothly per ROADMAP §7c; 500 keeps the panel pleasant
  to interact with for a security investigator. Raise to 5000 for
  a forensic deep-dive view; raise to the data limit and switch
  `pointRenderer` to `"hexbin"` (one tile per H3 cell) for a
  strategic overview.

## 3. Expected fields

| field        | type    | example         |
|--------------|---------|-----------------|
| id           | string  | 203.0.113.45    |
| lat          | number  | 37.7749         |
| lon          | number  | -122.4194       |
| dest_country | string  | US              |
| value        | integer | 847             |

All five appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **Auto-detect handles lat / lon / id / value.** The SPL's
  `rename` aligns every binding field to Better Map's
  canonical-alias list (`lat`, `lon`, `id`, `value`), so no
  `latField` / `lonField` / `idField` override is needed.
  `dataFitness.js` picks them up automatically.
- **`pointRenderer: "cluster"`** — at world zoom the 500 markers
  will overlap heavily in CDN-dense regions (US-east, Frankfurt,
  Dublin, Tokyo). Clustering buckets nearby markers into a single
  numbered circle; click to zoom in and split. Switch to `"heatmap"`
  for an aggregate density read, or `"hexbin"` for an
  area-neutral H3 cell aggregation that holds its shape at all
  zoom levels.
- **`dest_country` flows through automatically** as a feature
  property. It can drive a per-country colour ramp via the
  `palette` formatter option, or be rendered in marker popups
  / tooltips with no further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will render every recipe's panel against a
preloaded sample dataset and check in the resulting PNGs alongside
the recipe markdown._

## 6. Gotchas

- **CIM data-model acceleration MUST be enabled** on the
  `Network_Traffic` data model for `summariesonly=true` to return
  anything. Confirm in Settings → Data models → Network Traffic →
  Acceleration. If accel is OFF, the dashboard panel returns ZERO
  results (the correct, fail-safe behaviour). If you cannot
  enable acceleration in your tenant, change the recipe to
  `summariesonly=false` (much slower; not recommended for any
  panel that auto-refreshes).
- **MaxMind database licensing.** Splunk Enterprise ships with the
  free MaxMind GeoLite2 database. For higher accuracy / commercial
  use, swap in MaxMind GeoIP2 via the Splunk admin UI. The recipe
  is unchanged — `iplocation` reads whichever database is
  configured.
- **Time range.** The recipe hard-codes `earliest=-24h latest=now`
  so it works in a panel without a dashboard time picker. Replace
  with `earliest=$earliest$ latest=$latest$` once you wire the
  recipe into a dashboard with a time-range input.
- **`tag=network communicate` membership.** If your data is
  classified for the data model under DIFFERENT tags (some
  Splunk Cloud tenants override the CIM tag stanzas), check
  `| eventtypes` for your sourcetype and re-tag if needed. This
  is a CIM-compliance issue, not a Better Map issue.
- **`Null Island` cluster.** Forgot the `where isnotnull(lat) AND
  isnotnull(lon)` filter? Every private IP renders at `(0, 0)`.
  The cluster off the coast of Ghana is your private RFC-1918
  traffic. Add the filter; the SOC team will thank you.
- **PII / GDPR posture.** Per ROADMAP §1a (binding), Better Map
  NEVER sends event data outside `splunkd:8089`. `iplocation`
  runs server-side against the local MaxMind database — no
  outbound geocoding API call. If your tenant blocks
  `Splunk_SA_CIM` for compliance reasons, this recipe will not
  work; switch to a hand-curated `outputlookup` of allow-listed
  destination IPs.
- **No OT safety dependency.** This recipe is pure IT network
  traffic. If your `Network_Traffic` data model ALSO ingests
  passive DPI of an OT zone (Cisco Cyber Vision, Claroty), filter
  THOSE sourcetypes out of this panel (`NOT sourcetype IN
  ("cisco:cv:*", "claroty:*")`) and put them in a DEDICATED
  recipe with explicit OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, follows the documented Splunk CIM contract, and uses only
shipping Splunk built-ins (`tstats`, `iplocation`, `Splunk_SA_CIM`).
It has not been dispatched against the v1.7-prep lab tenant in this
PR because non-interactive admin auth is not present in the agent
workspace. A maintainer with REST auth to a CIM-accelerated tenant
should:

1. Run the recipe SPL with `summariesonly=false` first to confirm
   the data model has data for the queried time range.
2. Re-run with `summariesonly=true` (the recipe shape) to confirm
   acceleration is alive and returns the same shape.
3. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
