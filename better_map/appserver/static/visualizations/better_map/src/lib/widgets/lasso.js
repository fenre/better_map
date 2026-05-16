/*
 * Lasso + multi-select widget.
 *
 * Hold the lasso modifier key (default: shift), then mouse-drag a
 * freehand polygon around features. On mouse-up, the widget computes
 * which features (markers, hexbins, polygons) fall inside via
 * turf.booleanPointInPolygon. The result is exposed as:
 *
 *   - A CustomEvent `bm:lasso-select` with detail={ features, polygon }
 *   - A right-click context menu (when the cursor is over the lasso
 *     polygon) offering registered action handlers
 *
 * Action handlers are registered by callers with `addAction({ id,
 * label, hint, run })`. The lasso widget itself ships with one
 * built-in action: "Copy selection to clipboard" (newline-separated
 * IDs).
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

import * as turf from '@turf/turf';

const SRC_ID = 'bm_lasso_src';
const FILL_LAYER = 'bm_lasso_fill';
const LINE_LAYER = 'bm_lasso_line';

const MENU_CLASS = 'better_map-lasso__menu';
const MENU_ITEM_CLASS = 'better_map-lasso__menu-item';

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder
 * @param {string} [opts.modifier='shift']   shift | alt | ctrl | meta
 * @param {Array<string>} [opts.sourceIds]   GeoJSON source IDs to query
 *                                            (defaults to all bm_* sources)
 */
