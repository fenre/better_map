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
import {
    prefersReducedMotion,
    shouldSuppressMotion,
    setMotionPaused as motionSetPaused,
    isMotionPaused,
    nowMs,
    scheduleFrame,
    cancelFrame
} from './motion.js';

let pmtilesRegistered = false;
let bmstyleRegistered = false;

function ensurePMTilesProtocol() {
    if (pmtilesRegistered) {
        return;
    }
    const protocol = new PMTilesProtocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    pmtilesRegistered = true;
}

/*
 * `bmstyle://` and `bmsource://` custom protocols.
 *
 * Empirical evidence (HUD probes v1.3.16) shows that MapLibre's internal
 * style/sprite/source-JSON fetches return HTTP 404 from third-party CDNs
 * (e.g. tiles.openfreemap.org/styles/liberty) when invoked from inside a
 * Splunk Dashboard Studio panel — even though the IDENTICAL URL returns
 * HTTP 200 to vanilla `fetch(url, {cache:'no-store', credentials:'omit'})`
 * in the same dashboard's document context.
 *
 * The trigger is something in MapLibre's full Request shape (Accept header,
 * AbortController signal, referrer string, or the way `new Request(url, ...)`
 * builds the request) that causes either Splunk's bundled fetch shim or the
 * upstream CDN to reject it.
 *
 * Rather than reverse-engineer which property triggers the rejection, we
 * route Style/SpriteJSON/Source-JSON requests through our OWN fetch via
 * MapLibre's `addProtocol()` API. Tile (image) fetches still go through
 * MapLibre's normal pipeline because raster tiles use `<img>` elements,
 * not fetch — and `<img>` doesn't suffer from the same shape-mismatch.
 */
function ensureBMStyleProtocol() {
    if (bmstyleRegistered) {
        return;
    }

    /*
     * Two handlers, one for metadata (Style/Source/SpriteJSON) and one for
     * binary data (Tile/SpriteImage/Glyphs). Metadata uses cache:'no-store'
     * so a poisoned 404 in the browser cache never sticks. Binary data uses
     * cache:'default' so tiles cache normally for performance.
     */
    function makeHandler(cacheMode) {
        return function (params, abortController) {
            const realUrl = decodeBmUrl(params.url);
            const fetchInit = {
                cache: cacheMode,
                credentials: 'omit',
                signal: abortController ? abortController.signal : undefined
            };
            return fetch(realUrl, fetchInit).then(function (r) {
                if (!r.ok) {
                    throw new Error('bm-protocol: HTTP ' + r.status + ' ' + r.statusText + ' for ' + realUrl);
                }
                const cacheControl = r.headers.get('Cache-Control');
                const expires = r.headers.get('Expires');
                // MapLibre derives `params.type` from the resourceType:
                //   Style / Source / SpriteJSON / Glyphs        → 'json' (text actually for Style)
                //   Tile (vector or raster) / SpriteImage      → 'arrayBuffer'
                //   Image (some viz layers)                    → 'image'
                // Be defensive: when we can't tell, sniff the response body.
                if (params.type === 'arrayBuffer' || params.type === 'image') {
                    return r.arrayBuffer().then(function (data) {
                        return { data: data, cacheControl: cacheControl, expires: expires };
                    });
                }
                if (params.type === 'json') {
                    return r.json().then(function (data) {
                        return { data: data, cacheControl: cacheControl, expires: expires };
                    });
                }
                // Default: return text. MapLibre's style loader accepts both
                // string-style and object-style results for text/json types.
                return r.text().then(function (data) {
                    return { data: data, cacheControl: cacheControl, expires: expires };
                });
            });
        };
    }

    const metaHandler = makeHandler('no-store');
    const dataHandler = makeHandler('default');

    // Metadata (JSON) protocols
    maplibregl.addProtocol('bmstyle', metaHandler);
    maplibregl.addProtocol('bmsource', metaHandler);
    // Binary data protocols (tiles, sprites, glyphs)
    maplibregl.addProtocol('bmtile', dataHandler);
    maplibregl.addProtocol('bmsprite', dataHandler);
    maplibregl.addProtocol('bmglyphs', dataHandler);

    bmstyleRegistered = true;
}

