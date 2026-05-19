/*
 * Central registry of error scope identifiers used by safeRun.js.
 *
 * Every subsystem that opts into the safeRun boundary MUST reference one
 * of these constants. Free-form scope strings are NOT permitted because
 * they cause drift like 'layer:markers' vs 'layers/markers' vs
 * 'marker-layer' and break HUD grouping / log greps / rate-limit keys.
 *
 * Naming convention: lowercase, colon-separated namespaces.
 *   <family>:<subsystem>[:<detail>]
 *
 * Families:
 *   lifecycle - Splunk visualization-lifecycle methods
 *   map       - mapBuilder + MapLibre wrapper code we own
 *   maplibre  - errors that MapLibre itself emits via map.on('error')
 *   layer     - one of the data-layer strategies (markers, heatmap, ...)
 *   widget    - one of the optional UI widgets (geocoder, draw, ...)
 *   data      - data sources (SPL, AI Geo, ITSI, ES Notable, geocoder fetch)
 *   basemap   - basemap loaders (PMTiles, custom protocols)
 */

// Lifecycle (Splunk visualization API methods)
export const LIFECYCLE_INITIALIZE = 'lifecycle:initialize';
export const LIFECYCLE_FORMAT_DATA = 'lifecycle:format-data';
export const LIFECYCLE_UPDATE_VIEW = 'lifecycle:update-view';
export const LIFECYCLE_REFLOW = 'lifecycle:reflow';
export const LIFECYCLE_DESTROY = 'lifecycle:destroy';

// Map (our wrapper around MapLibre)
export const MAP_CREATE = 'map:create';
export const MAP_SET_STYLE = 'map:set-style';
export const MAP_REMOUNT_LAYERS = 'map:remount-layers';
export const MAP_WHEN_READY = 'map:when-ready';

// MapLibre internal errors (bridged from map.on('error'))
export const MAPLIBRE_INTERNAL = 'maplibre:internal';

// Layers
export const LAYER_MARKERS = 'layer:markers';
export const LAYER_CLUSTERS = 'layer:clusters';
export const LAYER_HEATMAP = 'layer:heatmap';
export const LAYER_PATHS = 'layer:paths';
export const LAYER_HEXBIN = 'layer:hexbin';
export const LAYER_EXTRUSION = 'layer:extrusion';
export const LAYER_KML = 'layer:kml';
export const LAYER_WMS = 'layer:wms';
export const LAYER_GEOFENCE = 'layer:geofence';
export const LAYER_SCENEGRAPH = 'layer:scenegraph';
export const LAYER_WIND = 'layer:wind';
export const LAYER_TRIPS = 'layer:trips';
export const LAYER_MIL2525 = 'layer:mil2525';

// Widgets (v2 bundle)
export const WIDGET_GEOCODER = 'widget:geocoder';
export const WIDGET_COMMAND_PALETTE = 'widget:command-palette';
export const WIDGET_MINIMAP = 'widget:minimap';
export const WIDGET_DRAW_TOOLS = 'widget:draw-tools';
export const WIDGET_MEASURE = 'widget:measure';
export const WIDGET_LASSO = 'widget:lasso';
export const WIDGET_BRUSHING = 'widget:brushing';
export const WIDGET_SIDE_BY_SIDE = 'widget:side-by-side';
export const WIDGET_SPATIAL_QUERY = 'widget:spatial-query';
export const WIDGET_TIME_SPLIT = 'widget:time-split';
export const WIDGET_MARKDOWN_POPUP = 'widget:markdown-popup';

// Data sources
export const DATA_SPL = 'data:spl';
export const DATA_AI_GEO = 'data:ai-geo';
export const DATA_ITSI = 'data:itsi';
export const DATA_ES_NOTABLE = 'data:es-notable';
export const DATA_MITRE = 'data:mitre';
export const DATA_SOAR = 'data:soar';
export const DATA_RBA = 'data:rba';
export const DATA_AI_ASSISTANT = 'data:ai-assistant';
export const DATA_GEOCODER_FETCH = 'data:geocoder-fetch';

// Basemaps
export const BASEMAP_PMTILES = 'basemap:pmtiles';
export const BASEMAP_STYLE_PROTOCOL = 'basemap:style-protocol';

// Sentinel for callers that omit scope (should never be used in production)
export const UNKNOWN = 'unknown:unknown';
