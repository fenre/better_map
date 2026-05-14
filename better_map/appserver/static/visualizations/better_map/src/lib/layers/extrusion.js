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

export const SOURCE_ID = 'better_map_extrusion_src';
export const LAYER_EXTRUSION = 'better_map_extrusion';
export const LAYER_OUTLINE = 'better_map_extrusion_outline';

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

        map.setPaintProperty(
            LAYER_EXTRUSION,
            'fill-extrusion-color',
            sequentialRamp(colorProp, stops, palette)
        );
        map.setPaintProperty(LAYER_EXTRUSION, 'fill-extrusion-height', [
            '*',
            scale,
            ['coalesce', ['get', heightProp], 0]
        ]);
        if (options.baseProperty) {
            map.setPaintProperty(LAYER_EXTRUSION, 'fill-extrusion-base', [
                '*',
                scale,
                ['coalesce', ['get', options.baseProperty], 0]
            ]);
        }
    }
}

export function unmount(map) {
    if (!map) return;
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
