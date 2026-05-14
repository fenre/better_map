/*
 * Color palettes - color-blind-safe by default.
 *
 *   - Viridis (sequential, perceptually uniform): heatmap, choropleth
 *   - RdYlBu (diverging): delta data
 *   - Set3 (categorical, 12 swatches): per-layer marker colors
 *
 * Phase 6 wires these into the formatter as `splunk-color-picker` options.
 */

export const VIRIDIS = [
    '#440154',
    '#482878',
    '#3e4989',
    '#31688e',
    '#26828e',
    '#1f9e89',
    '#35b779',
    '#6ece58',
    '#b5de2b',
    '#fde725'
];

export const RDYLBU = [
    '#a50026',
    '#d73027',
    '#f46d43',
    '#fdae61',
    '#fee090',
    '#ffffbf',
    '#e0f3f8',
    '#abd9e9',
    '#74add1',
    '#4575b4',
    '#313695'
];

export const SET3 = [
    '#8dd3c7',
    '#ffffb3',
    '#bebada',
    '#fb8072',
    '#80b1d3',
    '#fdb462',
    '#b3de69',
    '#fccde5',
    '#d9d9d9',
    '#bc80bd',
    '#ccebc5',
    '#ffed6f'
];

/**
 * Build a MapLibre `interpolate` expression for a sequential ramp driven
 * by a numeric property.
 *
 * @param {string} prop  - feature property name
 * @param {number[]} stops - [min, max] domain
 * @param {string[]} [palette] - color palette (default Viridis)
 * @returns {any[]} MapLibre paint expression
 */
export function sequentialRamp(prop, stops, palette) {
    const colors = palette || VIRIDIS;
    const min = stops[0];
    const max = stops[1];
    const step = (max - min) / (colors.length - 1);
    const expr = ['interpolate', ['linear'], ['get', prop]];
    for (let i = 0; i < colors.length; i++) {
        expr.push(min + i * step, colors[i]);
    }
    return expr;
}

/**
 * Categorical color lookup for a discrete field value.
 *
 * @param {string} prop
 * @param {string[]} categories - explicit ordering for stable colors
 * @param {string[]} [palette]
 * @param {string} [fallback]
 * @returns {any[]} MapLibre paint expression
 */
export function categoricalLookup(prop, categories, palette, fallback) {
    const colors = palette || SET3;
    const expr = ['match', ['get', prop]];
    for (let i = 0; i < categories.length; i++) {
        expr.push(categories[i], colors[i % colors.length]);
    }
    expr.push(fallback || colors[0]);
    return expr;
}

/**
 * Pick a categorical color from the SET3 palette by index. Suitable for
 * layer-control swatches built outside MapLibre.
 */
export function pickCategorical(index, palette) {
    const colors = palette || SET3;
    return colors[index % colors.length];
}

/**
 * Compute min/max of a numeric feature property for ramp domain stops.
 * Returns null when the property is absent from every feature.
 */
export function featureRange(featureCollection, prop) {
    const features = (featureCollection && featureCollection.features) || [];
    let min = Infinity;
    let max = -Infinity;
    let seen = false;
    for (let i = 0; i < features.length; i++) {
        const p = features[i].properties || {};
        const v = Number(p[prop]);
        if (Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
            seen = true;
        }
    }
    if (!seen) return null;
    if (min === max) {
        min = min - 0.5;
        max = max + 0.5;
    }
    return [min, max];
}
