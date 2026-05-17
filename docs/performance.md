---
title: Performance budget
description: >-
  The performance budget that gates every PR. Bundle size, console
  noise, WebGL contexts, feature count ceilings.
---

# Performance

Better Map is opinionated about performance because dashboards do
not run in isolation — a single dashboard may host 8–16 instances
of the viz, and the user's browser will throttle WebGL contexts
above ~16 per origin.

## The performance budget (PR gate)

| Budget | Limit | Gate |
|---|---|---|
| **Bundle size (raw)** | 3.0 MB | `scripts/check-bundle-size.js` |
| **Bundle size (gzip)** | 800 KB | `scripts/check-bundle-size.js` |
| **Console noise** | 0 `console.log` outside the diagnostic gate | `scripts/check-bundle-console-noise.js` |
| **Manifest drift** | 0 added/removed files vs `_better_map_manifest.json` | `scripts/check-manifest.py` |
| **Formatter coverage** | 100% of declared options consumed by JS | `scripts/check-formatter-coverage.py` |
| **CSS contract** | every `better_map-*` class emitted by JS has a CSS rule or allowlist entry | `scripts/lint-js-css-contract.js` (BM-FIX) |
| **Token contract** | every `$better_map.*$` token in dashboard XML is emitted by a widget (and vice versa) | `scripts/check-dashboard-tokens.py` (SPATIAL-1) |
| **BM-CT-1 contract** | every layer/integration/widget exposes `setEnabled`/`isEnabled`/`reset` | `scripts/lint-js-css-contract.js` |
| **Accessibility (D3)** | 0 axe-core WCAG 2.2 AA violations on `formatter.html` | `scripts/check-accessibility.js` |
| **License allowlist (G1)** | 0 dependencies with a non-allowed SPDX identifier | `scripts/check-license-allowlist.py` |
| **npm audit (G1)** | 0 high+ severity vulnerabilities in runtime tree | `scripts/check-npm-audit.py` |

## Runtime performance ceilings

These are the **render-time** ceilings (not gated; they're rule-of-thumb):

| Layer | Browser-bound ceiling | Notes |
|---|---|---|
| Points | 50 k features | WebGL throttles above; switch to cluster. |
| Cluster | 250 k features | `supercluster` index; CPU-bound on build. |
| Heatmap | 500 k features | Fill-rate-bound. |
| Hexbin (H3 res 7–9) | 500 k features | CPU-bound on H3 binning. |
| Density cluster | 250 k features | Pixel-stable clustering. |
| Choropleth | 150 polygons | Browser fill-rate. |
| 3D extrusion | 50 k features | Z-fight at >50 k. |
| Comet trail | 50 k features × 200 frames | RAM-bound. |

If a user pushes past these ceilings, the viz emits a Perf-HUD
warning (visible in debug mode) and degrades gracefully (cluster
over points, simplified geometry).

## Where the budget is enforced

- **In CI:** every PR runs the full gate list above. A failure
  blocks merge.
- **In the bundle:** `scripts/build-formatter-schema.py` and
  `scripts/build-manifest.py` regenerate the machine layer on every
  build — drift fails CI.
- **In the runtime:** the Perf-HUD widget shows live FPS, feature
  count, and WebGL context usage in debug mode.

## See also

- [Runtime envelope](runtime-envelope.md) — what the viz is allowed
  to do.
- [Contributing](contributing.md) — the development workflow that
  keeps the budget green.
- [Roadmap](roadmap.md) — D5 (end-to-end suite) will add
  Playwright-driven perf regression tests when the Splunk
  Docker-compose harness lands.
