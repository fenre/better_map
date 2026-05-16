# Changelog

All notable changes to Better Map are tracked here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-05-16

### Added — additive opt-in feature pack on top of the v1.5.2 BM-CT-1 contract

v1.5.2 finished the foundational BM-CT-1 contract. v1.6 builds on top of
that contract to ship **25 new BM-CT-1 fancy actions** across three
surface areas: widgets, layer modules, and Splunk-platform integrations.
The release also lands a comprehensive client-side spatial-analytics
suite, scrubber upgrades for time-series investigation, and an
air-gapped PMTiles loader for offline / sensitive deployments.

Backwards-compatible. Every v1.6 feature defaults to OFF; existing
v1.5.2 dashboards render exactly as before.

Every new feature ships with the BM-CT-1 contract intact — formatter
default + per-feature toggle in the on-map control panel + reset back
to author intent. Every new feature defaults to **OFF** so existing
dashboards continue to render exactly as they did in v1.5.2; dashboard
authors opt-in via the formatter.

### Added — v1.6 widgets (11)

* **Geocoder (`v2Geocoder`)** — Nominatim-backed search box; debounced;
  pan/zoom on select. Free, no API key required.
* **Command palette (`v2CommandPalette`)** — `⌘K` (`Ctrl-K` on Windows)
  opens a fuzzy search across every fancy action, every layer toggle,
  every bookmark; "run preset", "reset view", "export PNG" actions.
* **Minimap (`v2Minimap`)** — corner overview with viewport rectangle,
  synced to the main camera. Lightweight (no second WebGL context).
* **Draw tools (`v2DrawTools`)** — polygon, rectangle, circle, line,
  point. Drawn GeoJSON is emitted as the
  `better_map.draw_finished` dashboard token.
* **Measure tool (`v2Measure`)** — click vertices to compute distance,
  area, bearing via turf.js. Copy-to-clipboard.
* **Lasso select (`v2Lasso`)** — freehand-polygon multi-select with a
  right-click context menu over the selection.
* **Brushing (`v2Brushing`)** — cursor-radius highlight; features
  outside the radius dim out for focused inspection.
* **Side-by-side compare (`v2SideBySide`)** — vertical divider between
  two basemaps for before/after comparison.
* **Spatial query (`v2SpatialQuery`)** — drawn shapes emit an SPL
  `where`-geomatch template into the `better_map.spatial_query`
  dashboard token so downstream panels can filter to the polygon.
* **Time-window split view (`v2TimeSplit`)** — same camera, two time
  windows of the same data, split by a vertical divider. Layer ids:
  `<layerId>__tsplit_before` and `<layerId>__tsplit_after`.
* **Markdown popup (`createMarkdownPopup`)** — rich-content popup using
  the `marked` library + DOMPurify allow-list. Sparkline / KPI tiles.

### Added — v1.6 layer modules (7)

* **WMS raster layer (`v2WmsLayer`)** — overlay arbitrary WMS GetMap
  services; opacity + tile-size configurable.
* **KML import layer (`v2KmlLayer`)** — `@tmcw/togeojson` converts KML
  uploads into markers / paths / polygons.
* **Trip replay layer (`v2TripsLayer`)** — TripsLayer-style multi-track
  replay with trailing fade tied to the scrubber.
* **Geofence layer (`v2GeofenceLayer`)** — draw or load polygons; SPL
  alert template for in/out events shown in the formatter help text.
* **Wind / flow-field layer (`v2WindLayer`)** — GPU-friendly particle
  system over a u/v vector field input.
* **Scenegraph layer (`v2ScenegraphLayer`)** — high-DPI canvas sprites
  (drone, truck, ship, aircraft, generic) with bearing-aware rotation.
* **MIL-STD-2525C / APP-6 symbology (`v2Mil2525Layer`)** — tactical
  symbols rendered via `milsymbol`. Driven by the `symbol_code` field.

### Added — v1.6 Splunk integrations (8)

* **MITRE ATT&CK overlay (`v2Mitre`)** — enriches features carrying an
  `attack_id` field with the technique name + tactics; emits a
  `savedsearches.conf` annotation stanza for new detections.
* **ES notable drilldown (`v2EsNotable`)** — URL builder for
  `/app/SplunkEnterpriseSecuritySuite/incident_review` and REST stub
  for `notable_update` (mark-closed). Configurable base URL.
* **ITSI service map (`v2Itsi`)** — fetches services + dependencies
  from `itsi/services.json`, normalises into a `{nodes, edges}` graph,
  applies a force-directed layout for services missing explicit geo.
* **SOAR playbook trigger (`v2Soar`)** — right-click selection POSTs
  the GeoJSON entity collection to a configurable `phantom_forward`
  URL. CSRF-aware via the shared splunkdFetch helper.
* **RBA risk heatmap (`v2Rba`)** — emits an SPL helper macro for
  `index=risk | bin lat | bin lon | stats sum(risk_score)`, plus a
  helper to parse the result into GeoJSON.
* **OT Purdue / IEC 62443 overlay (`v2Purdue`)** — joins features
  against an asset-register lookup (configurable name) and colours
  each marker by Purdue level 0–5.
* **A&I geo-resolution (`v2AiGeo`)** — resolves missing lat/lon for
  events by joining against ES `assets.csv` / `identities.csv`;
  features get a `_geoResolvedBy` provenance property.
* **AI Assistant chat panel (`v2AiAssistant`)** — sidebar chat widget
  that POSTs questions to `Splunk_AI_Assistant_Cloud`'s SPL generator
  endpoint and streams answers back. Feature-flagged off by default.

Also: **Geographic correlation-search builder** (pure module) emits SPL
like *"alert when ≥3 auth failures within 50 km within 5 min"* plus a
complete `savedsearches.conf` stanza.

### Added — v1.6 spatial analytics suite

Eight modules under `src/lib/analytics/` for pure client-side spatial
statistics (no Splunk round-trip needed for the maths):

* **DBSCAN** (`dbscan.js`) — `density-clustering` with auto-derived ε.
* **Getis-Ord Gi\*** (`getisOrd.js`) — hot-spot analysis with z-score
  and p-value per grid cell (hex or square).
* **Local Moran's I (LISA)** (`lisa.js`) — HH/LL/HL/LH spatial outlier
  classification with significance.
* **Kernel Density Estimation** (`kde.js`) — Gaussian kernel with
  auto-bandwidth via Scott's rule.
* **Nearest-Neighbour Distance** (`nnd.js`) — distribution + Clark &
  Evans' R statistic against complete spatial randomness.
* **Spatial join** (`spatialJoin.js`) — point-in-polygon, distance-
  along-line, buffer via turf.js, with templated SPL macros for
  equivalent server-side joins.
* **CIM auto-detect** (`cimAutoDetect.js`) — inspects SPL output
  fields and recommends a layer + palette automatically. Authentication
  → markers; Network Traffic → paths; Endpoint → hexbin; etc.

### Added — scrubber upgrades

* **0.5× / 1× / 2× / 4× / 8× / 16× playback** speeds.
* **Reverse playback** (`isReverse()`) — signed speed.
* **Event markers** — notable / alert events render as dots on the
  scrubber rail; click to seek.
* **Anomaly bands** — highlight time ranges where event count exceeds
  a configurable threshold.
* **Time-aligned multi-panel scrub** via the new
  `better_map.time.{cursor_ms,playing,speed}` cross-panel tokens.

### Added — air-gapped PMTiles loader

* `src/lib/basemaps/pmtilesLoader.js` — registers the `pmtiles://`
  protocol with MapLibre and builds a self-contained style.
* `scripts/build-pmtiles.sh` — `tippecanoe` + `pmtiles` CLI pipeline
  for producing the basemap from open data.
* `docs/AIR-GAPPED-PMTILES.md` — prerequisites, source-data sourcing,
  archive building, CSP guidance, Splunk deployment notes.

### Added — v1.6 showcase dashboards (5)

* `better_map_spatial_analytics.xml` — draw tools / measure / lasso /
  brushing demo over a synthetic 3-cluster point cloud.
* `better_map_threat_map_mitre.xml` — ES-style threat map with the
  MITRE overlay enriching each marker.
* `better_map_itsi_service_map.xml` — service tree as geo-positioned
  nodes + edges with health colouring.
* `better_map_rba_heatmap.xml` — RBA risk-score heatmap over a global
  synthetic dataset.
* `better_map_ot_purdue.xml` — two-site OT plant with Purdue 0–5
  markers and a safety-related KPI.

Navigation is now grouped:
`Showcases (v1)` / `v1.6 Showcases` / `Diagnostics`.

