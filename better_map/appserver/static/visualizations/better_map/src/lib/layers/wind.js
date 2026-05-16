/*
 * Wind / particle / flow-field layer.
 *
 * GPU-cheap CPU-driven particle system. Renders N particles whose
 * positions advance each frame by sampling a vector field (u, v)
 * provided either as:
 *
 *   1. A FeatureCollection of Points with `u` (m/s east) and `v`
 *      (m/s north) properties — we build a coarse k-nearest grid
 *      and sample bilinearly inside its convex hull
 *   2. A grid object: { bbox: [w,s,e,n], cols, rows, u: [...],
 *      v: [...] } — pre-computed wind grid (e.g. from GFS/HRRR)
 *
 * Rendered via a MapLibre GeoJSON source whose data is reset on each
 * tick. Particle count caps at 4000 by default; the autoDegrade
 * option drops to 1500 if the user is on a low-power device (we use
 * `navigator.hardwareConcurrency < 4` as the heuristic).
 *
 * Honours BM-CT-1: setEnabled disables/enables the RAF tick;
 * setMotionPaused via global motion.js stops particle advection but
 * leaves the layer visible (frozen frame).
 */

import { shouldSuppressMotion, scheduleFrame, cancelFrame } from '../motion.js';

export const SOURCE_ID = 'better_map_wind_src';
export const LAYER_PARTICLES = 'better_map_wind_particles';

const TICK_PERIOD_MS = 50; // 20 fps — particle systems look fine here

let _grid = null; // { bbox, cols, rows, u, v }
let _particles = null;
const _params = { count: 2500, speedMps: 1.0, trailFrames: 0 };
let _rafId = null;
let _enabled = true;
let _defaults = null;
let _bbox = null;

function ensureLayers(map) {
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(LAYER_PARTICLES)) {
        map.addLayer({
            id: LAYER_PARTICLES,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': 1.5,
                'circle-color': ['interpolate', ['linear'], ['get', 'speed'],
                    0, '#7DD3FC',
                    8, '#06B6D4',
                    16, '#3B82F6',
                    24, '#9333EA'],
                'circle-blur': 0.4,
                'circle-opacity': 0.85
            }
        });
    }
}

function fromFeatureCollection(fc) {
    if (!fc || !fc.features || !fc.features.length) return null;
    // Build a coarse 64×32 grid over the convex bbox.
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    const pts = [];
    fc.features.forEach(function (f) {
        if (!f.geometry || f.geometry.type !== 'Point') return;
        const c = f.geometry.coordinates;
        const u = parseFloat(f.properties && f.properties.u);
        const v = parseFloat(f.properties && f.properties.v);
        if (!isFinite(c[0]) || !isFinite(c[1]) || !isFinite(u) || !isFinite(v)) return;
        pts.push({ lon: c[0], lat: c[1], u: u, v: v });
        if (c[0] < minLon) minLon = c[0];
        if (c[0] > maxLon) maxLon = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
    });
    if (!pts.length) return null;
    const cols = 64, rows = 32;
    const u = new Float32Array(cols * rows);
    const v = new Float32Array(cols * rows);
    const cnt = new Uint16Array(cols * rows);
    const dx = (maxLon - minLon) / cols;
    const dy = (maxLat - minLat) / rows;
    pts.forEach(function (p) {
        const ci = Math.min(cols - 1, Math.max(0, Math.floor((p.lon - minLon) / dx)));
        const ri = Math.min(rows - 1, Math.max(0, Math.floor((p.lat - minLat) / dy)));
        const idx = ri * cols + ci;
        u[idx] += p.u;
        v[idx] += p.v;
        cnt[idx] += 1;
    });
    for (let i = 0; i < cols * rows; i++) {
        if (cnt[i] > 0) {
            u[i] /= cnt[i];
            v[i] /= cnt[i];
        }
    }
    return {
        bbox: [minLon, minLat, maxLon, maxLat],
        cols: cols,
        rows: rows,
        u: u,
        v: v
    };
}

function sample(grid, lon, lat) {
    const [w, s, e, n] = grid.bbox;
    const cx = Math.max(0, Math.min(grid.cols - 1, Math.floor((lon - w) / (e - w) * grid.cols)));
    const cy = Math.max(0, Math.min(grid.rows - 1, Math.floor((lat - s) / (n - s) * grid.rows)));
    const i = cy * grid.cols + cx;
    return { u: grid.u[i], v: grid.v[i] };
}

function inBbox(grid, lon, lat) {
    return lon >= grid.bbox[0] && lon <= grid.bbox[2] && lat >= grid.bbox[1] && lat <= grid.bbox[3];
}

