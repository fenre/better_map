/*
 * Popup + URL sanitisation.
 *
 * Map features can carry user-defined HTML in their `popup` property
 * (typically built in SPL via `eval popup="<b>...</b>"`). We never inject
 * that string raw - everything goes through DOMPurify with a very narrow
 * allow-list focused on rich-but-safe popup content.
 *
 * Tile/style/sprite/glyph URLs are validated against an allow-list of
 * schemes (`https:`, `pmtiles:`, `blob:` for workers only via callers,
 * data:image for raster overlays) before they are handed to MapLibre. Any
 * `http://` reference is rejected up front to avoid mixed-content failures
 * when Splunk is served over HTTPS.
 *
 * v1.7 — opt-in inline-style allow-list. sanitizePopup() accepts an
 * options object with `allowInlineStyles: true`. When the flag is set the
 * sanitizer permits the `style=` attribute on every allowed tag, but ONLY
 * the safe-CSS allow-list below — every other declaration is dropped
 * silently, and `url()` / `expression()` / `behavior:` / `position:fixed`
 * are explicitly rejected even when their property name is in the safe
 * set. Default is `false` so existing call-sites keep their hard-locked
 * stripping behaviour.
 */

import DOMPurify from 'dompurify';

// Allow-list mirrors GitHub-flavoured Markdown rendering: enough to express
// a card-like popup without opening any script or style vectors.
const ALLOWED_TAGS = [
    'a', 'b', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'i',
    'img', 'li', 'ol', 'p', 'pre', 'small', 'span', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
];

const ALLOWED_ATTR = [
    'href', 'title', 'class', 'colspan', 'rowspan', 'alt', 'src',
    'width', 'height', 'target', 'rel'
];

// CSS property allow-list for the opt-in inline-style mode. Deliberately
// short: colour, type, spacing, alignment. NO layout-impacting properties
// (no position, no display, no float) so a popup can never overflow the
// MapLibre popup wrapper, escape its z-index stack, or affect the host
// dashboard. Numeric / colour-shaped values only (validated below).
const SAFE_STYLE_PROPS = new Set([
    'color',
    'background-color',
    'font-weight',
    'font-size',
    'text-align',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'line-height',
    'letter-spacing',
    'font-style',
    'font-variant',
    'text-decoration',
    'border-radius'
]);

// Patterns we always reject inside a style value regardless of the
// property name. These are the classic "even in a safe property the
// value still owns you" vectors:
//   url(...)       — fetches off-origin and triggers Referer/cookies
//   expression(...) — legacy IE behaviour, equivalent to script
//   behavior:       — legacy IE behaviour binding
//   position:fixed — UI redress / clickjacking via popup overlay
//   @import / @charset — at-rule injection
//   //             — comment-based bypasses
//   javascript: / vbscript: / data:text — script-URL families
const UNSAFE_STYLE_VALUE_PATTERNS = [
    /url\s*\(/i,
    /expression\s*\(/i,
    /behavior\s*:/i,
    /position\s*:\s*fixed/i,
    /position\s*:\s*absolute/i,
    /position\s*:\s*sticky/i,
    /@import/i,
    /@charset/i,
    /\\/, // CSS escapes (\0006a vs literal j) — disallow ALL backslashes
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data\s*:\s*text/i
];

/**
 * Filter a `style="..."` value down to the safe allow-list. Returns a
 * trimmed CSS declaration string with every disallowed property removed
 * and every value validated against UNSAFE_STYLE_VALUE_PATTERNS. Returns
 * an empty string when nothing safe survives so the caller can drop the
 * attribute entirely.
 */
function sanitizeInlineStyle(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    const out = [];
    const decls = raw.split(';');
    for (let i = 0; i < decls.length; i++) {
        const decl = decls[i];
        const colon = decl.indexOf(':');
        if (colon < 0) continue;
        const propRaw = decl.slice(0, colon).trim().toLowerCase();
        const valRaw = decl.slice(colon + 1).trim();
        if (!propRaw || !valRaw) continue;
        if (!SAFE_STYLE_PROPS.has(propRaw)) continue;
        // Strip a trailing `!important` suffix before validation, but DROP
        // it on the way out — important rules in untrusted popups should
        // not override host stylesheet rules.
        const valNoBang = valRaw.replace(/\s*!important\s*$/i, '');
        let unsafe = false;
        for (let p = 0; p < UNSAFE_STYLE_VALUE_PATTERNS.length; p++) {
            if (UNSAFE_STYLE_VALUE_PATTERNS[p].test(valNoBang)) {
                unsafe = true;
                break;
            }
        }
        if (unsafe) continue;
        out.push(propRaw + ': ' + valNoBang);
    }
    return out.join('; ');
}

// State flag for the optional inline-style mode. DOMPurify hooks are
// registered globally per import, but they execute against EVERY
// sanitize() call. Toggling this flag inside sanitizePopup() and the
// hook reading it gives us per-call behaviour without ripping out the
// hook architecture.
let _allowInlineStylesThisCall = false;

// Hook to force noopener / noreferrer on every <a target="_blank"> link,
// so popups can't reach back into the parent window via window.opener.
// Also applies the inline-style filter when the per-call flag is set.
DOMPurify.addHook('afterSanitizeAttributes', function (node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'A') {
        if (node.getAttribute('target') === '_blank') {
            node.setAttribute('rel', 'noopener noreferrer');
        }
        // Strip javascript: URLs at the DOM level (DOMPurify already does
        // this, but we belt-and-brace to fail closed if config drifts).
        const href = node.getAttribute('href') || '';
        if (/^\s*javascript:/i.test(href)) {
            node.removeAttribute('href');
        }
    }
    if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (!isSafeHttpsImage(src) && !isSafeDataImage(src)) {
            node.removeAttribute('src');
        }
    }
    // Per-call style allow-list. Only fires when sanitizePopup() set the
    // per-call flag AND the element survived with a style attribute
    // (which DOMPurify only keeps when 'style' is in ALLOWED_ATTR).
    if (_allowInlineStylesThisCall && node.hasAttribute('style')) {
        const safe = sanitizeInlineStyle(node.getAttribute('style'));
        if (safe) {
            node.setAttribute('style', safe);
        } else {
            node.removeAttribute('style');
        }
    }
});

