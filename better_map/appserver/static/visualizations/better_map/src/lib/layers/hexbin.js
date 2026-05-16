/*
 * H3 hexbin layer.
 *
 * Aggregates Point features into H3 hex cells (Uber's discrete global grid).
 * Each cell carries:
 *   - count   number of points binned
 *   - sum     sum of an optional numeric property (default `value`)
 *   - mean    sum / count
 *
 * Aggregation is keyed on a resolution. Higher resolution = smaller cells.
 * Recommended ranges:
 *   res 5 globe-zoom
 *   res 6-7 country-zoom
 *   res 8-9 city-zoom
 *   res 10+ street-zoom
 *
 * `autoDegrade: true` ties resolution to the current MapLibre zoom level
 * (re-aggregates on `zoomend`). Explicit `resolution` overrides this.
 *
 * Optional 3D extrusion driven by aggregated `count` (or `sum`) is enabled
 * via `extrude: true`. Default extrusion height scaling auto-fits to data.
 */

import { latLngToCell, cellToBoundary } from 'h3-js';

import { sequentialRamp, featureRange, VIRIDIS } from '../palettes.js';
import {
    startExtrusionPulse,
    stopExtrusionPulse,
    stopAllExtrusionPulsesOnMap,
    isExtrusionPulseRunning
} from '../extrusionPulse.js';

export const SOURCE_ID = 'better_map_hexbin_src';
export const LAYER_FILL = 'better_map_hexbin_fill';
export const LAYER_OUTLINE = 'better_map_hexbin_outline';
export const LAYER_EXTRUSION = 'better_map_hexbin_extrusion';

/*
 * v1.5.2 — BM-CT-1 Control Trio state for hexbin extrusion pulse.
 *
 * Mirrors the same pattern used in layers/extrusion.js — see that file
 * for full rationale. We track the dashboard-author default plus the
 * LATEST baseHeightExpr / amplitude / period so the on-map control
 * panel's setPulse(true) call can restart the pulser with the right
 * inputs without recomputing them from raw H3 data.
 */
let _defaults = null;
let _lastBaseHeightExpr = null;
let _lastAmplitude = 0.12;
let _lastPeriodMs = 4000;
let _lastPhaseOffset = Math.PI / 2;

const DEFAULT_RES_AT_ZOOM = [
    [0, 2],
    [2, 3],
    [4, 4],
    [6, 5],
    [8, 6],
    [10, 7],
    [12, 8],
    [14, 9],
    [16, 10]
];

const STATE_PROP = '_better_map_hexbin_state_';

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getLayer(LAYER_FILL)) {
        map.addLayer({
            id: LAYER_FILL,
            type: 'fill',
            source: SOURCE_ID,
            paint: {
                'fill-color': '#444',
                'fill-opacity': typeof options.opacity === 'number' ? options.opacity : 0.55
            }
        });
    }

    if (!map.getLayer(LAYER_OUTLINE)) {
        map.addLayer({
            id: LAYER_OUTLINE,
            type: 'line',
            source: SOURCE_ID,
            paint: {
                'line-color': options.outline || '#0b1a2d',
                'line-width': typeof options.lineWidth === 'number' ? options.lineWidth : 0.4,
                'line-opacity': 0.6
            }
        });
    }

    // Attach per-map state and a zoomend listener for auto-degrade.
    if (!map[STATE_PROP]) {
        map[STATE_PROP] = {
            rawPoints: { type: 'FeatureCollection', features: [] },
            options: {},
            currentRes: -1
        };
        map.on('zoomend', function () {
            const state = map[STATE_PROP];
            if (!state || !state.options.autoDegrade) return;
            const nextRes = resolutionForZoom(map.getZoom(), state.options);
            if (nextRes !== state.currentRes) {
                aggregateAndUpdate(map, state.rawPoints, state.options);
            }
        });
    }
}

