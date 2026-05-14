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

// Hook to force noopener / noreferrer on every <a target="_blank"> link,
// so popups can't reach back into the parent window via window.opener.
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
});

/**
 * Sanitise an untrusted popup string. Returns a safe HTML string (never
 * undefined). If the input is empty or not a string the result is an
 * empty string.
 */
export function sanitizePopup(html) {
    if (typeof html !== 'string' || !html) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ALLOWED_TAGS,
        ALLOWED_ATTR: ALLOWED_ATTR,
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'srcset', 'srcdoc'],
        KEEP_CONTENT: true,
        ALLOW_DATA_ATTR: false,
        IN_PLACE: false
    });
}

/**
 * Build a sanitised popup DocumentFragment from raw HTML. This avoids
 * setting `innerHTML` on caller-owned elements directly.
 */
export function buildPopupFragment(doc, html) {
    const safe = sanitizePopup(html);
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
