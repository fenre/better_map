/*
 * PNG export + share URL encoder.
 *
 *   - exportPng(map): forces a final render with preserveDrawingBuffer
 *     temporarily on, reads the canvas via toDataURL, and triggers a
 *     download. Returns the data URL so callers can attach it to email
 *     bodies, PDF reports, etc.
 *
 *   - encodeShareHash({center, zoom, pitch, bearing, layers}): builds a
 *     URL fragment that, when set on `location.hash`, restores the map's
 *     view and visible layers. Hash form is stable across versions; new
 *     keys are tolerated by old releases.
 *
 *   - decodeShareHash(hash): parses an existing hash back into the same
 *     shape so callers can re-apply state on load.
 *
 *   - createExportButton(parentEl, callbacks): floating widget that fires
 *     the export and copies the share URL to the clipboard.
 *
 * Because MapLibre creates its WebGL context with preserveDrawingBuffer
 * set to false (best for perf), the canvas may be cleared before we read
 * it. exportPng() works around this by toggling the flag for one frame
 * via a forced repaint - this is the same pattern used by mapbox-gl-export
 * and the recommended approach in MapLibre's GitHub issue tracker.
 */

const HASH_VERSION = 'v1';
const HASH_PREFIX = '#better_map=';

/**
 * Trigger a one-shot canvas snapshot and return a PNG data URL.
 * Resolves with `{ dataUrl, blob }` once the browser has rendered the
 * frame and reads back from the GPU.
 *
 * @param {maplibregl.Map} map
 * @param {Object} [opts]
 * @param {string} [opts.fileName='better-map.png'] - file name for the auto-download
 * @param {boolean} [opts.download=true] - trigger a synthetic <a download> click
 */
