---
title: Integration catalogue
description: >-
  Per-integration cookbook for the eight Splunk-platform
  integrations Better Map ships with.
---

# Integration catalogue

Each integration follows the same shape:

- **What it does** — single-sentence summary.
- **Where the data lives** — Splunk index / data model / KV-store
  collection / customer-supplied source.
- **Endpoints** — splunkd:8089 (or customer-controlled) URLs the
  viz calls.
- **Formatter keys** — which formatter options drive the
  integration's behaviour.
- **OT-safety note** — when the integration touches Purdue Level
  0/1/2 surfaces.

For the full machine-readable surface, read the corresponding YAML
under [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations).

## Integration matrix at a glance

<!-- BEGIN AUTOGEN: integrations-matrix -->

_The matrix table and endpoint detail below are auto-generated from [`docs/_machine/integrations/*.yaml`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations) by `scripts/build-reference-pages.py`. Do not edit the auto-managed section by hand — run the script and commit the regenerated file._

**Total: 8 integrations · 8 experimental · 0 live-tenant verified (Theme C in flight).**

| Integration | Status | Splunk app required | Splunk version min | REST endpoints | Auth | OT-safety | Live-tenant tested? | Source YAML |
|---|---|---|---|---|---|---|---|---|
| `aiAssistant` — Splunk AI Assistant for SPL — natural-language → SPL | experimental | Splunk_AI_Assistant_Cloud | Splunk Cloud (preferred) or Splunk Enterprise 9.x with cloud-connect enabled | 1 | session | — | no | [`aiAssistant.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/aiAssistant.yaml) |
| `aiGeo` — AI-suggested geo annotations | experimental | Splunk AI Assistant for SPL OR generic Splunk Cloud ML Toolkit endpoint | any Splunk Cloud / Enterprise stack with a reachable AI endpoint | 1 | bearer | — | no | [`aiGeo.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/aiGeo.yaml) |
| `esNotable` — ES Notable Event — drilldown URL builder + close stub | experimental | Splunk Enterprise Security | ES 6.x | 2 | session | — | no | [`esNotable.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/esNotable.yaml) |
| `itsi` — Splunk IT Service Intelligence (ITSI) — service map | experimental | ITSI (SA-ITOA) | ITSI 4.x | 1 | session | — | no | [`itsi.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/itsi.yaml) |
| `mitre` — MITRE ATT&CK technique overlay | experimental | none (built-in lookup table for ~80 most-common techniques) | any | 1 | depends on the URL (typically none / public CDN) | — | no | [`mitre.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/mitre.yaml) |
| `purdue` — OT Purdue model / IEC 62443 overlay | experimental | none (asset register can come from any Splunk lookup or inline) | any | 1 | session | yes (4 rules) | no | [`purdue.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/purdue.yaml) |
| `rba` — Risk-Based Alerting (RBA) — geo risk heatmap | experimental | Splunk Enterprise Security (uses ES Risk Framework schema) | ES 6.x with Risk Framework enabled | 0 (offline helper) | n/a (offline) | — | no | [`rba.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/rba.yaml) |
| `soar` — Splunk SOAR (formerly Phantom) — right-click playbook trigger | experimental | Splunk SOAR forwarder app (phantom_forward) on the host Splunk | SOAR 6.x (any version supported by the forwarder) | 1 | delegated (Splunk session → forwarder → SOAR API key) | yes | no | [`soar.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/soar.yaml) |

### Endpoint detail

_One bullet per REST endpoint the visualization calls. Offline-only integrations are listed too, with a note._

#### `aiAssistant` — Splunk AI Assistant for SPL — natural-language → SPL

- `POST /servicesNS/-/Splunk_AI_Assistant_Cloud/ai/spl-suggest` (auth: session) — Translate a natural-language question into an SPL pipeline tailored for the current map context (bbox, time-range, sourcetype hints).

#### `aiGeo` — AI-suggested geo annotations

- `POST <aiEndpoint>` (auth: bearer) — Send a feature collection + free-text question; receive structured annotations (labels, clusters, narrative).

#### `esNotable` — ES Notable Event — drilldown URL builder + close stub

- `POST /services/notable_update` (auth: session) — Mark a notable closed, change urgency, reassign owner.
- `GET-NAVIGATE /app/SplunkEnterpriseSecuritySuite/incident_review?form.search=...notable_id={{event_id}}` (auth: session) — Pivot the user from a map feature to the ES Incident Review workflow pre-filtered for that notable.

#### `itsi` — Splunk IT Service Intelligence (ITSI) — service map

- `GET /servicesNS/-/SA-ITOA/itoa_interface/service` (auth: session) — List ITSI services with dependency graph metadata.

#### `mitre` — MITRE ATT&CK technique overlay

- `GET <extendedLookupUrl>` (auth: depends on the URL (typically none / public CDN)) — Optional — fetch the full ATT&CK matrix beyond the built-in 80 techniques.

#### `purdue` — OT Purdue model / IEC 62443 overlay

- `GET /servicesNS/-/<app>/data/lookups/asset_register.csv` (auth: session) — Fetch the asset register lookup that maps host/asset_id → Purdue level + safety flag.

#### `rba` — Risk-Based Alerting (RBA) — geo risk heatmap

- _No outbound REST surface (offline helper). Auth: n/a — offline helper (no REST surface)._

#### `soar` — Splunk SOAR (formerly Phantom) — right-click playbook trigger

- `POST /services/phantom_forward` (auth: delegated (Splunk session → forwarder → SOAR API key)) — Forward selected features to a SOAR playbook for action.

<!-- END AUTOGEN: integrations-matrix -->

## AI Assistant (`aiAssistant.yaml`)

