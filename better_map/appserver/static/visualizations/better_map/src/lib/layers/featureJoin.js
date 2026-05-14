/*
 * Feature-join layer (vector tile choropleth).
 *
 * Renders a backdrop vector layer (countries, US states, admin1 regions,
 * postcodes, whatever the user supplies) and joins user-supplied numeric
 * values onto each feature by matching feature.id. Each joined cell is
 * coloured by a sequential ramp driven by the joined value.
 *
 * Three preset tilesets are configured below. Because we can't ship the
 * underlying ~50-200 MB PMTiles bundles inside an .spl, the URLs default
 * to `pmtiles://./presets/<set>.pmtiles` which resolves against the
 * visualization's own appserver/static directory once the user drops the
 * tiles in (see README "Preset tilesets"). If a tileset URL is missing,
 * the layer is skipped silently and the user is encouraged to point the
 * formatter at their own PMTiles hosting.
 *
 * Custom tilesets are also supported - the user provides their own
 * source URL, source-layer name, and id property. See lib/layers/index.js
 * for how to wire the feature.id field through dataFitness.
 */

import { sequentialRamp, featureRange, VIRIDIS } from '../palettes.js';
import { isSafeMapUrl } from '../popupSanitizer.js';

const STATIC_BASE = './presets/'; // relative to appserver/static/visualizations/better_map

const PRESETS = {
    countries: {
        id: 'countries',
        label: 'World countries',
        url: 'pmtiles://' + STATIC_BASE + 'world-countries.pmtiles',
        sourceLayer: 'countries',
        promoteId: 'iso_a3',
        minzoom: 0,
        maxzoom: 8
    },
    'us-states': {
        id: 'us-states',
        label: 'US states',
        url: 'pmtiles://' + STATIC_BASE + 'us-states.pmtiles',
        sourceLayer: 'states',
        promoteId: 'stusps',
        minzoom: 0,
        maxzoom: 10
    },
    admin1: {
        id: 'admin1',
        label: 'World admin-1 regions',
        url: 'pmtiles://' + STATIC_BASE + 'world-admin1.pmtiles',
        sourceLayer: 'admin1',
        promoteId: 'iso_3166_2',
        minzoom: 0,
        maxzoom: 9
    }
};

export const SOURCE_ID = 'better_map_join_src';
export const LAYER_FILL = 'better_map_join_fill';
export const LAYER_OUTLINE = 'better_map_join_outline';

export function presetOptions() {
    return Object.keys(PRESETS).map(function (id) {
        return { id: id, label: PRESETS[id].label };
    });
}

export function mount(map, opts) {
    const options = opts || {};
    const cfg = resolveConfig(options);
    if (!cfg) {
        // Soft-fail: user picked a preset but didn't ship the tiles.
        return;
    }

    if (!map.getSource(SOURCE_ID)) {
        const sourceDef = {
            type: 'vector',
            url: cfg.url,
            promoteId: cfg.promoteId
        };
        if (typeof cfg.minzoom === 'number') sourceDef.minzoom = cfg.minzoom;
        if (typeof cfg.maxzoom === 'number') sourceDef.maxzoom = cfg.maxzoom;
        map.addSource(SOURCE_ID, sourceDef);
    }

    const palette = options.palette || VIRIDIS;
    const stops = options.stops || [0, 100];

    if (!map.getLayer(LAYER_FILL)) {
        map.addLayer({
            id: LAYER_FILL,
            type: 'fill',
            source: SOURCE_ID,
            'source-layer': cfg.sourceLayer,
            paint: {
                'fill-color': [
                    'case',
                    ['==', ['feature-state', 'hasValue'], true],
                    sequentialRamp(['feature-state', 'value'], stops, palette).slice(0, 3).concat(
                        flattenFeatureStateRamp(palette, stops)
                    ),
                    [
                        'rgba',
                        180,
                        180,
                        180,
                        typeof options.unmatchedOpacity === 'number'
                            ? options.unmatchedOpacity
                            : 0.05
                    ]
                ],
                'fill-opacity': typeof options.opacity === 'number' ? options.opacity : 0.78
            }
        });
    }

    if (!map.getLayer(LAYER_OUTLINE)) {
        map.addLayer({
            id: LAYER_OUTLINE,
            type: 'line',
            source: SOURCE_ID,
            'source-layer': cfg.sourceLayer,
            paint: {
                'line-color': options.outline || '#0b1a2d',
                'line-width': typeof options.lineWidth === 'number' ? options.lineWidth : 0.4,
                'line-opacity': 0.55
            }
        });
    }
}

