# Changelog

All notable changes to Better Map are tracked here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-14

First production release. Dashboard Studio only. Tested on Splunk
Enterprise 10.2.

### Added

#### Map foundation (Phase 1)

- MapLibre GL JS map with full lifecycle wiring: `initialize`,
  `getInitialDataParams`, `formatData`, `updateView`, `reflow`, `destroy`.
- WebGL detection with a fatal banner for unsupported browsers.
- `lastGoodData` caching so the map survives a stream of zero-row updates.
- PMTiles protocol registered globally so `pmtiles://` URLs Just Work.
- Tile providers: OpenFreeMap Liberty (default), Positron, Bright; OSM
  raster fallback; MapTiler; Stadia; user-supplied PMTiles; arbitrary
  user-supplied MapLibre style URL.
- Theme-aware light/dark basemap switch driven by
  `SplunkVisualizationUtils.getCurrentTheme()` with an OS
  `prefers-color-scheme` fallback for the test harness.
- Locked attribution for OpenFreeMap / OSM providers.
- Documented CSP smoke test for Splunk 10.2; comment in `mapBuilder.js`
  explains how to swap to `maplibre-gl-csp` if a customer hardens CSP.

#### Data fitness (Phase 2)

- `dataFitness.analyze()` auto-detects field names (`lat`/`latitude`/`y`
  etc.) and parses WKT, GeoJSON, and geohashes.
- Lat/lon swap detection (`abs(value)>90` triggers automatic swap).
- Skip-and-warn semantics: bad rows are dropped and a single warning is
  surfaced via the tiered error banner.
- Promotes common aliases (`color`, `size`, `popup`, `time`, `value`,
  `height`, `icon`, `layerName`) into canonical feature properties so
  every layer can read from the same shape.

#### Core layers (Phase 2)

- Markers (SDF circles with per-feature color / size).
- Clusters (MapLibre clustering with click-to-zoom expansion, spiderfy
  at max zoom).
- Heatmap (Viridis ramp by default).
- Paths (line layer with optional ant-path animation and arrowheads).
- Polygons (geofences with per-feature fill / opacity).
- Choropleth (sequential ramp driven by `value`).
- Floating layer-control widget surfaces when the data has a `layer`
  field with multiple distinct values.

#### Killer features (Phase 3)

- H3 hexbin layer (`h3-js`) with zoom-driven resolution auto-degrade and
  optional 3D extrusion.
- 3D extrusion driven by `height` or `value`. Camera enables pitch +
  rotation by default.
- Feature-join layer with three preset tilesets (world countries / US
  states / world admin-1) and support for arbitrary user-supplied vector
  tile or PMTiles bundles. Client-side join by `feature.id`.
- Indoor / image-overlay layer with multi-floor configuration and a
  floor-switcher UI when the data has a `floor` field.
- Time scrubber widget (play / pause / speed) + comet trail (per-feature
  opacity computed from `time` field).

#### Splunk integration (Phase 4)

- Drilldown: clicks publish feature properties as `FIELD_VALUE_DRILLDOWN`
  tokens.
- Sanitised popups (DOMPurify allow-list) showing the `popup` field.
- Cross-panel coordination: emit `better_map.camera.*` and
  `better_map.selected.*` dashboard tokens; `applyRemoteCamera()` helper
  to consume them.
- `formatter.html` with three Splunk-mandated tabs and ~50 settings,
  every one with inline help text.
- `savedsearches.conf.spec` documenting every formatter option.
- Four preset Dashboard Studio dashboards (Fleet Tracking, Threat Map,
  IoT Sensor Field, Site Availability) + nav.
- Sample lookup `better_map_sample_sites.csv`.
- SPL macros: `better_map_points`, `better_map_iplocation`,
  `better_map_h3`, `better_map_geocode`.

#### Performance, reliability, security (Phase 5)

- `lazyInit.js`: IntersectionObserver gate + WebGL context budget
  (default 12). Panels that exceed the budget render an info banner
  instead of failing.
- `perfHUD.js`: optional FPS / frame time / layer count / free WebGL
  slots overlay.
- `errorStates.js`: tiered banners (`fatal`, `warning`, `info`) with
  dismiss control and ARIA roles.
- `popupSanitizer.js`: DOMPurify with a strict allow-list (no
  `<script>`, no inline events) and `https://` / `pmtiles://` / `data:`
  URL validation for tile, style, and floorplan URLs.
- `viewLock.js`: auto-fit only on the first non-empty load. Floating
  "Reset view" + "Lock view" widget preserves manual pan/zoom across
  data updates.

#### Polish (Phase 6)

- Visible focus rings on every interactive control.
- `a11y.js`: hidden ARIA live region announces layer toggles and view
  events; map canvas tagged as `role=application` with keyboard hints.
- High-contrast mode (`is-high-contrast`) replaces translucent surfaces
  with WCAG AAA black/white widget chrome.
- Map label language switcher (`labelLanguage`) covering 12 languages
  via `name:<lang>` coalesce expression.
- `theme.js`: polled Splunk theme + OS `prefers-color-scheme` fallback;
  mirrors current theme onto the viz root for widget-level theming.
- `exportShare.js`: PNG export via `map.getCanvas().toDataURL()` (a
  `preserveDrawingBuffer: true` map is created by default) and share URL
  encoding the current camera state into the URL hash.

### Notes

- AppInspect precert: clean pass on `splunk-appinspect 4.2.0` with
  `--mode precert` (108 success / 140 N/A / 1 skipped, 0 failures,
  0 warnings, 0 future failures) and again with `--included-tags cloud`
  (104 success / 137 N/A / 1 skipped, 0 failures, 0 warnings). Report:
  `dist/appinspect-precert.json` (cloud) and
  `dist/appinspect-precert-all.json` (all tags).
- The three preset PMTiles bundles are not shipped with the app due to
  size. Drop them into
  `appserver/static/visualizations/better_map/presets/` before deploy if
  you need the feature-join presets.
- All cryptography-related plan items use modern algorithms only; no
  custom crypto is implemented or shipped.

## [0.1.0] - 2026-05-14

### Added

- Phase 0 foundation: Splunk app skeleton, webpack pipeline, build.sh,
  AMD entry stub, license + notice + readme + CI scaffolding.

[1.0.0]: https://example.invalid/better-map/releases/tag/v1.0.0
[0.1.0]: https://example.invalid/better-map/releases/tag/v0.1.0
