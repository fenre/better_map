# Phase A — Error Boundary Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundation primitives for the v1.8.0 stability release — `safeRun.js` (boundary primitive + ring buffer + rate-limiter + backoff), `errorScopes.js` (central scope registry), `errorStates.pushBanner` helper (banner stacking with priority + badge), and a debugHud Errors-tab scaffold — as pure additions with no behaviour change for any existing call site.

**Architecture:** Phase A is the scaffolding tier of the design spec at [`docs/superpowers/specs/2026-05-19-map-stability-design.md`](../specs/2026-05-19-map-stability-design.md). It introduces the `safeRun({scope, severity, recovery, panelRoot, action, onError})` boundary contract and the `errorScope` constants used by every later phase. No caller is wired yet — Phase B wraps the first call sites. This separation guarantees Phase A is risk-free to land on `main`.

**Tech stack:** Vitest 4 + jsdom 25 (tests), Webpack 5 + style-loader (bundle), ESLint 8 (lint), Node ≥ 20.12.

**Working directory for all commands:** `better_map/appserver/static/visualizations/better_map/`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/errorScopes.js` | CREATE | Stable constants for every subsystem that will use `safeRun`. Single source of truth for scope strings. |
| `src/lib/__tests__/errorScopes.test.js` | CREATE | Smoke test: constants are unique, non-empty strings. |
| `src/lib/safeRun.js` | CREATE | Boundary primitive: envelope build, try/catch, ring buffer (50), console reporter (rate-limited), backoff per scope, `dispatch CustomEvent('better_map:error')`, banner routing via `errorStates.pushBanner`. |
| `src/lib/__tests__/safeRun.test.js` | CREATE | ~30 unit cases covering sync, async, envelope shape, reporter chain, rate limiting, backoff, destroy-flag suppression, reporter-itself fallback. |
| `src/lib/errorStates.js` | MODIFY | Add `pushBanner(envelope)` helper + internal active-envelope map; preserve `renderErrorBanner` / `clearErrorBanner` API. |
| `src/lib/__tests__/errorStates.test.js` | CREATE | ~15 cases: existing-API regression + `pushBanner` priority, badge, dismissal. |
| `src/lib/debugHud.js` | MODIFY | Add Errors-tab scaffold (listens on `better_map:error`, renders scope-grouped count). Behind same `showDebugHud` formatter option. |
| `src/lib/__tests__/debugHud.test.js` (if absent) | CREATE | Scaffold smoke test: tab appears, event populates counter. |

**No other source files are modified in Phase A.** No callers of `safeRun` exist after Phase A — that's Phase B's job.

---

## Self-Review Checklist (run at end)

- Every test code block actually exercises the symbol it claims to test.
- Every `Run` command shows the expected stdout snippet.
- Type / signature consistency: `safeRun({…})` shape never drifts across tasks.
- No "TBD" / "TODO" / "similar to" placeholders.
- Spec coverage: errorScope registry, safeRun primitive, ring buffer (50), rate-limit 1s, backoff 0/1s/5s/30s/quarantined, async, destroy-flag, banner stacking, HUD scaffold — all present.

---

## Task 1: `errorScopes.js` — scope registry

**Files:**
- Create: `src/lib/errorScopes.js`
- Test:   `src/lib/__tests__/errorScopes.test.js`

- [ ] **Step 1.1: Write the failing tests**

Create `src/lib/__tests__/errorScopes.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as scopes from '../errorScopes.js';

describe('errorScopes', () => {
    it('exports only string constants', () => {
        const values = Object.values(scopes);
        expect(values.length).toBeGreaterThan(0);
        values.forEach((v) => expect(typeof v).toBe('string'));
        values.forEach((v) => expect(v.length).toBeGreaterThan(0));
    });

    it('has unique values (no scope-string drift)', () => {
        const values = Object.values(scopes);
        const seen = new Set(values);
        expect(seen.size).toBe(values.length);
    });

    it('uses colon-separated namespaces', () => {
        const values = Object.values(scopes);
        values.forEach((v) => {
            expect(v).toMatch(/^[a-z]+(:[a-z0-9_-]+)+$/);
        });
    });

    it('exposes the lifecycle, layer, widget, data, and maplibre families', () => {
        expect(scopes.LIFECYCLE_INITIALIZE).toBe('lifecycle:initialize');
        expect(scopes.LIFECYCLE_FORMAT_DATA).toBe('lifecycle:format-data');
        expect(scopes.LAYER_MARKERS).toBe('layer:markers');
        expect(scopes.WIDGET_GEOCODER).toBe('widget:geocoder');
        expect(scopes.DATA_SPL).toBe('data:spl');
        expect(scopes.MAPLIBRE_INTERNAL).toBe('maplibre:internal');
    });
});
```

- [ ] **Step 1.2: Run the test, confirm it fails**

```bash
npm test -- src/lib/__tests__/errorScopes.test.js
```

Expected: `Cannot find module '../errorScopes.js'` (module does not exist yet).

- [ ] **Step 1.3: Implement `errorScopes.js`**

Create `src/lib/errorScopes.js`:

```js
/*
 * Central registry of error scope identifiers used by safeRun.js.
 *
 * Every subsystem that opts into the safeRun boundary MUST reference one
 * of these constants. Free-form scope strings are NOT permitted because
 * they cause drift like 'layer:markers' vs 'layers/markers' vs
 * 'marker-layer' and break HUD grouping / log greps / rate-limit keys.
 *
 * Naming convention: lowercase, colon-separated namespaces.
 *   <family>:<subsystem>[:<detail>]
 *
 * Families:
 *   lifecycle - Splunk visualization-lifecycle methods
 *   map       - mapBuilder + MapLibre wrapper code we own
 *   maplibre  - errors that MapLibre itself emits via map.on('error')
 *   layer     - one of the data-layer strategies (markers, heatmap, ...)
 *   widget    - one of the optional UI widgets (geocoder, draw, ...)
 *   data      - data sources (SPL, AI Geo, ITSI, ES Notable, geocoder fetch)
 *   basemap   - basemap loaders (PMTiles, custom protocols)
 */

