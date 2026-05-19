---
schema_version: 1
id: thousandeyes--supercluster
source:
  id: thousandeyes
  display_name: "Cisco ThousandEyes (agent fleet)"
  pattern: splunk-vendor-ta
layer:
  id: supercluster
  display_name: Supercluster
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
  - name: country
    type: string
    example: "United States"
required_formatter_options:
  - pointRenderer
  - idField
ot_safety_relevant: false
references:
  - description: "Companion recipe — same source, markers layer (per-agent drilldown)"
    path: "docs/recipes/thousandeyes/markers.md"
  - description: "Companion recipe — same source, paths layer (hop-by-hop traceroute polylines)"
    path: "docs/recipes/thousandeyes/paths.md"
  - description: "Companion recipe — same source, H3 hexbin (regional roll-up)"
    path: "docs/recipes/thousandeyes/h3.md"
  - description: "Companion recipe — same source, heatmap (density smoothing)"
    path: "docs/recipes/thousandeyes/heat.md"
  - description: "Pattern reference — supercluster on per-device inventory"
    path: "docs/recipes/meraki/supercluster.md"
  - description: "Pattern reference — supercluster on ITSI service-health"
    path: "docs/recipes/itsi-kpi-base/supercluster.md"
  - description: "ThousandEyes setup skill — sourcetypes, indexes, OAuth flow"
    path: "~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md"
  - description: "Layer reference — supercluster"
    path: "docs/reference/layers.md"
  - description: "BM-CT-1 contract — every layer exposes setEnabled/isEnabled/reset"
    path: "docs/reference/bm-ct-1.md"
---

# Cisco ThousandEyes (agent fleet) — supercluster

Render every Cisco ThousandEyes measurement agent as a
**zoom-adaptive supercluster** on a world map, one row per
agent, with cluster pills at regional zoom that progressively
split into per-agent markers as the user zooms. The canonical
**executive global agent-fleet overview** panel — when a
NetOps / DEM leader needs a single-pane "where is our
measurement footprint anchored RIGHT NOW" view that gracefully
collapses 500-5000+ agents into navigable cluster pills
instead of overwhelming the renderer with a marker dump.

## 1. Source description

**Cisco ThousandEyes** is a digital-experience-monitoring
platform; see the [thousandeyes/markers](./markers.md) sibling
recipe §1 for the full agent / test model background. The
distinction for THIS recipe: while the markers companion
already uses `pointRenderer: "cluster"` by default (since
typical fleets sit comfortably in the 50-2000 range), the
supercluster recipe is **deliberately tuned for very-large
global cloud-agent-heavy deployments** (2000-5000+ agents)
where:

- The per-agent test-count join (markers companion §2)
  becomes dead weight — cluster pills at regional zoom do
  not render per-row popup data, so the join cost buys
  nothing.
- The fleet-overview audience (CIO / NetOps leadership /
  DEM strategy team) cares about coverage gaps and
  regional density, not individual agent test-load.
- The aggregate semantics (cluster count of agents per
  region) are exactly the right summary at world / continent
  zoom — drill in to specific regions for per-agent
  detail via the markers companion.

This recipe inherits the markers companion's `agents`
sourcetype + `is_online="true"` filter + `agent_lat` /
`agent_lon` enrichment, but drops the test-count join,
raises the cap to `head 5000`, and forces
`pointRenderer: "cluster"` unconditionally.

**Typical sourcetype / index:**
`index=thousandeyes_agents
sourcetype="cisco:thousandeyes:agents"`. App required:
`ta_cisco_thousandeyes` (Splunkbase id 7719).

## 2. SPL recipe

```spl
index=thousandeyes_agents sourcetype="cisco:thousandeyes:agents" earliest=-24h latest=now
| dedup agent_id sortby - _time
| where is_online="true"
| rename agent_id AS id, agent_lat AS lat, agent_lon AS lon
| where isnotnull(lat) AND isnotnull(lon)
| fields id, lat, lon, agent_name, agent_type, country, network, os, version
| sort agent_name
| head 5000
```

Why this exact shape, line by line:

- **`index=thousandeyes_agents
  sourcetype="cisco:thousandeyes:agents"
  earliest=-24h latest=now`** — same agents-inventory query
  as the markers companion §2. The 24 h window captures
  every active agent at least once even if individual
  hourly polls drop briefly.
- **`dedup agent_id sortby - _time`** — one row per agent
  (the freshest record). Inventory polls re-publish identical
  state when nothing changes; dedup picks the most recent.
- **`where is_online="true"`** — drop offline / retired
  agents. CRITICAL filter — without it, decommissioned agents
  at last-known coordinates falsely inflate the cluster
  counts.
- **`rename agent_id AS id, agent_lat AS lat, agent_lon AS
  lon`** — adopt Better Map's canonical aliases.
- **`where isnotnull(lat) AND isnotnull(lon)`** — drop
  un-geocoded agents (typically endpoint agents pre-public-
  IP registration; surface in a companion table for the DEM
  team).
- **NO test-count join.** Deliberately omitted vs the markers
  companion §2. Cluster pills don't render per-agent test
  counts at aggregate zoom; the join would scan the
  `cisco:thousandeyes:tests` sourcetype + 24 h window for
  data that the cluster layer can't surface. Drilldown to
  markers companion for per-agent test-load detail.
