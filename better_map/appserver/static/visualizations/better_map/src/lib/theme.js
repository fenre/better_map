/*
 * Splunk theme awareness.
 *
 * Splunk dashboards switch between "light" and "dark" themes at runtime.
 * `SplunkVisualizationUtils.getCurrentTheme()` returns the current value
 * but does not emit change events, so we poll on a low-frequency
 * interval. As a secondary signal, we also listen to the OS-level
 * `prefers-color-scheme` media query - this gives sensible defaults when
 * Better Map is rendered outside Splunk (test harness, standalone embed).
 *
 * Subscribers receive `(nextTheme, prevTheme)`. When `applyToRoot()` is
 * called, the watcher mirrors the current theme onto the viz container
 * via the `is-theme-light` / `is-theme-dark` CSS hooks so the widget
 * stylesheet can adapt without each component re-reading the theme.
 */

const POLL_MS = 1000;
const ROOT_CLASS_LIGHT = 'is-theme-light';
const ROOT_CLASS_DARK = 'is-theme-dark';

export function createThemeWatcher(SplunkVisualizationUtils) {
    let currentTheme = readTheme(SplunkVisualizationUtils);
    const subs = new Set();
    let timer = null;
    let mediaQuery = null;
    let mediaListener = null;
    let attachedRoot = null;

    function notify(next, prev) {
        subs.forEach((cb) => {
            try {
                cb(next, prev);
            } catch (err) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[better_map] theme subscriber threw:', err);
                }
            }
        });
    }

    function tick() {
        const next = readTheme(SplunkVisualizationUtils);
        if (next !== currentTheme) {
            const prev = currentTheme;
            currentTheme = next;
            applyClass(attachedRoot, next);
            notify(next, prev);
        }
    }

    function bindMedia() {
        if (mediaQuery || typeof window === 'undefined' || !window.matchMedia) return;
        mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        mediaListener = function () { tick(); };
        // Both syntaxes for backwards-compat with older Safari.
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', mediaListener);
        } else if (mediaQuery.addListener) {
            mediaQuery.addListener(mediaListener);
        }
    }

    function unbindMedia() {
        if (!mediaQuery || !mediaListener) return;
        if (mediaQuery.removeEventListener) {
            mediaQuery.removeEventListener('change', mediaListener);
        } else if (mediaQuery.removeListener) {
            mediaQuery.removeListener(mediaListener);
        }
        mediaQuery = null;
        mediaListener = null;
    }

    return {
        get current() {
            return currentTheme;
        },
        subscribe(cb) {
            subs.add(cb);
            if (!timer) {
                timer = setInterval(tick, POLL_MS);
                bindMedia();
            }
            return function unsubscribe() {
                subs.delete(cb);
                if (subs.size === 0) {
                    if (timer) { clearInterval(timer); timer = null; }
                    unbindMedia();
                }
            };
        },
        /**
         * Mirror the current theme onto an element via the
         * `is-theme-light` / `is-theme-dark` CSS hooks. Idempotent.
         */
        applyToRoot(el) {
            attachedRoot = el || null;
            applyClass(attachedRoot, currentTheme);
        },
        destroy() {
            subs.clear();
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            unbindMedia();
            applyClass(attachedRoot, null);
            attachedRoot = null;
        }
    };
}

function applyClass(el, theme) {
    if (!el || !el.classList) return;
    el.classList.remove(ROOT_CLASS_LIGHT);
    el.classList.remove(ROOT_CLASS_DARK);
    if (theme === 'light') el.classList.add(ROOT_CLASS_LIGHT);
    else if (theme === 'dark') el.classList.add(ROOT_CLASS_DARK);
}

function readTheme(SplunkVisualizationUtils) {
    try {
        if (
            SplunkVisualizationUtils &&
            typeof SplunkVisualizationUtils.getCurrentTheme === 'function'
        ) {
            const t = SplunkVisualizationUtils.getCurrentTheme();
            if (t === 'light' || t === 'dark') return t;
        }
    } catch (_err) {
        /* fall through */
    }
    // Fall back to the OS preference when Splunk isn't around.
    try {
        if (typeof window !== 'undefined' && window.matchMedia) {
            if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        }
    } catch (_err) {
        /* ignore */
    }
    return 'dark';
}
