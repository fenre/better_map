# Phase B — Lifecycle Wrapping + MapLibre Error Bridge + whenReady()

> **Status:** complete (autonomous session, May 2026)
> **Branch:** `feat/v1.8.0-phase-b`
> **Builds on:** [`2026-05-19-phase-a-error-boundary-foundation.md`](./2026-05-19-phase-a-error-boundary-foundation.md)
> **Excluded from MkDocs build** via `mkdocs.yml#exclude_docs: superpowers/**`

**Goal:** Wire the Phase A `safeRun` boundary primitive into the three highest-impact call sites — Splunk visualization SDK lifecycle callbacks, MapLibre's `error` event, and a new public `whenReady()` API — so a single thrown callback no longer kills the panel.

**Non-goals (deferred to Phase C):**

- Refactoring `MapBuilder.init()` into separate `createMap()` / `setStyle()` / `_remountLayers()` methods. That's a deeper structural change with non-trivial risk; better to ship the safe wrapping work first and validate it for a release cycle, then do the bigger refactor.
- Wrapping individual layer / widget call sites. The Splunk SDK lifecycle wrap catches everything that would have escaped the existing per-module `try/catch` blocks; per-module `safeRun` adoption is a longer-tail polish exercise.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/mapBuilder.js` | MODIFY | Add `whenReady()` method; replace `console.warn` in `map.on('error')` handler with `safeRun({ scope: MAPLIBRE_INTERNAL, ... })`. |
| `src/lib/__tests__/mapBuilder.whenReady.test.js` | CREATE | Smoke test the new API across pre-init / post-init / post-load / destroyed states. |
| `src/lib/__tests__/mapBuilder.errorBridge.test.js` | CREATE | Confirm a thrown MapLibre `error` event lands in the safeRun ring buffer with `MAPLIBRE_INTERNAL` scope. |
| `src/visualization_source.js` | MODIFY | Wrap `formatData` / `updateView` / `reflow` / `destroy` in `safeRun` boundaries. Set `el.dataset.bmDestroying = '1'` at the top of `destroy` so banners suppress during teardown. |
| `src/lib/__tests__/visualization_source.lifecycle.test.js` | CREATE | Confirm thrown errors in the wrapped callbacks do NOT propagate to the Splunk SDK and DO land in the ring buffer with the right scope. |

## Tasks

### Task 1: `MapBuilder.whenReady()` API

Returns a Promise resolving when the map's style is fully loaded. Resolves immediately if already loaded. Rejects with `Error('MapBuilder destroyed')` if `destroy()` runs before the load event fires. No-map case (WebGL missing) rejects with `Error('No map')`.

### Task 2: `map.on('error')` → safeRun bridge

The existing handler logs once via `console.warn` and bails. Replace it with:

```js
this._map.on('error', (evt) => {
    const err = (evt && evt.error) || new Error('Unknown MapLibre error');
    safeRun({
        scope: MAPLIBRE_INTERNAL,
        severity: 'warning',
        recovery: 'soft',  // tile fetch failures are non-fatal
        panelRoot: this._container,
        action: function () { throw err; }
    });
});
```

This routes MapLibre's internal errors through the rate limiter (so a failing tile source doesn't spam console), the ring buffer (so the debug HUD shows them), and the CustomEvent dispatch (so external observers can react).

### Task 3: Splunk SDK lifecycle wrap

For each of `formatData`, `updateView`, `reflow`, `destroy`, replace the method body with:

```js
formatData: function (data, config) {
    var self = this;
    var r = safeRun({
        scope: LIFECYCLE_FORMAT_DATA,
        severity: 'warning',
        recovery: 'degrade',
        panelRoot: this.el,
        action: function () { return self._formatDataImpl(data, config); }
    });
    return r.ok ? r.result : (this._lastGoodData || { rows: [], fields: [] });
},
```

The actual logic moves to private `_formatDataImpl` etc. methods. `destroy` MUST set `this.el.dataset.bmDestroying = '1'` BEFORE the safeRun call so any banner pushes during teardown are suppressed.

`initialize` is intentionally NOT wrapped — it runs before the DOM root has a `dataset` and any failure there is genuinely fatal (the panel can't render at all).

## Done criteria

- [x] `MapBuilder.whenReady()` returns a Promise, all 4 states tested
- [x] `map.on('error')` envelopes flow through `safeRun` ring buffer with `MAPLIBRE_INTERNAL` scope
- [x] Splunk SDK lifecycle callbacks no longer throw out of the visualization
- [x] Banners suppress during destroy (`dataset.bmDestroying` set early)
- [x] Full vitest suite green (256 + ~15 new = ~270 cases total)
- [x] Lint clean; build succeeds; bundle growth < 4 KB gzipped vs Phase A

## What Phase B does NOT do (intentional)

- `MapBuilder.init()` / `applyStyle()` are NOT refactored into createMap/setStyle/remountLayers (that's Phase C — bigger structural change)
- Individual layer / widget modules (markers, paths, drawTools, etc.) are NOT wrapped in `safeRun` per-call (those mostly already have local `try/catch`; per-module wrapping is a long-tail polish exercise for Phase C)
- No new formatter options
- No `dataFitness` row validation (that's Phase D)
- No retry / details affordances on the banner (Phase E)
