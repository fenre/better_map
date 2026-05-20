/*
 * crossPanel.test.js — Tier 1 #2 wiring tests (v1.7).
 *
 * crossPanel.applyRemoteCamera() previously existed but nothing called
 * it; v1.7 adds an instance-method form via createCrossPanel() that
 *   1. ignores values that match the current camera (within threshold)
 *   2. suppresses outbound broadcast for ~350ms after an inbound jump,
 *      so paired panels don't ping-pong forever via moveend echoes
 *   3. accepts the {lng, lat, zoom} object form used by mapBuilder
 *
 * These behaviours are how the feature stays compatible with
 * `enableCrossPanel: true` already being on by default — without the
 * suppression, two Better Map panels on the same dashboard would
 * lock-step each other into an infinite token-publish loop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createCrossPanel,
    applyRemoteCamera,
    tokenNames
} from '../crossPanel.js';

// Minimal map double — only the methods crossPanel touches.
function fakeMap(initial) {
    const cur = Object.assign(
        { lng: 0, lat: 0, zoom: 2, pitch: 0, bearing: 0 },
        initial || {}
    );
    const listeners = {};
    return {
        _state: cur,
        getCenter: () => ({ lng: cur.lng, lat: cur.lat }),
        getZoom: () => cur.zoom,
        getPitch: () => cur.pitch,
        getBearing: () => cur.bearing,
        on: (ev, fn) => {
            (listeners[ev] = listeners[ev] || []).push(fn);
        },
        off: (ev, fn) => {
            if (!listeners[ev]) return;
            listeners[ev] = listeners[ev].filter((x) => x !== fn);
        },
        _emit: (ev) => {
            (listeners[ev] || []).forEach((fn) => fn());
        },
        jumpTo: vi.fn(function (next) {
            if (next.center) {
                cur.lng = next.center[0];
                cur.lat = next.center[1];
            }
            if (Number.isFinite(next.zoom)) cur.zoom = next.zoom;
            if (Number.isFinite(next.pitch)) cur.pitch = next.pitch;
            if (Number.isFinite(next.bearing)) cur.bearing = next.bearing;
        })
    };
}

function fakeViz() {
    const tokensPublished = [];
    return {
        tokensPublished: tokensPublished,
        getDashboardEvents: () => ({
            publish: (msg) => {
                if (msg && msg.payload) tokensPublished.push(msg.payload);
            }
        })
    };
}

describe('crossPanel.applyRemoteCamera (instance form)', () => {
    let map;
    let viz;
    let cp;

    beforeEach(() => {
        map = fakeMap({ lng: 10, lat: 50, zoom: 4 });
        viz = fakeViz();
        cp = createCrossPanel(map, viz, { minIntervalMs: 0 });
    });

    it('moves the camera to the requested {lng, lat, zoom}', () => {
        cp.applyRemoteCamera({ lng: -73.5, lat: 40.7, zoom: 8 });
        expect(map.jumpTo).toHaveBeenCalledTimes(1);
        expect(map._state.lng).toBeCloseTo(-73.5);
        expect(map._state.lat).toBeCloseTo(40.7);
        expect(map._state.zoom).toBe(8);
    });

    it('is a no-op when the requested view matches the current view', () => {
        cp.applyRemoteCamera({ lng: 10, lat: 50, zoom: 4 });
        expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it('is a no-op when only zoom changes by < 0.05', () => {
        cp.applyRemoteCamera({ lng: 10, lat: 50, zoom: 4.01 });
        expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it('is a no-op when invalid lng/lat are passed', () => {
        cp.applyRemoteCamera({ lng: NaN, lat: 40, zoom: 8 });
        expect(map.jumpTo).not.toHaveBeenCalled();
        cp.applyRemoteCamera({ lng: 0, lat: undefined, zoom: 8 });
        expect(map.jumpTo).not.toHaveBeenCalled();
        cp.applyRemoteCamera(null);
        expect(map.jumpTo).not.toHaveBeenCalled();
        cp.applyRemoteCamera({});
        expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it('falls back to current zoom when remote zoom is missing', () => {
        cp.applyRemoteCamera({ lng: 1, lat: 2 });
        expect(map.jumpTo).toHaveBeenCalledTimes(1);
        expect(map._state.lng).toBeCloseTo(1);
        expect(map._state.lat).toBeCloseTo(2);
        expect(map._state.zoom).toBe(4); // unchanged
    });

    it('suppresses outbound broadcast for ~350ms after an inbound jump', () => {
        // Reset broadcast tracking from any setup-time emits.
        viz.tokensPublished.length = 0;
        // Inbound jump.
        cp.applyRemoteCamera({ lng: -73.5, lat: 40.7, zoom: 8 });
        // Inbound jump must not itself broadcast.
        expect(viz.tokensPublished.length).toBe(0);
        // moveend during the suppression window — ignored.
        map._emit('moveend');
        expect(viz.tokensPublished.length).toBe(0);
    });

    it('resumes broadcast after the suppression window', async () => {
        viz.tokensPublished.length = 0;
        cp.applyRemoteCamera({ lng: -73.5, lat: 40.7, zoom: 8 });
        // Move the synthetic clock past the suppression window. We
        // rely on minIntervalMs:0 to ensure broadcast is otherwise
        // not throttled.
        await new Promise((r) => setTimeout(r, 400));
        map._emit('moveend');
        expect(viz.tokensPublished.length).toBe(1);
        const t = viz.tokensPublished[0];
        expect(t['better_map.camera.lng']).toBeCloseTo(-73.5);
        expect(t['better_map.camera.lat']).toBeCloseTo(40.7);
        expect(t['better_map.camera.zoom']).toBe(8);
    });

    it('destroy() unhooks the moveend listener so post-destroy events do not broadcast', () => {
        viz.tokensPublished.length = 0;
        cp.destroy();
        map._emit('moveend');
        expect(viz.tokensPublished.length).toBe(0);
    });
});

describe('crossPanel.applyRemoteCamera (legacy token-bag form)', () => {
    // The module's top-level applyRemoteCamera() reads from a tokens
    // bag (the legacy Dashboard Studio API). Verify it still works
    // for callers that prefer this shape.

    it('moves the camera from a token bag', () => {
        const map = fakeMap({ lng: 0, lat: 0, zoom: 2 });
        applyRemoteCamera(map, {
            'better_map.camera.lng': 11,
            'better_map.camera.lat': 22,
            'better_map.camera.zoom': 5
        });
        expect(map.jumpTo).toHaveBeenCalledTimes(1);
        expect(map._state.lng).toBe(11);
        expect(map._state.lat).toBe(22);
        expect(map._state.zoom).toBe(5);
    });

    it('is a no-op when the tokens bag is incomplete', () => {
        const map = fakeMap({ lng: 0, lat: 0, zoom: 2 });
        applyRemoteCamera(map, {
            'better_map.camera.lng': 11
            // lat missing
        });
        expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it('exposes the canonical token name list', () => {
        const names = tokenNames();
        expect(names).toContain('better_map.camera.lng');
        expect(names).toContain('better_map.camera.lat');
        expect(names).toContain('better_map.camera.zoom');
    });
});
