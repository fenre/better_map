/*
 * MapBuilder - high-level MapLibre lifecycle for Better Map.
 *
 * Responsibilities:
 *   - WebGL detection (delegated to errorStates)
 *   - MapLibre instantiation with the right style for the chosen provider
 *     and Splunk theme
 *   - PMTiles protocol registration
 *   - Attribution control management (delegated to attribution.js)
 *   - Style switching with automatic re-mount of all custom layers
 *   - Layer reconciliation delegated to lib/layers/index.js, which keeps
 *     the active strategies (markers/clusters/heatmap/paths/polygons/
 *     choropleth/...) in sync with the latest dataFitness analysis
 *   - Strategy + per-layer-name visibility toggles for the floating
 *     layer control widget
 *   - Resize/destroy plumbing
 *
 * Phases that follow add on top:
 *   - Phase 3 adds H3 hexbin, 3D extrusion, vector-tile join, indoor overlay,
 *     time scrubber + trail (each as another layer module)
 *   - Phase 5 wraps everything in lazyInit + perfHUD
 *
 * Note on workers: MapLibre v4 ships its worker inline. Splunk Web's CSP
 * historically allows `worker-src blob:` so the inline Blob worker pattern
 * works. The "csp-worker" build of MapLibre (no Function constructor) is
 * available as a fallback if Splunk hardens CSP in future releases; switch
 * by importing 'maplibre-gl/dist/maplibre-gl-csp.js' here.
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol as PMTilesProtocol } from 'pmtiles';

import { resolveStyle, DEFAULT_PROVIDER } from './styles.js';
import { applyAttribution } from './attribution.js';
import { isWebGLAvailable, renderErrorBanner, clearErrorBanner } from './errorStates.js';
import { reconcile, applyLayerNameFilter, setLayerVisibility } from './layers/index.js';
import * as markersLayer from './layers/markers.js';
import * as clustersLayer from './layers/clusters.js';
import * as pathsLayer from './layers/paths.js';
import { applyTrail, clearTrail } from './time/trail.js';
import { attachDrilldown } from './drilldown.js';
import { createCrossPanel } from './crossPanel.js';
import { applyA11yAttrs, applyLabelLanguage } from './a11y.js';

let pmtilesRegistered = false;

function ensurePMTilesProtocol() {
    if (pmtilesRegistered) {
        return;
    }
    const protocol = new PMTilesProtocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    pmtilesRegistered = true;
}

export class MapBuilder {
    constructor(container) {
        this._container = container;
        this._map = null;
        this._provider = null;
        this._currentStyleKey = '';
        this._destroyed = false;
        this._afterStyleQueue = [];
        this._layerState = {};
        this._lastAnalysis = null;
        this._lastLayerOpts = {};
        this._detachDrilldown = null;
        this._crossPanel = null;

        this._mapDiv = document.createElement('div');
        this._mapDiv.className = 'better_map-map';
        this._mapDiv.style.position = 'absolute';
        this._mapDiv.style.inset = '0';
        container.appendChild(this._mapDiv);
    }

    /**
     * Build (or rebuild) the MapLibre map for the given options.
     *
     * @param {object} opts
     * @param {string} opts.provider        Provider id from styles.js#PROVIDERS
     * @param {string} opts.theme           "light" or "dark"
     * @param {string} [opts.apiKey]        API key for keyed providers
     * @param {string} [opts.customStyleUrl] URL for custom/pmtiles providers
     * @param {[number, number]} [opts.center] Initial center [lon, lat]
     * @param {number} [opts.zoom]
     * @param {number} [opts.pitch]
     * @param {number} [opts.bearing]
     * @param {boolean} [opts.allowPitch]   Allow user pitch via right-drag
     * @param {boolean} [opts.allowRotate]  Allow user rotate via right-drag
     */
    init(opts) {
        if (this._destroyed) {
            throw new Error('MapBuilder.init called after destroy');
        }

        if (!isWebGLAvailable()) {
            renderErrorBanner(
                this._container,
                'This browser does not support WebGL. Better Map requires WebGL to render. ' +
                    'Try Chrome, Edge, Firefox, or Safari 14+.'
            );
            return null;
        }

        ensurePMTilesProtocol();

        let resolved;
        try {
            resolved = resolveStyle({
                provider: opts.provider || DEFAULT_PROVIDER,
                theme: opts.theme || 'dark',
                apiKey: opts.apiKey,
                customStyleUrl: opts.customStyleUrl
            });
        } catch (err) {
            renderErrorBanner(this._container, err.message || String(err));
            return null;
        }

        this._provider = resolved.provider;
        this._currentStyleKey = makeStyleKey(opts, this._provider.id);

        try {
            this._map = new maplibregl.Map({
                container: this._mapDiv,
                style: resolved.style,
                center: validCenter(opts.center) || [0, 20],
                zoom: typeof opts.zoom === 'number' ? opts.zoom : 1.4,
                pitch: typeof opts.pitch === 'number' ? opts.pitch : 0,
                bearing: typeof opts.bearing === 'number' ? opts.bearing : 0,
                pitchWithRotate: opts.allowRotate !== false,
                dragRotate: opts.allowRotate !== false,
                touchZoomRotate: opts.allowRotate !== false,
                attributionControl: false, // we add our own below
                fadeDuration: 150,
                // preserveDrawingBuffer is required for reliable PNG
                // snapshots via canvas.toDataURL() across all browsers.
                // Defaults to true because Better Map ships an Export
                // button by default; the perf cost is negligible for the
                // dashboard-style maps Better Map renders.
                preserveDrawingBuffer: opts.preserveDrawingBuffer !== false,
                // Limit max parallel tile fetches so we stay friendly to
                // OpenFreeMap and other free tile services.
                maxParallelImageRequests: 8
            });
        } catch (err) {
            renderErrorBanner(
                this._container,
                'MapLibre failed to initialise: ' + (err && err.message ? err.message : err)
            );
            return null;
        }

        clearErrorBanner(this._container);
        applyAttribution(this._map, maplibregl, this._provider);
        applyA11yAttrs(this._map);

        // Persist the requested label language across style switches.
        this._labelLanguage = opts.labelLanguage || null;

        const self = this;
        this._map.on('load', function () {
            self._flushAfterStyleQueue();
        });
        this._map.on('style.load', function () {
            // setStyle() with diff: true strips our custom sources/layers.
            // Force a re-reconcile from the last analysis so the layers
            // come back automatically when the user switches basemap.
            self._layerState = {};
            applyA11yAttrs(self._map);
            if (self._labelLanguage) {
                applyLabelLanguage(self._map, self._labelLanguage);
            }
            if (self._lastAnalysis) {
                self.applyAnalysis(self._lastAnalysis, self._lastLayerOpts);
            }
            self._flushAfterStyleQueue();
        });
        this._map.on('error', function (evt) {
            // MapLibre's 'error' event fires for tile fetches as well as
            // fatal style errors. Log without spamming Splunk's UI.
            if (evt && evt.error && typeof console !== 'undefined' && console.warn) {
                console.warn('[better_map] MapLibre error:', evt.error);
            }
        });

        return this._map;
    }

    /**
     * Apply a new tile provider / theme combination without reinstantiating
     * the entire map. Triggers a single setStyle() call when the resolved
     * style URL actually changes.
     */
    applyStyle(opts) {
        if (!this._map || this._destroyed) {
            return;
        }
        let resolved;
        try {
            resolved = resolveStyle({
                provider: opts.provider || DEFAULT_PROVIDER,
                theme: opts.theme || 'dark',
                apiKey: opts.apiKey,
                customStyleUrl: opts.customStyleUrl
            });
        } catch (err) {
            renderErrorBanner(this._container, err.message || String(err));
            return;
        }

        const nextKey = makeStyleKey(opts, resolved.provider.id);
        if (nextKey === this._currentStyleKey) {
            return;
        }
        this._currentStyleKey = nextKey;
        this._provider = resolved.provider;

        this._map.setStyle(resolved.style, { diff: true });
        applyAttribution(this._map, maplibregl, this._provider);
    }

    /**
     * Switch the map's label language. Pass an empty string to revert to
     * the basemap default (typically `name`).
     */
    setLabelLanguage(lang) {
        this._labelLanguage = lang || null;
        if (this._map && this._labelLanguage) {
            applyLabelLanguage(this._map, this._labelLanguage);
        }
    }

    /**
     * Apply the result of dataFitness.analyze() to the map.
     * Delegates to the layer dispatcher in lib/layers/index.js.
     *
     * @param {object} analysis  - output of dataFitness.analyze()
     * @param {object} [layerOpts] - per-layer-strategy options bag
     */
    applyAnalysis(analysis, layerOpts) {
        this._lastAnalysis = analysis;
        this._lastLayerOpts = layerOpts || {};
        const self = this;
        this._afterStyle(function () {
            if (!self._map || self._destroyed) {
                return;
            }
            self._layerState = reconcile(self._map, analysis, self._lastLayerOpts, self._layerState);
        });
    }

    /**
     * Convenience: feed a single GeoJSON FeatureCollection of Points into
     * the marker pipeline. Useful for the local test harness and for
     * callers that aren't using dataFitness yet.
     */
    setData(featureCollection) {
        const fc = featureCollection || { type: 'FeatureCollection', features: [] };
        this.applyAnalysis(
            {
                points: fc,
                lines: { type: 'FeatureCollection', features: [] },
                polygons: { type: 'FeatureCollection', features: [] }
            },
            this._lastLayerOpts
        );
    }

    /**
     * Toggle a strategy on/off without unmounting it. The dispatcher uses
     * `setVisible` so the underlying source is kept warm.
     */
    setStrategyVisible(strategyId, visible) {
        const self = this;
        this._afterStyle(function () {
            if (self._map && !self._destroyed) {
                setLayerVisibility(self._map, strategyId, visible);
            }
        });
    }

    /**
     * Apply a `layerName` filter across all strategies so only the
     * requested layer-control entries are visible. Pass null or an empty
     * array to clear the filter.
     */
    setVisibleLayerNames(names) {
        const self = this;
        this._afterStyle(function () {
            if (self._map && !self._destroyed) {
                applyLayerNameFilter(self._map, names);
            }
        });
    }

    /**
     * Enable feature drilldown + camera cross-panel coordination.
     * Idempotent; safe to call after re-init.
     */
    enableIntegrations(viz, opts) {
        if (!this._map || this._destroyed) return;
        const options = opts || {};
        if (this._detachDrilldown) this._detachDrilldown();
        if (this._crossPanel) this._crossPanel.destroy();
        this._detachDrilldown = options.drilldown !== false
            ? attachDrilldown(this._map, viz, options.drilldownOptions || {})
            : null;
        this._crossPanel = options.crossPanel !== false
            ? createCrossPanel(this._map, viz, options.crossPanelOptions || {})
            : null;
    }

    /**
     * Apply a comet trail to the time-sensitive layers (markers, paths,
     * unclustered cluster points). Pass null/undefined `now` to remove.
     */
    applyTimeTrail(now, windowMs) {
        const self = this;
        this._afterStyle(function () {
            if (!self._map || self._destroyed) return;
            const ids = trailLayerIds();
            if (now === null || now === undefined) {
                clearTrail(self._map, ids);
            } else {
                applyTrail(self._map, { now: now, windowMs: windowMs, layerIds: ids });
            }
        });
    }

    /**
     * Auto-fit the camera to the supplied feature collection's bounding
     * box. Returns the bounds that were used so callers (viewLock.js) can
     * remember them for a future Reset View.
     */
    fitTo(featureCollection, paddingPx) {
        if (!this._map || this._destroyed) {
            return null;
        }
        const bounds = collectionBounds(featureCollection);
        if (!bounds) {
            return null;
        }
        return this.fitToBounds(bounds, paddingPx);
    }

    /**
     * Auto-fit the camera to a precomputed [[w,s],[e,n]] bounds tuple.
     */
    fitToBounds(bounds, paddingPx) {
        if (!this._map || this._destroyed || !bounds) {
            return null;
        }
        this._map.fitBounds(bounds, {
            padding: typeof paddingPx === 'number' ? paddingPx : 48,
            maxZoom: 14,
            animate: true,
            duration: 600
        });
        return bounds;
    }

    resize() {
        if (this._map && !this._destroyed) {
            this._map.resize();
        }
    }

    get map() {
        return this._map;
    }

    get provider() {
        return this._provider;
    }

    destroy() {
        this._destroyed = true;
        this._afterStyleQueue.length = 0;
        if (this._detachDrilldown) {
            try { this._detachDrilldown(); } catch (_err) { /* swallow */ }
            this._detachDrilldown = null;
        }
        if (this._crossPanel) {
            try { this._crossPanel.destroy(); } catch (_err) { /* swallow */ }
            this._crossPanel = null;
        }
        if (this._map) {
            try {
                this._map.remove();
            } catch (_err) {
                /* swallow */
            }
            this._map = null;
        }
        if (this._mapDiv && this._mapDiv.parentNode) {
            this._mapDiv.parentNode.removeChild(this._mapDiv);
        }
        this._mapDiv = null;
        clearErrorBanner(this._container);
    }

    // -------------------------------------------------------------------
    // Internals

    _afterStyle(fn) {
        if (this._map && this._map.isStyleLoaded()) {
            fn();
        } else {
            this._afterStyleQueue.push(fn);
        }
    }

    _flushAfterStyleQueue() {
        const q = this._afterStyleQueue.slice();
        this._afterStyleQueue.length = 0;
        for (let i = 0; i < q.length; i++) {
            try {
                q[i]();
            } catch (err) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[better_map] after-style hook failed:', err);
                }
            }
        }
    }
}

