/*
 * WMS raster layer.
 *
 * Wraps an external Web Map Service (WMS) GetMap endpoint as a
 * MapLibre raster source so dashboard authors can overlay weather
 * radar, satellite imagery, elevation, or any other tile-cacheable
 * WMS feed underneath (or above) the SPL-driven data layers.
 *
 * Configuration model:
 *   opts.baseUrl     — base WMS endpoint (no query string), e.g.
 *                       https://maps.example.com/geoserver/wms
 *   opts.layer       — the WMS LAYERS parameter
 *   opts.styles      — STYLES parameter (default "")
 *   opts.format      — IMAGEFORMAT (default "image/png")
 *   opts.version     — WMS version (default "1.3.0")
 *   opts.transparent — transparent background (default true)
 *   opts.tileSize    — 256 or 512 (default 256)
 *   opts.opacity     — 0..1 (default 0.7)
 *   opts.minZoom     — default 0
 *   opts.maxZoom     — default 20
 *
 * The layer is mounted ABOVE the basemap but BELOW the data layers
 * (markers, paths, polygons) so SPL features remain readable. Use
 * the dashboard's `wmsOnTop` formatter option to invert the order
 * when you want the WMS overlay to obscure the data (e.g. for
 * radar-only views).
 */

export const SOURCE_ID = 'better_map_wms_src';
export const LAYER_WMS = 'better_map_wms_layer';

const DEFAULT_OPACITY = 0.7;
const DEFAULT_VERSION = '1.3.0';
const DEFAULT_FORMAT = 'image/png';

let _onTop = false;
let _defaults = null;

function buildTileUrl(opts, size) {
    const tileSize = size || 256;
    const params = {
        SERVICE: 'WMS',
        VERSION: opts.version || DEFAULT_VERSION,
        REQUEST: 'GetMap',
        LAYERS: opts.layer || '',
        STYLES: opts.styles == null ? '' : opts.styles,
        FORMAT: opts.format || DEFAULT_FORMAT,
        TRANSPARENT: opts.transparent === false ? 'FALSE' : 'TRUE',
        WIDTH: String(tileSize),
        HEIGHT: String(tileSize),
        CRS: opts.crs || 'EPSG:3857',
        BBOX: '{bbox-epsg-3857}'
    };
    // 1.1.x uses SRS instead of CRS — switch if needed.
    if (params.VERSION.indexOf('1.1') === 0) {
        params.SRS = params.CRS;
        delete params.CRS;
    }
    const qs = Object.keys(params).map(function (k) {
        return k + '=' + (k === 'BBOX' ? params[k] : encodeURIComponent(params[k]));
    }).join('&');
    const base = (opts.baseUrl || '').replace(/[?&]$/, '');
    return base + (base.indexOf('?') === -1 ? '?' : '&') + qs;
}

export function mount(map, opts) {
    if (!map || !opts || !opts.baseUrl || !opts.layer) return;
    _defaults = Object.assign({}, opts);
    _onTop = !!opts.onTop;
    const tileSize = opts.tileSize === 512 ? 512 : 256;
    const url = buildTileUrl(opts, tileSize);
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: [url],
            tileSize: tileSize,
            attribution: opts.attribution || ''
        });
    }
    if (!map.getLayer(LAYER_WMS)) {
        // Position: if onTop is true, mount last (above data); otherwise
        // mount before the first data layer so it sits above the basemap
        // but below markers/paths.
        let beforeId = undefined;
        if (!_onTop) {
            const candidates = [
                'better_map_markers_pulse_outer', 'better_map_markers_bg',
                'better_map_clusters_bg', 'better_map_hex_fill',
                'better_map_paths_arc'
            ];
            for (let i = 0; i < candidates.length; i++) {
                if (map.getLayer(candidates[i])) { beforeId = candidates[i]; break; }
            }
        }
        map.addLayer({
            id: LAYER_WMS,
            type: 'raster',
            source: SOURCE_ID,
            paint: {
                'raster-opacity': isFinite(opts.opacity) ? opts.opacity : DEFAULT_OPACITY,
                'raster-fade-duration': 200
            },
            minzoom: isFinite(opts.minZoom) ? opts.minZoom : 0,
            maxzoom: isFinite(opts.maxZoom) ? opts.maxZoom : 20
        }, beforeId);
    }
}

export function update(map, _fc, opts) {
    // WMS is metadata-driven, not feature-driven. If the URL shape
    // changed we tear down and re-mount.
    if (!map || !opts) return;
    if (!opts.baseUrl || !opts.layer) {
        unmount(map);
        return;
    }
    const sameUrl = _defaults &&
        _defaults.baseUrl === opts.baseUrl &&
        _defaults.layer === opts.layer &&
        _defaults.version === opts.version &&
        _defaults.tileSize === opts.tileSize;
    if (!sameUrl) {
        unmount(map);
        mount(map, opts);
        return;
    }
    _defaults = Object.assign({}, opts);
    if (map.getLayer(LAYER_WMS)) {
        try {
            map.setPaintProperty(LAYER_WMS, 'raster-opacity',
                isFinite(opts.opacity) ? opts.opacity : DEFAULT_OPACITY);
        } catch (_e) { /* swallow */ }
    }
}

export function unmount(map) {
    if (!map) return;
    if (map.getLayer(LAYER_WMS)) {
        try { map.removeLayer(LAYER_WMS); } catch (_e) { /* swallow */ }
    }
    if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (_e) { /* swallow */ }
    }
}

export function setVisible(map, visible) {
    if (!map || !map.getLayer(LAYER_WMS)) return;
    try {
        map.setLayoutProperty(LAYER_WMS, 'visibility', visible ? 'visible' : 'none');
    } catch (_e) { /* swallow */ }
}

export function mountAndUpdate(map, fc, opts) {
    mount(map, opts);
    update(map, fc, opts);
}

/* BM-CT-1 contract */
export function setEnabled(map, enabled) {
    setVisible(map, enabled);
}
export function isEnabled(map) {
    if (!map || !map.getLayer(LAYER_WMS)) return false;
    try {
        return map.getLayoutProperty(LAYER_WMS, 'visibility') !== 'none';
    } catch (_e) { return false; }
}
export function reset(map) {
    if (_defaults) update(map, null, _defaults);
}
