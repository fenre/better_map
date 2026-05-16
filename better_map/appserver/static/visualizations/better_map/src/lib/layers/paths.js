/*
 * Paths / routes layer.
 *
 * Renders LineString and MultiLineString features. Supports:
 *   - color per feature via `color` property, falling back to the configured
 *     default
 *   - per-feature width via `width` property
 *   - optional ant-path animation that scrolls the line-dasharray to give
 *     the illusion of flow (popular for routing/incident maps)
 *   - optional arrow heads at line endpoints
 *   - v1.5.0: optional glow layer rendered beneath the sharp line. Three
 *     rendering tiers produce the laser-beam aesthetic seen in NORSE,
 *     Kepler.gl and similar "sexy maps":
 *
 *         LAYER_LINE_GLOW  - wide (~4x), low-opacity, blurred halo
 *         LAYER_LINE_BG    - medium width, darker outline for contrast
 *         LAYER_LINE       - sharp, full color, the actual line
 *
 *     The glow layer uses MapLibre's `line-blur` paint property; no
 *     post-processing shader required. Controlled by `options.glow`
 *     (default true).
 *
 *   - v1.5.1: TRAVELING COMETS along arc-shape data (LineString features
 *     tagged with `properties.isArc = true` by dataFitness.js). Each arc
 *     emits a glowing point that travels src->dst leaving a soft halo. A
 *     single RAF loop updates ALL comet positions per map via a single
 *     `setData()` on a dedicated comet source — the per-frame cost is
 *     dominated by GeoJSON re-serialisation, which is cheap for <500 arcs.
 *     New option `comet` (default true when arcs are detected). The two
 *     comet layers (glow halo + sharp head) read the arc's `color`
 *     property so the comet matches its parent arc.
 *
 *   - v1.5.1: PROPER MARCHING DASHES. The v1.5.0 `rotateDashArray` hack
 *     only shuffled array elements which produced an off-putting pulse
 *     rather than directional flow. v1.5.1 cycles through a pre-computed
 *     16-step phase-shifted dash pattern and applies it to BOTH the glow
 *     and sharp line layers so the entire beam appears to flow.
 *
 * The animation runs only while there is at least one path feature visible.
 * Phase 5 will gate the animation entirely behind the perf HUD to keep it
 * out of the way when the user has many dashboards open.
 */

import { SET3 } from '../palettes.js';
import { prefersReducedMotion, shouldSuppressMotion } from '../motion.js';

export const SOURCE_ID = 'better_map_paths_src';
export const COMET_SOURCE_ID = 'better_map_paths_comets_src';
export const LAYER_LINE = 'better_map_paths_line';
export const LAYER_LINE_BG = 'better_map_paths_line_bg';
export const LAYER_LINE_GLOW = 'better_map_paths_line_glow';
export const LAYER_ARROW = 'better_map_paths_arrow';
export const LAYER_COMET_GLOW = 'better_map_paths_comet_glow';
export const LAYER_COMET = 'better_map_paths_comet';

const DEFAULT_COLOR = SET3[3];

/*
 * v1.5.1 — Pre-computed 16-step phase-shifted dash patterns.
 *
 * The visual goal is a 4px dash followed by a 4px gap (8px total period)
 * that appears to slide along the line. MapLibre cannot offset a
 * dasharray, so we cycle through 16 dash patterns that each represent
 * the same visual dash pattern shifted by 0.5px. Iterating frame-by-frame
 * produces a smooth marching effect on both the glow halo and the sharp
 * top stroke.
 *
 * Each entry is a [dash, gap, dash, gap, ...] tuple. MapLibre repeats it.
 * The pattern is symmetric so when we finish step 15 (a single-dash) the
 * loop continues seamlessly back to step 0.
 */
const FLOW_DASH_STEPS = (function buildFlowSteps() {
    const steps = [];
    const dash = 4;
    const gap = 4;
    const period = dash + gap;
    const N = 16;
    for (let i = 0; i < N; i++) {
        const phase = (i / N) * period;
        if (phase <= dash) {
            // mid-dash: [dash - phase, gap, dash, gap, dash, phase]
            // (closing fragment on right so the pattern wraps cleanly)
            const left = Math.max(0.01, dash - phase);
            const right = Math.max(0.01, phase);
            steps.push([left, gap, dash, gap, dash, right]);
        } else {
            // mid-gap: [0, gap - (phase - dash), dash, gap, dash, gap, phase - dash]
            const inGap = phase - dash;
            const leftGap = Math.max(0.01, gap - inGap);
            const rightGap = Math.max(0.01, inGap);
            steps.push([0.01, leftGap, dash, gap, dash, gap, dash, rightGap]);
        }
    }
    return steps;
}());
const FLOW_FRAME_MS = 50; // ~20 fps — smooth enough, easy on GPU