// -----------------------------------------------------------------------
// Helpers

function makeStyleKey(opts, providerId) {
    return [
        providerId,
        opts.theme || 'dark',
        opts.apiKey ? 'keyed' : 'nokey',
        opts.customStyleUrl || ''
    ].join('|');
}

function validCenter(c) {
    if (!Array.isArray(c) || c.length !== 2) {
        return null;
    }
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return null;
    }
    return [lon, lat];
}

function collectionBounds(featureCollection) {
    const features = (featureCollection && featureCollection.features) || [];
    if (features.length === 0) {
        return null;
    }
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    let any = false;
    for (let i = 0; i < features.length; i++) {
        const g = features[i] && features[i].geometry;
        if (!g) continue;
        any = visitCoords(g, function (lon, lat) {
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
        }) || any;
    }
    if (!any) {
        return null;
    }
    if (west === east && south === north) {
        const pad = 0.05;
        return [
            [west - pad, south - pad],
            [east + pad, north + pad]
        ];
    }
    return [
        [west, south],
        [east, north]
    ];
}

function visitCoords(geom, visit) {
    if (!geom || !geom.type) {
        return false;
    }
    const c = geom.coordinates;
    let touched = false;
    switch (geom.type) {
        case 'Point':
            if (isLngLat(c)) {
                visit(c[0], c[1]);
                touched = true;
            }
            return touched;
        case 'MultiPoint':
        case 'LineString':
            return visitArray(c, visit);
        case 'MultiLineString':
        case 'Polygon':
            return visitArrayOfArrays(c, visit);
        case 'MultiPolygon':
            for (let i = 0; i < (c || []).length; i++) {
                touched = visitArrayOfArrays(c[i], visit) || touched;
            }
            return touched;
        case 'GeometryCollection':
            for (let i = 0; i < (geom.geometries || []).length; i++) {
                touched = visitCoords(geom.geometries[i], visit) || touched;
            }
            return touched;
        default:
            return false;
    }
}

function visitArray(coords, visit) {
    let touched = false;
    for (let i = 0; i < (coords || []).length; i++) {
        if (isLngLat(coords[i])) {
            visit(coords[i][0], coords[i][1]);
            touched = true;
        }
    }
    return touched;
}

function visitArrayOfArrays(coords, visit) {
    let touched = false;
    for (let i = 0; i < (coords || []).length; i++) {
        touched = visitArray(coords[i], visit) || touched;
    }
    return touched;
}

function isLngLat(p) {
    return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function trailLayerIds() {
    return [
        markersLayer.LAYER_DOT,
        markersLayer.LAYER_BG,
        clustersLayer.LAYER_UNCLUSTERED,
        pathsLayer.LAYER_LINE,
        pathsLayer.LAYER_LINE_BG
    ];
}
