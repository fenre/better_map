# Better Map — v1.8.0 stability release: design spec

| Field | Value |
|---|---|
| Date | 2026-05-19 |
| Target version | 1.8.0 |
| Driver | "Make the maps more stable, less prone to errors and things not working" |
| Status | Approved (autonomous mode) — moving to writing-plans |
| Approach | A + B + C: error-boundary architecture + targeted defensive pass + failure-injection tests |

## Problem statement

Better Map is a Splunk Dashboard Studio custom visualization with ~87 source files and ~2570 LOC just in the two entry points (`visualization_source.js`, `mapBuilder.js`). It already has solid building blocks:

- A 4-tier `errorStates.js` banner system (`fatal` / `warning` / `info` / `dismissed`) with ARIA-correct surfaces and dismiss handling.
- A `bmstyle://` / `bmsource://` protocol indirection in `mapBuilder.js` that already works around CDN-shape mismatches inside Splunk Dashboard Studio.
- A `lastGoodData` caching pattern in `formatData` that survives bad data ticks.
- 200 vitest cases including UX hint tests landed in v1.7.1.
- Scattered `try`/`catch` blocks across most files (10+ in some layer modules).

What's missing is **structural**: there's no consistent way to wrap independent subsystems in an error boundary, no shared error envelope, no per-scope reporting, no rate-limited console output, no recovery affordances on the banner, and no failure-injection harness for the test suite. A `random()` exception inside any one layer, widget, or async fetch can throw past the Splunk lifecycle and blank the whole panel.

The v1.8.0 release closes those gaps. It is **structural, not behavioural** — the happy path is unchanged.

## Goals

1. No JS exception can escape a Splunk visualization-lifecycle method.
2. A failure inside one layer, widget, or data source cannot take down the panel.
3. Every error surfaces in one consistent, rate-limited, scope-tagged channel (console + ring buffer + optional banner).
4. Users get recovery affordances (Retry / Details / Dismiss) on recoverable errors.
5. Bad SPL output (missing fields, wrong types, malformed coordinates) is filtered and quantified, not crashed on.
6. The most common race conditions (style-not-loaded, source-missing, async token before map-ready) are eliminated structurally.
7. Failure-injection tests cover the boundary contracts so regressions can't sneak in.

## Non-goals

- Memory profiling / large-data rendering performance — separate concern.
- Cross-browser compatibility sweep — needs real browser farms.
- Network/CDN resilience expansion — partial coverage already via `bmstyle://`.
- Splunk integration edges without specific bug reports — speculative.
- New formatter options or user-facing config additions — keeps dashboard-author migration zero.

## Architecture

### The boundary primitive

A single helper in a new `src/lib/safeRun.js` is the contract every subsystem opts into:

```js
import { safeRun } from '../safeRun.js';
import { LAYER_MARKERS } from '../errorScopes.js';

safeRun({
    scope: LAYER_MARKERS,            // from central registry, never free-form string
    severity: 'warning',             // 'fatal' | 'warning' | 'info' (default 'warning')
    recovery: 'soft',                // 'soft' | 'degrade' | 'fatal' (default 'soft')
    panelRoot: el,                   // for banner DOM + custom event dispatch
    action: function () { /* body */ },
    onError: function (err) { /* per-call cleanup */ },
    rateLimitKey: LAYER_MARKERS      // defaults to scope; collapses identical errors
});
```

Returns `{ ok: true, result }` on success, `{ ok: false, error: envelope }` on failure.
**Structurally guaranteed never to re-throw.**

`action` may be synchronous or return a Promise; `safeRun` awaits internally and routes rejections through the same flow.

### The error envelope

```js
{
    scope: 'layer:markers',          // central registry constant
    severity: 'fatal' | 'warning' | 'info',
    recovery: 'soft' | 'degrade' | 'fatal',
    message: 'lat NaN at row 14',    // user-readable
    cause: Error | string | undefined,
    stack: '...',                    // captured from cause if present
    timestamp: 1731950400000,
    dataShape: {                     // OPTIONAL; PII-safe fingerprint
        rows: 1842,
        fields: ['_time','lat','lon','severity'],
        firstRowTypes: { _time: 'number', lat: 'number', lon: 'string' }
    },
    recoveryActions: ['retry', 'details', 'dismiss']
}
```

`dataShape` carries metadata only — never row values. Same constraint as `popupSanitizer` defends today.

### What happens on error (in order)

