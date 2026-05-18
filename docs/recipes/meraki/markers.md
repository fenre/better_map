---
schema_version: 1
id: meraki--markers
source:
  id: meraki
  display_name: "Cisco Meraki (devices)"
  pattern: splunk-vendor-ta
layer:
  id: markers
  display_name: Markers
status: unverified
last_verified_iso8601: "2026-05-18"
verified_against: null
splunk_apps_required:
  - id: "Splunk_TA_cisco_meraki"
    optional: false
expected_fields:
  - name: id
    type: string
    example: "Q2XX-XXXX-XXXX"
    drives_formatter_option: idField
  - name: lat
    type: number
    example: "37.7749"
  - name: lon
    type: number
    example: "-122.4194"
  - name: name
    type: string
    example: "SF HQ - Floor 3 AP"
  - name: model
    type: string
    example: "MR46"
  - name: status
    type: string
    example: "online"
    drives_formatter_option: markerColor
  - name: network_name
    type: string
    example: "SF HQ"
references:
  - description: "cisco-meraki-ta-setup skill — TA install, indexes, account config, input types"
    path: "~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md"
  - description: "cisco-products skill — Meraki sourcetypes, fields, sample queries"
    path: "~/.cursor/skills/cisco-products/SKILL.md"
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

# Cisco Meraki (devices) — markers

Render the Meraki device inventory on a world map — one marker
per registered MR (wireless AP) / MS (switch) / MX (security
appliance) / MV (camera) / MT (sensor), positioned at the
device's lat/lng as set in the Meraki Dashboard, coloured by
operational status (`online` / `alerting` / `offline` /
`dormant`). The canonical "where is my Meraki fleet, what's
its health right now?" panel — typically rendered as the top
panel of a NetOps overview dashboard alongside per-site KPIs.

## 1. Source description

The **Cisco Meraki Add-on for Splunk** (`Splunk_TA_cisco_meraki`,
Splunkbase ID 5580) polls the Meraki Dashboard REST API on a
configurable cadence and indexes the responses as Splunk events.
The TA ships ~42 modular inputs across `core`, `devices`,
`wireless`, `summary`, `api`, `vpn`, `licenses`, `switches`,
`organization`, and `sensor` input groups; THIS recipe consumes
the `meraki:devices` sourcetype (part of the `core` / `devices`
input groups) which is the device inventory feed.

Each event represents one device (MR / MS / MX / MV / MT) in the
configured Meraki organization. The polling cadence is set per
input (default 600 s) — fast enough that a panel that auto-
refreshes every 60 s will reflect device-status changes within
2 polling cycles.

**One-time setup before this recipe will return data:**

```bash
# Install + configure the TA, create the meraki index, register
# the organization, and enable the devices input. See the
# cisco-meraki-ta-setup skill for the full prerequisite list.
bash skills/cisco-meraki-ta-setup/scripts/setup.sh
bash skills/cisco-meraki-ta-setup/scripts/configure_account.sh \
  --name "MY_ORG" \
  --api-key-file /tmp/meraki_api_key \
  --org-id "<org_id>" \
  --region global \
  --auto-inputs \
  --index meraki
```

This setup fence is documentation only — `scripts/check-recipe-schema.py`
exempts §1 fences from the pipe-per-line gate; the panel SPL is in
§2 and that one is enforced.

**Typical sourcetype / index:** `sourcetype="meraki:devices"`,
`index=meraki` (both are the TA defaults; if your install renames
the index, substitute below).

**Device geocoding contract:** The Meraki Dashboard stores
per-device `lat`/`lng` either from the device's first
self-reported geolocation (MR access points beacon their
position via the cloud) OR from a manual operator entry in the
Dashboard map view. Devices without a configured location come
through with `lat=null, lng=null` and are filtered out of the
panel — they need an operator to drag them onto the Dashboard
map before they will render here.

## 2. SPL recipe

```spl
index=meraki sourcetype="meraki:devices" earliest=-1h latest=now
| dedup serial sortby - _time
| where isnotnull(lat) AND isnotnull(lng)
| rename serial AS id, lng AS lon, networkName AS network_name
| eval status=coalesce(status, "unknown")
| fields id, lat, lon, name, model, status, network_name
| sort id
| head 5000
```