function encodeBmUrl(scheme, httpsUrl) {
    return scheme + '://' + httpsUrl.replace(/^https:\/\//, '');
}

function decodeBmUrl(bmUrl) {
    return 'https://' + bmUrl.replace(/^bm[a-z]+:\/\//, '');
}

/*
 * Map a MapLibre resourceType to a custom-protocol scheme name.
 * Returns null if the resource should NOT be rewritten (e.g. non-https URL,
 * pmtiles://, blob:, custom user URL).
 */
function pickBmScheme(url, resourceType) {
    if (typeof url !== 'string' || url.indexOf('https://') !== 0) {
        return null;
    }
    switch (resourceType) {
        case 'Style':
        case 'Source':
        case 'SpriteJSON':
            return 'bmstyle';
        case 'Tile':
            return 'bmtile';
        case 'SpriteImage':
            return 'bmsprite';
        case 'Glyphs':
            return 'bmglyphs';
        default:
            return null;
    }
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
        this._debugHud = null;

        this._mapDiv = document.createElement('div');
        this._mapDiv.className = 'better_map-map';
        this._mapDiv.style.position = 'absolute';
        this._mapDiv.style.inset = '0';
        container.appendChild(this._mapDiv);

        // v1.5.1 — auto-orbit state. The orbit runs as a single shared
        // RAF that bumps the map bearing by (speedDegPerSec * dt) each
        // frame. User interactions pause it; the orbit resumes
        // ORBIT_RESUME_DELAY_MS after the last interaction. State is
        // intentionally per-MapBuilder (not global) so two maps in a
        // dual-panel dashboard can orbit independently.
        this._orbit = {
            enabled: false,
            speedDegPerSec: 0,
            rafId: null,
            lastFrameMs: 0,
            pausedUntilMs: 0,
            handlers: null
        };

        // v1.5.2 — Dashboard-author defaults registry (BM-CT-1).
        // Captured on first init() so the master "Reset all" / per-
        // action reset can snap back to what the dashboard author
        // configured. Stored as a plain object so callers can read
        // individual keys (`getDashboardDefaults().cameraPitch`) or
        // mass-restore via Object.assign.
        this._dashboardDefaults = null;
        // v1.5.2 — Registered runtime overrides. Each entry is an
        // imperative pair { setEnabled(bool), reset(), isEnabled() }
        // contributed by a layer/animation module via `registerFancyAction`.
        // The control panel iterates this map to build its rows.
        this._fancyActions = new Map();
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
        ensureBMStyleProtocol();

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

        // v1.5.2 — capture the dashboard-author defaults the FIRST time
        // we initialise. Subsequent applyStyle() calls do NOT overwrite
        // them, so per-action reset always snaps back to what the
        // dashboard author chose, not whatever the user most recently
        // overrode (which would be a no-op reset).
        if (this._dashboardDefaults === null) {
            this._dashboardDefaults = {
                provider: opts.provider || DEFAULT_PROVIDER,
                theme: opts.theme || 'dark',
                center: validCenter(opts.center) || [0, 20],
                zoom: typeof opts.zoom === 'number' ? opts.zoom : 1.4,
                pitch: typeof opts.pitch === 'number' ? opts.pitch : 0,
                bearing: typeof opts.bearing === 'number' ? opts.bearing : 0,
                allowPitch: opts.allowPitch !== false,
                allowRotate: opts.allowRotate !== false,
                labelLanguage: opts.labelLanguage || null
            };
        }

        if (this._debugHud && this._debugHud.recordStyle) {
            this._debugHud.recordStyle(resolved.style);
        }

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
                maxParallelImageRequests: 8,
                /*
                 * MapLibre's default `Request` shape (Accept header, signal,
                 * referrer combo) triggers a 404 from several CDNs when run
                 * inside Splunk Dashboard Studio's iframe context — even when
                 * the same URL returns 200 to a vanilla `fetch(url)` call.
                 * Reproducible against tiles.openfreemap.org for
                 * Style/Source/SpriteJSON/SpriteImage/Tile/Glyphs.
                 *
                 * Workaround: route every relevant resourceType through a
                 * `bm*://` custom protocol that uses our own controlled
                 * `fetch()` shape (cache, credentials, no extra headers).
                 * Metadata gets cache:'no-store' so a poisoned 404 in the
                 * browser cache never sticks. Tiles/sprites/glyphs get
                 * cache:'default' so the browser cache works normally.
                 */
                transformRequest: function (url, resourceType) {
                    if (typeof window !== 'undefined') {
                        window.__bm_xform_count = (window.__bm_xform_count || 0) + 1;
                        window.__bm_xform_last = (resourceType || '?') + ':' + url.replace(/^https?:\/\//, '').slice(0, 38);
                    }
                    const scheme = pickBmScheme(url, resourceType);
                    if (scheme) {
                        return { url: encodeBmUrl(scheme, url), credentials: 'omit' };
                    }
                    return { url: url, credentials: 'omit' };
                }
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
            self._layerState = reconcile(
                self._map,
                analysis,
                self._lastLayerOpts,
                self._layerState,
                self._debugHud
            );
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
     * v1.7 — Tier 1 #1: drive selected-feature emphasis from a token.
     *
     * Calls markers.applySelection() which updates the existing
     * LAYER_SELECTED_HALO / LAYER_SELECTED_DOT filters in place AND
     * flies the camera to the matching feature's coordinates when
     * flyToOnChange is on.
     *
     * @param {object} pointsFC — the FeatureCollection just rendered
     *     (so we can look up the matching feature's coordinates).
     * @param {object} selOpts — { field, value, sizeMultiplier,
     *     haloColor, haloWidth, flyToOnChange, flyToZoom }
     */
    applyMarkerSelection(pointsFC, selOpts) {
        if (!this._map || this._destroyed) return;
        const self = this;
        this._afterStyle(function () {
            if (!self._map || self._destroyed) return;
            try {
                markersLayer.applySelection(self._map, pointsFC, selOpts || {});
            } catch (err) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[better_map] applyMarkerSelection failed:', err);
                }
            }
        });
    }

    /**
     * v1.7 — Tier 1 #2: drive the camera from external tokens.
     *
     * Delegates to crossPanel.applyRemoteCamera() which compares the
     * requested view against the current camera and bails when the
     * delta is below a threshold — so calling this on every
     * updateView pass with unchanged tokens is cheap.
     *
     * @param {object} cam — { lng, lat, zoom }
     */
    applyRemoteCamera(cam) {
        if (!this._map || this._destroyed) return;
        if (!cam || !isFinite(cam.lng) || !isFinite(cam.lat)) return;
        const self = this;
        this._afterStyle(function () {
            if (!self._map || self._destroyed) return;
            if (self._crossPanel && typeof self._crossPanel.applyRemoteCamera === 'function') {
                try {
                    self._crossPanel.applyRemoteCamera(cam);
                } catch (err) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('[better_map] applyRemoteCamera failed:', err);
                    }
                }
                return;
            }
            // Fallback path: no cross-panel module attached (cross-panel
            // is disabled). Drive the camera directly. Still throttle
            // by comparing against current centre.
            const cur = self._map.getCenter();
            const dLng = Math.abs(cur.lng - cam.lng);
            const dLat = Math.abs(cur.lat - cam.lat);
            const curZoom = self._map.getZoom();
            const dZoom = isFinite(cam.zoom) ? Math.abs(curZoom - cam.zoom) : 0;
            // ~10m of skew at the equator is the threshold below which
            // jumping the camera is a flicker, not a navigation.
            if (dLng < 1e-4 && dLat < 1e-4 && dZoom < 0.05) return;
            try {
                self._map.jumpTo({
                    center: [cam.lng, cam.lat],
                    zoom: isFinite(cam.zoom) ? cam.zoom : curZoom
                });
            } catch (err) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[better_map] direct camera jump failed:', err);
                }
            }
        });
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

    /**
     * v1.5.1 — Continuous slow rotation of the map bearing. Speed in
     * degrees-per-second; positive values rotate clockwise. A value of
     * ~3 deg/sec completes a full orbit in 2 minutes, which feels alive
     * without being distracting. User interactions (drag / wheel /
     * touch) pause the orbit for ORBIT_RESUME_DELAY_MS so users can
     * inspect a feature without fighting the camera.
     *
     * Pass speedDegPerSec === 0 (or omit) to disable. Idempotent: safe
     * to call repeatedly; only the most-recent speed is honoured.
     */
    setAutoOrbit(speedDegPerSec) {
        if (!this._map || this._destroyed) return;
        const speed = Number(speedDegPerSec);
        const orbit = this._orbit;

        // Disable case: stop RAF, detach listeners, restore bearing
        // control to the user.
        if (!isFinite(speed) || speed === 0) {
            this._stopAutoOrbit();
            return;
        }

        // Reduced motion: leave bearing where the user put it. Honour
        // the requested speed semantics (i.e. record it) but do not
        // start the RAF so the camera stays put.
        if (prefersReducedMotion()) {
            orbit.speedDegPerSec = speed;
            return;
        }

        orbit.speedDegPerSec = speed;
        if (orbit.enabled) {
            return; // already running; new speed takes effect next frame
        }
        orbit.enabled = true;
        orbit.lastFrameMs = nowMs();
        orbit.pausedUntilMs = 0;
        this._attachOrbitPauseHandlers();
        this._tickOrbit();
    }

    /**
     * v1.5.2 — BM-CT-1 introspection: is the auto-orbit RAF currently
     * registered as enabled? Used by the control panel's `isEnabled()`
     * hook for the "Camera auto-orbit" row. Returns false BOTH when
     * orbit is fully off AND when it's currently paused for user
     * interaction (since visually nothing is moving in that state).
     */
    isAutoOrbiting() {
        const orbit = this._orbit;
        if (!orbit || !orbit.enabled) return false;
        // Honour the brief post-interaction pause window — visually
        // identical to "off" from the user's perspective.
        return orbit.pausedUntilMs <= nowMs();
    }

    // -------------------------------------------------------------------
    // v1.5.2 — Control Trio APIs (BM-CT-1 contract).
    //
    // These methods are the master controls invoked by controlPanel.js
    // and viewLock.js. They MUST be idempotent and safe to call against
    // a partially-initialised map (e.g. during the lazyInit visibility
    // wait, before this._map exists).

    /**
     * Capture additional defaults beyond what init() recorded. Called
     * from visualization_source.js with the FULL set of dashboard-author
     * options so per-action reset can find their initial state.
     */
    setDashboardDefaults(extra) {
        if (!extra || typeof extra !== 'object') return;
        if (this._dashboardDefaults === null) {
            this._dashboardDefaults = {};
        }
        // Shallow-merge — the camera defaults set in init() take
        // precedence over anything set here.
        const merged = Object.assign({}, extra, this._dashboardDefaults);
        // ...except that fields ONLY supplied via setDashboardDefaults
        // (not init) should be present. Re-overlay the extras for those.
        Object.keys(extra).forEach(function (k) {
            if (merged[k] === undefined || merged[k] === null) {
                merged[k] = extra[k];
            }
        });
        this._dashboardDefaults = merged;
    }

    /**
     * Read the captured defaults registry. Returns a shallow copy so
     * callers can't accidentally mutate the source of truth.
     */
    getDashboardDefaults() {
        return Object.assign({}, this._dashboardDefaults || {});
    }

    /**
     * Register a fancy action with the master reset / control panel.
     * Modules call this once on mount; controlPanel.js iterates the
     * registry to build its rows.
     *
     * @param {string} id          stable identifier ("paths.comet")
     * @param {object} spec
     * @param {string} spec.label  human label shown in the control panel
     * @param {Function} spec.isEnabled    () => boolean
     * @param {Function} spec.setEnabled   (boolean) => void
     * @param {Function} spec.reset        () => void
     * @param {string} [spec.icon]         single-char glyph for the row
     */
    registerFancyAction(id, spec) {
        if (!id || !spec) return;
        const entry = {
            id: id,
            label: spec.label || id,
            icon: spec.icon || '\u25CB',
            isEnabled: typeof spec.isEnabled === 'function' ? spec.isEnabled : function () { return false; },
            setEnabled: typeof spec.setEnabled === 'function' ? spec.setEnabled : function () {},
            reset: typeof spec.reset === 'function' ? spec.reset : function () {}
        };
        this._fancyActions.set(id, entry);
        return entry;
    }

    /**
     * Read the registered fancy actions. Used by controlPanel.js to
     * render rows.
     */
    getFancyActions() {
        const out = [];
        this._fancyActions.forEach(function (entry) {
            out.push(entry);
        });
        return out;
    }

    /**
     * Unregister a fancy action (e.g. when its host layer is unmounted
     * because the SPL changed). Safe no-op if not registered.
     */
    unregisterFancyAction(id) {
        if (this._fancyActions && id) {
            this._fancyActions.delete(id);
        }
    }

    /**
     * Master "Pause all motion" toggle. Independent of OS-level
     * prefers-reduced-motion. Routed through motion.js so every RAF
     * loop in the bundle sees it via shouldSuppressMotion().
     */
    setMotionPaused(paused) {
        motionSetPaused(paused);
    }

    isMotionPaused() {
        return isMotionPaused();
    }

    /**
     * Master "Reset all motion" — invoke .reset() on every registered
     * fancy action. Does NOT touch the camera (call resetCamera() for
     * that). Does NOT touch motion-paused state (call setMotionPaused
     * for that).
     */
    resetAllMotion() {
        this._fancyActions.forEach(function (entry) {
            try { entry.reset(); } catch (_e) { /* swallow per-action failures */ }
        });
    }

    /**
     * Reset just the camera to its dashboard-author defaults.
     * Animated so the user sees what happened.
     */
    resetCamera() {
        if (!this._map || this._destroyed || !this._dashboardDefaults) {
            return;
        }
        const d = this._dashboardDefaults;
        try {
            this._map.easeTo({
                center: d.center || [0, 20],
                zoom: typeof d.zoom === 'number' ? d.zoom : 1.4,
                pitch: typeof d.pitch === 'number' ? d.pitch : 0,
                bearing: typeof d.bearing === 'number' ? d.bearing : 0,
                duration: 800
            });
        } catch (_e) {
            // setStyle race — bail; the next applyAnalysis will catch up.
        }
    }

    /**
     * Master "Reset view" — the single-button user-facing reset.
     *   1. Restore camera to dashboard defaults
     *   2. Re-enable all dashboard-default animations
     *   3. Clear master pause-motion flag (back to dashboard intent)
     *
     * Does NOT clear selections, drawings, lassos, or filters yet —
     * those subsystems are Wave-1 roadmap. When they ship they MUST
     * register a reset hook here.
     */
    resetView() {
        this.setMotionPaused(false);
        this.resetAllMotion();
        this.resetCamera();
    }

    _stopAutoOrbit() {
        const orbit = this._orbit;
        orbit.enabled = false;
        orbit.speedDegPerSec = 0;
        if (orbit.rafId !== null) {
            cancelFrame(orbit.rafId);
            orbit.rafId = null;
        }
        this._detachOrbitPauseHandlers();
    }

    _attachOrbitPauseHandlers() {
        if (!this._map || this._orbit.handlers) return;
        const orbit = this._orbit;
        const ORBIT_RESUME_DELAY_MS = 5000;
        const pause = function () {
            orbit.pausedUntilMs = nowMs() + ORBIT_RESUME_DELAY_MS;
        };
        const events = ['mousedown', 'touchstart', 'wheel', 'dragstart'];
        // Listen on the map canvas — user gestures land there before
        // MapLibre's own handlers see them.
        const canvas = this._map.getCanvasContainer
            ? this._map.getCanvasContainer()
            : this._map.getContainer();
        events.forEach(function (evt) {
            canvas.addEventListener(evt, pause, { passive: true });
        });
        // Also listen for MapLibre's own movestart so programmatic
        // moves (e.g. fitTo on filter change) don't fight the orbit.
        this._map.on('movestart', function (e) {
            // originalEvent is set only for user-driven moves; ignore
            // moves triggered by our own RAF or by easeTo() helpers
            // because pausing on those would create a feedback loop.
            if (e && e.originalEvent) pause();
        });
        orbit.handlers = { canvas: canvas, pause: pause, events: events };
    }

    _detachOrbitPauseHandlers() {
        const orbit = this._orbit;
        if (!orbit.handlers) return;
        const h = orbit.handlers;
        h.events.forEach(function (evt) {
            h.canvas.removeEventListener(evt, h.pause);
        });
        orbit.handlers = null;
    }

    _tickOrbit() {
        const orbit = this._orbit;
        const self = this;
        if (!orbit.enabled || !this._map || this._destroyed) {
            return;
        }
        // v1.5.2 — honour the master "Pause all motion" toggle (in
        // addition to OS-level prefers-reduced-motion which we already
        // checked in setAutoOrbit). We re-check every frame because
        // the user can flip the master pause at any time without
        // tearing down the orbit RAF.
        const suppress = shouldSuppressMotion();
        const now = nowMs();
        const dt = orbit.lastFrameMs ? (now - orbit.lastFrameMs) / 1000 : 0;
        orbit.lastFrameMs = now;
        if (!suppress && now >= orbit.pausedUntilMs && dt > 0 && dt < 0.5) {
            // dt < 0.5 guards against multi-second tab-resume jumps —
            // we don't want one resume to spin the map by 90°.
            try {
                const bearing = this._map.getBearing();
                this._map.setBearing(bearing + orbit.speedDegPerSec * dt);
            } catch (_e) {
                // setBearing during a style swap can throw; bail this
                // frame and let the next frame catch up.
            }
        }
        orbit.rafId = scheduleFrame(function () { self._tickOrbit(); }, 33);
    }

    setDebugHud(hud) {
        this._debugHud = hud || null;
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
        // v1.5.2 — clear the fancy-action registry so torn-down layer
        // modules' reset() callbacks (which capture closures over the
        // dying map) can't be invoked by a stale controlPanel that
        // outlives this MapBuilder.
        if (this._fancyActions) {
            this._fancyActions.clear();
        }
        // v1.5.1 — explicitly stop auto-orbit so the RAF doesn't keep
        // dispatching against a torn-down map (silent setBearing
        // exceptions land in the catch{} but still consume frames).
        try { this._stopAutoOrbit(); } catch (_err) { /* swallow */ }
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
