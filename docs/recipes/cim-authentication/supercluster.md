---
schema_version: 1
id: cim-authentication--supercluster
source:
  id: cim-authentication
  display_name: "CIM Authentication"
  pattern: splunk-cim
layer:
  id: supercluster
  display_name: Supercluster
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
    example: "52.3676"
  - name: lon
    type: number
    example: "4.9041"
  - name: src
    type: string
    example: "203.0.113.45"
  - name: src_country
    type: string
    example: "NL"
  - name: src_city
    type: string
    example: "Amsterdam"
  - name: auth_count
    type: integer
    example: "1247"
  - name: distinct_users
    type: integer
    example: "23"
  - name: success_rate
    type: number
    example: "0.83"
required_formatter_options:
  - pointRenderer
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (failed-auth source-IP overview)"
    path: "docs/recipes/cim-authentication/markers.md"
  - description: "Companion recipe — same source, heatmap layer (auth-density smoothing)"
    path: "docs/recipes/cim-authentication/heat.md"
  - description: "Companion recipe — same source, H3 hexbin layer (jurisdictional roll-up)"
    path: "docs/recipes/cim-authentication/h3.md"
  - description: "Pattern reference — supercluster layer with zoom-adaptive clustering"
    path: "docs/recipes/csv-lookup-geo/supercluster.md"
  - description: "Pattern reference — supercluster layer on per-device inventory"
    path: "docs/recipes/meraki/supercluster.md"
  - description: "Splunk CIM skill — Authentication data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — risk-based alerting + credential abuse context"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# CIM Authentication — supercluster