export function update(map, fc, opts) {
    if (!map) return;
    const options = opts || {};

    // v1.5.2 — BM-CT-1: capture dashboard-author defaults on first
    // update() call. Only the `pulse` boolean is considered "author
    // intent" — amplitude/period are runtime tunables that the user
    // can adjust without losing the canonical default.
    if (_defaults === null) {
        _defaults = {
            pulse: !!options.pulse,
            pulseAmplitude: typeof options.pulseAmplitude === 'number' ? options.pulseAmplitude : 0.12,
            pulsePeriodMs: typeof options.pulsePeriodMs === 'number' ? options.pulsePeriodMs : 4000
        };
    }

    const state = map[STATE_PROP];
    if (state) {
        state.rawPoints = fc || { type: 'FeatureCollection', features: [] };
        state.options = options;
    }
    aggregateAndUpdate(map, fc, options);
    if (options.extrude) {
        ensureExtrusion(map, options);
    } else if (map.getLayer(LAYER_EXTRUSION)) {
        map.removeLayer(LAYER_EXTRUSION);
    }
}

export function unmount(map) {
    if (!map) return;
    stopAllExtrusionPulsesOnMap(map);
    [LAYER_EXTRUSION, LAYER_OUTLINE, LAYER_FILL].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    delete map[STATE_PROP];
}

