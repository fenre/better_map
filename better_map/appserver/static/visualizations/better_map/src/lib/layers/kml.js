/*
 * KML import layer.
 *
 * Fetches a KML document from a configured URL (or accepts an inline
 * KML string), converts it to GeoJSON via @tmcw/togeojson, and
 * renders the resulting FeatureCollection as a mix of point / line /
 * polygon layers.
 *
 * SPL integration: when the formatter `kmlUrl` is set, this layer
 * mounts as a static overlay (does not consume SPL data). When the
 * formatter `kmlField` is set instead, the dispatcher reads the
 * named field from the first row of the SPL result and treats THAT
 * as the KML source — useful for "click a notable → its kml_evidence
 * field lights up on the map" patterns.
 *
 * Threat model: KML XML is parsed via DOMParser (browser-native).
 * togeojson is a thin, well-audited library. We never eval anything
 * out of the document. Style information from the KML is converted
 * to MapLibre paint properties via a lossy mapping (PolyStyle.color
 * → fill-color, IconStyle.scale → circle-radius, etc.).
 */

import { kml as toGeoJsonKml } from '@tmcw/togeojson';

export const SOURCE_ID = 'better_map_kml_src';
export const LAYER_POINT = 'better_map_kml_point';
export const LAYER_LINE = 'better_map_kml_line';
export const LAYER_FILL = 'better_map_kml_fill';
export const LAYER_OUTLINE = 'better_map_kml_outline';

let _defaults = null;
let _lastUrl = null;
let _lastInline = null;

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

function decodeKmlString(src) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(src, 'application/xml');
        if (!doc) return EMPTY_FC;
        const fc = toGeoJsonKml(doc);
        if (fc && fc.type === 'FeatureCollection') return fc;
        return EMPTY_FC;
    } catch (_e) {
        return EMPTY_FC;
    }
}

function ensureLayers(map) {
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_FC });
    }
    if (!map.getLayer(LAYER_FILL)) {
        map.addLayer({
            id: LAYER_FILL,
            type: 'fill',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'fill-color': ['coalesce', ['get', 'fill'], '#22C55E'],
                'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.3]
            }
        });
    }
    if (!map.getLayer(LAYER_OUTLINE)) {
        map.addLayer({
            id: LAYER_OUTLINE,
            type: 'line',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'line-color': ['coalesce', ['get', 'stroke'], '#22C55E'],
                'line-width': ['coalesce', ['get', 'stroke-width'], 2]
            }
        });
    }
    if (!map.getLayer(LAYER_LINE)) {
        map.addLayer({
            id: LAYER_LINE,
            type: 'line',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
                'line-color': ['coalesce', ['get', 'stroke'], '#1FBAD6'],
                'line-width': ['coalesce', ['get', 'stroke-width'], 2]
            }
        });
    }
    if (!map.getLayer(LAYER_POINT)) {
        map.addLayer({
            id: LAYER_POINT,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-color': ['coalesce', ['get', 'marker-color'], '#FFB300'],
                'circle-radius': ['coalesce', ['get', 'marker-size'], 5],
                'circle-stroke-color': '#0a0a14',
                'circle-stroke-width': 1
            }
        });
    }
}

function applyData(map, fc) {
    const src = map.getSource(SOURCE_ID);
    if (src) src.setData(fc || EMPTY_FC);
}

export function mount(map, opts) {
    if (!map) return;
    _defaults = Object.assign({}, opts || {});
    ensureLayers(map);
    if (opts && opts.inline) {
        _lastInline = opts.inline;
        applyData(map, decodeKmlString(opts.inline));
    } else if (opts && opts.url) {
        _lastUrl = opts.url;
        fetch(opts.url, { method: 'GET' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('KML HTTP ' + resp.status);
                return resp.text();
            })
            .then(function (txt) {
                applyData(map, decodeKmlString(txt));
            })
            .catch(function (err) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[better_map] KML fetch failed:', err);
                }
            });
    } else {
        applyData(map, EMPTY_FC);
    }
}

export function update(map, _fc, opts) {
    if (!map) return;
    ensureLayers(map);
    const url = opts && opts.url;
    const inline = opts && opts.inline;
    if (inline && inline !== _lastInline) {
        _lastInline = inline;
        applyData(map, decodeKmlString(inline));
    } else if (url && url !== _lastUrl) {
        _lastUrl = url;
        fetch(url, { method: 'GET' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('KML HTTP ' + resp.status);
                return resp.text();
            })
            .then(function (txt) { applyData(map, decodeKmlString(txt)); })
            .catch(function () { /* swallow */ });
    } else if (!url && !inline) {
        applyData(map, EMPTY_FC);
    }
    _defaults = Object.assign({}, opts || {});
}

export function unmount(map) {
    if (!map) return;
    [LAYER_POINT, LAYER_LINE, LAYER_OUTLINE, LAYER_FILL].forEach(function (id) {
        if (map.getLayer(id)) {
            try { map.removeLayer(id); } catch (_e) { /* swallow */ }
        }
    });
    if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (_e) { /* swallow */ }
    }
    _lastUrl = null;
    _lastInline = null;
}

export function setVisible(map, visible) {
    if (!map) return;
    [LAYER_POINT, LAYER_LINE, LAYER_OUTLINE, LAYER_FILL].forEach(function (id) {
        if (!map.getLayer(id)) return;
        try {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        } catch (_e) { /* swallow */ }
    });
}

export function mountAndUpdate(map, fc, opts) {
    mount(map, opts);
    update(map, fc, opts);
}

/* BM-CT-1 */
export function setEnabled(map, enabled) { setVisible(map, enabled); }
export function isEnabled(map) {
    if (!map || !map.getLayer(LAYER_POINT)) return false;
    try {
        return map.getLayoutProperty(LAYER_POINT, 'visibility') !== 'none';
    } catch (_e) { return false; }
}
export function reset(map) {
    if (_defaults) update(map, null, _defaults);
}
