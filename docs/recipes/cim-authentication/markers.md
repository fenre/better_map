---
schema_version: 1
id: cim-authentication--markers
source:
  id: cim-authentication
  display_name: "CIM Authentication"
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
  - name: src_country
    type: string
    example: "NL"
  - name: src_city
    type: string
    example: "Amsterdam"
  - name: failure_count
    type: integer
    example: "417"
    drives_formatter_option: markerColor
  - name: distinct_users
    type: integer
    example: "23"
references:
  - description: "Splunk CIM skill — Authentication data model field reference"
    path: "~/.cursor/skills/splunk-cim/SKILL.md"
  - description: "Splunk ES skill — risk-based alerting context for credential abuse"
    path: "~/.cursor/skills/splunk-enterprise-security/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
required_formatter_options:
  - pointRenderer
  - markerColor
ot_safety_relevant: false
---

# CIM Authentication — markers

Render failed-authentication attempts on a world map by geocoding
the **source IP** (`src`) with Splunk's built-in `iplocation`
command. One marker per source-geo cluster, sized by failed
attempts, the colour ramp pushed into "alert red" for any source
above a brute-force-style threshold. The canonical "where are my
credential attacks coming from?" panel for a SOC overview.

## 1. Source description

Splunk's **Authentication** Common Information Model (CIM) data
model normalizes login events from IdPs, VPN concentrators,
operating systems, applications, and cloud control planes into a
stable schema. Any sourcetype that maps the CIM-required fields
(`src`, `dest`, `user`, `action`, `app`, …) and is tagged
`authentication` participates in the data model — meaning this
recipe is **vendor-agnostic** at the SPL layer. It runs against:

- Microsoft Active Directory (`WinEventLog:Security` event IDs
  4624/4625/4768/4769) via `Splunk_TA_windows`
- Microsoft 365 / Entra ID (`o365:management:activity`,
  `azure:eventhub`) via `Splunk_TA_microsoft-cloudservices`
- Okta (`OktaIM2:logEvent`) via `Splunk_TA_okta_identity_cloud`
- AWS CloudTrail `ConsoleLogin` events (`aws:cloudtrail`) via
  `Splunk_TA_aws`
- Cisco Duo (`cisco:duo:authentication`) via
  `Splunk_TA_cisco-duo`
- Cisco ISE (`cisco:ise:syslog`) and Cisco AnyConnect / Secure
  Client VPN logins
- Linux PAM / sshd / sudo (`linux_secure`) via
  `Splunk_TA_nix`
- Workday, Salesforce, GitHub Enterprise, Atlassian Cloud, …

The unifying contract: `tag=authentication` selects every event
the CIM Authentication data model has been told about. The single
most useful field for THIS recipe is `action="failure"` — one of
the three canonical CIM values (`success`, `failure`,
`error`) and the focus of every credential-abuse use case.

**Typical sourcetype / index:** anything tagged `authentication`
(check `| tstats values(sourcetype) WHERE
\`cim_Authentication_indexes\` tag=authentication`); typical index
is `authentication`, `wineventlog`, `okta`, `o365`, or the
vendor-specific index. This recipe queries the data-model
accelerated summary, so the source index does not appear in the
SPL — that is the whole point of CIM.

## 2. SPL recipe

```spl
| tstats summariesonly=true count AS failure_count, dc(Authentication.user) AS distinct_users FROM datamodel=Authentication WHERE Authentication.action="failure" earliest=-24h latest=now BY Authentication.src
| rename Authentication.src AS src
| where match(src, "^\d+\.\d+\.\d+\.\d+$")
| iplocation src
| where isnotnull(lat) AND isnotnull(lon)
| rename src AS id, City AS src_city, Country AS src_country
| where failure_count >= 5
| fields id, lat, lon, src_country, src_city, failure_count, distinct_users
| sort - failure_count
| head 500
```

Why this exact shape, line by line:

- **`| tstats summariesonly=true … FROM datamodel=Authentication`** —
  reads the CIM-accelerated data model summary, NOT raw events. On
  a CIM-compliant install this returns the same answer as a raw
  search in 1/10th the time. `summariesonly=true` is the explicit
  promise "I want accelerated data only" — falls through cleanly
  to zero results (not raw scan) if acceleration is not enabled.
- **`WHERE Authentication.action="failure"`** — filter at the
  data-model layer; otherwise a `where action=...` after `stats`
  re-reads every summary row. Change to `"success"` to flip the
  panel to a "where are my successful logins coming from?"
  posture-monitoring view (useful for "first-time geo" anomalies).
