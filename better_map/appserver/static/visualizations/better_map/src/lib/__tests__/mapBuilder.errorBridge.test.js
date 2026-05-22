/*
 * MapBuilder MapLibre error bridge — Phase B (v1.8.0) tests.
 *
 * Contract:
 *   MapBuilder.init() registers a `map.on('error', fn)` handler. When
 *   MapLibre fires that event (tile-load failure, style parse error,
 *   etc.) the handler must funnel the error through safeRun() so it
 *   reaches:
 *     - the safeRun ring buffer (for debugHud)
 *     - panelRoot's `better_map:error` CustomEvent stream
 *     - the rate-limited reporter
 *   using scope MAPLIBRE_INTERNAL. The bridge must not throw, must
 *   tolerate `evt == null` / `evt.error == null` defensively, and must
 *   degrade silently when the panel root is missing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../errorStates.js', async () => {
    const actual = await vi.importActual('../errorStates.js');
    return {
        ...actual,
        isWebGLAvailable: () => true
    };
});

let _stubMapHandlers;
let _stubMap;
let _stubLoaded;

vi.mock('maplibre-gl', () => {
    function StubMap() {
        _stubMapHandlers = {};
        _stubLoaded = false;
        const inst = {
            on: function (evt, fn) {
                if (!_stubMapHandlers[evt]) _stubMapHandlers[evt] = [];
                _stubMapHandlers[evt].push(fn);
            },
            off: function () {},
            isStyleLoaded: function () { return _stubLoaded; },
            remove: function () {},
            getCenter: function () { return { lng: 0, lat: 0 }; },
            getZoom: function () { return 1; },
            getCanvasContainer: function () { return document.createElement('div'); },
            getContainer: function () { return document.createElement('div'); },
            setStyle: function () {},
            resize: function () {}
        };
        _stubMap = inst;
        return inst;
    }
    return {
        default: {
            Map: StubMap,
            addProtocol: function () {},
            removeProtocol: function () {},
            NavigationControl: function () { return { onAdd: function () { return document.createElement('div'); } }; },
            AttributionControl: function () { return { onAdd: function () { return document.createElement('div'); } }; },
            ScaleControl: function () { return { onAdd: function () { return document.createElement('div'); } }; }
        },
        Map: StubMap,
        addProtocol: function () {},
        removeProtocol: function () {}
    };
});

vi.mock('pmtiles', () => ({ Protocol: function () { return { tile: function () {} }; } }));
vi.mock('../styles.js', () => ({
    resolveStyle: function () {
        return {
            provider: { id: 'stub', label: 'Stub', requiresKey: false, attribution: '' },
            style: { version: 8, sources: {}, layers: [] }
        };
    },
    DEFAULT_PROVIDER: 'stub'
}));
vi.mock('../attribution.js', () => ({ applyAttribution: function () {} }));
vi.mock('../layers/index.js', () => ({
    reconcile: function () { return {}; },
    applyLayerNameFilter: function () {},
    setLayerVisibility: function () {}
}));
vi.mock('../layers/markers.js', () => ({
    LAYER_DOT: 'l_dot',
    LAYER_BG: 'l_bg',
    applySelection: function () {}
}));
vi.mock('../layers/clusters.js', () => ({ LAYER_UNCLUSTERED: 'l_un' }));
vi.mock('../layers/paths.js', () => ({ LAYER_LINE: 'l_line', LAYER_LINE_BG: 'l_line_bg' }));
vi.mock('../time/trail.js', () => ({ applyTrail: function () {}, clearTrail: function () {} }));
vi.mock('../drilldown.js', () => ({ attachDrilldown: function () { return function () {}; } }));
vi.mock('../crossPanel.js', () => ({ createCrossPanel: function () { return { destroy: function () {}, applyRemoteCamera: function () {} }; } }));
vi.mock('../a11y.js', () => ({ applyA11yAttrs: function () {}, applyLabelLanguage: function () {} }));

import { MapBuilder } from '../mapBuilder.js';
import { getRecentErrors, __resetSafeRunState } from '../safeRun.js';
import { MAPLIBRE_INTERNAL } from '../errorScopes.js';

function flushErrorHandler(evt) {
    // MapLibre invokes every registered listener with the event object.
    const handlers = _stubMapHandlers && _stubMapHandlers.error;
    if (!handlers || !handlers.length) return false;
    handlers.forEach(function (fn) { fn(evt); });
    return true;
}

describe('MapBuilder MapLibre error bridge', () => {
    let container;
    let builder;

    beforeEach(() => {
        __resetSafeRunState();
        container = document.createElement('div');
        // safeRun guards on `panelRoot.dataset.bmDestroying === '1'` to
        // suppress banners during teardown; our tests want the live
        // pathway, so explicitly clear the flag.
        container.dataset.bmDestroying = '';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (builder) {
            try { builder.destroy(); } catch (_e) { /* noop */ }
            builder = null;
        }
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        __resetSafeRunState();
    });

    it('registers an error handler on the underlying map', () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        expect(_stubMapHandlers.error).toBeDefined();
        expect(_stubMapHandlers.error.length).toBeGreaterThanOrEqual(1);
    });

    it('routes MapLibre errors into the safeRun ring buffer with MAPLIBRE_INTERNAL scope', () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        const fired = flushErrorHandler({ error: new Error('tile-404') });
        expect(fired).toBe(true);
        const buf = getRecentErrors({ scope: MAPLIBRE_INTERNAL });
        expect(buf.length).toBe(1);
        expect(buf[0].scope).toBe(MAPLIBRE_INTERNAL);
        expect(buf[0].message).toMatch(/tile-404/);
    });

    it('dispatches a better_map:error CustomEvent on the panel root', () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });

        const events = [];
        container.addEventListener('better_map:error', function (evt) {
            events.push(evt.detail);
        });

        flushErrorHandler({ error: new Error('style-load-failed') });
        expect(events.length).toBe(1);
        expect(events[0].scope).toBe(MAPLIBRE_INTERNAL);
        expect(events[0].message).toMatch(/style-load-failed/);
    });

    it('handles a malformed MapLibre error event without throwing', () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        expect(() => flushErrorHandler(null)).not.toThrow();
        expect(() => flushErrorHandler({})).not.toThrow();
        expect(() => flushErrorHandler({ error: null })).not.toThrow();
    });

    it('survives a string-typed MapLibre error', () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        flushErrorHandler({ error: 'bare-string-error' });
        const buf = getRecentErrors({ scope: MAPLIBRE_INTERNAL });
        expect(buf.length).toBe(1);
        expect(buf[0].message).toMatch(/bare-string-error/);
    });
});
