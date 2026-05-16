/*
 * Multi-track trip replay (TripsLayer-style).
 *
 * Unlike the existing comet-on-arc effect in paths.js, this layer
 * animates a full multi-vertex track with a trailing fade — the
 * canonical deck.gl TripsLayer pattern. N tracks can replay in
 * parallel, each tied to the dashboard's scrubber time.
 *
 * Input contract: the FeatureCollection passed to update() should
 * contain LineString features where each coordinate has a 3rd
 * element representing time:
 *
 *   "geometry": {
 *     "type": "LineString",
 *     "coordinates": [
 *       [lng, lat, epoch_ms],
 *       [lng, lat, epoch_ms],
 *       ...
 *     ]
 *   }
 *
 * The optional `properties.track_id`, `properties.color`, and
 * `properties.label` are used for styling.
 *
 * Rendering strategy: we compute the "alive" portion of each track
 * for the current scrubber time t and emit two MapLibre line layers:
 *
 *   - LAYER_TRACK_DIM   — the full path at 8% opacity (where you've been)
 *   - LAYER_TRACK_LIVE  — the alive portion (last N seconds of trail)
 *
 * The alive portion is recomputed via a RAF tick when `setTime(t)` is
 * called (typically by the scrubber). When the user is paused, the
 * layer simply renders the most recently-set time.
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

import { shouldSuppressMotion, scheduleFrame, cancelFrame } from '../motion.js';

export const SOURCE_DIM = 'better_map_trips_dim_src';
export const SOURCE_LIVE = 'better_map_trips_live_src';
export const LAYER_TRACK_DIM = 'better_map_trips_dim_line';
export const LAYER_TRACK_LIVE = 'better_map_trips_live_line';

const DEFAULT_TRAIL_MS = 60 * 1000;
const TICK_PERIOD_MS = 100;

let _fc = null;
let _currentTimeMs = null;
let _trailMs = DEFAULT_TRAIL_MS;
let _rafId = null;
let _enabled = true;
let _defaults = null;

function ensureLayers(map) {
    if (!map.getSource(SOURCE_DIM)) {
        map.addSource(SOURCE_DIM, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource(SOURCE_LIVE)) {
        map.addSource(SOURCE_LIVE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(LAYER_TRACK_DIM)) {
        map.addLayer({
            id: LAYER_TRACK_DIM,
            type: 'line',
            source: SOURCE_DIM,
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#9B59B6'],
                'line-width': 1,
                'line-opacity': 0.18
            }
        });
    }
    if (!map.getLayer(LAYER_TRACK_LIVE)) {
        map.addLayer({
            id: LAYER_TRACK_LIVE,
            type: 'line',
            source: SOURCE_LIVE,
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#9B59B6'],
                'line-width': 3,
                'line-opacity': 0.92,
                'line-blur': 1
            }
        });
    }
}

function applyAtTime(map, t) {
    if (!_fc || !map) return;
    const dimFeatures = [];
    const liveFeatures = [];
    const cutoff = t - _trailMs;
    _fc.features.forEach(function (f) {
        if (!f.geometry || f.geometry.type !== 'LineString') return;
        const coords = f.geometry.coordinates || [];
        if (!coords.length) return;
        // Dim track: entire LineString at low opacity.
        dimFeatures.push({
            type: 'Feature',
            properties: Object.assign({}, f.properties || {}),
            geometry: { type: 'LineString', coordinates: coords }
        });
        // Live trail: coords whose 3rd element is in (cutoff, t].
        const live = [];
        for (let i = 0; i < coords.length; i++) {
            const c = coords[i];
            const ts = c[2];
            if (!isFinite(ts)) continue;
            if (ts <= t && ts >= cutoff) {
                live.push([c[0], c[1]]);
            }
            if (ts > t) break;
        }
        if (live.length >= 2) {
            liveFeatures.push({
                type: 'Feature',
                properties: Object.assign({}, f.properties || {}),
                geometry: { type: 'LineString', coordinates: live }
            });
        }
    });
    const dimSrc = map.getSource(SOURCE_DIM);
    const liveSrc = map.getSource(SOURCE_LIVE);
    if (dimSrc) dimSrc.setData({ type: 'FeatureCollection', features: dimFeatures });
    if (liveSrc) liveSrc.setData({ type: 'FeatureCollection', features: liveFeatures });
}

function tick(map) {
    if (!_enabled) {
        _rafId = null;
        return;
    }
    if (shouldSuppressMotion()) {
        // Render the final time only and stop the tick.
        if (_currentTimeMs != null) applyAtTime(map, _currentTimeMs);
        _rafId = null;
        return;
    }
    if (_currentTimeMs != null) {
        applyAtTime(map, _currentTimeMs);
    }
    _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
}

export function mount(map, opts) {
    if (!map) return;
    _defaults = Object.assign({}, opts || {});
    if (opts && isFinite(opts.trailMs)) _trailMs = opts.trailMs;
    ensureLayers(map);
}

export function update(map, fc, opts) {
    if (!map) return;
    ensureLayers(map);
    _fc = fc || null;
    if (opts && isFinite(opts.trailMs)) _trailMs = opts.trailMs;
    _defaults = Object.assign({}, opts || {});
    if (_currentTimeMs == null && _fc && _fc.features.length) {
        // Default time = max timestamp seen.
        let maxT = -Infinity;
        _fc.features.forEach(function (f) {
            const c = f.geometry && f.geometry.coordinates;
            if (!c || !c.length) return;
            const last = c[c.length - 1];
            if (last && isFinite(last[2])) maxT = Math.max(maxT, last[2]);
        });
        if (isFinite(maxT)) _currentTimeMs = maxT;
    }
    if (_currentTimeMs != null) applyAtTime(map, _currentTimeMs);
    if (!_rafId && _enabled && !shouldSuppressMotion()) {
        _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
    }
}

export function setTime(map, t) {
    _currentTimeMs = t;
    if (!_rafId && _enabled && map) {
        _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
    } else if (map && _currentTimeMs != null) {
        applyAtTime(map, _currentTimeMs);
    }
}

export function setTrailMs(map, ms) {
    _trailMs = Math.max(1000, ms);
    if (map && _currentTimeMs != null) applyAtTime(map, _currentTimeMs);
}

export function unmount(map) {
    if (_rafId) { cancelFrame(_rafId); _rafId = null; }
    if (!map) return;
    [LAYER_TRACK_LIVE, LAYER_TRACK_DIM].forEach(function (id) {
        if (map.getLayer(id)) {
            try { map.removeLayer(id); } catch (_e) { /* swallow */ }
        }
    });
    [SOURCE_LIVE, SOURCE_DIM].forEach(function (id) {
        if (map.getSource(id)) {
            try { map.removeSource(id); } catch (_e) { /* swallow */ }
        }
    });
    _fc = null;
    _currentTimeMs = null;
}

export function setVisible(map, visible) {
    if (!map) return;
    [LAYER_TRACK_DIM, LAYER_TRACK_LIVE].forEach(function (id) {
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
export function setEnabled(map, enabled) {
    _enabled = !!enabled;
    if (_enabled) {
        if (!_rafId && map) {
            _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
        }
    } else if (_rafId) {
        cancelFrame(_rafId);
        _rafId = null;
    }
    setVisible(map, _enabled);
}
export function isEnabled() { return _enabled; }
export function reset(map) {
    setTrailMs(map, (_defaults && _defaults.trailMs) || DEFAULT_TRAIL_MS);
    if (_fc && _fc.features.length) {
        let maxT = -Infinity;
        _fc.features.forEach(function (f) {
            const c = f.geometry && f.geometry.coordinates;
            if (!c || !c.length) return;
            const last = c[c.length - 1];
            if (last && isFinite(last[2])) maxT = Math.max(maxT, last[2]);
        });
        if (isFinite(maxT)) setTime(map, maxT);
    }
}