### Added — bundle aggregator and per-feature defaults

* New `src/lib/widgets/v2Bundle.js` aggregates the 25 BM-CT-1 entries
  behind a single `createV2Bundle()` factory that the visualization
  shell wires up after the map is live. Every entry is auto-registered
  with the master control panel via `register(builder)` so users
  discover them without code changes.
* `_applyV2Defaults()` re-applies the formatter's per-feature
  default-state map on every redraw, so dashboard authors can toggle a
  feature without reloading.
* `README/savedsearches.conf.spec` documents all 25 new option keys.

### Notes for production deployments

Every Splunk integration in this release ships as a **scaffold**: the
client-side modules, formatter, control panel, and showcase dashboards
all wire up cleanly, but live verification against Enterprise Security
/ ITSI / SOAR / `Splunk_AI_Assistant_Cloud` requires those add-ons in
the target tenant. The scaffolds degrade gracefully when their
endpoints are absent (no-op + console warning).

## [1.5.2] - 2026-05-16

### Added — the BM-CT-1 Control Trio contract (the "every fancy action needs enable / disable / reset" release)

v1.5.0 made the maps look good. v1.5.1 made them feel alive with five
concurrent animation systems. The next user feedback was a process
constraint, not a visual one:

> *"For every fancy action, there needs to be a way to enable and
> disable, and reset that action."*

v1.5.2 is the answer. It introduces a single, enforceable contract —
**BM-CT-1, the Control Trio** — that every animated or interactive
feature in Better Map now satisfies, plus the runtime UI and reset
plumbing to expose it to dashboard end-users. The contract is codified
as a Cursor rule at `.cursor/rules/bm-control-trio.mdc` so future
fancy actions cannot ship without it.

### The Control Trio (BM-CT-1)

Every "fancy action" in Better Map (any animation, any interactive
overlay, any motion or transformation that isn't strictly required
for the data to render) MUST provide:

1. **Enable** — turn the action on. Exposed as a formatter option
   (Layer A — dashboard-author default) AND as a per-action toggle in
   the on-map control panel (Layer B — runtime user override).
2. **Disable** — turn the action off cleanly. No half-frozen DOM, no
   stale RAF tick, no leaked layer.
3. **Reset** — return the action to its dashboard-author default
   state (Layer A). Distinct from disable: reset un-does the user's
   runtime override, restoring whatever the dashboard JSON specified.

The three-layer state model (Layer A defaults / Layer B runtime overrides
/ Layer C reset operations) is documented in the rule and enforced
through `MapBuilder.getDashboardDefaults()` + per-module `_defaults`
registries captured on first option-application.

### Added — `src/lib/controlPanel.js` (the on-map control widget)

New collapsible floating widget that surfaces every registered fancy
action to the dashboard end-user without forcing them through the
formatter. Sits in the top-right corner by default (configurable).

- **Compact launcher** — `⚙ Controls` chip, single click expands.
- **Per-action row** — each registered action gets:
  - Icon + descriptive label (e.g. `☄ Traveling comets`,
    `↻ Marching dashes`, `♥ Marker heartbeat`,
    `▣ Breathing extrusion`, `◯ Camera auto-orbit`).
  - Toggle switch (Layer B — runtime override).
  - Reset button `↺` (Layer C — restore Layer A default).
  - State indicator (live — reflects current enabled/disabled state
    on every render, not just on user click).
- **Master controls footer** — two always-available commands:
  - **Pause all motion** toggle — flips a global flag that suspends
    every animated RAF loop in the viz. Implemented at the
    `motion.js` layer so it's a single source of truth, not five
    parallel kill-switches. Works in concert with the OS-level
    `prefers-reduced-motion` preference (whichever is "stop motion"
    wins).
  - **Reset view** button — single action that resets the camera
    to its initial center / zoom / pitch / bearing AND resets every
    registered fancy action to its Layer A default AND resets the
    layer-control visibility (all layers shown) AND resets the time
    scrubber (paused, 1× speed, end-of-range).

Full keyboard / focus / ARIA support. CSS-themed for light / dark /
high-contrast variants matching the existing layer control and
scrubber widgets.

### Added — five fancy actions registered with the Control Trio

The five animation systems from v1.5.1 are now individually registered
as fancy actions through `MapBuilder.registerFancyAction(id, spec)`:

1. **Traveling comets** (`path.comet`) — `paths.js` exposes
   `setComet(map, enabled)` / `isCometEnabled()` / `reset(map)`.
2. **Marching dashes** (`path.animated`) — `paths.js` exposes
   `setAnimated(map, enabled)` / `isAnimatedEnabled()` / `reset(map)`.
3. **Marker heartbeat** (`marker.pulse`) — `markers.js` exposes
   `setPulse(map, enabled)` / `isPulseEnabled()` / `reset(map)`.
4. **Breathing extrusion** (`extrusion.pulse` + `hexbin.pulse`) —
   `extrusion.js` and `hexbin.js` each expose
   `setPulse(map, enabled)` / `isPulseEnabled(map)` / `reset(map)`.
   Both layers' pulse handlers are routed through the shared
   `extrusionPulse.js` module which gained `isExtrusionPulseRunning`,
   `hasAnyExtrusionPulseOnMap`, and `resetExtrusionPulsesOnMap`
   helpers.
5. **Camera auto-orbit** (`camera.autoOrbit`) — `MapBuilder` gained
   `isAutoOrbiting()` and routes auto-orbit through the new
   `shouldSuppressMotion()` helper so it freezes cleanly when the
   master pause flips on or `prefers-reduced-motion` becomes true.

### Added — unified motion suppression: `shouldSuppressMotion()`

Single helper in `src/lib/motion.js` that combines the OS-level
`prefers-reduced-motion` MediaQueryList state with the new master
`motionPaused` runtime flag. Every RAF loop in the viz now routes
through `shouldSuppressMotion()` rather than `prefersReducedMotion()`
directly. This fixed a subtle v1.5.1 regression where the OS pref
was respected but a runtime toggle could not turn motion back on
without a full panel reload.

Key behavioural fix: the RAF loops now **always run**. When motion
is suppressed, they paint static fallback once and skip the per-tick
animation work. When motion is unsuppressed (master pause flipped
off OR OS pref changed) the loops resume from a fresh
`startedAt = nowMs()` so the pulse / breath / orbit doesn't jump
forward by however long it was paused — it picks up smoothly.

### Added — master Reset View command

`MapBuilder.resetView()` (called from the control panel's master
Reset button) walks the entire fancy-action registry and calls each
action's `reset(map)`, then calls `resetCamera()` to restore the
initial camera state captured during `init()`, then calls the
visualization shell's reset hooks for the layer control
(`resetVisibility()`) and the time scrubber (`reset()`). One button,
total state restoration.

### Added — Layer Control "Show all" footer

`layerControl.js` gained a footer with a `Show all` button (appears
when the layer control has 2+ entries). This is the layer-control
Control-Trio "reset" operation — single click restores every layer
to visible. Exposed publicly as `resetVisibility()` so the master
Reset View can chain to it.

### Added — Time Scrubber "Jump to start" / "Jump to end" buttons

`time/scrubber.js` gained two buttons that flank the play / pause
controls: `⏮ Jump to start` and `⏭ Jump to end`. Both pause playback
on click so they're predictable. Also exposes `reset()` which sets
the scrubber to paused, 1× speed, current time = max — used by the
master Reset View.

### Added — two new formatter options

| Option | Default | Effect |
|---|---|---|
| `showControlPanel` | `true` | Show / hide the floating control panel widget. Hide to lock the dashboard-author defaults (no runtime user override). |
| `motionPaused` | `false` | Initial state of the master Pause-all-motion toggle. User can flip it at runtime via the control panel. OS-level `prefers-reduced-motion` is still honoured on top of this. |

Both options live in a new "Map controls (BM-CT-1)" section in the
formatter's "Data display" tab.

### Files added / modified

- **Added**: `.cursor/rules/bm-control-trio.mdc` — the BM-CT-1
  contract, three-layer state model, anti-patterns, machine-readable
  rule for future fancy-action authors.
- **Added**: `src/lib/controlPanel.js` — collapsible on-map control
  widget with per-action toggle / reset + master Pause + Reset View.
- **Modified**: `src/lib/motion.js` — added `setMotionPaused`,
  `isMotionPaused`, `onMotionPauseChange`, `shouldSuppressMotion`
  (master + accessibility kill-switch combined).
