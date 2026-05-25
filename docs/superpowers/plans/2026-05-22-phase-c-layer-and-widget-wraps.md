# Phase C — Per-layer & per-widget safeRun wraps + quarantine telemetry

> **Status:** plan (autonomous session, May 2026)
> **Builds on:** [`2026-05-22-phase-b-lifecycle-and-bridge.md`](./2026-05-22-phase-b-lifecycle-and-bridge.md)
> **Spec:** [`../specs/2026-05-19-map-stability-design.md`](../specs/2026-05-19-map-stability-design.md) §"Boundary placement (5 tiers, ordered by blast radius)" — tiers 3 and 4
> **Excluded from MkDocs build** via `mkdocs.yml#exclude_docs: superpowers/**`

**Goal:** A failure inside one layer or one widget cannot take down the panel. Every layer module's `update()` is wrapped in a `safeRun({ scope: LAYER_*, recovery: 'soft' })` boundary; every widget in `v2Bundle.js` is wrapped in `safeRun({ scope: WIDGET_*, recovery: 'soft' })`. Layers / widgets that fail repeatedly auto-quarantine via the existing back-off schedule (`safeRun.js` already implements `1s → 5s → 30s → quarantined`); the layer control widget greys out quarantined entries and the debug HUD's Errors tab groups by scope.

**Non-goals (deferred to Phase D):**

- Wrapping the data-source layer (`splunk/rest.js`, `splunk/aiGeo.js`, `splunk/itsi.js`, `splunk/esNotable.js`, `splunk/mitre.js`, `widgets/geocoder.js`, `basemaps/pmtilesLoader.js`).
- `dataFitness` row-level validation.
- Per-layer field validation upstream of MapLibre calls.
- Refactoring `MapBuilder.init()` / `applyStyle()` into `createMap` / `setStyle` / `_remountLayers`. Phase B intentionally deferred this; revisit after Phase D ships.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/layers/index.js` | MODIFY | `reconcile()` already iterates over the active strategies. Wrap each strategy's `update()` invocation in `safeRun({ scope: LAYER_<NAME>, recovery: 'soft' })`. A failed layer should remove its source/layer from the map and stop participating in the render until the back-off timer expires. |
| `src/lib/widgets/v2Bundle.js` | MODIFY | The bundle wires up ~12 widgets. Each `try { widget.attach(map, opts) } catch { ... }` block becomes a `safeRun({ scope: WIDGET_<NAME>, recovery: 'soft' })` call. Same for the per-widget `setEnabled(true / false)` path. |
| `src/lib/layerControl.js` | MODIFY | Add a `markQuarantined(scopeId, reason)` API; the layer-control row for a quarantined strategy gets a `data-quarantined="1"` attribute and a CSS class so the existing `.better_map-layer-control__row` styles can grey it out. The control listens for `better_map:error` events on `panelRoot` and calls `markQuarantined` when an envelope arrives with `quarantined: true`. |
| `src/lib/__tests__/layers/reconcile.errorBoundary.test.js` | CREATE | TDD: kill one strategy mid-`update`, assert the OTHERS still render and the killed strategy emits an envelope with the right `LAYER_*` scope. |
| `src/lib/widgets/__tests__/v2Bundle.errorBoundary.test.js` | CREATE | TDD: instantiate a widget whose `attach()` throws, assert the bundle's other widgets still attach and the failing widget's envelope reaches the ring buffer. |
| `src/lib/__tests__/layerControl.quarantine.test.js` | CREATE | Verify `markQuarantined` toggles the `data-quarantined` attribute and the CSS class, and that the control responds to a `better_map:error` event correctly. |
| `visualization.css` | MODIFY | Add `.better_map-layer-control__row[data-quarantined="1"]` rule (greyed text + tooltip cursor). |

## Tasks

### Task 0 — Backfill missing layer scope constants

`errorScopes.js` (Phase A) defined the 13 layer constants enumerated in the spec, but the project actually ships 18 layer modules. Add the missing four BEFORE wrapping anything:

| Module | New constant |
|---|---|
| `layers/choropleth.js` | `LAYER_CHOROPLETH = 'layer:choropleth'` |
| `layers/featureJoin.js` | `LAYER_FEATURE_JOIN = 'layer:feature-join'` |
| `layers/indoor.js` | `LAYER_INDOOR = 'layer:indoor'` |
| `layers/polygons.js` | `LAYER_POLYGONS = 'layer:polygons'` |

Update `errorScopes.test.js` to assert all 18 layer constants are unique and start with `layer:`.

### Task 1 — Wrap each layer strategy in `reconcile()`

`reconcile(map, analysis, opts)` walks the registered strategies and calls each one's `update(map, sourceId, layerIds, sub-analysis, layerOpts)`. The loop is the natural boundary point.

```js
import { safeRun } from '../safeRun.js';
import {
    LAYER_MARKERS, LAYER_CLUSTERS, LAYER_HEATMAP, LAYER_PATHS,
    LAYER_HEXBIN, LAYER_EXTRUSION, LAYER_KML, LAYER_WMS,
    LAYER_GEOFENCE, LAYER_SCENEGRAPH, LAYER_WIND, LAYER_TRIPS,
    LAYER_MIL2525
} from '../errorScopes.js';