// Lifecycle (Splunk visualization API methods)
export const LIFECYCLE_INITIALIZE = 'lifecycle:initialize';
export const LIFECYCLE_FORMAT_DATA = 'lifecycle:format-data';
export const LIFECYCLE_UPDATE_VIEW = 'lifecycle:update-view';
export const LIFECYCLE_REFLOW = 'lifecycle:reflow';
export const LIFECYCLE_DESTROY = 'lifecycle:destroy';

// Map (our wrapper around MapLibre)
export const MAP_CREATE = 'map:create';
export const MAP_SET_STYLE = 'map:set-style';
export const MAP_REMOUNT_LAYERS = 'map:remount-layers';
export const MAP_WHEN_READY = 'map:when-ready';

// MapLibre internal errors (bridged from map.on('error'))
export const MAPLIBRE_INTERNAL = 'maplibre:internal';

// Layers
export const LAYER_MARKERS = 'layer:markers';
export const LAYER_CLUSTERS = 'layer:clusters';
export const LAYER_HEATMAP = 'layer:heatmap';
export const LAYER_PATHS = 'layer:paths';
export const LAYER_HEXBIN = 'layer:hexbin';
export const LAYER_EXTRUSION = 'layer:extrusion';
export const LAYER_KML = 'layer:kml';
export const LAYER_WMS = 'layer:wms';
export const LAYER_GEOFENCE = 'layer:geofence';
export const LAYER_SCENEGRAPH = 'layer:scenegraph';
export const LAYER_WIND = 'layer:wind';
export const LAYER_TRIPS = 'layer:trips';
export const LAYER_MIL2525 = 'layer:mil2525';

// Widgets (v2 bundle)
export const WIDGET_GEOCODER = 'widget:geocoder';
export const WIDGET_COMMAND_PALETTE = 'widget:command-palette';
export const WIDGET_MINIMAP = 'widget:minimap';
export const WIDGET_DRAW_TOOLS = 'widget:draw-tools';
export const WIDGET_MEASURE = 'widget:measure';
export const WIDGET_LASSO = 'widget:lasso';
export const WIDGET_BRUSHING = 'widget:brushing';
export const WIDGET_SIDE_BY_SIDE = 'widget:side-by-side';
export const WIDGET_SPATIAL_QUERY = 'widget:spatial-query';
export const WIDGET_TIME_SPLIT = 'widget:time-split';
export const WIDGET_MARKDOWN_POPUP = 'widget:markdown-popup';

// Data sources
export const DATA_SPL = 'data:spl';
export const DATA_AI_GEO = 'data:ai-geo';
export const DATA_ITSI = 'data:itsi';
export const DATA_ES_NOTABLE = 'data:es-notable';
export const DATA_MITRE = 'data:mitre';
export const DATA_SOAR = 'data:soar';
export const DATA_RBA = 'data:rba';
export const DATA_AI_ASSISTANT = 'data:ai-assistant';
export const DATA_GEOCODER_FETCH = 'data:geocoder-fetch';

// Basemaps
export const BASEMAP_PMTILES = 'basemap:pmtiles';
export const BASEMAP_STYLE_PROTOCOL = 'basemap:style-protocol';

// Sentinel for callers that omit scope (should never be used in production)
export const UNKNOWN = 'unknown:unknown';
```

- [ ] **Step 1.4: Run the test, confirm it passes**

```bash
npm test -- src/lib/__tests__/errorScopes.test.js
```

Expected: `4 passed`.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/errorScopes.js src/lib/__tests__/errorScopes.test.js
git commit -m "feat(errors): add errorScopes.js scope registry (v1.8.0 phase A)"
```

---

## Task 2: `errorStates.pushBanner` — banner stacking helper

**Files:**
- Modify: `src/lib/errorStates.js` (add new exports, do NOT change existing exports)
- Create: `src/lib/__tests__/errorStates.test.js`

- [ ] **Step 2.1: Write the failing tests**