- **Modified**: `src/lib/mapBuilder.js` — added
  `_dashboardDefaults` capture in `init()`, `setDashboardDefaults`,
  `getDashboardDefaults`, `registerFancyAction`, `getFancyActions`,
  `unregisterFancyAction`, `setMotionPaused`, `isMotionPaused`,
  `resetAllMotion`, `resetCamera`, `resetView`, `isAutoOrbiting`;
  `_tickOrbit` now routes through `shouldSuppressMotion()`.
- **Modified**: `src/lib/layers/paths.js` — added `_defaults` /
  `_currentFc` module-global state, `setAnimated`, `setComet`,
  `isAnimatedEnabled`, `isCometEnabled`, `reset` exports; `tick`
  and `tickComet` now route through `shouldSuppressMotion()`.
- **Modified**: `src/lib/layers/markers.js` — added `_defaults`
  module-global state, `setPulse`, `isPulseEnabled`, `reset`
  exports; `startPulse` / `tickPulse` always run RAF and switch
  between static + animated paint based on `shouldSuppressMotion()`.
- **Modified**: `src/lib/extrusionPulse.js` — added
  `isExtrusionPulseRunning`, `hasAnyExtrusionPulseOnMap`,
  `resetExtrusionPulsesOnMap` helpers; the tick loop now always
  runs and paints neutral when motion is suppressed.
- **Modified**: `src/lib/layers/extrusion.js` and
  `src/lib/layers/hexbin.js` — added `_defaults` /
  `_lastBaseHeightExpr` / `_lastAmplitude` / `_lastPeriodMs` /
  `_lastPhaseOffset` module-global state, `setPulse`,
  `isPulseEnabled`, `reset` exports per the BM-CT-1 contract.
- **Modified**: `src/lib/layerControl.js` — added `Show all`
  footer button + `resetVisibility()` public method.
- **Modified**: `src/lib/time/scrubber.js` — added
  `⏮ Jump to start` and `⏭ Jump to end` buttons + `reset()`
  public method (pauses, 1× speed, time = max).
- **Modified**: `src/visualization_source.js` — added imports for
  all layer modules + `controlPanel.js`; parses
  `showControlPanel` and `motionPaused`; calls
  `_registerFancyActions()` and `_mountControlPanel()` in
  `waitForVisible`; renders control panel on every `updateView`;
  destroys control panel cleanly in `destroy()`.
- **Modified**: `formatter.html` — added "Map controls (BM-CT-1)"
  section with `showControlPanel` and `motionPaused` selects.
- **Modified**: `visualization.css` — added themed styles for
  `.better_map-control-panel` (launcher / body / row / toggle /
  reset / footer) and reset buttons in layer-control footer and
  scrubber. Honours `is-theme-light` and `is-high-contrast`
  variants.
- **Modified**: `default/app.conf` → `version = 1.5.2`,
  `build = 1502`; `src/lib/debugHud.js` →
  `HUD_VERSION = 'v1.5.2'`.

### Accessibility

- Every per-action toggle and reset button has an ARIA label.
- Master Pause carries `aria-pressed` reflecting current state.
- Master Reset View announces completion via the existing ARIA
  live region.
- Focus order in the control panel follows visual order top-down.
- Keyboard activation: `Enter` / `Space` on toggles and buttons;
  `Esc` collapses the panel back to the launcher.
- High-contrast theme: panel surface is WCAG AAA solid black/white;
  toggle states are distinguishable without colour (filled vs
  outlined).
- OS-level `prefers-reduced-motion` continues to be honoured. When
  it's `reduce`, the master Pause toggle in the control panel is
  visually marked as "OS pref active" and changing it has no effect
  until the OS pref changes (single source of truth).

### Visual options table (added in v1.5.2)

| Option | Default | Type | Notes |
|---|---|---|---|
| `showControlPanel` | `true` | bool | Show / hide the floating control panel widget. Hide to lock dashboard-author defaults. |
| `motionPaused` | `false` | bool | Initial state of the master Pause-all-motion toggle. Runtime-flippable from the control panel; OS `prefers-reduced-motion` is still honoured on top. |

## [1.5.1] - 2026-05-16

### Added — five-system motion stack (the "still very static" fix)

v1.5.0 landed the visual treatment — dark-cosmos basemap, glow paths,
pulsing markers, great-circle arcs, 3D cinematic camera, vignette — and
the user's reaction was *"Everything looks super sexy now, but the
graphical overlays are still very static. Is it possible to animate
anything?"*

v1.5.1 is the answer. Five concurrent animation systems were added,
all sharing one accessibility contract (the OS-level
`prefers-reduced-motion` preference disables all five) and one
scheduler primitive in the new `src/lib/motion.js` module.

1. **Traveling-comet arc emitters (`pathComet`, auto-detected default).**
   Every feature flagged `properties.isArc = true` by `dataFitness.js`
   gets a glowing point emitted from the source vertex; the comet
   travels along the great-circle LineString at ~6 s per traversal,
   loops, and pulls its color from the arc's per-feature paint. Two
   layers under the hood: `better_map_paths_comet_glow` (wide blurred
   under-layer, 1.6× radius, 0.55 opacity) and `better_map_paths_comet`
   (sharp top dot, 1× radius, 1.0 opacity). The two layers share a
   single FeatureCollection source updated every RAF tick with the
   current `positionAlongArc(t)` for each emitter. Comets are emitted
   on stagger — first emitter at phase 0.0, second at 0.18, etc. — so
   even a six-arc threat map doesn't look like Simon Says.

2. **Phase-shifted marching dashes (`pathAnimated`, default off).**
   Replaces the v1.5.0 `rotateDashArray` hack. A pre-computed
   16-step `FLOW_DASH_STEPS` table cycles through dash-array values
   that emulate `line-dasharray-offset` (which MapLibre does not
   support). The pattern is applied to BOTH the sharp top stroke
   (`better_map_paths_line`) AND the glow under-layer
   (`better_map_paths_line_glow`) so the entire glowing band marches
   in lockstep, not just the top line.

3. **Severity-bound heartbeat (`pointPulse`, default on).**
   Markers now read each feature's color (the `paint` property
   produced by the SPL) and classify it into one of four tiers:
   `critical` (red / rose / orange-red), `warning` (amber / orange),
   `ok` (lime / green), or `neutral` (anything else). Critical-tier
   features get a third, faster ring on the new
   `better_map_markers_pulse_heartbeat` layer that pulses at 0.85 s
   period (vs the baseline 1.8 s). Visual effect: alert markers
   physically pulse faster than nominal markers — the urgency
   signal comes through pre-attentively, not via a colour you have
   to read.

4. **Breathing 3D extrusion (`extrusionPulse`, default off).**
   New module `src/lib/extrusionPulse.js` modulates
   `fill-extrusion-height` by ±12 % on a 4 s sine wave for any layer
   it is started against. Shared by both `extrusion.js` (generic
   prism layers) and `hexbin.js` (H3 hex cells). When two extrusion
   layers run on the same map, hexbins are phase-offset by π/2 so the
   two systems breathe in counterpoint instead of in unison.

5. **Camera auto-orbit (`cameraAutoOrbit` + `autoOrbitSpeed`,
   default off).** New `MapBuilder.setAutoOrbit(degPerSec)` API
   continuously updates the map bearing via RAF. Pauses for 5 s
   after any user `mousedown` / `touchstart` / `wheel` so the
   orbit never fights with manual pan / zoom / drag. Recommended
   speed is 1 – 3 °/s on showcase dashboards; faster than ~5 °/s
   starts inducing motion sickness on big monitors.

### Added — `src/lib/motion.js` shared motion primitives

Single module that owns the `prefers-reduced-motion` MediaQueryList
(cached + `change`-listener bound so flipping the OS pref while a
dashboard is open takes effect immediately), the RAF / setTimeout
scheduling fallback, and a `performance.now()`-preferring monotonic
clock. All five animation systems above route through these helpers.

### Changed — showcase dashboards wired with the new motion options

- **`better_map_threat_map`**: `pathComet=true` and `cameraAutoOrbit=true`
  with `autoOrbitSpeed=2`. The threat map now animates traffic flow
  along its great-circle arcs and slowly rotates the world view.
- **`better_map_overview`**: hexbin map gets `extrusionPulse=true` +
  `cameraAutoOrbit=true autoOrbitSpeed=1.5`; sites map gets
  `cameraAutoOrbit=true autoOrbitSpeed=2`. Both visuals breathe and
  rotate together.
- **`better_map_iot_sensor_field`**: `extrusionPulse=true` and
  `cameraAutoOrbit=true autoOrbitSpeed=1.2`. Hex columns breathe;
  camera orbits at the slowest speed because IoT analysts need to
  read sensor IDs without chasing them.
