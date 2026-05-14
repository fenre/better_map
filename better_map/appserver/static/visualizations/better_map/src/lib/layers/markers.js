/*
 * Markers layer (point features).
 *
 * Two render strategies, auto-selected per feature count:
 *
 *   - SDF circle layer (GPU-fast). Used unconditionally; supports per-
 *     feature `color` and `size` properties driven from SPL fields.
 *   - HTML marker fallback for low feature counts (< 200) when the user
 *     wants rich custom icons (Phase 4 will wire this up to a formatter
 *     toggle). For Phase 2 the circle layer is always used.
 *
 * Picks up the optional `color`, `size`, `icon`, `tooltip`, and `popup`
 * properties from each feature's properties bag (set by dataFitness.js).
 */

import { SET3 } from '../palettes.js';

export const SOURCE_ID = 'better_map_markers_src';
export const LAYER_BG = 'better_map_markers_bg';
export const LAYER_DOT = 'better_map_markers_dot';
export const LAYER_LABEL = 'better_map_markers_label';

const DEFAULT_COLOR = SET3[0];
const DEFAULT_RADIUS = 6;

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            promoteId: 'id',
            generateId: false
        });
    }

    const color = expressionOr(['get', 'color'], options.color || DEFAULT_COLOR);
    const radius = expressionOr(['get', 'size'], options.radius || DEFAULT_RADIUS);

    if (!map.getLayer(LAYER_BG)) {
        map.addLayer({
            id: LAYER_BG,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0,
                    radius,
                    14,
                    addExpr(radius, 4)
                ],
                'circle-color': color,
                'circle-opacity': 0.18,
                'circle-blur': 0.4
            }
        });
    }

    if (!map.getLayer(LAYER_DOT)) {
        map.addLayer({
            id: LAYER_DOT,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': radius,
                'circle-color': color,
                'circle-opacity': 0.95,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': options.outline || '#0b1a2d'
            }
        });
    }

    if (options.showLabels && !map.getLayer(LAYER_LABEL)) {
        map.addLayer({
            id: LAYER_LABEL,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'text-field': ['coalesce', ['get', 'label'], ['get', 'name'], ['get', 'tooltip']],
                'text-size': 11,
                'text-offset': [0, 1.1],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-ignore-placement': false
            },
            paint: {
                'text-color': options.labelColor || '#e6eef9',
                'text-halo-color': options.labelHalo || '#0b1a2d',
                'text-halo-width': 1.2
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
    [LAYER_LABEL, LAYER_DOT, LAYER_BG].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setVisible(map, visible) {
    [LAYER_LABEL, LAYER_DOT, LAYER_BG].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

/**
 * Combine a feature-property expression with a literal fallback.
 * Falls back to the literal when the property is missing or null.
 */
function expressionOr(propExpr, literal) {
    return ['case', ['has', propExpr[1]], propExpr, literal];
}

function addExpr(expr, delta) {
    if (typeof expr === 'number') {
        return expr + delta;
    }
    return ['+', expr, delta];
}