Create `src/lib/__tests__/errorStates.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    renderErrorBanner,
    clearErrorBanner,
    pushBanner,
    dismissBanner,
    getActiveBanners,
    __resetBannerState
} from '../errorStates.js';

describe('errorStates — existing API regression', () => {
    let el;
    beforeEach(() => {
        document.body.innerHTML = '';
        el = document.createElement('div');
        document.body.appendChild(el);
        __resetBannerState();
    });

    it('renderErrorBanner with a string renders a fatal banner', () => {
        renderErrorBanner(el, 'boom');
        const banner = el.querySelector('.better_map-error');
        expect(banner).not.toBeNull();
        expect(banner.dataset.kind).toBe('fatal');
        expect(banner.textContent).toContain('boom');
    });

    it('renderErrorBanner with options object honours kind', () => {
        renderErrorBanner(el, { kind: 'warning', message: 'soft' });
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('warning');
    });

    it('clearErrorBanner hides the banner', () => {
        renderErrorBanner(el, 'boom');
        clearErrorBanner(el);
        const banner = el.querySelector('.better_map-error');
        expect(banner.style.display).toBe('none');
    });
});

describe('errorStates.pushBanner — stacking', () => {
    let el;
    beforeEach(() => {
        document.body.innerHTML = '';
        el = document.createElement('div');
        document.body.appendChild(el);
        __resetBannerState();
    });

    function envelope(scope, severity, message) {
        return { scope, severity, message, recovery: 'soft', timestamp: Date.now() };
    }

    it('pushes a single envelope and renders it', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'lat NaN'));
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('warning');
        expect(banner.textContent).toContain('lat NaN');
    });

    it('fatal beats warning in the single slot', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'warn first'));
        pushBanner(el, envelope('map:create', 'fatal', 'fatal second'));
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('fatal');
        expect(banner.textContent).toContain('fatal second');
    });

    it('warning does NOT replace an active fatal', () => {
        pushBanner(el, envelope('map:create', 'fatal', 'fatal first'));
        pushBanner(el, envelope('layer:markers', 'warning', 'warn after'));
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('fatal');
        expect(banner.textContent).toContain('fatal first');
    });

    it('shows "+N more" badge when multiple envelopes active', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        pushBanner(el, envelope('layer:heatmap', 'warning', 'b'));
        pushBanner(el, envelope('layer:paths', 'warning', 'c'));
        const badge = el.querySelector('.better_map-error__badge');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toContain('+2 more');
    });

    it('dismissBanner removes one envelope and re-renders next', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        pushBanner(el, envelope('layer:heatmap', 'warning', 'b'));
        dismissBanner(el, 'layer:markers');
        const banner = el.querySelector('.better_map-error');
        expect(banner.textContent).toContain('b');
        expect(banner.textContent).not.toContain('a');
        const badge = el.querySelector('.better_map-error__badge');
        expect(badge).toBeNull();
    });

    it('getActiveBanners returns a copy of active envelopes', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        const list = getActiveBanners(el);
        expect(list).toHaveLength(1);
        list.length = 0;
        expect(getActiveBanners(el)).toHaveLength(1);
    });

    it('replacing an envelope with the same scope updates in place', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'first'));
        pushBanner(el, envelope('layer:markers', 'warning', 'second'));
        expect(getActiveBanners(el)).toHaveLength(1);
        const banner = el.querySelector('.better_map-error');
        expect(banner.textContent).toContain('second');
    });

    it('__resetBannerState clears all active envelopes', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        __resetBannerState();
        expect(getActiveBanners(el)).toHaveLength(0);
    });
});
```

- [ ] **Step 2.2: Run the tests, confirm they fail**

```bash
npm test -- src/lib/__tests__/errorStates.test.js
```

Expected: `pushBanner is not exported` (or similar). Existing-API regression cases pass; pushBanner cases fail.

- [ ] **Step 2.3: Implement `pushBanner` + friends**

Edit `src/lib/errorStates.js` — append the new section AFTER the existing `clearErrorBanner` function. Do NOT touch the existing exports.

```js
// ===================================================================
// v1.8.0 — banner stacking via pushBanner
//
// renderErrorBanner / clearErrorBanner stay single-slot DOM, but
// pushBanner manages a per-container envelope list and decides which
// envelope wins the slot. Priority: fatal > warning > info; ties
// broken by insertion order (first-pushed wins). When 2+ are active,
// a "+N more" badge appears. safeRun.js is the primary caller.
// ===================================================================

const SEVERITY_RANK = { fatal: 3, warning: 2, info: 1 };
const BADGE_CLASS = CLASS + '__badge';

// Slot indirection so __resetBannerState can swap atomically.
const _bannerStateSlot = { active: new WeakMap(), inserted: 0 };

function _entriesFor(el) {
    let list = _bannerStateSlot.active.get(el);
    if (!list) {
        list = [];
        _bannerStateSlot.active.set(el, list);
    }
    return list;
}

function _pickWinner(entries) {
    if (entries.length === 0) return null;
    return entries.slice().sort(function (a, b) {
        const ra = SEVERITY_RANK[a.severity] || 0;
        const rb = SEVERITY_RANK[b.severity] || 0;
        if (rb !== ra) return rb - ra;
        return a._inserted - b._inserted;
    })[0];
}

function _renderStack(el) {
    const entries = _entriesFor(el);
    const winner = _pickWinner(entries);
    if (!winner) {
        clearErrorBanner(el);
        return;
    }
    renderErrorBanner(el, {
        kind: winner.severity,
        message: winner.message,
        dismissible: winner.severity !== 'fatal'
    });
    const banner = el.querySelector('.' + CLASS);
    if (!banner) return;
    const oldBadge = banner.querySelector('.' + BADGE_CLASS);
    if (oldBadge) oldBadge.remove();
    if (entries.length > 1) {
        const badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        badge.textContent = '+' + (entries.length - 1) + ' more';
        badge.setAttribute(
            'aria-label',
            (entries.length - 1) + ' additional notice' + (entries.length - 1 === 1 ? '' : 's')
        );
        const close = banner.querySelector('.' + CLASS + '__close');
        if (close) {
            banner.insertBefore(badge, close);
        } else {
            banner.appendChild(badge);
        }
    }
}

export function pushBanner(el, envelope) {
    if (!el || !envelope || !envelope.scope) return;
    const entries = _entriesFor(el);
    const existingIdx = entries.findIndex(function (e) {
        return e.scope === envelope.scope;
    });
    const entry = Object.assign({}, envelope, { _inserted: _bannerStateSlot.inserted++ });
    if (existingIdx >= 0) {
        entries[existingIdx] = entry;
    } else {
        entries.push(entry);
    }
    _renderStack(el);
}

export function dismissBanner(el, scope) {
    if (!el) return;
    const entries = _entriesFor(el);
    if (scope == null) {
        entries.length = 0;
    } else {
        const idx = entries.findIndex(function (e) {
            return e.scope === scope;
        });
        if (idx >= 0) entries.splice(idx, 1);
    }
    _renderStack(el);
}

export function getActiveBanners(el) {
    if (!el) return [];
    return _entriesFor(el).slice();
}

export function __resetBannerState() {
    _bannerStateSlot.active = new WeakMap();
    _bannerStateSlot.inserted = 0;
}
```

