/*
 * Paths / routes layer.
 *
 * Renders LineString and MultiLineString features. Supports:
 *   - color per feature via `color` property, falling back to the configured
 *     default
 *   - per-feature width via `width` property
 *   - optional ant-path animation that scrolls the line-dasharray to give
 *     the illusion of flow (popular for routing/incident maps)
 *   - optional arrow heads at line endpoints
 *
 * The animation runs only while there is at least one path feature visible.
 * Phase 5 will gate the animation entirely behind the perf HUD to keep it
 * out of the way when the user has many dashboards open.
 */

import { SET3 } from '../palettes.js';

export const SOURCE_ID = 'better_map_paths_src';
export const LAYER_LINE = 'better_map_paths_line';
export const LAYER_LINE_BG = 'better_map_paths_line_bg';
export const LAYER_ARROW = 'better_map_paths_arrow';

const DEFAULT_COLOR = SET3[3];
const ANT_DASH = [0, 2, 4, 2];
const ANT_FRAME_MS = 60;

const animState = {
    lastTick: 0,
    frame: 0,
    rafId: null,
    map: null,
    enabled: false
};

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getLayer(LAYER_LINE_BG)) {
        map.addLayer({
            id: LAYER_LINE_BG,
            type: 'line',
            source: SOURCE_ID,
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': options.outline || '#0b1a2d',
                'line-width': [
                    '+',
                    ['coalesce', ['get', 'width'], options.width || 3],
                    2
                ],
                'line-opacity': 0.45
            }
        });
    }

    if (!map.getLayer(LAYER_LINE)) {
        map.addLayer({
            id: LAYER_LINE,
            type: 'line',
            source: SOURCE_ID,
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'line-width': ['coalesce', ['get', 'width'], options.width || 3],
                'line-opacity': 0.95
            }
        });
    }

    if (options.arrowHeads && !map.getLayer(LAYER_ARROW)) {
        // Arrow heads are rendered via a symbol layer along the line using
        // a unicode triangle. We use text-rotation-alignment: map so the
        // arrow follows the line direction.
        map.addLayer({
            id: LAYER_ARROW,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'symbol-placement': 'line',
                'symbol-spacing': 80,
                'text-field': '\u25B6',
                'text-size': 12,
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
                'text-keep-upright': false
            },
            paint: {
                'text-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'text-halo-color': options.outline || '#0b1a2d',
                'text-halo-width': 1.4
            }
        });
    }

    if (options.animated) {
        startAnimation(map);
    } else {
        stopAnimation();
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
    [LAYER_ARROW, LAYER_LINE, LAYER_LINE_BG].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    if (animState.map === map) {
        stopAnimation();
    }
}

export function setVisible(map, visible) {
    [LAYER_LINE_BG, LAYER_LINE, LAYER_ARROW].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

function startAnimation(map) {
    if (animState.enabled && animState.map === map) {
        return;
    }
    animState.enabled = true;
    animState.map = map;
    animState.lastTick = 0;
    animState.frame = 0;
    tick();
}

function stopAnimation() {
    animState.enabled = false;
    if (animState.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(animState.rafId);
    }
    animState.rafId = null;
    animState.map = null;
}

function tick(now) {
    if (!animState.enabled || !animState.map) {
        return;
    }
    const t = typeof now === 'number' ? now : (Date.now ? Date.now() : 0);
    if (t - animState.lastTick > ANT_FRAME_MS) {
        animState.lastTick = t;
        animState.frame = (animState.frame + 1) % ANT_DASH.length;
        try {
            if (animState.map.getLayer(LAYER_LINE)) {
                animState.map.setPaintProperty(
                    LAYER_LINE,
                    'line-dasharray',
                    rotateDashArray(ANT_DASH, animState.frame)
                );
            }
        } catch (_err) {
            stopAnimation();
            return;
        }
    }
    if (typeof requestAnimationFrame === 'function') {
        animState.rafId = requestAnimationFrame(tick);
    } else {
        animState.rafId = setTimeout(tick, ANT_FRAME_MS);
    }
}

function rotateDashArray(arr, n) {
    const out = arr.slice();
    for (let i = 0; i < n; i++) {
        out.push(out.shift());
    }
    return out;
}