1. Build envelope (wrapped in its own try/catch; fallback to plain `console.error`).
2. Push onto `safeRun`'s ring buffer (last 50; exposed via `getRecentErrors()` for the HUD).
3. Log to console as `[better_map:layer:markers] warning: <message>` — one line. Rate-limited at 1/sec per `rateLimitKey` to prevent storms from inside a render loop.
4. Route to user surface based on `recovery`:
   - `soft` — no banner. Subsystem hides itself. (Default for optional layers, widgets, async fetches.)
   - `degrade` — `errorStates` warning banner with Retry / Details / Dismiss. `lastGoodData` keeps showing underneath.
   - `fatal` — `errorStates` fatal banner. No map.
5. Dispatch `CustomEvent('better_map:error', { detail: envelope })` on `panelRoot`. `debugHud` listens; external consumers can listen for telemetry.

### Scope registry

A new `src/lib/errorScopes.js` exports constants — `LAYER_MARKERS`, `LAYER_HEATMAP`, `WIDGET_GEOCODER`, `DATA_SPL`, `LIFECYCLE_FORMAT_DATA`, `MAPLIBRE_INTERNAL`, etc. Prevents drift like `layer:markers` vs `layers/markers` vs `marker-layer`. The HUD groups by these.

### Banner stacking strategy

`errorStates.renderErrorBanner` stays single-slot (no DOM contract break). New `pushBanner(envelope)` helper handles priority + badge count: the highest-severity active envelope wins the slot; if more than one is active the banner gets a `+N more` badge that opens a small dropdown listing all active scopes. Existing 200 tests continue to pass — single-slot DOM contract is unchanged.

### Soft-recovery backoff per scope

A layer that fails on `update()` shouldn't re-run on the next data tick and fail again. `safeRun` keeps a per-scope failure count and backs off: `0ms → 1s → 5s → 30s → quarantined`. Quarantined scopes go grey in the layer control. A successful run resets the counter; `MapBuilder.reset()` clears all counters.

### MapLibre internal errors adopt the envelope

`map.on('error', e => ...)` fires from inside MapLibre for tile-load 404s, style validation, etc. We bridge that into `reportError` with `scope: MAPLIBRE_INTERNAL`, `recovery: 'soft'`. The existing `bmstyle://` protocol's `throw new Error('bm-protocol: HTTP 404 ...')` rides this channel too.

### Destroy-time errors are suppressed from UI

`visualization_source.destroy()` sets `panelRoot.dataset.bmDestroying = '1'` at entry. Every `safeRun` checks the flag; if set, envelopes still hit the ring buffer + console but skip the banner. No flashing red banner on dashboard navigation away.

### Boundary placement (5 tiers, ordered by blast radius)

| Tier | File | What it protects | Default recovery |
|---|---|---|---|
| 1. Splunk lifecycle | `visualization_source.js` (initialize / formatData / updateView / reflow / destroy) | Top-level — a throw here kills the panel | `fatal` on `initialize`, `degrade` on others |
| 2. Map lifecycle | `mapBuilder.js` (createMap / setStyle / _remountLayers / map.on('error') bridge) | MapLibre instantiation + style swaps | `fatal` on init, `degrade` on style swap |
| 3. Per layer | `lib/layers/index.js::reconcile` (loop over ~10 strategies) | One layer can't take down others | `soft` |
| 4. Per widget | `lib/widgets/v2Bundle.js` (~12 widgets) | One widget can't take down others | `soft` |
| 5. Per data source | `splunk/rest.js`, `splunk/aiGeo.js`, `splunk/itsi.js`, `splunk/esNotable.js`, `splunk/mitre.js`, `widgets/geocoder.js`, `basemaps/pmtilesLoader.js` | Async fetches | `soft` |

## Work-areas (6) and effort sizing

### 1. Error boundaries (L — ~2 days)

**New files**

- `src/lib/safeRun.js` — primitive, envelope, ring buffer, backoff, reporter hook (~250 LOC)
- `src/lib/errorScopes.js` — scope constants (~80 LOC)
- `src/lib/__tests__/safeRun.test.js` — ~30 cases

**Modified files**

- `src/visualization_source.js` — 5 lifecycle boundaries
- `src/lib/mapBuilder.js` — 3 boundaries + `map.on('error')` bridge + `whenReady()` API
- `src/lib/layers/index.js` — wrap each strategy in `reconcile`
- `src/lib/widgets/v2Bundle.js` — wrap each widget lifecycle
- `src/lib/splunk/*.js` — wrap each fetch (~10 boundaries)
- `src/lib/widgets/geocoder.js`, `basemaps/pmtilesLoader.js`
- `src/lib/errorStates.js` — `pushBanner(envelope)` helper for stacking + priority

### 2. Bad-input robustness — SPL → renderer (M — ~1 day)

**Modified files**