- [ ] **Step 2.4: Run the tests, confirm they pass**

```bash
npm test -- src/lib/__tests__/errorStates.test.js
```

Expected: `11 passed` (3 existing-API + 8 stacking).

- [ ] **Step 2.5: Add CSS for the badge**

Edit `visualization.css` — append to the `.better_map-error` section:

```css
.better_map-error__badge {
    margin-left: 8px;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.12);
    color: inherit;
}
```

- [ ] **Step 2.6: Lint**

```bash
npm run lint
```

Expected: no new errors.

- [ ] **Step 2.7: Commit**

```bash
git add src/lib/errorStates.js src/lib/__tests__/errorStates.test.js visualization.css
git commit -m "feat(errors): add errorStates.pushBanner stacking helper (v1.8.0 phase A)"
```

---

## Task 3: `safeRun.js` — sync core + envelope

**Files:**
- Create: `src/lib/safeRun.js`
- Create: `src/lib/__tests__/safeRun.test.js`

- [ ] **Step 3.1: Write the failing tests (sync core slice)**

Create `src/lib/__tests__/safeRun.test.js`:

```js
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
```

- [ ] **Step 3.2: Run, confirm failure**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `Cannot find module '../safeRun.js'`.

- [ ] **Step 3.3: Implement sync core**

Create `src/lib/safeRun.js`:

```js
/*
 * safeRun — the boundary primitive used by every subsystem in Better Map
 * for the v1.8.0 stability release. See:
 *   docs/superpowers/specs/2026-05-19-map-stability-design.md
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

// Test-only state. The slot indirection lets __resetSafeRunState
// swap everything atomically without exporting mutable bindings.
const _state = {
    ringBuffer: [],
    ringCap: 50,
    reporter: null,            // test override; null = default reporter
    nowFn: null                // test override for Date.now()
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
        // onError is best-effort. Log but never propagate.
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
    } catch (_) { /* console may be unavailable in some sandboxes */ }
}

function _safeReport(envelope) {
    const reporter = _state.reporter || _defaultReporter;
    try {
        reporter(envelope);
    } catch (reporterErr) {
        // Reporter-itself failure: hard fallback. Cannot re-throw.
        try {
            // eslint-disable-next-line no-console
            console.error('[better_map:safeRun-itself] reporter threw:', reporterErr, '\noriginal envelope:', envelope);
        } catch (_) { /* nothing more we can do */ }
    }
}

export function safeRun(opts) {
    if (!opts || typeof opts !== 'object') {
        opts = { action: function () {} };
    }
    const action = typeof opts.action === 'function' ? opts.action : function () {};
    try {
        const result = action();
        // (Async support is added in Task 5; for now treat all returns as sync results.)
        return { ok: true, result: result };
    } catch (err) {
        const envelope = _buildEnvelope(opts, err);
        _state.ringBuffer.push(envelope);
        if (_state.ringBuffer.length > _state.ringCap) {
            _state.ringBuffer.shift();
        }
        _safeReport(envelope);
        _safeOnError(opts.onError, err);
        return { ok: false, error: envelope };
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
    // Backoff/quarantine state lives in Task 6; for now just clear ring buffer.
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
```