- **`count AS failure_count, dc(Authentication.user) AS distinct_users`** —
  two aggregates per source IP. `failure_count` is the raw attack
  volume; `distinct_users` distinguishes a **password-spray**
  pattern (many users × few attempts) from a **brute-force**
  pattern (one user × many attempts). Both render in the popup.
- **`BY Authentication.src`** — the bucketing key; one row per
  unique source IP.
- **`| where match(src, "^\d+\.\d+\.\d+\.\d+$")`** — IPv4-only
  filter. Drop this if your environment is IPv6-heavy; replace
  with a more permissive regex or pass to `iplocation` directly
  (which handles v6 cleanly).
- **`| iplocation src`** — Splunk's built-in command. Returns
  `City`, `Region`, `Country`, `lat`, `lon` from the MaxMind
  GeoLite2 database shipped with Splunk. Server-side, no
  outbound network call — respects ROADMAP §1a (binding) and the
  GDPR posture documented in `docs/security.md`.
- **`| where isnotnull(lat) AND isnotnull(lon)`** — drop the
  private-range IPs (10.x, 172.16.x, 192.168.x) that
  `iplocation` cannot resolve. Critical for THIS recipe because
  RDP-from-inside-the-LAN failures (legitimate ops staff fat-
  fingering passwords) would otherwise pile up at Null Island
  and visually dominate the map.
- **`| rename src AS id, City AS src_city, Country AS src_country`** —
  adopt Better Map's auto-detected aliases. `id` is in the ID
  alias list (drilldown / cross-panel works without configuring
  `idField`); `lat` / `lon` are already canonical from
  `iplocation`. `src_city` and `src_country` flow through as
  feature properties for the popup.
- **`| where failure_count >= 5`** — signal-to-noise filter. A
  single failed login is normal background noise (mistyped
  password, expired SSO token, mobile keyboard); 5+ within 24h
  from one source IP is the lower bound of "interesting". Raise
  to 50 for a quieter executive view, drop to 1 for a forensic
  investigation panel.
- **`| head 500`** — render budget. The markers layer renders
  10k points smoothly per ROADMAP §7c; 500 keeps the panel
  pleasant to interact with. Raise to 5000 for a forensic deep
  dive; raise to the data limit and switch `pointRenderer` to
  `"hexbin"` for a strategic geographic overview.

## 3. Expected fields

| field           | type    | example     |
|-----------------|---------|-------------|
| id              | string  | 203.0.113.45 |
| lat             | number  | 52.3676     |
| lon             | number  | 4.9041      |
| src_country     | string  | NL          |
| src_city        | string  | Amsterdam   |
| failure_count   | integer | 417         |
| distinct_users  | integer | 23          |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "markerColor": "#d62728"
}
```

Why this minimal config:

- **Auto-detect handles lat / lon / id / value.** The SPL's
  `rename` aligns every binding field to Better Map's
  canonical-alias list (`lat`, `lon`, `id`). `failure_count` is
  in the VALUE alias list and drives marker sizing
  automatically.
- **`pointRenderer: "cluster"`** — failed-login source IPs tend
  to cluster very densely in well-known regions (residential
  proxy farms in Eastern Europe, Africa, South-East Asia; cloud
  egress IPs in `us-east-1` / `eu-central-1`). Clustering
  buckets nearby markers into a single numbered circle — click
  to zoom in and split. Switch to `"hexbin"` for an
  area-neutral H3 cell aggregation that holds its shape at all
  zoom levels (useful for a strategic "which countries dominate
  my failure surface?" view).
- **`markerColor: "#d62728"`** — Better Map default is the
  soft teal `#8dd3c7`. For an authentication-failure panel that
  default is too friendly — every marker is by definition a
  failed login. Override to a Tableau "alert red" so a SOC
  analyst reads the panel as "warning surface" the moment it
  loads. The colour ramp can still be driven by
  `failure_count` via the `palette` formatter option for a
  per-marker severity overlay; the `markerColor` is the
  base / unsized swatch.