- `src/lib/dataFitness.js` — explicit row-level validation; bad lat/lon (NaN, out-of-range, wrong type) filtered with `dataShape.invalidRows` counted
- `src/lib/geojson.js` — safe coordinate parsing; guard missing/typeless fields
- All 10 layer modules — validate the fields each layer needs upstream of MapLibre calls
- `src/visualization_source.js::formatData` — reports `invalidRows` via `safeRun({ severity: 'info', message: 'N of M rows have invalid coordinates' })`

**New file**

- `src/lib/__tests__/badInput.test.js` — ~25 cases (bad lat/lon scenarios per layer)

### 3. Error UX (M — ~1 day)

**Modified files**

- `src/lib/errorStates.js` — recovery affordance buttons (Retry, Details, Dismiss). Details opens an expandable region showing scope + last 5 ring-buffer entries
- `visualization.css` — style new affordances (subtle, top-left, v1.7.1-consistent aesthetic)
- `src/lib/debugHud.js` — Errors tab; scope-grouped ring buffer view

**New file**

- `src/lib/__tests__/errorStates.test.js` — ~15 cases (banner stacking, retry, details expand)

### 4. Race-condition fixes (M — ~1 day)

**Known races to fix**

- a. `map.isStyleLoaded()` false during `updateView` if style swap in flight → introduce `MapBuilder.whenReady(fn)` that handles `load` + `styledata` uniformly; replace ad-hoc `.once('idle')` callers
- b. Layer update before source exists → automatically becomes `soft` recovery once boundaries land
- c. `lazyInit.js` `releaseContext` race (counted twice in some destroy paths) → reentrancy guard
- d. `crossPanel.js` echo-loop suppression via `setTimeout` (350ms) → replace with `map.once('idle')` tie-in
- e. Token watcher fires before map exists → queue updates until first `map:load`

**Modified files**

- `src/lib/mapBuilder.js`, `src/lib/lazyInit.js`, `src/lib/crossPanel.js`, `src/visualization_source.js`

**New file**

- `src/lib/__tests__/whenReady.test.js` — ~10 cases

### 5. Defensive coding pass — hot paths only (M — ~1 day)

**Modified files**

- `src/visualization_source.js` (1421 LOC) — every option-read path gets a type guard
- `src/lib/mapBuilder.js` (1149 LOC) — every map mutation gets an `isStyleLoaded`/`getSource` precondition
- Top 5 layers: `markers.js`, `clusters.js`, `heatmap.js`, `paths.js`, `hexbin.js` — every MapLibre call validated

No new tests in this area — covered by the work-area-6 injection harness.

### 6. Failure-injection tests (M — ~1 day)

**New files**

- `src/lib/__tests__/_helpers/injectError.js` — utilities to mock SPL responses, MapLibre errors, network failures
- `src/lib/__tests__/_helpers/mockMap.js` — consolidate the per-test MapLibre stubs that already exist in scattered form
- `src/lib/__tests__/integration/errorBoundaries.test.js` — ~40 cases (full-stack scenarios)

**Total estimated effort:** 6–7 working days for v1.8.0.

## Phasing — six PRs onto main

Each phase lands as a PR merged onto `main`. Phases A–E are pure additions / structural rewires with no user-visible behaviour change on the happy path; they do NOT bump `package.json` / `app.conf` versions and do NOT produce a Splunkbase-style `.spl` release. Only Phase F bumps the version and ships a release artifact.

| Phase | PR | Content | Version after merge |
|---|---|---|---|
| A | #1 | `safeRun.js` + `errorScopes.js` + tests; `errorStates.pushBanner`; HUD Errors tab scaffold | 1.7.1 (unchanged) |
| B | #2 | Wrap Splunk lifecycle + `mapBuilder` createMap/setStyle/_remountLayers; `map.on('error')` bridge; `whenReady()` | 1.7.1 (unchanged) |
| C | #3 | Wrap each layer in `reconcile`; wrap each widget in `v2Bundle`; backoff/quarantine | 1.7.1 (unchanged) |
| D | #4 | Wrap all `splunk/*` fetches; `dataFitness` row validation; per-layer field validation | 1.7.1 (unchanged) |
| E | #5 | Retry / Details affordances; banner stacking visual polish; HUD Errors tab finalized | 1.7.1 (unchanged) |
| F | #6 | Hot-path defensive pass; failure-injection integration tests; CHANGELOG / ROADMAP / llms-full; AppInspect; release | **1.8.0** |

Each PR passes its own tests + lint + build before the next starts. Each is independently revertable.

## Testing strategy

**Unit** — every new module gets a dedicated `__tests__` file.