- [ ] **Step 3.4: Run, confirm pass**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `8 passed`.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/safeRun.js src/lib/__tests__/safeRun.test.js
git commit -m "feat(errors): add safeRun.js sync core + envelope (v1.8.0 phase A)"
```

---

## Task 4: `safeRun.js` — reporter chain (ring buffer, console, custom event)

**Files:**
- Modify: `src/lib/safeRun.js`
- Modify: `src/lib/__tests__/safeRun.test.js` (append cases)

- [ ] **Step 4.1: Append failing tests for reporter chain**

Append to `src/lib/__tests__/safeRun.test.js`:

```js
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
```

- [ ] **Step 4.2: Run, confirm new tests fail (CustomEvent dispatch missing)**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: at least the CustomEvent test fails. Ring buffer, default reporter, test reporter, filter, reporter-fallback may already pass from Task 3.

- [ ] **Step 4.3: Add CustomEvent dispatch**

In `src/lib/safeRun.js`, replace the body of `safeRun` (the catch branch) to dispatch the event:

```js
} catch (err) {
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
```

- [ ] **Step 4.4: Run, confirm all pass**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `16 passed`.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/safeRun.js src/lib/__tests__/safeRun.test.js
git commit -m "feat(errors): safeRun reporter chain + CustomEvent dispatch (v1.8.0 phase A)"
```

---

## Task 5: `safeRun.js` — async actions

**Files:**
- Modify: `src/lib/safeRun.js`
- Modify: `src/lib/__tests__/safeRun.test.js`

- [ ] **Step 5.1: Append failing tests**

Append to `src/lib/__tests__/safeRun.test.js`:

```js
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

    it('handles thenable (non-Promise) return values as sync', () => {
        // Returning a non-thenable object is a sync result.
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { return { not: 'a-promise' }; }
        });
        expect(r.ok).toBe(true);
        expect(r.result).toEqual({ not: 'a-promise' });
    });
});
```

- [ ] **Step 5.2: Run, confirm async cases fail**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: async cases fail because returning a rejecting Promise from a sync `action()` doesn't enter the `catch` block.

- [ ] **Step 5.3: Add async wrap to safeRun**

In `src/lib/safeRun.js`, replace the `safeRun` function body so it detects thenable return values:

```js
function _isThenable(v) {
    return v != null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
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
        } catch (_) { /* never fatal */ }
    }
    _safeOnError(opts.onError, err);
    return { ok: false, error: envelope };
}

export function safeRun(opts) {
    if (!opts || typeof opts !== 'object') {
        opts = { action: function () {} };
    }
    const action = typeof opts.action === 'function' ? opts.action : function () {};
    let result;
    try {
        result = action();
    } catch (err) {
        return _handleFailure(opts, err);
    }
    if (_isThenable(result)) {
        return result.then(
            function (value) { return { ok: true, result: value }; },
            function (err)   { return _handleFailure(opts, err); }
        );
    }
    return { ok: true, result: result };
}
```

- [ ] **Step 5.4: Run, confirm all pass**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `20 passed`.

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/safeRun.js src/lib/__tests__/safeRun.test.js
git commit -m "feat(errors): safeRun async action support (v1.8.0 phase A)"
```

---

## Task 6: `safeRun.js` — rate limiting (1s window per scope)

**Files:** as above.

- [ ] **Step 6.1: Append failing tests**

```js
describe('safeRun — rate limiting', () => {
    beforeEach(() => { __resetSafeRunState(); });

    it('collapses identical scope envelopes within a 1s window', () => {
        let t = 1000;
        __setNow(function () { return t; });
        const received = [];
        __setReporter(function (e) { received.push(e); });

        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        t = 1100;  // 100ms later
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('b'); } });
        t = 1500;  // 500ms later
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
        t = 2001;  // > 1000ms later
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('b'); } });

        expect(received).toHaveLength(2);
    });

    it('does not collapse different scopes', () => {
        let t = 1000;
        __setNow(function () { return t; });
        const received = [];
        __setReporter(function (e) { received.push(e); });

        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        safeRun({ scope: MAP_CREATE,    action: function () { throw new Error('b'); } });

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
```

- [ ] **Step 6.2: Run, confirm rate-limit cases fail**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: rate-limit collapse case fails (reporter called 3 times instead of 1).

- [ ] **Step 6.3: Add rate-limit state + check before reporting**

In `src/lib/safeRun.js`:

Extend `_state`:

```js
const _state = {
    ringBuffer: [],
    ringCap: 50,
    reporter: null,
    nowFn: null,
    lastReportedAt: {}        // map<rateLimitKey, timestamp-ms>
};
```

Add the rate-limit gate inside `_handleFailure` between ring-buffer push and reporter call:

```js
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
    if (opts.panelRoot && typeof CustomEvent !== 'undefined') {
        try {
            opts.panelRoot.dispatchEvent(new CustomEvent('better_map:error', { detail: envelope }));
        } catch (_) { /* never fatal */ }
    }
    _safeOnError(opts.onError, err);
    return { ok: false, error: envelope };
}
```

Add the field to the reset hook:

```js
export function __resetSafeRunState() {
    _state.ringBuffer.length = 0;
    _state.reporter = null;
    _state.nowFn = null;
    _state.lastReportedAt = {};
}
```

- [ ] **Step 6.4: Run, confirm all pass**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `24 passed`.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/safeRun.js src/lib/__tests__/safeRun.test.js
git commit -m "feat(errors): safeRun rate limiting 1s per scope (v1.8.0 phase A)"
```

---

## Task 7: `safeRun.js` — backoff and quarantine

**Files:** as above.

- [ ] **Step 7.1: Append failing tests**

```js
describe('safeRun — backoff and quarantine', () => {
    beforeEach(() => { __resetSafeRunState(); });

    it('after first failure, immediate re-runs within 1s return {ok:false, error:{backoff:true}}', () => {
        let t = 1000;
        __setNow(function () { return t; });
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        t = 1100;
        const r = safeRun({ scope: LAYER_MARKERS, action: function () { return 'never-runs'; } });
        expect(r.ok).toBe(false);
        expect(r.error.backoff).toBe(true);
    });

    it('after 1s, the action runs again', () => {
        let t = 1000;
        __setNow(function () { return t; });
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        t = 2001;
        let ran = false;
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { ran = true; return 42; }
        });
        expect(ran).toBe(true);
        expect(r).toEqual({ ok: true, result: 42 });
    });

    it('successful run resets failure count', () => {
        let t = 1000;
        __setNow(function () { return t; });
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        t = 2001;
        safeRun({ scope: LAYER_MARKERS, action: function () { return 'ok'; } });
        // After a success, next failure starts a fresh backoff (1s, not 5s).
        t = 3001;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('b'); } });
        t = 3500;  // 500ms after second failure, still under 1s
        const r = safeRun({ scope: LAYER_MARKERS, action: function () { return 'x'; } });
        expect(r.ok).toBe(false);
        expect(r.error.backoff).toBe(true);
    });

    it('backoff schedule: 0ms (first call) -> 1s -> 5s -> 30s -> quarantined', () => {
        let t = 1000;
        __setNow(function () { return t; });
        // Failure 1: schedule 1s
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('1'); } });
        // After 1s, runs again
        t = 2001;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('2'); } });
        // After 1s, blocked (need 5s)
        t = 3002;
        let r = safeRun({ scope: LAYER_MARKERS, action: function () {} });
        expect(r.error.backoff).toBe(true);
        // After 5s, runs again
        t = 7003;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('3'); } });
        // Need 30s now
        t = 8003;
        r = safeRun({ scope: LAYER_MARKERS, action: function () {} });
        expect(r.error.backoff).toBe(true);
        // After 30s, runs again
        t = 37004;
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('4'); } });
        // 4th failure -> quarantined
        t = 100000;
        r = safeRun({ scope: LAYER_MARKERS, action: function () {} });
        expect(r.error.backoff).toBe(true);
        expect(r.error.quarantined).toBe(true);
    });

    it('clearErrorState(scope) clears just that scope', () => {
        let t = 1000;
        __setNow(function () { return t; });
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        clearErrorState(LAYER_MARKERS);
        let ran = false;
        const r = safeRun({
            scope: LAYER_MARKERS,
            action: function () { ran = true; }
        });
        expect(ran).toBe(true);
        expect(r.ok).toBe(true);
    });

    it('clearErrorState() with no scope clears everything', () => {
        let t = 1000;
        __setNow(function () { return t; });
        safeRun({ scope: LAYER_MARKERS, action: function () { throw new Error('a'); } });
        safeRun({ scope: MAP_CREATE,    action: function () { throw new Error('b'); } });
        clearErrorState();
        const r1 = safeRun({ scope: LAYER_MARKERS, action: function () { return 1; } });
        const r2 = safeRun({ scope: MAP_CREATE,    action: function () { return 2; } });
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
    });
});
```

- [ ] **Step 7.2: Run, confirm failure**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: backoff cases fail (action runs every time regardless of recent failure).

- [ ] **Step 7.3: Add backoff state + gate**

In `src/lib/safeRun.js`:

```js
const BACKOFF_SCHEDULE_MS = [1000, 5000, 30000];   // index = failureCount-1
const QUARANTINE_AT = BACKOFF_SCHEDULE_MS.length + 1;

// Extend _state:
const _state = {
    ringBuffer: [],
    ringCap: 50,
    reporter: null,
    nowFn: null,
    lastReportedAt: {},
    backoff: {}    // map<scope, { failures: number, nextAllowedAt: number }>
};
```

Helper functions:

```js
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
```

Wrap the body of `safeRun` so the backoff check fires first:

```js
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
```

Update `clearErrorState`:

```js
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
```

Update reset:

```js
export function __resetSafeRunState() {
    _state.ringBuffer.length = 0;
    _state.reporter = null;
    _state.nowFn = null;
    _state.lastReportedAt = {};
    _state.backoff = {};
}
```

- [ ] **Step 7.4: Run, confirm pass**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `30 passed`.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/safeRun.js src/lib/__tests__/safeRun.test.js
git commit -m "feat(errors): safeRun exponential backoff and quarantine (v1.8.0 phase A)"
```

---

## Task 8: `safeRun.js` — banner routing + destroy-flag suppression

**Files:** as above.

- [ ] **Step 8.1: Append failing tests**

First, add a new import line at the TOP of `src/lib/__tests__/safeRun.test.js` (alongside the existing imports):

```js
import { getActiveBanners, __resetBannerState } from '../errorStates.js';
```

Then append these describe blocks to the bottom of the file:

```js
describe('safeRun — banner routing', () => {
    let root;
    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        __resetSafeRunState();
        __resetBannerState();
    });

    it('recovery="soft" does NOT push a banner', () => {
        safeRun({
            scope: LAYER_MARKERS,
            recovery: 'soft',
            panelRoot: root,
            action: function () { throw new Error('boom'); }
        });
        expect(getActiveBanners(root)).toHaveLength(0);
    });

    it('recovery="degrade" pushes a warning banner', () => {
        safeRun({
            scope: LAYER_MARKERS,
            recovery: 'degrade',
            panelRoot: root,
            action: function () { throw new Error('boom'); }
        });
        const list = getActiveBanners(root);
        expect(list).toHaveLength(1);
        expect(list[0].severity).toBe('warning');
    });

    it('recovery="fatal" pushes a fatal banner', () => {
        safeRun({
            scope: MAP_CREATE,
            recovery: 'fatal',
            severity: 'fatal',
            panelRoot: root,
            action: function () { throw new Error('boom'); }
        });
        const list = getActiveBanners(root);
        expect(list).toHaveLength(1);
        expect(list[0].severity).toBe('fatal');
    });

    it('without panelRoot, banner is never pushed (no DOM target)', () => {
        const r = safeRun({
            scope: LAYER_MARKERS,
            recovery: 'degrade',
            action: function () { throw new Error('boom'); }
        });
        expect(r.ok).toBe(false);   // still reported via console + ring buffer
    });
});

