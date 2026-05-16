/*
 * Geofence layer.
 *
 * Renders one or more named polygons as "geofences" with a glowing
 * outline and faint fill, plus emits an SPL alert TEMPLATE that
 * dashboard authors paste into their savedsearches.conf when they
 * want Splunk to fire on enter/leave events.
 *
 * Three input modes:
 *
 *   1. opts.fromDrawTool === true  — listen for `bm:draw-finished`
 *      from drawTools.js and treat every drawn polygon / circle as
 *      a new geofence.
 *   2. opts.url — fetch a GeoJSON document from a URL and treat each
 *      Feature in it as a geofence.
 *   3. opts.inline — accept a parsed FeatureCollection inline.
 *
 * SPL alert template emitted via `getAlertSPL(name)`:
 *
 *   index=... sourcetype=...
 *   | eval _in = geomatch(lat, lon, "POLYGON((...))")
 *   | streamstats current=f last(_in) as _prev BY device_id
 *   | where _in != _prev AND isnotnull(_prev)
 *   | eval action = if(_in==1, "entered", "left")
 *
 * The dashboard pastes this into `savedsearches.conf` and pairs it
 * with `enableSched = 1`, `counttype = number of events`, etc.
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

export const SOURCE_ID = 'better_map_geofence_src';
export const LAYER_FILL = 'better_map_geofence_fill';
export const LAYER_LINE = 'better_map_geofence_line';
export const LAYER_GLOW = 'better_map_geofence_glow';
export const LAYER_LABEL = 'better_map_geofence_label';

let _features = [];
let _enabled = true;
let _defaults = null;
let _drawListener = null;
let _parentEl = null;

function ensureLayers(map) {
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(LAYER_GLOW)) {
        map.addLayer({
            id: LAYER_GLOW,
            type: 'line',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#F74B4A'],
                'line-width': 9,
                'line-blur': 6,
                'line-opacity': 0.45
            }
        });
    }
    if (!map.getLayer(LAYER_FILL)) {
        map.addLayer({
            id: LAYER_FILL,
            type: 'fill',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#F74B4A'],
                'fill-opacity': 0.08
            }
        });
    }
    if (!map.getLayer(LAYER_LINE)) {
        map.addLayer({
            id: LAYER_LINE,
            type: 'line',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#F74B4A'],
                'line-width': 2,
                'line-dasharray': [3, 2]
            }
        });
    }
    if (!map.getLayer(LAYER_LABEL)) {
        map.addLayer({
            id: LAYER_LABEL,
            type: 'symbol',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Polygon'],
            layout: {
                'text-field': ['coalesce', ['get', 'name'], ''],
                'text-size': 12,
                'text-anchor': 'center',
                'text-justify': 'center'
            },
            paint: {
                'text-color': '#fff',
                'text-halo-color': 'rgba(0,0,0,0.6)',
                'text-halo-width': 1.5
            }
        });
    }
}

function apply(map) {
    const src = map.getSource(SOURCE_ID);
    if (src) src.setData({ type: 'FeatureCollection', features: _features });
}

function addFromDrawEvent(map, e) {
    const f = e.detail && e.detail.feature;
    if (!f) return;
    const mode = (f.properties && f.properties.mode) || (e.detail && e.detail.mode) || '';
    if (mode !== 'polygon' && mode !== 'rectangle' && mode !== 'circle') return;
    const next = {
        type: 'Feature',
        properties: Object.assign({}, f.properties || {}, {
            name: 'Geofence ' + (_features.length + 1),
            color: '#F74B4A'
        }),
        geometry: f.geometry,
        id: 'bm-geofence-' + (_features.length + 1)
    };
    _features.push(next);
    apply(map);
}

export function mount(map, opts) {
    if (!map) return;
    _defaults = Object.assign({}, opts || {});
    ensureLayers(map);
    if (opts && opts.inline && opts.inline.features) {
        _features = opts.inline.features.slice();
        apply(map);
    } else if (opts && opts.url) {
        fetch(opts.url, { method: 'GET' })
            .then(function (r) { return r.json(); })
            .then(function (fc) {
                if (fc && fc.features) {
                    _features = fc.features.slice();
                    apply(map);
                }
            })
            .catch(function () { /* swallow */ });
    }
    if (opts && opts.parentEl && opts.fromDrawTool) {
        _parentEl = opts.parentEl;
        _drawListener = function (e) { addFromDrawEvent(map, e); };
        _parentEl.addEventListener('bm:draw-finished', _drawListener);
    }
}

export function update(map, fc, opts) {
    if (!map) return;
    ensureLayers(map);
    _defaults = Object.assign({}, opts || {});
    if (fc && fc.features) {
        _features = fc.features.slice();
        apply(map);
    }
}

export function unmount(map) {
    if (!map) return;
    if (_drawListener && _parentEl) {
        try { _parentEl.removeEventListener('bm:draw-finished', _drawListener); } catch (_e) { /* swallow */ }
        _drawListener = null; _parentEl = null;
    }
    [LAYER_LABEL, LAYER_LINE, LAYER_FILL, LAYER_GLOW].forEach(function (id) {
        if (map.getLayer(id)) {
            try { map.removeLayer(id); } catch (_e) { /* swallow */ }
        }
    });
    if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (_e) { /* swallow */ }
    }
    _features = [];
}

export function setVisible(map, visible) {
    if (!map) return;
    [LAYER_LABEL, LAYER_LINE, LAYER_FILL, LAYER_GLOW].forEach(function (id) {
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

/**
 * Return the SPL alert template for the named geofence, or for ALL
 * geofences if name is omitted.
 */
export function getAlertSPL(featureNameOrAll, deviceField, latField, lonField) {
    const dev = deviceField || 'device_id';
    const lat = latField || 'lat';
    const lon = lonField || 'lon';
    const targets = featureNameOrAll
        ? _features.filter(function (f) {
            return ((f.properties && f.properties.name) || '') === featureNameOrAll;
        })
        : _features.slice();
    if (!targets.length) return '';
    const fragments = targets.map(function (f) {
        if (!f.geometry || f.geometry.type !== 'Polygon') return '';
        const ring = f.geometry.coordinates[0];
        const wkt = ring.map(function (c) { return c[0].toFixed(6) + ' ' + c[1].toFixed(6); }).join(', ');
        const name = (f.properties && f.properties.name) || 'fence';
        return [
            '`comment("' + name + '")`',
            '| eval _in_' + name.replace(/[^\w]/g, '_') + ' = geomatch(' + lat + ', ' + lon + ', "POLYGON((' + wkt + '))")'
        ].join(' ');
    }).filter(Boolean).join(' ');
    return [
        'index=YOUR_INDEX sourcetype=YOUR_SOURCETYPE',
        fragments,
        '| streamstats current=f last(_in_*) AS _prev_* BY ' + dev,
        '| where _in_* != _prev_* AND isnotnull(_prev_*)',
        '| eval action = if(_in_*==1, "entered", "left")'
    ].join(' ');
}

/* BM-CT-1 */
export function setEnabled(map, enabled) {
    _enabled = !!enabled;
    setVisible(map, _enabled);
}
export function isEnabled() { return _enabled; }
export function reset(map) {
    _features = [];
    apply(map);
}
export function getFeatures() { return _features.slice(); }