- `safeRun.test.js` ~30 cases: envelope shape, sync/async, all three recoveries, backoff, ring buffer, reporter-itself failure, destroy-time suppression
- `errorScopes.test.js` smoke: constants are unique

**Boundary contract** — for every subsystem wrapped, one test that injects an error in `action`, asserts the envelope reaches the reporter, asserts the recovery action happened (e.g. layer source removed).

**Integration** — `integration/errorBoundaries.test.js` runs the full Splunk lifecycle against a mock map and asserts:

- Bad lat/lon: layer hides itself, info banner shown, other layers render
- Bad SPL fetch: data-source boundary catches, `lastGoodData` survives
- MapLibre internal error: envelope captured, no banner spam, no crash
- Destroy during error: no banner flash, ring buffer preserved
- Reporter itself throws: hard fallback to `console.error`, no re-throw

**Regression guarantee** — existing 200 tests must still pass. New tests by work-area: safeRun ~30 + badInput ~25 + errorStates ~15 + whenReady ~10 + integration ~40 = ~120 new cases. Target total at v1.8.0: ~320.

## Migration / backward compatibility

**Full backward compatibility:**

- `errorStates.renderErrorBanner` signature unchanged. Banner stacking is additive.
- Existing `try`/`catch` blocks in source files can stay or be replaced opportunistically.
- `lastGoodData` caching pattern unchanged.
- **No formatter option additions in v1.8.0.** Zero migration burden for existing dashboards.
- No new bundle dependencies — all internal modules.

**API additions only:**

- `safeRun(opts)`, `reportError(envelope)`, `getRecentErrors()` from `lib/safeRun.js`
- `LAYER_*`, `WIDGET_*`, `DATA_*`, `LIFECYCLE_*`, `MAPLIBRE_INTERNAL` constants from `lib/errorScopes.js`
- `MapBuilder.whenReady(fn)` additive map API
- `errorStates.pushBanner(envelope)` internal helper

## Acceptance criteria for v1.8.0

Concrete, testable "done":

1. **No exception escapes a Splunk lifecycle method.** Verified by integration test.
2. **A bad layer can't take down the whole panel.** Verified by integration test (5 layers active, kill 1, other 4 render).
3. **Bad SPL data sources fall back to `lastGoodData` if present, else show an info banner.** Verified by injection.
4. **Console output is structured and rate-limited.** `[better_map:scope] level: message` format; identical envelopes within 1s collapse to count.
5. **Error envelope ring buffer reaches `debugHud`.** New Errors tab shows recent envelopes grouped by scope.
6. **Quarantined layers visibly grey in the layer control.** Verified by `layerControl.js` test.
7. **Banner has Retry / Details / Dismiss for `recovery: 'degrade'`.** Retry re-runs the wrapped action.
8. **Existing 200 tests still pass; total ~320.** No regression.
9. **Build size growth ≤ 8 KB gzipped vs the v1.7.1 baseline.** Verified by `build.sh` size check.
10. **Browser console clean** on `better_map_spatial_analytics` dashboard with v2 widgets enabled.

## Concrete before/after — `wms.js`

```js
// Before — scattered defensive try/catch (paraphrased from current code):
export function update(map, sourceId, layerId, opts) {
    try { map.removeLayer(layerId); } catch (_) {}
    try { map.removeSource(sourceId); } catch (_) {}
    try {
        map.addSource(sourceId, { type: 'raster', tiles: [opts.url], /* ... */ });
        map.addLayer({ id: layerId, type: 'raster', source: sourceId, /* ... */ });
    } catch (e) {
        console.warn('wms update failed:', e);
    }
}

// After — one boundary, no scattered guards, structured reporting:
import { safeRun } from '../safeRun.js';
import { LAYER_WMS } from '../errorScopes.js';

export function update(map, sourceId, layerId, opts) {
    return safeRun({
        scope: LAYER_WMS,
        recovery: 'soft',
        panelRoot: map.getContainer().closest('.better_map-viz'),
        action: function () {
            removeIfPresent(map, layerId, sourceId);   // pure helper, may throw
            map.addSource(sourceId, { type: 'raster', tiles: [opts.url], /* ... */ });
            map.addLayer({ id: layerId, type: 'raster', source: sourceId, /* ... */ });
        },
        onError: function () {
            removeIfPresent(map, layerId, sourceId);   // clean half-built state
        }
    });
}
```

Net: scattered guards collapse into one boundary; the error reaches the HUD + envelope ring buffer; the layer hides itself with exponential backoff; no console spam; the rest of the panel keeps rendering. 10 try/catch sites in `wms.js` become ~2.
