---
schema_version: 1
id: cim-authentication--paths
source:
  id: cim-authentication
  display_name: "CIM Authentication"
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
    example: "alice@example.com__1747534800"
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
  - name: user
    type: string
    example: "alice@example.com"
  - name: src
    type: string
    example: "203.0.113.42"
  - name: src_country
    type: string
    example: "US"
  - name: action
    type: string
    example: "success"
required_formatter_options:
  - pathIdField
  - timeField
  - pathColor
  - pathArrows
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (failed-auth source-IP overview)"
    path: "docs/recipes/cim-authentication/markers.md"
  - description: "Companion recipe — same source, supercluster layer (global auth footprint)"
    path: "docs/recipes/cim-authentication/supercluster.md"
  - description: "Companion recipe — same source, heatmap (auth-density smoothing)"
    path: "docs/recipes/cim-authentication/heat.md"
  - description: "Companion recipe — same source, H3 hexbin (jurisdictional roll-up)"
    path: "docs/recipes/cim-authentication/h3.md"
  - description: "Pattern reference — paths layer with iplocation-geocoded hops + streamstats sequencing"
    path: "docs/recipes/cim-alerts/paths.md"
  - description: "Splunk CIM skill — Authentication data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — risk-based alerting context for ATO / impossible-travel detection"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "MITRE ATT&CK skill — T1078 (Valid Accounts) + T1110 (Brute Force) mapping"
    path: "~/.cursor/skills/splunk-mitre-attack/SKILL.md"
  - description: "Layer reference — paths"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# CIM Authentication — paths

Render **account-takeover (ATO) trajectories** by geocoding successful
authentication `src` IPs per user and stringing chronologically-
successive logins into a polyline. The canonical "impossible travel"
SOC panel — when a SOC analyst sees user `alice@example.com` logging
in from Seattle at 09:00 and Singapore at 09:15, the paths panel
draws that as a 14,000 km polyline across the Pacific in 15 minutes.
The sister panel to
[`cim-authentication/markers`](../cim-authentication/markers.md)
(failed-auth source overview),
[`cim-authentication/supercluster`](../cim-authentication/supercluster.md)
(global footprint), [`cim-authentication/heat`](../cim-authentication/heat.md)
(density smoothing), and [`cim-authentication/h3`](../cim-authentication/h3.md)
(jurisdictional roll-up) — together the five shapes give an
identity / SOC team source-, density-, jurisdiction-, footprint- AND
trajectory-attribution views on one CIM data model.

## 1. Source description

Splunk's **Authentication** Common Information Model (CIM) data
model normalizes login events from IdPs, VPN concentrators,
operating systems, applications, and cloud control planes. See
[`cim-authentication/markers`](../cim-authentication/markers.md) §1
for the full list of contributing sourcetypes (AD, Entra ID, Okta,
AWS CloudTrail, Cisco Duo / ISE / AnyConnect, Linux PAM, Workday,
GitHub Enterprise, …).

This recipe is the **ATO-trajectory view**: it focuses on the
narrower MITRE ATT&CK T1078 (Valid Accounts) / T1110 (Brute Force)
hypothesis — that a user account has been COMPROMISED and the
attacker is logging in alongside (or instead of) the legitimate
owner. The geometric signature is two or more successful logins
for the same `user`, from different geos, within a window shorter
than physical travel time would allow. Each polyline is one
user's per-day auth trajectory; any line spanning >1000 km in <1
hour is by definition impossible travel and warrants
investigation.

Unlike the [`cim-alerts/paths`](../cim-alerts/paths.md) sibling
(which groups by attacker `src` to reconstruct kill-chains), this
recipe groups by `user` — because for ATO detection, the entity
of interest is the COMPROMISED IDENTITY, not the attacker
infrastructure.

**Typical sourcetype / index:** anything tagged `authentication`.
Same detection-engine sources as
[`cim-authentication/markers`](../cim-authentication/markers.md).
The recipe queries the CIM-accelerated data model summary, so
the source index does not appear in the SPL.

## 2. SPL recipe

