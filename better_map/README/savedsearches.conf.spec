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

display.visualizations.custom.better_map.better_map.showDebugHud = <boolean>
* Overlay a MapLibre internal-state HUD (style URL, source/layer counts,
  lifecycle event counts, error log, canvas size, center-pixel sample) on
  top of the map for diagnosing why a basemap isn't rendering. Use only for
  development; remove before sharing dashboards. Default: false.

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

#-----------------------------------------------------------------------
# v1.6 - Widgets (BM-CT-1 fancy actions)
# Every entry is a true/false toggle that sets the DEFAULT state at
# dashboard load. The user can flip any of them at runtime via the
# on-map control panel; "Reset view" restores the authored default.
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.v2Geocoder = <boolean>
* Show the Nominatim search box widget. Default: false.

display.visualizations.custom.better_map.better_map.v2CommandPalette = <boolean>
* Enable the command palette (Cmd/Ctrl-K) for quick actions. Default: false.

display.visualizations.custom.better_map.better_map.v2Minimap = <boolean>
* Show the corner overview minimap. Default: false.

display.visualizations.custom.better_map.better_map.v2DrawTools = <boolean>
* Show the polygon / rectangle / circle / line / point draw toolbar.
* Drawn GeoJSON is emitted as a dashboard token. Default: false.

display.visualizations.custom.better_map.better_map.v2Measure = <boolean>
* Enable the click-to-measure tool (distance, area, bearing). Default: false.

display.visualizations.custom.better_map.better_map.v2Lasso = <boolean>
* Enable freehand-polygon lasso multi-select. Default: false.

display.visualizations.custom.better_map.better_map.v2Brushing = <boolean>
* Cursor-radius highlight; features outside the radius dim out. Default: false.

display.visualizations.custom.better_map.better_map.v2SideBySide = <boolean>
* Show a vertical side-by-side basemap divider. Default: false.

display.visualizations.custom.better_map.better_map.v2SpatialQuery = <boolean>
* Drawn shapes emit an SPL where-geomatch template into the
* better_map.spatial_query dashboard token. Default: false.

display.visualizations.custom.better_map.better_map.v2TimeSplit = <boolean>
* Render the same dataset filtered by two time windows (T-1h vs now)
* on a shared camera with a vertical divider. Default: false.

#-----------------------------------------------------------------------
# v1.6 - Layer modules
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.v2WmsLayer = <boolean>
* Overlay WMS GetMap services as a raster source. Default: false.

display.visualizations.custom.better_map.better_map.v2WmsUrl = <string>
* WMS base URL. Only used when v2WmsLayer = true.

display.visualizations.custom.better_map.better_map.v2WmsLayers = <string>
* Comma-separated WMS layer names to fetch.

display.visualizations.custom.better_map.better_map.v2KmlLayer = <boolean>
* Renders KML uploads via togeojson. Default: false.

display.visualizations.custom.better_map.better_map.v2TripsLayer = <boolean>
* Multi-track replay with trailing fade tied to the scrubber. Default: false.

display.visualizations.custom.better_map.better_map.v2GeofenceLayer = <boolean>
* Draw or load polygons with SPL in/out alert templates. Default: false.

display.visualizations.custom.better_map.better_map.v2WindLayer = <boolean>
* Particle system over a u/v vector field. Default: false.

display.visualizations.custom.better_map.better_map.v2ScenegraphLayer = <boolean>
* High-DPI canvas sprites (drone, truck, ship, aircraft) with bearing
* rotation. Default: false.

display.visualizations.custom.better_map.better_map.v2Mil2525Layer = <boolean>
* MIL-STD-2525C / APP-6 symbology via milsymbol. Driven by the
* symbol_code feature property. Default: false.

#-----------------------------------------------------------------------
# v1.6 - Splunk integrations
#-----------------------------------------------------------------------
display.visualizations.custom.better_map.better_map.v2Mitre = <boolean>
* MITRE ATT&CK enrichment using the attack_id feature property.
* Default: false.

display.visualizations.custom.better_map.better_map.v2EsNotable = <boolean>
* Click-to-drilldown into the ES Incident Review view. Default: false.

display.visualizations.custom.better_map.better_map.v2EsBaseUrl = <string>
* Optional ES base URL. Leave empty to use the current Splunk web origin.

display.visualizations.custom.better_map.better_map.v2Itsi = <boolean>
* ITSI service-map mode. Renders the service tree as geo-positioned
* nodes + edges via the ITSI REST endpoints. Default: false.

display.visualizations.custom.better_map.better_map.v2Soar = <boolean>
* Right-click selection to POST entities to phantom_forward.
* Default: false.

display.visualizations.custom.better_map.better_map.v2SoarUrl = <string>
* SOAR phantom_forward URL. Only used when v2Soar = true.

display.visualizations.custom.better_map.better_map.v2Rba = <boolean>
* Risk-based-alerting heatmap aggregating accumulated risk scores per
* geographic bin. Default: false.

display.visualizations.custom.better_map.better_map.v2Purdue = <boolean>
* Color markers by Purdue level (0-5) using the OT asset-register
* lookup. Default: false.

display.visualizations.custom.better_map.better_map.v2PurdueLookup = <string>
* Name of the Splunk lookup containing host,asset_id,purdue_level
* columns. Default: ot_asset_register.

display.visualizations.custom.better_map.better_map.v2AiGeo = <boolean>
* Resolve missing lat/lon by joining against ES assets.csv /
* identities.csv. Default: false.

display.visualizations.custom.better_map.better_map.v2AiAssistant = <boolean>
* Show the AI Assistant chat panel (calls Splunk_AI_Assistant_Cloud's
* SPL generator). Feature-flagged. Default: false.
