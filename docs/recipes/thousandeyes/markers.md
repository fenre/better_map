---
schema_version: 1
id: thousandeyes--markers
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (agent fleet)"
  pattern: splunk-vendor-ta
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "ta_cisco_thousandeyes"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "agent-12345"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: agent_name
    type: string
    example: "SFO-AWS-us-west-1"
  - name: agent_type
    type: string
    example: "enterprise"
  - name: test_count
    type: integer
    example: "12"
    drives_formatter_option: markerColor
  - name: country
    type: string
    example: "United States"
required_formatter_options:
  - pointRenderer
  - idField
  - markerColor
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, paths layer (hop-by-hop traceroute polylines)"
    path: "docs/recipes/thousandeyes/paths.md"
  - description: "ThousandEyes setup skill — sourcetypes, indexes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Cisco products skill — ThousandEyes data model and example SPL"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
  - description: "Layer reference — markers"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# Cisco ThousandEyes (agent fleet) — markers

Render every Cisco ThousandEyes measurement agent as
a marker on the world map, positioned at the agent's
known location, sized by the number of active tests
the agent is currently executing. The canonical
"where are my probes anchored?" panel — the
companion to the
[thousandeyes/paths](./paths.md) recipe (which
shows the path each measurement TRAVERSES), but
here showing the START vertices: the agent fleet
itself.

## 1. Source description

**Cisco ThousandEyes** is a digital-experience-
monitoring (DEM) platform; see the
[thousandeyes/paths](./paths.md) sibling recipe for
the full background. The relevant distinction for
THIS recipe: the platform's measurement model has
two participants — **agents** (the probes — anchored
at fixed locations, run on enterprise hardware,
cloud VMs, or end-user endpoints) and **tests**
(the named measurements each agent runs against
configured targets — HTTP, DNS, voice, BGP,
path-vis, ...).

The path-vis recipe focuses on the per-test
hop-by-hop path. This recipe focuses on the per-
agent fleet inventory: **where is each agent
physically anchored, and how many tests does it
currently execute?** The natural shape when the
question is "is my agent footprint covering the
geographies I care about?" (geo coverage planning),
or "which agent is taking on the most measurement
load?" (capacity / topology review), or "which
region has the densest agent population for
high-confidence DEM coverage?" (Net-Ops / DEM
strategy).

The Cisco ThousandEyes App for Splunk
(`ta_cisco_thousandeyes`) lands agent data under
two sourcetypes:

- `cisco:thousandeyes:agents` — agent inventory
  records (one event per agent per polling cycle).
  Key fields: `agent_id`, `agent_name`, `agent_type`
  (`enterprise`, `cloud`, `endpoint`), `agent_lat`,
  `agent_lon`, `country`, `network`, `os`, `version`,
  `is_online`.
- Tests-per-agent associations surface in the
  `cisco:thousandeyes:tests` sourcetype or via the
  `tests_by_agent.csv` lookup published by the TA's
  hourly inventory job (varies by TA version — see
  §6 Gotchas).

This recipe queries the agents sourcetype, joins
against tests-by-agent to derive `test_count`, and
emits one marker per online agent.

**Typical sourcetype / index:**
`index=thousandeyes_agents
sourcetype="cisco:thousandeyes:agents"`. App
required: `ta_cisco_thousandeyes` (Splunkbase id
7719). The agent inventory poll runs hourly by
default; the `tests_by_agent.csv` lookup
refreshes on the same cadence.

## 2. SPL recipe

```spl
index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents" earliest=-24h latest=now
| dedup agent_id sortby - _time
| where is_online="true"
| rename agent_id AS id, agent_lat AS lat, agent_lon AS lon
| where isnotnull(lat) AND isnotnull(lon)
| join type=left id [
    search index=thousandeyes_tests sourcetype="cisco:thousandeyes:tests" earliest=-24h latest=now
    | stats dc(test_id) AS test_count BY agent_id
    | rename agent_id AS id
  ]
| fillnull value=0 test_count
| fields id, lat, lon, agent_name, agent_type, test_count, country, network, os, version
| sort - test_count, agent_name
| head 2000
```

Why this exact shape, line by line:

- **`index=thousandeyes_agents
  sourcetype="cisco:thousandeyes:agents"
  earliest=-24h latest=now`** — agents inventory
  poll over 24 h. The TA polls hourly by default;
  24 h guarantees every active agent appears at
  least once even if individual polls drop briefly.
- **`dedup agent_id sortby - _time`** — one row per
  agent (the freshest record). Inventory polls
  produce identical re-publishes when nothing
  changes; dedup picks the most recent state.
- **`where is_online="true"`** — drop offline /
  retired agents. An offline agent at last-known
  coordinates would render as a marker at that
  location, falsely implying live coverage.
  **CRITICAL** — without this filter, the panel
  looks better than reality (decommissioned
  agents still show as anchors).