Why this exact shape, line by line:

- **`index=meraki sourcetype="meraki:devices"`** — both are the
  TA defaults. If your install renamed the index (some
  multi-tenant Splunk Cloud stacks add a prefix like
  `cisco_meraki`), substitute. Sourcetype is fixed by the TA.
- **`earliest=-1h latest=now`** — the devices input polls
  every 600 s by default, so a 1 h window captures 5–6 latest
  snapshots per device. The `dedup serial sortby -_time` line
  then keeps the freshest snapshot per device, giving a
  near-real-time inventory view. Raising the window to `-24h`
  gives a more forgiving "is this device EVER online during
  business hours?" panel; dropping to `-30m` makes the panel
  more sensitive to brief network blips.
- **`| dedup serial sortby -_time`** — one row per device,
  taking the newest snapshot. This is the canonical Splunk
  pattern for "give me the latest state per entity"; it is
  more efficient than `| stats latest(status) AS status,
  latest(lat) AS lat, … BY serial` because Meraki ships every
  field on every event (full snapshot) so `latest` of every
  field is redundant.
- **`| where isnotnull(lat) AND isnotnull(lng)`** — drop
  devices not yet placed on the Meraki Dashboard map. These
  are a real operational signal (someone unboxed and brought
  online a device but never assigned it a location), but they
  do not belong on a geographic panel. Surface them in a
  COMPANION table panel ("Devices missing location data:
  <count>") so the operator sees the gap.
- **`| rename serial AS id, lng AS lon, networkName AS network_name`** —
  THE critical line. Meraki's API uses **`lng`** (the lazy-
  3-character "longitude"), NOT `lon` / `longitude`. Better
  Map's `dataFitness.js` auto-detect looks for `lon` /
  `longitude` / `long`, so without this rename the formatter
  picks `lng` up as "an unknown numeric column" and renders
  nothing. `serial` → `id` aligns to Better Map's ID alias
  list so drilldowns / cross-panel selection work without
  overrides. `networkName` → `network_name` is style — Meraki
  uses camelCase JSON keys, the recipe normalises to
  snake_case so popup labels read consistently with the rest
  of the v1.7 recipes.
- **`| eval status=coalesce(status, "unknown")`** — newly
  unboxed devices can briefly emit a snapshot without a
  `status` value. `coalesce(... , "unknown")` keeps them
  rendering with the catch-all colour instead of as a
  `null`-coloured marker (which the renderer interprets as
  "no marker at all").
- **`| head 5000`** — render budget. The markers layer renders
  10k points smoothly per ROADMAP §7c; 5,000 covers all but
  the very largest Meraki fleets (the biggest commercial-real-
  estate customers run ~30k devices and need either client-
  side filtering or a switch to `pointRenderer: "cluster"` /
  `"hexbin"`). Most operational deployments are <500 devices;
  the limit is defensive.

## 3. Expected fields

| field        | type    | example           |
|--------------|---------|-------------------|
| id           | string  | Q2XX-XXXX-XXXX    |
| lat          | number  | 37.7749           |
| lon          | number  | -122.4194         |
| name         | string  | SF HQ - Floor 3 AP|
| model        | string  | MR46              |
| status       | string  | online            |
| network_name | string  | SF HQ             |

All seven appear in `expected_fields` in the frontmatter and are
cross-checked by `scripts/check-recipe-schema.py`.

## 4. Recommended formatter config

```json
{
  "pointRenderer": "cluster",
  "idField": "id",
  "markerColor": "#2ca02c"
}
```

Why this minimal config:

- **`pointRenderer: "cluster"`** — Meraki fleets concentrate
  geographically (one MR per WAP, ~6 WAPs per office floor,
  ~3–5 floors per building, plus an MS / MX per IDF). At
  world zoom every site collapses to a dense cluster; at
  building zoom the cluster fans out into individual markers.
  `"cluster"` is the only choice that scales from world view
  to building view without the operator changing settings.
  Switch to `"markers"` only if your fleet is <50 devices and
  always rendered at a fixed zoom.
