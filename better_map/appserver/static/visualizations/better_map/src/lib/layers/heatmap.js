/*
 * Heatmap layer.
 *
 * Renders Point features as a continuous density surface via MapLibre's
 * built-in `heatmap` paint type. Uses the Viridis palette by default
 * (perceptually uniform, color-blind safe). Weight is taken from the
 * `weight` feature property if present, otherwise treated as 1.
 */

import { VIRIDIS } from '../palettes.js';

export const SOURCE_ID = 'better_map_heatmap_src';
export const LAYER_ID = 'better_map_heatmap';

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (map.getLayer(LAYER_ID)) {
        return;
    }

    const palette = options.palette || VIRIDIS;
    map.addLayer({
        id: LAYER_ID,
        type: 'heatmap',
        source: SOURCE_ID,
        maxzoom: 18,
        paint: {
            'heatmap-weight': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'weight'], 1],
                0,
                0,
                10,
                1
            ],
            'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                typeof options.intensityLow === 'number' ? options.intensityLow : 0.6,
                14,
                typeof options.intensityHigh === 'number' ? options.intensityHigh : 1.4
            ],
            'heatmap-color': buildHeatmapRamp(palette),
            'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                typeof options.radiusLow === 'number' ? options.radiusLow : 8,
                14,
                typeof options.radiusHigh === 'number' ? options.radiusHigh : 30
            ],
            'heatmap-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                typeof options.opacity === 'number' ? options.opacity : 0.85,
                17,
                0.55
            ]
        }
    });
}

export function update(map, fc) {
    if (!map) return;
    const src = map.getSource(SOURCE_ID);
    if (src && src.setData) {
        src.setData(fc || { type: 'FeatureCollection', features: [] });
    }
}

export function unmount(map) {
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setVisible(map, visible) {
    if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
}

function buildHeatmapRamp(palette) {
    // heatmap-color requires the density input to map to rgba transitions.
    // We linearly distribute the palette across [0, 1].
    const expr = ['interpolate', ['linear'], ['heatmap-density']];
    // Force transparent at density 0 to avoid a flat colour wash.
    expr.push(0, 'rgba(0, 0, 0, 0)');
    const step = 1 / palette.length;
    for (let i = 0; i < palette.length; i++) {
        expr.push((i + 1) * step, palette[i]);
    }
    return expr;
}
