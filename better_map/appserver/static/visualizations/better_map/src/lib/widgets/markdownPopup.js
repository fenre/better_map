/*
 * Modern popup widget — markdown body with embedded sparkline + KPI
 * tiles, DOMPurify-sanitized end-to-end.
 *
 * Replaces the plain-HTML popup pattern of v1.x with a richer panel
 * that supports:
 *
 *   - GitHub-flavoured markdown via marked
 *   - Inline KPI tiles via `[[kpi:LABEL=VALUE]]` shortcode (sparkline
 *     via `[[spark:1,2,3,5,8]]`)
 *   - DOMPurify on the rendered HTML (banned tags: script, iframe,
 *     object, embed, form, input, button, link)
 *   - "Pinned" mode: click the pin icon → popup stays open during
 *     subsequent feature clicks, until pin clicked again or [X] hit
 *
 * Threat model: user-controlled SPL fields populate the markdown
 * body. DOMPurify with the strict default config blocks XSS. We
 * additionally strip `on*` event handler attributes via the hooks
 * API to defend against future bypass classes.
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';

const POPUP_CLASS = 'better_map-popup-md';
const BODY_CLASS = 'better_map-popup-md__body';
const HEADER_CLASS = 'better_map-popup-md__header';
const PIN_CLASS = 'better_map-popup-md__pin';
const CLOSE_CLASS = 'better_map-popup-md__close';
const KPI_GRID_CLASS = 'better_map-popup-md__kpi-grid';
const KPI_TILE_CLASS = 'better_map-popup-md__kpi-tile';
const KPI_LABEL_CLASS = 'better_map-popup-md__kpi-label';
const KPI_VALUE_CLASS = 'better_map-popup-md__kpi-value';
const SPARK_CLASS = 'better_map-popup-md__sparkline';

// One-time DOMPurify hook: strip ALL on* attributes regardless of tag.
let hookInstalled = false;
function ensureHook() {
    if (hookInstalled) return;
    hookInstalled = true;
    DOMPurify.addHook('uponSanitizeAttribute', function (_node, data) {
        if (data && typeof data.attrName === 'string' &&
            data.attrName.toLowerCase().indexOf('on') === 0) {
            data.keepAttr = false;
        }
    });
}

/**
 * Render a sparkline SVG from a comma-separated number string.
 *
 * @param {string} csv "1,2,3,5,8"
 * @returns {string} <svg…></svg>
 */
function renderSparkline(csv) {
    const parts = (csv || '').split(',').map(function (s) { return parseFloat(s); }).filter(isFinite);
    if (parts.length < 2) return '';
    const W = 80, H = 24;
    const min = Math.min.apply(null, parts);
    const max = Math.max.apply(null, parts);
    const range = (max - min) || 1;
    const stepX = W / (parts.length - 1);
    const pts = parts.map(function (v, i) {
        const x = i * stepX;
        const y = H - ((v - min) / range) * H;
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="' + SPARK_CLASS +
        '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + pts + '" />' +
        '</svg>';
}

/**
 * Render a tiny KPI tile.
 *
 * @param {string} label
 * @param {string} value
 */
function renderKpi(label, value) {
    return '<div class="' + KPI_TILE_CLASS + '">' +
        '<div class="' + KPI_LABEL_CLASS + '">' + escapeHtml(label) + '</div>' +
        '<div class="' + KPI_VALUE_CLASS + '">' + escapeHtml(value) + '</div>' +
        '</div>';
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Pre-process [[kpi:…]] and [[spark:…]] shortcodes BEFORE markdown
 * processing so they survive into the final HTML.
 *
 * @param {string} src
 */
function preprocessShortcodes(src) {
    if (typeof src !== 'string' || !src) return '';
    let out = src;
    // KPI grid: [[kpi:Latency=12ms; Errors=3; Hosts=5]]
    out = out.replace(/\[\[kpi:([^\]]+)\]\]/g, function (_, body) {
        const pairs = body.split(';').map(function (p) { return p.trim(); }).filter(Boolean);
        const tiles = pairs.map(function (p) {
            const eq = p.indexOf('=');
            if (eq < 0) return renderKpi(p, '');
            return renderKpi(p.slice(0, eq).trim(), p.slice(eq + 1).trim());
        }).join('');
        return '<div class="' + KPI_GRID_CLASS + '">' + tiles + '</div>';
    });
    // Sparkline: [[spark:1,2,3,5,8]]
    out = out.replace(/\[\[spark:([^\]]+)\]\]/g, function (_, body) {
        return renderSparkline(body);
    });
    return out;
}

/**
 * Render markdown to safe HTML.
 *
 * @param {string} markdownSrc
 * @returns {string} sanitized HTML
 */
export function renderMarkdownSafe(markdownSrc) {
    ensureHook();
    const pre = preprocessShortcodes(markdownSrc || '');
    let html;
    try {
        // marked v16 returns a string synchronously when given async:false.
        html = marked.parse(pre, { async: false, breaks: true });
        if (typeof html !== 'string') {
            html = String(html);
        }
    } catch (_e) {
        html = escapeHtml(markdownSrc || '');
    }
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'style'],
        FORBID_ATTR: ['style']
    });
}

