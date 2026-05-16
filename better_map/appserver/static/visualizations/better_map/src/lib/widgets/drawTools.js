/*
 * Draw tools — point / line / polygon / rectangle / circle.
 *
 * Minimalist hand-rolled draw implementation. We deliberately avoid
 * @mapbox/mapbox-gl-draw because it adds ~200K to the bundle and we
 * don't need its full editing surface (snap-to-vertex, undo stack,
 * multi-select). The maplibre-native shim is also maintenance-prone.
 *
 * Drawing model:
 *   - Click to add a vertex (or, for rect/circle, to set the origin
 *     and then opposite corner / radius point)
 *   - Move the mouse to preview the in-progress shape
 *   - Double-click, Enter, or click the "finish" button to commit
 *   - Esc cancels the in-progress shape
 *
 * Emits CustomEvents on the viz container:
 *   - `bm:draw-finished`  detail={ feature, mode, all }
 *   - `bm:draw-cleared`   detail={}
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 *
 * Cross-widget hook: the spatial-query widget consumes
 * `bm:draw-finished` and emits SPL templates into the dashboard token
 * model via Splunk's globals (see `spatialQuery.js`).
 */

import * as turf from '@turf/turf';

const SRC_ID = 'bm_draw_src';
const FILL_LAYER = 'bm_draw_fill';
const LINE_LAYER = 'bm_draw_line';
const POINT_LAYER = 'bm_draw_pt';
const VERTEX_LAYER = 'bm_draw_vertex';

const TOOLBAR_CLASS = 'better_map-draw';
const TOOL_BTN_CLASS = 'better_map-draw__btn';
const TOOL_BTN_ACTIVE_CLASS = 'better_map-draw__btn--active';

const TOOLS = [
    { id: 'point', label: 'Point', icon: '◉' },
    { id: 'line', label: 'Line', icon: '∕' },
    { id: 'polygon', label: 'Polygon', icon: '⬠' },
    { id: 'rectangle', label: 'Rectangle', icon: '▭' },
    { id: 'circle', label: 'Circle', icon: '○' }
];

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder
 * @param {Array<string>} [opts.tools]  Subset of TOOLS.id values.
 * @param {Function} [opts.onFinish]    (feature, mode, all) => void
 */
