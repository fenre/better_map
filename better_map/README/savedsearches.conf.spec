#  README for the better_map custom visualization options.
#
#  All options are written to savedsearches.conf as
#    display.visualizations.custom.better_map.better_map.<key>
#  by Splunk Dashboard Studio (and the classic dashboard formatter). This
#  spec file documents each key so AppInspect and admins can validate
#  custom viz options without reading source.

#-----------------------------------------------------------------------
# Tile provider / basemap
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.tileProvider = <string>
* Selects the basemap tileset. One of:
*   openfreemap-positron | openfreemap-liberty | openfreemap-bright |
*   osm-raster | maptiler-streets | maptiler-topo |
*   stadia-osm-bright | stadia-alidade-smooth | pmtiles | custom
* Default: openfreemap-positron

display.visualizations.custom.better_map.better_map.tileProviderApiKey = <string>
* API key for keyed providers (MapTiler / Stadia). Stored in the dashboard
* options. Not a server-side secret - rotate via Studio whenever needed.

display.visualizations.custom.better_map.better_map.customStyleUrl = <string>
* Style URL used when tileProvider = custom or pmtiles.

display.visualizations.custom.better_map.better_map.mapLabelLanguage = <string>
* auto | en | es | fr | de | ja | zh. Switches MapLibre text-field labels
* when the tileset supports the chosen locale. Default: auto.

#-----------------------------------------------------------------------
# Data configurations (field detection)
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.latField = <string>
* Override field name for latitude. Default: auto-detect.

display.visualizations.custom.better_map.better_map.lonField = <string>
* Override field name for longitude. Default: auto-detect.

display.visualizations.custom.better_map.better_map.autoSwap = <boolean>
* true | false. Auto-correct rows with swapped lat/lon. Default: false.

display.visualizations.custom.better_map.better_map.idField = <string>
* Identifier field used by drilldown, feature-join and cross-panel tokens.

display.visualizations.custom.better_map.better_map.timeField = <string>
* Override field name for the time axis. Default: auto-detect (_time, time, timestamp).

display.visualizations.custom.better_map.better_map.layerField = <string>
* When set, distinct values become layer-control toggles. Default: auto-detect.

display.visualizations.custom.better_map.better_map.pathIdField = <string>
* Group rows into LineString features by this field. Default: auto-detect.

#-----------------------------------------------------------------------
# Point rendering
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.pointRenderer = <string>
* auto | markers | cluster | heatmap | hexbin. Default: auto.

display.visualizations.custom.better_map.better_map.hexbinAutoDegrade = <boolean>
* When pointRenderer = hexbin, coarsen the H3 resolution at low zoom. Default: true.

display.visualizations.custom.better_map.better_map.hexbinResolution = <integer>
* Explicit H3 resolution (0-15). Overrides auto-degrade when set.

display.visualizations.custom.better_map.better_map.hexbinAggregate = <string>
* count | sum | mean. Drives the color ramp and 3D extrusion. Default: count.

display.visualizations.custom.better_map.better_map.hexbinOpacity = <float>
* 0.0 - 1.0. Hexbin fill opacity. Default: 0.55.

#-----------------------------------------------------------------------
# Polygon rendering
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.enableChoropleth = <boolean>
* Render polygons as a value-driven choropleth. Default: false.

display.visualizations.custom.better_map.better_map.polygonFill = <string>
* Default polygon fill color (hex). Used when enableChoropleth = false.

display.visualizations.custom.better_map.better_map.polygonOpacity = <float>
* 0.0 - 1.0. Polygon fill opacity. Default: 0.35.

display.visualizations.custom.better_map.better_map.enable3DExtrusion = <boolean>
* Extrude polygons (or hexbins) along Z. Requires pitch enabled. Default: false.

display.visualizations.custom.better_map.better_map.extrusionHeightField = <string>
* Property name on polygons to use for extrusion height. Default: height.

display.visualizations.custom.better_map.better_map.extrusionScale = <float>
* Multiplier applied to extrusion height. Default: 1.

#-----------------------------------------------------------------------
# Paths
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.pathColor = <string>
* Default line color (hex) for routes / paths.

display.visualizations.custom.better_map.better_map.pathWidth = <float>
* Line width in pixels. Default: 3.

display.visualizations.custom.better_map.better_map.pathArrows = <boolean>
* Periodic arrow heads along each path. Default: false.