- **`better_map_fleet_tracking`**: `pathAnimated=true` already on
  from v1.5.0 — now upgraded to the proper phase-shifted marching
  dashes (no config change needed; the new behaviour ships in the
  bundle).
- **`better_map_site_availability`**: `pointPulse=true` already on
  from v1.5.0 — now upgraded to severity-bound heartbeats for
  critical / warning markers (no config change needed).

### Accessibility

Every RAF loop added in this release calls `prefersReducedMotion()`
at start and bails out (or renders a tasteful static fallback —
e.g. comet midpoints frozen at arc midpoints, extrusion height
frozen at the un-modulated value) when the user has the OS pref
set. Aligns with WCAG 2.1 SC 2.3.3 ("Animation from Interactions")
since none of the five animations are semantically essential.

### Files added / modified

- **Added**: `src/lib/motion.js` — shared `prefersReducedMotion`,
  `scheduleFrame`, `cancelFrame`, `nowMs` primitives.
- **Added**: `src/lib/extrusionPulse.js` — reusable
  `startExtrusionPulse` / `stopExtrusionPulse` /
  `stopAllExtrusionPulsesOnMap` helpers for any
  `fill-extrusion-height` layer.
- **Modified**: `src/lib/layers/paths.js` — `FLOW_DASH_STEPS`
  table, dual-layer dash application, comet emitter system
  (`COMET_SOURCE_ID`, `LAYER_COMET`, `LAYER_COMET_GLOW`,
  `startCometEmitter`, `tickComet`, `positionAlongArc`,
  `greatCircleSegmentLen`, `cumulativeArcLengths`,
  `easeInOutCubic`).
- **Modified**: `src/lib/layers/markers.js` — `TIER_BY_HEX`,
  `tierForColor`, `enrichTiers`, `LAYER_PULSE_HEARTBEAT`.
- **Modified**: `src/lib/layers/extrusion.js`,
  `src/lib/layers/hexbin.js` — switched to `extrusionPulse.js`
  helpers.
- **Modified**: `src/lib/mapBuilder.js` — `setAutoOrbit`,
  `_stopAutoOrbit`, `_attachOrbitPauseHandlers`,
  `_detachOrbitPauseHandlers`, `_tickOrbit`.
- **Modified**: `src/visualization_source.js` — parses new
  options `pathComet`, `extrusionPulse`, `cameraAutoOrbit`,
  `autoOrbitSpeed`; threads them into layer option bags and the
  `setAutoOrbit` call.
- **Modified**: showcase dashboards
  (`better_map_threat_map.xml`, `better_map_overview.xml`,
  `better_map_iot_sensor_field.xml`).
- **Modified**: `default/app.conf` → `version = 1.5.1`,
  `build = 1501`; `src/lib/debugHud.js` → `HUD_VERSION = 'v1.5.1'`.

### Visual options table (new in v1.5.1)

| Option | Default | Type | Notes |
|---|---|---|---|
| `pathComet` | `auto` | bool/'auto' | Auto = on when feature has `isArc=true`. Force with `true`/`false`. |
| `extrusionPulse` | `false` | bool | Breathing height on `splunk.extrusion` and `splunk.hexbin` layers. |
| `cameraAutoOrbit` | `false` | bool | Slow continuous rotation of map bearing. |
| `autoOrbitSpeed` | `3` | number (°/s) | Orbit speed when `cameraAutoOrbit=true`. Recommended range 1 – 3. |

---

## [1.5.0] - 2026-05-16

### Added — "sexy maps" visual upgrade (the v1.5.0 transformation)

After v1.4.1 shipped with the v1.4.1 layout pattern (KPIs + filters + side
table + sparkline) wired up across the Fleet Tracking dashboard, the user
feedback was direct: *"This looks nothing like the sexy maps that are out
there."* The 2D pastel-on-light look — flat lines and dots on the
OpenFreeMap Liberty / Positron raster basemaps — felt "out of the 2000s".

v1.5.0 is a full visual overhaul of the rendering layer. Every overlay
that used to render as a flat one-pixel stroke or a solid filled circle
now renders as a glowing / pulsing / curving / extruded volumetric
graphic on a near-black cosmic basemap.

The five new visual capabilities, all enabled by default:

1. **Carto Dark Matter basemap.** New default tile provider. Near-black
   cosmic background that makes every overlay (glow paths, pulsing
   dots, great-circle arcs, viridis hexbins) pop. The previous
   light-tile defaults (`openfreemap_liberty` / `openfreemap_positron`)
   are still selectable for dashboards that want them.
2. **Glow paths (`pathGlow`, default true).** Each line is rendered
   twice: a wide, semi-transparent, blurred under-layer (4.5× width,
   1.6× blur radius, 0.18 opacity) PLUS the sharp top stroke. The
   effect is laser-beam-style emission instead of a single flat pixel
   line.
3. **Great-circle arcs (`pathArc`, auto-detected).** When the SPL
   provides `src_lat` / `src_lon` / `dst_lat` / `dst_lon`-style
   origin-destination coordinates, `dataFitness.js` now generates
   curved 64-segment LineString features via spherical linear
   interpolation (slerp on the unit sphere). Includes antimeridian
   handling so trans-Pacific arcs render as one curved line, not two
   straight half-lines pinned to ±180°. This eliminates the
   straight-string-of-spaghetti NORSE-map look.
4. **Pulsing markers (`pointPulse`, default true).** Two concentric
   `circle` layers under each point, animated by a single
   `requestAnimationFrame` loop. Outer + inner rings run 60° out of
   phase, expanding 1× → 4× the base radius and fading 0.55 → 0 over
   a 1.8 s period. The visual is a continuous radar ping rather than
   a flat dot.
5. **3D cinematic camera (`cameraPitch`=30°, `cameraBearing`=15° default).**
   Initial map pitch and bearing default to a cinematic perspective
   so glow paths and pulsing markers read as 3D geometry rather than
   top-down line-art. Dashboards can opt back into pure top-down with
   `cameraPitch=0 cameraBearing=0`.
6. **Vignette overlay (`vignette`, default true).** Pure-CSS
   radial-gradient pseudo-element layered over the map container.
   Darkens the corners by ~32% so the user's eye is naturally drawn
   to the centre of the viewport. Includes a `prefers-reduced-motion`
   suppression branch for accessibility.

### Added — three new categorical palettes

- **`cyber`** (the new default for showcase dashboards). 10-color neon
  palette: cyan / lime / amber / rose / violet / cyan-500 / orange /
  pink / emerald / yellow. Designed against `#0c0e14` for AAA contrast.
- **`synthwave`**. 8-color hot-pink + electric-cyan + amber retro-futurist
  palette for high-energy panels.
- **`tactical`**. 8-color amber-on-charcoal Palantir / C2 / NORAD-style
  palette for serious-business OT dashboards.
- New `statusColor()` helper exported from `palettes.js` returns a CYBER
  hex matched to common status nouns (`critical`/`alert` → rose,
  `warning`/`idle` → amber, `ok`/`pass` → lime, `in-transit`/`active`
  → cyan), so dashboards don't have to re-type the same case() expression.

### Added — all 5 preset dashboards upgraded with the v1.4.1 layout

All five preset dashboards now share the same shape: top-row KPI strip
+ filter dropdowns + main map + side-panel tables + bottom sparkline.

- **`better_map_threat_map`** (rewritten): 5 KPIs (attacks/min,
  blocked %, critical count, unique sources, top severity), severity
  + action filter dropdowns, top-source-country / top-target /
  top-attack-type side tables, attacks/min stacked-area sparkline
  split by severity bucket. SPL now emits `src_lat`/`src_lon`/
  `dst_lat`/`dst_lon` so the arc generator fires automatically. Cyber
  palette dominant. 80 attack flows, NORSE aesthetic.
- **`better_map_fleet_tracking`** (patched): Cyber palette swap
  (`#22d3ee` / `#a3e635` / `#fbbf24` / `#f43f5e` replace the previous
  set3 pastels), `carto_dark_matter` basemap, `pathGlow=true`,
  `pointPulse=true`, `cameraPitch=35`, `vignette=true`. Existing
  v1.4.1 layout retained.
- **`better_map_site_availability`** (rewritten): 5 KPIs (total /
  healthy % / warning / critical / hottest region), region + category
  + status filter dropdowns, top-regions + critical-sites side
  tables, status-distribution stacked column chart. Pulsing site
  markers color-coded by status, cyber palette.
