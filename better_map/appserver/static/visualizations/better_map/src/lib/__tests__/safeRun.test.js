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