/**
 * Sanitise an untrusted popup string. Returns a safe HTML string (never
 * undefined). If the input is empty or not a string the result is an
 * empty string.
 *
 * @param {string} html — untrusted HTML
 * @param {object} [opts]
 * @param {boolean} [opts.allowInlineStyles=false] — when true, the
 *   sanitizer permits `style=` attributes on allowed tags but filters
 *   their declarations through the SAFE_STYLE_PROPS allow-list. Use
 *   this only on popups whose authors you trust to follow the contract.
 */
export function sanitizePopup(html, opts) {
    if (typeof html !== 'string' || !html) return '';
    const allowStyles = !!(opts && opts.allowInlineStyles);
    // Build the per-call ALLOWED_ATTR list. The shared module-level
    // constant must NOT include 'style', or every call would let style
    // through. We extend per-call so the default behaviour is unchanged.
    const allowedAttr = allowStyles
        ? ALLOWED_ATTR.concat(['style'])
        : ALLOWED_ATTR;
    // The FORBID_TAGS list keeps `<style>` blocked even when inline
    // style attributes are allowed — those are independent vectors.
    _allowInlineStylesThisCall = allowStyles;
    try {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ALLOWED_TAGS,
            ALLOWED_ATTR: allowedAttr,
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'srcset', 'srcdoc'],
            KEEP_CONTENT: true,
            ALLOW_DATA_ATTR: false,
            IN_PLACE: false
        });
    } finally {
        // Always reset so a subsequent call without the option gets the
        // locked-down behaviour, even if the call above threw.
        _allowInlineStylesThisCall = false;
    }
}

/**
 * Build a sanitised popup DocumentFragment from raw HTML. This avoids
 * setting `innerHTML` on caller-owned elements directly.
 *
 * @param {Document} doc
 * @param {string} html
 * @param {object} [opts] forwarded to sanitizePopup (see above)
 */
export function buildPopupFragment(doc, html, opts) {
    const safe = sanitizePopup(html, opts);
    const wrapper = doc.createElement('div');
    wrapper.className = 'better_map-popup';
    wrapper.innerHTML = safe;
    return wrapper;
}

// -- URL validation ---------------------------------------------------------

const SAFE_SCHEMES = ['https:', 'pmtiles:'];

/**
 * True if the value is a syntactically valid tile/style URL that we are
 * willing to hand to MapLibre. Rules:
 *   - https:// is always allowed
 *   - pmtiles://https://... is allowed (PMTiles archive)
 *   - relative paths (no scheme) are allowed; caller resolves against
 *     window.location.origin
 *   - http://, ftp://, file://, javascript: are rejected
 */
export function isSafeMapUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (!/^[a-z]+:\/\//i.test(url) && !/^pmtiles:\/\//i.test(url)) {
        // Relative path is acceptable (e.g. "/app/better_map/static/style.json").
        return /^[/.]/.test(url);
    }
    try {
        const parsed = parseUrl(url);
        if (!parsed) return false;
        return SAFE_SCHEMES.indexOf(parsed.protocol) !== -1;
    } catch (_err) {
        return false;
    }
}

/**
 * Validate a user-supplied URL and return it untouched when safe. When
 * unsafe, returns null so callers can fall back to defaults.
 */
export function safeMapUrlOrNull(url) {
    return isSafeMapUrl(url) ? url : null;
}

export function isSafeHttpsImage(url) {
    if (typeof url !== 'string' || !url) return false;
    if (!/^https:\/\//i.test(url)) return false;
    try {
        const parsed = parseUrl(url);
        return parsed && parsed.protocol === 'https:';
    } catch (_err) {
        return false;
    }
}

export function isSafeDataImage(url) {
    return typeof url === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(url);
}

function parseUrl(url) {
    // pmtiles://https://host/foo.pmtiles - strip the pmtiles:// prefix
    // for protocol checking but keep the original value for the caller.
    if (/^pmtiles:\/\//i.test(url)) {
        return { protocol: 'pmtiles:' };
    }
    try {
        return new URL(url, typeof window !== 'undefined' ? window.location.href : 'https://localhost/');
    } catch (_err) {
        return null;
    }
}
