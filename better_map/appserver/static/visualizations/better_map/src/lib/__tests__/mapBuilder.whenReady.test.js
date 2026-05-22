/*
 * MapBuilder.whenReady() — Phase B (v1.8.0) tests.
 *
 * Contract:
 *   - Returns a Promise.
 *   - Resolves with `mapBuilder` itself when the map's style is fully loaded.
 *   - Resolves immediately when the map is already loaded.
 *   - Rejects with Error('MapBuilder destroyed') when destroy() runs first.
 *   - Rejects with Error('No map') when WebGL was unavailable / init bailed.
 *
 * The MapBuilder is exercised against a stubbed maplibregl that mimics the
 * real handler-registration shape (`on/off`, `isStyleLoaded`, `remove`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub WebGL availability + maplibregl so MapBuilder can be constructed
// in jsdom (which has no real WebGL). The stub is installed via vi.mock
// at module scope; per-test behaviour is tweaked through the listeners
// captured on the stub map.
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
            off: function (evt, fn) {
                if (_stubMapHandlers[evt]) {
                    _stubMapHandlers[evt] = _stubMapHandlers[evt].filter(function (h) {
                        return h !== fn;
                    });
                }
            },
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
    resolveStyle: function (opts) {
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

// MapBuilder is imported AFTER the mocks above so its module-scope
// imports pick up the stubs.
import { MapBuilder } from '../mapBuilder.js';

function fireMapEvent(evt, payload) {
    const handlers = _stubMapHandlers[evt] || [];
    handlers.forEach(function (h) { h(payload || {}); });
}

describe('MapBuilder.whenReady()', () => {
    let container;
    let builder;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
        _stubMapHandlers = null;
        _stubMap = null;
        _stubLoaded = false;
    });

    it('rejects with "No map" before init() is called', async () => {
        builder = new MapBuilder(container);
        let caught = null;
        try {
            await builder.whenReady();
        } catch (e) { caught = e; }
        expect(caught).not.toBeNull();
        expect(caught.message).toBe('No map');
    });

    it('resolves with the builder when the map fires "load"', async () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        const promise = builder.whenReady();
        // simulate MapLibre's load event firing on the next frame
        setTimeout(function () {
            _stubLoaded = true;
            fireMapEvent('load');
        }, 0);
        const result = await promise;
        expect(result).toBe(builder);
    });

    it('resolves immediately when the map is already loaded', async () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        _stubLoaded = true;
        // No event needs to fire — the API should detect loaded state.
        const result = await builder.whenReady();
        expect(result).toBe(builder);
    });

    it('rejects with "MapBuilder destroyed" when destroy() runs before load', async () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        const promise = builder.whenReady();
        builder.destroy();
        let caught = null;
        try {
            await promise;
        } catch (e) { caught = e; }
        expect(caught).not.toBeNull();
        expect(caught.message).toBe('MapBuilder destroyed');
    });

    it('rejects with "MapBuilder destroyed" when called after destroy()', async () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        builder.destroy();
        let caught = null;
        try {
            await builder.whenReady();
        } catch (e) { caught = e; }
        expect(caught).not.toBeNull();
        expect(caught.message).toBe('MapBuilder destroyed');
    });

    it('multiple concurrent calls all resolve from a single load event', async () => {
        builder = new MapBuilder(container);
        builder.init({ provider: 'stub', theme: 'dark' });
        const p1 = builder.whenReady();
        const p2 = builder.whenReady();
        const p3 = builder.whenReady();
        setTimeout(function () {
            _stubLoaded = true;
            fireMapEvent('load');
        }, 0);
        const results = await Promise.all([p1, p2, p3]);
        expect(results.every(function (r) { return r === builder; })).toBe(true);
    });
});
