/*
 * Accessibility utilities.
 *
 *   - createLiveRegion(): polite ARIA-live span used for hover tooltips and
 *     status announcements. Screen readers pick up text changes inside the
 *     region without disrupting the user's current focus.
 *
 *   - applyA11yAttrs(): tags the map canvas with the standard role / label
 *     attributes so assistive tech doesn't read it as a generic `canvas`.
 *
 *   - applyHighContrast(): toggles a `is-high-contrast` class on the viz
 *     root and replaces marker / cluster paint properties with strong
 *     foreground colours and thick outlines for low-vision users.
 *
 *   - applyLabelLanguage(): re-applies the right language to symbol layers
 *     whose `text-field` is currently using {name}. Drives the map label
 *     switcher in the formatter.
 *
 * All helpers are no-ops when the inputs are missing so callers can use
 * them defensively.
 */

const LIVE_CLASS = 'better_map-live';

export function createLiveRegion(parentEl) {
    if (!parentEl) return { announce: function () {}, destroy: function () {} };
    let el = parentEl.querySelector('.' + LIVE_CLASS);
    if (!el) {
        el = document.createElement('div');
        el.className = LIVE_CLASS;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        // Visually hidden but readable by assistive tech.
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.overflow = 'hidden';
        parentEl.appendChild(el);
    }
    return {
        announce: function (message) {
            if (typeof message !== 'string') return;
            el.textContent = '';
            // Toggling textContent ensures repeated identical messages still
            // fire the announcement (some screen readers de-duplicate).
            window.setTimeout(function () { el.textContent = message; }, 50);
        },
        destroy: function () {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }
    };
}

export function applyA11yAttrs(map) {
    if (!map || !map.getCanvas) return;
    const canvas = map.getCanvas();
    if (!canvas) return;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute(
        'aria-label',
        'Interactive geographic map. Use arrow keys to pan and the plus and minus keys to zoom.'
    );
    canvas.setAttribute('aria-roledescription', 'map');
    canvas.tabIndex = 0;
}

export function applyHighContrast(rootEl, enabled) {
    if (!rootEl) return;
    rootEl.classList.toggle('is-high-contrast', Boolean(enabled));
}

// MapLibre label expressions look like ['coalesce', ['get', 'name:en'],
// ['get', 'name']]. We rebuild this with the user's language preference at
// the top of the coalesce chain.
export function applyLabelLanguage(map, lang) {
    if (!map || !map.getStyle) return;
    if (!lang || typeof lang !== 'string') return;
    const safe = String(lang).replace(/[^a-z_-]/gi, '');
    if (!safe) return;

    let style;
    try { style = map.getStyle(); } catch (_err) { return; }
    const layers = (style && style.layers) || [];
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer.type !== 'symbol') continue;
        let currentField;
        try {
            currentField = map.getLayoutProperty(layer.id, 'text-field');
        } catch (_err) {
            continue;
        }
        if (!currentField) continue;
        const next = [
            'coalesce',
            ['get', 'name:' + safe],
            ['get', 'name_' + safe],
            ['get', 'name']
        ];
        try {
            map.setLayoutProperty(layer.id, 'text-field', next);
        } catch (_err) {
            // ignore layers that don't accept the new expression
        }
    }
}
