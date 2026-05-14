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

import { MapBuilder } from './lib/mapBuilder.js';
import { createThemeWatcher } from './lib/theme.js';
import { analyze } from './lib/dataFitness.js';
import { DEFAULT_PROVIDER } from './lib/styles.js';
import { renderErrorBanner } from './lib/errorStates.js';
import { createLayerControl } from './lib/layerControl.js';
import { createScrubber } from './lib/time/scrubber.js';
import { VIRIDIS, RDYLBU, SET3 } from './lib/palettes.js';
import { waitForVisible, reserveContext, releaseContext, contextsLeft } from './lib/lazyInit.js';
import { createPerfHUD } from './lib/perfHUD.js';
import { createViewLock } from './lib/viewLock.js';
import { createLiveRegion, applyHighContrast } from './lib/a11y.js';
import {
    createExportShare,
    exportPng,
    encodeShareHash,
    copyToClipboard
} from './lib/exportShare.js';

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
        this._cancelVisibilityWatch = null;
        this._contextReserved = false;
        this._waitingForVisibility = false;

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

    formatData: function (data /* , config */) {
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
        var showPerfHUD = parseBool(getOption(config, ns, 'showPerfHUD', 'false'), false);
        var highContrast = parseBool(getOption(config, ns, 'highContrast', 'false'), false);
        var labelLanguage = String(getOption(config, ns, 'labelLanguage', '') || '').trim();
        var enableExportShare = parseBool(getOption(config, ns, 'enableExportShare', 'true'), true);

        applyHighContrast(this.el, highContrast);

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
                labelLanguage: labelLanguage
            };
            this._cancelVisibilityWatch = waitForVisible(this.el, function () {
                initSelf._cancelVisibilityWatch = null;
                initSelf._waitingForVisibility = false;
                initSelf._builder = new MapBuilder(initSelf.el);
                initSelf._builder.init(initOpts);
                if (initSelf._builder.map) {
                    initSelf._builder.enableIntegrations(initSelf, {
                        drilldown: initOpts.enableDrilldown,
                        crossPanel: initOpts.enableCrossPanel,
                        drilldownOptions: { enablePopups: initOpts.enablePopups }
                    });
                    if (showPerfHUD && !initSelf._perfHUD) {
                        initSelf._perfHUD = createPerfHUD(initSelf.el);
                        initSelf._perfHUD.attach(initSelf._builder.map);
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
        if (typeof this._builder.setLabelLanguage === 'function') {
            this._builder.setLabelLanguage(labelLanguage);
        }

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

        var paletteId = String(getOption(config, ns, 'palette', 'viridis')).toLowerCase();
        var markerColor = getOption(config, ns, 'markerColor', '');
        var markerOutline = getOption(config, ns, 'markerOutline', '');
        var pathColor = getOption(config, ns, 'pathColor', '');
        var pathWidth = parseFloat(getOption(config, ns, 'pathWidth', ''));
        var pathArrows = parseBool(getOption(config, ns, 'pathArrows', 'false'), false);
        var pathAnimated = parseBool(getOption(config, ns, 'pathAnimated', 'false'), false);
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
                outline: markerOutline || undefined
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
                opacity: isFinite(hexbinOpacity) ? hexbinOpacity : undefined
            },
            paths: {
                color: pathColor || undefined,
                width: isFinite(pathWidth) ? pathWidth : undefined,
                animated: pathAnimated,
                arrowHeads: pathArrows,
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
                palette: palette
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