```spl
| tstats summariesonly=true count
  FROM datamodel=Authentication WHERE earliest=-24h Authentication.action="success"
  BY Authentication.user, Authentication.src, Authentication.action, _time span=5m
| rename "Authentication.user" AS user, "Authentication.src" AS src, "Authentication.action" AS action
| where match(src, "^\d+\.\d+\.\d+\.\d+$")
| iplocation src
| where isnotnull(lat) AND isnotnull(lon)
| rename Country AS src_country
| eval path_id=user . "__" . tostring(relative_time(now(), "-24h"))
| sort 0 path_id, _time
| streamstats current=true count AS seq BY path_id
| eval seq=seq-1
| eventstats count AS hops_in_path, dc(src_country) AS distinct_countries BY path_id
| where hops_in_path >= 2 AND distinct_countries >= 2
| rename path_id AS id
| fields id, seq, lat, lon, user, src, src_country, action, _time
| sort id, + seq
| head 5000
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true count FROM datamodel=Authentication
  WHERE earliest=-24h Authentication.action="success" BY
  Authentication.user, Authentication.src, Authentication.action,
  _time span=5m`** — accelerated CIM Authentication aggregation
  grouped by user + source IP + action + 5-minute time bucket.
  The `_time span=5m` is the key: it gives each unique
  (user, src) combo per 5-minute window its own row, preserving
  the chronological sequence needed for the paths layer. The
  filter to `action="success"` is critical — the impossible-
  travel signature requires SUCCESSFUL auths (a failed auth from
  a far-away IP is normal noise; a successful auth from a far-
  away IP is the ATO signal).
- **`where match(src, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4 only
  guard (same as the supercluster companion §2). For IPv6
  coverage, add a parallel pipeline branch with the IPv6-aware
  `iplocation` parameter (Splunk 9.0+).
- **`| iplocation src`** — geocode the source IP. The SAME IP can
  legitimately appear in multiple rows (user logs in from
  office → home → coffee shop, all in one day); the paths layer
  draws those as the path naturally — no dedup needed at the
  SPL layer.
- **`eval path_id=user . "__" . tostring(relative_time(now(),
  "-24h"))`** — synthesise the path identifier from the user
  identity + the start-of-window timestamp. All successful auths
  for the same user in the same 24h window land in the same path;
  restarting the panel tomorrow gives every user a new path_id
  (no cross-day contamination).
- **`sort 0 path_id, _time`** + **`streamstats current=true
  count AS seq BY path_id`** — the canonical paths-layer
  sequence pattern (mirrors
  [`cim-alerts/paths`](../cim-alerts/paths.md) §2). `seq`
  becomes a monotonic per-user vertex number, preferred over
  `_time` because immune to clock skew across multi-source IdP
  forwarders.
- **`eventstats count AS hops_in_path, dc(src_country) AS
  distinct_countries BY path_id`** + **`where hops_in_path >= 2
  AND distinct_countries >= 2`** — the ATO selectivity gate.
  Single-hop paths (a user logging in once from one IP) are
  noise; the polyline definition requires ≥2 vertices.
  `distinct_countries >= 2` is the stronger ATO selector — a
  user with all logins from the same country is benign (they're
  at home / office); a user with logins from 2+ countries in
  24h is either a frequent flier (rare) or a compromised
  account (common). For frequent-flier-friendly tenants
  (consultancies, multinationals), lower the threshold to
  `dc(src_city) >= 3` and add a corroborating risk-score
  filter from the
  [`splunk-rba` skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-rba/SKILL.md).
- **`head 5000`** — render-cap for 24h windows. A typical
  enterprise tenant (10k users) has 50-200 users matching the
  selectivity gate per day; the cap rarely fires. For large
  tenants (100k+ users), narrow the time window to 1h for
  near-real-time ATO trajectory rendering.

Every `|` starts its own physical line per the SPL pipe-per-line
contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field        | type    | example                          |
|--------------|---------|----------------------------------|
| id           | string  | alice@example.com__1747534800    |
| seq          | integer | 0                                |
| lat          | number  | 47.6062                          |
| lon          | number  | -122.3321                        |
| user         | string  | alice@example.com                |
| src          | string  | 203.0.113.42                     |
| src_country  | string  | US                               |
| action       | string  | success                          |

All eight fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`. `_time`
also flows through as a feature property for the popup.

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

- **`pathIdField: "id"`** — explicit (Better Map's canonical alias).
- **`timeField: "seq"`** — monotonic per-user vertex number from
  `streamstats`, immune to multi-IdP clock skew.
- **`pathColor: "#d62728"`** — Tableau "alert red", matching the
  [`cim-authentication/markers`](../cim-authentication/markers.md)
  failed-auth panel for visual cohesion: red on this paths panel
  reads as "compromised identity" against the same dashboard
  backdrop where red on the markers panel reads as "attacker
  source". For tenants that prefer to colour-separate ATO
  (paths) from brute-force (markers), switch to `#9333ea`
  (purple) on this panel.
- **`pathArrows: true`** — render direction-of-travel chevrons.
  Essential for ATO panels: without arrows, the polyline is
  ambiguous (which login came first?); with arrows, the panel
  reads as "the account moved FROM Seattle TO Singapore" and
  the impossible-travel signature is immediately legible.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). A maintainer can reproduce the panel by pasting the SPL above
into a Dashboard Studio map panel with Better Map as the
visualization and applying the formatter JSON in §4. The harness
will preload a synthetic IdP auth corpus seeded with impossible-
travel trajectories (5-10 compromised users with logins from 2+
distant countries within a 1-hour window) for kill-chain stability._