- **`better_map_iot_sensor_field`** (rewritten): 5 KPIs (sensors /
  mean / max / over-threshold / hottest zone), zone + sensor-type
  filter dropdowns, top-zones + alarming-sensors side tables,
  mean-reading area-chart split by zone. 45° cinematic pitch on the
  3D hexbin to show the column heights as actual volumetric data.
- **`better_map_overview`** (rewritten): 4 cross-domain KPIs (active
  threats / fleet on-road / sites healthy % / sensors alarming),
  twin cinematic dark-matter maps side-by-side (3D-extruded incident
  hexbins on left, pulsing global site markers on right with cyber
  layer-control filter), recent-events table along the bottom.

### Changed — defaults

- `cameraPitch` default changed from `0` (flat top-down) to `30°` (3D
  cinematic). User chose "FULL" pacing in the v1.5.0 planning round
  so this is now the out-of-the-box look for any dashboard that
  doesn't explicitly opt out.
- `cameraBearing` default changed from `0` to `15°`.
- Showcase dashboards use `palette="cyber"` instead of `set3` /
  `viridis` (viridis remains the default for hexbin / choropleth /
  any numeric ramp where viridis perceptual uniformity matters).

### Deferred — additive items planned for v1.5.1+

- **`pointIcon`** — bundled SVG vehicle / sensor / shield icons with
  optional `iconBearingField` for rotation. Cancelled from v1.5.0
  scope so users see the dark-matter + glow + arcs + pulse + 3D +
  vignette + cyber transformation first.
- **`enable3DExtrusion` auto-default-on for hexbins with a metric
  field.** Currently per-dashboard opt-in via the existing
  `enable3DExtrusion` option.
- **`flyTo` cross-panel transitions** — smooth 1500 ms cubic-ease
  camera transitions when filters change, instead of the current
  instant `fitBounds` jump.

### Internal

- `app.conf` bumped to `version = 1.5.0` / `build = 1500`.
- HUD version string bumped to `v1.5.0`. `showDebugHud` continues to
  default to `false` (confirmed across all 5 showcase dashboards).
- New layer IDs `better_map_paths_line_glow`,
  `better_map_markers_pulse_outer`, `better_map_markers_pulse_inner`
  are added to the path / marker layer modules. All three are
  cleaned up on `unmount` and toggle through `setVisible`.
- `better_map-vignette` CSS class is added to the visualization
  container when the `vignette` option is on; a `prefers-reduced-motion`
  media query suppresses the gradient for accessibility.

## [1.4.0] - 2026-05-15

### Released — canonical AMD-based release

v1.4.0 promotes the AMD-bundled custom visualization architecture from
"diagnostic milestone" to "canonical release". All ten symptom classes
catalogued in the `splunk-ds-onprem-custom-viz` SKILL (Symptoms A
through J) are resolved in this build. Live-validated on Splunk
Enterprise 10.2.x with Dashboard Studio (`version="2"`) — the Fleet
Tracking dashboard renders 4 truck trail spirograph patterns at NYC /
SF / London / Tokyo, and the Threat Map dashboard renders the full
NORSE-style attack visualization with 80+ attack lines streaking from
random global origins into Washington DC / London / Tokyo.

### Removed (~629 MB of failed React DashboardCore rewrite scaffolding)

After the React rewrite was abandoned in v1.3.6 — once the v3-spec-key
trap (Symptom D) and webpack ESM-default-export trap (Symptom E) were
identified as the actual root cause of the grey-placeholder symptoms
that triggered the rewrite — the scaffolding stayed in the repo as
diagnostic infrastructure. v1.3.18 → v1.3.25 then proved the AMD viz
path works end-to-end on the same Splunk Enterprise on-prem build, so
the React scaffolding has no remaining purpose. v1.4.0 removes:

- **`better_map/appserver/static/react/`** (573 MB) — the React
  DashboardCore host with `node_modules` (419 packages),
  `package-lock.json`, `webpack.config.js`, `.babelrc`, and `src/`
  (`index.jsx`, `DashboardHost.jsx`).
- **`better_map/appserver/static/pages/`** (56 MB) — the pre-built React
  bundle (`bm_react.v135.bundle.js` at 13.9 MB),
  `bm_react.v135.bundle.js.LICENSE.txt` (21.5 KB), and the unminified
  sourcemap (`bm_react.v135.bundle.js.map` at 44.8 MB).
- **`better_map/appserver/static/bm_bootstrap_test.js`** (1.9 KB) — Stage
  0 sanity-check IIFE that proved Splunk's `<dashboard script="...">`
  mechanism is alive (no longer needed; the AMD viz path bypasses
  that entirely).
- **`better_map/appserver/static/bm_bootstrap_test.css`** (105 bytes).
- **`better_map/default/data/ui/views/bm_bootstrap_test.xml`** (1.4 KB) —
  the Stage 0 test dashboard.
- **`better_map/default/data/ui/views/bm_react_test.xml`** (2.8 KB) —
  the Stage 3 React DashboardCore test dashboard.

The two test-dashboard `<view>` entries are removed from
`default/data/ui/nav/default.xml`. The user-facing nav now contains only
the seven preset dashboards plus `search`.

### Changed — `build.sh` reduced from 6 stages to 4

- Removed step `[4/6] Install React npm deps` and step `[5/6] Build
  bm_react.bundle.js` — both relied on the deleted `react/` directory.
- Removed all `--exclude` arguments for `react/` and `pages/`
  subdirectories from the `tar` invocation.
- Renumbered remaining stages to `[1/4]` through `[4/4]`.
- **Added** a tail-check that verifies `visualization.js` ends with
  `.default}()})` — the canonical signal that webpack unwrapped the
  ESM default export and DS will receive the viz constructor (NOT the
  `__webpack_exports__` wrapper). See SKILL Symptom E. Without this
  check, a regression in `webpack.config.js` (e.g., losing
  `output.library.export = 'default'`) would produce a "successful"
  build that silently shows the grey placeholder icon in DS.

### Changed — `README.md` rewritten for the canonical AMD architecture

The README now opens with a dedicated **Architecture (v1.4.0)** section
documenting:

- **The four conditions** for a working AMD viz on Splunk Enterprise
  10.2.x DS (AMD prefix, default-export tail unwrap, no v3-spec keys
  in `visualizations.conf`, three-section formatter with exact standard
  labels), each with a link to the SKILL symptom that covers the
  failure mode if that condition is violated.
- **MapLibre integration traps** table covering all four runtime
  failure modes that v1.3.18 → v1.3.25 fixed: bm-protocol Request-shape
  bypass (Symptom G), demo-SPL future-time + tight trail-window trap
  (Symptom H), `mountAndUpdate` architectural escape hatch (Symptom H
  follow-up), `text-font` requirement on every symbol layer
  (Symptom I), and the lazy-init off-screen-tab diagnostic trap
  (Symptom J).
- **Dashboard build cache-busting** subsection explaining the
  `[install] build = N` mechanism and why it must be bumped
  monotonically in lockstep with every release.

The Troubleshooting section gains five new rows covering Symptoms D, G,
H, I, J. The Repository Layout section is updated to remove the
deleted `react/` and `pages/` directories. The Development section
gains a new "Deploy iteration loop (the fast path)" subsection
documenting the six-step hard-refresh-and-verify protocol that solves
the "I deployed but the browser is still on the old bundle" symptom.

The Preset Dashboard Studio dashboards table is expanded from 4 to 7
entries (added `better_map_overview.xml`, `better_map_debug.xml`, and
`better_map_osm_test.xml` which were always shipped but not previously
documented).

### Changed — version bumps

- `default/app.conf` — `[launcher] version = 1.4.0`,
  `[install] build = 1400` (the build number is the numeric portion of
  the version, used by Splunk Web to invalidate the static-asset
  `?build=N` query string).
- `appserver/static/visualizations/better_map/src/lib/debugHud.js` —
  `HUD_VERSION = 'v1.4.0'`. The HUD's first line will read
  `[better_map debug v1.4.0] container painted #ff0040 (red) ...` —
  this is the fast-path diagnostic for "did my deploy actually take
  effect", so it MUST track the app version.

### Methodology lesson — when to stop chasing one architecture and pivot

The cumulative cost of pivoting between the AMD path and the React
DashboardCore path was significant: ~3 days of investigation work
between v1.3.6 and v1.3.18. The actual root cause of the grey
placeholder (the `__webpack_exports__` wrapper at the AMD callback's
return value) was a 60-byte tail-check away from being identified at
any point in those 3 days. **Lesson captured in SKILL Symptom E**:
before any deeper diagnosis of a custom-viz placeholder, ALWAYS run
`tail -c 60` on the served `visualization.js` and confirm it ends with
`.default}()})` or `t.exports = r`. Anything else — including the
seemingly innocuous `,o}()})` — silently breaks the AMD contract.