const animState = {
    lastTick: 0,
    frame: 0,
    rafId: null,
    map: null,
    enabled: false
};

/*
 * v1.5.1 — Comet emitter state.
 *
 * One entry per arc feature (LineString with properties.isArc = true):
 *   { id, coords, lengths, totalLen, color, startedAt, periodMs }
 *
 * `coords`  - the densified arc coordinates from greatCircleArc()
 * `lengths` - cumulative arc lengths in great-circle radians, so we can
 *             interpolate uniform-speed travel along the geometry
 * `periodMs` - per-comet travel duration; randomly staggered so all
 *             comets are not in lock-step
 */
/*
 * v1.5.2 — BM-CT-1 dashboard-author defaults registry.
 *
 * Captures the FIRST mountAndUpdate() options bag so per-action
 * `reset()` has a known target to snap back to. Subsequent re-mounts
 * (e.g. after a style switch) do NOT overwrite — that would defeat
 * the "snap back to what the dashboard author chose" semantic.
 *
 * Module-global because mountAndUpdate() is module-global; if we ever
 * support multiple paths layers on a single map we'll need to key
 * this by source-id.
 */
let _defaults = null;
let _currentFc = null; // last FC we mountAndUpdate'd with — needed for reset comet emitter

const cometState = {
    rafId: null,
    map: null,
    enabled: false,
    emitters: [],
    lastTick: 0
};
const COMET_FRAME_MS = 33; // ~30 fps — smooth motion at low cost
const COMET_PERIOD_MIN_MS = 1800;
const COMET_PERIOD_MAX_MS = 3400;

/**
 * v1.3.24 — mount with the FC already attached, so the GeoJSON worker
 * tiles real data on its very first pass instead of an empty-collection
 * placeholder. The empty-mount-then-setData pattern is *supposed* to
 * work in MapLibre GL JS but on Splunk Dashboard Studio v2 (Splunk
 * Enterprise 10.2.3) it leaves the source in a perpetual loading state
 * (sourcedata events fire with isSourceLoaded=false but the worker
 * never reports completion). This is the architectural escape hatch.
 *
 * Falls back to mount() + update() chain when called via the legacy
 * path (e.g. from setData() in mapBuilder, which has no FC yet).
 */
export function mountAndUpdate(map, fc, opts) {
    const options = opts || {};
    const initialData = fc && fc.features
        ? fc
        : { type: 'FeatureCollection', features: [] };

    // v1.5.2 — BM-CT-1: capture dashboard-author intent the FIRST
    // mountAndUpdate per (process,map) so per-action reset has a
    // known target. Subsequent re-mounts (style swap, data change)
    // do not overwrite. We snapshot the options we actually consume.
    if (_defaults === null) {
        _defaults = {
            animated: !!options.animated,
            glow: options.glow !== false,
            comet: options.comet, // 'undefined' = auto; true/false = explicit
            color: options.color || null,
            width: options.width || null,
            arrowHeads: !!options.arrowHeads,
            outline: options.outline || null
        };
    }
    _currentFc = initialData;

    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: initialData
        });
    } else if (fc) {
        // Source already exists from a prior cycle — push new data via setData.
        const src = map.getSource(SOURCE_ID);
        if (src && src.setData) {
            src.setData(initialData);
        }
    }
    ensurePathLayers(map, options);

    // Comet emitter — opt-out via options.comet === false. The default
    // is "true when the FC contains at least one feature flagged isArc",
    // so a vanilla LineString dataset (route trails, network paths)
    // never sees comet behaviour unless the dashboard explicitly opts in.
    const cometDefault = featureCollectionHasArcs(initialData);
    const cometOn = options.comet !== false && (options.comet === true || cometDefault);
    if (cometOn) {
        startCometEmitter(map, initialData, options);
    } else {
        stopCometEmitter(map);
    }

    if (options.animated) {
        startAnimation(map);
    } else {
        stopAnimation();
    }
}

/**
 * v1.5.2 — BM-CT-1 runtime API: enable/disable marching dashes at
 * runtime. Called by controlPanel.js when the user flips the toggle.
 * Idempotent.
 */
