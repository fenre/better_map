/*
 * Debug HUD — a visible overlay that shows MapLibre's internal state.
 *
 * Used to diagnose why basemap tiles do not paint inside Splunk Dashboard
 * Studio panels even though MapLibre + the same style URL render fine on a
 * standalone page in the same browser at the same origin.
 *
 * v1.3.15 additions:
 *   - Best-pixel tracker: the brightest non-transparent pixel ever sampled
 *     during the polling window. If WebGL paints ANY non-transparent pixel
 *     at any time, this captures it and proves the canvas isn't dead.
 *   - Detailed event counter: separates `sourcedata` events into tile-loaded
 *     vs source-loaded so we can tell if MapLibre is finishing tile loads.
 *   - Two-shape fetch probe: fires one fetch with our known-good shape
 *     ({cache: 'no-store', credentials: 'omit'}) and one with MapLibre's
 *     default shape (cache: 'default', credentials: 'same-origin'). Reports
 *     both status codes so we can see if cache poisoning is responsible.
 *
 * The HUD is anchored to the bottom-left of the viz container with a
 * z-index above the basemap canvas but below interactive widgets.
 *
 * Enable via the formatter option `showDebugHud=true`.
 */

const HUD_VERSION = '1.8.0';
const PATHS_SOURCE_ID = 'better_map_paths_src';
const PATHS_LAYER_PREFIX = 'better_map_paths_';

