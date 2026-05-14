# Better Map

A flagship Splunk custom map visualization for **Dashboard Studio** that
ships with ten layer types, time scrubber + comet trail, 3D extrusion, H3
hexbin aggregation, vector-tile feature join, cross-panel coordination,
indoor floor-plan overlay, four preset Studio dashboards, and an
AppInspect-clean package. Built on [MapLibre GL JS](https://maplibre.org/),
PMTiles, and Splunk's custom-visualization framework.

> v1.0.0 release candidate. Production-ready, AppInspect precert pending.

---

## Requirements

| Component          | Version                                      |
| ------------------ | -------------------------------------------- |
| Splunk Enterprise  | 10.2 or later                                |
| Dashboard          | Dashboard Studio only (no Simple XML)        |
| Browser            | Chrome 90+ / Edge 90+ / Firefox 88+ / Safari 14+ |
| WebGL              | Required (graceful fallback banner otherwise) |

## Install

1. Download `dist/better_map-1.0.0.tar.gz` from the latest release, or build
   locally with `./build.sh`.
2. Splunk Web -> **Manage Apps -> Install app from file** -> upload the
   tarball -> confirm. No restart required on Splunk Enterprise 10.2+.
3. The **Better Map** entry appears in the app launcher with four working
   preset dashboards.

## Build from source

```bash
git clone <repo>
cd splunk-map
./build.sh
```

`build.sh` runs `npm ci`, `npm run lint`, `npm run build`, verifies the AMD
wrapper is ES5, copies the bundle into `better_map/appserver/static/...`,
and writes `dist/better_map-<version>.tar.gz`. The tarball excludes
`node_modules/`, `src/`, `webpack.config.js`, and `package*.json`.

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
| eval _time=now()-c*30
| eval lat=37.7 + sin(c/15)/10
| eval lon=-122.4 + cos(c/15)/10
| eval time=_time
```

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
saved search to filter rows to the visible bbox; or apply them with
`map.jumpTo` via the exported `applyRemoteCamera()` helper in your own
React shell.

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
| `better_map_fleet_tracking.xml`            | Animated paths + time scrubber + comet trail    |
| `better_map_threat_map.xml`                | Origin-destination threat lines (NORSE style)   |
| `better_map_iot_sensor_field.xml`          | H3 hexbin + 3D extrusion + colour ramp          |
| `better_map_site_availability.xml`         | Layer control filtering categories from CSV     |

## Performance and reliability

- **Lazy init**: maps only instantiate after their panel enters the
  viewport (IntersectionObserver). The WebGL context budget defaults to
  12; further panels show a warning rather than failing.
- **Perf HUD**: optional top-left overlay with FPS, frame time, layer
  count, and free WebGL slots.
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

| Symptom                                                          | Likely cause / fix                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Empty map but no banner                                          | Search returned 0 rows. Inspect the SPL.                        |
| `Better Map: too many maps on this page (...) WebGL slots free.` | Lazy-init budget exhausted. Reduce panels or refresh.           |
| Warning: lat/lon out of range                                    | Likely lat/lon swapped. Better Map auto-detects, but check.     |
| Tiles fail to load                                               | Splunk over HTTPS but tile URL is HTTP. Switch to OpenFreeMap.  |
| Popup HTML missing styles                                        | The allow-list does not include `<style>`. Use inline classes.  |
| MapTiler / Stadia tiles silent fail                              | API key missing. Set "Tile provider API key" in the formatter.  |
| Worker CSP error in console                                      | Switch to `maplibre-gl-csp` (see comment in `mapBuilder.js`).   |

## Repository layout

```
splunk-map/
  better_map/                          Splunk app source -> packaged into .tar.gz
    appserver/static/visualizations/
      better_map/                      The custom viz (this is where MapLibre lives)
        src/                           ES modules; webpack bundles to visualization.js
        formatter.html                 Studio configuration form (3 tabs)
        visualization.css              Widget styles (scoped to .better_map-viz)
        visualization.js               Built AMD bundle (committed for offline installs)
    default/                           App configs (visualizations.conf, macros.conf, ...)
    default/data/ui/views/             Four preset Dashboard Studio dashboards
    lookups/                           Sample CSV used by Site Availability
    README/                            .conf.spec docs
  build.sh                             Build + package entry point
  test-harness.html                    Local-dev harness
  CHANGELOG.md, LICENSE, NOTICE.md
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

### CSP smoke test on Splunk 10.2

1. `./build.sh && splunk install app dist/better_map-1.0.0.tar.gz`
2. Drop a Better Map panel onto a new Studio dashboard.
3. Open the browser console. Confirm no:
   - "Refused to create a worker from 'blob:...'" (`worker-src`)
   - "Refused to evaluate a string as JavaScript" (`unsafe-eval`)
   - "Refused to load stylesheet"
4. If any fire, swap the import in `mapBuilder.js` from
   `maplibre-gl` to `maplibre-gl/dist/maplibre-gl-csp.js`.

## License

MIT. See [`LICENSE`](LICENSE). Third-party bundled libraries are listed in
[`NOTICE.md`](NOTICE.md). Default basemap data is (c) OpenStreetMap
contributors (ODbL) and OpenFreeMap (styles CC0; attribution control is
locked on whenever these providers are in use).