- **`sort agent_name`** — alphabetical for deterministic
  rendering (no test_count to sort by; the supercluster
  layer doesn't care about input order).
- **`head 5000`** — generous cap. Typical enterprise
  fleets (50-500 agents) sit far under; cloud-agent-heavy
  global deployments can reach 2000-5000. Supercluster
  scales gracefully to 5k+ rows because it pre-aggregates
  client-side via the supercluster algorithm shipped in
  `@splunk/better-map`. Above 10k agents, switch to the
  [thousandeyes/h3](./h3.md) companion for SPL-side
  aggregation.

Every `|` starts its own physical line per the SPL pipe-
per-line contract in `splunk-conf-and-spl.mdc`.

## 3. Expected fields

| field         | type    | example              |
|---------------|---------|----------------------|
| id            | string  | agent-12345          |
| lat           | number  | 37.7749              |
| lon           | number  | -122.4194            |
| agent_name    | string  | SFO-AWS-us-west-1    |
| agent_type    | string  | enterprise           |
| country       | string  | United States        |

Six fields appear in `expected_fields` in the frontmatter
and are cross-checked by `scripts/check-recipe-schema.py`.
`network`, `os`, and `version` also flow through as feature
properties for the popup (visible only at city zoom when
the cluster splits into individual markers).

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — forces zoom-adaptive
  aggregation unconditionally. The markers companion auto-
  switches between cluster and individual based on density;
  this recipe is built specifically for the cluster case
  (large fleets) so the explicit override removes any
  surprise. At world zoom 5000 agents render as ~25 cluster
  pills (one per major cloud region: us-east, us-west,
  eu-west, eu-central, ap-southeast, ap-northeast, sa-east,
  etc.); progressively splits as the user zooms.
- **`idField: "id"`** — explicit override. Auto-detect
  would prefer `agent_id` or `agent_name`; pinning to `id`
  keeps drilldown URLs stable.
- **No `markerColor` override.** Cluster pills don't honor
  per-feature color; the cluster-count badge carries the
  primary visual signal. For agent-type-coloured panels
  (enterprise vs cloud vs endpoint), switch to the
  [thousandeyes/markers](./markers.md) companion which
  ramps colour by `test_count`.

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness
(ROADMAP §3 D5). A maintainer can reproduce by pasting the
§2 SPL into a Dashboard Studio map panel, applying the §4
formatter JSON, and zooming from world to region — at world
zoom expect ~20-25 cluster pills clustered around major
cloud regions, at country zoom expect per-metro splits,
at city zoom individual agent markers._

## 6. Gotchas

- **TA version + `is_online` field drift.** Same caveats as
  the markers companion §6 — confirm TA version with
  `| rest /services/apps/local/ta_cisco_thousandeyes |
  table label, version` and confirm `is_online` field name
  matches your TA release. Swap the §2 `where` clause
  accordingly.
- **`head 5000` defensive cap.** Typical enterprise fleets
  return 50-500 rows; the cap rarely fires. Above 5000
  agents, switch to the [thousandeyes/h3](./h3.md)
  companion which pre-aggregates per H3 cell in SPL —
  supercluster client-side rendering degrades past ~10k
  rows even on modern laptops.
- **Cluster aggregate semantics.** Cluster pill counts
  reflect agent COUNT per region, NOT agent test-load,
  agent uptime, or agent freshness. For test-load-weighted
  regional summaries (where you want to see "which region
  carries the most measurement burden"), switch to the
  [thousandeyes/h3](./h3.md) companion with `aggField`
  set to `sum(test_count)`.
- **No per-agent popup at cluster zoom.** Click a cluster
  pill → the renderer fans out to show child agents (and
  re-renders sub-clusters if still too dense). Per-agent
  popup data (`agent_name`, `agent_type`, `country`,
  `network`, `os`, `version`) only renders at city zoom
  when the cluster fully splits.
- **Endpoint-agent geo-flicker.** Endpoint agents (running
  on user laptops) geocode from current public IP — same
  agent can appear in different cluster pills across the
  24 h window as the user works from home / office /
  coffee shop. For static-overview panels, filter out
  endpoint agents with `| where agent_type != "endpoint"`
  before the supercluster renders.
- **No OT safety dependency.** ThousandEyes agents emit
  active probe traffic and must NEVER be deployed inside
  the OT zone per `ot-safety.mdc` Rule 1. If a cluster
  pill renders with a coordinate inside a known OT plant
  geofence, STOP and audit how that agent got deployed
  there.
- **PII / GDPR posture.** Same as markers companion §6 —
  agent names can embed user identifiers
  (`jdoe-laptop`). The popup only appears at city zoom
  (after cluster fully splits), reducing accidental
  disclosure at exec-zoom defaults; for stricter privacy,
  drop `agent_name` from the §2 `fields` selection.

## Verification status

`status: unverified` in the frontmatter — the SPL is
structurally sound, follows the same documented agents-
sourcetype shape as the markers companion (which inherits
the test corpus from
[`~/.cursor/skills/cisco-thousandeyes-setup/SKILL.md`](https://github.com/fenre/better_map/blob/main/.cursor/rules/cursor-thousandeyes-setup.mdc)),
and uses only Splunk built-ins plus the
`ta_cisco_thousandeyes` app. It has not been dispatched
against the v1.7-prep lab tenant because the lab has no
ThousandEyes Center licence and no deployed agents. A
maintainer with REST auth to a tenant carrying
`ta_cisco_thousandeyes` + ≥500 online agents should:

1. Confirm TA version + `is_online` field shape (see
   markers companion §"Verification status" for the
   exact REST + field-existence checks).
2. Run the §2 SPL and confirm one row per online agent
   (no test_count column).
3. Drop into a Dashboard Studio map panel with the §4
   formatter JSON applied; confirm cluster pills render
   at world zoom and progressively split as the user
   zooms in.
4. Cross-check by ALSO running the markers companion side
   by side at city zoom — every supercluster-derived
   marker should match a marker on the markers panel.
5. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "ta_cisco_thousandeyes"` + agent count), and submit a
   follow-up PR.