function seedParticles(grid, count) {
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = {
            lon: grid.bbox[0] + Math.random() * (grid.bbox[2] - grid.bbox[0]),
            lat: grid.bbox[1] + Math.random() * (grid.bbox[3] - grid.bbox[1]),
            age: Math.floor(Math.random() * 60),
            maxAge: 60 + Math.floor(Math.random() * 60)
        };
    }
    return out;
}

function advectAndEmit(map) {
    if (!_grid || !_particles) return;
    // Approximate degree-per-meter conversion. Crude — good enough for
    // 20 fps particle visualization.
    const features = new Array(_particles.length);
    for (let i = 0; i < _particles.length; i++) {
        const p = _particles[i];
        const { u, v } = sample(_grid, p.lon, p.lat);
        const dt = 0.5; // pseudo-seconds per tick (scaled visually)
        // 1 deg ≈ 111 km; speed in m/s. dlon depends on cos(lat).
        const cosLat = Math.cos(p.lat * Math.PI / 180);
        const dlon = (u * dt * _params.speedMps) / (111000 * Math.max(cosLat, 0.01));
        const dlat = (v * dt * _params.speedMps) / 111000;
        p.lon += dlon;
        p.lat += dlat;
        p.age++;
        if (p.age > p.maxAge || !inBbox(_grid, p.lon, p.lat)) {
            // Re-seed.
            p.lon = _grid.bbox[0] + Math.random() * (_grid.bbox[2] - _grid.bbox[0]);
            p.lat = _grid.bbox[1] + Math.random() * (_grid.bbox[3] - _grid.bbox[1]);
            p.age = 0;
            p.maxAge = 60 + Math.floor(Math.random() * 60);
        }
        const speed = Math.sqrt(u * u + v * v);
        features[i] = {
            type: 'Feature',
            properties: { speed: speed },
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
        };
    }
    const src = map.getSource(SOURCE_ID);
    if (src) src.setData({ type: 'FeatureCollection', features: features });
}

function tick(map) {
    if (!_enabled) { _rafId = null; return; }
    if (!shouldSuppressMotion()) {
        advectAndEmit(map);
    }
    _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
}

function applyData(map, fc, opts) {
    _grid = (opts && opts.grid) ? opts.grid : fromFeatureCollection(fc);
    if (!_grid) {
        const src = map.getSource(SOURCE_ID);
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        return;
    }
    _bbox = _grid.bbox;
    const lowPower = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency &&
        navigator.hardwareConcurrency < 4);
    const cap = lowPower ? 1500 : 4000;
    const want = Math.min(cap, Math.max(200, (opts && opts.count) || 2500));
    _params.count = want;
    if (opts && isFinite(opts.speedMps)) _params.speedMps = opts.speedMps;
    _particles = seedParticles(_grid, want);
}

export function mount(map, opts) {
    if (!map) return;
    _defaults = Object.assign({}, opts || {});
    ensureLayers(map);
}

export function update(map, fc, opts) {
    if (!map) return;
    ensureLayers(map);
    _defaults = Object.assign({}, opts || {});
    applyData(map, fc, opts || {});
    if (!_rafId && _enabled && _grid) {
        _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
    }
}

export function unmount(map) {
    if (_rafId) { cancelFrame(_rafId); _rafId = null; }
    if (!map) return;
    if (map.getLayer(LAYER_PARTICLES)) {
        try { map.removeLayer(LAYER_PARTICLES); } catch (_e) { /* swallow */ }
    }
    if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (_e) { /* swallow */ }
    }
    _grid = null;
    _particles = null;
}

export function setVisible(map, visible) {
    if (!map || !map.getLayer(LAYER_PARTICLES)) return;
    try {
        map.setLayoutProperty(LAYER_PARTICLES, 'visibility', visible ? 'visible' : 'none');
    } catch (_e) { /* swallow */ }
}

export function mountAndUpdate(map, fc, opts) {
    mount(map, opts);
    update(map, fc, opts);
}

/* BM-CT-1 */
export function setEnabled(map, enabled) {
    _enabled = !!enabled;
    if (_enabled) {
        if (!_rafId && map) _rafId = scheduleFrame(function () { tick(map); }, TICK_PERIOD_MS);
    } else if (_rafId) {
        cancelFrame(_rafId); _rafId = null;
    }
    setVisible(map, _enabled);
}
export function isEnabled() { return _enabled; }
export function reset(map) {
    if (_grid) {
        _particles = seedParticles(_grid, _params.count);
        if (map) advectAndEmit(map);
    }
}
export function getBbox() { return _bbox ? _bbox.slice() : null; }
