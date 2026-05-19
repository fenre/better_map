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

// ===================================================================
// v1.8.0 — banner stacking via pushBanner
//
// renderErrorBanner / clearErrorBanner stay single-slot DOM, but
// pushBanner manages a per-container envelope list and decides which
// envelope wins the slot. Priority: fatal > warning > info; ties
// broken by insertion order (first-pushed wins). When 2+ are active,
// a "+N more" badge appears. safeRun.js is the primary caller.
// ===================================================================

const SEVERITY_RANK = { fatal: 3, warning: 2, info: 1 };
const BADGE_CLASS = CLASS + '__badge';

// Slot indirection so __resetBannerState can swap atomically.
const _bannerStateSlot = { active: new WeakMap(), inserted: 0 };

function _entriesFor(el) {
    let list = _bannerStateSlot.active.get(el);
    if (!list) {
        list = [];
        _bannerStateSlot.active.set(el, list);
    }
    return list;
}

function _pickWinner(entries) {
    if (entries.length === 0) return null;
    return entries.slice().sort(function (a, b) {
        const ra = SEVERITY_RANK[a.severity] || 0;
        const rb = SEVERITY_RANK[b.severity] || 0;
        if (rb !== ra) return rb - ra;
        return a._inserted - b._inserted;
    })[0];
}

function _renderStack(el) {
    const entries = _entriesFor(el);
    const winner = _pickWinner(entries);
    if (!winner) {
        clearErrorBanner(el);
        return;
    }
    renderErrorBanner(el, {
        kind: winner.severity,
        message: winner.message,
        dismissible: winner.severity !== 'fatal'
    });
    const banner = el.querySelector('.' + CLASS);
    if (!banner) return;
    const oldBadge = banner.querySelector('.' + BADGE_CLASS);
    if (oldBadge) oldBadge.remove();
    if (entries.length > 1) {
        const badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        badge.textContent = '+' + (entries.length - 1) + ' more';
        badge.setAttribute(
            'aria-label',
            (entries.length - 1) + ' additional notice' + (entries.length - 1 === 1 ? '' : 's')
        );
        const close = banner.querySelector('.' + CLASS + '__close');
        if (close) {
            banner.insertBefore(badge, close);
        } else {
            banner.appendChild(badge);
        }
    }
}

export function pushBanner(el, envelope) {
    if (!el || !envelope || !envelope.scope) return;
    const entries = _entriesFor(el);
    const existingIdx = entries.findIndex(function (e) {
        return e.scope === envelope.scope;
    });
    const entry = Object.assign({}, envelope, { _inserted: _bannerStateSlot.inserted++ });
    if (existingIdx >= 0) {
        entries[existingIdx] = entry;
    } else {
        entries.push(entry);
    }
    _renderStack(el);
}

export function dismissBanner(el, scope) {
    if (!el) return;
    const entries = _entriesFor(el);
    if (scope == null) {
        entries.length = 0;
    } else {
        const idx = entries.findIndex(function (e) {
            return e.scope === scope;
        });
        if (idx >= 0) entries.splice(idx, 1);
    }
    _renderStack(el);
}

export function getActiveBanners(el) {
    if (!el) return [];
    return _entriesFor(el).slice();
}

export function __resetBannerState() {
    _bannerStateSlot.active = new WeakMap();
    _bannerStateSlot.inserted = 0;
}
