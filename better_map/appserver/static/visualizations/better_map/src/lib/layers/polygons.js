/*
 * Polygons layer (geofences / regions).
 *
 * Renders Polygon and MultiPolygon features as filled regions with an
 * outline. Color, outline, and opacity can be driven from feature
 * properties (`color`, `outline`, `opacity`) or supplied as static defaults
 * via the formatter.
 */

import { SET3 } from '../palettes.js';

export const SOURCE_ID = 'better_map_polygons_src';
export const LAYER_FILL = 'better_map_polygons_fill';
export const LAYER_OUTLINE = 'better_map_polygons_outline';

const DEFAULT_FILL = SET3[4];
const DEFAULT_OUTLINE = '#0b1a2d';

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
                'fill-color': ['coalesce', ['get', 'color'], options.fill || DEFAULT_FILL],
                'fill-opacity': [
                    'coalesce',
                    ['get', 'opacity'],
                    typeof options.opacity === 'number' ? options.opacity : 0.35
                ]
            }
        });
    }

    if (!map.getLayer(LAYER_OUTLINE)) {
        map.addLayer({
            id: LAYER_OUTLINE,
            type: 'line',
            source: SOURCE_ID,
            paint: {
                'line-color': ['coalesce', ['get', 'outline'], options.outline || DEFAULT_OUTLINE],
                'line-width': typeof options.lineWidth === 'number' ? options.lineWidth : 1.5,
                'line-opacity': 0.9
            }
        });
    }
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
    [LAYER_OUTLINE, LAYER_FILL].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setVisible(map, visible) {
    [LAYER_FILL, LAYER_OUTLINE].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}
