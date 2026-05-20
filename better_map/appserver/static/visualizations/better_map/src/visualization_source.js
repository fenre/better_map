/*
 * Better Map - Splunk custom visualization (AMD entry).
 *
 * Webpack consumes this file as an ES module and emits a single AMD bundle
 * (visualization.js) wrapped in `define([deps], function (...))` -- the
 * outer wrapper is guaranteed to be ES5 by `output.environment` in
 * webpack.config.js and verified by build.sh after every build.
 *
 * Phase 1 lifecycle:
 *   initialize           - container + state, NO MapLibre yet (lazy init)
 *   getInitialDataParams - row_major output, count tuned for general use
 *   formatData           - row pass-through plus lastGoodData caching
 *   updateView           - first call instantiates MapBuilder; subsequent
 *                          calls apply style + data updates
 *   reflow               - resize MapLibre canvas
 *   destroy              - tear down MapLibre and theme watcher
 *
 * CSP smoke test (Phase 1 deliverable, run on a real Splunk 10.2 host):
 *   1. Build the app with `./build.sh` and install on Splunk Enterprise 10.2+
 *   2. Drop a Better Map panel into a Dashboard Studio dashboard with SPL
 *      | makeresults count=3 | streamstats c
 *        | eval lat=case(c=1,37.77,c=2,40.71,c=3,51.50)
 *        | eval lon=case(c=1,-122.42,c=2,-74.0,c=3,-0.13)
 *   3. Open the browser console. The viz must initialise without:
 *        - "Refused to create a worker from 'blob:...'" (CSP worker-src)
 *        - "Refused to evaluate a string as JavaScript" (CSP unsafe-eval)
 *        - "Refused to load stylesheet" (CSP style-src)
 *      If any of these fire, switch to the maplibre-gl-csp build by
 *      following the comment block at the top of mapBuilder.js.
 */

import SplunkVisualizationBase from 'api/SplunkVisualizationBase';
import SplunkVisualizationUtils from 'api/SplunkVisualizationUtils';

// Bundle the viz's own stylesheet into the JS so it's injected at runtime.
// Splunk's classic SimpleXML viz framework auto-loads
// appserver/static/visualizations/<viz>/visualization.css, but Dashboard
// Studio v2 does NOT — without this import, .better_map-viz / .better_map-map
// have no width/height rules, the inner MapLibre <div> collapses to 0x0,
// and the canvas renders nothing visible (the viz chrome still paints
// because the className strings are set, but they fall back to default
// block flow). webpack style-loader injects this via <style> at runtime.
import '../visualization.css';

import { MapBuilder } from './lib/mapBuilder.js';
import { createThemeWatcher } from './lib/theme.js';
import { analyze } from './lib/dataFitness.js';
import { DEFAULT_PROVIDER } from './lib/styles.js';
import { renderErrorBanner } from './lib/errorStates.js';
import { createLayerControl } from './lib/layerControl.js';
import { createScrubber } from './lib/time/scrubber.js';
import { VIRIDIS, RDYLBU, SET3, CYBER, SYNTHWAVE, TACTICAL } from './lib/palettes.js';
import { waitForVisible, reserveContext, releaseContext, contextsLeft } from './lib/lazyInit.js';
import { createPerfHUD } from './lib/perfHUD.js';
import { createDebugHud } from './lib/debugHud.js';
import { createViewLock } from './lib/viewLock.js';
import { createLiveRegion, applyHighContrast } from './lib/a11y.js';
import {
    createExportShare,
    exportPng,
    encodeShareHash,
    copyToClipboard
} from './lib/exportShare.js';

// v1.5.2 — BM-CT-1 wiring. The control panel widget shows per-action
// toggles + reset buttons plus the master "Pause all motion" + "Reset
// view" controls. Each animation module exposes a setEnabled/isEnabled
// /reset triple that we register with MapBuilder.registerFancyAction
// during initial builder spin-up. See `.cursor/rules/bm-control-trio.mdc`
// for the full architectural contract.
import { createControlPanel } from './lib/controlPanel.js';
import { setMotionPaused as motionSetPaused } from './lib/motion.js';
import * as pathsLayer from './lib/layers/paths.js';
import * as markersLayer from './lib/layers/markers.js';
import * as extrusionLayer from './lib/layers/extrusion.js';
import * as hexbinLayer from './lib/layers/hexbin.js';
// v1.7 — demo data pack. The formatter exposes a "Demo & onboarding"
// dropdown (`demoPreset`); when set to anything other than "none",
// formatData() substitutes a deterministic generated dataset for the
// SPL result, so the viz showcases its full feature surface on any
// panel — even a panel whose SPL returns zero rows. See the
// "Adding a new demo preset" recipe in docs/_machine/agents.md.
import { isDemoPreset, loadDemoPreset } from './lib/demo/index.js';
// v1.6 — bundle of every new widget, layer, and Splunk integration.
// The bundle exposes setEnabled/isEnabled/reset for each item and
// registers them with the master control panel automatically.
import { createV2Bundle } from './lib/widgets/v2Bundle.js';

function getOption(config, ns, key, defaultValue) {
    var v = config[ns + key];
    if (v !== undefined && v !== null) {
        return v;
    }
    v = config[key];
    if (v !== undefined && v !== null) {
        return v;
    }
    return defaultValue;
}

function parseBool(v, fallback) {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'string') {
        var s = v.toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no') return false;
    }
    if (typeof v === 'number') return v !== 0;
    return fallback;
}

// Parse a "lng,lat;lng,lat;lng,lat;lng,lat" quad into a coordinates array.
// Returns null on any parse failure so callers can disable the layer.
function parseQuad(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    var parts = raw.split(';');
    if (parts.length !== 4) return null;
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].split(',');
        if (pair.length !== 2) return null;
        var lng = parseFloat(pair[0]);
        var lat = parseFloat(pair[1]);
        if (!isFinite(lng) || !isFinite(lat)) return null;
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
        out.push([lng, lat]);
    }
    return out;
}

