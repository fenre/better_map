---
title: Layer catalogue
description: >-
  The ten core layer types plus the optional overlays and the
  eleventh "integration layer" pattern.
---

# Layer catalogue

Better Map renders ten **core** layer types out of the box, plus a
handful of optional overlays and an "integration layer" pattern used
by the eight Splunk integrations.

Every layer in the table below honours the [BM-CT-1
contract](bm-ct-1.md) — `setEnabled(bool)`, `isEnabled()`, `reset()`
— and is independently togglable from the formatter's `enabledLayers`
multi-select.

## The ten core layers

| # | Layer | Use case | Performance ceiling |
|---|---|---|---|
| 1 | **Points** | Raw geocoded events. | ~50 k features per panel before WebGL throttles. |
| 2 | **Cluster** | Visualise density without losing per-event drill-down. | ~250 k features (the cluster index is `supercluster`). |
| 3 | **Heatmap** | Continuous density surface. | ~500 k features. |
| 4 | **Hexbin (H3)** | Spatial aggregation with stable bin boundaries across time windows. | ~500 k features at H3 res 7–9. |
| 5 | **Density cluster** | Pixel-stable clusters that don't reshuffle on zoom. | ~250 k features. |
| 6 | **Choropleth (vector-tile join)** | Colour-by-value across administrative boundaries. | ~150 polygons per panel (browser fill-rate bound). |
| 7 | **3D extrusion** | Building heights, value-by-height encodings. | ~50 k extruded features. |
| 8 | **Time scrubber / comet trail** | Time-ordered traces with fade-tail. | ~50 k features × 200 frames of comet history. |
| 9 | **Indoor floor-plan overlay** | Image-georeferenced floor plan + floor-field filter. | One floor plan per panel. |
| 10 | **Cross-panel coordination** | Bidirectional `$better_map.spatial_query$` tokens that feed other Studio panels. | N/A — this is a token contract, not a render layer. |

## Optional overlays

| Overlay | When to use |
|---|---|
| **KML import** | Static asset layers (zones, routes). |
| **WMS tile overlay** | External raster layers (weather, satellite). |
| **Scenegraph (gltf / 3D tiles)** | Industrial digital twins, building interiors. |
| **Wind field** | Vector-arrow rendering of bearing+magnitude. |
| **Geofence** | Polygon-based alert zones. |
| **MIL-STD-2525C / APP-6 symbology** | Defence and tactical use cases. |

## The eleventh ("integration") layer

The eight Splunk integrations under
[`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
are not rendered as map features — they're **decoration** layers that
enrich the popup, the legend, the colour scale, or the drill-down
target.

| Integration | What it decorates | Endpoints |
|---|---|---|
| **`aiAssistant.yaml`** | The ⌘K command palette → SPL helper. | `splunkd:8089/services/search/SAI` |
| **`aiGeo.yaml`** | Geocoding fallback for free-text addresses. | Customer-supplied geocoder endpoint. |
| **`esNotable.yaml`** | Notable-event correlation popup. | `splunkd:8089/services/notable_event/*` |
| **`itsi.yaml`** | ITSI service tree drill-down + health-score badge. | `splunkd:8089/services/itoa_interface/*` |
| **`mitre.yaml`** | MITRE ATT&CK tactic / technique chips on popups. | `splunkd:8089/services/SA-EnterpriseSecuritySuite/*` |
| **`purdue.yaml`** | Purdue / IEC 62443 zone + conduit overlay (read-only — see [OT safety](../runtime-envelope.md)). | Customer-supplied OT inventory CSV / lookup. |
| **`rba.yaml`** | Risk-based-alerting risk score on popups + risk-by-asset choropleth. | `splunkd:8089/services/SA-EnterpriseSecuritySuite/risk/*` |
| **`soar.yaml`** | SOAR playbook trigger from popup (IT / IT-OT DMZ only). | Customer-supplied SOAR endpoint. |

Each integration is **declared** in YAML so the
[`scripts/check-formatter-coverage.py`](https://github.com/fenre/better_map/blob/main/scripts/check-formatter-coverage.py)
gate (and a planned Phase 2
`scripts/check-integrations-coverage.py`) can cross-reference the
declared endpoints against the JS call sites and the runtime
envelope's exception list.

## Order of operations

Layers render in `layerOrder` order (bottom of the list = bottom of
the z-stack). The default order:

```
basemap → choropleth → hexbin → heatmap → cluster → points
       → time scrubber → indoor overlay → integration decoration
       → widgets
```

Override per-dashboard via the formatter's `layerOrder` option.

## Adding a new layer

See the
[Contributing guide](../contributing.md) for the file layout,
the BM-CT-1 contract template, the test scaffolding (Vitest +
jsdom), and the documentation cross-reference each new layer must
update (`docs/_machine/layers-schema.json` is the planned G7 Phase 2
target).