/**
 * Build a markdown popup attached to the viz container. Returned API:
 *
 *   showAt({ lngLat, markdown, title }) - position and show
 *   hide()                              - close (ignored if pinned)
 *   isPinned()                          - bool
 *   destroy()                           - tear down
 */
export function createMarkdownPopup(parentEl, _opts) {
    const root = document.createElement('div');
    root.className = POPUP_CLASS;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-live', 'polite');
    root.style.display = 'none';

    const header = document.createElement('div');
    header.className = HEADER_CLASS;

    const titleEl = document.createElement('div');
    titleEl.className = 'better_map-popup-md__title';

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = PIN_CLASS;
    pinBtn.setAttribute('aria-label', 'Pin popup');
    pinBtn.setAttribute('title', 'Pin popup');
    pinBtn.textContent = '📌';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = CLOSE_CLASS;
    closeBtn.setAttribute('aria-label', 'Close popup');
    closeBtn.setAttribute('title', 'Close');
    closeBtn.textContent = '×';

    header.appendChild(titleEl);
    header.appendChild(pinBtn);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = BODY_CLASS;

    root.appendChild(header);
    root.appendChild(body);
    parentEl.appendChild(root);

    let pinned = false;

    pinBtn.addEventListener('click', function () {
        pinned = !pinned;
        root.classList.toggle('better_map-popup-md--pinned', pinned);
        pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    });
    closeBtn.addEventListener('click', function () {
        pinned = false;
        hide();
    });

    function position(builder, lngLat) {
        if (!builder || !builder.map) return;
        try {
            const p = builder.map.project(lngLat);
            // Anchor bottom-left of popup above the click point.
            root.style.left = Math.round(p.x + 12) + 'px';
            root.style.top = Math.round(p.y - root.offsetHeight - 12) + 'px';
        } catch (_e) { /* style not loaded yet */ }
    }

    function showAt(args) {
        const builder = args && args.builder;
        const markdownSrc = (args && args.markdown) || '';
        const title = (args && args.title) || '';
        titleEl.textContent = title;
        body.innerHTML = renderMarkdownSafe(markdownSrc);
        root.style.display = '';
        if (args && args.lngLat) {
            position(builder, args.lngLat);
        }
    }

    function hide() {
        if (pinned) return;
        root.style.display = 'none';
    }

    function destroy() {
        if (root.parentNode) {
            root.parentNode.removeChild(root);
        }
    }

    function isPinned() {
        return pinned;
    }

    return {
        showAt: showAt,
        hide: hide,
        isPinned: isPinned,
        destroy: destroy
    };
}