const STRATEGY_SCOPES = {
    markers: LAYER_MARKERS,
    clusters: LAYER_CLUSTERS,
    heatmap: LAYER_HEATMAP,
    paths: LAYER_PATHS,
    hexbin: LAYER_HEXBIN,
    extrusion: LAYER_EXTRUSION,
    kml: LAYER_KML,
    wms: LAYER_WMS,
    geofence: LAYER_GEOFENCE,
    scenegraph: LAYER_SCENEGRAPH,
    wind: LAYER_WIND,
    trips: LAYER_TRIPS,
    mil2525: LAYER_MIL2525,
    choropleth: LAYER_CHOROPLETH,
    featureJoin: LAYER_FEATURE_JOIN,
    indoor: LAYER_INDOOR,
    polygons: LAYER_POLYGONS
};

// Inside reconcile(), per strategy:
const scope = STRATEGY_SCOPES[strategyName] || `layer:${strategyName}`;
const r = safeRun({
    scope: scope,
    severity: 'warning',
    recovery: 'soft',
    panelRoot: map.getContainer().closest('.better_map-viz'),
    action: function () {
        return strategy.update(map, sourceId, layerIds, subAnalysis, layerOpts);
    },
    onError: function () {
        // Clean half-built state so retry is a no-op when the strategy
        // wakes up again after the back-off window.
        try { strategy.removeIfPresent(map, sourceId, layerIds); } catch (_e) { /* noop */ }
    }
});
// r.ok==false → safeRun has already emitted the envelope, recorded the
// failure for back-off, and dispatched better_map:error.
```

### Task 2 — Wrap each widget in `v2Bundle.js`

`v2Bundle.attach()` instantiates ~12 widgets in a single pass. Each one currently has a localised `try { ... } catch { console.warn(...) }`. Replace with `safeRun({ scope: WIDGET_*, recovery: 'soft' })`.

`createWidgetEntry(widgetName, attachFn, scope)` wraps the call:

```js
function attachWidget(name, scope, attachFn, panelRoot) {
    const r = safeRun({
        scope: scope,
        severity: 'warning',
        recovery: 'soft',
        panelRoot: panelRoot,
        action: attachFn
    });
    return r.ok ? r.result : null;
}
```

### Task 3 — Layer-control quarantine indicator

`layerControl` registers a single `better_map:error` listener on `panelRoot`. When an envelope arrives with `quarantined: true` (already supplied by `safeRun` after the 4th consecutive failure):

- Locate the row by its scope-id mapping (`STRATEGY_SCOPES` reverse-lookup)
- Set `row.dataset.quarantined = '1'`
- Add `aria-disabled="true"`
- Update the tooltip to "Layer disabled after repeated errors. Will retry automatically."

Recovery (back-off-timer expiry → next successful `update()` → safeRun's `_onSuccess` clears the back-off entry):

- We need a `better_map:error-clear` event from safeRun for that path. **Subtask:** add a `_safeReportClear(scope)` helper to `safeRun.js` and dispatch the event whenever `_onSuccess` runs. Keep this as a small, additive change — no contract break.

### Task 4 — Telemetry surface (debug HUD)

The Errors tab scaffolded in Phase A becomes useful only when there are envelopes. With Phase B + C in place, we now expect non-trivial volume during failure scenarios. Make sure the tab:

- Groups by `scope`, sorted by most-recent timestamp
- Shows the rate-limited count badge (e.g. "3× in last 60 s")
- Has a "Clear" button per scope (calls `clearErrorState(scope)`)

This is mostly UI plumbing — `getRecentErrors({ scope })` already exists.

## Done criteria

- [ ] Every strategy in `layers/index.js::reconcile` is wrapped in `safeRun`
- [ ] Every widget in `v2Bundle.js` is wrapped in `safeRun`
- [ ] Layer control rows for quarantined strategies show `data-quarantined="1"` and the CSS dim treatment
- [ ] Debug HUD Errors tab is functional (group by scope, rate-limited counts, clear button)
- [ ] New tests:
    - `reconcile.errorBoundary.test.js` — kill 1 of 5 strategies, others render
    - `v2Bundle.errorBoundary.test.js` — kill 1 widget, others attach
    - `layerControl.quarantine.test.js` — quarantine attribute toggles correctly
- [ ] Existing 267 tests still pass
- [ ] Lint clean; build succeeds; bundle growth ≤ 2 KB gzipped vs Phase B
- [ ] No new dependencies
- [ ] CHANGELOG entry added under `## v1.8.0 — Stability release` heading

## What Phase C does NOT do (intentional)

- No data-source wrap (`splunk/*` fetches) — that's Phase D
- No `dataFitness` row validation — Phase D
- No retry / details affordances on the banner — Phase E
- No formatter option additions
- No version bump (still 1.8.0; release lands in Phase F)

## Subagent dispatch plan

This phase is large enough to benefit from `subagent-driven-development`:

| Subagent task | Files touched | Tests |
|---|---|---|
| 1. Wrap reconcile() | `layers/index.js` | `reconcile.errorBoundary.test.js` |
| 2. Wrap v2Bundle | `widgets/v2Bundle.js` | `v2Bundle.errorBoundary.test.js` |
| 3. Layer control quarantine | `layerControl.js`, `visualization.css`, `safeRun.js` (event dispatch) | `layerControl.quarantine.test.js` |
| 4. Debug HUD Errors tab | `debugHud.js` | `debugHud.test.js` (extend existing) |

Each subagent task is independent; they can run in parallel. Each must pass full local gates before its commit lands.