export function update(map, fc, opts) {
    if (!map || !map.getSource(SOURCE_ID)) return;
    const options = opts || {};
    const cfg = resolveConfig(options);
    if (!cfg) return;

    // Clear previous feature state then apply joins for the current set.
    map.removeFeatureState({ source: SOURCE_ID, sourceLayer: cfg.sourceLayer });
    const features = (fc && fc.features) || [];
    const idProp = options.idProperty || 'id';
    const valueProp = options.valueProperty || 'value';

    let computedStops = options.stops || null;
    if (!computedStops) {
        computedStops = featureRange(
            { features: features.map(passthroughForRange) },
            'value'
        ) || [0, 100];
    }

    for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (!f || !f.properties) continue;
        const id = f.properties[idProp];
        if (id === null || id === undefined || id === '') continue;
        const v = Number(f.properties[valueProp]);
        if (!Number.isFinite(v)) continue;
        map.setFeatureState(
            { source: SOURCE_ID, sourceLayer: cfg.sourceLayer, id: id },
            { value: v, hasValue: true }
        );
    }

    if (map.getLayer(LAYER_FILL)) {
        const palette = options.palette || VIRIDIS;
        map.setPaintProperty(
            LAYER_FILL,
            'fill-color',
            buildJoinedFillExpression(palette, computedStops, options)
        );
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

// -----------------------------------------------------------------------
// Internals

function resolveConfig(options) {
    if (options.preset && PRESETS[options.preset]) {
        const preset = PRESETS[options.preset];
        const url = options.url || preset.url;
        if (!isSafeMapUrl(url)) return null;
        return Object.assign({}, preset, {
            url: url,
            sourceLayer: options.sourceLayer || preset.sourceLayer,
            promoteId: options.promoteId || preset.promoteId
        });
    }
    if (options.url && options.sourceLayer && isSafeMapUrl(options.url)) {
        return {
            url: options.url,
            sourceLayer: options.sourceLayer,
            promoteId: options.promoteId,
            minzoom: options.minzoom,
            maxzoom: options.maxzoom
        };
    }
    return null;
}

function passthroughForRange(f) {
    return {
        properties: { value: Number(f && f.properties && f.properties.value) }
    };
}

function buildJoinedFillExpression(palette, stops, options) {
    const ramp = ['interpolate', ['linear'], ['feature-state', 'value']];
    const min = stops[0];
    const max = stops[1];
    const step = (max - min) / (palette.length - 1);
    for (let i = 0; i < palette.length; i++) {
        ramp.push(min + i * step, palette[i]);
    }
    return [
        'case',
        ['==', ['feature-state', 'hasValue'], true],
        ramp,
        [
            'rgba',
            180,
            180,
            180,
            typeof options.unmatchedOpacity === 'number' ? options.unmatchedOpacity : 0.05
        ]
    ];
}

function flattenFeatureStateRamp(palette, stops) {
    // Reserved for backward compatibility - newer mount() uses
    // buildJoinedFillExpression in update().
    const min = stops[0];
    const max = stops[1];
    const step = (max - min) / (palette.length - 1);
    const out = [];
    for (let i = 0; i < palette.length; i++) {
        out.push(min + i * step);
        out.push(palette[i]);
    }
    return out;
}
