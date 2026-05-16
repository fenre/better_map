/*
 * Motion utilities — shared accessibility + scheduling primitives for
 * every animated layer (paths, markers, extrusion, camera).
 *
 * v1.5.1 introduces five concurrent animation systems on the showcase
 * dashboards:
 *
 *   - Traveling comets along arcs                 (paths.js)
 *   - Marching dashes on glow + line              (paths.js)
 *   - Severity-bound pulse rate on markers        (markers.js)
 *   - Breathing extrusion height                  (extrusion.js, hexbin.js)
 *   - Camera auto-orbit                           (mapBuilder.js)
 *
 * All five MUST respect the user's OS-level reduced-motion preference.
 * The WCAG 2.1 Success Criterion 2.3.3 ("Animation from Interactions")
 * also recommends that non-essential motion respect this signal — and
 * Better Map's animations are all non-essential decoration on top of
 * static data the user can read either way.
 *
 * `prefersReducedMotion()` is the single source of truth. Cached on
 * first call because `matchMedia` is cheap but allocating a
 * MediaQueryList on every RAF tick (8000 times per minute at 60fps)
 * shows up in flame-charts on lower-end laptops.
 */

let _cachedPrefers = null;
let _mqList = null;

/*
 * v1.5.2 — master "Pause all motion" toggle (BM-CT-1 contract).
 *
 * Independent of `prefers-reduced-motion`. The OS preference is an
 * accessibility signal ("I get sick from motion, please respect that");
 * the master pause is a user-focus signal ("I want a clean screenshot",
 * "I want the projector to stop flickering during my Zoom share").
 *
 * Both reach the same code path via `shouldSuppressMotion()` so every
 * RAF loop only has to test one boolean.
 *
 * Listeners are invoked synchronously when the value flips, so the
 * control panel can re-render its toggle state without a poll.
 */
let _motionPaused = false;
const _motionPauseListeners = [];

/**
 * Returns true when the user has set their OS preference to "reduce
 * motion" (System Settings > Accessibility > Display > Reduce motion
 * on macOS; Settings > Ease of Access > Display > Show animations on
 * Windows; about:preferences#accessibility on Firefox; etc.). All
 * better_map RAF loops should bail out (or render a tasteful static
 * fallback) when this is true.
 *
 * The first call lazily registers a `change` listener on the
 * MediaQueryList so the result stays in sync if the user flips the
 * preference while the dashboard is open. SSR-safe: returns false
 * when `window.matchMedia` is unavailable.
 */
export function prefersReducedMotion() {
    if (_cachedPrefers !== null) {
        return _cachedPrefers;
    }
    if (typeof window === 'undefined' || !window.matchMedia) {
        _cachedPrefers = false;
        return _cachedPrefers;
    }
    try {
        _mqList = window.matchMedia('(prefers-reduced-motion: reduce)');
        _cachedPrefers = !!_mqList.matches;
        if (_mqList.addEventListener) {
            _mqList.addEventListener('change', function (evt) {
                _cachedPrefers = !!evt.matches;
            });
        } else if (_mqList.addListener) {
            // Safari < 14 fallback
            _mqList.addListener(function (evt) {
                _cachedPrefers = !!evt.matches;
            });
        }
    } catch (_e) {
        _cachedPrefers = false;
    }
    return _cachedPrefers;
}

/**
 * Schedule `fn` on the next animation frame, falling back to setTimeout
 * with a target ~30fps when requestAnimationFrame is unavailable
 * (e.g. background tabs).
 */
export function scheduleFrame(fn, fallbackMs) {
    if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(fn);
    }
    return setTimeout(fn, typeof fallbackMs === 'number' ? fallbackMs : 33);
}

/**
 * Cancel a token produced by scheduleFrame(). Works for both RAF and
 * setTimeout fallback because clearTimeout silently ignores RAF tokens
 * and cancelAnimationFrame silently ignores timeout tokens — neither
 * throws on a no-op cancel.
 */
export function cancelFrame(token) {
    if (token == null) return;
    if (typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(token); } catch (_e) { /* swallow */ }
    }
    try { clearTimeout(token); } catch (_e) { /* swallow */ }
}

/**
 * Master "pause all motion" setter. Returns the value that was actually
 * stored (always a boolean) so callers can echo it into their own UI
 * state without re-querying. Fires every listener registered via
 * `onMotionPauseChange()`.
 */
export function setMotionPaused(paused) {
    const next = !!paused;
    if (next === _motionPaused) {
        return _motionPaused;
    }
    _motionPaused = next;
    for (let i = 0; i < _motionPauseListeners.length; i++) {
        try {
            _motionPauseListeners[i](_motionPaused);
        } catch (_e) {
            // Swallow — one bad listener cannot disable the global toggle.
        }
    }
    return _motionPaused;
}

/**
 * Read the current master pause state.
 */
export function isMotionPaused() {
    return _motionPaused;
}

/**
 * Subscribe to master-pause changes. Returns an unsubscribe function.
 * Used by `controlPanel.js` to keep the master toggle in sync when
 * other parts of the code call setMotionPaused() programmatically
 * (e.g. the master "Reset all" button restores the dashboard default
 * which may flip it back to false).
 */
export function onMotionPauseChange(listener) {
    if (typeof listener !== 'function') {
        return function noop() {};
    }
    _motionPauseListeners.push(listener);
    return function unsubscribe() {
        const idx = _motionPauseListeners.indexOf(listener);
        if (idx >= 0) {
            _motionPauseListeners.splice(idx, 1);
        }
    };
}

/**
 * The single test every Better Map RAF loop should perform at the top
 * of its tick function. Returns true when the loop should bail out
 * (rendering a tasteful static fallback if appropriate, then returning
 * without scheduling the next frame).
 *
 * Replaces the v1.5.1 pattern of calling `prefersReducedMotion()`
 * directly — that still works but skips the master pause. New animation
 * authors MUST use `shouldSuppressMotion()`.
 */
export function shouldSuppressMotion() {
    return _motionPaused || prefersReducedMotion();
}

/**
 * Return monotonic time in milliseconds. Prefers performance.now() for
 * sub-millisecond resolution and immunity to wall-clock jumps; falls
 * back to Date.now() in environments without it.
 */
export function nowMs() {
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    return Date.now ? Date.now() : new Date().getTime();
}