export function setAnimated(map, enabled) {
    if (!map) return;
    if (enabled) {
        startAnimation(map);
    } else {
        stopAnimation();
    }
}

/**
 * v1.5.2 — BM-CT-1 runtime API: enable/disable arc comets at runtime.
 * When enabled, re-uses the last FC we tiled so the emitter has the
 * arc geometry to follow.
 */
export function setComet(map, enabled) {
    if (!map) return;
    if (enabled && _currentFc) {
        startCometEmitter(map, _currentFc, _defaults || {});
    } else {
        stopCometEmitter(map);
    }
}

/**
 * v1.5.2 — BM-CT-1 runtime API: report current enable states so the
 * control panel toggle reads accurately after open/reset.
 */
export function isAnimatedEnabled() {
    return animState.enabled;
}

export function isCometEnabled() {
    return cometState.enabled || (cometState.emitters && cometState.emitters.length > 0);
}

/**
 * v1.5.2 — BM-CT-1 reset: snap both marching-dashes and comet back to
 * the dashboard-author defaults captured on first mountAndUpdate.
 * No-op when called before any data has been mounted (defaults null).
 */
export function reset(map) {
    if (!map || !_defaults) return;
    // Animated: re-apply the captured default.
    setAnimated(map, _defaults.animated);
    // Comet: re-apply the captured default, honouring 'auto' semantic
    // (undefined means "true when FC has arcs").
    if (_defaults.comet === false) {
        stopCometEmitter(map);
    } else if (_defaults.comet === true) {
        if (_currentFc) startCometEmitter(map, _currentFc, _defaults);
    } else {
        // 'auto' — re-check the current FC for arc features.
        const hasArcs = featureCollectionHasArcs(_currentFc);
        if (hasArcs && _currentFc) {
            startCometEmitter(map, _currentFc, _defaults);
        } else {
            stopCometEmitter(map);
        }
    }
}

/**
 * Back-compat: callers that still invoke mount() then update() (legacy
 * dispatcher path, mapBuilder.setData()) get the original empty-source +
 * setData behaviour. New code should prefer mountAndUpdate().
 */
export function mount(map, opts) {
    mountAndUpdate(map, null, opts);
}

function ensurePathLayers(map, options) {
    const glow = options.glow !== false;
    const baseWidthExpr = ['coalesce', ['get', 'width'], options.width || 3];

    if (glow && !map.getLayer(LAYER_LINE_GLOW)) {
        // v1.5.0 — wide blurred halo underneath the sharp line. Picks up
        // the per-feature `color` so each path glows in its own colour.
        // line-blur is what sells the laser-beam look; without it the
        // wider line just looks like a thick stripe.
        map.addLayer({
            id: LAYER_LINE_GLOW,
            type: 'line',
            source: SOURCE_ID,
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'line-width': ['*', baseWidthExpr, 4.5],
                'line-opacity': 0.18,
                'line-blur': ['*', baseWidthExpr, 1.6]
            }
        });
    }

    if (!map.getLayer(LAYER_LINE_BG)) {
        // BG ring is only rendered when glow is OFF — when the wide
        // blurred glow halo is present it provides better separation
        // from the basemap than a hard outline ring.
        if (!glow) {
            map.addLayer({
                id: LAYER_LINE_BG,
                type: 'line',
                source: SOURCE_ID,
                layout: {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                paint: {
                    'line-color': options.outline || '#0b1a2d',
                    'line-width': ['+', baseWidthExpr, 2],
                    'line-opacity': 0.45
                }
            });
        }
    }

    if (!map.getLayer(LAYER_LINE)) {
        map.addLayer({
            id: LAYER_LINE,
            type: 'line',
            source: SOURCE_ID,
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'line-width': baseWidthExpr,
                'line-opacity': 0.95
            }
        });
    }

    if (options.arrowHeads && !map.getLayer(LAYER_ARROW)) {
        // Arrow heads are rendered via a symbol layer along the line using
        // a unicode triangle. We use text-rotation-alignment: map so the
        // arrow follows the line direction.
        //
        // v1.3.25 — `text-font` MUST be declared explicitly. Without it,
        // MapLibre falls back to its default fontstack
        // ["Open Sans Regular","Arial Unicode MS Regular"], which the
        // OpenFreeMap basemap (Liberty/Positron) does NOT host — they
        // serve only Noto Sans variants. The 404s for the missing glyph
        // PBFs wedge the worker thread that processes our GeoJSON
        // source, so `better_map_paths_src` never tiles and the path
        // line layers never render — even though the font 404 only
        // affects the symbol layer geometrically. (Symptom I in the
        // splunk-ds-onprem-custom-viz SKILL.) `Noto Sans Regular` is
        // the only font OpenFreeMap reliably hosts; clusters.js uses
        // the same fontstack for the same reason.
        map.addLayer({
            id: LAYER_ARROW,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'symbol-placement': 'line',
                'symbol-spacing': 80,
                'text-field': '\u25B6',
                'text-font': ['Noto Sans Regular'],
                'text-size': 12,
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
                'text-keep-upright': false
            },
            paint: {
                'text-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'text-halo-color': options.outline || '#0b1a2d',
                'text-halo-width': 1.4
            }
        });
    }
}