## 6. Gotchas

- **CIM Authentication data-model acceleration MUST be enabled.**
  Same contract as
  [`cim-authentication/markers`](../cim-authentication/markers.md) §6 —
  confirm in Settings → Data models → Authentication →
  Acceleration. If OFF, the panel returns zero rows.
- **`Authentication.action="success"` is non-negotiable.** ATO
  trajectories are about COMPROMISED accounts — successful
  logins from the attacker. Including failures would conflate
  brute-force attempts (which the markers companion already
  covers) with actual takeovers. For combined success+failure
  trajectories, drop the `action` filter and add a
  `pathColor: "> if(action='failure', '#fbbf24', '#d62728')"`
  dynamic option, but be aware the visual signal degrades.
- **VPN egress can produce false-positive impossible travel.**
  A user on a corporate VPN egressing through a centralized
  cloud gateway (Cloudflare Zero Trust, Cisco Secure Access,
  Zscaler) will appear to log in from the gateway location, not
  from their actual location. The same user on the same VPN
  from two different home locations will look identical;
  switching off VPN mid-day creates an impossible-travel
  signature that is benign. Filter out known VPN egress IPs
  with `| where NOT cidrmatch("203.0.113.0/24", src)` (the
  VPN CIDR varies per tenant) before the impossible-travel
  selectivity gate.
- **Frequent fliers / consultancies are noisy.** Users who
  legitimately work across multiple countries per day (travel
  consultants, MSPs supporting global clients via jump
  hosts, sales teams in customer offices) will repeatedly hit
  the `distinct_countries >= 2` gate without compromise. For
  these tenants, raise the threshold to `>= 3` and add a
  velocity check (`| eval km_traveled = ... | where
  km_traveled / hours_elapsed > 800`) to filter out only
  physically-impossible trajectories. The skeleton for the
  velocity calculation lives in the splunk-rba skill's
  `references/impossible_travel_macro.spl` example.
- **24-hour window is intentional but tunable.** Longer windows
  (7d/30d) conflate distinct trips into one path (a user
  travels to Tokyo on Monday and Berlin on Friday looks
  identical to a user compromised both days). Narrower
  windows (1h / 15m) lose the multi-day campaign shape (an
  attacker who logs in once a day to maintain persistence
  shows nothing in 1h windows). 24h is the SOC-shift default
  and matches the typical IdP session lifetime.
- **`hops_in_path >= 2 AND distinct_countries >= 2`
  selectivity.** The double-gate is intentional — `hops >= 2`
  is the polyline definition; `distinct_countries >= 2` is
  the ATO signal. Removing either breaks the recipe (no
  ATO signal without country diversity; no polyline without
  multiple hops). For PER-CITY granularity (catches lateral
  movement within a country), swap `distinct_countries` for
  `dc(src_city)`.
- **MITRE ATT&CK technique mapping.** Every line on this
  panel maps to MITRE T1078 (Valid Accounts) at minimum;
  combined with the markers companion's failed-auth
  signal, T1110 (Brute Force) becomes the joint hypothesis
  ("attacker brute-forced credentials in markers; same user's
  successful logins here trace the post-compromise activity").
  Per the [splunk-mitre-attack skill](https://github.com/fenre/better_map/blob/main/.cursor/skills/splunk-mitre-attack/SKILL.md),
  the supporting ES correlation searches should carry
  `action.correlationsearch.annotations.mitre_attack` =
  `T1078`/`T1110` for SOC-tool cross-referencing.
- **PII / GDPR posture.** The `user` field in the popup is
  a directly-identifying attribute. For privacy-sensitive
  tenants (EU regulated, healthcare, public-sector), replace
  `user` in §2 `fields` with `user_hash = md5(user)` for the
  panel and surface the cleartext `user` only behind a
  click-through drilldown that requires explicit
  authorization via Splunk RBAC.
- **No OT safety dependency.** Same as the supercluster
  companion §6 — CIM Authentication is by definition IT-
  system identity activity. OT-system identity events
  (rare) do not flow through this data model and this
  recipe doesn't apply.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound and uses only Splunk built-ins (`tstats`, `iplocation`,
`match`, `eval`, `sort`, `streamstats`, `eventstats`, `where`,
`fields`, `head`) on the accelerated CIM Authentication data model.
Verification path mirrors
[`cim-authentication/markers`](../cim-authentication/markers.md) §"Verification
status" — confirm acceleration ON, dispatch via REST against a
populated tenant carrying at least 5 distinct successful logins
per user across 2+ countries within a 24h window, drop into a
Dashboard Studio panel with the §4 formatter JSON, confirm
polylines render with directional arrows visible. Promote to
`status: verified` + fill in `verified_against` in a follow-up PR.