- **`idField: "id"`** — explicit override, even though the
  SPL renames `serial` → `id`. Reason: a Meraki serial
  (`Q2XX-XXXX-XXXX`) is short enough that the auto-detector
  might prefer the `name` column ("SF HQ - Floor 3 AP" reads
  more "id-like" to a heuristic). Pinning `idField` to `id`
  guarantees the drilldown URL uses the stable, immutable
  serial — site names change, MAC addresses change, serials
  don't.
- **`markerColor: "#2ca02c"`** — Tableau-green default,
  reading as "healthy device" at first load. Override the
  base colour ONLY; the per-marker colour can additionally
  be ramped by the `status` field via the `palette`
  formatter option — supply a discrete palette
  (`["online", "alerting", "offline", "dormant"]` → `["#2ca02c",
  "#ff7f0e", "#d62728", "#7f7f7f"]`) so the marker colour
  encodes operational state, not just "this is a marker".
- **`name`, `model`, `network_name`, and `status` flow
  through automatically** as feature properties on each
  marker. The default popup will show "`Q2XX-XXXX-XXXX` ·
  SF HQ - Floor 3 AP · MR46 · online · SF HQ" with no
  further config (`enablePopups: true` is the default per
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)).

## 5. Screenshot

_Screenshot pending the D5 Splunk Docker compose harness (ROADMAP §3
D5). The harness will render every recipe's panel against a
preloaded sample dataset and check in the resulting PNGs alongside
the recipe markdown. For Meraki the harness will need either (a)
a recorded fixture of `meraki:devices` events from a development
organization, or (b) a synthetic device-inventory generator
seeded with realistic lat/lng / model / status distributions —
the latter is more reproducible and is the planned approach._

## 6. Gotchas

- **`lng` vs `lon` is the #1 mistake.** Meraki's REST API and
  the TA both emit the field as **`lng`** (three letters).
  Better Map's auto-detect only looks for `lon` / `longitude`
  / `long`. Forget the `rename lng AS lon` and the panel
  renders nothing; no error, just an empty map. The same
  trap exists in any vendor TA whose source API uses
  three-letter abbreviations (some BMS / building automation
  TAs use `lng`; Google Maps API uses `lng`; OpenStreetMap
  uses `lon`). The standing rule is "rename to canonical
  `lat`/`lon` at the END of the SPL, before `fields`".
