/*
 * MIL-STD-2525C / APP-6 military symbology layer.
 *
 * Renders standardised military/intel-community symbols at point
 * locations, driven by SPL fields. Backed by `milsymbol` (which
 * supports MIL-STD-2525C, 2525D, APP-6A/B/C/D specs).
 *
 * Input contract:
 *
 *   feature.properties.symbol_code = 'SFGPUCI----K---'
 *      (15-character 2525C SIDC, or 30-character 2525D SIDC)
 *
 *   Optional:
 *     feature.properties.uniqueDesignation
 *     feature.properties.higherFormation
 *     feature.properties.staffComments
 *     feature.properties.combatEffectiveness
 *     feature.properties.size (one of 50..200 — symbol pixel size)
 *
 * milsymbol generates SVG which we rasterise to canvas and feed into
 * MapLibre's image registry. The image id is the SIDC itself so
 * features sharing a SIDC share one cached image (cheap).
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

import ms from 'milsymbol';

export const SOURCE_ID = 'better_map_mil2525_src';
export const LAYER_SYMBOLS = 'better_map_mil2525_symbols';

let _defaults = null;
let _enabled = true;
const _cachedImages = {};

function makeSymbolImage(map, sidc, size, props) {
    const cacheKey = sidc + '|' + size + '|' + (props && (props.uniqueDesignation || ''));
    if (_cachedImages[cacheKey]) return _cachedImages[cacheKey];
    try {
        const sym = new ms.Symbol(sidc, Object.assign({}, props || {}, { size: size }));
        const canvas = sym.asCanvas(2); // 2x DPI for crispness
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const imageId = 'better_map_2525_' + cacheKey.replace(/[^\w]/g, '_');
        if (map.hasImage && !map.hasImage(imageId)) {
            map.addImage(imageId, { width: canvas.width, height: canvas.height, data: imgData.data }, { pixelRatio: 2 });
        }
        _cachedImages[cacheKey] = imageId;
        return imageId;
    } catch (_e) {
        return null;
    }
}

function ensureLayers(map) {
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(LAYER_SYMBOLS)) {
        map.addLayer({
            id: LAYER_SYMBOLS,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'icon-image': ['get', '_image_id'],
                'icon-size': 1,
                'icon-allow-overlap': true,
                'icon-anchor': 'center'
            }
        });
    }
}

function preprocess(map, fc, opts) {
    if (!fc || !fc.features) return { type: 'FeatureCollection', features: [] };
    const size = (opts && isFinite(opts.size)) ? opts.size : 60;
    const out = [];
    fc.features.forEach(function (f) {
        if (!f.geometry || f.geometry.type !== 'Point') return;
        const p = f.properties || {};
        const sidc = p.symbol_code || p.sidc || '';
        if (!sidc) return;
        const symbolOpts = {
            uniqueDesignation: p.uniqueDesignation || p.name || undefined,
            higherFormation: p.higherFormation || undefined,
            staffComments: p.staffComments || undefined,
            combatEffectiveness: p.combatEffectiveness || undefined
        };
        const id = makeSymbolImage(map, sidc, size, symbolOpts);
        if (!id) return;
        out.push({
            type: 'Feature',
            properties: Object.assign({}, p, { _image_id: id }),
            geometry: f.geometry
        });
    });
    return { type: 'FeatureCollection', features: out };
}

export function mount(map, opts) {
    if (!map) return;
    _defaults = Object.assign({}, opts || {});
    ensureLayers(map);
}

export function update(map, fc, opts) {
    if (!map) return;
    ensureLayers(map);
    _defaults = Object.assign({}, opts || {});
    const src = map.getSource(SOURCE_ID);
    if (src) src.setData(preprocess(map, fc, opts || {}));
}

export function unmount(map) {
    if (!map) return;
    if (map.getLayer(LAYER_SYMBOLS)) {
        try { map.removeLayer(LAYER_SYMBOLS); } catch (_e) { /* swallow */ }
    }
    if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (_e) { /* swallow */ }
    }
}

export function setVisible(map, visible) {
    if (!map || !map.getLayer(LAYER_SYMBOLS)) return;
    try {
        map.setLayoutProperty(LAYER_SYMBOLS, 'visibility', visible ? 'visible' : 'none');
    } catch (_e) { /* swallow */ }
}

export function mountAndUpdate(map, fc, opts) {
    mount(map, opts);
    update(map, fc, opts);
}

/* BM-CT-1 */
export function setEnabled(map, enabled) {
    _enabled = !!enabled;
    setVisible(map, _enabled);
}
export function isEnabled() { return _enabled; }
export function reset(map) {
    if (_defaults) update(map, null, _defaults);
}