The React DashboardCore path is documented in SKILL "The Canonical Fix —
React DashboardCore + Custom Preset" as a Plan B for cases where the
viz must be a React component using Splunk UI Toolkit, or for genuine
DashboardCore-specific drilldown integration that AMD vizs can't reach.
For pure rendering work (maps, gauges, treemaps, custom charts), AMD
is faster to build, smaller on the wire, and works in both Simple XML
and Dashboard Studio with one bundle.

## [1.3.25] - 2026-05-15

### Fixed (the missing-`text-font` trap — symbol layers wedged the GeoJSON worker thread for `better_map_paths_src`, so line/line_bg layers never tiled either)

- **`appserver/static/visualizations/better_map/src/lib/layers/paths.js`** —
  the arrow-head symbol layer (`LAYER_ARROW`, `type: 'symbol'`) had
  `text-field: '\u25B6'` but **NO `text-font`** declaration. The
  MapLibre style-spec default for `text-font` is
  `["Open Sans Regular", "Arial Unicode MS Regular"]`. OpenFreeMap's
  glyphs endpoint hosts ONLY Noto Sans variants — so MapLibre's worker
  thread issued 22 sequential requests for
  `https://tiles.openfreemap.org/fonts/Open%20Sans%20Regular/<range>.pbf`
  that all returned HTTP 404. Those font 404s wedged the GeoJSON-source
  worker that owns `better_map_paths_src`, which then never produced
  any tile output — not even for the `LAYER_LINE_BG` and `LAYER_LINE`
  layers that need ZERO glyphs. The HUD's per-source event counter
  showed `better_map_paths_src=t:0/dl:0/loaded:0` despite `setData()`
  being called with valid GeoJSON containing 80 LineString features.
  **Fix**: declared `'text-font': ['Noto Sans Regular']` explicitly on
  the arrow layer's `layout` block. `Noto Sans Regular` is one of the
  fonts OpenFreeMap actually hosts.
- **`appserver/static/visualizations/better_map/src/lib/layers/markers.js`** —
  the marker label symbol layer (`LAYER_LABEL`, only mounted when
  `options.showLabels === true`) had the same omission. Fixed the same
  way: explicit `'text-font': ['Noto Sans Regular']`. The cluster /
  IoT / Site dashboards never hit this because `clusters.js` had
  always declared `text-font` correctly — only `paths.js` and
  `markers.js` had the gap.

### Fixed (Threat Map SPL produced longitudes outside the valid `[-180, 180]` range — the HUD reported `c0=[-186,-30]` for the first feature)

- **`default/data/ui/views/better_map_threat_map.xml`** — the SPL
  `eval origLon = 180 - random()%360` does NOT mean
  `180 - (random() % 360)`. Splunk's eval operator precedence parses
  it left-to-right with implicit equal precedence, yielding
  `(180 - random()) % 360` which can produce values like `-186`
  (outside the valid longitude range). MapLibre's GeoJSON source
  silently rejects features whose coordinates fall outside
  `[-180, 180]` longitude / `[-90, 90]` latitude — they don't even
  show up in `map.querySourceFeatures()`. Fixed by rewriting:
  - `eval origLon = (random() % 340) - 170` (range `[-170, 169]`,
    safely inside the valid longitude range)
  - `eval origLat = (random() % 140) - 70` (range `[-70, 69]`, safely
    inside the valid latitude range AND avoids polar regions where
    Web-Mercator projection distortion makes paths impossible to read)

### Changed (cache-bust regimen, per the v1.3.21 lesson)

- **`default/app.conf`** — bumped `[install] build = 1324` → `1325`,
  `[launcher] version = 1.3.24` → `1.3.25`. Splunk Web rewrites the
  static-asset query string from `?build=N` based on `[install] build`
  — bumping `version` alone is NOT enough to invalidate the year-long
  browser cache (Splunk Web sets `Cache-Control: max-age=31536000` on
  every `/static/app/<app>/...` response).
- **`appserver/static/visualizations/better_map/src/lib/debugHud.js`**
  — `HUD_VERSION` bumped `v1.3.24` → `v1.3.25` so the HUD title line
  is the fast-path "is the JS bundle fresh?" diagnostic.

### Methodology lesson — every symbol layer in a custom MapLibre viz MUST declare `text-font`

When you write a MapLibre symbol layer with `text-field`, the spec
default for `text-font` is `["Open Sans Regular", "Arial Unicode MS Regular"]`.
That default is correct for the MapLibre demo style but is WRONG for
almost every production basemap CDN, because hosting two full font
families is expensive and most CDNs (OpenFreeMap, MapTiler, Stadia,
self-hosted tileservers) host exactly one. **You MUST explicitly
declare a `text-font` value that the basemap CDN you're using
actually hosts** — typically `['Noto Sans Regular']` for OpenFreeMap.

The diagnostic that catches this trap before it ships is the
**per-source `sourcedata` event counter** in the debug HUD:

```
SOURCE EVTS: ne2_shaded=t:40/dl:0/loaded:8 | openmaptiles=t:16/dl:0/loaded:0 | better_map_paths_src=t:0/dl:0/loaded:0
```

When a custom GeoJSON source shows `t:0/dl:0/loaded:0` (zero events
of any type), the worker is wedged. The aggregate
`sourcedata=N (loaded=N tile=N)` line cannot disambiguate this
because basemap-source traffic dominates the totals. Add the
per-source breakdown to your HUD alongside the path-layer probes
from v1.3.22.

The sequence to apply when investigating a custom viz that loads
clean and shows the basemap correctly but produces empty data
layers:

1. **Symptom G first** — apply the `bm{tile,style,sprite,glyphs}://`
   `addProtocol()` bypass to fix the MapLibre Request-shape trap
   (Symptom G in `splunk-ds-onprem-custom-viz` SKILL.md).
2. **Symptom I second** — audit every `addLayer({type: 'symbol', ...})`
   call and confirm `'text-font': [...]` is set to a value the
   basemap actually hosts. NEVER rely on the MapLibre style-spec
   default.
3. **Symptom H third** — if the source still shows `t:0/dl:0/loaded:0`,
   instrument with the path-layer probes
   (`samplePathLayerState` + `sampleCameraState`) to walk the four-state
   decision tree.

The bm-protocol bypass (Symptom G) DOES route font requests through
your custom protocol handler, but it still receives the URL MapLibre
constructed — which contains whatever font name MapLibre asked for
(the default fontstack). Symptom G fixes the network-layer Request
shape; Symptom I fixes the application-layer font name. They are
orthogonal and BOTH must be applied.

## [1.3.24] - 2026-05-15

### Added (mount-with-FC-attached + per-source event counter — the architectural escape hatch and the diagnostic that proved it was needed)

- **`appserver/static/visualizations/better_map/src/lib/layers/paths.js`**
  — added `mountAndUpdate(map, fc, options)` that creates the GeoJSON
  source with the real FeatureCollection ALREADY ATTACHED, instead of
  the legacy `mount()` (creates empty source) → `update()` (calls
  `setData()`) two-step. The empty-mount-then-setData chain is *supposed*
  to work in MapLibre GL JS but on Splunk Dashboard Studio v2 (Splunk
  Enterprise 10.2.3) it leaves the source in a perpetual loading state
  for reasons we are still investigating — `sourcedata` events fire
  with `isSourceLoaded=false` but the worker never reports completion.
  Mounting the source with the real FC already attached on its very
  first call sidesteps the issue: the worker tiles the data on its
  first pass instead of having to handle an empty-then-replaced
  data property.
- **`appserver/static/visualizations/better_map/src/lib/layers/index.js`**
  — dispatcher prefers `strategy.mountAndUpdate(map, fc, opts)` if the
  strategy exposes it, falling back to the legacy `mount()` →
  `update()` path for back-compat with `mapBuilder.setData()` (which
  has no FC at mount time).
- **`appserver/static/visualizations/better_map/src/lib/debugHud.js`**
  — added `recordSourceProbe(probe)` and per-source `sourceEventCounts`
  tracking. The HUD now emits two new lines:
  ```
  SETDATA paths: <srcId> fc=<N> isLoaded=<t|f> feat0=<geomType> c0=[lng,lat] propKeys=[...]
  SOURCE EVTS: <srcId>=t:<tileCount>/dl:<dataloadingCount>/loaded:<loadedCount> | <srcId>=...
  ```
  The first probes the source state immediately after `setData()` is
  called (or after `addSource()` with attached data). The second
  counts MapLibre's `sourcedata` events per source ID over the entire
  session — broken into `dataType=tile` (raster/vector tile output),
  `sourceDataType=metadata` (initial source registration), and
  `isSourceLoaded=true` events (worker reports completion). When a
  custom GeoJSON source shows `t:0/dl:0/loaded:0`, the worker thread
  for that source is wedged.

