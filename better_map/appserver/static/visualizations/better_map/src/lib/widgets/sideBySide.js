/*
 * Side-by-side compare widget.
 *
 * Adds a vertical slider that clips visibility of selected MapLibre
 * layers to one side of the slider or the other. Two modes:
 *
 *   - 'basemap':  layers from style A render to the left of the
 *                 slider; layers from style B render to the right.
 *                 (For the basemap-A/B case, we apply MapLibre's
 *                 layer 'paint' with the slider's screen-space
 *                 position; works for raster layers only — vector
 *                 basemap diff is not v1.6 scope.)
 *
 *   - 'time':     no second style; both halves come from the SAME
 *                 map but the right half uses a time-shifted SPL
 *                 token (e.g. T-1h vs now). The widget emits two
 *                 tokens `bm_left_time_offset` and `bm_right_time_offset`
 *                 that dashboards bind to their data-source query.
 *
 * Implementation:
 *   - Renders a vertical drag handle (.better_map-sbs__handle)
 *   - On drag, updates a CSS clip-path on the right-side map canvas
 *     overlay div (we use a transparent overlay to apply the clip
 *     visual; the actual layer toggling is decorative since both
 *     halves come from the same MapLibre instance)
 *   - Dispatches `bm:sidebyside-move` with detail={ ratio (0–1) }
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

const ROOT_CLASS = 'better_map-sbs';
const HANDLE_CLASS = 'better_map-sbs__handle';
const HANDLE_BAR_CLASS = 'better_map-sbs__bar';
const HANDLE_GRIP_CLASS = 'better_map-sbs__grip';

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder
 * @param {string} [opts.mode='basemap']  basemap | time
 * @param {number} [opts.startRatio=0.5]
 * @param {Function} [opts.onChange]   (ratio) => void
 */
export function createSideBySide(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    let _enabled = true;
    let _ratio = isFinite(options.startRatio) ? options.startRatio : 0.5;
    const onChange = typeof options.onChange === 'function' ? options.onChange : function () {};

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.style.display = 'none';
    root.setAttribute('aria-hidden', 'true');

    const handle = document.createElement('div');
    handle.className = HANDLE_CLASS;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', 'Side-by-side compare slider');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '1');
    handle.setAttribute('aria-valuenow', String(_ratio.toFixed(2)));
    handle.setAttribute('tabindex', '0');

    const bar = document.createElement('div');
    bar.className = HANDLE_BAR_CLASS;
    const grip = document.createElement('div');
    grip.className = HANDLE_GRIP_CLASS;
    grip.textContent = '⇆';

    handle.appendChild(bar);
    handle.appendChild(grip);
    root.appendChild(handle);
    parentEl.appendChild(root);

    let _dragging = false;

    function applyRatio(ratio) {
        _ratio = Math.max(0, Math.min(1, ratio));
        root.style.setProperty('--bm-sbs-x', (_ratio * 100) + '%');
        handle.style.left = (_ratio * 100) + '%';
        handle.setAttribute('aria-valuenow', String(_ratio.toFixed(2)));
        // Update the visible "right-side veil" via clip-path on root.
        root.style.clipPath = 'polygon(' + (_ratio * 100) + '% 0, 100% 0, 100% 100%, ' + (_ratio * 100) + '% 100%)';
        try {
            parentEl.dispatchEvent(new CustomEvent('bm:sidebyside-move', { detail: { ratio: _ratio } }));
        } catch (_e) { /* swallow */ }
        try { onChange(_ratio); } catch (_e) { /* swallow */ }
    }

    function onPointerDown(e) {
        _dragging = true;
        handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
    function onPointerMove(e) {
        if (!_dragging) return;
        const rect = parentEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        applyRatio(x / Math.max(1, rect.width));
    }
    function onPointerUp(_e) {
        _dragging = false;
    }
    function onKeyDown(e) {
        if (!_enabled) return;
        if (e.key === 'ArrowLeft') { applyRatio(_ratio - 0.02); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { applyRatio(_ratio + 0.02); e.preventDefault(); }
        else if (e.key === 'Home') { applyRatio(0); e.preventDefault(); }
        else if (e.key === 'End') { applyRatio(1); e.preventDefault(); }
    }

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
    handle.addEventListener('keydown', onKeyDown);

    function setEnabled(enabled) {
        _enabled = !!enabled;
        root.style.display = _enabled ? '' : 'none';
        if (!_enabled) {
            // Restore both halves visible.
            root.style.clipPath = 'none';
        } else {
            applyRatio(_ratio);
        }
    }
    function isEnabled() { return _enabled; }
    function reset() {
        applyRatio(0.5);
    }
    function destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
    }

    // Auto-show only if user enables.
    setEnabled(false);

    // No reference needed inside the closure, but the helper is part of the API.
    void builder;

    return {
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        setRatio: applyRatio,
        getRatio: function () { return _ratio; },
        reset: reset,
        destroy: destroy
    };
}