- **`src_country` and `src_city` flow through automatically** as
  feature properties for marker popups (`enablePopups: true` is
  the default per [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).
  The popup will show "`203.0.113.45` · Amsterdam, NL · 417
  failures across 23 users" with no further config.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will render every recipe's panel against a
preloaded sample dataset and check in the resulting PNGs alongside
the recipe markdown. For Authentication this means a synthetic
brute-force corpus seeded into the test tenant — see
[`tools/splunk-compose/`](https://github.com/fenre/better_map/tree/main/tools/splunk-compose)
once D5 ships._

## 6. Gotchas

- **CIM data-model acceleration MUST be enabled** on the
  `Authentication` data model for `summariesonly=true` to return
  anything. Confirm in Settings → Data models → Authentication →
  Acceleration. If accel is OFF, the dashboard panel returns
  ZERO results (the correct, fail-safe behaviour). If you cannot
  enable acceleration in your tenant, change the recipe to
  `summariesonly=false` (much slower; not recommended for any
  panel that auto-refreshes).
- **`tag=authentication` membership.** If your IdP / VPN events
  are NOT being tagged for the data model (a common Splunk
  Cloud finding — bring-your-own-app pipelines often skip
  `eventtypes.conf` and `tags.conf`), they will be invisible to
  this recipe. Check `| tstats count WHERE
  \`cim_Authentication_indexes\` tag=authentication BY
  sourcetype`. Any sourcetype you EXPECT to see that does NOT
  appear is a CIM-compliance gap, NOT a Better Map bug — fix
  the TA / `eventtypes.conf` and re-run.
- **`failure_count >= 5` threshold is workload-dependent.** A
  500-employee company sees ~50 legitimate "wrong password"
  failures a day. A 50,000-employee company sees ~5,000. Tune
  the threshold so the "Top 500" list is dominated by
  ATTACKERS, not by Monday-morning Active-Directory password-
  reset traffic. The RBA (Risk-Based Alerting) skill has a more
  sophisticated formula (`failure_count / dc(user)` ratio,
  `count by app`, etc.) — see [`~/.cursor/skills/splunk-rba/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/cim-authentication/markers.md).
- **MaxMind database licensing.** Splunk Enterprise ships with
  the free MaxMind GeoLite2 database. For higher accuracy /
  commercial use, swap in MaxMind GeoIP2 via the Splunk admin
  UI. The recipe is unchanged — `iplocation` reads whichever
  database is configured.
- **Time range.** The recipe hard-codes `earliest=-24h
  latest=now` so it works in a panel without a dashboard time
  picker. Replace with `earliest=$earliest$ latest=$latest$`
  once you wire the recipe into a dashboard with a time-range
  input.
- **VPN / proxy egress IPs distort the picture.** A heavy
  enterprise VPN concentrator emits failures from a single
  publish IP — every "China password-spray" marker may turn out
  to be your contractor laptop fleet behind a single VPN POP.
  Add `NOT src IN ("198.51.100.0/24")` or join against a known-
  good corporate IP allow-list before rendering. The RBA
  framework's `corporate_ip` lookup is the standard pattern.
- **`distinct_users` is the password-spray flag.** When the
  popup shows "417 failures across 23 users" you are almost
  certainly looking at password-spray (low-and-slow attempts
  against many accounts, one password each). When the popup
  shows "417 failures across 1 user" you are looking at brute-
  force (or a stuck mobile client; check before paging the
  on-call). Both warrant investigation; treat differently.
- **PII / GDPR posture.** Per ROADMAP §1a (binding), Better Map
  NEVER sends event data outside `splunkd:8089`. `iplocation`
  runs server-side against the local MaxMind database — no
  outbound geocoding API call. `src` IPs are pseudonymous; do
  NOT join against `identities.csv` (the ES Asset & Identity
  framework lookup) in this recipe — the username column
  would land in a public-facing dashboard and surface PII.
- **No OT safety dependency.** This recipe is pure IT
  identity-and-access. If your tenant ALSO logs OT operator
  console logins (RSLogix, FactoryTalk View, Wonderware InTouch,
  Siemens TIA Portal) under the `Authentication` data model,
  filter THOSE sourcetypes out of THIS panel (`NOT sourcetype IN
  ("rslogix:audit", "factorytalk:*")`) and put them in a
  DEDICATED recipe with explicit OT-safety annotations per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6 — a failed login to an HMI on a SIS bypass is a
  safety-relevant signal, not an IT credential-abuse signal.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, follows the documented Splunk CIM Authentication contract,
and uses only shipping Splunk built-ins (`tstats`, `iplocation`,
`Splunk_SA_CIM`). It has not been dispatched against the
v1.7-prep lab tenant in this PR because non-interactive admin
auth is not present in the agent workspace. A maintainer with
REST auth to a CIM-accelerated tenant should:

1. Run the recipe SPL with `summariesonly=false` first to confirm
   the Authentication data model has data for the queried time
   range and `action="failure"` is populated.
2. Re-run with `summariesonly=true` (the recipe shape) to confirm
   acceleration is alive and returns the same shape.
3. Tune `failure_count >= 5` for the tenant's baseline noise
   floor (see Gotchas).
4. Update the frontmatter to `status: verified`, fill in
   `verified_against`, and submit a follow-up PR.