Render every source IP that has produced ANY authentication event
(success OR failure) over a 24h window as a zoom-adaptive cluster
on a world map. At world zoom you see cluster bubbles per continent
("12k auth sources from North America, 8k from Europe, …"); at
country zoom you see per-metro clusters ("4.2k from London, 3.1k
from Paris, …"); at city zoom you see individual source IPs. The
canonical "global enterprise authentication footprint" panel for an
**identity-team overview** — distinct from the
[cim-authentication/markers](../cim-authentication/markers.md) recipe
which deliberately filters to failed auths only (SOC-centric), and
distinct from the [cim-authentication/heat](../cim-authentication/heat.md)
recipe which smoothes density (executive briefings). The supercluster
shape preserves per-source-IP identity (click-to-zoom drilldown)
while keeping cluster-overlap manageable for 50k+ unique sources.

## 1. Source description

Splunk's **Authentication** Common Information Model (CIM) data
model normalizes login events from IdPs, VPN concentrators,
operating systems, applications, and cloud control planes into a
stable schema. See
[`cim-authentication/markers`](../cim-authentication/markers.md) §1
for the full list of contributing sourcetypes (AD, Entra ID, Okta,
AWS CloudTrail, Cisco Duo / ISE / AnyConnect, Linux PAM, Workday,
GitHub Enterprise, …).

This recipe is the **global-footprint view**: it aggregates ALL
auth events (not just failures) per source IP, computes a
success-rate alongside the raw count, and emits one row per unique
geocoded source. The supercluster formatter takes care of zoom-
adaptive aggregation client-side — no need to pre-aggregate by
country / metro in SPL. The result is a panel that scales gracefully
from a small tenant (500 source IPs) to a global enterprise
(100k+ source IPs across 200+ countries).

**Typical sourcetype / index:** anything tagged `authentication`.
Same detection-engine sources as
[`cim-authentication/markers`](../cim-authentication/markers.md).
The recipe queries the CIM-accelerated data model summary, so the
source index does not appear in the SPL.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS auth_count,
    dc(Authentication.user) AS distinct_users,
    sum(eval(if(Authentication.action="success", 1, 0))) AS success_count
  FROM datamodel=Authentication WHERE earliest=-24h latest=now
  BY Authentication.src
| rename Authentication.src AS src
| where match(src, "^\d+\.\d+\.\d+\.\d+$")
| iplocation src
| where isnotnull(lat) AND isnotnull(lon)
| eval success_rate=round(success_count / auth_count, 2)
| rename src AS id, City AS src_city, Country AS src_country
| eval src=id
| fields id, lat, lon, src, src_country, src_city, auth_count, distinct_users, success_rate
| sort - auth_count
| head 50000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true ... FROM datamodel=Authentication
  WHERE earliest=-24h latest=now`** — accelerated CIM
  Authentication aggregation. Unlike the markers companion (which
  filters to `Authentication.action="failure"` at the data-model
  layer for SOC focus), this recipe filters NOTHING — every auth
  event contributes to the cluster, regardless of outcome. The
  supercluster shape is about FOOTPRINT, not threats.
- **`sum(eval(if(Authentication.action="success", 1, 0))) AS
  success_count`** — count successful auths per source, used to
  derive `success_rate` downstream. The `eval(if(...))` inside
  `sum` is the canonical SPL idiom for conditional counting
  inside `tstats`.
- **`where match(src, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4 only
  guard. CIM Authentication's `src` field sometimes carries
  hostname (`workstation-42.example.com`), MAC, or IPv6 —
  `iplocation` only handles IPv4 reliably. For IPv6 coverage,
  add a parallel pipeline branch with the IPv6-aware
  `iplocation` parameter (Splunk 9.0+).
- **`iplocation src`** — built-in MaxMind GeoLite2 geocoding.
  Same caveat as
  [`cim-authentication/markers`](../cim-authentication/markers.md):
  public-internet IPs resolve; private RFC 1918 sources resolve
  to null and drop out via `where isnotnull(lat) AND isnotnull(lon)`.
  For internal-workstation footprint panels, use a customer-
  curated `internal_hosts_geo.csv` lookup instead.
- **`eval success_rate=round(success_count / auth_count, 2)`** —
  rounded success ratio for the popup. A source with `auth_count
  =1247, success_count=1035, success_rate=0.83` reads cleanly in
  the popup; a source with `success_rate=0.02` and high count
  is a brute-force attacker by definition.
- **`rename src AS id, City AS src_city, Country AS src_country`**
  + **`eval src=id`** — adopt Better Map's `id` canonical alias
  for drilldown stability, then re-create the `src` field for
  the popup (the rename consumed it). The double-existence of
  `src` (as both `id` and `src`) is intentional and the auto-
  aggregation rules handle it cleanly.
- **`head 50000`** — generous cap. The supercluster formatter
  scales well into the 50-100k row range; below this cap, no
  pre-aggregation needed. Above 100k, switch to the
  [`cim-authentication/h3`](../cim-authentication/h3.md) recipe
  which pre-aggregates in SPL.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field          | type    | example       |
|----------------|---------|---------------|
| id             | string  | 203.0.113.45  |
| lat            | number  | 52.3676       |
| lon            | number  | 4.9041        |
| src            | string  | 203.0.113.45  |
| src_country    | string  | NL            |
| src_city       | string  | Amsterdam     |
| auth_count     | integer | 1247          |
| distinct_users | integer | 23            |
| success_rate   | number  | 0.83          |

All nine fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — the ONLY required setting.
  The formatter's supercluster renderer takes care of
  per-zoom-level aggregation client-side via the supercluster
  algorithm shipped in `@splunk/better-map`. Default cluster
  settings (`clusterMaxZoom: 14`, `clusterRadius: 50`) are
  right for the global-enterprise overview use case; raise
  `clusterMaxZoom` to 16 for per-building-zoom drilldown, lower
  `clusterRadius` to 30-40 for denser per-metro displays.
- **No `idField` override needed.** Auto-detect finds `id`
  cleanly (Better Map's canonical alias).
- **No `markerColor` override.** Cluster bubbles use the
  formatter default; the count badge on each cluster carries the
  primary visual signal. For success-rate-coloured clusters,
  switch to the [cim-authentication/heat](../cim-authentication/heat.md)
  recipe (heat ramps colour by weight) or the
  [cim-authentication/h3](../cim-authentication/h3.md) recipe
  (h3 ramps colour by cell value).
- **Popup auto-renders `src`, `src_country`, `src_city`,
  `auth_count`, `distinct_users`, `success_rate` from the
  feature properties.** No `popupTemplate` override needed for
  the common case.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic IdP auth corpus seeded with global source
diversity for cluster-rendering stability._

## 6. Gotchas

- **CIM Authentication data-model acceleration MUST be enabled.**
  Same contract as
  [`cim-authentication/markers`](../cim-authentication/markers.md) §6 —
  confirm in Settings → Data models → Authentication →
  Acceleration. If OFF, the panel returns zero rows.
- **`success_rate` of 0.0 is NOT always an attack.** A backup
  service hammering an unreachable endpoint produces the same
  signal as a credential-stuffing source — distinguish via the
  `distinct_users` count (a backup service tries 1 user
  repeatedly; a credential stuffer tries 100+ users). For
  attack-focused panels, filter to `success_rate < 0.05 AND
  distinct_users >= 10` and switch to the markers companion
  (which uses the alert-red colour ramp).
- **The 50k row cap.** At 50k unique sources, the supercluster
  algorithm renders at ~200ms on a modern laptop browser.
  Above 100k, drop to the h3 companion for SPL-side pre-
  aggregation. Below 1k, the cluster shape is overkill — use
  the markers companion for direct per-source visibility.
- **IPv4-only filter discards IPv6 sources.** The `where match(src,
  "^\d+\.\d+\.\d+\.\d+$")` regex matches IPv4 only. Modern IdPs
  (Entra ID, Okta) routinely log IPv6 sources for IPv6-enabled
  client networks. For IPv6 coverage, add a second pipeline
  branch with the IPv6-aware `iplocation` parameter (Splunk
  9.0+ supports `prefix=ipv6_` for parallel geo-resolution).
- **`Authentication.src` is sometimes a hostname.** For
  hostname `src` values, `iplocation` returns null and the
  row drops out. For tenants where most auth sources are
  hostname-tagged (e.g., AD with reverse-DNS resolution
  enabled), replace `iplocation` with a join against a CMDB
  lookup keyed on hostname.
- **GeoIP database staleness.** Splunk auto-updates the
  GeoLite2 database monthly. Stale installs (>3 months) can
  mis-attribute newly-allocated IP ranges. Surface this in the
  validation gate when promoting `status: unverified` →
  `verified`.
- **No OT safety dependency.** CIM Authentication is by
  definition IT-system identity activity. For OT-system
  identity panels (rare — most OT systems don't have
  per-user auth), the data does not flow through the
  Authentication data model and this recipe doesn't apply.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`tstats`, `iplocation`,
`match`, `eval`, `if`, `round`, `rename`, `where`, `fields`,
`sort`, `head`) on the accelerated CIM Authentication data model.
Verification path mirrors
[`cim-authentication/markers`](../cim-authentication/markers.md) §"Verification
status" — confirm acceleration ON, dispatch via REST against a
populated tenant, drop into a Dashboard Studio panel with the §4
formatter JSON, confirm cluster bubbles render at world zoom and
fan out at city zoom. Promote to `status: verified` + fill in
`verified_against` in a follow-up PR.
