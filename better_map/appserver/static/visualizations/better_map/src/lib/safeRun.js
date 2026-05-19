/*
 * safeRun — the boundary primitive used by every subsystem in Better Map
 * for the v1.8.0 stability release. See:
 *   docs/superpowers/specs/2026-05-19-map-stability-design.md
 *   docs/superpowers/plans/2026-05-19-phase-a-error-boundary-foundation.md
 *
 * Contract (cannot change without a major release):
 *
 *   safeRun({
 *       scope,                // errorScopes constant (required for prod use)
 *       severity = 'warning', // 'fatal' | 'warning' | 'info'
 *       recovery = 'soft',    // 'soft' | 'degrade' | 'fatal'
 *       panelRoot,            // DOM element for banner + custom event
 *       action,               // function — body wrapped in try/catch
 *       onError,              // function(err) — per-call cleanup
 *       rateLimitKey,         // defaults to scope
 *       dataShape             // optional PII-safe fingerprint
 *   })
 *
 * Returns: { ok: true, result } | { ok: false, error: envelope }
 *
 * Structural guarantee: safeRun NEVER throws. Reporter-itself
 * failure falls back to console.error.
 */

import { UNKNOWN } from './errorScopes.js';

// Test-only state. Mutable slot fields so __resetSafeRunState can
// swap atomically without re-exporting bindings.
const _state = {
    ringBuffer: [],
    ringCap: 50,
    reporter: null,
    nowFn: null
};

function _now() {
    return _state.nowFn ? _state.nowFn() : Date.now();
}

function _stringifyError(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    return String(err);
}

function _stackOf(err) {
    if (err && typeof err.stack === 'string') return err.stack;
    return '';
}

function _buildEnvelope(opts, err) {
    return {
        scope: opts.scope || UNKNOWN,
        severity: opts.severity || 'warning',
        recovery: opts.recovery || 'soft',
        message: _stringifyError(err),
        cause: err,
        stack: _stackOf(err),
        timestamp: _now(),
        dataShape: opts.dataShape || null
    };
}

function _safeOnError(onError, err) {
    if (typeof onError !== 'function') return;
    try {
        onError(err);
    } catch (cleanupErr) {
        try {
            // eslint-disable-next-line no-console
            console.error('[better_map:safeRun] onError handler threw:', cleanupErr);
        } catch (_) { /* nothing more we can do */ }
    }
}

function _defaultReporter(envelope) {
    try {
        const prefix = '[better_map:' + envelope.scope + '] ' + envelope.severity + ':';
        // eslint-disable-next-line no-console
        console.log(prefix, envelope.message);
    } catch (_) { /* console may be unavailable */ }
}

function _safeReport(envelope) {
    const reporter = _state.reporter || _defaultReporter;
    try {
        reporter(envelope);
    } catch (reporterErr) {
        try {
            // eslint-disable-next-line no-console
            console.error(
                '[better_map:safeRun-itself] reporter threw:',
                reporterErr,
                '\noriginal envelope:',
                envelope
            );
        } catch (_) { /* nothing more we can do */ }
    }
}

function _handleFailure(opts, err) {
    const envelope = _buildEnvelope(opts, err);
    _state.ringBuffer.push(envelope);
    if (_state.ringBuffer.length > _state.ringCap) {
        _state.ringBuffer.shift();
    }
    _safeReport(envelope);
    if (opts.panelRoot && typeof CustomEvent !== 'undefined') {
        try {
            opts.panelRoot.dispatchEvent(new CustomEvent('better_map:error', { detail: envelope }));
        } catch (_) { /* dispatch failure is never fatal */ }
    }
    _safeOnError(opts.onError, err);
    return { ok: false, error: envelope };
}

export function safeRun(opts) {
    if (!opts || typeof opts !== 'object') {
        opts = { action: function () {} };
    }
    const action = typeof opts.action === 'function' ? opts.action : function () {};
    try {
        const result = action();
        // (Async support is added in Task 5; for now treat all returns as sync.)
        return { ok: true, result: result };
    } catch (err) {
        return _handleFailure(opts, err);
    }
}

export function getRecentErrors(filter) {
    const all = _state.ringBuffer.slice();
    if (!filter) return all;
    if (filter.scope) {
        return all.filter(function (e) { return e.scope === filter.scope; });
    }
    return all;
}

export function clearErrorState(/* scope */) {
    // Backoff/quarantine state lives in Task 7; for now just clear ring buffer.
    _state.ringBuffer.length = 0;
}

// Test hooks (prefixed __ to discourage prod use).
export function __setReporter(fn) {
    _state.reporter = fn;
}

export function __setNow(fn) {
    _state.nowFn = fn;
}

export function __resetSafeRunState() {
    _state.ringBuffer.length = 0;
    _state.reporter = null;
    _state.nowFn = null;
}
