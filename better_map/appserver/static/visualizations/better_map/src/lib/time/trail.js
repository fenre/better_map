/*
 * Comet trail time filter.
 *
 * Applies a fade-out window over the markers / paths layers driven by the
 * current scrubber position. Features whose `time` property is more than
 * `windowMs` older than `now` are fully transparent; those at `now` are
 * fully opaque; everything in-between is linearly interpolated.
 *
 * This module mutates paint-property expressions on existing layers; no
 * sources are created here. It works on any layer that exposes a
 * circle-opacity or line-opacity paint property and whose features have a
 * numeric `time` property (set by dataFitness).
 */

export function applyTrail(map, options) {
    const opts = options || {};
    if (!map) return;
    const now = numericTime(opts.now);
    const windowMs = Math.max(1, Number(opts.windowMs) || 60000);
    if (!Number.isFinite(now)) {
        clearTrail(map, opts.layerIds);
        return;
    }

    const layerIds = opts.layerIds || [];
    for (let i = 0; i < layerIds.length; i++) {
        const layerId = layerIds[i];
        if (!map.getLayer(layerId)) continue;
        const opacityExpr = trailOpacityExpr(now, windowMs);
        const type = map.getLayer(layerId).type;
        try {
            if (type === 'circle') {
                map.setPaintProperty(layerId, 'circle-opacity', opacityExpr);
                map.setPaintProperty(layerId, 'circle-stroke-opacity', opacityExpr);
            } else if (type === 'line') {
                map.setPaintProperty(layerId, 'line-opacity', opacityExpr);
            } else if (type === 'fill') {
                map.setPaintProperty(layerId, 'fill-opacity', opacityExpr);
            } else if (type === 'symbol') {
                map.setPaintProperty(layerId, 'text-opacity', opacityExpr);
                map.setPaintProperty(layerId, 'icon-opacity', opacityExpr);
            }
        } catch (_err) {
            // ignore - layer may not support this opacity property yet
        }
    }
}

export function clearTrail(map, layerIds) {
    if (!map) return;
    const ids = layerIds || [];
    for (let i = 0; i < ids.length; i++) {
        const layerId = ids[i];
        if (!map.getLayer(layerId)) continue;
        const type = map.getLayer(layerId).type;
        try {
            if (type === 'circle') {
                map.setPaintProperty(layerId, 'circle-opacity', 0.95);
                map.setPaintProperty(layerId, 'circle-stroke-opacity', 1);
            } else if (type === 'line') {
                map.setPaintProperty(layerId, 'line-opacity', 0.95);
            } else if (type === 'fill') {
                map.setPaintProperty(layerId, 'fill-opacity', 0.75);
            } else if (type === 'symbol') {
                map.setPaintProperty(layerId, 'text-opacity', 1);
                map.setPaintProperty(layerId, 'icon-opacity', 1);
            }
        } catch (_err) {
            // ignore
        }
    }
}

function trailOpacityExpr(now, windowMs) {
    // age = now - time. If age < 0 the feature is in the future, render
    // transparent. If age > windowMs, transparent. Otherwise 1 - age/windowMs.
    return [
        'case',
        ['<', ['coalesce', ['get', 'time'], 0], 1],
        0,
        [
            'max',
            0,
            [
                'min',
                1,
                ['/', ['-', windowMs, ['max', 0, ['-', now, ['get', 'time']]]], windowMs]
            ]
        ]
    ];
}

function numericTime(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
}