export function setVisible(map, visible) {
    [LAYER_FILL, LAYER_OUTLINE, LAYER_EXTRUSION].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

// -----------------------------------------------------------------------
// Internals

function aggregateAndUpdate(map, fc, options) {
    const points = (fc && fc.features) || [];
    const resolution = resolutionForZoom(map.getZoom(), options);
    const aggregateMode = options.aggregate || 'count';
    const valueProp = options.valueProperty || 'value';

    const bins = new Map();
    for (let i = 0; i < points.length; i++) {
        const f = points[i];
        if (!f || !f.geometry || f.geometry.type !== 'Point') continue;
        const coords = f.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        let cell;
        try {
            cell = latLngToCell(lat, lon, resolution);
        } catch (_err) {
            continue;
        }
        let bucket = bins.get(cell);
        if (!bucket) {
            bucket = { count: 0, sum: 0 };
            bins.set(cell, bucket);
        }
        bucket.count++;
        const props = f.properties || {};
        const v = Number(props[valueProp]);
        if (Number.isFinite(v)) bucket.sum += v;
    }

    const features = [];
    bins.forEach(function (bucket, cell) {
        let boundary;
        try {
            boundary = cellToBoundary(cell, true); // GeoJSON-friendly [lng, lat]
        } catch (_err) {
            return;
        }
        if (!boundary || boundary.length < 3) return;
        // cellToBoundary returns [lng, lat] pairs already when 2nd arg true.
        const ring = closeRing(boundary);
        features.push({
            type: 'Feature',
            id: cell,
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: {
                h3: cell,
                count: bucket.count,
                sum: bucket.sum,
                mean: bucket.count ? bucket.sum / bucket.count : 0,
                metric: aggregateMode === 'sum' || aggregateMode === 'mean' ? bucket.sum / (aggregateMode === 'mean' ? bucket.count || 1 : 1) : bucket.count
            }
        });
    });

    const aggregatedFC = { type: 'FeatureCollection', features: features };
    const src = map.getSource(SOURCE_ID);
    if (src && src.setData) {
        src.setData(aggregatedFC);
    }

    const palette = options.palette || VIRIDIS;
    const stops = options.stops || featureRange(aggregatedFC, 'metric') || [0, 1];
    if (map.getLayer(LAYER_FILL)) {
        map.setPaintProperty(LAYER_FILL, 'fill-color', sequentialRamp('metric', stops, palette));
    }

    if (map[STATE_PROP]) {
        map[STATE_PROP].currentRes = resolution;
    }

    if (options.extrude && map.getLayer(LAYER_EXTRUSION)) {
        const heightProp = options.heightFromMetric ? 'metric' : 'count';
        const scale = options.extrudeScale || autoExtrudeScale(stops, options);
        const baseHeightExpr = [
            '*',
            scale,
            ['coalesce', ['get', heightProp], 0]
        ];
        map.setPaintProperty(LAYER_EXTRUSION, 'fill-extrusion-color', sequentialRamp('metric', stops, palette));
        map.setPaintProperty(LAYER_EXTRUSION, 'fill-extrusion-height', baseHeightExpr);

        // v1.5.2 — record the LATEST base height + tunables so the
        // BM-CT-1 setPulse(map, true) hook can resume the pulser with
        // the current aggregation rather than a stale one.
        _lastBaseHeightExpr = baseHeightExpr;
        _lastAmplitude = typeof options.pulseAmplitude === 'number' ? options.pulseAmplitude : 0.12;
        _lastPeriodMs = typeof options.pulsePeriodMs === 'number' ? options.pulsePeriodMs : 4000;
        _lastPhaseOffset = Math.PI / 2;

        // v1.5.1 — optional breathing extrusion. Each hexbin column
        // gently rises and falls by +/-12% over a 4-second sine wave,
        // giving an industrial control-room "live readout" feel without
        // distracting from the underlying metric values. Phase offset
        // PI/2 stops hexbins from breathing in lock-step with any
        // building-extrusion layer mounted on the same map.
        if (options.pulse) {
            startExtrusionPulse(map, LAYER_EXTRUSION, {
                baseHeightExpr: baseHeightExpr,
                amplitude: _lastAmplitude,
                periodMs: _lastPeriodMs,
                phaseOffsetRad: _lastPhaseOffset
            });
        } else {
            stopExtrusionPulse(map, LAYER_EXTRUSION);
        }
    }
}

// -------------------------------------------------------------------------
// v1.5.2 — BM-CT-1 Control Trio: setPulse / isPulseEnabled / reset
//
// Exposes the hexbin extrusion "breathing pulse" fancy action to the
// on-map control panel. Distinct from the building-extrusion pulse so
// the user can toggle each independently. Hexbin pulse only makes
// sense when the extrusion layer exists — when `extrude` is false on
// the dashboard the action is registered as a no-op (panel hides it).
// -------------------------------------------------------------------------

export function setPulse(map, enabled) {
    if (!map) return;
    if (enabled) {
        if (_lastBaseHeightExpr && map.getLayer(LAYER_EXTRUSION)) {
            startExtrusionPulse(map, LAYER_EXTRUSION, {
                baseHeightExpr: _lastBaseHeightExpr,
                amplitude: _lastAmplitude,
                periodMs: _lastPeriodMs,
                phaseOffsetRad: _lastPhaseOffset
            });
        }
    } else {
        stopExtrusionPulse(map, LAYER_EXTRUSION);
    }
}

export function isPulseEnabled(map) {
    if (!map) return false;
    return isExtrusionPulseRunning(map, LAYER_EXTRUSION);
}

export function reset(map) {
    if (!map) return;
    const wantEnabled = _defaults ? !!_defaults.pulse : false;
    setPulse(map, wantEnabled);
}

function ensureExtrusion(map, options) {
    if (map.getLayer(LAYER_EXTRUSION)) {
        return;
    }
    const palette = options.palette || VIRIDIS;
    const stops = options.stops || [0, 100];
    const heightProp = options.heightFromMetric ? 'metric' : 'count';
    const scale = options.extrudeScale || autoExtrudeScale(stops, options);
    map.addLayer({
        id: LAYER_EXTRUSION,
        type: 'fill-extrusion',
        source: SOURCE_ID,
        paint: {
            'fill-extrusion-color': sequentialRamp('metric', stops, palette),
            'fill-extrusion-base': 0,
            'fill-extrusion-height': [
                '*',
                scale,
                ['coalesce', ['get', heightProp], 0]
            ],
            'fill-extrusion-opacity': typeof options.extrudeOpacity === 'number' ? options.extrudeOpacity : 0.85
        }
    });
}

function resolutionForZoom(zoom, options) {
    if (typeof options.resolution === 'number') {
        return clamp(Math.round(options.resolution), 0, 15);
    }
    const table = options.resolutionTable || DEFAULT_RES_AT_ZOOM;
    let res = table[0][1];
    for (let i = 0; i < table.length; i++) {
        if (zoom >= table[i][0]) {
            res = table[i][1];
        } else {
            break;
        }
    }
    return clamp(res, 0, 15);
}

function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

function closeRing(coords) {
    if (coords.length === 0) return coords;
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        return coords.concat([first.slice()]);
    }
    return coords;
}

function autoExtrudeScale(stops, options) {
    if (!stops || stops.length !== 2) return 50;
    const target = options.maxExtrudeMeters || 80000;
    const max = Math.max(Math.abs(stops[0]), Math.abs(stops[1]), 1);
    return target / max;
}