export function createDebugHud(container) {
    if (!container || typeof document === 'undefined') {
        return noop();
    }

    const el = document.createElement('div');
    el.className = 'better_map-debug-hud';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        zIndex: '6',
        maxWidth: 'calc(100% - 24px)',
        maxHeight: '70%',
        overflow: 'auto',
        padding: '8px 10px',
        background: 'rgba(11, 18, 28, 0.92)',
        color: '#e6f1ff',
        font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        borderRadius: '6px',
        border: '1px solid rgba(76, 217, 196, 0.42)',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none'
    });
    container.appendChild(el);

    const state = {
        styleType: '?',
        styleUrl: '',
        styleLayerCount: 0,
        styleSourceCount: 0,
        events: {
            'style.load': 0,
            load: 0,
            styledata: 0,
            sourcedata: 0,
            sourcedata_loaded: 0,
            sourcedata_tile: 0,
            idle: 0,
            dataloading: 0
        },
        liveLayerCount: 0,
        liveSourceCount: 0,
        sourceIds: [],
        layerIds: [],
        errors: [],
        probes: [],
        fetchLog: [],          // entries: 'STATUS|URL_short|opts'
        fetchHooked: false,
        canvasSize: '?',
        cssSize: '?',
        glSize: '?',
        pixels: '?',
        bestPixel: { sum: 0, rgba: '0,0,0,0', at: '-' },
        canvasParentBg: '?',
        recentSourceEvent: '-',
        analysis: '(no analysis yet)',
        layerOpts: '-',
        rowsIn: 0,
        fieldsIn: '-',
        pathSourceFeatures: -1,
        pathRenderedFeatures: -1,
        pathLayerProbe: '-',
        cameraInfo: '-',
        reconcileCount: 0,
        reconcileLine: '(no reconcile yet)',
        // Per-source `sourcedata` event breakdown — so we can see if
        // `better_map_paths_src` is even receiving worker traffic. Filled by
        // the sourcedata handler below; rendered in the SOURCE EVTS line.
        sourceEventCounts: Object.create(null),
        // The most recent setData probe for `better_map_paths_src`: shape of
        // the FC + isSourceLoaded snapshot, recorded by paths.js via
        // recordSourceProbe(). The smoking-gun line for the
        // setData-not-tiling investigation.
        sourceProbeLine: '(no setData probe yet)'
    };

    // v1.8.0 stability release — Errors-tab scaffold. Tracks envelopes
    // dispatched via the better_map:error CustomEvent (from safeRun()).
    // Kept separate from state.errors (which holds MapLibre internal events)
    // so the two streams can be reasoned about independently.
    state.errorCounts = {};      // scope -> count
    state.errorTotal = 0;
    state.lastError = null;

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
    renderErrorsLine();

    // Globally hook fetch ONCE (idempotent across multiple HUD instances) so we
    // can capture every MapLibre internal request and compare to our probes.
    if (typeof window !== 'undefined' && !window.__bm_fetch_hooked) {
        window.__bm_fetch_hooked = true;
        window.__bm_fetch_log = [];
        const origFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
            let url;
            let optsSummary;
            if (typeof input === 'string') {
                url = input;
                const o = init || {};
                optsSummary = (o.cache || 'default') + '/' + (o.credentials || 'def');
            } else if (input && input.url) {
                // Request object — read its config
                url = input.url;
                optsSummary = (input.cache || 'default') + '/' + (input.credentials || 'def');
            } else {
                url = String(input);
                optsSummary = '?';
            }
            const t0 = Date.now();
            const shortUrl = url.replace(/^https?:\/\//, '').slice(0, 38);
            const promise = origFetch(input, init);
            promise.then(
                function (r) {
                    window.__bm_fetch_log.push(r.status + '|' + shortUrl + '|' + optsSummary + ' (' + (Date.now() - t0) + 'ms)');
                    if (window.__bm_fetch_log.length > 100) {
                        window.__bm_fetch_log.shift();
                    }
                },
                function (e) {
                    window.__bm_fetch_log.push('ERR|' + shortUrl + '|' + optsSummary + ' ' + (e && e.message ? e.message.slice(0, 30) : '?'));
                    if (window.__bm_fetch_log.length > 100) {
                        window.__bm_fetch_log.shift();
                    }
                }
            );
            return promise;
        };
    }

    // Paint the container BRIGHT RED so if MapLibre renders to a transparent
    // canvas, we see red bleeding through. If MapLibre paints opaque tiles,
    // they cover the red. Simplest possible canvas-alpha diagnostic.
    container.style.backgroundColor = '#ff0040';

    function render() {
        const errLine = state.errors.length
            ? '\nMapLibre errors[' + state.errors.length + ']: ' + state.errors.slice(-4).map(formatErr).join(' | ')
            : '\nMapLibre errors: none';
        const probeLine = state.probes.length
            ? '\nfetch probes[' + state.probes.length + ']: ' + state.probes.slice(-9).join(' | ')
            : '\nfetch probes: (none yet)';
        // Surface a tail of the GLOBAL fetch log so we can see exactly what
        // status MapLibre's actual internal requests got.
        const xformCount = (typeof window !== 'undefined' && window.__bm_xform_count) || 0;
        const xformLast = (typeof window !== 'undefined' && window.__bm_xform_last) || '-';
        const xformLine = '\ntransformRequest calls: ' + xformCount + ' last=' + xformLast;
        const allFetches = (typeof window !== 'undefined' && window.__bm_fetch_log) || [];
        // Filter for openfreemap/openstreetmap-related URLs to keep it relevant.
        const tileFetches = allFetches.filter(function (e) {
            return /openfreemap|openstreetmap|tile\.openstreetmap|liberty|positron|bright|maptiles/.test(e);
        });
        const fetchLogLine = tileFetches.length
            ? '\nALL fetch (tile-only)[' + tileFetches.length + '/' + allFetches.length + ']: ' + tileFetches.slice(-6).join(' | ')
            : '\nALL fetch[0/' + allFetches.length + ']: (no tile-related calls captured)';
        const sources = state.sourceIds.length
            ? state.sourceIds.slice(0, 6).join(', ') + (state.sourceIds.length > 6 ? '…' : '')
            : '(none)';
        const layers = state.layerIds.length
            ? state.layerIds.slice(0, 8).join(', ') + (state.layerIds.length > 8 ? '…' : '')
            : '(none)';
        // Format the per-source sourcedata-event breakdown as
        // `srcId=t:N/dl:N/loaded:N`. Lets us see whether
        // `better_map_paths_src` ever gets worker traffic at all (vs the
        // basemap `openmaptiles`/`ne2_shaded` sources which we know work).
        var srcEvtParts = [];
        var srcEvtKeys = Object.keys(state.sourceEventCounts || {});
        for (var sx = 0; sx < srcEvtKeys.length; sx++) {
            var sk = srcEvtKeys[sx];
            var b = state.sourceEventCounts[sk];
            srcEvtParts.push(sk + '=t:' + b.tile + '/dl:' + b.dl + '/loaded:' + b.loaded);
        }
        var srcEvtsLine = srcEvtParts.length ? srcEvtParts.join(' | ') : '(none yet)';
        el.textContent =
            '[better_map debug ' + HUD_VERSION + '] container painted #ff0040 (red) — visible RED = WebGL canvas is transparent' +
            '\nINPUT: rows=' + state.rowsIn + ' fields=' + state.fieldsIn +
            '\nANALYZE: ' + state.analysis +
            '\nLAYER OPTS: ' + state.layerOpts +
            '\nRECONCILE #' + state.reconcileCount + ': ' + state.reconcileLine +
            '\nSETDATA paths: ' + state.sourceProbeLine +
            errLine +
            '\nPATH src=' + state.pathSourceFeatures +
                ' rendered=' + state.pathRenderedFeatures +
                ' | ' + state.pathLayerProbe +
            '\nCAMERA: ' + state.cameraInfo +
            '\nstyle: ' + state.styleType +
                (state.styleUrl ? ' (' + state.styleUrl + ')' : '') +
                ' L=' + state.styleLayerCount + ' S=' + state.styleSourceCount +
            '\nevents: load=' + state.events.load +
                ' style.load=' + state.events['style.load'] +
                ' styledata=' + state.events.styledata +
                ' sourcedata=' + state.events.sourcedata +
                ' (loaded=' + state.events.sourcedata_loaded +
                ' tile=' + state.events.sourcedata_tile + ')' +
                ' idle=' + state.events.idle +
                ' dataloading=' + state.events.dataloading +
            '\nSOURCE EVTS: ' + srcEvtsLine +
            '\nlive: layers=' + state.liveLayerCount + ' sources=' + state.liveSourceCount +
            '\ncanvas: ' + state.canvasSize + ' css: ' + state.cssSize + ' gl: ' + state.glSize +
            '\npixels (5 samples): ' + state.pixels +
            '\nbest pixel ever: ' + state.bestPixel.rgba + ' (sum=' + state.bestPixel.sum + ', at ' + state.bestPixel.at + ')' +
            '\nlast source event: ' + state.recentSourceEvent +
            '\nparent bg: ' + state.canvasParentBg +
            '\nsources: ' + sources +
            '\nlayers: ' + layers +
            xformLine +
            probeLine +
            fetchLogLine;
    }

    function formatErr(e) {
        if (!e) return '?';
        if (e.message) return (e.name || 'Err') + ':' + e.message.slice(0, 80);
        if (e.error) return (e.error.name || 'Err') + ':' + (e.error.message || '?').slice(0, 80);
        return String(e).slice(0, 80);
    }

    function recordStyle(resolved) {
        if (typeof resolved === 'string') {
            state.styleType = 'url';
            state.styleUrl = resolved.slice(0, 60);
            // Three-shape probe to identify which Request property triggers 404:
            //   1. safe       — fetch(url, {cache:'no-store', credentials:'omit'})
            //   2. maplibre   — fetch(url, {cache:'default',  credentials:'same-origin'})
            //   3. ml-request — fetch(new Request(url, {full MapLibre shape}))
            //                   (Accept header + signal + same-origin credentials)
            probeFetch(resolved, 'safe', { cache: 'no-store', credentials: 'omit' });
            probeFetch(resolved, 'maplibre', { cache: 'default', credentials: 'same-origin' });
            probeMapLibreRequest(resolved);
        } else if (resolved && typeof resolved === 'object') {
            state.styleType = 'inline';
            state.styleUrl = '';
            state.styleLayerCount = (resolved.layers || []).length;
            state.styleSourceCount = Object.keys(resolved.sources || {}).length;
            // Probe a known-good URL to confirm the dashboard context can
            // reach external CDNs in general.
            probeFetch('https://tile.openstreetmap.org/2/2/2.png', 'safe', { cache: 'no-store', credentials: 'omit' });
        } else {
            state.styleType = 'invalid:' + typeof resolved;
        }
        render();
    }

    function probeFetch(url, label, options) {
        if (typeof fetch !== 'function') {
            state.probes.push('no fetch() available');
            render();
            return;
        }
        const shortUrl = url.replace(/^https?:\/\//, '').slice(0, 38);
        const t0 = Date.now();
        fetch(url, options || {})
            .then(function (r) {
                state.probes.push(label + ':' + r.status + ' (' + (Date.now() - t0) + 'ms) ' + shortUrl);
                render();
            })
            .catch(function (e) {
                state.probes.push(label + ':ERR ' + (e && e.message ? e.message : String(e)).slice(0, 60));
                render();
            });
    }

    // Probe with EXACT MapLibre 4.7.1 makeFetchRequest() shape.
    // Reproduces what MapLibre does for type=='json' style requests.
    function probeMapLibreRequest(url) {
        if (typeof fetch !== 'function' || typeof Request !== 'function' || typeof AbortController !== 'function') {
            state.probes.push('ml-req:no Request/AbortController');
            render();
            return;
        }
        const shortUrl = url.replace(/^https?:\/\//, '').slice(0, 38);
        const t0 = Date.now();
        try {
            const ac = new AbortController();
            // Build Request the same way MapLibre does for ResourceType.Style.
            const req = new Request(url, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'default',
                referrer: (typeof document !== 'undefined' ? document.referrer : ''),
                signal: ac.signal
            });
            req.headers.set('Accept', 'application/json');
            fetch(req)
                .then(function (r) {
                    state.probes.push('ml-req:' + r.status + ' (' + (Date.now() - t0) + 'ms) ' + shortUrl);
                    render();
                })
                .catch(function (e) {
                    state.probes.push('ml-req:ERR ' + (e && e.message ? e.message : String(e)).slice(0, 60));
                    render();
                });
        } catch (e) {
            state.probes.push('ml-req:CTOR-ERR ' + (e && e.message ? e.message : String(e)).slice(0, 60));
            render();
        }
    }

    function attach(map) {
        if (!map) {
            render();
            return;
        }

        map.on('error', function (e) {
            state.errors.push(e);
            render();
        });

        map.on('dataloading', function () {
            state.events.dataloading = (state.events.dataloading || 0) + 1;
        });

        // Distinguish source-loaded events from tile-loaded events so we can
        // see if MapLibre is finishing tile arrivals. A raster basemap should
        // emit lots of `tile` sourcedata events as the camera moves.
        map.on('sourcedata', function (evt) {
            state.events.sourcedata = (state.events.sourcedata || 0) + 1;
            if (evt && evt.tile) {
                state.events.sourcedata_tile = (state.events.sourcedata_tile || 0) + 1;
                if (evt.sourceId) {
                    state.recentSourceEvent = 'tile ' + evt.sourceId + ' z' + (evt.coord && evt.coord.canonical ? evt.coord.canonical.z : '?');
                }
            } else if (evt && evt.isSourceLoaded) {
                state.events.sourcedata_loaded = (state.events.sourcedata_loaded || 0) + 1;
                if (evt.sourceId) {
                    state.recentSourceEvent = 'srcLoaded ' + evt.sourceId;
                }
            }
            // Per-source breakdown: lets us see whether
            // `better_map_paths_src` gets ANY worker traffic vs none. Without
            // this, the aggregate counters lump basemap tiles + GeoJSON
            // setData + dataloading events together.
            if (evt && evt.sourceId) {
                var sid = evt.sourceId;
                var bucket = state.sourceEventCounts[sid];
                if (!bucket) {
                    bucket = { total: 0, tile: 0, loaded: 0, dl: 0 };
                    state.sourceEventCounts[sid] = bucket;
                }
                bucket.total++;
                if (evt.tile) {
                    bucket.tile++;
                } else if (evt.isSourceLoaded) {
                    bucket.loaded++;
                } else {
                    // dataType=source && !isSourceLoaded => "source is loading"
                    bucket.dl++;
                }
            }
        });

        const evNames = ['load', 'style.load', 'styledata', 'idle'];
        evNames.forEach(function (name) {
            map.on(name, function () {
                state.events[name] = (state.events[name] || 0) + 1;
                if (name === 'load' || name === 'idle' || name === 'style.load') {
                    sampleMapState(map);
                }
                render();
            });
        });

        // Active paint scan: every 500ms for 20 seconds (40 attempts), sample
        // 25 random pixel positions on the canvas. This ensures we catch even
        // a brief paint cycle if the canvas is being cleared between frames.
        let pollCount = 0;
        const pollHandle = setInterval(function () {
            sampleMapState(map);
            scanRandomPixels(map);
            render();
            pollCount += 1;
            if (pollCount >= 40) {
                clearInterval(pollHandle);
            }
        }, 500);

        sampleMapState(map);
        render();
    }

    function scanRandomPixels(map) {
        try {
            const canvas = map.getCanvas ? map.getCanvas() : null;
            if (!canvas) return;
            const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!ctx) return;
            const w = ctx.drawingBufferWidth;
            const h = ctx.drawingBufferHeight;
            ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
            for (let i = 0; i < 25; i++) {
                const x = Math.floor(Math.random() * (w - 1));
                const y = Math.floor(Math.random() * (h - 1));
                const px = new Uint8Array(4);
                ctx.readPixels(x, y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
                const sum = px[0] + px[1] + px[2] + px[3];
                if (sum > state.bestPixel.sum) {
                    state.bestPixel.sum = sum;
                    state.bestPixel.rgba = px[0] + ',' + px[1] + ',' + px[2] + ',' + px[3];
                    state.bestPixel.at = x + ',' + y;
                }
            }
        } catch (_e) { /* ignore */ }
    }

    function sampleMapState(map) {
        try {
            const style = map.getStyle ? map.getStyle() : null;
            if (style) {
                state.liveLayerCount = (style.layers || []).length;
                state.liveSourceCount = Object.keys(style.sources || {}).length;
                state.sourceIds = Object.keys(style.sources || {});
                state.layerIds = (style.layers || []).map(function (l) { return l.id; });
            }
            samplePathLayerState(map, style);
            sampleCameraState(map);
            const canvas = map.getCanvas ? map.getCanvas() : null;
            if (canvas) {
                state.canvasSize = canvas.width + 'x' + canvas.height;
                const r = canvas.getBoundingClientRect();
                state.cssSize = Math.round(r.width) + 'x' + Math.round(r.height);

                state.canvasParentBg = parentChainSummary(canvas);

                try {
                    if (map.triggerRepaint) {
                        map.triggerRepaint();
                    }
                    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
                    if (ctx) {
                        ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
                        const w = ctx.drawingBufferWidth;
                        const h = ctx.drawingBufferHeight;
                        state.glSize = w + 'x' + h;

                        const positions = [
                            ['CTR', Math.floor(w / 2), Math.floor(h / 2)],
                            ['Q1',  Math.floor(w / 4), Math.floor(h / 4)],
                            ['Q2',  Math.floor(3 * w / 4), Math.floor(h / 4)],
                            ['Q3',  Math.floor(w / 4), Math.floor(3 * h / 4)],
                            ['Q4',  Math.floor(3 * w / 4), Math.floor(3 * h / 4)]
                        ];
                        const samples = [];
                        for (let i = 0; i < positions.length; i++) {
                            const px = new Uint8Array(4);
                            ctx.readPixels(positions[i][1], positions[i][2], 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
                            samples.push(positions[i][0] + '=' + px[0] + ',' + px[1] + ',' + px[2] + ',' + px[3]);
                            const sum = px[0] + px[1] + px[2] + px[3];
                            if (sum > state.bestPixel.sum) {
                                state.bestPixel.sum = sum;
                                state.bestPixel.rgba = px[0] + ',' + px[1] + ',' + px[2] + ',' + px[3];
                                state.bestPixel.at = positions[i][1] + ',' + positions[i][2];
                            }
                        }
                        state.pixels = samples.join(' | ');
                    } else {
                        state.pixels = 'no-gl-ctx';
                    }
                } catch (e) {
                    state.pixels = 'readPixels-err: ' + e.message;
                }
            }
        } catch (e) {
            state.errors.push({ message: 'sampleMapState: ' + e.message });
        }
    }

    function samplePathLayerState(map, style) {
        try {
            // Source feature count: how many features are in the path source
            // (the GeoJSON we handed to addSource / setData).
            if (map.querySourceFeatures && style && style.sources && style.sources[PATHS_SOURCE_ID]) {
                try {
                    const srcFeats = map.querySourceFeatures(PATHS_SOURCE_ID) || [];
                    state.pathSourceFeatures = srcFeats.length;
                } catch (_e) {
                    state.pathSourceFeatures = -2;
                }
            } else {
                state.pathSourceFeatures = -1; // source not mounted
            }

            // Find every better_map_paths_* layer and probe its paint props.
            const pathLayerIds = [];
            if (style && style.layers) {
                for (let i = 0; i < style.layers.length; i++) {
                    const lid = style.layers[i].id;
                    if (lid && lid.indexOf(PATHS_LAYER_PREFIX) === 0) {
                        pathLayerIds.push(lid);
                    }
                }
            }

            // Rendered feature count across all path layers in current viewport.
            if (map.queryRenderedFeatures && pathLayerIds.length) {
                try {
                    const rendered = map.queryRenderedFeatures({ layers: pathLayerIds }) || [];
                    state.pathRenderedFeatures = rendered.length;
                } catch (_e) {
                    state.pathRenderedFeatures = -2;
                }
            } else {
                state.pathRenderedFeatures = -1; // no path layers mounted
            }

            // Probe each path layer's paint properties.
            if (pathLayerIds.length) {
                const probes = [];
                for (let j = 0; j < pathLayerIds.length; j++) {
                    const lid = pathLayerIds[j];
                    const shortId = lid.substr(PATHS_LAYER_PREFIX.length);
                    const layout = (function () {
                        try { return map.getLayer(lid); } catch (_) { return null; }
                    })();
                    if (!layout) {
                        probes.push(shortId + ':MISSING');
                        continue;
                    }
                    const lyrType = layout.type || '?';
                    const parts = [shortId + '(' + lyrType + ')'];
                    try {
                        const vis = map.getLayoutProperty(lid, 'visibility');
                        if (vis && vis !== 'visible') parts.push('vis=' + vis);
                    } catch (_) { /* ignore */ }
                    if (lyrType === 'line') {
                        try {
                            const c = map.getPaintProperty(lid, 'line-color');
                            const w = map.getPaintProperty(lid, 'line-width');
                            const o = map.getPaintProperty(lid, 'line-opacity');
                            const d = map.getPaintProperty(lid, 'line-dasharray');
                            parts.push('color=' + summarizeExpr(c));
                            parts.push('w=' + summarizeExpr(w));
                            parts.push('op=' + summarizeExpr(o));
                            if (d !== undefined) parts.push('dash=[' + (Array.isArray(d) ? d.join(',') : summarizeExpr(d)) + ']');
                        } catch (_) { /* ignore */ }
                    } else if (lyrType === 'symbol') {
                        try {
                            const tc = map.getPaintProperty(lid, 'text-color');
                            const tw = map.getPaintProperty(lid, 'text-halo-width');
                            parts.push('text-color=' + summarizeExpr(tc));
                            if (tw !== undefined) parts.push('halo=' + summarizeExpr(tw));
                        } catch (_) { /* ignore */ }
                    }
                    probes.push(parts.join(' '));
                }
                state.pathLayerProbe = probes.join(' || ');
            } else {
                state.pathLayerProbe = '(no better_map_paths_* layers mounted)';
            }
        } catch (e) {
            state.pathLayerProbe = 'PROBE-ERR ' + (e && e.message ? e.message.slice(0, 50) : '?');
        }
    }

    function summarizeExpr(v) {
        if (v === undefined || v === null) return '-';
        if (Array.isArray(v)) return JSON.stringify(v).slice(0, 40);
        if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
        return String(v);
    }

    function sampleCameraState(map) {
        try {
            const z = map.getZoom ? map.getZoom().toFixed(2) : '?';
            const c = map.getCenter ? map.getCenter() : null;
            const cs = c ? (c.lng.toFixed(2) + ',' + c.lat.toFixed(2)) : '?';
            let bs = '?';
            if (map.getBounds) {
                const b = map.getBounds();
                if (b) {
                    bs = '[' + b.getWest().toFixed(1) + ',' + b.getSouth().toFixed(1) +
                         ' .. ' + b.getEast().toFixed(1) + ',' + b.getNorth().toFixed(1) + ']';
                }
            }
            state.cameraInfo = 'z=' + z + ' c=' + cs + ' bbox=' + bs;
        } catch (e) {
            state.cameraInfo = 'CAM-ERR ' + (e && e.message ? e.message.slice(0, 40) : '?');
        }
    }

    function parentChainSummary(node) {
        const flags = [];
        let cur = node && node.parentElement;
        let depth = 0;
        while (cur && depth < 8) {
            try {
                const cs = window.getComputedStyle(cur);
                const bits = [];
                if (cs.transform && cs.transform !== 'none') bits.push('xform');
                if (cs.opacity && cs.opacity !== '1') bits.push('op=' + cs.opacity);
                if (cs.filter && cs.filter !== 'none') bits.push('flt');
                if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') bits.push('blend=' + cs.mixBlendMode);
                if (cs.overflow && cs.overflow !== 'visible') bits.push('ovf=' + cs.overflow);
                if (cs.zIndex && cs.zIndex !== 'auto') bits.push('z=' + cs.zIndex);
                if (cs.willChange && cs.willChange !== 'auto') bits.push('will');
                if (bits.length) {
                    const tag = (cur.tagName || '?').toLowerCase();
                    const cls = (cur.className && typeof cur.className === 'string')
                        ? '.' + cur.className.split(' ')[0].slice(0, 18)
                        : '';
                    flags.push(tag + cls + '[' + bits.join(',') + ']');
                }
            } catch (_e) { /* ignore */ }
            cur = cur.parentElement;
            depth++;
        }
        return flags.length ? flags.join(' > ') : '(no transforms/opacity in 8 parents)';
    }

    function recordInput(rowCount, fieldNames) {
        state.rowsIn = rowCount;
        state.fieldsIn = (fieldNames || []).slice(0, 10).join(',') +
            ((fieldNames || []).length > 10 ? '…' : '');
        render();
    }

    function recordAnalysis(analysis) {
        if (!analysis) {
            state.analysis = '(null)';
        } else {
            const points = ((analysis.points && analysis.points.features) || []).length;
            const lines = ((analysis.lines && analysis.lines.features) || []).length;
            const polys = ((analysis.polygons && analysis.polygons.features) || []).length;
            const detected = analysis.detected || {};
            state.analysis = 'points=' + points + ' lines=' + lines + ' polys=' + polys +
                ' | detected lat=' + (detected.latField || '-') +
                ' lon=' + (detected.lonField || '-') +
                ' pid=' + (detected.pathIdField || '-') +
                ' time=' + (detected.timeField || '-');
            if (lines > 0 && analysis.lines.features[0]) {
                const f0 = analysis.lines.features[0];
                const coords = (f0.geometry && f0.geometry.coordinates) || [];
                state.analysis += ' | first line id=' + f0.id + ' verts=' + coords.length;
            }
        }
        render();
    }

    function recordLayerOpts(opts) {
        if (!opts) {
            state.layerOpts = '(null)';
        } else {
            state.layerOpts = 'pointRenderer=' + (opts.pointRenderer || '?') +
                ' paths.color=' + ((opts.paths && opts.paths.color) || '?') +
                ' paths.animated=' + ((opts.paths && opts.paths.animated) || false) +
                ' paths.arrows=' + ((opts.paths && opts.paths.arrowHeads) || false);
        }
        render();
    }

    /**
     * Record a one-shot snapshot of a GeoJSON source RIGHT after setData()
     * was called by a layer strategy. Lets us see what we passed to
     * setData and the immediate source state, including isSourceLoaded()
     * and a sample of the first feature's geometry. The smoking-gun line
     * for "setData was called with N features but querySourceFeatures
     * still returns 0" investigations.
     *
     * @param {object} info  - {srcId, fcLen, isLoaded, feat0Type, feat0Coord0, propKeys, err?}
     */
    function recordSourceProbe(info) {
        if (!info) {
            state.sourceProbeLine = '(null probe)';
        } else {
            var p = info;
            var s = (p.srcId || '?') +
                ' fc=' + (typeof p.fcLen === 'number' ? p.fcLen : '?') +
                ' isLoaded=' + (p.isLoaded === true ? 't' : p.isLoaded === false ? 'f' : '?') +
                ' feat0=' + (p.feat0Type || '-');
            if (p.feat0Coord0) {
                s += ' c0=' + JSON.stringify(p.feat0Coord0);
            }
            if (p.propKeys && p.propKeys.length) {
                s += ' propKeys=[' + p.propKeys.slice(0, 8).join(',') + ']';
            }
            if (p.err) {
                s += ' ERR=' + String(p.err).slice(0, 40);
            }
            state.sourceProbeLine = s;
        }
        render();
    }

    /**
     * Record one reconcile() pass from the layer dispatcher. `entries` is an
     * array of {id, mounted, fcLen, srcCountAfter, err?} objects, one per
     * strategy that was active in this cycle.
     */
    function recordReconcile(entries) {
        state.reconcileCount = (state.reconcileCount || 0) + 1;
        if (!entries || !entries.length) {
            state.reconcileLine = '(no active strategies)';
        } else {
            state.reconcileLine = entries.map(function (e) {
                if (!e) return '?';
                var s = e.id + '[';
                s += e.mounted ? 'mount+update' : 'update';
                s += ' fc=' + e.fcLen;
                s += ' srcAfter=' + (typeof e.srcCountAfter === 'number' ? e.srcCountAfter : '?');
                if (e.err) s += ' ERR=' + String(e.err).slice(0, 40);
                return s + ']';
            }).join(' ');
        }
        render();
    }

    return {
        recordStyle: recordStyle,
        recordInput: recordInput,
        recordAnalysis: recordAnalysis,
        recordLayerOpts: recordLayerOpts,
        recordReconcile: recordReconcile,
        recordSourceProbe: recordSourceProbe,
        attach: attach,
        destroy: function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    };
}

function noop() {
    return {
        recordStyle: function () {},
        recordInput: function () {},
        recordAnalysis: function () {},
        recordLayerOpts: function () {},
        recordReconcile: function () {},
        recordSourceProbe: function () {},
        attach: function () {},
        destroy: function () {}
    };
}
