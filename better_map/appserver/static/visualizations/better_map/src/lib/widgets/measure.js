/*
 * Measure tool — click-to-measure distance / area / bearing.
 *
 * Hand-rolled (no GL Draw) so it works with the same map-event
 * primitives as drawTools.js. Click adds a vertex; double-click or
 * Enter finishes; the on-map result panel shows running totals.
 *
 * Computes:
 *   - cumulative distance (via turf.length, in km and mi)
 *   - polygon area (when ≥3 vertices, via turf.area, in km² and mi²)
 *   - bearing between the last two vertices (in degrees from north)
 *
 * Copy-to-clipboard support: clicking the result panel copies the
 * full summary to clipboard.
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

import * as turf from '@turf/turf';

const SRC_ID = 'bm_measure_src';
const LINE_LAYER = 'bm_measure_line';
const VERTEX_LAYER = 'bm_measure_vertex';

const TOOLBAR_CLASS = 'better_map-measure';
const TOOLBAR_ROW_CLASS = 'better_map-measure__row';
const HINT_CLASS = 'better_map-measure__hint';
const TOOLBAR_BTN_CLASS = 'better_map-measure__btn';
const TOOLBAR_BTN_ACTIVE_CLASS = 'better_map-measure__btn--active';
const PANEL_CLASS = 'better_map-measure__panel';

// Same UX pattern as drawTools: an inline hint beneath the buttons
// telling users that clicking the START button only activates a mode —
// they then need to click on the map to add vertices. Without this,
// the button looks broken when only its active highlight changes.
const HINT_IDLE = 'Click the ruler, then click the map to measure';
const HINT_START = 'Measure mode: click the map to add the first vertex • Esc to cancel';
function hintProgress(n) {
    return 'Measure: ' + n + ' vertex' + (n === 1 ? '' : 'es') +
        ' — click to add more • Double-click or Enter to finish • Esc to cancel';
}

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder
 * @param {string} [opts.units='metric']  metric | imperial | both
 */