export default SplunkVisualizationBase.extend({
    initialize: function () {
        SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
        this.el.classList.add('better_map-viz');

        this._builder = null;
        this._themeWatcher = null;
        this._themeUnsub = null;
        this._lastAnalysis = null;
        this._lastGoodData = null;
        this._layerControl = null;
        this._scrubber = null;
        this._perfHUD = null;
        this._viewLock = null;
        this._liveRegion = null;
        this._exportShare = null;
        this._debugHud = null;
        this._cancelVisibilityWatch = null;
        this._contextReserved = false;
        this._waitingForVisibility = false;
        // v1.5.2 — BM-CT-1 widget + last-applied motion-pause state. We
        // track the previous value so applyOptions only re-applies the
        // OS-level motion pause when it actually changed (avoids
        // thrashing the cached prefers-reduced-motion query each tick).
        this._controlPanel = null;
        this._lastMotionPaused = null;

        // Hidden ARIA live region for status announcements (tooltip text,
        // layer toggles, error banners). Created up-front so the screen
        // reader doesn't see a late-injected status node.
        this._liveRegion = createLiveRegion(this.el);
    },

    getInitialDataParams: function () {
        return {
            outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
            count: 50000
        };
    },

    formatData: function (data, config) {
        // v1.7 — demo preset interception. Runs BEFORE the empty-data
        // fallback so the viz can render demo data on any panel,
        // including one whose SPL returns zero rows (the "Drop the
        // viz onto a blank dashboard" onboarding flow).
        //
        // We deliberately do NOT cache demoData into _lastGoodData:
        // when the user toggles demoPreset back to "none", the next
        // tick must render the real SPL result (or empty state) —
        // not stale demo data left behind from the previous render.
        var ns = this.getPropertyNamespaceInfo().propertyNamespace;
        var demoPreset = config
            ? String(getOption(config, ns, 'demoPreset', 'none') || 'none')
            : 'none';
        if (isDemoPreset(demoPreset)) {
            var demoData = loadDemoPreset(demoPreset);
            if (demoData && demoData.rows && demoData.rows.length > 0) {
                this._activeDemoPreset = demoPreset;
                return demoData;
            }
        } else if (this._activeDemoPreset) {
            // User just switched the preset OFF — make sure the next
            // render does not silently keep showing demo data via
            // _lastGoodData. The real SPL data (or empty state) wins.
            this._activeDemoPreset = null;
        }

        if (!data || !data.rows || !data.fields || data.rows.length === 0) {
            if (this._lastGoodData) {
                return this._lastGoodData;
            }
            return { rows: [], fields: [] };
        }

        var result = { rows: data.rows, fields: data.fields };
        this._lastGoodData = result;
        return result;
    },

    updateView: function (data, config) {
        if (!data && this._lastGoodData) {
            data = this._lastGoodData;
        }
        if (!data) {
            return;
        }

        var rect = this.el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }

        var ns = this.getPropertyNamespaceInfo().propertyNamespace;
        var providerOpt = getOption(config, ns, 'tileProvider', DEFAULT_PROVIDER);
        var apiKey = getOption(config, ns, 'tileProviderApiKey', '');
        var customStyle = getOption(config, ns, 'customStyleUrl', '');
        var allowPitch = parseBool(
            getOption(config, ns, 'allowPitch', 'true'),
            true
        );
        var allowRotate = parseBool(
            getOption(config, ns, 'allowRotate', 'true'),
            true
        );
        var lockView = parseBool(
            getOption(config, ns, 'lockView', 'false'),
            false
        );
        var pointRenderer = String(
            getOption(config, ns, 'pointRenderer', 'auto')
        ).toLowerCase();
        var showLayerControl = parseBool(
            getOption(config, ns, 'showLayerControl', 'true'),
            true
        );
        // v1.5.2 — BM-CT-1 master controls. `showControlPanel` toggles
        // the on-map widget; `motionPaused` is the dashboard-author
        // initial value for the master "Pause all motion" state (the
        // user can flip it at runtime via the widget). Default is to
        // show the panel and start un-paused.
        var showControlPanel = parseBool(
            getOption(config, ns, 'showControlPanel', 'true'),
            true
        );
        var motionPaused = parseBool(
            getOption(config, ns, 'motionPaused', 'false'),
            false
        );

        var self = this;
        if (!this._themeWatcher) {
            this._themeWatcher = createThemeWatcher(SplunkVisualizationUtils);
            this._themeWatcher.applyToRoot(this.el);
            this._themeUnsub = this._themeWatcher.subscribe(function () {
                self._themeWatcher.applyToRoot(self.el);
                self.invalidateUpdateView();
            });
        }
        var theme = this._themeWatcher.current;

        var enableDrilldown = parseBool(getOption(config, ns, 'enableDrilldown', 'true'), true);
        var enableCrossPanel = parseBool(getOption(config, ns, 'enableCrossPanel', 'true'), true);
        var enablePopups = parseBool(getOption(config, ns, 'enablePopups', 'true'), true);
        // v1.7 — Tier 3 #9: suppress popup flash when click is also a drilldown.
        var closePopupOnDrilldown = parseBool(
            getOption(config, ns, 'closePopupOnDrilldown', 'false'),
            false
        );
        // v1.7 — Tier 2 #5 (hover preview) + #6 (inline-style allowlist).
        // Read these here so they can flow into initOpts → enableIntegrations
        // on first map mount. The same getOption() calls happen later in
        // updateView() so re-applying the drilldown handler on subsequent
        // updateView passes picks up dashboard-author changes.
        var enableHoverPreview = parseBool(
            getOption(config, ns, 'enableHoverPreview', 'false'),
            false
        );
        var hoverHtmlField = String(
            getOption(config, ns, 'hoverHtmlField', 'hover') || 'hover'
        ).trim() || 'hover';
        var popupAllowInlineStyles = parseBool(
            getOption(config, ns, 'popupAllowInlineStyles', 'false'),
            false
        );
        var showPerfHUD = parseBool(getOption(config, ns, 'showPerfHUD', 'false'), false);
        var showDebugHud = parseBool(getOption(config, ns, 'showDebugHud', 'false'), false);
        var highContrast = parseBool(getOption(config, ns, 'highContrast', 'false'), false);
        var labelLanguage = String(getOption(config, ns, 'labelLanguage', '') || '').trim();
        var enableExportShare = parseBool(getOption(config, ns, 'enableExportShare', 'true'), true);
        // v1.5.0 sexy-maps options. After the user chose "FULL" visual
        // upgrades, the cinematic 30°/15° camera became the new default.
        // Dashboards can opt out by passing cameraPitch=0 cameraBearing=0.
        // The pitch is what makes glow paths and pulsing markers actually
        // *look* like the sexy maps people post on Twitter — pure top-down
        // is the "Splunk dashboard from 2009" look.
        var cameraPitch = parseFloat(getOption(config, ns, 'cameraPitch', '30'));
        var cameraBearing = parseFloat(getOption(config, ns, 'cameraBearing', '15'));
        var vignette = parseBool(getOption(config, ns, 'vignette', 'true'), true);

        // v1.6 — per-feature default-state map. The v2 bundle defaults
        // every entry to OFF; the formatter lets dashboard authors flip
        // any of them to ON at load time. Keys MUST match the instance
        // keys inside createV2Bundle (see src/lib/widgets/v2Bundle.js).
        var v2Defaults = {
            geocoder:         parseBool(getOption(config, ns, 'v2Geocoder',         'false'), false),
            commandPalette:   parseBool(getOption(config, ns, 'v2CommandPalette',   'false'), false),
            minimap:          parseBool(getOption(config, ns, 'v2Minimap',          'false'), false),
            drawTools:        parseBool(getOption(config, ns, 'v2DrawTools',        'false'), false),
            measure:          parseBool(getOption(config, ns, 'v2Measure',          'false'), false),
            lasso:            parseBool(getOption(config, ns, 'v2Lasso',            'false'), false),
            brushing:         parseBool(getOption(config, ns, 'v2Brushing',         'false'), false),
            sideBySide:       parseBool(getOption(config, ns, 'v2SideBySide',       'false'), false),
            spatialQuery:     parseBool(getOption(config, ns, 'v2SpatialQuery',     'false'), false),
            timeSplit:        parseBool(getOption(config, ns, 'v2TimeSplit',        'false'), false),
            wmsLayer:         parseBool(getOption(config, ns, 'v2WmsLayer',         'false'), false),
            kmlLayer:         parseBool(getOption(config, ns, 'v2KmlLayer',         'false'), false),
            tripsLayer:       parseBool(getOption(config, ns, 'v2TripsLayer',       'false'), false),
            geofenceLayer:    parseBool(getOption(config, ns, 'v2GeofenceLayer',    'false'), false),
            windLayer:        parseBool(getOption(config, ns, 'v2WindLayer',        'false'), false),
            scenegraphLayer:  parseBool(getOption(config, ns, 'v2ScenegraphLayer',  'false'), false),
            mil2525Layer:     parseBool(getOption(config, ns, 'v2Mil2525Layer',     'false'), false),
            mitre:            parseBool(getOption(config, ns, 'v2Mitre',            'false'), false),
            esNotable:        parseBool(getOption(config, ns, 'v2EsNotable',        'false'), false),
            itsi:             parseBool(getOption(config, ns, 'v2Itsi',             'false'), false),
            soar:             parseBool(getOption(config, ns, 'v2Soar',             'false'), false),
            rba:              parseBool(getOption(config, ns, 'v2Rba',              'false'), false),
            purdue:           parseBool(getOption(config, ns, 'v2Purdue',           'false'), false),
            aiGeo:            parseBool(getOption(config, ns, 'v2AiGeo',            'false'), false),
            aiAssistant:      parseBool(getOption(config, ns, 'v2AiAssistant',      'false'), false)
        };
        // Endpoint URLs and per-feature config strings consumed by the
        // v2 bundle. Splunk integrations that have empty endpoints stay
        // disabled even if their toggle is on (the modules log a noop).
        var v2EndpointOpts = {
            wmsLayer:    { url: String(getOption(config, ns, 'v2WmsUrl', '') || ''),
                           layers: String(getOption(config, ns, 'v2WmsLayers', '') || '') },
            esNotable:   { baseUrl: String(getOption(config, ns, 'v2EsBaseUrl', '') || '') },
            soar:        { url: String(getOption(config, ns, 'v2SoarUrl', '') || '') },
            purdue:      { lookup: String(getOption(config, ns, 'v2PurdueLookup', 'ot_asset_register') || '') }
        };
        // Stash on `this` so the lazy-init callback (which fires async
        // when the panel first becomes visible) reads the freshest
        // values, and so subsequent updateView() cycles can re-apply
        // formatter changes to a live bundle without a full rebuild.
        this._v2Defaults = v2Defaults;
        this._v2EndpointOpts = v2EndpointOpts;

        applyHighContrast(this.el, highContrast);

        // v1.5.2 — BM-CT-1: push the dashboard-author motion-paused
        // value into the shared motion.js state ONLY when it changes
        // (so a user's runtime toggle via the control panel is not
        // clobbered by every redraw). The first call MUST always
        // apply, even if the dashboard default is `false`, so that the
        // shared state matches the formatter.
        if (this._lastMotionPaused !== motionPaused) {
            motionSetPaused(motionPaused);
            this._lastMotionPaused = motionPaused;
            if (this._builder && typeof this._builder.setMotionPaused === 'function') {
                this._builder.setMotionPaused(motionPaused);
            }
        }

        if (showDebugHud && !this._debugHud) {
            this._debugHud = createDebugHud(this.el);
        } else if (!showDebugHud && this._debugHud) {
            this._debugHud.destroy();
            this._debugHud = null;
        }

        if (!this._builder) {
            // Lazy-init guard: only spin up MapLibre once the panel is in or
            // near the viewport and the WebGL context budget has room.
            if (!reserveContext()) {
                this._waitingForVisibility = true;
                renderErrorBanner(this.el, {
                    kind: 'warning',
                    message:
                        'Better Map: too many maps on this page (' +
                        contextsLeft() +
                        ' WebGL slots free). Reduce panels or refresh.'
                });
                return;
            }
            this._contextReserved = true;

            var initSelf = this;
            var initOpts = {
                provider: providerOpt,
                theme: theme,
                apiKey: apiKey,
                customStyleUrl: customStyle,
                allowPitch: allowPitch,
                allowRotate: allowRotate,
                enableDrilldown: enableDrilldown,
                enableCrossPanel: enableCrossPanel,
                enablePopups: enablePopups,
                // v1.7 — forwarded into enableIntegrations on first mount.
                popupAllowInlineStyles: popupAllowInlineStyles,
                enableHoverPreview: enableHoverPreview,
                hoverHtmlField: hoverHtmlField,
                closePopupOnDrilldown: closePopupOnDrilldown,
                labelLanguage: labelLanguage,
                pitch: isFinite(cameraPitch) ? cameraPitch : 0,
                bearing: isFinite(cameraBearing) ? cameraBearing : 0
            };
            // Vignette overlay is a CSS-only effect — toggle via a class
            // on the viz root so the v1.5.0 default (on) can be turned
            // off per-panel without rebuilding the bundle.
            if (vignette) {
                this.el.classList.add('better_map-vignette');
            } else {
                this.el.classList.remove('better_map-vignette');
            }
            this._cancelVisibilityWatch = waitForVisible(this.el, function () {
                initSelf._cancelVisibilityWatch = null;
                initSelf._waitingForVisibility = false;
                initSelf._builder = new MapBuilder(initSelf.el);
                if (initSelf._debugHud) {
                    initSelf._builder.setDebugHud(initSelf._debugHud);
                }
                initSelf._builder.init(initOpts);
                if (initSelf._builder.map) {
                    if (initSelf._debugHud) {
                        initSelf._debugHud.attach(initSelf._builder.map);
                    }
                    initSelf._builder.enableIntegrations(initSelf, {
                        drilldown: initOpts.enableDrilldown,
                        crossPanel: initOpts.enableCrossPanel,
                        drilldownOptions: {
                            enablePopups: initOpts.enablePopups,
                            // v1.7 — Tier 2 #5 / #6 / new closePopupOnDrilldown
                            popupAllowInlineStyles: initOpts.popupAllowInlineStyles,
                            enableHoverPreview: initOpts.enableHoverPreview,
                            hoverHtmlField: initOpts.hoverHtmlField,
                            closePopupOnDrilldown: initOpts.closePopupOnDrilldown
                        }
                    });
                    if (showPerfHUD && !initSelf._perfHUD) {
                        initSelf._perfHUD = createPerfHUD(initSelf.el);
                        initSelf._perfHUD.attach(initSelf._builder.map);
                    }
                    // v1.5.2 — BM-CT-1: register every fancy action
                    // with the builder's registry, then mount the
                    // control panel widget. Done once after first map
                    // init so the actions are immediately discoverable
                    // — they no-op gracefully when the host layer is
                    // not yet present (no markers, no paths, etc.).
                    initSelf._registerFancyActions();
                    // v1.6 — instantiate the v2 widget/layer/Splunk
                    // bundle and register every entry as a fancy
                    // action so the master control panel auto-
                    // discovers them. Idempotent: if a previous
                    // applyAnalysis() call already created a bundle
                    // it's destroyed first to avoid double registration.
                    try {
                        if (initSelf._v2Bundle && typeof initSelf._v2Bundle.destroy === 'function') {
                            initSelf._v2Bundle.destroy();
                        }
                        initSelf._v2Bundle = createV2Bundle(
                            initSelf.el,
                            initSelf._builder,
                            initSelf,
                            initSelf._v2EndpointOpts || {}
                        );
                        initSelf._v2Bundle.register(initSelf._builder);
                        // Apply the dashboard-author's per-feature default
                        // state once the bundle exists.
                        initSelf._applyV2Defaults();
                    } catch (_e) {
                        // v2 bundle is non-critical; swallow so a single
                        // misbehaving widget can't take down the viz.
                        initSelf._v2Bundle = null;
                    }
                    if (showControlPanel) {
                        initSelf._mountControlPanel();
                    }
                    // Honour the dashboard-author motion-paused
                    // default exactly once after the map is live so
                    // the builder's internal state matches the
                    // formatter from the very first frame.
                    if (motionPaused && typeof initSelf._builder.setMotionPaused === 'function') {
                        initSelf._builder.setMotionPaused(true);
                    }
                    // Force a re-run of updateView now that the map is live.
                    initSelf.invalidateUpdateView();
                }
            });
            return;
        }
        this._builder.applyStyle({
            provider: providerOpt,
            theme: theme,
            apiKey: apiKey,
            customStyleUrl: customStyle
        });
        // Vignette toggle on subsequent cycles so the user can flip it
        // from the formatter at runtime.
        if (vignette) {
            this.el.classList.add('better_map-vignette');
        } else {
            this.el.classList.remove('better_map-vignette');
        }
        if (typeof this._builder.setLabelLanguage === 'function') {
            this._builder.setLabelLanguage(labelLanguage);
        }
        // v1.6 — re-apply per-feature default-state on every redraw so
        // the dashboard author can toggle a v2 widget in the formatter
        // and see it take effect without reloading the dashboard.
        this._applyV2Defaults();

        if (!this._builder.map) {
            return;
        }

        // Toggle perf HUD based on the current option value.
        if (showPerfHUD && !this._perfHUD) {
            this._perfHUD = createPerfHUD(this.el);
            this._perfHUD.attach(this._builder.map);
        } else if (!showPerfHUD && this._perfHUD) {
            this._perfHUD.destroy();
            this._perfHUD = null;
        }

        var analysis;
        try {
            analysis = analyze({ rows: data.rows, fields: data.fields });
        } catch (err) {
            renderErrorBanner(
                this.el,
                'Better Map: could not parse search results: ' +
                    (err && err.message ? err.message : err)
            );
            return;
        }
        this._lastAnalysis = analysis;

        if (this._debugHud && this._debugHud.recordInput) {
            try {
                this._debugHud.recordInput(
                    (data.rows || []).length,
                    (data.fields || []).map(function (f) { return f && f.name; })
                );
            } catch (_e) { /* ignore */ }
        }
        if (this._debugHud && this._debugHud.recordAnalysis) {
            try { this._debugHud.recordAnalysis(analysis); } catch (_e) { /* ignore */ }
        }

        var paletteId = String(getOption(config, ns, 'palette', 'viridis')).toLowerCase();
        var markerColor = getOption(config, ns, 'markerColor', '');
        var markerOutline = getOption(config, ns, 'markerOutline', '');

        // ------------------------------------------------------------------
        // v1.7 — Per-row marker labels (Tier 1 #3)
        // ------------------------------------------------------------------
        // The label layer plumbing was half-built in v1.3.x (markers.js
        // L274 read `label || name || tooltip`) but never surfaced to
        // dashboard authors. v1.7 finishes it: configurable field, min
        // zoom (so labels don't collide at world zoom), and themeable
        // colours so the NOC operator can read site names from across
        // the room without hovering.
        var showLabels = parseBool(getOption(config, ns, 'showLabels', 'false'), false);
        var labelField = String(getOption(config, ns, 'labelField', '') || '').trim();
        var labelMinZoom = parseFloat(getOption(config, ns, 'labelMinZoom', '3'));
        var labelColor = String(getOption(config, ns, 'labelColor', '') || '').trim();
        var labelHaloColor = String(getOption(config, ns, 'labelHaloColor', '') || '').trim();
        var labelOffsetY = parseFloat(getOption(config, ns, 'labelOffsetY', '1.1'));

        // ------------------------------------------------------------------
        // v1.7 — Selected-feature emphasis (Tier 1 #1)
        // ------------------------------------------------------------------
        // The dashboard sets `selectedFeatureToken` to the NAME of a
        // dashboard token; whatever value is currently bound to that
        // token becomes the literal selection value. We resolve the
        // token from `config` by trying `<token_name>` (Dashboard Studio
        // automatically inlines token values into the config under
        // their bare token names) and `selectedFeatureValue` (legacy
        // direct-field fallback for callers that prefer to bind the
        // value directly without the token-name indirection).
        //
        // selectedFeatureField is the column name in the row data to
        // match against — defaults to `id` which is what dataFitness
        // auto-detects.
        //
        // selectedEmphasis.* are flattened into top-level options so
        // they survive Splunk's per-attribute serialization without
        // requiring nested-object parsing. The OWNING dashboard never
        // sees the nested shape; it sees flat keys identical to every
        // other formatter option.
        var selectedFeatureTokenName = String(
            getOption(config, ns, 'selectedFeatureToken', '') || ''
        ).trim();
        var selectedFeatureField = String(
            getOption(config, ns, 'selectedFeatureField', 'id') || 'id'
        ).trim() || 'id';
        var selectedFeatureValue;
        if (selectedFeatureTokenName) {
            // Token-name indirection: the dashboard publishes its
            // current token value under the bare token name in config.
            // Empty / undefined means "no selection".
            var raw = config[selectedFeatureTokenName];
            if (raw === undefined || raw === null || raw === '' || raw === '*') {
                selectedFeatureValue = null;
            } else {
                selectedFeatureValue = String(raw);
            }
        } else {
            // No token indirection — read a direct value option (or null).
            var direct = getOption(config, ns, 'selectedFeatureValue', '');
            if (direct === undefined || direct === null || direct === '' || direct === '*') {
                selectedFeatureValue = null;
            } else {
                selectedFeatureValue = String(direct);
            }
        }
        var selectedSizeMultiplier = parseFloat(
            getOption(config, ns, 'selectedSizeMultiplier', '2.5')
        );
        var selectedHaloColor = String(
            getOption(config, ns, 'selectedHaloColor', '#22D3EE') || '#22D3EE'
        );
        var selectedHaloWidth = parseFloat(
            getOption(config, ns, 'selectedHaloWidth', '4')
        );
        var selectedFlyToOnChange = parseBool(
            getOption(config, ns, 'selectedFlyToOnChange', 'true'),
            true
        );
        var selectedFlyToZoom = parseFloat(
            getOption(config, ns, 'selectedFlyToZoom', '8')
        );

        // ------------------------------------------------------------------
        // v1.7 — Inbound camera control (Tier 1 #2 — applyRemoteCamera)
        // ------------------------------------------------------------------
        // crossPanel.js already defines applyRemoteCamera() which reads
        // `better_map.camera.lng/lat/zoom` and calls map.jumpTo. We
        // never invoked it because enableCrossPanel was outbound-only.
        // The mirror toggle `acceptRemoteCamera` subscribes the map to
        // those same tokens on incoming so any other panel can drive
        // the camera by calling setToken('better_map.camera.lat', ...)
        // etc. Additionally, the dashboard author may bind their own
        // token names via `remoteCameraTokenLng/Lat/Zoom` and we'll
        // resolve those off config the same way as selectedFeatureToken.
        var acceptRemoteCamera = parseBool(
            getOption(config, ns, 'acceptRemoteCamera', 'false'),
            false
        );
        var remoteCameraTokenLng = String(
            getOption(config, ns, 'remoteCameraTokenLng', '') || ''
        ).trim();
        var remoteCameraTokenLat = String(
            getOption(config, ns, 'remoteCameraTokenLat', '') || ''
        ).trim();
        var remoteCameraTokenZoom = String(
            getOption(config, ns, 'remoteCameraTokenZoom', '') || ''
        ).trim();

        // Resolve the actual lng/lat/zoom values. Two paths:
        //   1. Custom token names: read config[<token-name>] directly
        //   2. Defaults: the canonical cross-panel token namespace
        //      (`better_map.camera.lng/lat/zoom`) which crossPanel.js
        //      already publishes outbound.
        var remoteCameraLng = NaN;
        var remoteCameraLat = NaN;
        var remoteCameraZoom = NaN;
        if (acceptRemoteCamera) {
            var lngKey = remoteCameraTokenLng || 'better_map.camera.lng';
            var latKey = remoteCameraTokenLat || 'better_map.camera.lat';
            var zoomKey = remoteCameraTokenZoom || 'better_map.camera.zoom';
            remoteCameraLng = parseFloat(config[lngKey]);
            remoteCameraLat = parseFloat(config[latKey]);
            remoteCameraZoom = parseFloat(config[zoomKey]);
        }

        // Hover preview + inline-style allowlist are read earlier in
        // updateView() (alongside enablePopups) so they can flow into
        // the initial enableIntegrations() call. See above.
        var pathColor = getOption(config, ns, 'pathColor', '');
        var pathWidth = parseFloat(getOption(config, ns, 'pathWidth', ''));
        var pathArrows = parseBool(getOption(config, ns, 'pathArrows', 'false'), false);
        var pathAnimated = parseBool(getOption(config, ns, 'pathAnimated', 'false'), false);
        // v1.5.0 — laser-beam glow under each path. Default ON because
        // the new default basemap (Carto Dark Matter) makes flat lines
        // hard to distinguish from the muted grey landmasses.
        var pathGlow = parseBool(getOption(config, ns, 'pathGlow', 'true'), true);
        // v1.5.1 — traveling comets along arc-shape data. Defaults to
        // 'auto' which means "ON when the FC contains LineString
        // features tagged isArc=true". Explicit 'true' / 'false' force
        // the behaviour regardless of arc detection. The comet emitter
        // is the single biggest visual upgrade in v1.5.1: every arc
        // gets a glowing packet that travels src->dst and dissolves
        // into the destination, giving the NORSE-map "data is alive"
        // signature.
        var pathCometRaw = String(getOption(config, ns, 'pathComet', 'auto')).toLowerCase();
        var pathComet;
        if (pathCometRaw === 'auto' || pathCometRaw === '') {
            pathComet = undefined; // let paths.js auto-detect
        } else {
            pathComet = parseBool(pathCometRaw, true);
        }
        // v1.5.0 — animated radar-ring ping under each marker. Default
        // ON for sparse-point views; the dispatcher only mounts markers
        // for < 200 features so the animation overhead is negligible.
        var pointPulse = parseBool(getOption(config, ns, 'pointPulse', 'true'), true);
        var polygonFill = getOption(config, ns, 'polygonFill', '');
        var polygonOpacity = parseFloat(getOption(config, ns, 'polygonOpacity', ''));
        var heatmapRadius = parseFloat(getOption(config, ns, 'heatmapRadius', ''));
        var heatmapOpacity = parseFloat(getOption(config, ns, 'heatmapOpacity', ''));
        var hexbinOpacity = parseFloat(getOption(config, ns, 'hexbinOpacity', ''));
        var enable3D = parseBool(getOption(config, ns, 'enable3DExtrusion', 'false'), false);
        var enableChoropleth = parseBool(
            getOption(config, ns, 'enableChoropleth', 'false'),
            false
        );
        var hexbinEnabled = pointRenderer === 'hexbin';
        var autoDegradeHex = parseBool(
            getOption(config, ns, 'hexbinAutoDegrade', 'true'),
            true
        );
        var hexbinResolution = parseInt(
            getOption(config, ns, 'hexbinResolution', ''),
            10
        );
        // v1.5.1 — breathing extrusion. When true, hexbin / 3D extrusion
        // column heights gently rise and fall by +/-12% on a 4s sine
        // wave. Opt-in because the effect changes the perceived value
        // of the underlying metric; only enable on dashboards where
        // "this is live telemetry" is more important than "this is the
        // exact value right now".
        var extrusionPulse = parseBool(getOption(config, ns, 'extrusionPulse', 'false'), false);
        // v1.5.1 — slow continuous bearing rotation. Speed expressed in
        // degrees-per-second; 3 deg/s completes a full orbit in 2 minutes
        // which feels alive without being distracting. Pauses on user
        // interaction and resumes 5s after the last interaction.
        var cameraAutoOrbit = parseBool(getOption(config, ns, 'cameraAutoOrbit', 'false'), false);
        var autoOrbitSpeed = parseFloat(getOption(config, ns, 'autoOrbitSpeed', '3'));
        var featureJoinPreset = getOption(config, ns, 'featureJoinPreset', '');
        var featureJoinUrl = getOption(config, ns, 'featureJoinUrl', '');
        var featureJoinSourceLayer = getOption(config, ns, 'featureJoinSourceLayer', '');
        var featureJoinPromoteId = getOption(config, ns, 'featureJoinPromoteId', '');
        var featureJoinEnabled = Boolean(
            featureJoinPreset || (featureJoinUrl && featureJoinSourceLayer)
        );
        var indoorImage = getOption(config, ns, 'indoorImageUrl', '');
        var indoorCoords = parseQuad(getOption(config, ns, 'indoorImageCoordinates', ''));
        var indoorOpacity = parseFloat(getOption(config, ns, 'indoorOpacity', '0.95'));

        var palette = resolvePalette(paletteId);

        this._builder.applyAnalysis(analysis, {
            pointRenderer: pointRenderer,
            markers: {
                color: markerColor || undefined,
                outline: markerOutline || undefined,
                pulse: pointPulse,
                // v1.7 — Tier 1 #3 label options
                showLabels: showLabels,
                labelField: labelField || undefined,
                labelMinZoom: isFinite(labelMinZoom) ? labelMinZoom : undefined,
                labelColor: labelColor || undefined,
                labelHaloColor: labelHaloColor || undefined,
                labelOffsetY: isFinite(labelOffsetY) ? labelOffsetY : undefined,
                // v1.7 — Tier 1 #1 selected-feature emphasis options.
                // selectedFeatureValue is undefined when the dashboard
                // hasn't bound a selection token, null when the
                // dashboard explicitly cleared the selection, or a
                // string with the current value otherwise.
                selectedFeatureField: selectedFeatureField,
                selectedFeatureValue: selectedFeatureValue,
                selectedSizeMultiplier: isFinite(selectedSizeMultiplier)
                    ? selectedSizeMultiplier
                    : undefined,
                selectedHaloColor: selectedHaloColor || undefined,
                selectedHaloWidth: isFinite(selectedHaloWidth) ? selectedHaloWidth : undefined,
                selectedFlyToOnChange: selectedFlyToOnChange,
                selectedFlyToZoom: isFinite(selectedFlyToZoom) ? selectedFlyToZoom : undefined
            },
            clusters: {
                color: markerColor || undefined,
                outline: markerOutline || undefined
            },
            heatmap: {
                palette: palette,
                radiusLow: isFinite(heatmapRadius) ? heatmapRadius : undefined,
                radiusHigh: isFinite(heatmapRadius) ? heatmapRadius * 3.75 : undefined,
                opacity: isFinite(heatmapOpacity) ? heatmapOpacity : undefined
            },
            hexbin: {
                autoDegrade: !isFinite(hexbinResolution) && autoDegradeHex,
                resolution: isFinite(hexbinResolution) ? hexbinResolution : undefined,
                extrude: hexbinEnabled && enable3D,
                aggregate: getOption(config, ns, 'hexbinAggregate', 'count'),
                palette: palette,
                opacity: isFinite(hexbinOpacity) ? hexbinOpacity : undefined,
                pulse: extrusionPulse
            },
            paths: {
                color: pathColor || undefined,
                width: isFinite(pathWidth) ? pathWidth : undefined,
                animated: pathAnimated,
                arrowHeads: pathArrows,
                glow: pathGlow,
                comet: pathComet,
                outline: markerOutline || undefined
            },
            polygons: {
                fill: polygonFill || undefined,
                opacity: isFinite(polygonOpacity) ? polygonOpacity : undefined,
                outline: markerOutline || undefined
            },
            choropleth: { enabled: enableChoropleth, palette: palette },
            extrusion: {
                enabled: enable3D,
                heightProperty: getOption(config, ns, 'extrusionHeightField', 'height'),
                scale: parseFloat(getOption(config, ns, 'extrusionScale', '1')) || 1,
                palette: palette,
                pulse: extrusionPulse
            },
            featureJoin: {
                enabled: featureJoinEnabled,
                preset: featureJoinPreset || undefined,
                url: featureJoinUrl || undefined,
                sourceLayer: featureJoinSourceLayer || undefined,
                promoteId: featureJoinPromoteId || undefined,
                idProperty: 'id',
                valueProperty: 'value',
                palette: palette
            },
            indoor: {
                enabled: Boolean(indoorImage && indoorCoords),
                image: indoorImage || undefined,
                coordinates: indoorCoords || undefined,
                opacity: isFinite(indoorOpacity) ? indoorOpacity : 0.95
            }
        });

        // v1.5.1 — camera auto-orbit. Drive it from updateView() so
        // toggling the option in the formatter takes effect immediately;
        // MapBuilder.setAutoOrbit is idempotent and cheap to re-invoke
        // (it only spawns a RAF when none is running).
        if (this._builder && typeof this._builder.setAutoOrbit === 'function') {
            this._builder.setAutoOrbit(
                cameraAutoOrbit && isFinite(autoOrbitSpeed) ? autoOrbitSpeed : 0
            );
        }

        // ------------------------------------------------------------------
        // v1.7 — Tier 1 #1: drive selection emphasis + fly-to from updateView
        // ------------------------------------------------------------------
        // mapBuilder/markers.js have a public applySelection() path that
        // updates the filter on the existing selection layers AND flies
        // the camera to the matching feature (when flyToOnChange is on).
        // applyAnalysis() above ALSO reconciles the selection layers
        // (via mount → reconcileSelectionLayers) for the case where the
        // markers layer was just mounted; applySelection here is the
        // "selection-only re-render" path that runs on every token
        // change without churning the layer dispatcher.
        if (
            this._builder &&
            typeof this._builder.applyMarkerSelection === 'function'
        ) {
            this._builder.applyMarkerSelection(analysis.points, {
                field: selectedFeatureField,
                value: selectedFeatureValue,
                sizeMultiplier: isFinite(selectedSizeMultiplier)
                    ? selectedSizeMultiplier
                    : undefined,
                haloColor: selectedHaloColor || undefined,
                haloWidth: isFinite(selectedHaloWidth) ? selectedHaloWidth : undefined,
                flyToOnChange: selectedFlyToOnChange,
                flyToZoom: isFinite(selectedFlyToZoom) ? selectedFlyToZoom : undefined
            });
        }

        // ------------------------------------------------------------------
        // v1.7 — Tier 1 #2: inbound camera control
        // ------------------------------------------------------------------
        // When acceptRemoteCamera is on AND the dashboard has bound
        // either the canonical tokens (better_map.camera.lng/lat/zoom)
        // or custom ones via remoteCameraTokenLng/Lat/Zoom, we feed
        // the values to crossPanel.applyRemoteCamera() which actually
        // moves the camera. The function is idempotent and bails when
        // the values match the current view, so it's safe to call on
        // every updateView pass.
        if (
            acceptRemoteCamera &&
            this._builder &&
            typeof this._builder.applyRemoteCamera === 'function'
        ) {
            // Only call when at least lat AND lng are valid; zoom is
            // optional and falls back to the current zoom when NaN.
            if (isFinite(remoteCameraLng) && isFinite(remoteCameraLat)) {
                this._builder.applyRemoteCamera({
                    lng: remoteCameraLng,
                    lat: remoteCameraLat,
                    zoom: isFinite(remoteCameraZoom) ? remoteCameraZoom : undefined
                });
            }
        }

        // ------------------------------------------------------------------
        // v1.7 — Re-apply drilldown integrations so option changes take
        // effect on subsequent updateView passes (not just first mount).
        // enableIntegrations is idempotent — it detaches + reattaches.
        // ------------------------------------------------------------------
        if (this._builder && typeof this._builder.enableIntegrations === 'function') {
            this._builder.enableIntegrations(this, {
                drilldown: enableDrilldown,
                crossPanel: enableCrossPanel,
                drilldownOptions: {
                    enablePopups: enablePopups,
                    popupAllowInlineStyles: popupAllowInlineStyles,
                    enableHoverPreview: enableHoverPreview,
                    hoverHtmlField: hoverHtmlField,
                    closePopupOnDrilldown: closePopupOnDrilldown
                }
            });
        }

        if (this._debugHud && this._debugHud.recordLayerOpts) {
            try {
                this._debugHud.recordLayerOpts({
                    pointRenderer: pointRenderer,
                    paths: {
                        color: pathColor || undefined,
                        animated: pathAnimated,
                        arrowHeads: pathArrows
                    }
                });
            } catch (_e) { /* ignore */ }
        }

        // Floating layer-control widget, only shown when the user surfaced
        // a `layer` field and we have more than one distinct layer name.
        var layerNames = analysis.layerNames || [];
        if (showLayerControl && layerNames.length > 1) {
            if (!this._layerControl) {
                this._layerControl = createLayerControl(this.el, {
                    onToggle: function (name, visible) {
                        var visibleLayers = [];
                        for (var i = 0; i < layerNames.length; i++) {
                            if (self._layerControl.isVisible(layerNames[i])) {
                                visibleLayers.push(layerNames[i]);
                            }
                        }
                        self._builder.setVisibleLayerNames(visibleLayers);
                        if (name && self._liveRegion) {
                            self._liveRegion.announce(
                                'Layer ' + name + ' ' + (visible ? 'shown' : 'hidden')
                            );
                        }
                    }
                });
            }
            this._layerControl.render(layerNames);
        } else if (this._layerControl) {
            this._layerControl.destroy();
            this._layerControl = null;
            this._builder.setVisibleLayerNames(null);
        }

        // View-stability widget (Reset + Lock View). Created lazily so
        // single-panel boards without a lockView preference still get it.
        if (!this._viewLock) {
            var lockSelf = this;
            this._viewLock = createViewLock(this.el, {
                onResetView: function () {
                    if (lockSelf._builder && lockSelf._lastAnalysis) {
                        var bounds = lockSelf._viewLock.getFitBounds();
                        if (bounds) {
                            lockSelf._builder.fitToBounds(bounds);
                        } else {
                            lockSelf._builder.fitTo(combineAll(lockSelf._lastAnalysis));
                        }
                    }
                }
            });
        }
        // Mirror the formatter's "Lock view" option onto the widget. The
        // widget can still be flipped by the user at runtime - we only
        // honour the option as the initial value on first paint.
        if (lockView && !this._viewLock.isLocked()) {
            this._viewLock.setLocked(true);
        }

        // Export + share widget (PNG download, copy share URL).
        if (enableExportShare && !this._exportShare && this._builder.map) {
            var shareSelf = this;
            this._exportShare = createExportShare(this.el, {
                onExportPng: function () {
                    if (!shareSelf._builder || !shareSelf._builder.map) return;
                    exportPng(shareSelf._builder.map, { fileName: 'better-map.png' })
                        .then(function () {
                            if (shareSelf._liveRegion) {
                                shareSelf._liveRegion.announce('PNG snapshot downloaded.');
                            }
                        })
                        .catch(function (err) {
                            if (typeof console !== 'undefined' && console.warn) {
                                console.warn('[better_map] PNG export failed:', err);
                            }
                        });
                },
                onCopyShare: function () {
                    if (!shareSelf._builder || !shareSelf._builder.map) return false;
                    var map = shareSelf._builder.map;
                    var c = map.getCenter();
                    var hash = encodeShareHash({
                        center: [c.lng, c.lat],
                        zoom: map.getZoom(),
                        pitch: map.getPitch(),
                        bearing: map.getBearing()
                    });
                    if (!hash) return false;
                    var url = (typeof location !== 'undefined' ? location.href.split('#')[0] : '') + hash;
                    var ok = copyToClipboard(url);
                    if (ok && shareSelf._liveRegion) {
                        shareSelf._liveRegion.announce('Share URL copied to clipboard.');
                    }
                    return ok;
                }
            });
        } else if (!enableExportShare && this._exportShare) {
            this._exportShare.destroy();
            this._exportShare = null;
        }

        var totalFeatures = featureCount(analysis);
        if (totalFeatures > 0 && this._viewLock.consumeAutoFit()) {
            var combined = combineAll(analysis);
            var bounds = this._builder.fitTo(combined);
            if (bounds) {
                this._viewLock.recordFitBounds(bounds);
            }
        }

        // Time scrubber appears when the data has a usable `time` field and
        // the user hasn't disabled it.
        var showScrubber = parseBool(getOption(config, ns, 'showTimeScrubber', 'true'), true);
        var trailWindowMs = parseInt(getOption(config, ns, 'trailWindowMs', '300000'), 10) || 300000;
        var timeRange = computeTimeRange(analysis);
        if (showScrubber && timeRange && analysis.detected && analysis.detected.timeField) {
            this._installScrubber(timeRange, trailWindowMs);
        } else if (this._scrubber) {
            this._scrubber.destroy();
            this._scrubber = null;
            this._builder.applyTimeTrail(null);
        }

        // v1.5.2 — BM-CT-1: keep the control panel in sync with the
        // dashboard. Show/hide on formatter changes, and re-render
        // open panels so toggle state reflects any external changes
        // (e.g. master Reset View flipping action states).
        if (showControlPanel) {
            if (!this._controlPanel) {
                this._mountControlPanel();
            }
            if (this._controlPanel && this._controlPanel.render) {
                this._controlPanel.render();
            }
        } else if (this._controlPanel) {
            this._controlPanel.destroy();
            this._controlPanel = null;
        }
    },

    _installScrubber: function (range, windowMs) {
        var self = this;
        if (!this._scrubber) {
            this._scrubber = createScrubber(this.el, {
                min: range[0],
                max: range[1],
                value: range[1],
                onChange: function (now) {
                    if (self._builder) {
                        self._builder.applyTimeTrail(now, windowMs);
                    }
                }
            });
        } else {
            this._scrubber.setRange(range[0], range[1]);
        }
        if (this._builder) {
            this._builder.applyTimeTrail(this._scrubber.getCurrent(), windowMs);
        }
    },

    /**
     * v1.6 — apply the dashboard-author per-feature default-state
     * map to the live v2 bundle. Safe to call on every redraw; the
     * underlying widget setEnabled() functions short-circuit when the
     * new state matches the current state. No-op when the bundle is
     * not yet instantiated (panel not visible) or has been destroyed.
     */
    _applyV2Defaults: function () {
        var bundle = this._v2Bundle;
        var defaults = this._v2Defaults;
        if (!bundle || !bundle.instances || !defaults) return;
        var instances = bundle.instances;
        Object.keys(defaults).forEach(function (key) {
            var inst = instances[key];
            if (!inst || typeof inst.setEnabled !== 'function') return;
            try {
                var currently = typeof inst.isEnabled === 'function' ? !!inst.isEnabled() : false;
                var want = !!defaults[key];
                if (currently !== want) inst.setEnabled(want);
            } catch (_e) { /* swallow per-instance */ }
        });
    },

    /**
     * v1.5.2 — BM-CT-1 registration. Every fancy action is registered
     * with the builder's registry ONCE per builder lifetime — the
     * action's setEnabled/isEnabled/reset closures are tolerant of
     * "host layer not yet present" (e.g. registering the marker pulse
     * action before any markers have been mounted is a no-op until
     * markers arrive).
     *
     * Stable IDs (kebab-case, no spaces) are how the control panel
     * keys its DOM elements — do NOT change them once shipped.
     */
    _registerFancyActions: function () {
        var builder = this._builder;
        if (!builder || typeof builder.registerFancyAction !== 'function') {
            return;
        }
        var getMap = function () { return builder && builder.map; };

        builder.registerFancyAction('paths-animated', {
            id: 'paths-animated',
            label: 'Marching dashes',
            icon: '\u21E2', // rightward dashed arrow
            setEnabled: function (on) {
                var m = getMap();
                if (m) pathsLayer.setAnimated(m, !!on);
            },
            isEnabled: function () { return pathsLayer.isAnimatedEnabled(); },
            reset: function () {
                var m = getMap();
                if (m) pathsLayer.reset(m);
            }
        });

        builder.registerFancyAction('paths-comet', {
            id: 'paths-comet',
            label: 'Arc comets',
            icon: '\u2728', // sparkles
            setEnabled: function (on) {
                var m = getMap();
                if (m) pathsLayer.setComet(m, !!on);
            },
            isEnabled: function () { return pathsLayer.isCometEnabled(); },
            reset: function () {
                var m = getMap();
                if (m) pathsLayer.reset(m);
            }
        });

        builder.registerFancyAction('markers-pulse', {
            id: 'markers-pulse',
            label: 'Marker heartbeat',
            icon: '\u2665', // heart
            setEnabled: function (on) {
                var m = getMap();
                if (m) markersLayer.setPulse(m, !!on);
            },
            isEnabled: function () { return markersLayer.isPulseEnabled(); },
            reset: function () {
                var m = getMap();
                if (m) markersLayer.reset(m);
            }
        });

        builder.registerFancyAction('extrusion-pulse', {
            id: 'extrusion-pulse',
            label: 'Breathing extrusion',
            icon: '\u25B2', // up-pointing triangle (column)
            setEnabled: function (on) {
                var m = getMap();
                if (m) extrusionLayer.setPulse(m, !!on);
            },
            isEnabled: function () {
                var m = getMap();
                return m ? extrusionLayer.isPulseEnabled(m) : false;
            },
            reset: function () {
                var m = getMap();
                if (m) extrusionLayer.reset(m);
            }
        });

        builder.registerFancyAction('hexbin-pulse', {
            id: 'hexbin-pulse',
            label: 'Hexbin breathing',
            icon: '\u2B22', // black hexagon
            setEnabled: function (on) {
                var m = getMap();
                if (m) hexbinLayer.setPulse(m, !!on);
            },
            isEnabled: function () {
                var m = getMap();
                return m ? hexbinLayer.isPulseEnabled(m) : false;
            },
            reset: function () {
                var m = getMap();
                if (m) hexbinLayer.reset(m);
            }
        });

        builder.registerFancyAction('camera-auto-orbit', {
            id: 'camera-auto-orbit',
            label: 'Camera auto-orbit',
            icon: '\u21BB', // clockwise open circle arrow
            setEnabled: function (on) {
                if (on) {
                    // Re-arm with the last-applied speed if MapBuilder
                    // remembered one, otherwise the calm 3 deg/s default.
                    builder.setAutoOrbit(3);
                } else {
                    builder.setAutoOrbit(0);
                }
            },
            isEnabled: function () {
                return typeof builder.isAutoOrbiting === 'function'
                    ? builder.isAutoOrbiting()
                    : false;
            },
            reset: function () {
                // The dashboard-author value for auto-orbit lives in
                // the formatter's `cameraAutoOrbit` / `autoOrbitSpeed`
                // pair. Re-read them on reset by invalidating the
                // view so the formatter's intent is re-applied.
                if (typeof builder.resetCamera === 'function') {
                    builder.resetCamera();
                }
            }
        });
    },

    /**
     * v1.5.2 — BM-CT-1 widget instantiation. Separated from the
     * registration step so a dashboard can hide the panel via the
     * `showControlPanel=false` option without losing the underlying
     * registry — that way `resetView()` (called from elsewhere, e.g.
     * a keybinding) still works.
     */
    _mountControlPanel: function () {
        if (this._controlPanel || !this._builder) return;
        var self = this;
        this._controlPanel = createControlPanel(this.el, {
            builder: this._builder,
            onMotionPauseToggle: function (paused) {
                // Mirror the runtime state back into the cached
                // dashboard-author tracker so the next applyOptions
                // call does not overwrite the user's choice.
                self._lastMotionPaused = paused;
                if (self._liveRegion) {
                    self._liveRegion.announce(
                        paused
                            ? 'All map motion paused.'
                            : 'Map motion resumed.'
                    );
                }
            },
            onResetView: function () {
                // Master "Reset view" also resets the scrubber to the
                // dashboard-author default (end-of-range, 1x speed,
                // paused) when one is currently mounted.
                if (self._scrubber && typeof self._scrubber.reset === 'function') {
                    self._scrubber.reset();
                }
                // ...and the layer-control visibility map.
                if (self._layerControl && typeof self._layerControl.resetVisibility === 'function') {
                    self._layerControl.resetVisibility();
                }
                if (self._liveRegion) {
                    self._liveRegion.announce('View reset to dashboard defaults.');
                }
            }
        });
    },

    reflow: function () {
        if (this._builder) {
            this._builder.resize();
        }
        this.invalidateUpdateView();
    },

    destroy: function () {
        if (this._cancelVisibilityWatch) {
            this._cancelVisibilityWatch();
            this._cancelVisibilityWatch = null;
        }
        if (this._themeUnsub) {
            this._themeUnsub();
            this._themeUnsub = null;
        }
        if (this._themeWatcher) {
            this._themeWatcher.destroy();
            this._themeWatcher = null;
        }
        if (this._layerControl) {
            this._layerControl.destroy();
            this._layerControl = null;
        }
        if (this._scrubber) {
            this._scrubber.destroy();
            this._scrubber = null;
        }
        if (this._perfHUD) {
            this._perfHUD.destroy();
            this._perfHUD = null;
        }
        if (this._viewLock) {
            this._viewLock.destroy();
            this._viewLock = null;
        }
        if (this._exportShare) {
            this._exportShare.destroy();
            this._exportShare = null;
        }
        if (this._controlPanel) {
            this._controlPanel.destroy();
            this._controlPanel = null;
        }
        if (this._v2Bundle && typeof this._v2Bundle.destroy === 'function') {
            this._v2Bundle.destroy();
            this._v2Bundle = null;
        }
        if (this._debugHud) {
            this._debugHud.destroy();
            this._debugHud = null;
        }
        if (this._liveRegion) {
            this._liveRegion.destroy();
            this._liveRegion = null;
        }
        if (this._builder) {
            this._builder.destroy();
            this._builder = null;
        }
        if (this._contextReserved) {
            releaseContext();
            this._contextReserved = false;
        }
        this._lastAnalysis = null;
        this._lastGoodData = null;
        SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
    }
});