- **`rename agent_id AS id, agent_lat AS lat,
  agent_lon AS lon`** — adopt Better Map's
  canonical aliases. `agent_lat` / `agent_lon` are
  the ThousandEyes-supplied agent coordinates
  (typically populated by the customer at agent
  registration time; some agent types are auto-
  geocoded from public IP — see §6 Gotchas).
- **`where isnotnull(lat) AND isnotnull(lon)`** —
  drop agents without registered location. An
  unmapped agent surfaces in the companion paths
  recipe via the `agent_ip` fallback geocoding,
  but in THIS recipe (which is about the agent
  fleet itself) an agent with no anchor coordinate
  is by definition uncovered. Surface in a
  companion table panel for the DEM team to
  backfill.
- **`join` subsearch (tests)** — count distinct
  active tests per agent. Bounded to the same 24 h
  window. `dc(test_id)` excludes test re-runs (an
  agent running test X every 5 min for 24 h is
  ONE test, not 288). The result drives the
  per-agent marker size in §4.
- **`fillnull value=0 test_count`** — agents with
  no active tests (newly deployed, idle) get NULL
  from the join; promote to 0 so the popup reads
  "0 tests" instead of blanks.
- **`sort - test_count, agent_name`** — most-loaded
  agents first; secondary sort by name for
  deterministic rendering.
- **`head 2000`** — render budget. A typical
  enterprise ThousandEyes deployment carries 50-500
  agents; global cloud-agent-heavy deployments can
  reach 1000-2000. The marker layer's auto-
  clustering at world zoom keeps the panel
  responsive even at the cap.

Every `|` starts its own physical line per the SPL
pipe-per-line contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example              |
|---------------|---------|----------------------|
| id            | string  | agent-12345          |
| lat           | number  | 37.7749              |
| lon           | number  | -122.4194            |
| agent_name    | string  | SFO-AWS-us-west-1    |
| agent_type    | string  | enterprise           |
| test_count    | integer | 12                   |
| country       | string  | United States        |

Seven fields appear in `expected_fields` in the
frontmatter and are cross-checked by
`scripts/check-recipe-schema.py`. `network`, `os`,
and `version` also flow through as feature
properties for the popup.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#9333ea"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — agents cluster
  geographically by datacenter / cloud region. A
  major cloud agent footprint puts dozens of
  agents in `us-east-1`, `us-west-2`, `eu-west-1`,
  etc.; cluster collapses to per-region markers at
  world zoom and fans out at region zoom.
- **`idField: "id"`** — explicit override. Auto-
  detect would prefer `agent_id` (which is the
  renamed `id`, identical content) or
  `agent_name` (the human-readable display);
  pinning to `id` keeps drilldown URLs stable
  against any future agent-name changes.
- **`markerColor: "#9333ea"`** — saturated purple,
  intentionally MATCHING the
  [thousandeyes/paths](./paths.md) recipe. A
  dashboard showing both panels reads the
  consistent purple as "ThousandEyes" — agents
  are the START vertices, paths are the
  TRAJECTORIES, both share the layer-type colour
  contract. Distinct from the
  [cyber-vision/markers](../cyber-vision/markers.md)
  recipe's blue (Cyber Vision = OT) and the
  [cim-alerts/markers](../cim-alerts/markers.md)
  red (Alerts = warning surface) — so an
  operator viewing a mixed-source dashboard reads
  the layers correctly.
- **`agent_name`, `agent_type`, `test_count`,
  `country`, `network`, `os`, `version` flow
  through automatically** as feature properties
  for the popup (`enablePopups: true` is the
  default). Click any agent marker → see its
  hardware / OS / network details + how many
  tests it runs.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose
harness (ROADMAP §3 D5). A maintainer can
reproduce the panel by pasting the SPL above into
a Dashboard Studio map panel with Better Map as
the visualization, applying the formatter JSON in
§4, and zooming to a region of interest. The
paths companion recipe renders well alongside —
shows the agent dots PLUS the path polylines
emanating from each agent to its targets._

## 6. Gotchas

- **`tests_by_agent` join shape varies across TA
  versions.** Pre-v3 of `ta_cisco_thousandeyes`
  shipped a `tests_by_agent.csv` lookup; v3+
  emits one `cisco:thousandeyes:tests` event per
  test-agent assignment and the join shifts to a
  search subsearch (the §2 SPL shape). Confirm
  your TA version BEFORE adopting the recipe:
  `| rest /services/apps/local/ta_cisco_thousandeyes
  | table label, version`. For pre-v3, swap the
  `join` block to `| lookup
  tests_by_agent.csv agent_id AS id OUTPUT
  test_count`.
- **`is_online` field name drift.** Some TA
  releases name the field `online`, `agent_online`,
  or `status="online"` instead of
  `is_online="true"`. Confirm with
  `index=thousandeyes_agents | head 1 | fields *`
  before adopting; swap the §2 `where` clause
  accordingly.