- **What it does** — Routes free-text user prompts in the ⌘K palette
  to `Splunk_AI_Assistant_Cloud` to generate SPL for the current
  panel. The generated SPL is **never auto-executed** — the user
  reviews and clicks "Run".
- **Where the data lives** — N/A (assistant is stateless).
- **Endpoints** — `splunkd:8089/services/search/SAI`.
- **Formatter keys** — `showCommandPalette`, `aiAssistantEnabled`.
- **OT-safety note** — Generated SPL can only **read** indexes; the
  assistant never proposes writes. (See [runtime
  envelope](../runtime-envelope.md) rule #6.)

## AI Geocoding (`aiGeo.yaml`)

- **What it does** — When `latitudeField` / `longitudeField` are
  empty but `addressField` contains free-text addresses, attempts a
  customer-supplied geocoder lookup. **Disabled by default** because
  it requires a customer-owned geocoding endpoint.
- **Where the data lives** — Customer's geocoder (e.g. Nominatim
  cache, OpenCage, MapTiler Geocoding).
- **Endpoints** — Customer-supplied; must be on the allowlist in
  `splunkd:8089` egress proxy config.
- **Formatter keys** — `aiGeoEnabled`, `aiGeoEndpoint`,
  `aiGeoAuthHeader`.
- **OT-safety note** — N/A (no OT path).

## Enterprise Security notable (`esNotable.yaml`)

- **What it does** — Adds a "Notable" badge on the popup for any
  feature that matches an open notable event. Click → drill down to
  the Splunk ES incident review page.
- **Where the data lives** — `notable_index` index, `notable_id`
  KV-store collection.
- **Endpoints** — `splunkd:8089/services/notable_event/<id>`.
- **Formatter keys** — `esNotableEnabled`, `esNotableField`,
  `esNotableDrilldownAction`.
- **OT-safety note** — Read-only — the viz never mutates notable
  events.

## ITSI service tree (`itsi.yaml`)

- **What it does** — Resolves the geo asset to its ITSI service
  membership, badges the popup with the service health score, and
  opens the ITSI service-analyzer in a new Splunk tab on drill-down.
- **Where the data lives** — `itsi_summary` index,
  `itsi_services` KV-store collection.
- **Endpoints** — `splunkd:8089/services/itoa_interface/service/{id}`.
- **Formatter keys** — `itsiEnabled`, `itsiServiceField`,
  `itsiHealthScoreBadge`.
- **OT-safety note** — Read-only.

## MITRE ATT&CK (`mitre.yaml`)

- **What it does** — Renders MITRE ATT&CK tactic / technique chips
  on the popup for features that carry ATT&CK metadata. Chips link
  to the ATT&CK Navigator inside the customer's environment if
  configured.
- **Where the data lives** — `mitre_attack` KV-store collection
  (lookup CSV pinned with the viz).
- **Endpoints** — N/A (lookup-only; the chip click target is
  customer-configurable in the formatter).
- **Formatter keys** — `mitreEnabled`, `mitreTechniqueField`,
  `mitreNavigatorBaseUrl`.
- **OT-safety note** — The viz includes the **MITRE ATT&CK for
  ICS** matrix; ICS technique IDs (Txxxx) are recognised alongside
  Enterprise ATT&CK.

## Purdue / IEC 62443 (`purdue.yaml`)

- **What it does** — Overlays Purdue zone + conduit boundaries on
  the map, badges each asset's popup with its Purdue level (0–4 +
  DMZ). **Read-only by design** (see [OT
  safety](../runtime-envelope.md)).
- **Where the data lives** — Customer-supplied lookup
  (`purdue_assets.csv`) keyed by `asset_id`.
- **Endpoints** — N/A (lookup-only).
- **Formatter keys** — `purdueEnabled`, `purdueZoneField`,
  `purdueConduitField`, `purdueLevelField`.
- **OT-safety note** — :material-shield-check: **Binding.** The
  integration NEVER writes back, NEVER silently filters
  `safety_related=Y` signals, and badges the popup with a
  prominent "SIS — read-only" indicator when the asset is part of a
  Safety-Instrumented System.

## Risk-Based Alerting (`rba.yaml`)

- **What it does** — Reads the per-asset risk score from Splunk
  ES's risk index and badges popups and the choropleth.
- **Where the data lives** — `risk` index, `risk_object_score`
  KV-store collection.
- **Endpoints** —
  `splunkd:8089/services/SA-EnterpriseSecuritySuite/risk/{object}`.
- **Formatter keys** — `rbaEnabled`, `rbaScoreField`,
  `rbaScoreThresholdCritical`, `rbaScoreThresholdElevated`.
- **OT-safety note** — Read-only.

## SOAR (`soar.yaml`)

- **What it does** — Adds a "Trigger playbook" button on the popup
  for IT / IT-OT-DMZ assets. **The button is hidden when the asset's
  `purdue_level` is 0, 1, or 2.**
- **Where the data lives** — Customer's SOAR instance (on-prem or
  cloud).
- **Endpoints** — Customer-supplied SOAR endpoint
  (`POST /rest/playbook_run`).
- **Formatter keys** — `soarEnabled`, `soarEndpoint`,
  `soarAuthHeader`, `soarPlaybookField`.
- **OT-safety note** — :material-shield-check: **Binding.** SOAR
  playbook targets are restricted to **IT / IT-OT DMZ only**. The
  Purdue-level filter is enforced in the formatter widget *and* in
  the popup-button render path; both honour the
  [OT safety rule](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc).

## See also

- [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
  — machine-readable source of truth.
- [Recipes](../recipes/index.md) — end-to-end playbooks that
  combine multiple integrations for a single use case.
