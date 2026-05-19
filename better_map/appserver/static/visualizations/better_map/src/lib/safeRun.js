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
import { pushBanner } from './errorStates.js';

// Test-only state. Mutable slot fields so __resetSafeRunState can
// swap atomically without re-exporting bindings.
const BACKOFF_SCHEDULE_MS = [1000, 5000, 30000];   // index = failureCount-1
const QUARANTINE_AT = BACKOFF_SCHEDULE_MS.length + 1;

const _state = {
    ringBuffer: [],
    ringCap: 50,
    reporter: null,
    nowFn: null,
    lastReportedAt: {},       // map<rateLimitKey, timestamp-ms>
    backoff: {}               // map<scope, { failures: number, nextAllowedAt: number }>
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
    const key = opts.rateLimitKey || envelope.scope;
    const now = envelope.timestamp;
    const last = _state.lastReportedAt[key] || 0;
    if (now - last >= 1000) {
        _state.lastReportedAt[key] = now;
        _safeReport(envelope);
    }
    // Banner routing: only for degrade/fatal, only with panelRoot, never
    // during destroy (dataset.bmDestroying flag).
    const destroying = opts.panelRoot
        && opts.panelRoot.dataset
        && opts.panelRoot.dataset.bmDestroying === '1';
    if (opts.panelRoot && !destroying
        && (envelope.recovery === 'degrade' || envelope.recovery === 'fatal')) {
        try {
            pushBanner(opts.panelRoot, envelope);
        } catch (_) { /* banner routing failure is never fatal */ }
    }
    if (opts.panelRoot && typeof CustomEvent !== 'undefined') {
        try {
            opts.panelRoot.dispatchEvent(new CustomEvent('better_map:error', { detail: envelope }));
        } catch (_) { /* dispatch failure is never fatal */ }
    }
    _safeOnError(opts.onError, err);
    return { ok: false, error: envelope };
}

function _isThenable(v) {
    return v != null
        && (typeof v === 'object' || typeof v === 'function')
        && typeof v.then === 'function';
}

function _getBackoff(scope) {
    if (!_state.backoff[scope]) {
        _state.backoff[scope] = { failures: 0, nextAllowedAt: 0 };
    }
    return _state.backoff[scope];
}

function _onSuccess(scope) {
    if (_state.backoff[scope]) {
        delete _state.backoff[scope];
    }
}

function _onFailure(scope, now) {
    const b = _getBackoff(scope);
    b.failures += 1;
    if (b.failures >= QUARANTINE_AT) {
        b.nextAllowedAt = Infinity;
    } else {
        b.nextAllowedAt = now + BACKOFF_SCHEDULE_MS[b.failures - 1];
    }
}

function _isQuarantined(scope) {
    const b = _state.backoff[scope];
    return !!b && b.nextAllowedAt === Infinity;
}

export function safeRun(opts) {
    if (!opts || typeof opts !== 'object') {
        opts = { action: function () {} };
    }
    const action = typeof opts.action === 'function' ? opts.action : function () {};
    const scope = opts.scope || UNKNOWN;
    const now = _now();
    const b = _state.backoff[scope];
    if (b && now < b.nextAllowedAt) {
        return {
            ok: false,
            error: {
                scope: scope,
                severity: opts.severity || 'warning',
                recovery: opts.recovery || 'soft',
                message: 'backoff',
                cause: null,
                stack: '',
                timestamp: now,
                dataShape: null,
                backoff: true,
                quarantined: _isQuarantined(scope)
            }
        };
    }
    let result;
    try {
        result = action();
    } catch (err) {
        _onFailure(scope, now);
        return _handleFailure(opts, err);
    }
    if (_isThenable(result)) {
        return result.then(
            function (value) {
                _onSuccess(scope);
                return { ok: true, result: value };
            },
            function (err) {
                _onFailure(scope, _now());
                return _handleFailure(opts, err);
            }
        );
    }
    _onSuccess(scope);
    return { ok: true, result: result };
}

export function getRecentErrors(filter) {
    const all = _state.ringBuffer.slice();
    if (!filter) return all;
    if (filter.scope) {
        return all.filter(function (e) { return e.scope === filter.scope; });
    }
    return all;
}

export function clearErrorState(scope) {
    if (scope == null) {
        _state.ringBuffer.length = 0;
        _state.backoff = {};
        _state.lastReportedAt = {};
    } else {
        delete _state.backoff[scope];
        delete _state.lastReportedAt[scope];
        // Ring buffer kept; it's a global log, not a per-scope state.
    }
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
    _state.lastReportedAt = {};
    _state.backoff = {};
}
