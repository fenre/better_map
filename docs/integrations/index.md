---
title: Integrations
description: >-
  Eight Splunk-platform integrations declared under
  docs/_machine/integrations/. Read-only on OT/ICS by design.
---

# Integrations

Better Map ships **eight Splunk-platform integrations**, all declared
under [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
as machine-readable YAML (G7 Phase 1). Each integration is
read-only by default and respects the
[runtime envelope](../runtime-envelope.md).

For OT/ICS deployments, the integrations follow the
[OT safety boundary](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc):
**no writes** to Purdue Level 0/1/2 assets, **no silent filtering** of
`safety_related=Y` signals, and SOAR playbook targets are restricted
to the IT / IT-OT DMZ.

## The eight integrations

| Integration | Theme | Splunk premium suite | Default state |
|---|---|---|---|
| **AI Assistant** | Authoring | `Splunk_AI_Assistant_Cloud` | enabled if the suite is installed |
| **AI Geocoding** | Data prep | customer-supplied | disabled by default |
| **ES notable** | Investigation | Splunk Enterprise Security | enabled if ES is installed |
| **ITSI** | Operations | Splunk IT Service Intelligence | enabled if ITSI is installed |
| **MITRE ATT&CK** | Detection | Splunk Enterprise Security | enabled if ES is installed |
| **Purdue / IEC 62443** | OT context | customer-supplied lookup | disabled by default |
| **Risk-Based Alerting** | Detection | Splunk Enterprise Security | enabled if ES is installed |
| **SOAR** | Response | Splunk SOAR (on-prem or cloud) | enabled if SOAR is installed; IT / IT-OT DMZ targets only |

See the [catalogue](catalogue.md) for the per-integration cookbook,
the endpoint list, the auth model, and the BM-CT-1 surface.

## Why machine-readable declarations

Each integration is a YAML file like
[`docs/_machine/integrations/esNotable.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/esNotable.yaml):

- **`endpoints`** — the exact splunkd:8089 (or customer-controlled)
  URLs the viz calls. The [runtime envelope's](../runtime-envelope.md)
  exception list is built from these.
- **`auth`** — Splunk session token, app-level token, or
  customer-supplied OAuth.
- **`bmct1_surface`** — which BM-CT-1 methods the integration
  exposes and what `reset()` actually clears.
- **`scope`** — which premium suite is required, which Splunk Cloud
  Victoria capabilities are needed, what OT-safety constraints apply.
- **`docs`** — link back to this site for the human cookbook.

Two CI gates cross-reference these declarations:

- **`scripts/check-formatter-coverage.py`** — every integration's
  `bmct1_surface.formatter_keys` is reachable from `formatter.html`.
- **`scripts/check-integrations-coverage.py`** (G7 Phase 2,
  pending) — every endpoint declared in YAML has a call site in
  `src/lib/integrations/**` (and vice-versa, no orphan call sites).

## Where to read more

- [Catalogue](catalogue.md) — per-integration cookbook.
- [BM-CT-1](../reference/bm-ct-1.md) — the enable/disable/reset
  contract every integration follows.
- [Runtime envelope](../runtime-envelope.md) — why the integrations
  are limited to splunkd:8089 + customer-controlled endpoints.
- [OT safety rule](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
  — the read-only Purdue / IEC 62443 boundary the OT-touching
  integrations honour.