- **`Splunk_TA_cisco_meraki` must be installed AND the
  `devices` input enabled.** This is NOT a vanilla-Splunk
  recipe — the TA is mandatory. The
  [`cisco-meraki-ta-setup` skill](https://github.com/fenre/better_map/blob/main/docs/recipes/meraki/markers.md)
  documents the complete install + configure flow including
  the secret-handling pattern (API key never leaves a
  temporary file on the operator workstation).
- **Devices without a Dashboard location are invisible.**
  Meraki devices ship from the factory with `lat=null,
  lng=null` and only get coordinates AFTER the operator
  drags them onto the map in the Meraki Dashboard. Greenfield
  deployments routinely have 20-30% of devices unlocated for
  the first few weeks. Add a companion panel with the SPL
  `index=meraki sourcetype="meraki:devices" earliest=-1h |
  dedup serial sortby -_time | where isnull(lat) OR
  isnull(lng) | stats count` and a callout — "Devices
  awaiting location: <count>" — so the operator sees the
  inventory drift instead of assuming the map is complete.
- **MV cameras can have privacy-flag-restricted `lat`/`lng`.**
  Some EU deployments hide MV camera locations from the
  REST API even when set in the Dashboard (GDPR-driven
  default). MV serials simply won't appear on the map. To
  confirm: `index=meraki sourcetype="meraki:devices"
  productType="camera" earliest=-1h | dedup serial sortby
  -_time | table serial, name, lat, lng`. If `lat`/`lng`
  are null for ALL MV but populated for MR / MS / MX, you're
  hitting the privacy flag; this is correct behaviour and
  cannot be worked around at the TA / SPL layer.
- **Polling cadence vs panel auto-refresh.** The `devices`
  input default polling cadence is 600 s. A panel that
  auto-refreshes every 30 s will run 20 times against the
  SAME snapshot — no value added, just Splunk load. Tune
  panel refresh to match the input cadence (10 min) for a
  better signal-to-load ratio.
- **`status` enum values.** The Meraki REST API returns
  `online` / `alerting` / `offline` / `dormant` plus the
  occasional `null` we already `coalesce`. If you map
  colours by status, account for all five (the `coalesce`
  introduces `"unknown"`). The most-confusing value is
  `dormant` — the Meraki definition is "device has been
  offline >7 days, has been marked semi-permanently absent
  from inventory views"; the operator decision is "does my
  panel show dormant the same as offline (probably yes for
  a NetOps overview) or differently (probably yes for an
  asset-management view)". Document the choice in the
  panel description.
- **Time range.** The recipe hard-codes
  `earliest=-1h latest=now` to keep the dedup window small
  and fast. Replace with `earliest=$earliest$
  latest=$latest$` once you wire the recipe into a
  dashboard with a time-range input — but constrain the
  upper bound: a 30-day dedup is expensive AND not
  meaningful for an "is this device online RIGHT NOW?"
  panel.
- **No CIM mapping.** `meraki:devices` is inventory data, not
  an event-stream sourcetype. The Cisco Meraki TA maps OTHER
  sourcetypes (`meraki:webhook`, `meraki:apirequestshistory`,
  syslog) to the CIM Network Traffic / Alerts / Authentication
  data models, but device inventory has no CIM home. That is
  why this recipe queries the raw sourcetype directly instead
  of going through `| tstats FROM datamodel=…` like the
  CIM-data-model recipes do.
- **PII / GDPR posture.** Meraki device names sometimes embed
  user identity (`"AP - John Smith desk"`). The `name` column
  flows into popups. If this is a GDPR concern, swap the
  popup binding to `network_name` (room/site label) instead
  of the `name` (specific-device label) and exclude `name`
  from `fields` at the end of the SPL.
- **No OT safety dependency.** Meraki devices are IT
  networking gear. The MT environmental sensor line (MT10,
  MT12, MT14, MT20, MT30) is IoT but NOT SIS-related (no
  safety-instrumented logic; the MT sensors monitor server-
  room temperature and ambient conditions, NOT process-
  safety variables). If your tenant integrates Meraki with
  an OT-zone monitoring program, route THOSE MT sensors to
  a dedicated `ot-datastreamer` recipe (per
  [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  Rule 6) rather than mixing them with the corporate
  Meraki inventory shown on this panel.

## Verification status

`status: unverified` in the frontmatter — the SPL is structurally
sound, matches the documented `meraki:devices` field shape from
[`~/.cursor/skills/cisco-meraki-ta-setup/SKILL.md`](https://github.com/fenre/better_map/blob/main/docs/recipes/meraki/markers.md)
and the [`cisco-products` skill](https://github.com/fenre/better_map/blob/main/docs/recipes/meraki/markers.md),
and uses only Splunk built-ins plus the documented `lng`-from-Meraki-
API field name. It has not been dispatched against the v1.7-prep
lab tenant in this PR because (a) non-interactive admin auth is
not present in the agent workspace, and (b) the lab tenant does
not currently have a real Meraki organization registered. A
maintainer with REST auth to a Splunk tenant that HAS
`Splunk_TA_cisco_meraki` installed and a configured Meraki
account should:

1. Confirm `index=meraki sourcetype="meraki:devices" earliest=-1h
   | stats count` returns >0.
2. Confirm `lat` and `lng` are populated for at least one device
   (`| where isnotnull(lat) AND isnotnull(lng) | head 1`).
3. Run the full recipe SPL and confirm the panel renders the
   expected number of markers (compare to the device count in
   the Meraki Dashboard map view — they MUST match).
4. Update the frontmatter to `status: verified`, fill in
   `verified_against` (include `splunk_app:
   "Splunk_TA_cisco_meraki"`), and submit a follow-up PR.