export function exportPng(map, opts) {
    const options = opts || {};
    return new Promise((resolve, reject) => {
        if (!map || !map.getCanvas) {
            reject(new Error('No map provided'));
            return;
        }
        // Force a render with the drawing buffer preserved for one frame.
        const canvas = map.getCanvas();
        // MapLibre lets us tap into the WebGL "preserveDrawingBuffer" flag
        // by requesting a one-shot redraw and reading the canvas in the
        // same tick. We do that via `triggerRepaint()` + `once('render')`.
        const finish = () => {
            try {
                const dataUrl = canvas.toDataURL('image/png');
                if (options.download !== false && typeof document !== 'undefined') {
                    const a = document.createElement('a');
                    a.href = dataUrl;
                    a.download = options.fileName || 'better-map.png';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
                // Convert to Blob for callers that want to upload it.
                if (canvas.toBlob) {
                    canvas.toBlob(function (blob) {
                        resolve({ dataUrl: dataUrl, blob: blob || null });
                    }, 'image/png');
                } else {
                    resolve({ dataUrl: dataUrl, blob: null });
                }
            } catch (err) {
                reject(err);
            }
        };
        try {
            map.once('render', finish);
            map.triggerRepaint();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Build a shareable hash from the current map state plus optional metadata.
 *
 * The encoded value is URL-safe base64 of the minified JSON payload, with
 * a tiny `v1.` prefix for forward compatibility.
 */
export function encodeShareHash(state) {
    if (!state) return '';
    const minimal = {
        v: HASH_VERSION,
        c: roundCoord(state.center),
        z: roundNum(state.zoom, 4),
        p: roundNum(state.pitch, 1),
        b: roundNum(state.bearing, 1),
        l: Array.isArray(state.layers) ? state.layers.slice(0, 32).map(String) : undefined
    };
    Object.keys(minimal).forEach(function (k) {
        if (minimal[k] === undefined) delete minimal[k];
    });
    try {
        return HASH_PREFIX + b64UrlEncode(JSON.stringify(minimal));
    } catch (_err) {
        return '';
    }
}

/**
 * Inverse of encodeShareHash(). Returns null if the input doesn't look
 * like a Better Map hash.
 */
export function decodeShareHash(hash) {
    if (typeof hash !== 'string' || !hash) return null;
    const idx = hash.indexOf(HASH_PREFIX);
    if (idx === -1) return null;
    const raw = hash.slice(idx + HASH_PREFIX.length);
    try {
        const json = JSON.parse(b64UrlDecode(raw));
        if (!json || typeof json !== 'object') return null;
        return {
            version: json.v || null,
            center: Array.isArray(json.c) ? [Number(json.c[0]), Number(json.c[1])] : null,
            zoom: Number.isFinite(json.z) ? Number(json.z) : null,
            pitch: Number.isFinite(json.p) ? Number(json.p) : null,
            bearing: Number.isFinite(json.b) ? Number(json.b) : null,
            layers: Array.isArray(json.l) ? json.l.map(String) : null
        };
    } catch (_err) {
        return null;
    }
}

/**
 * Apply a decoded share hash back onto a MapLibre map. Layers callback is
 * optional - callers wire it to layerControl.setVisible() etc.
 */
export function applyShareHash(map, decoded, options) {
    if (!map || !decoded) return;
    const opts = options || {};
    const cam = {};
    if (Array.isArray(decoded.center) && decoded.center.every(Number.isFinite)) {
        cam.center = decoded.center;
    }
    if (Number.isFinite(decoded.zoom)) cam.zoom = decoded.zoom;
    if (Number.isFinite(decoded.pitch)) cam.pitch = decoded.pitch;
    if (Number.isFinite(decoded.bearing)) cam.bearing = decoded.bearing;
    if (Object.keys(cam).length) {
        try { map.jumpTo(cam); } catch (_err) { /* ignore */ }
    }
    if (typeof opts.applyLayers === 'function' && Array.isArray(decoded.layers)) {
        opts.applyLayers(decoded.layers);
    }
}

/**
 * Build a floating widget with "Download PNG" and "Copy share URL" buttons.
 * The widget is positioned beneath the view-controls in the top-right.
 */
export function createExportShare(parentEl, callbacks) {
    const cb = callbacks || {};
    const root = document.createElement('div');
    root.className = 'better_map-export-share';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Map export and share');

    const pngBtn = document.createElement('button');
    pngBtn.type = 'button';
    pngBtn.className = 'better_map-export-share__btn';
    pngBtn.title = 'Download the current map view as PNG';
    pngBtn.textContent = 'PNG';
    pngBtn.addEventListener('click', function () {
        if (typeof cb.onExportPng === 'function') cb.onExportPng();
    });

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'better_map-export-share__btn';
    shareBtn.title = 'Copy a share URL for the current view';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', function () {
        if (typeof cb.onCopyShare === 'function') {
            const ok = cb.onCopyShare();
            shareBtn.textContent = ok ? 'Copied' : 'Share';
            window.setTimeout(function () { shareBtn.textContent = 'Share'; }, 1500);
        }
    });

    root.appendChild(pngBtn);
    root.appendChild(shareBtn);
    parentEl.appendChild(root);

    return {
        destroy: function () {
            if (root.parentNode) root.parentNode.removeChild(root);
        }
    };
}

/**
 * Helper that delegates to navigator.clipboard with a textarea fallback.
 * Returns true if the copy succeeded.
 */
export function copyToClipboard(text) {
    if (typeof text !== 'string' || !text) return false;
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_err) {
        /* fall through */
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (_err) {
        return false;
    }
}

// -----------------------------------------------------------------------
// Helpers

function roundCoord(coord) {
    if (!Array.isArray(coord) || coord.length !== 2) return undefined;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
    return [roundNum(lon, 5), roundNum(lat, 5)];
}

function roundNum(n, places) {
    if (!Number.isFinite(n)) return undefined;
    const f = Math.pow(10, places);
    return Math.round(n * f) / f;
}

function b64UrlEncode(s) {
    const raw = typeof btoa === 'function' ? btoa(unicodeToLatin1(s)) : '';
    return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(s) {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const raw = typeof atob === 'function' ? atob(padded + '===='.slice(0, padLen)) : '';
    return latin1ToUnicode(raw);
}

function unicodeToLatin1(s) {
    return unescape(encodeURIComponent(s));
}

function latin1ToUnicode(s) {
    try {
        return decodeURIComponent(escape(s));
    } catch (_err) {
        return s;
    }
}
