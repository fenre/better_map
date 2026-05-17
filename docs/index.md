---
title: Better Map
description: >-
  Splunk Dashboard Studio custom map visualization built on MapLibre
  GL JS — ten layer types, time scrubber, 3D extrusion, H3 hexbin
  aggregation, vector-tile feature join, cross-panel coordination,
  indoor floor-plan overlay, twelve preset Studio dashboards.
---

# Better Map

A flagship **Splunk Dashboard Studio** custom map visualization. Built on
[MapLibre GL JS](https://maplibre.org/), [PMTiles](https://docs.protomaps.com/pmtiles/),
and Splunk's AMD-style custom-visualization framework. Ships with ten
core layer types, time scrubber + comet trail, 3D extrusion, H3 hexbin
aggregation, vector-tile feature join, cross-panel coordination, indoor
floor-plan overlay, twelve preset Studio dashboards, and an
AppInspect-clean package.

!!! tip "Get going in three steps"

    1. Install the app on Splunk Enterprise 10.2+ — see [Getting
       started](getting-started/index.md).
    2. Run the smoke-test panel from the included
       `better_map_smoke_test` dashboard — see
       [Smoke test](getting-started/smoke-test.md).
    3. Browse the [Recipes](recipes/index.md) for source-specific
       playbooks (Meraki, ISE, Cyber Vision, ThousandEyes, RBA, etc.).

## What's in this site

<div class="grid cards" markdown>

-   :material-rocket-launch: __Getting started__

    ---

    Install, smoke test, the runtime envelope (what the viz can and
    cannot do).

    [:octicons-arrow-right-24: Read the install guide](getting-started/index.md)

-   :material-book-open-page-variant: __Reference__

    ---

    Every formatter option, every layer type, the BM-CT-1
    enable/disable/reset contract.

    [:octicons-arrow-right-24: Open reference](reference/index.md)

-   :material-cog-sync: __Integrations__

    ---

    The eight Splunk-platform integrations shipped under
    [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
    — ITSI, SOAR, ES notable, RBA, MITRE, Purdue / IEC 62443, A&I
    geo-resolution, AI Assistant.

    [:octicons-arrow-right-24: Read the cookbook](integrations/index.md)

-   :material-shield-lock-outline: __Operate__

    ---

    Runbooks for supply chain (G1), upgrade hygiene (G3), and the
    air-gapped PMTiles flow.

    [:octicons-arrow-right-24: Open runbooks](runbooks/index.md)

-   :material-history: __Changelog__

    ---

    Full release history. Major versions follow semver; every release
    is GitHub-signed (cosign keyless) and ships a CycloneDX SBOM.

    [:octicons-arrow-right-24: Read the changelog](changelog.md)

-   :material-map-marker-path: __Roadmap__

    ---

    What's shipped, what's in flight, what's deferred. The seven-theme
    plan, the v1.7 → v1.8 → v2.0 milestone sequencing, and the
    defensibility checklist.

    [:octicons-arrow-right-24: Read the roadmap](roadmap.md)

</div>

## Status as of v1.7-prep

| Theme | Item | Status |
|---|---|---|
| G — Operational rigor | G1 supply chain | :white_check_mark: shipped |
| G — Operational rigor | G3 upgrade hygiene | :white_check_mark: shipped |
| G — Operational rigor | G7 machine-readable docs (Phase 1) | :white_check_mark: shipped |
| D — Quality bar | D3 accessibility audit (Phase 1) | :white_check_mark: shipped |
| E — Distribution | E2 documentation site (Phase 1) | :white_check_mark: this site |
| D — Quality bar | D1 AppInspect re-cert | in flight |
| D — Quality bar | D2 browser matrix | in flight |
| D — Quality bar | D5 end-to-end suite | blocked on Splunk Docker compose |
| C — Splunk integration depth | C1–C8 integration verification | in flight |
| E — Distribution | E1 Splunkbase listing | blocked on D1 |
| E — Distribution | E5 per-source recipe matrix | in flight |

The [roadmap](roadmap.md) carries the authoritative status block per
work-item.

## License

MIT. The full text lives in
[`LICENSE`](https://github.com/fenre/better_map/blob/main/LICENSE) at
the repo root. Every release tarball, every page on this site, and
every entry in the machine-readable layer carries an `SPDX-License-Identifier: MIT`
marker.

## How to contribute

See [Contributing](contributing.md) for the development workflow, the
five non-negotiable invariants AI agents must respect, the
[pre-commit checklist](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md#7-the-im-about-to-commit-am-i-clean-checklist),
and the conventional-commits-driven release flow.
