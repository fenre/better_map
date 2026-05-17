---
title: Formatter options
description: >-
  All 82 formatter options exposed by Better Map. Type, default,
  enum values, Splunk property path. Generated from the machine
  schema.
---

# Formatter options

Better Map exposes **82 formatter options** across three Dashboard
Studio tabs (`Data configurations`, `Data display`, `Color and
style`). Each option is declared once in `formatter.html` and
extracted into
[`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json)
by `scripts/build-formatter-schema.py`.

This page is the **human-readable** narrative for the most common
options. For the full enumeration with types, defaults, and Splunk
property paths, consult the machine schema.

!!! note "Source of truth"

    The schema is the source of truth. This page summarises the
    high-traffic options and links to the schema for the full set.
    A v1.8 site-build step (E2 Phase 2) will auto-generate the full
    enumeration directly from the schema.

## How a formatter option flows through the stack

1. **`formatter.html`** declares the control (`<select>`,
   `<input>`, `<splunk-color-picker>`, …) with a `data-name="foo"`
   attribute.
2. **`scripts/build-formatter-schema.py`** parses the HTML into
   `docs/_machine/formatter-schema.json`.
3. **`scripts/check-formatter-coverage.py`** verifies that every
   declared option is consumed by JS in `src/lib/**/*.js` (and
   vice-versa).
4. Splunk Dashboard Studio writes the user's choice into
   `savedsearches.conf` under
   `display.visualizations.custom.better_map.better_map.foo` and
   re-renders the viz with the new value.
5. **`getOption(config, ns, 'foo', default)`** in the viz JS reads
   the value (handling both short-key and full-namespace
   delivery paths — see
   [`splunk-custom-viz-integration.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-custom-viz-integration.mdc)).

## Tab 1 — Data configurations

| Group | Options | Purpose |
|---|---|---|
| **Data mapping** | `latitudeField`, `longitudeField`, `valueField`, `categoryField`, `idField`, `tooltipField`, `timestampField` | Map SPL output columns to map semantics. |
| **Aggregation** | `aggregationMode`, `clusterRadius`, `hexbinResolution`, `heatmapRadius` | Choose how the viz collapses multiple points (cluster, hexbin, heatmap, density). |
| **Time** | `timeField`, `timeWindow`, `playbackSpeed`, `cometTrailLength` | Bind the time scrubber and comet trail. |
| **Accessibility & localization** | `highContrast`, `labelLanguage`, `reduceMotion`, `screenReaderMode` | WCAG 2.2 AA conformance levers — see [D3 in the roadmap](../roadmap.md). |
| **Indoor** | `indoorEnabled`, `indoorImageUrl`, `indoorBounds`, `indoorFloorField` | Floor-plan overlay + image georeferencing. |

## Tab 2 — Data display

| Group | Options | Purpose |
|---|---|---|
| **Layer selection** | `defaultLayer`, `enabledLayers`, `layerOrder` | Which of the ten core layers render, and in what z-order. |
| **3D** | `extrusionEnabled`, `extrusionHeightField`, `extrusionScale`, `tilt`, `bearing` | 3D extrusion + camera pose. |
| **Popups** | `popupEnabled`, `popupFields`, `popupMarkdown`, `popupMaxHeight` | Per-feature popup content. |
| **Legend** | `legendEnabled`, `legendPosition`, `legendCollapsed` | Legend visibility + placement. |
| **Widgets** | `showMapControls`, `showGeocoder`, `showCommandPalette`, `showMinimap`, `showDrawTools`, `showMeasureTool`, `showLasso`, `showCompare`, `showSpatialQuery`, `showTimeSplit` | Toggle the eleven utility widgets. |

## Tab 3 — Color and style

| Group | Options | Purpose |
|---|---|---|
| **Palette** | `colorPalette`, `colorScale`, `colorSteps`, `divergingMidpoint`, `customColors` | Continuous, ordinal, and diverging colour schemes. |
| **Symbols** | `markerType`, `markerSize`, `markerOpacity`, `iconLibrary` | MIL-STD-2525C, APP-6, custom SVGs, emoji. |
| **Hexbin / heatmap** | `hexbinOpacity`, `heatmapWeightField`, `heatmapColorRamp` | Aggregation aesthetics. |
| **Basemap** | `tileProvider`, `customStyleUrl`, `mapboxAccessToken`, `mapTilerKey`, `stadiaKey` | Choose the basemap; PMTiles fallback covered in [Air-gapped deployment](../air-gapped.md). |

## Where to read the full enumeration

```bash
jq '.properties | keys' docs/_machine/formatter-schema.json
```

That lists all 82 option keys. For a single option's type, default,
enum values, help text, and Splunk property path:

```bash
jq '.properties.tileProvider' docs/_machine/formatter-schema.json
```

## Pre-flight rule for AI agents

If you (an AI agent) are about to write a dashboard XML that sets a
formatter option, **first look it up in
`docs/_machine/formatter-schema.json`**. The schema's `enum`,
`type`, and `default` fields are normative; setting a value the
schema rejects produces a silent fallback and a debug-HUD line, not
a visible error.
