/*
 * 3D polygon extrusion layer.
 *
 * Pulls Polygon / MultiPolygon features and extrudes them along the Z axis
 * using a numeric `height` (preferred) or `value` property. Includes an
 * outline at z=0 for context on a flat basemap and uses a Viridis color
 * ramp on the same property by default. Pitch + rotate are toggled by the
 * caller (MapBuilder enables them in init() when allowPitch/allowRotate
 * are true, which is the default).
 *
 * For aggregate hexbin extrusion see lib/layers/hexbin.js — that module
 * does its own H3 cell aggregation and ships its own fill-extrusion layer.
 * This module is intended for "ready to render" polygons such as building
 * footprints supplied by the user.
 */

import { sequentialRamp, featureRange, VIRIDIS } from '../palettes.js';
import {
    startExtrusionPulse,
    stopExtrusionPulse,
    stopAllExtrusionPulsesOnMap,
    isExtrusionPulseRunning
} from '../extrusionPulse.js';

export const SOURCE_ID = 'better_map_extrusion_src';
export const LAYER_EXTRUSION = 'better_map_extrusion';
export const LAYER_OUTLINE = 'better_map_extrusion_outline';

/*
 * v1.5.2 — BM-CT-1 Control Trio state.
 *
 * Captured on the first update() call (since update() is where pulse
 * actually gets configured). Tracks:
 *   - _defaults.pulse: dashboard-author intent (true/false), used by
 *     reset() to return to the original state after the user has
 *     toggled the pulse at runtime.
 *   - _lastBaseHeightExpr / _lastAmplitude / _lastPeriodMs: latest
 *     paint inputs so setPulse(map, true) can restart the pulser with
 *     the SAME base height that the data update produced — preventing
 *     a stale-data "snap" on re-enable.
 *
 * All state is module-scoped because the surrounding mount/update API
 * is also module-scoped (one extrusion source per map at a time).
 */
let _defaults = null;
let _lastBaseHeightExpr = null;
let _lastAmplitude = 0.12;
let _lastPeriodMs = 4000;

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const palette = options.palette || VIRIDIS;
    const stops = options.stops || [0, 100];
    const heightProp = options.heightProperty || 'height';
    const colorProp = options.colorProperty || heightProp;
    const scale = typeof options.scale === 'number' ? options.scale : 1;

    if (!map.getLayer(LAYER_OUTLINE)) {
        map.addLayer({
            id: LAYER_OUTLINE,
            type: 'line',
            source: SOURCE_ID,
            paint: {
                'line-color': options.outline || '#0b1a2d',
                'line-width': typeof options.lineWidth === 'number' ? options.lineWidth : 0.6,
                'line-opacity': 0.55
            }
        });
    }

    if (!map.getLayer(LAYER_EXTRUSION)) {
        map.addLayer({
            id: LAYER_EXTRUSION,
            type: 'fill-extrusion',
            source: SOURCE_ID,
            paint: {
                'fill-extrusion-color': sequentialRamp(colorProp, stops, palette),
                'fill-extrusion-base': [
                    '*',
                    scale,
                    ['coalesce', ['get', options.baseProperty || 'base'], 0]
                ],
                'fill-extrusion-height': [
                    '*',
                    scale,
                    ['coalesce', ['get', heightProp], 0]
                ],
                'fill-extrusion-opacity': typeof options.opacity === 'number' ? options.opacity : 0.9
            }
        });
    }
}

export function update(map, fc, opts) {
    if (!map) return;
    const options = opts || {};

    // v1.5.2 — BM-CT-1: capture the dashboard-author defaults on the
    // first update so reset() has a known target. We do this in
    // update() rather than mount() because the `pulse` option is only
    // meaningfully resolved at update time (mount runs before
    // applyOptions in some dashboards).
    if (_defaults === null) {
        _defaults = {
            pulse: !!options.pulse,
            pulseAmplitude: typeof options.pulseAmplitude === 'number' ? options.pulseAmplitude : 0.12,
            pulsePeriodMs: typeof options.pulsePeriodMs === 'number' ? options.pulsePeriodMs : 4000
        };
    }

    const src = map.getSource(SOURCE_ID);
    if (src && src.setData) {
        src.setData(fc || { type: 'FeatureCollection', features: [] });
    }

    if (map.getLayer(LAYER_EXTRUSION)) {
        const palette = options.palette || VIRIDIS;
        const heightProp = options.heightProperty || 'height';
        const colorProp = options.colorProperty || heightProp;
        const stops = options.stops || featureRange(fc, colorProp) || [0, 100];
        const scale = typeof options.scale === 'number' ? options.scale : 1;
        const baseHeightExpr = [
            '*',
            scale,
            ['coalesce', ['get', heightProp], 0]
        ];

        map.setPaintProperty(
            LAYER_EXTRUSION,
            'fill-extrusion-color',
            sequentialRamp(colorProp, stops, palette)
        );
        map.setPaintProperty(LAYER_EXTRUSION, 'fill-extrusion-height', baseHeightExpr);
        if (options.baseProperty) {
            map.setPaintProperty(LAYER_EXTRUSION, 'fill-extrusion-base', [
                '*',
                scale,
                ['coalesce', ['get', options.baseProperty], 0]
            ]);
        }

        // v1.5.2 — record the LATEST base height + tunables so a
        // future setPulse(true) call (from the on-map control panel)
        // can restart the pulser with the right expression without
        // the caller needing to recompute it.
        _lastBaseHeightExpr = baseHeightExpr;
        _lastAmplitude = typeof options.pulseAmplitude === 'number' ? options.pulseAmplitude : 0.12;
        _lastPeriodMs = typeof options.pulsePeriodMs === 'number' ? options.pulsePeriodMs : 4000;

        // v1.5.1 — optional breathing extrusion (gentle ±12% height
        // oscillation on a 4s sine wave). Restart the pulse each
        // update so the base expression always matches the latest
        // scale/palette settings.
        if (options.pulse) {
            startExtrusionPulse(map, LAYER_EXTRUSION, {
                baseHeightExpr: baseHeightExpr,
                amplitude: _lastAmplitude,
                periodMs: _lastPeriodMs
            });
        } else {
            stopExtrusionPulse(map, LAYER_EXTRUSION);
        }
    }
}

export function unmount(map) {
    if (!map) return;
    stopAllExtrusionPulsesOnMap(map);
    [LAYER_EXTRUSION, LAYER_OUTLINE].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setVisible(map, visible) {
    [LAYER_EXTRUSION, LAYER_OUTLINE].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

// -------------------------------------------------------------------------
// v1.5.2 — BM-CT-1 Control Trio: setPulse / isPulseEnabled / reset
//
// Exposes the building-extrusion "breathing pulse" fancy action to the
// on-map control panel. The pulse can be toggled and reset without
// re-mounting the underlying extrusion layer, so live data continues
// to update normally either way.
// -------------------------------------------------------------------------

export function setPulse(map, enabled) {
    if (!map) return;
    if (enabled) {
        if (_lastBaseHeightExpr) {
            startExtrusionPulse(map, LAYER_EXTRUSION, {
                baseHeightExpr: _lastBaseHeightExpr,
                amplitude: _lastAmplitude,
                periodMs: _lastPeriodMs
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