describe('safeRun — destroy-flag suppression', () => {
    let root;
    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        __resetSafeRunState();
        __resetBannerState();
    });

    it('panelRoot.dataset.bmDestroying suppresses banner but NOT ring buffer or event', () => {
        root.dataset.bmDestroying = '1';
        const events = [];
        root.addEventListener('better_map:error', function (e) { events.push(e.detail); });
        safeRun({
            scope: LAYER_MARKERS,
            recovery: 'degrade',
            panelRoot: root,
            action: function () { throw new Error('boom'); }
        });
        expect(getActiveBanners(root)).toHaveLength(0);   // banner suppressed
        expect(events).toHaveLength(1);                    // event still dispatched
        expect(getRecentErrors()).toHaveLength(1);         // ring buffer still grows
    });
});
```

- [ ] **Step 8.2: Run, confirm failure**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: banner routing cases fail because `safeRun` doesn't call `pushBanner`.

- [ ] **Step 8.3: Wire banner routing**

In `src/lib/safeRun.js`, add an import:

```js
import { pushBanner } from './errorStates.js';
```

Extend `_handleFailure` to route to the banner unless suppressed:

```js
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
    // Banner routing: only for degrade/fatal, only with panelRoot,
    // skipped when destroy is in flight.
    const destroying = opts.panelRoot && opts.panelRoot.dataset && opts.panelRoot.dataset.bmDestroying === '1';
    if (opts.panelRoot && !destroying && (envelope.recovery === 'degrade' || envelope.recovery === 'fatal')) {
        try {
            pushBanner(opts.panelRoot, envelope);
        } catch (_) { /* banner routing failure is never fatal */ }
    }
    if (opts.panelRoot && typeof CustomEvent !== 'undefined') {
        try {
            opts.panelRoot.dispatchEvent(new CustomEvent('better_map:error', { detail: envelope }));
        } catch (_) { /* never fatal */ }
    }
    _safeOnError(opts.onError, err);
    return { ok: false, error: envelope };
}
```

- [ ] **Step 8.4: Run, confirm pass**

```bash
npm test -- src/lib/__tests__/safeRun.test.js
```

Expected: `36 passed`.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/safeRun.js src/lib/__tests__/safeRun.test.js
git commit -m "feat(errors): safeRun banner routing + destroy-flag suppression (v1.8.0 phase A)"
```

