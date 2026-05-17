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