export function createDrawTools(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    const allowed = options.tools || TOOLS.map(function (t) { return t.id; });
    const onFinish = typeof options.onFinish === 'function' ? options.onFinish : function () {};

    let _enabled = true;
    let _mode = null; // null | 'point' | 'line' | 'polygon' | 'rectangle' | 'circle'
    let _features = []; // committed
    let _inProgress = null; // { coords, originLngLat }
    let _toolButtons = {};

    const toolbar = document.createElement('div');
    toolbar.className = TOOLBAR_CLASS;
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Draw tools');

    TOOLS.forEach(function (tool) {
        if (allowed.indexOf(tool.id) === -1) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = TOOL_BTN_CLASS;
        btn.setAttribute('aria-label', 'Draw ' + tool.label);
        btn.setAttribute('title', tool.label);
        btn.textContent = tool.icon;
        btn.addEventListener('click', function () { activate(tool.id); });
        _toolButtons[tool.id] = btn;
        toolbar.appendChild(btn);
    });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = TOOL_BTN_CLASS;
    clearBtn.setAttribute('aria-label', 'Clear drawings');
    clearBtn.setAttribute('title', 'Clear');
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', function () { clear(); });
    toolbar.appendChild(clearBtn);

    parentEl.appendChild(toolbar);

    function ensureSource() {
        if (!builder || !builder.map) return false;
        const map = builder.map;
        if (!map.getSource(SRC_ID)) {
            map.addSource(SRC_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            map.addLayer({
                id: FILL_LAYER,
                type: 'fill',
                source: SRC_ID,
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: {
                    'fill-color': '#00A4FD',
                    'fill-opacity': 0.15,
                    'fill-outline-color': '#00A4FD'
                }
            });
            map.addLayer({
                id: LINE_LAYER,
                type: 'line',
                source: SRC_ID,
                filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
                paint: {
                    'line-color': '#00A4FD',
                    'line-width': 2,
                    'line-dasharray': [2, 1]
                }
            });
            map.addLayer({
                id: POINT_LAYER,
                type: 'circle',
                source: SRC_ID,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#00A4FD',
                    'circle-stroke-color': '#0a0a14',
                    'circle-stroke-width': 2
                }
            });
            map.addLayer({
                id: VERTEX_LAYER,
                type: 'circle',
                source: SRC_ID,
                filter: ['==', ['get', '_vertex'], true],
                paint: {
                    'circle-radius': 4,
                    'circle-color': '#fff',
                    'circle-stroke-color': '#00A4FD',
                    'circle-stroke-width': 1.5
                }
            });
        }
        return true;
    }

    function refresh() {
        if (!builder || !builder.map) return;
        const src = builder.map.getSource(SRC_ID);
        if (!src) return;
        const out = _features.slice();
        if (_inProgress && _inProgress.coords && _inProgress.coords.length) {
            const preview = previewFeature();
            if (preview) out.push(preview);
            // Add vertex markers.
            _inProgress.coords.forEach(function (c) {
                out.push({
                    type: 'Feature',
                    properties: { _vertex: true },
                    geometry: { type: 'Point', coordinates: c }
                });
            });
        }
        src.setData({ type: 'FeatureCollection', features: out });
    }

    function previewFeature() {
        if (!_inProgress) return null;
        const coords = _inProgress.coords;
        if (_mode === 'line') {
            if (coords.length < 2) return null;
            return {
                type: 'Feature',
                properties: { mode: 'line' },
                geometry: { type: 'LineString', coordinates: coords }
            };
        }
        if (_mode === 'polygon') {
            if (coords.length < 3) return null;
            const ring = coords.concat([coords[0]]);
            return {
                type: 'Feature',
                properties: { mode: 'polygon' },
                geometry: { type: 'Polygon', coordinates: [ring] }
            };
        }
        if (_mode === 'rectangle') {
            if (coords.length < 2) return null;
            const a = coords[0], b = coords[1];
            const ring = [
                [a[0], a[1]],
                [b[0], a[1]],
                [b[0], b[1]],
                [a[0], b[1]],
                [a[0], a[1]]
            ];
            return {
                type: 'Feature',
                properties: { mode: 'rectangle' },
                geometry: { type: 'Polygon', coordinates: [ring] }
            };
        }
        if (_mode === 'circle') {
            if (coords.length < 2) return null;
            const centre = coords[0], edge = coords[1];
            const radiusKm = turf.distance(turf.point(centre), turf.point(edge), { units: 'kilometers' });
            const circle = turf.circle(centre, radiusKm, { steps: 64, units: 'kilometers' });
            circle.properties = { mode: 'circle', radiusKm: radiusKm };
            return circle;
        }
        return null;
    }

    function activate(mode) {
        if (!_enabled) return;
        if (!ensureSource()) {
            if (builder && typeof builder._afterStyle === 'function') {
                builder._afterStyle(function () { activate(mode); });
            }
            return;
        }
        // Toggle off if already active.
        if (_mode === mode) {
            _mode = null;
            _inProgress = null;
            refresh();
            updateButtonState();
            return;
        }
        _mode = mode;
        _inProgress = { coords: [] };
        updateButtonState();
        refresh();
    }

    function updateButtonState() {
        Object.keys(_toolButtons).forEach(function (id) {
            const btn = _toolButtons[id];
            if (id === _mode) {
                btn.classList.add(TOOL_BTN_ACTIVE_CLASS);
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.classList.remove(TOOL_BTN_ACTIVE_CLASS);
                btn.setAttribute('aria-pressed', 'false');
            }
        });
    }

    function commit(feature) {
        if (!feature) return;
        feature.id = 'bm-draw-' + (_features.length + 1);
        _features.push(feature);
        _inProgress = { coords: [] };
        if (_mode === 'point') {
            // Stay in point mode for rapid placement.
        } else {
            _mode = null;
            updateButtonState();
        }
        refresh();
        try {
            const ev = new CustomEvent('bm:draw-finished', { detail: { feature: feature, mode: feature.properties.mode, all: _features.slice() } });
            parentEl.dispatchEvent(ev);
        } catch (_e) { /* swallow */ }
        try { onFinish(feature, feature.properties.mode, _features.slice()); } catch (_e) { /* swallow */ }
    }

    function onMapClick(e) {
        if (!_mode || !_enabled) return;
        const lng = e.lngLat.lng;
        const lat = e.lngLat.lat;
        if (_mode === 'point') {
            commit({
                type: 'Feature',
                properties: { mode: 'point' },
                geometry: { type: 'Point', coordinates: [lng, lat] }
            });
            return;
        }
        if (_mode === 'rectangle' || _mode === 'circle') {
            if (_inProgress.coords.length === 0) {
                _inProgress.coords.push([lng, lat]);
                refresh();
            } else {
                _inProgress.coords[1] = [lng, lat];
                const f = previewFeature();
                commit(f);
            }
            return;
        }
        // Line or polygon: accumulate vertices.
        _inProgress.coords.push([lng, lat]);
        refresh();
    }

    function onMapMove(e) {
        if (!_mode || !_enabled || !_inProgress) return;
        if (_mode === 'line' || _mode === 'polygon') {
            const tail = (_inProgress.coords.length && _inProgress.coords[_inProgress.coords.length - 1]) || null;
            if (!tail) return;
            // Show a rubber-band preview by temporarily appending the cursor.
            const preview = _inProgress.coords.slice();
            preview.push([e.lngLat.lng, e.lngLat.lat]);
            const src = builder.map.getSource(SRC_ID);
            if (!src) return;
            const out = _features.slice();
            if (_mode === 'line' && preview.length >= 2) {
                out.push({ type: 'Feature', properties: { mode: 'line', _preview: true }, geometry: { type: 'LineString', coordinates: preview } });
            } else if (_mode === 'polygon' && preview.length >= 3) {
                const ring = preview.concat([preview[0]]);
                out.push({ type: 'Feature', properties: { mode: 'polygon', _preview: true }, geometry: { type: 'Polygon', coordinates: [ring] } });
            }
            _inProgress.coords.forEach(function (c) {
                out.push({ type: 'Feature', properties: { _vertex: true }, geometry: { type: 'Point', coordinates: c } });
            });
            src.setData({ type: 'FeatureCollection', features: out });
        }
        if (_mode === 'rectangle' || _mode === 'circle') {
            if (_inProgress.coords.length === 1) {
                _inProgress.coords[1] = [e.lngLat.lng, e.lngLat.lat];
                refresh();
                _inProgress.coords.length = 1;
            }
        }
    }

    function onMapDoubleClick(e) {
        if (!_mode || !_enabled) return;
        if (_mode === 'line' || _mode === 'polygon') {
            e.preventDefault && e.preventDefault();
            const f = previewFeature();
            if (f) commit(f);
        }
    }

    function onKeyDown(e) {
        if (!_mode || !_enabled) return;
        if (e.key === 'Enter') {
            const f = previewFeature();
            if (f) commit(f);
        } else if (e.key === 'Escape') {
            _mode = null;
            _inProgress = null;
            updateButtonState();
            refresh();
        }
    }

    function attach() {
        if (!builder || !builder.map) return;
        ensureSource();
        builder.map.on('click', onMapClick);
        builder.map.on('mousemove', onMapMove);
        builder.map.on('dblclick', onMapDoubleClick);
        document.addEventListener('keydown', onKeyDown);
    }
    function detach() {
        if (builder && builder.map) {
            try {
                builder.map.off('click', onMapClick);
                builder.map.off('mousemove', onMapMove);
                builder.map.off('dblclick', onMapDoubleClick);
            } catch (_e) { /* swallow */ }
        }
        document.removeEventListener('keydown', onKeyDown);
    }

    function clear() {
        _features = [];
        _inProgress = _mode ? { coords: [] } : null;
        refresh();
        try {
            parentEl.dispatchEvent(new CustomEvent('bm:draw-cleared', {}));
        } catch (_e) { /* swallow */ }
    }

    function getFeatures() {
        return _features.slice();
    }

    function setEnabled(enabled) {
        _enabled = !!enabled;
        toolbar.style.display = _enabled ? '' : 'none';
        if (!_enabled) {
            _mode = null;
            _inProgress = null;
            updateButtonState();
            refresh();
        }
    }

    function isEnabled() {
        return _enabled;
    }

    function reset() {
        _mode = null;
        _inProgress = null;
        clear();
        updateButtonState();
    }

    function destroy() {
        detach();
        clear();
        if (builder && builder.map) {
            [VERTEX_LAYER, POINT_LAYER, LINE_LAYER, FILL_LAYER].forEach(function (id) {
                if (builder.map.getLayer(id)) {
                    try { builder.map.removeLayer(id); } catch (_e) { /* swallow */ }
                }
            });
            if (builder.map.getSource(SRC_ID)) {
                try { builder.map.removeSource(SRC_ID); } catch (_e) { /* swallow */ }
            }
        }
        if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    }

    // Auto-attach.
    if (builder && builder.map) {
        attach();
    } else if (builder && typeof builder._afterStyle === 'function') {
        builder._afterStyle(attach);
    }

    return {
        activate: activate,
        clear: clear,
        getFeatures: getFeatures,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy
    };
}