---

## Task 9: `debugHud.js` — Errors-tab scaffold

**Files:**
- Modify: `src/lib/debugHud.js`
- Create: `src/lib/__tests__/debugHud.test.js`

- [ ] **Step 9.1: Write failing test**

Create `src/lib/__tests__/debugHud.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDebugHud } from '../debugHud.js';

describe('debugHud — errors tab scaffold', () => {
    let container;
    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('renders an errors counter row that starts at 0', () => {
        createDebugHud(container);
        const el = container.querySelector('.better_map-debug-hud');
        expect(el).not.toBeNull();
        expect(el.textContent).toContain('errors=0');
    });

    it('increments the errors counter when a better_map:error event fires', () => {
        createDebugHud(container);
        const envelope = {
            scope: 'layer:markers',
            severity: 'warning',
            recovery: 'soft',
            message: 'lat NaN',
            timestamp: Date.now()
        };
        container.dispatchEvent(new CustomEvent('better_map:error', { detail: envelope }));
        const el = container.querySelector('.better_map-debug-hud');
        expect(el.textContent).toContain('errors=1');
        expect(el.textContent).toContain('layer:markers');
    });

    it('groups counts by scope', () => {
        createDebugHud(container);
        for (let i = 0; i < 3; i++) {
            container.dispatchEvent(new CustomEvent('better_map:error', {
                detail: { scope: 'layer:markers', severity: 'warning', recovery: 'soft', message: 'x', timestamp: Date.now() }
            }));
        }
        container.dispatchEvent(new CustomEvent('better_map:error', {
            detail: { scope: 'map:create', severity: 'fatal', recovery: 'fatal', message: 'y', timestamp: Date.now() }
        }));
        const el = container.querySelector('.better_map-debug-hud');
        expect(el.textContent).toContain('layer:markers x3');
        expect(el.textContent).toContain('map:create x1');
    });
});
```