### Changed

- **`default/app.conf`** — bumped `[install] build = 1322` → `1324`
  (skipped `1323` during a deploy that included a different change set
  that didn't ship), `[launcher] version` → `1.3.24`.
- **`appserver/static/visualizations/better_map/src/lib/debugHud.js`**
  — `HUD_VERSION` bumped to `v1.3.24`.

### Methodology lesson — when `recordSetData` reports `fc=80 c0=[lng,lat]` AND the source still doesn't tile, suspect a sibling-symbol-layer font 404

The new `SETDATA paths:` line confirmed `setData()` was being called
with valid GeoJSON (80 LineString features, valid coordinates). The
new `SOURCE EVTS:` line proved that despite that, the GeoJSON worker
emitted ZERO events of any type for `better_map_paths_src` while the
basemap sources were chugging along (`t:40/dl:0/loaded:8`). The
combination of these two HUD lines is a structural signature of a
worker-thread wedge: data was handed to the worker, the worker
acknowledged nothing in response. v1.3.25 will identify the cause
(missing `text-font` on the arrow symbol layer triggering 22 font
404s that wedge the worker) — see Symptom I in
`splunk-ds-onprem-custom-viz` SKILL.md and the v1.3.25 entry below.

## [1.3.23] - 2026-05-14

### Changed

- Internal v1.3.23 build (not shipped as a deploy artifact). The work
  is captured under v1.3.24 above. Skipped to keep version numbers
  monotonic with the deploy timeline.

## [1.3.22] - 2026-05-14

### Added (Debug HUD: path-layer probes — the diagnostics that close the loop on "data is in MapLibre but doesn't paint")

- **`appserver/static/visualizations/better_map/src/lib/debugHud.js`** —
  two new probes that run every 500ms (or on every `idle` / `style.load`
  event):
  - `samplePathLayerState(map, style)` — for every layer whose id starts
    with `better_map_paths_`, reads back its actual paint properties from
    MapLibre via `map.getPaintProperty()` (line-color, line-width,
    line-opacity, line-dasharray) and reports them inline. Also calls
    `map.querySourceFeatures(better_map_paths_src)` (count of features in
    the GeoJSON source) and `map.queryRenderedFeatures({ layers: [...] })`
    (count of features actually rendered in the current viewport).
  - `sampleCameraState(map)` — reads back `map.getZoom()`, `getCenter()`,
    `getBounds()` so we can prove or disprove "the camera isn't anywhere
    near the line geometry" as the cause of an empty-looking panel.
  Two new HUD lines:
  - `PATH src=N rendered=M | line(line):color=… w=… op=… dash=[…] || line_bg(line):… || arrow(symbol):text-color=…`
  - `CAMERA: z=N c=lng,lat bbox=[w,s..e,n]`
- These probes definitively distinguish the four failure modes of an
  empty data layer:
  - `src=-1` → source not mounted (dispatcher never ran)
  - `src=0` → source mounted but `setData()` was called with empty FC
    (analyze produced no features)
  - `src>0 rendered=0` → source has features but viewport doesn't
    intersect them OR layer paint is invisible (opacity 0, color same
    as basemap, line-width 0)
  - `src>0 rendered>0` but user sees nothing → z-order wrong (path
    layer underneath basemap) or canvas alpha-compositing trap
- Smaller fixes inside `debugHud.js`: `summarizeExpr()` helper that
  truncates MapLibre data-driven expressions to 40 chars so the HUD
  stays readable when paint properties resolve to large `coalesce` /
  `case` / `interpolate` expressions.

### Fixed (continuation of v1.3.21 cache-bust regimen)

- **`default/app.conf`** — bumped `[install] build = 1321` → `1322`,
  `[launcher] version = 1.3.21` → `1.3.22`. Per the v1.3.21 lesson:
  every JS or static-asset change MUST bump `build` or Splunk Web will
  serve the cached copy (Cache-Control: max-age=31536000).

### Methodology note: the four-state path-layer decision tree

When a Splunk DS custom viz dispatcher mounts a layer but the user sees
no paint, the new HUD lets you read the answer in one glance:

```
PATH src=N rendered=M | <layer probes>
        |       └── how many features painted in viewport
        └── how many features in source (after analyze + setData)
```

Then act:

| `src` | `rendered` | Diagnosis | Fix |
|---|---|---|---|
| `-1` | `-1` | dispatcher never ran | check `applyAnalysis` is called after `style.load`; check the four conditions from the SKILL D-section |
| `0` | `0` | source mounted, FC empty | check `analyze()` output (analysis line in HUD) |
| `>0` | `0` | features in source but not in viewport | check `CAMERA: bbox=...` — does it overlap your data? |
| `>0` | `0` (after camera fits) | viewport correct but paint invisible | check the `line(...):color=… op=…` probe — opacity 0? color same as bg? |
| `>0` | `>0` | painted but user sees nothing | z-order trap — path layer below basemap, or canvas-parent CSS clobbers compositing |

This decision tree is the AMD-viz analogue of the four MapLibre-shape
conditions documented in `splunk-ds-onprem-custom-viz` SKILL.md
(Symptom A through G). Symptom H plus this new in-HUD instrumentation
collapse a 30-minute "where does it die" investigation to a single
HUD glance.

## [1.3.21] - 2026-05-14

### Fixed (the AMD-viz cache-bust trap — `[install] build` not `[launcher] version` is what invalidates the static-asset URL)

- **`default/app.conf`** — bumped `[install] build = 1` → `[install] build = 1321`.
  This is what Splunk Web rewrites into the static-asset query string
  (`visualization.js?build=1321`). Bumping `[launcher] version` only is NOT
  enough: Splunk Web sets `Cache-Control: max-age=31536000` (one year) on
  every `/static/app/<app>/...` response, and a normal Cmd-R / F5 will keep
  serving the cached copy of `visualization.js?build=1` until the URL
  changes. The user's Debug HUD reporting `[better_map debug v1.3.18]`
  after a successful v1.3.20 deploy was the smoking gun — the in-memory
  dashboard XML was correctly v1.3.20 (matched local file byte-for-byte
  via REST diff), the app reported `version=1.3.20`, but the JS bundle
  the browser was actually running was the cached v1.3.18.
- For ALL future deploys: bump `[install] build = N` using the numeric
  portion of the version (e.g. v1.4.0 → `build = 1400`), so the build
  value is monotonic and self-documenting. Bump it BEFORE packaging.

### Added (Debug HUD diagnostics that survive cache-flush failures)

- **`appserver/static/visualizations/better_map/src/lib/debugHud.js`** —
  `recordInput(rowCount, fieldNames)`, `recordAnalysis(analysis)`, and
  `recordLayerOpts(opts)` methods. The HUD now surfaces three new lines
  at the top of its overlay:

  ```
  INPUT: rows=N fields=_time,pathId,lat,lon,...
  ANALYZE: points=X lines=Y polys=Z | detected lat=lat lon=lon pid=pathId time=_time | first line id=... verts=...
  LAYER OPTS: pointRenderer=markers paths.color=#fb8072 paths.animated=true paths.arrows=true
  ```

  When the HUD reports `INPUT: rows=0` → SPL didn't return data (browser
  / dashboard time-range issue). When `INPUT: rows>0` but `ANALYZE: lines=0`
  → `dataFitness.analyze()` isn't bucketing by pathId — field detection
  issue. When `lines>0` but no `better_map_paths_src` in the `sources:`
  line → dispatcher didn't mount the path layer. When `lines>0` AND
  `better_map_paths_src` IS in `sources:` AND lines still don't paint →
  layer is mounted but invisible (z-order / opacity / paint property
  issue).
- **`HUD_VERSION`** bumped `v1.3.18` → `v1.3.21` so the title line is the
  fast-path "is the JS bundle fresh?" diagnostic. If the title doesn't
  match the version you just deployed, the cache wasn't invalidated.

### Enabled (Debug HUD on the two showcase dashboards that still showed empty data layers in v1.3.20 user screenshots)

- **`better_map_fleet_tracking.xml`** — added `"showDebugHud": "true"`
  alongside the existing `"showTimeScrubber": "false"`.
- **`better_map_threat_map.xml`** — same.

  The HUD will be removed from these two dashboards in the next release
  once the data-layer-empty issue is resolved.