function ensureCometLayers(map, options) {
    if (!map.getSource(COMET_SOURCE_ID)) {
        map.addSource(COMET_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }
    // Glow halo first so the sharp head paints on top.
    if (!map.getLayer(LAYER_COMET_GLOW)) {
        map.addLayer({
            id: LAYER_COMET_GLOW,
            type: 'circle',
            source: COMET_SOURCE_ID,
            paint: {
                'circle-radius': ['coalesce', ['get', 'glowRadius'], 14],
                'circle-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'circle-opacity': 0.35,
                'circle-blur': 1.0,
                'circle-stroke-width': 0
            }
        });
    }
    if (!map.getLayer(LAYER_COMET)) {
        map.addLayer({
            id: LAYER_COMET,
            type: 'circle',
            source: COMET_SOURCE_ID,
            paint: {
                'circle-radius': ['coalesce', ['get', 'headRadius'], 3.5],
                'circle-color': '#ffffff',
                'circle-opacity': 0.95,
                'circle-blur': 0.25,
                'circle-stroke-width': 1.2,
                'circle-stroke-color': ['coalesce', ['get', 'color'], options.color || DEFAULT_COLOR],
                'circle-stroke-opacity': 0.9
            }
        });
    }
}

export function update(map, fc) {
    if (!map) return;
    const src = map.getSource(SOURCE_ID);
    if (src && src.setData) {
        src.setData(fc || { type: 'FeatureCollection', features: [] });
    }
}

export function unmount(map) {
    if (!map) return;
    [LAYER_ARROW, LAYER_COMET, LAYER_COMET_GLOW, LAYER_LINE, LAYER_LINE_BG, LAYER_LINE_GLOW].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    [SOURCE_ID, COMET_SOURCE_ID].forEach(function (id) {
        if (map.getSource(id)) map.removeSource(id);
    });
    if (animState.map === map) {
        stopAnimation();
    }
    if (cometState.map === map) {
        stopCometEmitter(map);
    }
}

export function setVisible(map, visible) {
    [LAYER_LINE_GLOW, LAYER_LINE_BG, LAYER_LINE, LAYER_ARROW, LAYER_COMET_GLOW, LAYER_COMET].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

function startAnimation(map) {
    if (animState.enabled && animState.map === map) {
        return;
    }
    if (prefersReducedMotion()) {
        return;
    }
    animState.enabled = true;
    animState.map = map;
    animState.lastTick = 0;
    animState.frame = 0;
    tick();
}

function stopAnimation() {
    animState.enabled = false;
    if (animState.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(animState.rafId);
    }
    animState.rafId = null;
    animState.map = null;
}

function tick(now) {
    if (!animState.enabled || !animState.map) {
        return;
    }
    // v1.5.2 — honour the master "Pause all motion" toggle in addition
    // to OS-level prefers-reduced-motion. We still re-schedule the
    // next frame even when suppressed so flipping the master pause OFF
    // resumes seamlessly without needing setAnimated(true) again.
    const suppress = shouldSuppressMotion();
    const t = typeof now === 'number' ? now : (Date.now ? Date.now() : 0);
    if (!suppress && t - animState.lastTick > FLOW_FRAME_MS) {
        animState.lastTick = t;
        animState.frame = (animState.frame + 1) % FLOW_DASH_STEPS.length;
        const dashArray = FLOW_DASH_STEPS[animState.frame];
        try {
            if (animState.map.getLayer(LAYER_LINE)) {
                animState.map.setPaintProperty(LAYER_LINE, 'line-dasharray', dashArray);
            }
            if (animState.map.getLayer(LAYER_LINE_GLOW)) {
                // Glow marches in lock-step so the laser beam reads as a
                // single flowing band of light rather than a dashed line
                // riding on top of a continuous halo.
                animState.map.setPaintProperty(LAYER_LINE_GLOW, 'line-dasharray', dashArray);
            }
        } catch (_err) {
            stopAnimation();
            return;
        }
    }
    if (typeof requestAnimationFrame === 'function') {
        animState.rafId = requestAnimationFrame(tick);
    } else {
        animState.rafId = setTimeout(tick, FLOW_FRAME_MS);
    }
}

// -----------------------------------------------------------------------
// v1.5.1 — Comet emitter
// -----------------------------------------------------------------------

function featureCollectionHasArcs(fc) {
    const features = (fc && fc.features) || [];
    for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (f && f.properties && f.properties.isArc) return true;
    }
    return false;
}

function buildEmitters(fc, options) {
    const features = (fc && fc.features) || [];
    const out = [];
    const defaultColor = options.color || DEFAULT_COLOR;
    for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (!f || !f.geometry) continue;
        if (!f.properties || !f.properties.isArc) continue;
        if (f.geometry.type !== 'LineString') continue;
        const coords = f.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const lengths = cumulativeArcLengths(coords);
        const totalLen = lengths[lengths.length - 1];
        if (!(totalLen > 0)) continue;
        const color = (f.properties.color != null && f.properties.color !== '')
            ? f.properties.color
            : defaultColor;
        // Stagger period per-arc so the visual is a continuous fountain
        // of comets, not a synchronised salvo. Deterministic seed based
        // on the feature index so the staggering is stable across
        // re-renders.
        const seedFrac = ((i * 0.6180339887) % 1); // golden-ratio jitter
        const period = COMET_PERIOD_MIN_MS + seedFrac * (COMET_PERIOD_MAX_MS - COMET_PERIOD_MIN_MS);
        out.push({
            id: 'comet:' + (f.id != null ? f.id : i),
            coords: coords,
            lengths: lengths,
            totalLen: totalLen,
            color: color,
            periodMs: period,
            // Phase offset so different arcs are at different fractions
            // of their trip on initial frame.
            phase0: seedFrac
        });
    }
    return out;
}

