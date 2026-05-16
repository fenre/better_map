# ESRI Web Map — Splunk Custom Visualization

Interactive map visualization that renders ESRI ArcGIS web service layers with SPL search result overlay. Built with [Leaflet](https://leafletjs.com/) and [esri-leaflet](https://esri.github.io/esri-leaflet/) for reliable rendering on both Splunk Enterprise and Splunk Cloud.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Prerequisites — Content Security Policy](#prerequisites--content-security-policy)
- [Quick Start](#quick-start)
- [SPL Search Columns](#spl-search-columns)
- [Icon Library (Esri Calcite)](#icon-library-esri-calcite)
- [ESRI Service URL Reference](#esri-service-url-reference)
- [Configuration Reference](#configuration-reference)
- [Search Examples](#search-examples)
- [Dashboard Studio Usage](#dashboard-studio-usage)
- [Per-Feature Styling via SPL](#per-feature-styling-via-spl)
- [Heatmap Mode](#heatmap-mode)
- [Legend](#legend)
- [Marker Clustering](#marker-clustering)
- [Drilldown](#drilldown)
- [Geocoder Search](#geocoder-search)
- [Draw Tools](#draw-tools)
- [Measure Tool](#measure-tool)
- [Minimap](#minimap)
- [Timeline Slider](#timeline-slider)
- [Side-by-Side Comparison](#side-by-side-comparison)
- [Service Layer Enhancements](#service-layer-enhancements)
- [Basemap Options](#basemap-options)
- [Troubleshooting](#troubleshooting)
- [Build from Source](#build-from-source)
- [Architecture](#architecture)

---

## Features

**Map Rendering**
- Load ESRI ArcGIS MapServer, FeatureServer, TileServer, and ImageServer layers
- 7 built-in basemap options (ESRI and OpenStreetMap) plus custom tile URL support
- Adjustable service layer opacity
- WHERE clause filtering for Feature service layers
- Service-defined symbology via esri-leaflet-renderers
- Service layer feature clustering via esri-leaflet-cluster
- **Click-to-Identify** — click on Dynamic, Tiled, or Image service layers to query and display feature attributes
- **Feature Layer popups** — automatic attribute popups on FeatureServer layers

**Data Visualization**
- Overlay SPL search results as interactive point markers
- Render GeoJSON geometries (points, lines, polygons) from SPL fields
- Per-feature styling via SPL fields (`_color`, `_radius`, `_weight`)
- 35+ built-in Esri Calcite point symbol icons (`_icon` field)
- Custom icon URLs (`_iconUrl` field)
- Persistent text labels on markers (`_label` field)
- SPL-driven legend from `_legend` field
- **Heatmap mode** — toggle between markers and density heatmap, or show both
- Heatmap intensity weighting via `_intensity` field

**Interactivity**
- Configurable tooltip mode: click popup, hover tooltip, or both
- Splunk drilldown support on feature click
- Marker clustering for dense point datasets
- **Geocoder search** — address/place search powered by Esri ArcGIS geocoding
- **Draw tools** — polygon, rectangle, line, circle, and marker drawing with GeoJSON export
- **Spatial queries** — draw a shape to query intersecting features from the ESRI Feature service
- **Measure tool** — click-to-measure distances between points (km/m)
- **Timeline slider** — temporal filtering with play/pause animation for time-series data

**Map Controls**
- Zoom in/out buttons
- Scale bar (metric and imperial)
- Fullscreen toggle
- Cursor coordinate display (lat/lon)
- Feature count badge
- **Minimap** — overview context map in corner
- **Side-by-side comparison** — draggable slider between two basemaps

---

## Installation

1. Download or build the `.tar.gz` package
2. Install via Splunk Web: **Settings > Install app from file**
3. Or CLI: `$SPLUNK_HOME/bin/splunk install app esri_map_viz-3.0.0.tar.gz`
4. Restart Splunk

---

## Prerequisites — Content Security Policy

Splunk's CSP blocks external tile images by default. Add the following to `$SPLUNK_HOME/etc/system/local/web.conf`:

```ini
[settings]
csp.img-src_override = *.arcgisonline.com *.arcgis.com *.openstreetmap.org
csp.connect-src_override = *.arcgisonline.com *.arcgis.com geocode.arcgis.com
```

Restart Splunk after editing. The `connect-src` entry is needed for the geocoder and dynamic map layers.

---

## Quick Start

1. Create a search that produces `latitude` and `longitude` columns
2. Select **ESRI Web Map** as the visualization type
3. Optionally configure an ESRI Service URL for background layers

---

## SPL Search Columns

| Column | Required | Description |
|--------|----------|-------------|
| `latitude` | Yes* | Latitude (-90 to 90) |
| `longitude` | Yes* | Longitude (-180 to 180) |
| `description` | No | Popup/tooltip content |
| `geojson` | No | GeoJSON geometry string |
| `_color` | No | Per-feature color (hex, e.g. `#EF4444`) |
| `_radius` | No | Circle marker radius in pixels |
| `_weight` | No | Line/polygon stroke width |
| `_icon` | No | Calcite icon name (e.g. `pin-tear`, `car`) |
| `_iconUrl` | No | Custom icon image URL |
| `_label` | No | Persistent text label above marker |
| `_legend` | No | Legend group label |
| `_intensity` | No | Heatmap point weight (default 1) |
| `_time` | No | Epoch timestamp for timeline filtering |

*Either `latitude`/`longitude` or `geojson` is required for features to render.

---

## Icon Library (Esri Calcite)

35+ built-in icons from Esri Calcite Point Symbols. Set a default via the formatter or per-row with `_icon`:

`airplane`, `car`, `bus`, `train`, `ship`, `ambulance`, `pin-tear`, `flag`, `star`, `circle`, `square`, `diamond`, `triangle`, `person`, `people`, `building`, `house`, `school`, `hospital`, `fire-station`, `place-of-worship`, `food`, `shopping`, `bank`, `gas-station`, `parking`, `bridge`, `power-plant`, `dam`, `windmill`, `wifi`, `anchor`, `bell`, `information`, `biohazard`, `mining`

---

## ESRI Service URL Reference

| Service Type | URL Pattern | Setting |
|---|---|---|
| **Tile (cached)** | `.../MapServer` or `.../MapServer/tile/{z}/{y}/{x}` | `tile` |
| **Feature (vectors)** | `.../FeatureServer` or `.../FeatureServer/0` | `feature` |
| **Dynamic (image)** | `.../MapServer` (with multiple layers) | `dynamic` |
| **Image (raster)** | `.../ImageServer` | `image` |

---

## Configuration Reference

### Data Configurations

| Setting | Default | Description |
|---------|---------|-------------|
| ESRI Service URL | (empty) | URL to ESRI MapServer/FeatureServer/TileServer/ImageServer |
| Service Type | `feature` | `tile`, `feature`, `dynamic`, or `image` |
| Service Layer Opacity | `1.0` | Opacity 0.0–1.0 |
| Feature Where Clause | (empty) | SQL WHERE filter for Feature layers |
| Use Service Renderer | `false` | Apply service-defined symbology |
| Cluster Service Features | `false` | Cluster feature service points |
| Service Layer Popups | `true` | Click-to-identify popups on service layers |
| Spatial Query on Draw | `false` | Drawn shapes query Feature service for intersecting features |
| Latitude Field | `latitude` | SPL field name for latitude |
| Longitude Field | `longitude` | SPL field name for longitude |
| Tooltip Field | `description` | SPL field for popup content |
| GeoJSON Field | `geojson` | SPL field for GeoJSON geometry |
| Time Field | `_time` | SPL field for timeline epoch timestamps |
| Custom Tile URL | (empty) | Custom XYZ tile URL template |
| Esri API Key | (empty) | API key for Esri geocoding service |

### Data Display

| Setting | Default | Description |
|---------|---------|-------------|
| Basemap | `esri-dark-gray` | Background tile layer |
| Secondary Basemap | `none` | Enables side-by-side comparison when set |
| Display Mode | `markers` | `markers`, `heatmap`, or `both` |
| Center Lat/Lon | `39.8 / -98.5` | Initial map center |
| Initial Zoom | `4` | Starting zoom level |
| Max/Min Zoom | `18 / 1` | Zoom range limits |
| Tooltip Mode | `click` | `click`, `hover`, or `both` |
| Drilldown | `none` | `none` or `all` |
| Zoom Control | `true` | Show zoom buttons |
| Scale Bar | `false` | Show distance scale |
| Fullscreen | `true` | Show fullscreen button |
| Coordinates | `false` | Show cursor lat/lon |
| Feature Count | `false` | Show feature count badge |
| Legend | `true` | Show legend (when `_legend` field present) |
| Auto-Fit Bounds | `true` | Zoom to fit features |
| Marker Clustering | `false` | Cluster nearby markers |
| Geocoder Search | `false` | Show address/place search |
| Draw Tools | `false` | Show polygon/line drawing tools |
| Measure Tool | `false` | Show distance measurement tool |
| Minimap | `false` | Show overview minimap |
| Timeline Slider | `false` | Show time-based filtering slider |

### Color and Style

| Setting | Default | Description |
|---------|---------|-------------|
| Default Icon | `none` | Default Calcite icon for markers |
| Icon Size | `24` | Icon size in pixels (12–48) |
| Marker Color | `#00A4FD` | Default marker fill color |
| Marker Radius | `6` | Circle marker radius (1–20) |
| Heatmap Radius | `25` | Heatmap point radius (10–50) |
| Heatmap Blur | `15` | Heatmap blur radius (5–30) |
| Heatmap Max Intensity | `0` | Max intensity (0 = auto) |
| Line Color | `#00A4FD` | Default line color |
| Line Width | `2` | Default line width (1–10) |
| Polygon Fill Color | `#00A4FD` | Polygon fill |
| Polygon Stroke Color | `#FFFFFF` | Polygon outline |
| Polygon Fill Opacity | `0.3` | Polygon transparency |

---

## Search Examples

**Basic points:**
```spl
index=firewall sourcetype=traffic
| stats count by src_ip, src_lat, src_lon
| rename src_lat AS latitude, src_lon AS longitude
```

**Heatmap with intensity:**
```spl
index=web sourcetype=access_combined
| iplocation clientip
| stats count AS _intensity by lat, lon
| rename lat AS latitude, lon AS longitude
```

**Timeline replay:**
```spl
index=security sourcetype=auth action=failure
| iplocation src_ip
| eval _time=_time
| rename lat AS latitude, lon AS longitude
| table _time latitude longitude user src_ip
```

**Styled markers with legend:**
```spl
index=assets sourcetype=inventory
| eval _color=case(status="critical","#EF4444",status="warning","#F59E0B",1=1,"#22C55E")
| eval _icon="building"
| eval _legend=status
| table latitude longitude hostname status _color _icon _legend
```

---

## Heatmap Mode

Set **Display Mode** to `Heatmap` or `Both` to render search result points as a density heatmap.

- Use `_intensity` field to weight individual points (default 1.0)
- **Heatmap Radius** controls the spread of each point
- **Heatmap Blur** controls smoothing
- **Heatmap Max Intensity** sets the upper bound (0 = auto-detect)
- Mode `Both` overlays markers on top of the heatmap

---

## Legend

Add a `_legend` field to search results to group features in the legend. Each unique value creates a legend entry with the feature's color and icon.

---

## Marker Clustering

Enable **Marker Clustering** to group nearby point markers. Clusters show a count and expand on click or zoom. Works with all marker types (circle, icon, custom URL).

---

## Drilldown

Enable **Drilldown** to pass all SPL fields to Splunk's drilldown handler when a feature is clicked. Draw tools also trigger drilldown with `drawn_geojson` and `drawn_type` fields.

---

## Geocoder Search

Enable **Geocoder Search** to show an address/place search control. Uses the Esri ArcGIS World Geocoding Service.

For production use, provide an **Esri API Key** from [developers.arcgis.com](https://developers.arcgis.com). Without a key, the geocoder works with limited usage.

Requires `geocode.arcgis.com` in the CSP `connect-src` override.

---

## Draw Tools

Enable **Draw Tools** to show drawing controls for:
- **Polyline** — draw connected line segments
- **Polygon** — draw closed polygons
- **Rectangle** — draw axis-aligned rectangles
- **Circle** — draw circles with a center and radius
- **Marker** — place individual point markers

Drawn shapes are added to the map and persist until cleared via the edit toolbar. When drilldown is enabled, each shape triggers a drilldown event with the GeoJSON geometry.

### Spatial Queries

When both **Draw Tools** and **Spatial Query on Draw** are enabled, drawing a shape on the map will automatically query the ESRI Feature service layer for intersecting features. Results are:

1. **Highlighted** on the map in amber/gold
2. Shown in a **results panel** (top-right) listing feature names
3. **Clickable** — click a result to zoom to that feature and see its attributes

This is useful for answering questions like "what features are within this area?" without needing to write SPL queries.

Requirements:
- Service Type must be **Feature**
- An ESRI Service URL must be configured
- Both **Draw Tools** and **Spatial Query on Draw** must be enabled

---

## Service Layer Popups (Click-to-Identify)

When **Service Layer Popups** is enabled (default), clicking on features in the ESRI service layer will query the server and display feature attributes in a popup.

| Service Type | Behavior |
|---|---|
| **Feature** | Clicking a feature shows its attributes directly from the service |
| **Dynamic** | Clicking the map sends an `identify` request to the MapServer and shows attributes of features at that location across all visible layers |
| **Image** | Same as Dynamic — identify request at the clicked location |
| **Tile** | Clicking the map sends an `identify` request; useful for cached tile layers backed by a MapServer |

The popup displays all attributes from the service (excluding internal fields like OBJECTID and Shape). For Dynamic/Image/Tile layers, when multiple features from different layers are found at the click location, each layer's features are shown separated by a divider with the layer name highlighted.

---

## Measure Tool

Enable **Measure Tool** to show a ruler button. Click the ruler, then click points on the map to measure distances. Double-click to finish. The total distance is shown in km/m.

---

## Minimap

Enable **Minimap** to show a small overview map in the bottom-right corner. The minimap uses the same basemap and provides navigation context for zoomed-in views.

---

## Timeline Slider

Enable **Timeline Slider** to filter features by time. Requires a time field (epoch seconds) in search results — defaults to `_time`.

- Drag the slider to filter features up to the selected time
- Click **Play** for animated temporal replay
- Click **Reset** to show all features

---

## Side-by-Side Comparison

Set **Secondary Basemap** to enable a draggable slider that compares two basemap layers. Useful for comparing satellite imagery with street maps, or dark vs light themes.

---

## Service Layer Enhancements

### Service-Defined Symbology
Enable **Use Service Renderer** to apply the ESRI service's own symbology (colors, sizes, icons) to feature layers. The renderer is provided by `esri-leaflet-renderers`.

### Service Feature Clustering
Enable **Cluster Service Features** to cluster point features from an ESRI Feature service. Uses `esri-leaflet-cluster` which wraps `leaflet.markercluster`.

---

## Basemap Options

| Value | Description |
|-------|-------------|
| `esri-dark-gray` | Dark gray canvas (default) |
| `esri-light-gray` | Light gray canvas |
| `esri-streets` | Street map |
| `esri-topo` | Topographic |
| `esri-imagery` | Satellite imagery |
| `esri-nat-geo` | National Geographic |
| `osm` | OpenStreetMap |
| `none` | No basemap (transparent) |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Blue/dark screen, no tiles | Add CSP overrides to `web.conf` and restart Splunk |
| Geocoder fails | Add `geocode.arcgis.com` to `csp.connect-src_override` |
| Dynamic MapServer blank | Ensure `csp.img-src_override` includes the server domain |
| Draw toolbar icons missing | Custom CSS provides text-based icons — no image sprites needed |
| Timeline not showing | Ensure your search has a `_time` (or custom) field with epoch values |
| Side-by-side not working | Set both primary basemap and secondary basemap to different values |

---

## Build from Source

```bash
cd esri_map_viz/appserver/static/visualizations/esri_map_viz
npm install
npm run build

# Or use the build script:
chmod +x build-esri-map-viz.sh
./build-esri-map-viz.sh
```

---

## Architecture

```
esri_map_viz/
├── default/
│   ├── app.conf
│   ├── visualizations.conf
│   └── savedsearches.conf
├── metadata/
│   └── default.meta
├── README/
│   └── savedsearches.conf.spec
├── README.md
└── appserver/static/visualizations/esri_map_viz/
    ├── src/
    │   └── visualization_source.js
    ├── visualization.js          (webpack bundle)
    ├── visualization.css
    ├── formatter.html
    ├── package.json
    └── webpack.config.js
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `leaflet` | ^1.9.4 | Core mapping library |
| `esri-leaflet` | ^3.0.12 | ESRI service consumption |
| `leaflet.markercluster` | ^1.5.3 | Marker clustering |
| `leaflet.heat` | ^0.2.0 | Canvas heatmap rendering |
| `esri-leaflet-geocoder` | ^3.1.4 | Address/place search |
| `leaflet-draw` | ^1.0.4 | Drawing tools |
| `leaflet-minimap` | ^3.6.1 | Overview minimap |
| `leaflet-side-by-side` | ^2.2.0 | Layer comparison slider |
| `esri-leaflet-renderers` | ^3.0.1 | Service symbology |
| `esri-leaflet-cluster` | ^3.0.1 | Service feature clustering |
