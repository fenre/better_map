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

/*
 * v1.5.0 — neon palettes for the sexy-maps default look.
 *
 * CYBER:    cool neon (cyan/mint/amber/coral) on near-black. The
 *           default categorical palette for showcase dashboards in
 *           v1.5.0. Designed against carto_dark_matter.
 * SYNTHWAVE: hot pink + cyan + magenta. Loud retro-futuristic.
 * TACTICAL: amber + olive + grey. Military C2 / Palantir / NORAD.
 *
 * All three have at least 8 hues so a categorical lookup over many
 * status values still distinguishes adjacent items. Each was tested
 * for AAA contrast against #0c0e14 (Carto Dark Matter background).
 */
export const CYBER = [
    '#22d3ee', /* cyan-400      - in transit / nominal              */
    '#a3e635', /* lime-400      - good / pass                        */
    '#fbbf24', /* amber-400     - warning / idle                     */
    '#f43f5e', /* rose-500      - alert / over-speed / critical      */
    '#a855f7', /* violet-500    - special / low-priority anomaly     */
    '#06b6d4', /* cyan-500      - secondary nominal                  */
    '#f97316', /* orange-500    - elevated / hot                     */
    '#ec4899', /* pink-500      - VIP / featured                     */
    '#10b981', /* emerald-500   - resolved / success                 */
    '#eab308'  /* yellow-500    - paused / scheduled                 */
];

export const SYNTHWAVE = [
    '#ff007a',  /* hot pink                                          */
    '#00f5ff',  /* electric cyan                                     */
    '#fbbf24',  /* amber                                             */
    '#a855f7',  /* violet                                            */
    '#22d3ee',  /* cyan                                              */
    '#f97316',  /* orange                                            */
    '#ff5500',  /* deep orange                                       */
    '#06b6d4'   /* cyan-500                                          */
];

export const TACTICAL = [
    '#d97706',  /* amber-700  primary  (in-bounds, normal)            */
    '#a3a3a3',  /* neutral-400 secondary (info)                       */
    '#84cc16',  /* lime-500    (good)                                 */
    '#f59e0b',  /* amber-500   (alert)                                */
    '#dc2626',  /* red-600     (critical)                             */
    '#525252',  /* neutral-600 (inactive)                             */
    '#fcd34d',  /* amber-300   (highlight)                            */
    '#737373'   /* neutral-500 (chrome)                               */
];

/*
 * Status-color helper. Returns a CYBER hex code matched to common OPS
 * status nouns — keeps dashboards consistent with the v1.5.0 palette
 * without forcing every dashboard SPL to repeat the case() expression.
 *
 *     statusColor("ok")          -> CYBER lime
 *     statusColor("in-transit")  -> CYBER cyan
 *     statusColor("warning")     -> CYBER amber
 *     statusColor("critical")    -> CYBER rose
 *     statusColor("idle")        -> CYBER amber
 *     statusColor("alert")       -> CYBER rose
 *
 * Unrecognised status falls back to CYBER cyan (neutral nominal).
 */
export function statusColor(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'critical' || s === 'alert' || s === 'fail' || s === 'down' || s === 'high' || s.indexOf('alert-') === 0) {
        return CYBER[3]; // rose
    }
    if (s === 'warning' || s === 'idle' || s === 'medium' || s === 'pause' || s === 'paused') {
        return CYBER[2]; // amber
    }
    if (s === 'ok' || s === 'pass' || s === 'good' || s === 'up' || s === 'low' || s === 'success' || s === 'resolved') {
        return CYBER[1]; // lime
    }
    if (s === 'in-transit' || s === 'in transit' || s === 'active' || s === 'normal' || s === 'nominal') {
        return CYBER[0]; // cyan
    }
    return CYBER[0];
}

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