/**
 * Compute cumulative arc length in great-circle radians from the start
 * of a LineString to each vertex. The returned array has the same
 * length as `coords`, with lengths[0] = 0 and lengths[n-1] = totalLen.
 */
function cumulativeArcLengths(coords) {
    const out = new Array(coords.length);
    out[0] = 0;
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
        const seg = greatCircleSegmentLen(coords[i - 1], coords[i]);
        total += seg;
        out[i] = total;
    }
    return out;
}

function greatCircleSegmentLen(a, b) {
    const D2R = Math.PI / 180;
    const aLon = a[0] * D2R;
    const aLat = a[1] * D2R;
    const bLon = b[0] * D2R;
    const bLat = b[1] * D2R;
    // Haversine angular distance in radians (no Earth-radius multiply —
    // we only need a unitless ratio for interpolation).
    const dLat = bLat - aLat;
    const dLon = bLon - aLon;
    const s = Math.sin(dLat / 2);
    const c = Math.sin(dLon / 2);
    const h = s * s + Math.cos(aLat) * Math.cos(bLat) * c * c;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Linear-interpolate a [lon, lat] position at fractional distance
 * `frac` (0..1) along a LineString whose cumulative `lengths` array is
 * pre-computed. Falls back to chord interpolation between the two
 * straddling vertices — the dataFitness arc generator already produces
 * 64 segments per arc, so chord error is sub-pixel even at zoom 14.
 */
function positionAlongArc(coords, lengths, totalLen, frac) {
    if (frac <= 0) return coords[0].slice();
    if (frac >= 1) return coords[coords.length - 1].slice();
    const target = totalLen * frac;
    // Binary search for the segment containing `target`.
    let lo = 0;
    let hi = lengths.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] <= target) lo = mid;
        else hi = mid;
    }
    const segStart = lengths[lo];
    const segEnd = lengths[hi];
    const segLen = segEnd - segStart;
    if (segLen <= 0) return coords[lo].slice();
    const segFrac = (target - segStart) / segLen;
    const a = coords[lo];
    const b = coords[hi];
    // Cross-antimeridian protection: if the two vertices straddle the
    // dateline (|dLon| > 180) the chord would draw across the globe.
    // dataFitness already emits a discontinuity at -180/180 in that
    // case, so the binary search will pick one side cleanly — no extra
    // work needed here.
    return [
        a[0] + (b[0] - a[0]) * segFrac,
        a[1] + (b[1] - a[1]) * segFrac
    ];
}

