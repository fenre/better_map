# Better Map

A flagship Splunk custom map visualization for **Dashboard Studio** that
ships with ten core layer types, time scrubber + comet trail, 3D extrusion,
H3 hexbin aggregation, vector-tile feature join, cross-panel coordination,
indoor floor-plan overlay, eleven preset Studio dashboards, and an
AppInspect-clean package. Built on [MapLibre GL JS](https://maplibre.org/),
PMTiles, and Splunk's AMD-style custom-visualization framework.

> **v1.6.0 — additive feature pack.**
> Builds on v1.5.2's BM-CT-1 control-trio contract to ship **25 new
> opt-in fancy actions** across three surface areas:
>
> * **11 widgets** — geocoder, command palette (⌘K), minimap, draw
>   tools, measure, lasso, brushing, side-by-side compare, spatial
>   query (SPL token emit), time-window split view, markdown popup.
> * **7 layer modules** — WMS raster, KML import, multi-track trip
>   replay, geofence, wind / flow-field, scenegraph (3D-style icons),
>   MIL-STD-2525C / APP-6 symbology.
> * **8 Splunk-platform integrations** — MITRE ATT&CK enrichment, ES
>   notable drilldown, ITSI service-map mode, SOAR playbook trigger,
>   RBA risk heatmap, OT Purdue / IEC 62443 overlay, A&I geo-resolution,
>   AI Assistant chat panel.
>
> Plus a complete client-side **spatial-analytics suite** (DBSCAN,
> Getis-Ord Gi\*, LISA, Gaussian KDE, nearest-neighbour distribution,
> spatial join, CIM auto-detect), scrubber upgrades (0.5×–16×
> playback, reverse, event markers, anomaly bands, multi-panel sync),
> an air-gapped **PMTiles** loader, and five new showcase dashboards.
>
> Every v1.6 feature defaults to OFF (BM-CT-1 opt-in). The v1.5.2
> animation stack and v1.5.0 dark-cosmos visual treatment are
> unchanged underneath. OS `prefers-reduced-motion` still wins over
> the runtime pause toggle. Production-ready on Splunk Enterprise
> 10.2.x with Dashboard Studio (`version="2"`).
> See [`CHANGELOG.md`](CHANGELOG.md) for the full v1.6 catalogue.

---

## Requirements

| Component          | Version                                            |
| ------------------ | -------------------------------------------------- |
| Splunk Enterprise  | 10.2 or later                                      |
| Dashboard          | Dashboard Studio (`version="2"`); also Simple XML  |
| Browser            | Chrome 90+ / Edge 90+ / Firefox 88+ / Safari 14+   |
| WebGL              | Required (graceful fallback banner otherwise)      |

## Install

1. Download `dist/better_map-1.5.2.tar.gz` from the latest release, or build
   locally with `./build.sh`.
2. Splunk Web → **Manage Apps → Install app from file** → upload the
   tarball → confirm. Splunk 10.2.x quirk: a `restart_webui_polite` (or
   full `splunkd` restart) is required to flush Splunk Web's in-memory
   static-asset cache; otherwise you may see the previous bundle until
   the next process restart.
3. The **Better Map** entry appears in the app launcher with six working
   preset dashboards.

## Build from source

```bash
git clone <repo>
cd better_map
./build.sh
```

`build.sh` runs `npm ci`, `npm run lint`, `npm run build`, verifies the AMD
prefix AND the AMD callback's tail unwraps the default export, then writes
`dist/better_map-<version>.tar.gz`. The tarball excludes `node_modules/`,
`src/`, `webpack.config.js`, `harness.json`, `test-harness.html`, and
`package*.json`.

## Quick start

Drop a Better Map panel into any Dashboard Studio dashboard:

```spl
| makeresults count=4
| streamstats c
| eval lat=case(c=1,37.77, c=2,40.71, c=3,51.50, c=4,35.69)
| eval lon=case(c=1,-122.42, c=2,-74.0, c=3,-0.13, c=4,139.69)
| eval label=case(c=1,"SF", c=2,"NYC", c=3,"London", c=4,"Tokyo")
```

The viz auto-detects `lat`, `lon`, and `label` and renders coloured
markers at each city. No extra configuration required.

In the dashboard JSON, register the viz with the **two-segment** type
(this is the Splunk Dashboard Studio convention — the `viz.custom.`
prefix is for `savedsearches.conf` only and will silently fail if used
in a Dashboard Studio JSON `type` field):

```json
"viz_world_map": {
  "type": "better_map.better_map",
  "title": "World Map",
  "dataSources": { "primary": "ds_cities" }
}
```

---

## Visual upgrade (v1.5.0)

v1.5.0 transforms the default rendering surface from a 2D pastel-on-light
look to a near-black cosmic basemap with glowing paths, pulsing markers,
great-circle arcs, 3D-pitched cinematic camera, and a corner vignette.
All five capabilities ship enabled-by-default; every one can be opted out
of from the panel formatter or from Dashboard Studio panel options.

| Option | Default | Effect |
|--------|---------|--------|
| `tileProvider` | `carto_dark_matter` | Near-black cosmic basemap. Other choices: `carto_positron` (light), `carto_voyager`, `openfreemap_liberty` (the v1.4.x default), `openfreemap_positron`, `osm_raster_tiles`, `mapbox_*` (with token), `arcgis_*`. |
| `pathGlow` | `true` | Renders every path twice — a 4.5×-wide blurred under-stroke at 0.18 opacity, plus the sharp top stroke. Laser-beam emission instead of a flat single-pixel line. |
| `pathArc` (auto) | n/a | When the SPL provides `src_lat` / `src_lon` / `dst_lat` / `dst_lon`, `dataFitness.js` generates curved 64-segment LineStrings via spherical linear interpolation. Antimeridian-aware. No option to set; it auto-fires on origin-destination data shape. |
| `pointPulse` | `true` | Two concentric `circle` layers animated by `requestAnimationFrame`; outer + inner ring expand 1×→4× the base radius and fade 0.55→0 over 1.8 s, 60° out of phase. |
| `cameraPitch` | `30` | Initial map pitch in degrees (0 = flat top-down, 60 = max MapLibre pitch). Cinematic 3D perspective by default. |
| `cameraBearing` | `15` | Initial map bearing (compass heading) in degrees. Small offset from due-north makes overlays read as 3D. |
| `vignette` | `true` | Pure-CSS radial-gradient pseudo-element on the map container. Darkens the corners by ~32%, draws the eye to the centre. Suppressed under `prefers-reduced-motion`. |
| `palette` | `viridis` (numeric ramps) / `cyber` (showcase dashboards) | New palettes available: `cyber` (neon cyan/lime/amber/rose/violet — designed against dark-matter), `synthwave` (hot-pink + electric-cyan retro-futurist), `tactical` (amber-on-charcoal C2 / NORAD style). |

To restore the v1.4.x flat-light look, set `tileProvider=openfreemap_liberty pathGlow=false pointPulse=false cameraPitch=0 cameraBearing=0 vignette=false palette=set3`.

---

## Motion upgrade (v1.5.1)

v1.5.0 made the maps look good when paused. v1.5.1 makes them feel alive.
Five animation systems share one accessibility contract — the OS-level
`prefers-reduced-motion` preference disables all five — and one
scheduling primitive in `src/lib/motion.js`.

| Option | Default | Effect |
|--------|---------|--------|
| `pathComet` | `auto` | Auto-detected from feature data: on when any feature carries `isArc=true` (set by `dataFitness.js` when SPL produces `src_lat`/`src_lon`/`dst_lat`/`dst_lon`). A glowing point travels each great-circle arc at ~6 s/traversal, pulling its color from the per-feature paint. Force on/off with `true` / `false`. |
| `pathAnimated` | `false` | Phase-shifted marching dashes. Pre-computed 16-step pattern cycles through `line-dasharray` values to emulate `line-dasharray-offset` (which MapLibre does not support). Applied to BOTH the sharp top stroke and the wide glow under-layer so the entire glowing band marches in lockstep. |
| `pointPulse` | `true` | Severity-bound heartbeat. Markers are classified into four tiers by feature color — `critical` (red / rose / orange-red), `warning` (amber / orange), `ok` (lime / green), `neutral` (anything else). Critical-tier markers get a third faster ring at 0.85 s vs the baseline 1.8 s, so urgent markers physically pulse faster than nominal ones. |
| `extrusionPulse` | `false` | Breathing 3D extrusion. Modulates `fill-extrusion-height` ±12 % on a 4 s sine wave on `splunk.extrusion` and `splunk.hexbin` layers. When both layers are present they breathe in counterpoint (hexbins offset by π/2). |
| `cameraAutoOrbit` | `false` | Slow continuous rotation of map bearing via `MapBuilder.setAutoOrbit()`. Pauses for 5 s after any user `mousedown` / `touchstart` / `wheel` so the orbit never fights with manual pan/zoom/drag. |
| `autoOrbitSpeed` | `3` | Orbit speed in degrees/second when `cameraAutoOrbit=true`. Recommended range 1 – 3; values above ~5 induce motion sickness on big monitors. |

To kill all motion globally (faster than per-option toggles), enable
the OS setting **System Settings > Accessibility > Display > Reduce
motion** (macOS) or equivalent. Better Map's RAF loops will detect
the change live and freeze every animation at its current static
frame.

The showcase dashboards demonstrate the stack:

- **Threat Map** — comet emitters on arcs + auto-orbit at 2°/s.
- **Overview** — breathing hex extrusion + auto-orbit on both maps.
- **IoT Sensor Field** — breathing hex extrusion + slow 1.2°/s orbit.
- **Fleet Tracking** — marching dashes on truck routes.
- **Site Availability** — severity-bound heartbeats on the markers.

---

## Controls (v1.5.2 — BM-CT-1)

v1.5.0 made the maps look good. v1.5.1 made them feel alive. v1.5.2
ensures every animated or interactive feature in the viz follows one
enforceable contract: **enable / disable / reset**. The rule is
codified at [`.cursor/rules/bm-control-trio.mdc`](.cursor/rules/bm-control-trio.mdc).

### Three-layer state model

| Layer | Owner | Surface |
|---|---|---|
| **A — Dashboard-author defaults** | Dashboard creator | Formatter panel or Dashboard Studio JSON `options` |
| **B — Runtime user overrides** | Dashboard end-user | On-map control panel widget |
| **C — Reset operations** | Either | `↺` per-action button + master **Reset view** |

Reset is distinct from disable: reset returns the action to its Layer A
default. So if a dashboard ships `cameraAutoOrbit=true`, a user who
clicks the auto-orbit toggle off can click reset to turn it back on
(the dashboard's preference), without having to remember what it was.

### On-map control panel

The new floating widget (top-right corner) exposes every registered
fancy action plus the master commands. Click the `⚙ Controls` chip to
expand:

- **Per-action row** for each: `☄ Traveling comets`, `↻ Marching dashes`,
  `♥ Marker heartbeat`, `▣ Breathing extrusion`, `◯ Camera auto-orbit`.
  Each row has a toggle switch (Layer B override) and a `↺` reset
  button (Layer C restore-to-default).
- **Master footer**:
  - **Pause all motion** — global kill-switch for every RAF loop in
    the viz. Honoured by all five animation systems via the new
    `shouldSuppressMotion()` helper in `src/lib/motion.js`. The OS
    `prefers-reduced-motion` preference is honoured on top of this
    (whichever says "stop motion" wins).
  - **Reset view** — single command that resets the camera to its
    initial center / zoom / pitch / bearing, resets every fancy
    action to its Layer A default, resets layer-control visibility
    (all layers shown), and resets the time scrubber (paused, 1×
    speed, end-of-range).

The widget is keyboard-navigable, ARIA-labeled, and themes for
light / dark / high-contrast variants.

### Layer Control "Show all" button

The layer-control widget (top-left) gained a `Show all` footer button
that appears when 2+ layers are registered. One click restores all
layers to visible — the layer-control Control-Trio reset operation.

### Time Scrubber jump buttons

The time scrubber gained `⏮ Jump to start` and `⏭ Jump to end`
buttons flanking play / pause. Both pause playback on click so they're
predictable in collaborative settings.

### New formatter options

| Option | Default | Effect |
|---|---|---|
| `showControlPanel` | `true` | Show / hide the floating control-panel widget. Hide to lock the dashboard-author defaults (no runtime override). |
| `motionPaused` | `false` | Initial state of the master Pause-all-motion toggle. User can flip it at runtime via the control panel. OS `prefers-reduced-motion` is still honoured on top. |

Both options live in a new **Map controls (BM-CT-1)** section in the
formatter's **Data display** tab.

### Adding a new fancy action

If you author a new animated or interactive feature in the viz, the
rule (`.cursor/rules/bm-control-trio.mdc`) makes the contract
non-negotiable. Implementation checklist:

1. Expose `setX(map, enabled)` / `isXEnabled()` / `reset(map)` on the
   feature's module (matches the `paths.js` / `markers.js` /
   `extrusion.js` / `hexbin.js` pattern).
2. Capture the dashboard-author default into a module-global
   `_defaults` on first option-application.
3. Use `shouldSuppressMotion()` from `motion.js` (not
   `prefersReducedMotion()` directly) so the master pause is honoured.
4. Register the action with `MapBuilder.registerFancyAction(id, spec)`
   in `visualization_source.js#_registerFancyActions`.
5. Add the formatter option to `formatter.html` so dashboard authors
   can set the Layer A default.

The on-map control panel auto-renders any action that's been
registered — no panel code changes needed.

---

## Architecture (v1.4.0)

`better_map` is an **AMD-style Splunk custom visualization** registered
in `default/visualizations.conf` and loaded by Dashboard Studio's
RequireJS-flavoured runtime. There are four hard requirements that the
build pipeline (`build.sh` + `webpack.config.js`) enforces — all four
must hold simultaneously or Dashboard Studio will silently fall back to
the grey placeholder bar-chart icon.

### The four conditions for a working AMD viz on Splunk Enterprise 10.2.x DS

| # | Condition | Where it lives | Diagnostic if violated |
|---|-----------|----------------|------------------------|
| 1 | Bundle starts with `define([...], function(...)`. | webpack output prefix. Verified by `build.sh` step [3/4]. | `MyViz is not a constructor` in DS console (or silent grey placeholder). |
| 2 | Bundle ends with `o.default}()})` (or `t.exports = r` for hand-written AMD). webpack must unwrap the ESM default export. | `webpack.config.js` → `output.library.export = 'default'`. Verified by `build.sh` step [3/4] tail check. | Grey placeholder icon, NO console error. (SKILL Symptom E.) |
| 3 | `default/visualizations.conf` has ONLY `label / description / default_height / allow_user_selection / disabled / search_fragment` keys. NO `schemaVersion=3`, NO `core.*`, NO `data_contract.*` keys (those route to the v3 native-plugin loader, not the AMD loader). | `default/visualizations.conf`. | Grey placeholder icon, NO console error. (SKILL Symptom D.) |
| 4 | `formatter.html` has exactly three `<form class="splunk-formatter-section">` blocks with `section-label="Data configurations"` / `"Data display"` / `"Color and style"` (case-sensitive, exact pluralization — these merge into Dashboard Studio's standard groups). | `formatter.html`. | Duplicate "Better Map: Data Configuration" group appears in the panel-edit sidebar. |

### MapLibre integration traps that v1.4.0 fixes

`better_map` was an excellent stress-test for the MapLibre × Splunk
Dashboard Studio interaction. We accumulated four non-obvious failure
modes during development; the SKILL.md is the authoritative reference
for each.

| Trap | What it is | How `better_map` solves it |
|------|------------|----------------------------|
| **bm-protocol Request-shape bypass** (SKILL Symptom G) | MapLibre's outbound `Request` shape (with custom headers + signal + referrer) gets 404'd by some CDNs (OpenFreeMap was the live victim) even though `curl` of the same URL returns 200. The transport layer in DS must be bypassed. | `mapBuilder.js` registers `bmstyle://`, `bmsource://`, `bmtile://`, `bmsprite://`, `bmglyphs://` custom protocols via `maplibregl.addProtocol()` and `transformRequest` rewrites all outbound URLs to use them. Each protocol handler does its own `fetch()` with a clean Request shape and re-emits the bytes back to MapLibre. |
| **Demo-SPL future-time + tight trail-window trap** (SKILL Symptom H) | `eval _time = relative_time(now(), "-2h") + c * 60` produces events INTO THE FUTURE — silently dropped by the dashboard's `-2h to now` filter, and again by the trail-window filter. Path renderers need ≥2 points per `pathId` in the trail window to draw a line. | All shipped demo SPLs use the backward `_time = now() - (N - c) * step` form. The Fleet Tracking and Threat Map dashboards explicitly disable the time scrubber so all events render simultaneously. The four-state path-layer probe in the debug HUD diagnoses any regression. |
| **mountAndUpdate architectural escape hatch** (SKILL Symptom H follow-up) | MapLibre GeoJSON sources can get stuck "perpetually loading" inside DS — the worker thread tiles the data but `isSourceLoaded()` never flips to `true`. The standard `addSource() → setData()` lifecycle hits this; the workaround is to construct the source with the FeatureCollection already attached. | `src/lib/layers/paths.js` and `markers.js` expose `mountAndUpdate(map, fc, opts)` that creates the source via `map.addSource(id, { type: 'geojson', data: fc })` (one-shot). The dispatcher (`src/lib/layers/index.js`) prefers `mountAndUpdate` over the legacy `mount()/update()` path. |
| **`text-font` requirement on every symbol layer** (SKILL Symptom I) | When a custom symbol layer has `text-field` but NO `text-font`, MapLibre falls back to the default fontstack `["Open Sans Regular", "Arial Unicode MS Regular"]`. OpenFreeMap (and many other tile providers) does not host Open Sans. Every glyph request 404s, and the GeoJSON-source worker thread is wedged for ALL layers attached to that source — even line/circle/fill layers that don't need glyphs at all. | Every symbol layer in `paths.js`, `markers.js`, and `clusters.js` declares `'text-font': ['Noto Sans Regular']` explicitly (the only fontstack OpenFreeMap reliably hosts). |
| **Lazy-init off-screen-tab diagnostic trap** (SKILL Symptom J) | The viz defers MapLibre `Map` instantiation behind an `IntersectionObserver` to protect the browser's WebGL context budget. The HUD overlay paints regardless of visibility (Splunk DS calls `updateView` on hidden tabs to pre-warm dashboards). So a screenshot taken immediately after switching tabs shows the HUD with all-zero MapLibre counters — identical to a catastrophically broken state. | The HUD will gain an explicit `map: instance=Map(seq=N)` vs `map: NOT-CREATED-YET (waitForVisible pending)` line in a future revision. **Operator workaround today**: wait 10 seconds with the panel in viewport before drawing any conclusion from all-zero MapLibre event counters. |

### Dashboard build cache-busting

Splunk Web aggressively caches static assets (`Cache-Control: max-age=31536000` =
one year). For AMD vizs, the bundle filename is fixed by `visualizations.conf`
and cannot be versioned. The fix is to bump `[install] build = N` in
`default/app.conf` in lockstep with every release — Splunk Web rewrites
the asset URL to `?build=N` and forces browsers to fetch fresh.

`build.sh` reads `[launcher] version` and produces `dist/better_map-<version>.tar.gz`.
**Manually update `[install] build = N` in `default/app.conf` to match the version's
numeric portion (e.g., `1.4.0` → `build = 1400`)** before running `build.sh`.

---

## Layer types

Each layer auto-activates when the data fits it; the formatter exposes
fine-grained overrides.

| Layer        | Triggered by                            | Best for                              |
| ------------ | --------------------------------------- | ------------------------------------- |
| Markers      | Default for point data                  | Sites, hosts, events                  |
| Clusters     | >50 points per panel                    | Dense point clouds                    |
| Heatmap      | "Point renderer = heatmap"              | Density visualisation                 |
| H3 hexbin    | "Point renderer = hexbin"               | Aggregating millions of points        |
| Paths        | Lines from row order or LineString WKT  | Routes, flows, threat lines           |
| Polygons     | GeoJSON polygons or WKT                 | Geofences, regions                    |
| Choropleth   | Polygons with a numeric `value` field   | Per-region statistics                 |
| 3D extrusion | Polygons with `height` or `value`       | Skyline diagrams, telemetry stacks    |
| Feature join | Numeric `value` + ISO/admin id          | Country / state / postcode dashboards |
| Indoor       | Image URL + 4 corner coords             | Floorplans with sensor overlays       |

### Markers

```spl
| makeresults count=10
| streamstats c
| eval lat=37.7 + (c-5)/30
| eval lon=-122.4 + (c-5)/40
| eval label="Host-"+c
| eval color=case(c%3=0,"#ff595e", c%3=1,"#1982c4", c%3=2,"#8ac926")
```

Recognised aliases: `lat`/`latitude`/`y`, `lon`/`lng`/`longitude`/`x`,
`label`/`name`/`title`, `color`/`colour`, `size`/`radius`,
`popup`/`tooltip`/`description`.

### Clusters

Clustering activates automatically when there are more than 50 markers in
a panel. Click a cluster to zoom in; the leaf points spiderfy at the max
zoom.

### Heatmap

```spl
... | eval lat=... | eval lon=... | head 50000
```

In the formatter, set "Point renderer = Heatmap". The Viridis ramp is
applied by default; pick RdYlBu / Set3 in the colour tab.

### H3 hexbin

```spl
... | eval lat=... | eval lon=...
| bin _time span=1h
| stats count by _time lat lon
```

Set "Point renderer = Hexbin". The auto-degrade setting picks an
appropriate H3 resolution per zoom level; toggle "Enable 3D extrusion" to
turn hexbins into 3D bars.

### Paths

For one LineString per row using WKT:
```spl
| makeresults
| eval geometry="LINESTRING(-74.0 40.7, 2.35 48.85, 139.69 35.69)"
| eval label="JFK -> CDG -> NRT"
```

For one LineString built from many rows in order, ensure the rows share a
common `path_id` (or `route_id`) field:
```spl
... | eval path_id="truck-42" | eval _time=... | sort 0 path_id _time
```

Enable "Animated paths" and "Show arrowheads" for ant-path style flows.

### Polygons and choropleth

```spl
| makeresults
| eval geometry="POLYGON((-1 51, 0 51, 0 52, -1 52, -1 51))"
| eval value=68
| eval label="Greater London"
```

To enable choropleth fill, in the formatter set "Enable choropleth" and
pick a palette. The fill colour is interpolated from the per-feature
`value` property.

### 3D extrusion

```spl
... | eval geometry="..." | eval height=42
```

Set "Enable 3D extrusion" and optionally adjust "Extrusion scale". The
camera auto-pitches so the extrusion is visible.

### Feature join

Bring in a vector tile of countries / US states / admin-1 regions and let
Better Map colour each cell by your SPL value:

```spl
| inputlookup country_counts.csv
| rename country_iso AS id, hits AS value
```

In the formatter, pick "Preset tileset = world-countries" (or supply your
own `pmtiles://` / `https://` tile URL). Drop the matching PMTiles file
into `appserver/static/visualizations/better_map/presets/` before deploy.

### Indoor overlay

```spl
| makeresults
| eval lat=37.7950 | eval lon=-122.3937 | eval label="Sensor 12"
```

In the formatter set:
- **Indoor image URL**: `https://...png` of the floorplan
- **Indoor image coordinates**: `lng,lat;lng,lat;lng,lat;lng,lat` for the
  four corners (top-left, top-right, bottom-right, bottom-left)
- **Indoor opacity**: `0.95`

If your data has a `floor` (or `level`) field with multiple distinct
values, a floor switcher appears bottom-right. Configure per-floor images
via the matching formatter options.

---

## Time scrubber + comet trail

Add a `time` field to your data (any field that's a Unix epoch or a
parseable date string). The scrubber appears at the bottom of the panel.

```spl
| makeresults count=200
| streamstats c
| eval _time = now() - (200 - c) * 30
| eval lat = 37.7 + sin(c/15)/10
| eval lon = -122.4 + cos(c/15)/10
| eval time = _time
```

> **Why `now() - (N - c) * step` and not `relative_time(now(), "-Nh") + c * step`?**
> The forward form is one off-by-one away from emitting events INTO THE
> FUTURE — and Dashboard Studio's `-Nh to now` time-range filter silently
> drops them, leading to confusing "data layer empty" symptoms. The
> backward form is anchored at `now()` and inherently safe. See SKILL
> Symptom H.

Use the play / pause / speed buttons. Features fade in/out using a comet
trail effect based on the configured "Trail window" (default 5 minutes).

---

## Drilldown and cross-panel coordination

### Drilldown

Click a feature to publish all of its properties as Dashboard Studio
field tokens (`row.fields.<name>`, `row.values.<name>`). Use them like
any other token in subsequent panels.

### Popups

Add a `popup` (or `tooltip` / `description`) field. The HTML is sanitised
through DOMPurify with a strict allow-list (no `<script>`, no inline
events). Safe rich content like links, images, and tables is preserved.

```spl
... | eval popup="<b>"+host+"</b><br/>"+status+" (<a href='/host/"+host+"'>open</a>)"
```

### Cross-panel coordination

Better Map publishes the live camera state and selected feature as
dashboard tokens that other panels (including other Better Map instances)
can subscribe to:

| Token                          | Type    | Description                       |
| ------------------------------ | ------- | --------------------------------- |
| `better_map.camera.lng`        | number  | Center longitude                  |
| `better_map.camera.lat`        | number  | Center latitude                   |
| `better_map.camera.zoom`       | number  | Zoom level (0-22)                 |
| `better_map.camera.pitch`      | number  | Pitch in degrees                  |
| `better_map.camera.bearing`    | number  | Bearing in degrees                |
| `better_map.selected.id`       | any     | `id` of the last-clicked feature  |
| `better_map.selected.layer`    | string  | `layerName` of the same feature   |

Master/detail pattern: feed `better_map.camera.*` into the second panel's
saved search to filter rows to the visible bbox; or apply them to a
sibling Better Map panel's `defaultCenter` / `defaultZoom` formatter
options to slave the cameras together.

---

## Tile providers

| Provider id              | API key | Notes                                                      |
| ------------------------ | ------- | ---------------------------------------------------------- |
| `openfreemap_liberty`    | no      | Default. OSM-based, Google/Apple-Maps quality.             |
| `openfreemap_positron`   | no      | Minimal light basemap, ideal for choropleth overlays.      |
| `openfreemap_bright`     | no      | High-contrast labels, good for ops dashboards.             |
| `osm_raster`             | no      | OSM raster fallback (use sparingly per OSM tile policy).   |
| `maptiler`               | yes     | Streets v2 vector, light/dark auto-switch.                 |
| `stadia`                 | yes     | Alidade smooth, light/dark auto-switch.                    |
| `pmtiles`                | no      | User-supplied PMTiles bundle (`pmtiles://`).               |
| `custom`                 | no      | Any user-supplied `https://...style.json`.                 |

All providers auto-switch between light / dark variants when
`SplunkVisualizationUtils.getCurrentTheme()` flips. Attribution is locked
on for OpenFreeMap and OSM raster.

All `https://` providers are routed through the bm-protocol bypass
(`bmstyle://` / `bmsource://` / `bmtile://` / `bmsprite://` / `bmglyphs://`)
to work around the Dashboard Studio Request-shape 404 trap. See
SKILL Symptom G for details.

## SPL helper macros

The app ships four reusable macros in `default/macros.conf`. They are
documented inline; brief overview:

| Macro                          | What it does                                                  |
| ------------------------------ | ------------------------------------------------------------- |
| `better_map_points`            | Normalises `latitude`/`longitude` -> `lat`/`lon`, drops bad rows |
| `better_map_iplocation(field)` | Wraps `iplocation` and renames the output for Better Map      |
| `better_map_h3(field)`         | Stub for client-side H3 cell id (Better Map computes server-side) |
| `better_map_geocode`           | Extracts numeric `lat`/`lon` from a single free-text field    |

Example:
```spl
index=audit
| eval src=src_ip
| `better_map_iplocation(src)`
| `better_map_points`
| stats count by lat lon
```

## Preset Dashboard Studio dashboards

| File                                       | Showcases                                       |
| ------------------------------------------ | ----------------------------------------------- |
| `better_map_overview.xml`                  | Marker layer + theme + tile-provider switching  |
| `better_map_fleet_tracking.xml`            | Animated paths + arrow heads for 4 truck trails |
| `better_map_threat_map.xml`                | Origin-destination threat lines (NORSE style)   |
| `better_map_iot_sensor_field.xml`          | H3 hexbin + 3D extrusion + colour ramp          |
| `better_map_site_availability.xml`         | Layer control filtering categories from CSV     |
| `better_map_debug.xml`                     | Debug HUD reference panel for any data shape    |
| `better_map_osm_test.xml`                  | OSM raster fallback validation                  |

## Performance and reliability

- **Lazy init**: maps only instantiate after their panel enters the
  viewport (IntersectionObserver). The WebGL context budget defaults to
  12; further panels show a warning rather than failing. **Diagnostic
  warning**: if you screenshot a panel immediately after switching tabs
  and the HUD shows all-zero MapLibre counters, that's the
  pre-instantiation transient state — wait 10 seconds and re-check
  before assuming a failure. See SKILL Symptom J.
- **Per-source HUD probes**: the debug HUD includes `samplePathLayerState`,
  `sampleCameraState`, `sampleSourceEventCounts`, and `scanRandomPixels`
  probes. Toggle "Show debug HUD" in the formatter (or set
  `showDebugHud: true` in the dashboard JSON `options`) to surface them.
- **Tiered errors**: WebGL missing renders a fatal banner; parse errors
  render a dismissible warning while keeping the previous good data;
  empty results render an info banner.
- **View stability**: auto-fit only on the first non-empty load.
  Subsequent updates preserve manual pan/zoom. "Reset view" and "Lock
  view" buttons in the top-right.

## Security

- Popup HTML is sanitised with DOMPurify (allow-list of safe tags and
  attributes; `<script>`, inline events, and `srcset` are stripped).
- Tile / style / PMTiles URLs must be `https://` or `pmtiles://`. Mixed
  content is rejected before reaching MapLibre.
- Indoor floorplan images must be `https://` or a `data:` URI.
- Cross-panel tokens are scoped under `better_map.` and never echo user
  input back into the DOM.

## Accessibility

- Color-blind-safe palettes (Viridis / RdYlBu / Set3) as the only built-in
  options.
- Visible focus rings on every interactive widget; map canvas is
  keyboard-navigable.
- ARIA live region announces layer toggles, view reset, and PNG export
  completion.
- "High contrast mode" replaces translucent surfaces with WCAG AAA solid
  black/white.
- Honours OS `prefers-color-scheme` and `prefers-reduced-motion`.
- Map label language switcher: en / es / fr / de / it / pt / ru / zh /
  ja / ko / ar / hi or the basemap default.

## Export and share

- **PNG**: top-right "PNG" button downloads `better-map.png` of the
  current canvas (preserveDrawingBuffer enabled by default).
- **Share URL**: top-right "Share" button copies a deep-link including
  current center, zoom, pitch, and bearing to the clipboard.

## Troubleshooting

The full diagnostic decision tree lives in
[`splunk-ds-onprem-custom-viz` SKILL.md](https://github.com/) — a
living document with ten symptom classes (A–J) and field-validated
fixes. Quick reference:

| Symptom                                                          | Likely cause / fix                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Empty map but no banner                                          | Search returned 0 rows. Inspect the SPL.                        |
| `Better Map: too many maps on this page (...) WebGL slots free.` | Lazy-init budget exhausted. Reduce panels or refresh.           |
| Warning: lat/lon out of range                                    | Likely lat/lon swapped. Better Map auto-detects, but check.     |
| Tiles fail to load                                               | Splunk over HTTPS but tile URL is HTTP. Switch to OpenFreeMap.  |
| Popup HTML missing styles                                        | The allow-list does not include `<style>`. Use inline classes.  |
| MapTiler / Stadia tiles silent fail                              | API key missing. Set "Tile provider API key" in the formatter.  |
| Worker CSP error in console                                      | Switch to `maplibre-gl-csp` (see comment in `mapBuilder.js`).   |
| Grey placeholder bar-chart icon (no console error)               | One of the four AMD conditions violated. Run `tail -c 60` on the served `visualization.js` and confirm it ends with `o.default}()})`. (SKILL Symptom E.) |
| Basemap loads but shows 404 errors in console for tile URLs      | DS Request-shape trap. v1.4.0 already routes through bm-protocol; if you see this, the protocol registration didn't take effect. (SKILL Symptom G.) |
| Data layer empty but `analyze()` produces N>0 features in HUD    | Either `_time` is in the future + filter dropping rows (SKILL H.1), trail-window filter is too tight (SKILL H.2), source worker is wedged by font 404s (SKILL I), or lazy-init hasn't fired (SKILL J). HUD's `SOURCE EVTS:` line and `MapLibre errors:` line tell you which one. |
| All-zero MapLibre counters in HUD on first view of a tab         | Pre-instantiation transient state. Wait 10 seconds with the panel in viewport, then re-check. (SKILL Symptom J.) |
| New bundle deployed, browser still running old version           | `[install] build = N` in `app.conf` wasn't bumped. Splunk Web's static-asset URL only changes when the build number changes. Bump it monotonically. (SKILL D-quater.) |

## Repository layout

```
better_map/                           Repo root
  build.sh                            Build + package entry point (4 stages)
  CHANGELOG.md                        Per-version log
  LICENSE, NOTICE.md
  README.md                           This file
  test-harness.html                   Local dev harness (load in browser)
  scripts/
    gen_placeholder_icons.py          Asset helper
  dist/                               Output dir for build.sh tarballs
  _ref/                               Reference clones (rcastley + Splunk-map-viz)
                                      — read-only, NOT shipped in the tarball
  better_map/                         Splunk app source — the entire app dir
    appserver/static/
      appIcon.png, appLogo.png        Launcher icons
      network_diagnostic.html         Standalone CDN-reachability tester
      visualizations/better_map/      The custom viz (where MapLibre lives)
        src/                          ES modules; webpack bundles to visualization.js
          lib/
            mapBuilder.js             MapLibre lifecycle + bm-protocol registration
            debugHud.js               On-screen diagnostic overlay (HUD_VERSION lives here)
            lazyInit.js               IntersectionObserver-based instantiation gate
            dataFitness.js            SPL row analysis + GeoJSON construction
            time/trail.js             Time scrubber + comet trail
            layers/
              index.js                Layer dispatcher
              paths.js                Animated lines + arrow heads
              markers.js              Point markers + labels
              clusters.js             Marker clustering
              ...
            providers/styles.js       Basemap style URL resolution
          visualization_source.js     AMD entry point
        formatter.html                Studio configuration form (3 tabs)
        visualization.css             Widget styles (scoped to .better_map-viz)
        visualization.js              Built AMD bundle (committed for offline installs)
        webpack.config.js             output.library.export = 'default' (REQUIRED)
        package.json, package-lock.json, src/, harness.json — all dev-only,
          excluded from the tarball by build.sh
    default/                          App configs
      app.conf                        version, build (bump in lockstep!)
      visualizations.conf             AMD viz registration (NO v3-spec keys)
      macros.conf                     SPL helper macros
      data/ui/views/                  Seven preset Dashboard Studio dashboards
      data/ui/nav/default.xml         Navigation
    lookups/                          Sample CSV used by Site Availability
    metadata/default.meta             Permissions
    README/                           .conf.spec docs
```

## Development

```bash
cd better_map/appserver/static/visualizations/better_map
nvm use            # honours .nvmrc (Node 20 LTS)
npm ci
npm run dev        # watches and rebuilds visualization.js
```

Open `test-harness.html` in a browser to iterate without Splunk in the
loop. The harness reads `harness.json` for sample data and config.

### Deploy iteration loop (the fast path)

1. `./build.sh` — produces `dist/better_map-<version>.tar.gz`
2. **Bump `[install] build = N` in `default/app.conf`** to force browser
   cache invalidation. Use the numeric portion of the version (e.g.,
   `1.4.0` → `build = 1400`). If you skip this step, the browser will
   keep running the previous bundle and your "deploy" will be invisible.
3. Install via REST (the `splunk-remote-app-deploy` skill captures the
   splunkd `:8089` multipart-upload gotcha — use the URL-fetch pattern
   below with a bearer token, not basic-auth + `-F`):
   ```bash
   # Serve the tarball locally
   ( cd dist && python3 -m http.server 9123 ) &
   # Tell splunkd to fetch + install it
   curl -ksS -H "Authorization: Bearer $SPLUNK_REST_TOKEN" \
        -d "name=http://<your-ip>:9123/better_map-1.5.2.tar.gz" \
        -d "filename=true" \
        -d "update=true" \
        https://<splunk-host>:8089/services/apps/local
   ```
4. Restart Splunk Web (mandatory on Splunk 10.2.x — the static-asset
   handler caches in memory until process restart):
   ```bash
   curl -k -u admin:changeme -X POST \
        https://localhost:8089/services/server/control/restart_webui_polite
   ```
5. Wait 15-30s, then hard-refresh the browser (Cmd-Shift-R / Ctrl-F5).
6. Open the dashboard's debug HUD; verify the version string in the
   HUD's first line matches the version you just deployed. If it doesn't,
   the browser is still on the cached bundle — repeat step 2 (the build
   number must be MONOTONICALLY INCREASING for the URL to change).

### CSP smoke test on Splunk 10.2

1. `./build.sh && splunk install app dist/better_map-1.5.2.tar.gz`
2. Drop a Better Map panel onto a new Studio dashboard.
3. Open the browser console. Confirm no:
   - "Refused to create a worker from 'blob:...'" (`worker-src`)
   - "Refused to evaluate a string as JavaScript" (`unsafe-eval`)
   - "Refused to load stylesheet"
4. If any fire, swap the import in `mapBuilder.js` from
   `maplibre-gl` to `maplibre-gl/dist/maplibre-gl-csp.js`.

## License

MIT. See [`LICENSE`](LICENSE). Third-party bundled libraries are listed in
[`NOTICE.md`](NOTICE.md). Default basemap data is © OpenStreetMap
contributors (ODbL) and OpenFreeMap (styles CC0; attribution control is
locked on whenever these providers are in use).
