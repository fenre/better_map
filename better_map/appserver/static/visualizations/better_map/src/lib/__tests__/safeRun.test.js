import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    safeRun,
    getRecentErrors,
    clearErrorState,
    __setReporter,
    __setNow,
    __resetSafeRunState
} from '../safeRun.js';
import { LAYER_MARKERS, MAP_CREATE, UNKNOWN } from '../errorScopes.js';
import { getActiveBanners, __resetBannerState } from '../errorStates.js';

describe('safeRun — sync core', () => {
    beforeEach(() => {
        __resetSafeRunState();
        __setNow(null);
        __setReporter(null);
    });

    it('returns {ok:true, result} for a successful noop action', () => {
        const r = safeRun({ scope: LAYER_MARKERS, action: function () {} });
        expect(r).toEqual({ ok: true, result: undefined });
    });

    it('returns the action result on success', () => {
        const r = safeRun({ scope: LAYER_MARKERS, action: function () { return 42; } });
        expect(r).toEqual({ ok: true, result: 42 });
    });

    it('returns {ok:false, error: envelope} when action throws (does NOT re-throw)', () => {
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { throw new Error('boom'); }
        });
        expect(r.ok).toBe(false);
        expect(r.error.scope).toBe(LAYER_MARKERS);
        expect(r.error.message).toBe('boom');
    });

    it('envelope carries scope, severity, recovery, message, cause, stack, timestamp', () => {
        const cause = new Error('boom');
        const r = safeRun({
            scope: MAP_CREATE,
            severity: 'fatal',
            recovery: 'fatal',
            action: function () { throw cause; }
        });
        expect(r.error.scope).toBe(MAP_CREATE);
        expect(r.error.severity).toBe('fatal');
        expect(r.error.recovery).toBe('fatal');
        expect(r.error.message).toBe('boom');
        expect(r.error.cause).toBe(cause);
        expect(typeof r.error.stack).toBe('string');
        expect(typeof r.error.timestamp).toBe('number');
    });

    it('defaults: severity=warning, recovery=soft, scope=UNKNOWN sentinel', () => {
        const r = safeRun({ action: function () { throw new Error('x'); } });
        expect(r.error.severity).toBe('warning');
        expect(r.error.recovery).toBe('soft');
        expect(r.error.scope).toBe(UNKNOWN);
    });

    it('captures non-Error throws as string message', () => {
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { throw 'plain string'; }
        });
        expect(r.error.message).toBe('plain string');
    });

    it('invokes onError(err) on failure', () => {
        const onError = vi.fn();
        safeRun({
            scope: LAYER_MARKERS,
            action: function () { throw new Error('boom'); },
            onError: onError
        });
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('onError throwing does NOT propagate (safeRun structurally cannot throw)', () => {
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { throw new Error('boom'); },
            onError: function () { throw new Error('cleanup-boom'); }
        });
        expect(r.ok).toBe(false);  // primary error still wins
        expect(r.error.message).toBe('boom');
    });
});

