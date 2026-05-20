/*
 * markers.test.js — v1.7 Tier 1 #1 + #3 wiring tests.
 *
 * Exercises the new markers.js paths against a stubbed MapLibre map:
 *   - Label layer reconciliation (showLabels, labelField, labelMinZoom,
 *     labelColor, labelHaloColor, labelOffsetY)
 *   - Selection layer mount + filter update on applySelection()
 *   - Selection fly-to-on-change idempotence (same value -> one flyTo,
 *     not two on repeated calls)
 *   - Filter "never matches" when no selection is set
 *
 * The stub is deliberately minimal: it tracks paint / layout / filter
 * mutations so the tests can assert against post-condition state
 * without needing a real WebGL context.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    mount,
    update,
    applySelection,
    unmount,
    LAYER_LABEL,
    LAYER_SELECTED_DOT,
    LAYER_SELECTED_HALO,
    LAYER_DOT,
    SOURCE_ID
} from '../markers.js';

// markers.js holds selectionState at module scope; without an
// explicit reset between tests, lastFlownValue from one test leaks
// and suppresses fly-to in the next. A tiny stub-map + unmount()
// resets selectionState.value AND selectionState.lastFlownValue.
afterEach(() => {
    const ghost = {
        getLayer: () => null,
        removeLayer: () => {},
        getSource: () => null,
        removeSource: () => {}
    };
    unmount(ghost);
});

function makeFakeMap() {
    const layers = new Map();          // id -> { type, paint, layout, filter, source, minzoom }
    const sources = new Map();         // id -> data
    const flyToCalls = [];
    return {
        layers: layers,
        sources: sources,
        flyToCalls: flyToCalls,
        addSource: vi.fn((id, def) => sources.set(id, def)),
        getSource: vi.fn((id) =>
            sources.has(id)
                ? {
                    setData: vi.fn((d) => sources.set(id, { ...sources.get(id), data: d }))
                }
                : null
        ),
        removeSource: vi.fn((id) => sources.delete(id)),
        addLayer: vi.fn((spec) => {
            layers.set(spec.id, {
                id: spec.id,
                type: spec.type,
                source: spec.source,
                paint: { ...(spec.paint || {}) },
                layout: { ...(spec.layout || {}) },
                filter: spec.filter || null,
                minzoom: spec.minzoom !== undefined ? spec.minzoom : 0,
                maxzoom: spec.maxzoom !== undefined ? spec.maxzoom : 24
            });
        }),
        getLayer: vi.fn((id) => layers.get(id) || null),
        removeLayer: vi.fn((id) => layers.delete(id)),
        setPaintProperty: vi.fn((id, prop, val) => {
            const l = layers.get(id);
            if (l) l.paint[prop] = val;
        }),
        setLayoutProperty: vi.fn((id, prop, val) => {
            const l = layers.get(id);
            if (l) l.layout[prop] = val;
        }),
        setFilter: vi.fn((id, filter) => {
            const l = layers.get(id);
            if (l) l.filter = filter;
        }),
        setLayerZoomRange: vi.fn((id, mn, mx) => {
            const l = layers.get(id);
            if (l) {
                l.minzoom = mn;
                l.maxzoom = mx;
            }
        }),
        flyTo: vi.fn((opts) => flyToCalls.push(opts)),
        // The pulse path uses these but reduced-motion in jsdom keeps
        // the animation static, so they're safe no-ops here.
        // For completeness:
        on: vi.fn(),
        off: vi.fn()
    };
}

function makeFC(features) {
    return {
        type: 'FeatureCollection',
        features: features.map(function (f) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: f.coords },
                properties: f.props || {}
            };
        })
    };
}

describe('markers — label layer reconciliation (Tier 1 #3)', () => {
    let map;
    beforeEach(() => {
        map = makeFakeMap();
    });

    it('does not mount the label layer when showLabels is false', () => {
        mount(map, { showLabels: false });
        expect(map.getLayer(LAYER_LABEL)).toBeNull();
    });

    it('mounts the label layer when showLabels is true', () => {
        mount(map, { showLabels: true });
        const layer = map.getLayer(LAYER_LABEL);
        expect(layer).toBeTruthy();
        expect(layer.type).toBe('symbol');
        expect(layer.source).toBe(SOURCE_ID);
    });

    it('applies the user-supplied labelField via text-field coalesce', () => {
        mount(map, { showLabels: true, labelField: 'site_name' });
        const layer = map.getLayer(LAYER_LABEL);
        // text-field is an expression: ['coalesce', ['get', 'site_name'], ...]
        expect(Array.isArray(layer.layout['text-field'])).toBe(true);
        expect(layer.layout['text-field'][0]).toBe('coalesce');
        expect(layer.layout['text-field'][1]).toEqual(['get', 'site_name']);
    });

    it('falls back to label || name || tooltip when no field is supplied', () => {
        mount(map, { showLabels: true });
        const layer = map.getLayer(LAYER_LABEL);
        // ['coalesce', ['get','label'], ['get','name'], ['get','tooltip']]
        expect(layer.layout['text-field'][1]).toEqual(['get', 'label']);
        expect(layer.layout['text-field'][2]).toEqual(['get', 'name']);
        expect(layer.layout['text-field'][3]).toEqual(['get', 'tooltip']);
    });

    it('honours labelMinZoom', () => {
        mount(map, { showLabels: true, labelMinZoom: 5 });
        expect(map.getLayer(LAYER_LABEL).minzoom).toBe(5);
    });

    it('uses default labelMinZoom of 3 when option is missing', () => {
        mount(map, { showLabels: true });
        expect(map.getLayer(LAYER_LABEL).minzoom).toBe(3);
    });

    it('applies labelColor and labelHaloColor', () => {
        mount(map, {
            showLabels: true,
            labelColor: '#abcdef',
            labelHaloColor: '#123456'
        });
        const layer = map.getLayer(LAYER_LABEL);
        expect(layer.paint['text-color']).toBe('#abcdef');
        expect(layer.paint['text-halo-color']).toBe('#123456');
    });

    it('accepts legacy labelHalo alias for labelHaloColor', () => {
        mount(map, { showLabels: true, labelHalo: '#000000' });
        expect(map.getLayer(LAYER_LABEL).paint['text-halo-color']).toBe('#000000');
    });

    it('honours labelOffsetY', () => {
        mount(map, { showLabels: true, labelOffsetY: 2.5 });
        expect(map.getLayer(LAYER_LABEL).layout['text-offset']).toEqual([0, 2.5]);
    });

    it('reconciles existing label layer to visible:visible when showLabels turns on', () => {
        mount(map, { showLabels: true });
        // Simulate the formatter being toggled OFF
        mount(map, { showLabels: false });
        expect(map.getLayer(LAYER_LABEL).layout.visibility).toBe('none');
        // Toggled back ON
        mount(map, { showLabels: true });
        expect(map.getLayer(LAYER_LABEL).layout.visibility).toBe('visible');
    });
});

describe('markers — selection layer mount + filter (Tier 1 #1)', () => {
    let map;
    beforeEach(() => {
        map = makeFakeMap();
    });

    it('mounts LAYER_SELECTED_HALO and LAYER_SELECTED_DOT on first mount', () => {
        mount(map, {});
        expect(map.getLayer(LAYER_SELECTED_HALO)).toBeTruthy();
        expect(map.getLayer(LAYER_SELECTED_DOT)).toBeTruthy();
    });

    it('selection layers start with a never-match filter when no value is set', () => {
        mount(map, {});
        const f = map.getLayer(LAYER_SELECTED_HALO).filter;
        // Sentinel filter shape: ['==', ['literal', '__never_match__'], 'sentinel']
        expect(Array.isArray(f)).toBe(true);
        expect(f[0]).toBe('==');
        expect(JSON.stringify(f)).toContain('__never_match__');
    });

    it('applies an equality filter on the chosen field when value is set', () => {
        mount(map, {
            selectedFeatureField: 'site',
            selectedFeatureValue: 'NYC01'
        });
        const f = map.getLayer(LAYER_SELECTED_HALO).filter;
        expect(f[0]).toBe('==');
        // Left side: ['to-string', ['coalesce', ['get','site'], '']]
        expect(JSON.stringify(f[1])).toContain('"to-string"');
        expect(JSON.stringify(f[1])).toContain('"site"');
        expect(f[2]).toBe('NYC01');
    });

    it('applies the size multiplier to the selected dot radius', () => {
        // markers.DEFAULT_RADIUS is 6 (internal constant);
        // sizeMultiplier 3 -> 18.
        mount(map, {
            selectedFeatureField: 'id',
            selectedFeatureValue: 'X',
            selectedSizeMultiplier: 3
        });
        const dot = map.getLayer(LAYER_SELECTED_DOT);
        expect(dot.paint['circle-radius']).toBe(18);
    });

    it('honours selectedHaloColor and selectedHaloWidth', () => {
        mount(map, {
            selectedFeatureField: 'id',
            selectedFeatureValue: 'X',
            selectedHaloColor: '#ff8800',
            selectedHaloWidth: 6
        });
        const halo = map.getLayer(LAYER_SELECTED_HALO);
        expect(halo.paint['circle-color']).toBe('#ff8800');
        expect(halo.paint['circle-stroke-color']).toBe('#ff8800');
        expect(halo.paint['circle-stroke-width']).toBe(6);
    });
});

describe('markers — applySelection update path (Tier 1 #1)', () => {
    let map;
    let fc;
    beforeEach(() => {
        map = makeFakeMap();
        fc = makeFC([
            { coords: [10, 50], props: { id: 'A' } },
            { coords: [20, 60], props: { id: 'B' } },
            { coords: [30, 40], props: { id: 'NYC01' } }
        ]);
        mount(map, {});
        update(map, fc);
    });

    it('updating the selection rewrites the filter on both selection layers', () => {
        applySelection(map, fc, { field: 'id', value: 'NYC01' });
        const haloFilter = map.getLayer(LAYER_SELECTED_HALO).filter;
        const dotFilter = map.getLayer(LAYER_SELECTED_DOT).filter;
        expect(haloFilter[2]).toBe('NYC01');
        expect(dotFilter[2]).toBe('NYC01');
    });

    it('flies to the matching feature coordinates when flyToOnChange is true', () => {
        applySelection(map, fc, {
            field: 'id',
            value: 'NYC01',
            flyToOnChange: true,
            flyToZoom: 10
        });
        expect(map.flyTo).toHaveBeenCalledTimes(1);
        const args = map.flyToCalls[0];
        expect(args.center).toEqual([30, 40]);
        expect(args.zoom).toBe(10);
        // essential:true so reduced-motion doesn't cancel the navigation.
        expect(args.essential).toBe(true);
    });

    it('does not fly to when flyToOnChange is false', () => {
        applySelection(map, fc, {
            field: 'id',
            value: 'NYC01',
            flyToOnChange: false
        });
        expect(map.flyTo).not.toHaveBeenCalled();
    });

    it('flies to only ONCE on repeated calls with the same value', () => {
        applySelection(map, fc, { field: 'id', value: 'NYC01', flyToOnChange: true });
        applySelection(map, fc, { field: 'id', value: 'NYC01', flyToOnChange: true });
        applySelection(map, fc, { field: 'id', value: 'NYC01', flyToOnChange: true });
        expect(map.flyTo).toHaveBeenCalledTimes(1);
    });

    it('flies again when the value changes', () => {
        applySelection(map, fc, { field: 'id', value: 'A', flyToOnChange: true });
        applySelection(map, fc, { field: 'id', value: 'B', flyToOnChange: true });
        expect(map.flyTo).toHaveBeenCalledTimes(2);
        expect(map.flyToCalls[0].center).toEqual([10, 50]);
        expect(map.flyToCalls[1].center).toEqual([20, 60]);
    });

    it('does not fly to when the value does not match any feature', () => {
        applySelection(map, fc, { field: 'id', value: 'NOPE', flyToOnChange: true });
        // Filter still applied, but flyTo skipped (no coords).
        expect(map.getLayer(LAYER_SELECTED_HALO).filter[2]).toBe('NOPE');
        expect(map.flyTo).not.toHaveBeenCalled();
    });

    it('clears the never-match filter back to never-match when value goes null', () => {
        applySelection(map, fc, { field: 'id', value: 'A' });
        applySelection(map, fc, { field: 'id', value: null });
        const f = map.getLayer(LAYER_SELECTED_HALO).filter;
        expect(JSON.stringify(f)).toContain('__never_match__');
    });
});

describe('markers — unmount cleans up selection layers', () => {
    it('removes LAYER_SELECTED_HALO and LAYER_SELECTED_DOT', () => {
        const map = makeFakeMap();
        mount(map, {
            selectedFeatureField: 'id',
            selectedFeatureValue: 'X',
            showLabels: true
        });
        expect(map.getLayer(LAYER_SELECTED_HALO)).toBeTruthy();
        expect(map.getLayer(LAYER_SELECTED_DOT)).toBeTruthy();
        expect(map.getLayer(LAYER_LABEL)).toBeTruthy();
        expect(map.getLayer(LAYER_DOT)).toBeTruthy();
        unmount(map);
        expect(map.getLayer(LAYER_SELECTED_HALO)).toBeNull();
        expect(map.getLayer(LAYER_SELECTED_DOT)).toBeNull();
        expect(map.getLayer(LAYER_LABEL)).toBeNull();
        expect(map.getLayer(LAYER_DOT)).toBeNull();
    });
});