### Methodology note for any AMD-viz cache-bust workflow

> When your in-browser HUD reports a version string OLDER than the one
> you just deployed, the JS bundle is being served from cache, and
> EVERYTHING you observe about analyze()/layer mounts/paint state
> reflects OLD code, not your fix. The fast-path diagnostic is to
> read back `apps/local/<app>?output_mode=json` via REST and check the
> `build` value. If `build` didn't change between deploys, your cache
> bust didn't fire — fix `[install] build = N` and redeploy.

## [1.3.20] - 2026-05-14

### Fixed (Fleet Tracking and Threat Map example dashboards rendered empty
because of bad demo SPL — root cause was demo data + time-scrubber filter,
not the viz)

- **`better_map_fleet_tracking.xml`** — the demo SPL placed 80 of 200 GPS
  pings **in the future** relative to `now()` (`relative_time(now(), "-2h")
  + c * 60` for `c=1..200` runs from -2h to +1h20m), so the dashboard's
  `-2h@m to now` time-range filter dropped them. The remaining 120 pings
  were further filtered by `showTimeScrubber: true` + `trailWindowMs: 120000`
  (a 2-min trailing window at scrubber=now), leaving roughly one row visible
  at any moment — and zero LineStrings, since a path needs at least 2 points
  per `pathId` in the trail window. Truck offsets of ±0.4° (≈44 km) were
  also too small to show as distinct trails at world zoom.
  - SPL rewritten to `_time = now() - (200 - c) * 36` so all 200 events sit
    in the past and distribute evenly over the dashboard's 2-hour window.
  - Truck offsets widened to `±8°` lat / `±12°` lon so each truck's trail
    is visibly distinct at world zoom.
  - `showTimeScrubber` set to `false` and `trailWindowMs` removed so all
    four animated trails render simultaneously (the showcase intent).
- **`better_map_threat_map.xml`** — the demo SPL distributed 160 events
  across the last 30 minutes, but the latest event landed at `now() - 3min`,
  while `trailWindowMs: 60000` (60 sec) at the scrubber's default `now`
  position caught **zero** events. Result: empty map.
  - SPL rewritten to `_time = now() - (80 - c) * 22` (origins) and
    `_time = now() - (80 - c) * 22 + 11` (destinations) so the latest event
    is at `now()` and the oldest at `~29 min` ago — fits the dashboard's
    `-30m to now` time-range filter exactly.
  - `showTimeScrubber` set to `false` so all 80 NORSE-style attack lines
    (origin → DC, London, Tokyo) render simultaneously (the showcase intent).

### Methodology note for the dashboard demo SPL

When generating demo data via `| makeresults | streamstats c | eval _time
= ...`, **always express `_time` as `now() - (N - c) * step`** (a backward
offset from `now()`), not `relative_time(now(), "-Nh") + c * step` (a
forward offset from N hours ago). The forward form is one off-by-one away
from emitting future events that the dashboard time-range filter will silently
drop. The backward form is anchored at `now()` and inherently safe.

Equally important: **a time scrubber + a tight trail window is a hard
filter, not a visual hint.** Features outside the trail window are not just
faded — they're rendered with `circle-opacity: 0` and effectively invisible.
For showcase dashboards intended to display all events at once, set
`showTimeScrubber: false` (which makes `mapBuilder.applyTimeTrail(null)`
clear the trail and restore full opacity per `clearTrail` in
`src/lib/time/trail.js`). Re-enable the scrubber only when the dashboard
is wired to a real time-bearing data source where trail-based playback is
the desired analytical mode.

## [1.3.19] - 2026-05-14

### Fixed (the four flagship example dashboards finally show their intended
basemap)

- **Tile-provider hyphen-vs-underscore typo across four dashboards.** The
  provider IDs in `appserver/static/visualizations/better_map/src/lib/styles.js`
  use underscores (`openfreemap_positron`, `openfreemap_liberty`,
  `openfreemap_bright`). Four of the five flagship example dashboards
  shipped with hyphenated values (`openfreemap-positron`, `openfreemap-liberty`)
  in their `tileProvider` option. `resolveStyle()` doesn't recognise the
  hyphenated form, silently falls back to `DEFAULT_PROVIDER`
  (`openfreemap_liberty`), and the dashboard renders Liberty regardless of
  intent. Now fixed in all five examples plus the debug dashboard:
  - `better_map_threat_map.xml`: `openfreemap_liberty` (intent: warm cream
    backdrop for NORSE-style threat lines).
  - `better_map_iot_sensor_field.xml`: `openfreemap_positron` (intent: clean
    grey backdrop for hexbin + 3D extrusion + viridis ramp).
  - `better_map_fleet_tracking.xml`: `openfreemap_positron` (intent: clean
    grey backdrop for animated truck trails).
  - `better_map_site_availability.xml`: `openfreemap_positron` (intent: clean
    grey backdrop for status-coloured site markers).
  - `better_map_debug.xml`: `openfreemap_liberty` for the left HUD panel
    (was `openfreemap-liberty`).

### Changed

- All four flagship example dashboards now follow Splunk Dashboard Studio
  authoring conventions: every visualization carries a `title`, every
  dataSource carries a `name`, and every multi-pipe SPL string is reformatted
  with one pipe per line (per the SPL Pipe-Per-Line Rule in
  `splunk-conf-and-spl.mdc`). The behaviour is identical — the SPL is
  semantically the same — but `eai:data` diffs and the Dashboard Studio
  edit pane are now reviewable.
- `pathAnimated` and `pathArrows` formatter options are now strings
  (`"true"`) on the threat-map and fleet-tracking dashboards, matching the
  rest of the codebase and the formatter's stringly-typed inputs.

### Deployment notes

- App package: `better_map-1.3.19.tgz` (363 KB, no React scaffolding,
  no `node_modules`, no `src/`, no macOS resource forks).
- Splunk install: standard `apps/local update=true filename=true` lift.
- **CRITICAL deployment step (Splunk 10.2.x)**: `apps/local update=true`
  bumps the app version and replaces the static bundle, but does NOT
  refresh `default/data/ui/views/*.xml` in the running config. To make
  the new dashboard XML take effect immediately without a full splunkd
  restart, POST each updated XML body to
  `/servicesNS/nobody/better_map/data/ui/views/<view>?output_mode=json`
  with `--data-urlencode "eai:data=$(cat <view>.xml)"`. See `Symptom E-bis`
  in the `splunk-ds-onprem-custom-viz` SKILL for the full pattern.

## [1.3.18] - 2026-05-14

### Fixed (CRITICAL — all basemap providers now render in Dashboard Studio)

- **MapLibre Request-shape trap (Symptom G)**: register `bmstyle://`
  `bmsource://` `bmtile://` `bmsprite://` `bmglyphs://` custom protocols
  via `maplibregl.addProtocol()` and rewrite every outbound `https://`
  URL through them via `transformRequest`. The handlers use a controlled
  `fetch(url, {cache, credentials:'omit', signal})` shape — `cache:'no-store'`
  for metadata (Style / Source / SpriteJSON) so a poisoned 404 in the
  browser cache never sticks; `cache:'default'` for binary data
  (Tile / SpriteImage / Glyphs) so the browser tile cache works normally.
  Bypasses MapLibre's broken internal `Request` construction (Accept
  header + AbortController signal + `referrer` combo) that triggers a
  404 from `tiles.openfreemap.org` and `tile.openstreetmap.org` when
  served from inside a Splunk Dashboard Studio iframe context.
  `appserver/static/visualizations/better_map/src/lib/mapBuilder.js`.

### Added

- **In-viz debug HUD** (formatter option `showDebugHud=true`): displays
  MapLibre's internal state, live pixel sampling of the WebGL canvas,
  three-shape fetch probes (`safe` / `maplibre-lite` / `ml-req`),
  global `window.fetch` wrapper that logs every URL/status seen during
  the panel's lifetime, and `transformRequest` call counter. Diagnoses
  any "viz instantiates but nothing renders" failure from a single
  screenshot. `appserver/static/visualizations/better_map/src/lib/debugHud.js`.
- **`better_map_debug` dashboard** (`default/data/ui/views/better_map_debug.xml`):
  side-by-side `openfreemap-liberty` and `osm_raster` panels with
  `showDebugHud: true` so basemap rendering can be diagnosed visually
  without DevTools.

### Changed

- Bumped `maxParallelImageRequests` to `8` (MapLibre default is `16`)
  for friendlier behavior toward free tile services. Most production
  configurations will now run through the `addProtocol()` bypass which
  inherits the same parallelism cap.

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
