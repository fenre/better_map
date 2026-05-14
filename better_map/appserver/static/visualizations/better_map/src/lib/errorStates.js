/*
 * Tiered error / status surface.
 *
 * Better Map renders one of four tiers depending on what went wrong:
 *
 *   - fatal:  WebGL missing / context lost / fatal style error. No map.
 *   - warning: data parsing failed but the previous good data is still
 *              shown beneath the banner.
 *   - info:    user feedback (e.g. "no rows match the current filter").
 *   - dismissed: a previous banner the user clicked away.
 *
 * The banner is positioned in the top-left corner so it stacks under the
 * layer control and the scrubber without obscuring map controls.
 */

const CLASS = 'better_map-error';
const KIND_CLASS = {
    fatal: 'better_map-error--fatal',
    warning: 'better_map-error--warning',
    info: 'better_map-error--info'
};

export function isWebGLAvailable() {
    try {
        const canvas = document.createElement('canvas');
        return !!(
            window.WebGLRenderingContext &&
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
        );
    } catch (_err) {
        return false;
    }
}

/**
 * Render a status banner. Accepts either a plain message string (legacy
 * call signature, treated as `fatal`) or an options object
 * `{ kind: 'warning', message: '...', dismissible: true }`.
 */
export function renderErrorBanner(el, opts) {
    if (!el) return null;
    const options = typeof opts === 'string' ? { kind: 'fatal', message: opts } : (opts || {});
    const kind = options.kind || 'fatal';

    let banner = el.querySelector('.' + CLASS);
    if (!banner) {
        banner = document.createElement('div');
        banner.className = CLASS;
        el.appendChild(banner);
    }

    // Reset all kind classes.
    Object.keys(KIND_CLASS).forEach(function (k) {
        banner.classList.remove(KIND_CLASS[k]);
    });
    if (KIND_CLASS[kind]) {
        banner.classList.add(KIND_CLASS[kind]);
    }
    banner.dataset.kind = kind;

    banner.innerHTML = '';

    const text = document.createElement('span');
    text.className = CLASS + '__text';
    text.textContent = String(options.message || '');
    banner.appendChild(text);

    if (options.dismissible !== false && kind !== 'fatal') {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = CLASS + '__close';
        close.setAttribute('aria-label', 'Dismiss notice');
        close.textContent = '\u2715';
        close.addEventListener('click', function () {
            clearErrorBanner(el);
        });
        banner.appendChild(close);
    }

    banner.style.display = '';
    banner.setAttribute('role', kind === 'fatal' ? 'alert' : 'status');
    banner.setAttribute('aria-live', kind === 'fatal' ? 'assertive' : 'polite');
    return banner;
}

export function clearErrorBanner(el) {
    if (!el) return;
    const banner = el.querySelector('.' + CLASS);
    if (banner) {
        banner.style.display = 'none';
        banner.textContent = '';
    }
}