- **`agent_lat` / `agent_lon` provenance.**
  - **Enterprise agents** are typically GEO-
    annotated by the customer at deployment time
    (the install wizard prompts for site name +
    coordinates). These are the most accurate
    coordinates in the fleet.
  - **Cloud agents** (the ThousandEyes-hosted
    measurement points in AWS / Azure / GCP
    regions) get auto-geocoded by ThousandEyes
    from the cloud-region metadata — generally
    accurate to ~city level.
  - **Endpoint agents** (running on user
    laptops) are geocoded from the endpoint's
    public IP — which jumps to whatever the
    user's current ISP / VPN egress is. An
    endpoint agent's pin can move daily as the
    user works from home / office / coffee shop.
    For dashboards where endpoint-agent geo
    matters, consider filtering them out
    (`NOT agent_type="endpoint"`) and rendering
    them in a separate panel with an explicit
    "current-IP geo, may shift" annotation.
- **`test_count` vs measurement volume.** The
  recipe surfaces test COUNT (how many distinct
  tests the agent runs), NOT measurement
  VOLUME (the total measurements per test ×
  test count per polling interval). An agent
  with 5 tests running every 1 minute generates
  much more load than an agent with 50 tests
  running every 1 hour, but the `test_count`
  doesn't reveal this. For load-capacity
  panels, switch to `| stats sum(measurement_count)
  BY agent_id` against the per-measurement
  sourcetypes (`cisco:thousandeyes:http-server`,
  `cisco:thousandeyes:dns-server`, etc.).
- **Cluster vs individual marker rendering.**
  `pointRenderer: "cluster"` is the
  recommended default for typical enterprise
  fleets (50-500 agents). For very small
  fleets (≤20 agents), drop the cluster mode
  and render markers individually (`pointRenderer:
  "markers"`) — clusters of 1-2 agents look
  like rendering bugs.
- **Time range.** The recipe hard-codes
  `earliest=-24h latest=now`. The agents
  inventory poll runs hourly, so 24 h is more
  than enough — but narrowing below 1 h (e.g.
  for a real-time "where are my online agents
  right now?" panel) requires the
  `is_online="true"` filter to do all the
  liveness work, since the polling cadence
  guarantees no fresh state appears in
  windows narrower than an hour.
- **No OT safety dependency.** Same as the
  paths companion. ThousandEyes is an
  ACTIVE measurement platform — its agents
  emit probe traffic. Per the
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 1 boundary, ThousandEyes agents must
  NEVER be deployed inside the OT zone, and
  ThousandEyes path-vis tests must NEVER
  target any OT asset (PLC, HMI, DCS, RTU,
  SIS logic-solver, Level-0/1/2 endpoint).
  This recipe renders the agent fleet — if
  any agent in the result set has a
  coordinate inside a known OT plant
  geofence, STOP and audit how it got
  deployed there.
- **PII / GDPR posture.** Agent names embed
  deployment semantics (`SFO-AWS-us-west-1`,
  `LON-OFFICE-FLOOR3`) — generally pseudonymous
  but endpoint-agent names sometimes embed the
  user's name (`jdoe-laptop`). For
  privacy-sensitive deployments, replace
  `agent_name` in the §2 `fields` selection
  with `agent_id` only, and restrict access to
  the `thousandeyes_agents` index via Splunk
  RBAC for audiences without "see endpoint-
  agent ownership" authorisation. Per ROADMAP
  §1a, Better Map never sends event data
  outside `splunkd:8089`.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the documented
ThousandEyes sourcetype shape per
[`~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/cursor-thousandeyes-setup.mdc)
and [`~/.cursor/skills/cisco-products/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/cursor-products.mdc),
and uses only Splunk built-ins plus the
`ta_cisco_thousandeyes` app. It has not been
dispatched against the v1.7-prep lab tenant
because the lab has no ThousandEyes Center licence
and no deployed agents. A maintainer with REST auth
to a tenant carrying `ta_cisco_thousandeyes` +
at least one online agent should:

1. Confirm the TA version: `| rest
   /services/apps/local/ta_cisco_thousandeyes
   | table label, version`. For pre-v3, swap the
   §2 `join` to the lookup form per Gotchas.
2. Confirm agent inventory is flowing:
   `index=thousandeyes_agents earliest=-24h |
   stats dc(agent_id)`.
3. Confirm the `is_online` field name matches
   your TA's shape (see Gotchas).
4. Run the recipe SPL and confirm one marker per
   online agent renders.
5. Cross-check by ALSO running the paths
   companion side by side — the START vertex of
   every polyline should correspond to an agent
   marker on this panel.
6. Update the frontmatter to `status: verified`,
   fill in `verified_against` (include
   `splunk_app: "ta_cisco_thousandeyes"` and
   the agent/test counts), and submit a follow-up
   PR.