function featureCount(analysis) {
    var n = 0;
    if (analysis.points && analysis.points.features) n += analysis.points.features.length;
    if (analysis.lines && analysis.lines.features) n += analysis.lines.features.length;
    if (analysis.polygons && analysis.polygons.features) n += analysis.polygons.features.length;
    return n;
}

function combineAll(analysis) {
    var features = [];
    if (analysis.points && analysis.points.features) {
        features = features.concat(analysis.points.features);
    }
    if (analysis.lines && analysis.lines.features) {
        features = features.concat(analysis.lines.features);
    }
    if (analysis.polygons && analysis.polygons.features) {
        features = features.concat(analysis.polygons.features);
    }
    return { type: 'FeatureCollection', features: features };
}

function resolvePalette(id) {
    if (id === 'rdylbu') return RDYLBU;
    if (id === 'set3') return SET3;
    if (id === 'cyber') return CYBER;
    if (id === 'synthwave') return SYNTHWAVE;
    if (id === 'tactical') return TACTICAL;
    return VIRIDIS;
}

function computeTimeRange(analysis) {
    var buckets = [analysis.points, analysis.lines, analysis.polygons];
    var min = Infinity;
    var max = -Infinity;
    var found = false;
    for (var b = 0; b < buckets.length; b++) {
        var fc = buckets[b];
        if (!fc || !fc.features) continue;
        for (var i = 0; i < fc.features.length; i++) {
            var t = fc.features[i].properties && fc.features[i].properties.time;
            var n = typeof t === 'number' ? t : parseFloat(t);
            if (!isFinite(n)) {
                var p = Date.parse(t);
                n = isFinite(p) ? p : NaN;
            }
            if (isFinite(n)) {
                if (n < min) min = n;
                if (n > max) max = n;
                found = true;
            }
        }
    }
    if (!found || min === max) return null;
    return [min, max];
}