display.visualizations.custom.better_map.better_map.pathAnimated = <boolean>
* Animated ant-path effect. Default: false.

#-----------------------------------------------------------------------
# Heatmap
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.heatmapRadius = <float>
* Heatmap radius in pixels at low zoom. Default: 8.

display.visualizations.custom.better_map.better_map.heatmapOpacity = <float>
* 0.0 - 1.0. Default: 0.85.

#-----------------------------------------------------------------------
# Indoor / image overlay
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.indoorImageUrl = <string>
* HTTPS URL to a georeferenced floorplan image.

display.visualizations.custom.better_map.better_map.indoorImageCoordinates = <string>
* Four "lng,lat" pairs separated by ; - top-left, top-right, bottom-right, bottom-left.

display.visualizations.custom.better_map.better_map.indoorOpacity = <float>
* 0.0 - 1.0. Floorplan raster opacity. Default: 0.95.

#-----------------------------------------------------------------------
# Feature join (vector tile choropleth)
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.featureJoinPreset = <string>
* Empty | countries | us-states | admin1. Requires matching PMTiles bundle.

display.visualizations.custom.better_map.better_map.featureJoinUrl = <string>
* Custom vector tile or pmtiles:// URL.

display.visualizations.custom.better_map.better_map.featureJoinSourceLayer = <string>
* Source layer name inside the tileset.

display.visualizations.custom.better_map.better_map.featureJoinPromoteId = <string>
* Property name used to match the user's id field.

#-----------------------------------------------------------------------
# View, interaction, drilldown
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.allowPitch = <boolean>
* Allow user pitch (3D tilt). Default: true.

display.visualizations.custom.better_map.better_map.allowRotate = <boolean>
* Allow user rotate. Default: true.

display.visualizations.custom.better_map.better_map.lockView = <boolean>
* Pin user pan/zoom across data refreshes. Default: false.

display.visualizations.custom.better_map.better_map.showLayerControl = <boolean>
* Show floating layer toggle when more than one layer is detected. Default: true.

display.visualizations.custom.better_map.better_map.showTimeScrubber = <boolean>
* Show time scrubber when a time field is detected. Default: true.

display.visualizations.custom.better_map.better_map.trailWindowMs = <integer>
* Comet trail window in milliseconds. Default: 300000 (5 minutes).

display.visualizations.custom.better_map.better_map.enableDrilldown = <boolean>
* Publish field/value tokens when a feature is clicked. Default: true.

display.visualizations.custom.better_map.better_map.enableCrossPanel = <boolean>
* Publish camera state as dashboard tokens. Default: true.

display.visualizations.custom.better_map.better_map.enablePopups = <boolean>
* Open a sanitized HTML popup using the `popup`, `tooltip`, or `description`
  field when a feature is clicked. HTML is filtered through DOMPurify with a
  strict allow-list. Default: true.

display.visualizations.custom.better_map.better_map.showPerfHUD = <boolean>
* Overlay an FPS / frame-time / layer-count / free-WebGL-slots HUD on top of
  the map for benchmarking. Default: false.

display.visualizations.custom.better_map.better_map.highContrast = <boolean>
* Switch widget chrome to solid black/white surfaces with strong borders for
  WCAG AAA contrast. Default: false.

display.visualizations.custom.better_map.better_map.labelLanguage = <string>
* Two-letter ISO 639-1 code (en, es, fr, de, it, pt, ru, zh, ja, ko, ar, hi)
  or empty string for the basemap's native labels. Default: empty.

display.visualizations.custom.better_map.better_map.enableExportShare = <boolean>
* Show the "PNG" / "Share" toolbar in the top-right. PNG downloads a
  snapshot of the current canvas; Share copies a deep-link with the current
  camera state. Default: true.

#-----------------------------------------------------------------------
# Color and style
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.palette = <string>
* viridis | rdylbu | set3. Default: viridis.

display.visualizations.custom.better_map.better_map.markerColor = <string>
* Default marker fill color (hex). Default: #8dd3c7.

display.visualizations.custom.better_map.better_map.markerOutline = <string>
* Default marker outline color (hex). Default: #0b1a2d.

display.visualizations.custom.better_map.better_map.highContrast = <boolean>
* Boost label and outline contrast for low-vision accessibility. Default: false.