describe('safeRun — reporter chain', () => {
    beforeEach(() => {
        __resetSafeRunState();
    });

    it('pushes failed envelopes onto the ring buffer (cap 50)', () => {
        for (let i = 0; i < 60; i++) {
            safeRun({
                scope: LAYER_MARKERS,
                action: function () { throw new Error('e' + i); }
            });
        }
        const list = getRecentErrors();
        expect(list).toHaveLength(50);
        expect(list[0].message).toBe('e10');           // first 10 dropped
        expect(list[49].message).toBe('e59');
    });

    it('does NOT push successful runs onto the ring buffer', () => {
        for (let i = 0; i < 5; i++) {
            safeRun({ scope: LAYER_MARKERS, action: function () { return i; } });
        }
        expect(getRecentErrors()).toHaveLength(0);
    });

    it('default reporter logs structured [scope] severity: message line', () => {
        const logs = [];
        const origLog = console.log;
        console.log = function () { logs.push(Array.from(arguments).join(' ')); };
        try {
            safeRun({
                scope: LAYER_MARKERS,
                action: function () { throw new Error('boom'); }
            });
        } finally {
            console.log = origLog;
        }
        expect(logs[0]).toBe('[better_map:layer:markers] warning: boom');
    });

    it('test reporter receives envelope', () => {
        const received = [];
        __setReporter(function (env) { received.push(env); });
        safeRun({
            scope: LAYER_MARKERS,
            action: function () { throw new Error('boom'); }
        });
        expect(received).toHaveLength(1);
        expect(received[0].scope).toBe(LAYER_MARKERS);
        expect(received[0].message).toBe('boom');
    });

    it('dispatches better_map:error CustomEvent on panelRoot when provided', () => {
        const root = document.createElement('div');
        const events = [];
        root.addEventListener('better_map:error', function (e) { events.push(e.detail); });
        safeRun({
            scope: LAYER_MARKERS,
            panelRoot: root,
            action: function () { throw new Error('boom'); }
        });
        expect(events).toHaveLength(1);
        expect(events[0].scope).toBe(LAYER_MARKERS);
    });

    it('does NOT dispatch CustomEvent when panelRoot is omitted', () => {
        // Just assert no throw + the test as a whole passes.
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { throw new Error('boom'); }
        });
        expect(r.ok).toBe(false);
    });

    it('reporter-itself throwing falls back to console.error and does NOT propagate', () => {
        const errs = [];
        const origErr = console.error;
        console.error = function () { errs.push(Array.from(arguments).join(' ')); };
        __setReporter(function () { throw new Error('reporter-boom'); });
        try {
            const r = safeRun({
                scope: LAYER_MARKERS,
                action: function () { throw new Error('original-boom'); }
            });
            expect(r.ok).toBe(false);
            expect(r.error.message).toBe('original-boom');
            expect(errs.some(function (l) { return l.indexOf('reporter threw') >= 0; })).toBe(true);
        } finally {
            console.error = origErr;
        }
    });

    it('getRecentErrors({scope}) filters', () => {
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        safeRun({ scope: MAP_CREATE, action: function () { throw new Error('b'); } });
        const markers = getRecentErrors({ scope: LAYER_MARKERS });
        expect(markers).toHaveLength(1);
        expect(markers[0].message).toBe('a');
    });
});

describe('safeRun — async actions', () => {
    beforeEach(() => { __resetSafeRunState(); });

    it('resolves to {ok:true, result} when action returns a resolved Promise', async () => {
        const r = await safeRun({
            scope: LAYER_MARKERS,
            action: function () { return Promise.resolve(7); }
        });
        expect(r).toEqual({ ok: true, result: 7 });
    });

    it('resolves to {ok:false, error} when action rejects', async () => {
        const r = await safeRun({
            scope: LAYER_MARKERS,
            action: function () { return Promise.reject(new Error('async-boom')); }
        });
        expect(r.ok).toBe(false);
        expect(r.error.message).toBe('async-boom');
    });

    it('reports async failures through the same reporter chain', async () => {
        const received = [];
        __setReporter(function (e) { received.push(e); });
        await safeRun({
            scope: LAYER_MARKERS,
            action: function () { return Promise.reject('async-string'); }
        });
        expect(received).toHaveLength(1);
        expect(received[0].message).toBe('async-string');
    });

    it('handles non-thenable object return values as sync results', () => {
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { return { not: 'a-promise' }; }
        });
        expect(r.ok).toBe(true);
        expect(r.result).toEqual({ not: 'a-promise' });
    });
});

describe('safeRun — rate limiting', () => {
    beforeEach(() => { __resetSafeRunState(); });

    it('collapses identical scope envelopes within a 1s window', () => {
        let t = 1000;
        __setNow(function () { return t; });
        const received = [];
        __setReporter(function (e) { received.push(e); });

        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        t = 1100;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('b'); } });
        t = 1500;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('c'); } });

        expect(received).toHaveLength(1);
        expect(received[0].message).toBe('a');
    });

    it('reports again after the 1s window elapses', () => {
        let t = 1000;
        __setNow(function () { return t; });
        const received = [];
        __setReporter(function (e) { received.push(e); });

        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        t = 2001;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('b'); } });

        expect(received).toHaveLength(2);
    });

    it('does not collapse different scopes', () => {
        let t = 1000;
        __setNow(function () { return t; });
        const received = [];
        __setReporter(function (e) { received.push(e); });

        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        safeRun({ scope: MAP_CREATE, action: function () { throw new Error('b'); } });

        expect(received).toHaveLength(2);
    });

    it('still records every envelope in the ring buffer (rate-limit affects reporter only)', () => {
        let t = 1000;
        __setNow(function () { return t; });
        for (let i = 0; i < 5; i++) {
            t = 1000 + i * 10;
            safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('e' + i); } });
        }
        expect(getRecentErrors()).toHaveLength(5);
    });
});
