---
title: Recipes
description: >-
  Per-source playbooks — how to wire Better Map into common Cisco /
  Splunk / OT data sources end-to-end.
---

# Recipes

The recipes section is a collection of **end-to-end playbooks** for
wiring Better Map into common data sources (Cisco Meraki, Cisco ISE,
Cisco Cyber Vision, Cisco ThousandEyes, Splunk RBA, ITSI, A&I geo
resolution, MITRE-tagged detections, and the air-gapped PMTiles
basemap flow).

Each recipe answers:

- Which Splunk TA / app ingests the source.
- Which sourcetype(s) and field(s) feed Better Map.
- Which SPL search the dashboard panel runs.
- Which formatter options to set (and why).
- Which integration(s) light up the popup, the colour scale, or
  the drill-down.

## Status (v1.7-prep)

This index is a **placeholder** in the v1.7 site build. The per-source
recipes themselves are tracked under ROADMAP item **E5 — Per-source
recipe matrix** and are blocked on the
[`docs/_machine/recipes/index.yaml`](https://github.com/fenre/better_map/tree/main/docs/_machine)
machine schema (G7 Phase 2). Until E5 lands, the closest live source
of patterns is:

- The twelve [showcase dashboards](../getting-started/smoke-test.md)
  shipped with the app — every dashboard names its data contract in
  its title and uses real SPL (no `| makeresults`, no `random()`).
- The eight [integration declarations](../integrations/catalogue.md)
  — each YAML names the sourcetype / index / KV-store collection it
  binds to.
- The Cisco product skills under `~/.cursor/skills/cisco-*` if you
  use an AI agent — they document the per-product Splunk ingestion
  path which the recipes will eventually wrap.

## Planned recipe shape

A single recipe will look like this:

```markdown
## Cisco Meraki MR access points

**Source:** `cisco:meraki:mr:wireless` sourcetype (TA-cisco-meraki).
**Fields used:** `latitude`, `longitude`, `client_count`,
`network_id`, `serial_number`.

**Search:**

\`\`\`spl
index=cisco sourcetype="cisco:meraki:mr:wireless"
| stats latest(client_count) AS clients,
        latest(latitude) AS lat,
        latest(longitude) AS lon
        BY serial_number, network_id
\`\`\`

**Formatter options:**

| Option | Value | Why |
|---|---|---|
| `latitudeField` | `lat` | from the stats |
| `longitudeField` | `lon` | from the stats |
| `valueField` | `clients` | drives the colour scale |
| `categoryField` | `network_id` | one colour per network |
| `aggregationMode` | `cluster` | MR fleets are often dense |
| `clusterRadius` | `60` | px |

**Integrations to light up:** `itsi.yaml` (Meraki MR is a common
ITSI entity), `rba.yaml` (if the network has alert policies).

**OT-safety note:** None — Meraki MRs are IT-side wireless.
```

When E5 + G7 Phase 2 land, this page will replace the placeholder
with a generated table of contents pointing at each recipe.

## Where to read more

- [E5 — per-source recipe matrix](../roadmap.md) — roadmap status.
- [G7 Phase 2 — `_machine/recipes/index.yaml`](https://github.com/fenre/better_map/blob/main/docs/_machine/README.md)
  — the machine schema the recipes will declare against.
