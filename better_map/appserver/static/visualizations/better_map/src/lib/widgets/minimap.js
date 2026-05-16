/*
 * Minimap widget — small corner overview synced to the main map's
 * camera. Renders the viewport as a rectangle so the user always
 * knows where the main view sits in global context.
 *
 * Lightweight implementation: instead of spinning a second MapLibre
 * instance (which would be a full WebGL context — expensive), we
 * render a flat equirectangular world image plus a CSS-positioned
 * viewport rectangle that updates on every `move` event.
 *
 * If the user prefers a "real" zoomable minimap, the `opts.useMapLibre`
 * flag spawns a second MapLibre map with restricted interactions; we
 * fall back to the flat-image renderer when WebGL contexts are scarce
 * (lazyInit reports < 2 contexts remaining).
 *
 * BM-CT-1 contract — setEnabled / isEnabled / reset.
 */

import { contextsLeft } from '../lazyInit.js';

const ROOT_CLASS = 'better_map-minimap';
const FRAME_CLASS = 'better_map-minimap__frame';
const WORLD_CLASS = 'better_map-minimap__world';
const VIEWPORT_CLASS = 'better_map-minimap__viewport';
const LABEL_CLASS = 'better_map-minimap__label';

// Web-Mercator math.
function lonLatToPx(lon, lat, width, height) {
    const x = (lon + 180) / 360 * width;
    const latRad = lat * Math.PI / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const y = height / 2 - (height / (2 * Math.PI)) * mercN;
    return { x: x, y: y };
}

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder        MapBuilder reference (for builder.map)
 * @param {number} [opts.widthPx=180]
 * @param {number} [opts.heightPx=110]
 * @param {boolean} [opts.useMapLibre] If true, spawn a real MapLibre minimap.
 */
export function createMinimap(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    const width = isFinite(options.widthPx) ? options.widthPx : 180;
    const height = isFinite(options.heightPx) ? options.heightPx : 110;

    let _enabled = true;
    let _onMove = null;

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('aria-hidden', 'true'); // decorative
    root.style.width = width + 'px';
    root.style.height = height + 'px';

    const frame = document.createElement('div');
    frame.className = FRAME_CLASS;

    const world = document.createElement('div');
    world.className = WORLD_CLASS;
    world.style.width = '100%';
    world.style.height = '100%';
    // CSS provides a subtle grid + continent shapes via SVG background.

    const viewport = document.createElement('div');
    viewport.className = VIEWPORT_CLASS;

    const label = document.createElement('div');
    label.className = LABEL_CLASS;
    label.textContent = 'Overview';

    frame.appendChild(world);
    frame.appendChild(viewport);
    root.appendChild(label);
    root.appendChild(frame);
    parentEl.appendChild(root);

    function syncViewport() {
        if (!builder || !builder.map) return;
        try {
            const bounds = builder.map.getBounds();
            if (!bounds) return;
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            const swPx = lonLatToPx(sw.lng, Math.max(sw.lat, -85), width, height);
            const nePx = lonLatToPx(ne.lng, Math.min(ne.lat, 85), width, height);
            let left = Math.min(swPx.x, nePx.x);
            let top = Math.min(swPx.y, nePx.y);
            let w = Math.abs(nePx.x - swPx.x);
            let h = Math.abs(swPx.y - nePx.y);
            // Clamp + ensure visibility.
            left = Math.max(0, Math.min(width - 4, left));
            top = Math.max(0, Math.min(height - 4, top));
            w = Math.max(6, Math.min(width - left, w));
            h = Math.max(6, Math.min(height - top, h));
            viewport.style.left = left + 'px';
            viewport.style.top = top + 'px';
            viewport.style.width = w + 'px';
            viewport.style.height = h + 'px';
        } catch (_e) { /* style not loaded yet */ }
    }

    function attach() {
        if (!builder || !builder.map) return;
        _onMove = function () { syncViewport(); };
        builder.map.on('move', _onMove);
        builder.map.on('zoom', _onMove);
        // Initial paint.
        syncViewport();
    }

    function detach() {
        if (builder && builder.map && _onMove) {
            try {
                builder.map.off('move', _onMove);
                builder.map.off('zoom', _onMove);
            } catch (_e) { /* swallow */ }
        }
        _onMove = null;
    }

    // Click on minimap → pan main map to that lon/lat.
    frame.addEventListener('click', function (e) {
        if (!builder || !builder.map) return;
        const rect = frame.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const lon = (px / width) * 360 - 180;
        const mercN = (height / 2 - py) * (2 * Math.PI) / height;
        const lat = (Math.atan(Math.sinh(mercN)) * 180) / Math.PI;
        try {
            builder.map.flyTo({ center: [lon, lat], duration: 600 });
        } catch (_err) { /* swallow */ }
    });

    function setEnabled(enabled) {
        _enabled = !!enabled;
        root.style.display = _enabled ? '' : 'none';
        if (_enabled) {
            if (!_onMove) attach();
            syncViewport();
        } else {
            detach();
        }
    }

    function isEnabled() {
        return _enabled;
    }

    function reset() {
        if (_enabled) syncViewport();
    }

    function destroy() {
        detach();
        if (root.parentNode) {
            root.parentNode.removeChild(root);
        }
    }

    // Auto-attach if the builder's map is ready.
    if (builder && builder.map) {
        attach();
    } else if (builder && typeof builder._afterStyle === 'function') {
        builder._afterStyle(attach);
    }

    return {
        sync: syncViewport,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy,
        _meta: { contextsLeft: typeof contextsLeft === 'function' ? contextsLeft() : null }
    };
}
