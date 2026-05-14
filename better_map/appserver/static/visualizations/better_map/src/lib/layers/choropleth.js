/*
 * Choropleth layer.
 *
 * Like the polygon layer but driven by a numeric `value` property, mapped
 * through a sequential color ramp (Viridis by default). The min/max can
 * be supplied explicitly or computed from the feature set.
 */

import { sequentialRamp, featureRange, VIRIDIS } from '../palettes.js';

export const SOURCE_ID = 'better_map_choropleth_src';
export const LAYER_FILL = 'better_map_choropleth_fill';
export const LAYER_OUTLINE = 'better_map_choropleth_outline';

let _cachedRange = null;

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const palette = options.palette || VIRIDIS;
    const stops = options.stops || _cachedRange || [0, 100];
    const valueProp = options.valueProperty || 'value';

    if (!map.getLayer(LAYER_FILL)) {
        map.addLayer({
            id: LAYER_FILL,
            type: 'fill',
            source: SOURCE_ID,
            paint: {
                'fill-color': sequentialRamp(valueProp, stops, palette),
                'fill-opacity': typeof options.opacity === 'number' ? options.opacity : 0.75
            }
        });
    } else {
        map.setPaintProperty(LAYER_FILL, 'fill-color', sequentialRamp(valueProp, stops, palette));
    }

    if (!map.getLayer(LAYER_OUTLINE)) {
        map.addLayer({
            id: LAYER_OUTLINE,
            type: 'line',
            source: SOURCE_ID,
            paint: {
                'line-color': options.outline || '#0b1a2d',
                'line-width': typeof options.lineWidth === 'number' ? options.lineWidth : 0.6,
                'line-opacity': 0.6
            }
        });
    }
}

export function update(map, fc, opts) {
    if (!map) return;
    const src = map.getSource(SOURCE_ID);
    if (src && src.setData) {
        src.setData(fc || { type: 'FeatureCollection', features: [] });
    }
    if (!opts || !opts.stops) {
        const valueProp = (opts && opts.valueProperty) || 'value';
        _cachedRange = featureRange(fc, valueProp);
    } else {
        _cachedRange = opts.stops;
    }
    if (map.getLayer(LAYER_FILL) && _cachedRange) {
        const palette = (opts && opts.palette) || VIRIDIS;
        const valueProp = (opts && opts.valueProperty) || 'value';
        map.setPaintProperty(
            LAYER_FILL,
            'fill-color',
            sequentialRamp(valueProp, _cachedRange, palette)
        );
    }
}

export function unmount(map) {
    if (!map) return;
    [LAYER_OUTLINE, LAYER_FILL].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    _cachedRange = null;
}

export function setVisible(map, visible) {
    [LAYER_FILL, LAYER_OUTLINE].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

export function getRange() {
    return _cachedRange;
}
