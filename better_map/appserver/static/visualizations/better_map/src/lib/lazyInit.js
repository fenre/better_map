/*
 * Lazy-init helpers.
 *
 * Splunk dashboards routinely render a dozen panels at once; instantiating
 * MapLibre on each of them on first paint blows through the browser's
 * WebGL context budget (typically 16) and slows the dashboard to a crawl.
 *
 * Two safety nets here:
 *
 *  1. waitForVisible(el) - resolves when the element first enters the
 *     viewport. Backed by IntersectionObserver. Falls back to a quick
 *     setTimeout for very old browsers (Splunk 10.2 ships modern Chrome,
 *     so this is mostly defensive).
 *
 *  2. reserveContext() / releaseContext() - tracks how many maps are
 *     currently live across the page. When the budget is exhausted the
 *     caller can react by showing a degraded preview instead of failing
 *     hard.
 */

const MAX_WEBGL_CONTEXTS_DEFAULT = 12;

const globalState = {
    active: 0,
    budget: MAX_WEBGL_CONTEXTS_DEFAULT
};

export function setContextBudget(n) {
    if (typeof n === 'number' && n > 0) {
        globalState.budget = Math.floor(n);
    }
}

export function reserveContext() {
    if (globalState.active >= globalState.budget) {
        return false;
    }
    globalState.active++;
    return true;
}

export function releaseContext() {
    if (globalState.active > 0) {
        globalState.active--;
    }
}

export function contextsLeft() {
    return Math.max(0, globalState.budget - globalState.active);
}

/**
 * Resolve when the element first enters the viewport, or immediately if
 * IntersectionObserver is unavailable. Returns a function that can be
 * called to cancel the watch early (e.g. when the visualization is
 * destroyed before becoming visible).
 *
 * @param {HTMLElement} el
 * @param {Function} cb - called once with no arguments when visible
 * @param {Object} [opts]
 * @param {number} [opts.rootMargin]
 * @param {number} [opts.threshold]
 */
export function waitForVisible(el, cb, opts) {
    if (!el || typeof cb !== 'function') {
        return function () {};
    }
    if (typeof IntersectionObserver !== 'function') {
        const handle = setTimeout(cb, 0);
        return function () { clearTimeout(handle); };
    }
    const options = opts || {};
    const observer = new IntersectionObserver(function (entries) {
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
                observer.disconnect();
                cb();
                return;
            }
        }
    }, {
        rootMargin: options.rootMargin || '256px',
        threshold: typeof options.threshold === 'number' ? options.threshold : 0.05
    });
    observer.observe(el);
    return function () { observer.disconnect(); };
}