- [ ] **Step 9.2: Run, confirm failure**

```bash
npm test -- src/lib/__tests__/debugHud.test.js
```

Expected: counter tests fail.

- [ ] **Step 9.3: Add Errors-tab scaffold to debugHud**

In `src/lib/debugHud.js`, INSIDE `createDebugHud(container)` after the `state = {...}` block, add an errors section:

Find the existing state block (around line 57+) and extend it:

```js
    state.errorCounts = {};      // scope -> count
    state.errorTotal = 0;
    state.lastError = null;
```

Then add an event listener and a render function. Find where the HUD renders its other lines and append a new render call. The simplest minimally-invasive approach: append a child div for the errors and update it on event.

Replace the immediately-after-container.appendChild(el) block with:

```js
    container.appendChild(el);

    const errorsEl = document.createElement('div');
    errorsEl.className = 'better_map-debug-hud__errors';
    errorsEl.style.borderTop = '1px solid rgba(76, 217, 196, 0.22)';
    errorsEl.style.marginTop = '6px';
    errorsEl.style.paddingTop = '6px';
    el.appendChild(errorsEl);

    function renderErrorsLine() {
        const scopes = Object.keys(state.errorCounts).sort();
        const parts = scopes.map(function (s) { return s + ' x' + state.errorCounts[s]; });
        const head = 'errors=' + state.errorTotal;
        errorsEl.textContent = head + (parts.length ? ' | ' + parts.join(' | ') : '');
    }

    function onError(e) {
        const envelope = (e && e.detail) || {};
        const scope = envelope.scope || 'unknown';
        state.errorCounts[scope] = (state.errorCounts[scope] || 0) + 1;
        state.errorTotal += 1;
        state.lastError = envelope;
        renderErrorsLine();
    }

    container.addEventListener('better_map:error', onError);
    renderErrorsLine();   // initial render so "errors=0" appears
```

Place these blocks AFTER the `state = { ... }` initialization so they have access to the state object. The test in Step 9.1 will catch ordering bugs if blocks land out of sequence.

- [ ] **Step 9.4: Run, confirm pass**

```bash
npm test -- src/lib/__tests__/debugHud.test.js
```

Expected: `3 passed`.

- [ ] **Step 9.5: Commit**

```bash
git add src/lib/debugHud.js src/lib/__tests__/debugHud.test.js
git commit -m "feat(errors): debugHud errors-tab scaffold (v1.8.0 phase A)"
```

---

## Task 10: Full suite + lint + build verification

**Files:** none modified.

- [ ] **Step 10.1: Run full vitest suite**

```bash
npm test
```

Expected: `200 + ~50 = ~250 passed` (Phase A adds ~50 cases). All existing tests still pass.

- [ ] **Step 10.2: Run linter**

```bash
npm run lint
```

Expected: no new errors. (Pre-existing warning in `cimAutoDetect.js` from the v1.7.0 era may remain.)

- [ ] **Step 10.3: Build**

```bash
npm run build
```

Expected: webpack completes; bundle size growth versus v1.7.1 baseline `visualization.js.LICENSE.txt` size delta is < 8 KB gzipped.

- [ ] **Step 10.4: Run bundle-size lint**

```bash
npm run lint:bundle-size
```

Expected: pass.

- [ ] **Step 10.5: Manual smoke (optional, but recommended)**

Open any dashboard panel using Better Map. Open browser devtools console. Confirm:
- No new errors during page load
- Console is clean
- HUD (if `showDebugHud=true`) shows the new `errors=0` line

- [ ] **Step 10.6: Final commit if anything cleaned up; otherwise push**

```bash
git log --oneline -10        # confirm all phase-A commits are present
```

Phase A is complete and ready for review / merge.

---

## Done criteria for Phase A

- [ ] `safeRun({scope, action})` works with sync, async, throws, rejects, onError, panelRoot
- [ ] Rate-limited at 1s per scope; identical errors within window collapse to one console line
- [ ] Backoff escalates 1s → 5s → 30s → quarantined; resets on first success
- [ ] Banner routing: soft (none) / degrade (warning) / fatal (fatal); suppressed during destroy
- [ ] Ring buffer caps at 50; `getRecentErrors({scope})` filters
- [ ] `CustomEvent('better_map:error')` dispatched on `panelRoot`
- [ ] `errorScopes.js` has 40+ unique colon-namespaced constants
- [ ] `errorStates.pushBanner` stacks with priority + badge; `dismissBanner` works
- [ ] `debugHud` shows errors counter, groups by scope
- [ ] Full vitest suite green (~250 cases total)
- [ ] Lint clean; build succeeds; bundle growth < 8 KB gzipped

---

## What Phase A does NOT do (intentional)

- No caller is wired to `safeRun` yet — that's Phase B
- No retry / details affordances on the banner — Phase E
- No quarantined-layer greying in the layer control — Phase E
- No `map.on('error')` bridge to envelope — Phase B
- No `MapBuilder.whenReady` API — Phase B
- No `dataFitness` row validation — Phase D
- No integration tests — Phase F