export function createLasso(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    const modifier = (options.modifier || 'shift').toLowerCase();

    let _enabled = true;
    let _drawing = false;
    let _coords = [];
    let _polygon = null;
    let _selection = []; // { id, lng, lat, props }
    let _menuEl = null;
    let _actions = [defaultCopyAction()];

    function defaultCopyAction() {
        return {
            id: 'copy_ids',
            label: 'Copy IDs to clipboard',
            hint: 'Newline-separated',
            run: function (sel) {
                const lines = sel.map(function (s) { return String(s.id == null ? '' : s.id); }).filter(Boolean);
                copyText(lines.join('\n'));
            }
        };
    }

    function copyText(text) {
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () { /* swallow */ });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_e) { /* swallow */ }
            document.body.removeChild(ta);
        }
    }

    function ensureSource() {
        if (!builder || !builder.map) return false;
        const map = builder.map;
        if (!map.getSource(SRC_ID)) {
            map.addSource(SRC_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: FILL_LAYER,
                type: 'fill',
                source: SRC_ID,
                paint: { 'fill-color': '#9B59B6', 'fill-opacity': 0.15 }
            });
            map.addLayer({
                id: LINE_LAYER,
                type: 'line',
                source: SRC_ID,
                paint: { 'line-color': '#9B59B6', 'line-width': 2, 'line-dasharray': [2, 1] }
            });
        }
        return true;
    }

    function refresh() {
        if (!builder || !builder.map) return;
        const src = builder.map.getSource(SRC_ID);
        if (!src) return;
        if (_coords.length < 3) {
            src.setData({ type: 'FeatureCollection', features: [] });
            return;
        }
        const ring = _coords.concat([_coords[0]]);
        const polygon = {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [ring] }
        };
        src.setData({ type: 'FeatureCollection', features: [polygon] });
    }

    function modifierMatches(e) {
        const ev = e && e.originalEvent;
        if (!ev) return false;
        if (modifier === 'shift') return ev.shiftKey;
        if (modifier === 'alt') return ev.altKey;
        if (modifier === 'ctrl') return ev.ctrlKey;
        if (modifier === 'meta') return ev.metaKey;
        return false;
    }

    function onDown(e) {
        if (!_enabled || !modifierMatches(e)) return;
        if (!ensureSource()) return;
        // Disable map dragging while lassoing.
        if (builder.map.dragPan && builder.map.dragPan.disable) builder.map.dragPan.disable();
        _drawing = true;
        _coords = [[e.lngLat.lng, e.lngLat.lat]];
        refresh();
        hideMenu();
    }

    function onMove(e) {
        if (!_drawing) return;
        _coords.push([e.lngLat.lng, e.lngLat.lat]);
        // Throttle: keep at most ~250 points.
        if (_coords.length > 250) {
            // Drop every other point.
            _coords = _coords.filter(function (_, i) { return i % 2 === 0; });
        }
        refresh();
    }

    function onUp(_e) {
        if (!_drawing) return;
        _drawing = false;
        if (builder.map.dragPan && builder.map.dragPan.enable) builder.map.dragPan.enable();
        if (_coords.length < 3) {
            _coords = [];
            refresh();
            return;
        }
        _polygon = turf.polygon([_coords.concat([_coords[0]])]);
        _selection = selectFeaturesInside(_polygon);
        try {
            parentEl.dispatchEvent(new CustomEvent('bm:lasso-select', { detail: { features: _selection.slice(), polygon: _polygon } }));
        } catch (_e2) { /* swallow */ }
    }

    function onContextMenu(e) {
        if (!_polygon) return;
        const turfPt = turf.point([e.lngLat.lng, e.lngLat.lat]);
        if (!turf.booleanPointInPolygon(turfPt, _polygon)) return;
        e.preventDefault && e.preventDefault();
        showMenu(e.originalEvent);
    }

    function selectFeaturesInside(polygon) {
        if (!builder || !builder.map) return [];
        const out = [];
        const sources = (options.sourceIds && options.sourceIds.length) ? options.sourceIds : null;
        const candidates = [];
        if (sources) {
            sources.forEach(function (sid) {
                try {
                    const feats = builder.map.querySourceFeatures(sid);
                    if (feats && feats.length) feats.forEach(function (f) { candidates.push(f); });
                } catch (_e) { /* swallow */ }
            });
        } else {
            // Scan rendered features inside the polygon bbox.
            try {
                const bbox = turf.bbox(polygon);
                const sw = builder.map.project([bbox[0], bbox[1]]);
                const ne = builder.map.project([bbox[2], bbox[3]]);
                const minPoint = { x: Math.min(sw.x, ne.x), y: Math.min(sw.y, ne.y) };
                const maxPoint = { x: Math.max(sw.x, ne.x), y: Math.max(sw.y, ne.y) };
                const rendered = builder.map.queryRenderedFeatures([
                    [minPoint.x, minPoint.y],
                    [maxPoint.x, maxPoint.y]
                ]);
                if (rendered && rendered.length) rendered.forEach(function (f) { candidates.push(f); });
            } catch (_e) { /* swallow */ }
        }
        // Dedup by source feature id.
        const seen = {};
        candidates.forEach(function (f) {
            if (!f || !f.geometry) return;
            const id = (f.properties && (f.properties.id || f.properties._id)) || f.id || '?';
            if (seen[id]) return;
            // Find a representative point for the feature.
            let pt;
            if (f.geometry.type === 'Point') {
                pt = turf.point(f.geometry.coordinates);
            } else {
                try { pt = turf.centroid(f); } catch (_e) { return; }
            }
            if (!pt) return;
            if (!turf.booleanPointInPolygon(pt, polygon)) return;
            seen[id] = true;
            out.push({
                id: id,
                lng: pt.geometry.coordinates[0],
                lat: pt.geometry.coordinates[1],
                props: f.properties || {},
                source: f.source || null,
                sourceLayer: f.sourceLayer || null
            });
        });
        return out;
    }

    function showMenu(originalEvent) {
        hideMenu();
        _menuEl = document.createElement('div');
        _menuEl.className = MENU_CLASS;
        _menuEl.setAttribute('role', 'menu');
        _menuEl.style.left = originalEvent.clientX + 'px';
        _menuEl.style.top = originalEvent.clientY + 'px';
        const header = document.createElement('div');
        header.className = MENU_ITEM_CLASS;
        header.setAttribute('role', 'presentation');
        header.style.fontWeight = '600';
        header.textContent = _selection.length + ' selected';
        _menuEl.appendChild(header);
        _actions.forEach(function (a) {
            const item = document.createElement('div');
            item.className = MENU_ITEM_CLASS;
            item.setAttribute('role', 'menuitem');
            item.setAttribute('tabindex', '0');
            item.textContent = a.label + (a.hint ? '  ·  ' + a.hint : '');
            item.addEventListener('click', function () {
                try { a.run(_selection.slice()); } catch (_e) { /* swallow */ }
                hideMenu();
            });
            _menuEl.appendChild(item);
        });
        // Close on outside click.
        setTimeout(function () {
            document.addEventListener('click', hideMenu, { once: true });
        }, 0);
        document.body.appendChild(_menuEl);
    }
    function hideMenu() {
        if (_menuEl && _menuEl.parentNode) {
            _menuEl.parentNode.removeChild(_menuEl);
        }
        _menuEl = null;
    }

    function attach() {
        if (!builder || !builder.map) return;
        ensureSource();
        builder.map.on('mousedown', onDown);
        builder.map.on('mousemove', onMove);
        builder.map.on('mouseup', onUp);
        builder.map.on('contextmenu', onContextMenu);
    }
    function detach() {
        if (!builder || !builder.map) return;
        try {
            builder.map.off('mousedown', onDown);
            builder.map.off('mousemove', onMove);
            builder.map.off('mouseup', onUp);
            builder.map.off('contextmenu', onContextMenu);
        } catch (_e) { /* swallow */ }
    }

    function addAction(action) {
        if (!action || typeof action.run !== 'function') return;
        _actions.push(action);
    }
    function clearActions() {
        _actions = [defaultCopyAction()];
    }
    function getSelection() {
        return _selection.slice();
    }

    function setEnabled(enabled) {
        _enabled = !!enabled;
        if (!_enabled) {
            _drawing = false;
            _coords = [];
            _selection = [];
            _polygon = null;
            refresh();
            hideMenu();
        }
    }
    function isEnabled() { return _enabled; }
    function reset() {
        _drawing = false;
        _coords = [];
        _selection = [];
        _polygon = null;
        hideMenu();
        refresh();
    }
    function destroy() {
        detach();
        hideMenu();
        if (builder && builder.map) {
            [LINE_LAYER, FILL_LAYER].forEach(function (id) {
                if (builder.map.getLayer(id)) {
                    try { builder.map.removeLayer(id); } catch (_e) { /* swallow */ }
                }
            });
            if (builder.map.getSource(SRC_ID)) {
                try { builder.map.removeSource(SRC_ID); } catch (_e) { /* swallow */ }
            }
        }
    }

    if (builder && builder.map) {
        attach();
    } else if (builder && typeof builder._afterStyle === 'function') {
        builder._afterStyle(attach);
    }

    return {
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy,
        addAction: addAction,
        clearActions: clearActions,
        getSelection: getSelection
    };
}