function startCometEmitter(map, fc, options) {
    const emitters = buildEmitters(fc, options);
    if (emitters.length === 0) {
        stopCometEmitter(map);
        return;
    }
    ensureCometLayers(map, options);
    cometState.emitters = emitters;
    cometState.map = map;
    if (cometState.enabled) {
        // Already running on this map; just refresh data on next frame.
        return;
    }
    if (prefersReducedMotion()) {
        // Render comets as static points at the midpoint of each arc
        // so the layer is not totally absent — this is a tasteful
        // accessibility fallback rather than a blank "should be moving"
        // empty layer.
        writeStaticMidpoints(map);
        return;
    }
    cometState.enabled = true;
    cometState.lastTick = 0;
    tickComet();
}

function stopCometEmitter(map) {
    cometState.enabled = false;
    if (cometState.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(cometState.rafId);
    }
    cometState.rafId = null;
    cometState.emitters = [];
    cometState.map = null;
    if (map) {
        [LAYER_COMET, LAYER_COMET_GLOW].forEach(function (id) {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource(COMET_SOURCE_ID)) {
            map.removeSource(COMET_SOURCE_ID);
        }
    }
}

function tickComet(now) {
    if (!cometState.enabled || !cometState.map) {
        return;
    }
    // v1.5.2 — honour the master "Pause all motion" toggle in addition
    // to OS-level prefers-reduced-motion. We re-schedule the next
    // frame even when suppressed so a future master-pause OFF resumes
    // the emitter without re-issuing setComet(true).
    const suppress = shouldSuppressMotion();
    const t = typeof now === 'number'
        ? now
        : ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now());
    if (!suppress && t - cometState.lastTick > COMET_FRAME_MS) {
        cometState.lastTick = t;
        writeCometFrame(t);
    }
    if (typeof requestAnimationFrame === 'function') {
        cometState.rafId = requestAnimationFrame(tickComet);
    } else {
        cometState.rafId = setTimeout(tickComet, COMET_FRAME_MS);
    }
}

function writeCometFrame(t) {
    const src = cometState.map && cometState.map.getSource(COMET_SOURCE_ID);
    if (!src || !src.setData) return;
    const features = [];
    for (let i = 0; i < cometState.emitters.length; i++) {
        const e = cometState.emitters[i];
        // Fractional progress of this comet, wrapping in [0,1) over its
        // period. The phase0 offset makes different arcs start at
        // different points along their trip on the very first frame.
        const cyc = ((t / e.periodMs) + e.phase0) % 1;
        // Ease-in/out so the head accelerates out of the source and
        // decelerates into the destination — feels less mechanical than
        // constant speed.
        const eased = easeInOutCubic(cyc);
        const pos = positionAlongArc(e.coords, e.lengths, e.totalLen, eased);
        // Head + halo radii grow slightly mid-arc so the comet "blooms"
        // as it passes the midpoint and shrinks back near the endpoint.
        // This adds depth without distracting from the trail.
        const bloom = Math.sin(cyc * Math.PI); // 0 at endpoints, 1 at midpoint
        features.push({
            type: 'Feature',
            id: e.id,
            geometry: { type: 'Point', coordinates: pos },
            properties: {
                color: e.color,
                headRadius: 3.0 + bloom * 1.5,
                glowRadius: 11 + bloom * 6,
                // alpha falls off near endpoints so the comet appears to
                // launch from the source and dissolve into the dest
                progress: cyc
            }
        });
    }
    try {
        src.setData({ type: 'FeatureCollection', features: features });
    } catch (_e) {
        // Style transitions can race; bail until the next frame.
    }
}

function writeStaticMidpoints(map) {
    const src = map.getSource(COMET_SOURCE_ID);
    if (!src || !src.setData) return;
    const features = [];
    for (let i = 0; i < cometState.emitters.length; i++) {
        const e = cometState.emitters[i];
        const pos = positionAlongArc(e.coords, e.lengths, e.totalLen, 0.5);
        features.push({
            type: 'Feature',
            id: e.id,
            geometry: { type: 'Point', coordinates: pos },
            properties: {
                color: e.color,
                headRadius: 3.0,
                glowRadius: 11,
                progress: 0.5
            }
        });
    }
    try {
        src.setData({ type: 'FeatureCollection', features: features });
    } catch (_e) {
        /* swallow */
    }
}

function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
