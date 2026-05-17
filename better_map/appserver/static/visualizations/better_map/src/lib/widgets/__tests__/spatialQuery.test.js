/*
 * spatialQuery.test.js — SPATIAL-1 regression coverage.
 *
 * This test file's primary purpose is to assert the SPATIAL-1 token
 * contract: the default tokenName is `better_map.spatial_query` to
 * match the showcase dashboard, savedsearches.conf.spec, and
 * formatter.html. If a future refactor reverts to `bm_spatial_filter`
 * (or any other name), this test fails the PR and the regression is
 * caught BEFORE the showcase dashboard silently breaks.
 *
 * It also covers the SPL fragment shapes for polygon, rectangle,
 * circle, and lasso-selection emit paths so the dashboard authors can
 * rely on a stable contract.
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {createSpatialQuery} from '../spatialQuery.js';

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function fireDrawFinished(el, feature, mode) {
    const evt = new CustomEvent('bm:draw-finished', {
        detail: {feature, mode},
    });
    el.dispatchEvent(evt);
}

function fireLassoSelect(el, features) {
    const evt = new CustomEvent('bm:lasso-select', {
        detail: {features},
    });
    el.dispatchEvent(evt);
}

describe('createSpatialQuery — SPATIAL-1 contract', () => {
    let container;

    beforeEach(() => {
        // Fresh DOM root per test so token nudges don't accumulate.
        document.body.innerHTML = '';
        container = makeContainer();
    });

    it('default tokenName MUST be "better_map.spatial_query" (SPATIAL-1)', () => {
        // The showcase dashboard (better_map_spatial_analytics.xml),
        // savedsearches.conf.spec entry, and formatter.html help text
        // all reference this exact token name. If this assertion ever
        // changes, the dashboard wiring is silently broken.
        const sq = createSpatialQuery(container, {});
        expect(sq.tokenName).toBe('better_map.spatial_query');
    });

    it('respects an explicit tokenName override', () => {
        const sq = createSpatialQuery(container, {tokenName: 'custom.token'});
        expect(sq.tokenName).toBe('custom.token');
    });

    it('exposes the BM-CT-1 control trio (setEnabled/isEnabled/reset)', () => {
        const sq = createSpatialQuery(container, {});
        expect(typeof sq.setEnabled).toBe('function');
        expect(typeof sq.isEnabled).toBe('function');
        expect(typeof sq.reset).toBe('function');
        // Default state per BM-CT-1: enabled by construction.
        expect(sq.isEnabled()).toBe(true);
        sq.setEnabled(false);
        expect(sq.isEnabled()).toBe(false);
        sq.setEnabled(true);
        expect(sq.isEnabled()).toBe(true);
    });

    it('emits a polygon geomatch SPL fragment on bm:draw-finished (polygon)', () => {
        const sq = createSpatialQuery(container, {});
        const feature = {
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-122.42, 37.78],
                    [-122.40, 37.78],
                    [-122.40, 37.80],
                    [-122.42, 37.80],
                    [-122.42, 37.78],
                ]],
            },
            properties: {mode: 'polygon'},
        };
        fireDrawFinished(container, feature, 'polygon');
        const spl = sq.getLastSpl();
        expect(spl).toContain('| where geomatch(lat, lon, "POLYGON((');
        expect(spl).toContain('-122.420000 37.780000');
        expect(spl).toMatch(/POLYGON\(\(.*\)\)\\?"\)/);
    });

    it('emits a polygon SPL on rectangle mode (same path as polygon)', () => {
        const sq = createSpatialQuery(container, {});
        const feature = {
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-122.5, 37.7],
                    [-122.4, 37.7],
                    [-122.4, 37.8],
                    [-122.5, 37.8],
                    [-122.5, 37.7],
                ]],
            },
            properties: {mode: 'rectangle'},
        };
        fireDrawFinished(container, feature, 'rectangle');
        expect(sq.getLastSpl()).toContain('| where geomatch');
    });

    it('emits a haversine SPL on bm:draw-finished (circle)', () => {
        const sq = createSpatialQuery(container, {});
        const feature = {
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-122.43, 37.77],
                    [-122.42, 37.78],
                    [-122.41, 37.77],
                    [-122.42, 37.76],
                    [-122.43, 37.77],
                ]],
            },
            properties: {mode: 'circle', radiusKm: 2.5},
        };
        fireDrawFinished(container, feature, 'circle');
        const spl = sq.getLastSpl();
        // Haversine on the centroid lat/lon with cleanup of the _km field.
        expect(spl).toContain('| eval _km =');
        expect(spl).toContain('acos(sin(lat*pi()/180)');
        expect(spl).toContain('| where _km < 2.500');
        expect(spl).toContain('| fields - _km');
    });

    it('emits a quoted ID IN-list on bm:lasso-select', () => {
        const sq = createSpatialQuery(container, {});
        fireLassoSelect(container, [
            {id: 'host-1'},
            {id: 'host-2'},
            {id: 'host-with"quote'},
        ]);
        const spl = sq.getLastSpl();
        expect(spl).toBe('| where id IN ("host-1", "host-2", "host-with\\"quote")');
    });

    it('does not emit anything when no features are selected (lasso)', () => {
        const sq = createSpatialQuery(container, {});
        fireLassoSelect(container, []);
        expect(sq.getLastSpl()).toBe('');
    });

    it('does not emit anything when disabled', () => {
        const sq = createSpatialQuery(container, {});
        sq.setEnabled(false);
        const feature = {
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-122.42, 37.78],
                    [-122.40, 37.78],
                    [-122.40, 37.80],
                    [-122.42, 37.80],
                    [-122.42, 37.78],
                ]],
            },
            properties: {mode: 'polygon'},
        };
        fireDrawFinished(container, feature, 'polygon');
        expect(sq.getLastSpl()).toBe('');
    });

    it('calls the tokenSetter callback with name + SPL', () => {
        let called = null;
        // We only need the constructor's side effect (event listeners
        // on `container`); the returned handle is intentionally unused.
        // eslint-disable-next-line no-unused-vars
        const _sq = createSpatialQuery(container, {
            tokenSetter: (name, value) => {
                called = {name, value};
            },
        });
        fireLassoSelect(container, [{id: 'x'}]);
        expect(called).not.toBeNull();
        expect(called.name).toBe('better_map.spatial_query');
        expect(called.value).toContain('| where id IN ("x")');
    });

    it('reset() clears the last SPL and notifies the tokenSetter', () => {
        const calls = [];
        const sq = createSpatialQuery(container, {
            tokenSetter: (name, value) => calls.push({name, value}),
        });
        fireLassoSelect(container, [{id: 'x'}]);
        expect(sq.getLastSpl()).not.toBe('');
        expect(calls).toHaveLength(1);

        sq.reset();
        expect(sq.getLastSpl()).toBe('');
        // reset() emits an empty token value so dashboards clear the filter.
        expect(calls).toHaveLength(2);
        expect(calls[1]).toEqual({name: 'better_map.spatial_query', value: ''});
    });

    it('honours custom latField / lonField / idField', () => {
        const sq = createSpatialQuery(container, {
            latField: 'latitude',
            lonField: 'longitude',
            idField: 'asset_id',
        });
        // Polygon path uses latField + lonField.
        fireDrawFinished(container, {
            geometry: {type: 'Polygon', coordinates: [[[-1, 1], [1, 1], [1, -1], [-1, -1], [-1, 1]]]},
            properties: {mode: 'polygon'},
        }, 'polygon');
        expect(sq.getLastSpl()).toContain('geomatch(latitude, longitude,');
        // ID path uses idField.
        fireLassoSelect(container, [{id: 'A1'}]);
        expect(sq.getLastSpl()).toContain('| where asset_id IN ("A1")');
    });

    it('dispatches a bm:spatial-query CustomEvent containing the SPL', () => {
        // Constructor side effect again — we wire the listener and
        // then dispatch the trigger event; the returned handle is
        // intentionally unused for this assertion.
        // eslint-disable-next-line no-unused-vars
        const _sq = createSpatialQuery(container, {});
        const received = [];
        container.addEventListener('bm:spatial-query', (e) => {
            received.push(e.detail);
        });
        fireLassoSelect(container, [{id: 'q'}]);
        expect(received).toHaveLength(1);
        expect(received[0].token).toBe('better_map.spatial_query');
        expect(received[0].spl).toContain('| where id IN ("q")');
    });
});
