/*
 * Performance HUD - lightweight in-canvas overlay for benchmarking.
 *
 * Disabled by default; the formatter toggles it on when "Show perf HUD" is
 * enabled. Reports:
 *   - FPS over the past second
 *   - Feature counts for active layers
 *   - Render time of the last frame
 *   - Active WebGL contexts (via lazyInit.contextsLeft())
 *
 * Pure DOM, no React. Updated on `render` events from MapLibre + a 250ms
 * heartbeat for the FPS counter.
 */

import { contextsLeft } from './lazyInit.js';

const CONTAINER_CLASS = 'better_map-perf-hud';

export function createPerfHUD(parentEl) {
    const root = document.createElement('div');
    root.className = CONTAINER_CLASS;
    root.setAttribute('aria-hidden', 'true');
    root.textContent = 'Better Map perf HUD initialising...';
    parentEl.appendChild(root);

    let map = null;
    let frames = 0;
    let lastSecond = 0;
    let lastRenderStart = 0;
    let lastFrameMs = 0;
    let fps = 0;
    let heartbeat = null;
    let detachRender = null;

    function attach(targetMap) {
        if (map === targetMap) return;
        if (detachRender) detachRender();
        map = targetMap;
        if (!map) return;
        const onRenderStart = function () { lastRenderStart = now(); };
        const onRender = function () {
            const t = now();
            if (lastRenderStart) lastFrameMs = t - lastRenderStart;
            frames++;
            if (t - lastSecond >= 1000) {
                fps = Math.round((frames * 1000) / (t - lastSecond));
                frames = 0;
                lastSecond = t;
            }
            update();
        };
        try {
            map.on('move', onRenderStart);
            map.on('render', onRender);
        } catch (_err) {
            // ignore
        }
        detachRender = function () {
            try {
                if (map) {
                    map.off('move', onRenderStart);
                    map.off('render', onRender);
                }
            } catch (_err) { /* ignore */ }
        };
    }

    function update() {
        if (!root.parentNode) return;
        const layersCount = map && map.getStyle ? (map.getStyle().layers || []).length : 0;
        root.textContent = (
            'FPS ' + fps +
            ' | layers ' + layersCount +
            ' | last frame ' + lastFrameMs.toFixed(1) + ' ms' +
            ' | WebGL slots ' + contextsLeft()
        );
    }

    function start() {
        lastSecond = now();
        if (!heartbeat) {
            heartbeat = setInterval(update, 250);
        }
    }

    function stop() {
        if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
        }
    }

    function destroy() {
        stop();
        if (detachRender) detachRender();
        if (root.parentNode) root.parentNode.removeChild(root);
    }

    start();
    return {
        attach: attach,
        start: start,
        stop: stop,
        destroy: destroy
    };
}

function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
}