export function createMeasureTool(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    const units = options.units || 'both';

    let _enabled = true;
    let _active = false;
    let _coords = [];

    const toolbar = document.createElement('div');
    toolbar.className = TOOLBAR_CLASS;
    toolbar.setAttribute('aria-label', 'Measure tool');

    const buttonRow = document.createElement('div');
    buttonRow.className = TOOLBAR_ROW_CLASS;
    buttonRow.setAttribute('role', 'toolbar');
    buttonRow.setAttribute('aria-label', 'Measure tool');

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = TOOLBAR_BTN_CLASS;
    startBtn.setAttribute('aria-label', 'Toggle measure mode — click the map to add vertices, double-click or Enter to finish');
    startBtn.setAttribute('title', 'Measure — toggle mode, then click the map to add vertices • Double-click or Enter to finish • Esc to cancel');
    startBtn.textContent = '📏';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = TOOLBAR_BTN_CLASS;
    clearBtn.setAttribute('aria-label', 'Clear measurement');
    clearBtn.setAttribute('title', 'Clear measurement');
    clearBtn.textContent = '✕';

    buttonRow.appendChild(startBtn);
    buttonRow.appendChild(clearBtn);
    toolbar.appendChild(buttonRow);

    const hint = document.createElement('div');
    hint.className = HINT_CLASS;
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = HINT_IDLE;
    toolbar.appendChild(hint);

    parentEl.appendChild(toolbar);

    const panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.style.display = 'none';
    panel.setAttribute('title', 'Click to copy summary');
    parentEl.appendChild(panel);

    function ensureSource() {
        if (!builder || !builder.map) return false;
        const map = builder.map;
        if (!map.getSource(SRC_ID)) {
            map.addSource(SRC_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: LINE_LAYER,
                type: 'line',
                source: SRC_ID,
                filter: ['==', ['geometry-type'], 'LineString'],
                paint: { 'line-color': '#FFB300', 'line-width': 2, 'line-dasharray': [2, 1] }
            });
            map.addLayer({
                id: VERTEX_LAYER,
                type: 'circle',
                source: SRC_ID,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: { 'circle-radius': 5, 'circle-color': '#FFB300', 'circle-stroke-color': '#0a0a14', 'circle-stroke-width': 2 }
            });
        }
        return true;
    }

    function refresh() {
        if (!builder || !builder.map) return;
        const src = builder.map.getSource(SRC_ID);
        if (!src) return;
        const features = [];
        if (_coords.length >= 2) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: _coords } });
        }
        _coords.forEach(function (c) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
        });
        src.setData({ type: 'FeatureCollection', features: features });
        updatePanel();
    }

    function format(value, unit) {
        if (value == null || !isFinite(value)) return '–';
        if (value >= 100) return value.toFixed(0) + ' ' + unit;
        if (value >= 10) return value.toFixed(1) + ' ' + unit;
        if (value >= 1) return value.toFixed(2) + ' ' + unit;
        return value.toFixed(3) + ' ' + unit;
    }

    function buildSummary() {
        if (_coords.length < 1) return '';
        const lines = [];
        if (_coords.length >= 2) {
            const line = turf.lineString(_coords);
            const km = turf.length(line, { units: 'kilometers' });
            const mi = km / 1.609344;
            if (units === 'metric' || units === 'both') lines.push('Distance: ' + format(km, 'km'));
            if (units === 'imperial' || units === 'both') lines.push('Distance: ' + format(mi, 'mi'));
        }
        if (_coords.length >= 3) {
            const ring = _coords.concat([_coords[0]]);
            const polygon = turf.polygon([ring]);
            const km2 = turf.area(polygon) / 1e6;
            const mi2 = km2 / 2.58999;
            if (units === 'metric' || units === 'both') lines.push('Area: ' + format(km2, 'km²'));
            if (units === 'imperial' || units === 'both') lines.push('Area: ' + format(mi2, 'mi²'));
        }
        if (_coords.length >= 2) {
            const a = _coords[_coords.length - 2];
            const b = _coords[_coords.length - 1];
            const bearing = turf.bearing(turf.point(a), turf.point(b));
            const normalized = (bearing + 360) % 360;
            lines.push('Bearing: ' + format(normalized, '°'));
        }
        lines.push('Vertices: ' + _coords.length);
        return lines.join('\n');
    }

    function updatePanel() {
        const summary = buildSummary();
        if (!summary) {
            panel.style.display = 'none';
            panel.textContent = '';
            return;
        }
        panel.style.display = '';
        panel.textContent = summary;
    }

    function updateHint() {
        if (!_enabled) {
            hint.textContent = '';
            return;
        }
        if (!_active) {
            hint.textContent = HINT_IDLE;
            return;
        }
        const n = _coords.length;
        hint.textContent = n === 0 ? HINT_START : hintProgress(n);
    }

    function activate() {
        if (!_enabled) return;
        if (!ensureSource()) {
            if (builder && typeof builder._afterStyle === 'function') {
                builder._afterStyle(activate);
            }
            return;
        }
        _active = !_active;
        startBtn.classList.toggle(TOOLBAR_BTN_ACTIVE_CLASS, _active);
        startBtn.setAttribute('aria-pressed', _active ? 'true' : 'false');
        if (_active) {
            _coords = [];
            refresh();
        }
        updateHint();
    }

    function onMapClick(e) {
        if (!_active || !_enabled) return;
        _coords.push([e.lngLat.lng, e.lngLat.lat]);
        refresh();
        updateHint();
    }

    function onMapDoubleClick(e) {
        if (!_active || !_enabled) return;
        e.preventDefault && e.preventDefault();
        _active = false;
        startBtn.classList.remove(TOOLBAR_BTN_ACTIVE_CLASS);
        startBtn.setAttribute('aria-pressed', 'false');
        updateHint();
    }

    function clear() {
        _coords = [];
        refresh();
        updateHint();
    }

    function copy() {
        const text = panel.textContent || '';
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () { /* swallow */ });
        } else {
            // Fallback for older browsers.
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_e) { /* swallow */ }
            document.body.removeChild(ta);
        }
    }

    function onKeyDown(e) {
        if (!_active || !_enabled) return;
        if (e.key === 'Escape') {
            _active = false;
            startBtn.classList.remove(TOOLBAR_BTN_ACTIVE_CLASS);
            startBtn.setAttribute('aria-pressed', 'false');
            clear();
        } else if (e.key === 'Enter') {
            _active = false;
            startBtn.classList.remove(TOOLBAR_BTN_ACTIVE_CLASS);
            startBtn.setAttribute('aria-pressed', 'false');
            updateHint();
        }
    }

    startBtn.addEventListener('click', activate);
    clearBtn.addEventListener('click', clear);
    panel.addEventListener('click', copy);

    function attach() {
        if (!builder || !builder.map) return;
        ensureSource();
        builder.map.on('click', onMapClick);
        builder.map.on('dblclick', onMapDoubleClick);
        document.addEventListener('keydown', onKeyDown);
    }
    function detach() {
        if (builder && builder.map) {
            try {
                builder.map.off('click', onMapClick);
                builder.map.off('dblclick', onMapDoubleClick);
            } catch (_e) { /* swallow */ }
        }
        document.removeEventListener('keydown', onKeyDown);
    }

    function setEnabled(enabled) {
        _enabled = !!enabled;
        toolbar.style.display = _enabled ? '' : 'none';
        if (!_enabled) {
            _active = false;
            startBtn.classList.remove(TOOLBAR_BTN_ACTIVE_CLASS);
            startBtn.setAttribute('aria-pressed', 'false');
            clear();
            panel.style.display = 'none';
        }
        updateHint();
    }
    function isEnabled() { return _enabled; }
    function reset() {
        _active = false;
        clear();
        startBtn.classList.remove(TOOLBAR_BTN_ACTIVE_CLASS);
        startBtn.setAttribute('aria-pressed', 'false');
        panel.style.display = 'none';
        updateHint();
    }
    function destroy() {
        detach();
        clear();
        if (builder && builder.map) {
            [VERTEX_LAYER, LINE_LAYER].forEach(function (id) {
                if (builder.map.getLayer(id)) {
                    try { builder.map.removeLayer(id); } catch (_e) { /* swallow */ }
                }
            });
            if (builder.map.getSource(SRC_ID)) {
                try { builder.map.removeSource(SRC_ID); } catch (_e) { /* swallow */ }
            }
        }
        if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
        if (panel.parentNode) panel.parentNode.removeChild(panel);
    }

    if (builder && builder.map) {
        attach();
    } else if (builder && typeof builder._afterStyle === 'function') {
        builder._afterStyle(attach);
    }

    return {
        activate: activate,
        clear: clear,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy
    };
}
