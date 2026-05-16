/*
 * Markers layer (point features).
 *
 * Two render strategies, auto-selected per feature count:
 *
 *   - SDF circle layer (GPU-fast). Used unconditionally; supports per-
 *     feature `color` and `size` properties driven from SPL fields.
 *   - HTML marker fallback for low feature counts (< 200) when the user
 *     wants rich custom icons (Phase 4 will wire this up to a formatter
 *     toggle). For Phase 2 the circle layer is always used.
 *
 * Picks up the optional `color`, `size`, `icon`, `tooltip`, and `popup`
 * properties from each feature's properties bag (set by dataFitness.js).
 *
 * v1.5.0 — pulsing radar rings.
 *
 * When `options.pulse` is true (default), two extra `circle` layers
 * are mounted underneath the main dot. They are animated by an RAF
 * loop that bumps `circle-radius` and `circle-opacity` so the rings
 * appear to expand outward from each marker and fade away. The two
 * rings run 60 degrees out of phase so the visual effect is a
 * continuous radar ping rather than a single in-out blink.
 *
 * v1.5.1 — severity-bound pulse rate.
 *
 * Each feature's `color` is parsed into one of four severity tiers
 * (critical / warn / info / ok). Tiers are exposed as a per-feature
 * `pulseTier` property so MapLibre can drive a tier-aware
 * `circle-radius` / `circle-opacity` expression. A third dedicated
 * `LAYER_PULSE_HEARTBEAT` overlay renders ONLY on critical-tier
 * features and pulses at ~2x the base rate, giving alarming markers
 * the visceral "ER monitor heartbeat" tempo that ok-tier markers do
 * not have. The two general-purpose ping rings still cover everything
 * at the calm base rate — critical markers just get the additional
 * fast-pulse halo on top.
 */

import { SET3 } from '../palettes.js';
import { shouldSuppressMotion, nowMs } from '../motion.js';

export const SOURCE_ID = 'better_map_markers_src';
export const LAYER_PULSE_OUTER = 'better_map_markers_pulse_outer';
export const LAYER_PULSE_INNER = 'better_map_markers_pulse_inner';
export const LAYER_PULSE_HEARTBEAT = 'better_map_markers_pulse_heartbeat';
export const LAYER_BG = 'better_map_markers_bg';
export const LAYER_DOT = 'better_map_markers_dot';
export const LAYER_LABEL = 'better_map_markers_label';

const DEFAULT_COLOR = SET3[0];
const DEFAULT_RADIUS = 6;
const PULSE_PERIOD_MS = 1800; // calm base rate
const HEARTBEAT_PERIOD_MS = 900; // 2x faster — alarming
const PULSE_FRAME_MS = 33; // ~30 fps, plenty smooth for a slow ping

/*
 * Color → tier resolution.
 *
 * The cyber palette already encodes severity by hue, so we can detect
 * "this marker is alarming" by looking at the requested colour. Hex
 * matching is intentionally lenient (case-insensitive, with-or-without
 * leading hash) so dashboards that pre-lower-case or strip-hash colours
 * still classify correctly. Unknown colours fall through to the calm
 * "info" tier so the worst-case visual is just the base radar ping.
 *
 * The chosen hex codes match palettes.js#CYBER, the new v1.5.0 default
 * showcase palette. Add palette-specific overrides here when new
 * palettes are introduced.
 */
const TIER_BY_HEX = {
    // critical / alert
    'f43f5e': 'critical', // rose-500
    'dc2626': 'critical', // red-600
    'ef4444': 'critical', // red-500
    'd93f3c': 'critical', // brand red
    'ff5500': 'critical', // synthwave deep orange
    'e11d48': 'critical', // rose-600
    // warn / idle
    'fbbf24': 'warn',     // amber-400
    'f59e0b': 'warn',     // amber-500
    'd97706': 'warn',     // amber-700
    'eab308': 'warn',     // yellow-500
    'fcd34d': 'warn',     // amber-300
    // ok / good
    'a3e635': 'ok',       // lime-400
    '84cc16': 'ok',       // lime-500
    '22c55e': 'ok',       // emerald-500
    '10b981': 'ok',       // emerald-500 alt
    '16a34a': 'ok',       // green-600
    // info / nominal
    '22d3ee': 'info',     // cyan-400
    '06b6d4': 'info',     // cyan-500
    '00a4fd': 'info',     // brand blue
    '3b82f6': 'info'      // blue-500
};

function tierForColor(raw) {
    if (typeof raw !== 'string') return 'info';
    const hex = raw.replace(/^#/, '').toLowerCase().trim();
    return TIER_BY_HEX[hex] || 'info';
}

/**
 * Walk a FeatureCollection and inject a `pulseTier` property on every
 * Point feature based on its `color`. Mutates the supplied FC in place
 * so subsequent setPaintProperty match expressions can read the tier
 * directly. Returns a tier counts dictionary for the caller (used to
 * decide whether to skip the heartbeat layer entirely).
 */
function enrichTiers(fc) {
    const counts = { critical: 0, warn: 0, ok: 0, info: 0 };
    const features = (fc && fc.features) || [];
    for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (!f || !f.properties) continue;
        const tier = tierForColor(f.properties.color);
        f.properties.pulseTier = tier;
        counts[tier]++;
    }
    return counts;
}

const pulseState = {
    rafId: null,
    map: null,
    enabled: false,
    startedAt: 0,
    lastTick: 0,
    baseRadius: DEFAULT_RADIUS,
    hasCritical: false,
    // v1.5.2 — set true while the static reduced-motion rings are
    // currently painted, so we know whether to repaint on the next
    // suppress→play transition. False while animation is ticking.
    staticPainted: false
};

/*
 * v1.5.2 — BM-CT-1 dashboard-author default for the marker pulse.
 * Captured on first mount() so per-action reset() can snap back to
 * what the dashboard author chose. Module-global mirrors the
 * mount/update API which is also module-global.
 */
let _defaults = null;

export function mount(map, opts) {
    const options = opts || {};
    // v1.5.2 — BM-CT-1: capture the dashboard-author defaults the
    // FIRST mount per (process,map) so per-action reset has a known
    // target. Subsequent re-mounts (style swap) do NOT overwrite.
    if (_defaults === null) {
        _defaults = {
            pulse: options.pulse !== false,
            radius: options.radius || DEFAULT_RADIUS,
            color: options.color || null,
            outline: options.outline || null
        };
    }

    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            promoteId: 'id',
            generateId: false
        });
    }

    const color = expressionOr(['get', 'color'], options.color || DEFAULT_COLOR);
    const radius = expressionOr(['get', 'size'], options.radius || DEFAULT_RADIUS);
    const baseRadiusLiteral = options.radius || DEFAULT_RADIUS;
    const pulseEnabled = options.pulse !== false;

    if (pulseEnabled && !map.getLayer(LAYER_PULSE_OUTER)) {
        // Outer ping ring. Animated by setPulseFrame() — base radius and
        // opacity are bumped each tick. No animation runs until
        // setPulseFrame is invoked, so the layer is harmless if the RAF
        // loop never starts.
        map.addLayer({
            id: LAYER_PULSE_OUTER,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': baseRadiusLiteral,
                'circle-color': color,
                'circle-opacity': 0,
                'circle-blur': 0.7,
                'circle-stroke-width': 0
            }
        });
    }

    if (pulseEnabled && !map.getLayer(LAYER_PULSE_INNER)) {
        // Inner ping ring, runs 60 degrees out of phase with the outer
        // ring (see setPulseFrame).
        map.addLayer({
            id: LAYER_PULSE_INNER,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': baseRadiusLiteral,
                'circle-color': color,
                'circle-opacity': 0,
                'circle-blur': 0.55,
                'circle-stroke-width': 0
            }
        });
    }

    if (pulseEnabled && !map.getLayer(LAYER_PULSE_HEARTBEAT)) {
        // Critical-only heartbeat overlay — runs at 2x the base rate so
        // alarming markers get a visually distinct "ER monitor" tempo.
        // The layer-level filter restricts it to features tagged
        // pulseTier == 'critical' by enrichTiers(). The heartbeat layer
        // is harmless when there are no critical-tier features in the
        // FC (filter evaluates to false for everything).
        map.addLayer({
            id: LAYER_PULSE_HEARTBEAT,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'pulseTier'], 'critical'],
            paint: {
                'circle-radius': baseRadiusLiteral,
                'circle-color': color,
                'circle-opacity': 0,
                'circle-blur': 0.85,
                'circle-stroke-width': 0
            }
        });
    }

    if (!map.getLayer(LAYER_BG)) {
        map.addLayer({
            id: LAYER_BG,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0,
                    radius,
                    14,
                    addExpr(radius, 4)
                ],
                'circle-color': color,
                'circle-opacity': 0.18,
                'circle-blur': 0.4
            }
        });
    }

    if (!map.getLayer(LAYER_DOT)) {
        map.addLayer({
            id: LAYER_DOT,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': radius,
                'circle-color': color,
                'circle-opacity': 0.95,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': options.outline || '#0b1a2d'
            }
        });
    }

    // Kick off the pulse animation now that all marker layers are mounted.
    if (pulseEnabled) {
        startPulse(map, baseRadiusLiteral);
    } else {
        stopPulse();
    }

    if (options.showLabels && !map.getLayer(LAYER_LABEL)) {
        // v1.3.25 — `text-font` MUST be declared explicitly. See paths.js
        // for the full root-cause explanation; same trap applies here.
        map.addLayer({
            id: LAYER_LABEL,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'text-field': ['coalesce', ['get', 'label'], ['get', 'name'], ['get', 'tooltip']],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-offset': [0, 1.1],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-ignore-placement': false
            },
            paint: {
                'text-color': options.labelColor || '#e6eef9',
                'text-halo-color': options.labelHalo || '#0b1a2d',
                'text-halo-width': 1.2
            }
        });
    }
}

export function update(map, fc) {
    if (!map) return;
    const src = map.getSource(SOURCE_ID);
    if (!src || !src.setData) return;
    const safe = fc || { type: 'FeatureCollection', features: [] };
    // v1.5.1 — tag every Point with its severity tier so the heartbeat
    // layer's filter expression can find the critical features.
    const counts = enrichTiers(safe);
    pulseState.hasCritical = counts.critical > 0;
    src.setData(safe);
}

export function unmount(map) {
    if (!map) return;
    [LAYER_LABEL, LAYER_DOT, LAYER_BG, LAYER_PULSE_HEARTBEAT, LAYER_PULSE_INNER, LAYER_PULSE_OUTER].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    if (pulseState.map === map) {
        stopPulse();
    }
}

export function setVisible(map, visible) {
    [LAYER_PULSE_OUTER, LAYER_PULSE_INNER, LAYER_PULSE_HEARTBEAT, LAYER_LABEL, LAYER_DOT, LAYER_BG].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

// -------------------------------------------------------------------------
// Pulse animation. Runs ONE setPaintProperty call per frame per ring,
// driven by a single requestAnimationFrame loop. The two rings run 60
// degrees out of phase so the visual is a continuous radar ping rather
// than a single in-and-out blink. v1.5.1 adds a third heartbeat ring
// that runs at 2x the base rate and is filtered to critical features
// only — so alarming markers have a visceral fast tempo on top of the
// calm base ping.

function startPulse(map, baseRadius) {
    pulseState.map = map;
    pulseState.baseRadius = baseRadius || DEFAULT_RADIUS;
    if (pulseState.enabled) {
        return; // already running
    }
    // v1.5.2 — BM-CT-1: ALWAYS start the RAF loop, even when motion is
    // currently suppressed (prefers-reduced-motion OR master pause).
    // The tick function paints static rings while suppressed and
    // animated rings otherwise, so toggling master pause OFF resumes
    // animation seamlessly. Pre-paint static rings now so the rings are
    // visible immediately rather than waiting for the first tick.
    if (shouldSuppressMotion()) {
        applyStaticRings(map, pulseState.baseRadius);
    }
    pulseState.enabled = true;
    pulseState.staticPainted = shouldSuppressMotion();
    pulseState.startedAt = nowMs();
    pulseState.lastTick = 0;
    tickPulse();
}

function stopPulse() {
    pulseState.enabled = false;
    if (pulseState.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(pulseState.rafId);
    }
    pulseState.rafId = null;
    pulseState.map = null;
    pulseState.staticPainted = false;
}

function tickPulse(now) {
    if (!pulseState.enabled || !pulseState.map) {
        return;
    }
    // v1.5.2 — honour the master "Pause all motion" toggle as well as
    // OS-level prefers-reduced-motion. While suppressed we paint static
    // rings exactly once (transition into suppressed) then idle. While
    // unsuppressed we resume animated paint and reset startedAt so the
    // pulse phase does not "leap forward" by the duration of the pause.
    const suppress = shouldSuppressMotion();
    if (suppress) {
        if (!pulseState.staticPainted) {
            applyStaticRings(pulseState.map, pulseState.baseRadius);
            pulseState.staticPainted = true;
        }
    } else {
        if (pulseState.staticPainted) {
            // Just came back from a paused state — reset the clock so
            // the pulse phase restarts cleanly rather than jumping.
            pulseState.startedAt = nowMs();
            pulseState.lastTick = 0;
            pulseState.staticPainted = false;
        }
        const t = typeof now === 'number' ? now : nowMs();
        if (t - pulseState.lastTick > PULSE_FRAME_MS) {
            pulseState.lastTick = t;
            const elapsed = t - pulseState.startedAt;
            const basePhase = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
            applyRing(pulseState.map, LAYER_PULSE_OUTER, basePhase, pulseState.baseRadius, 1.0);
            const innerPhase = (basePhase + 0.166) % 1; // ~60 deg out of phase
            applyRing(pulseState.map, LAYER_PULSE_INNER, innerPhase, pulseState.baseRadius, 1.0);
            if (pulseState.hasCritical) {
                // 2x cadence; slightly larger end-state so the heartbeat
                // visibly punches past the base ring's reach.
                const fastPhase = (elapsed % HEARTBEAT_PERIOD_MS) / HEARTBEAT_PERIOD_MS;
                applyRing(pulseState.map, LAYER_PULSE_HEARTBEAT, fastPhase, pulseState.baseRadius, 1.25);
            }
        }
    }
    if (typeof requestAnimationFrame === 'function') {
        pulseState.rafId = requestAnimationFrame(tickPulse);
    } else {
        pulseState.rafId = setTimeout(tickPulse, PULSE_FRAME_MS);
    }
}

function applyRing(map, layerId, phase, baseRadius, sizeMul) {
    if (!map.getLayer(layerId)) return;
    // Ring expands from baseRadius -> baseRadius * (4 * sizeMul) over
    // the period. Opacity fades from 0.55 -> 0 with an ease-out so the
    // trailing edge of the ping looks natural (not a sudden cut-off).
    // The heartbeat layer gets sizeMul=1.25 so it visibly extends past
    // the calmer base rings.
    const peak = 1 + 3 * sizeMul;
    const radius = baseRadius * (1 + (peak - 1) * phase);
    const opacity = 0.55 * (1 - phase) * (1 - phase);
    try {
        map.setPaintProperty(layerId, 'circle-radius', radius);
        map.setPaintProperty(layerId, 'circle-opacity', opacity);
    } catch (_e) {
        // Style transitions can race a setStyle() — bail until the
        // next frame finds the layer in a steady state.
    }
}

function applyStaticRings(map, baseRadius) {
    // Reduced-motion fallback: paint the rings at their visual midpoint
    // so the marker design still reads as intentional. No RAF, no
    // ongoing GPU updates.
    [
        { id: LAYER_PULSE_OUTER, sizeMul: 1.0, phase: 0.4 },
        { id: LAYER_PULSE_INNER, sizeMul: 1.0, phase: 0.55 },
        { id: LAYER_PULSE_HEARTBEAT, sizeMul: 1.25, phase: 0.45 }
    ].forEach(function (cfg) {
        if (!map.getLayer(cfg.id)) return;
        const peak = 1 + 3 * cfg.sizeMul;
        const radius = baseRadius * (1 + (peak - 1) * cfg.phase);
        const opacity = 0.4;
        try {
            map.setPaintProperty(cfg.id, 'circle-radius', radius);
            map.setPaintProperty(cfg.id, 'circle-opacity', opacity);
        } catch (_e) {
            /* swallow */
        }
    });
}

/**
 * Combine a feature-property expression with a literal fallback.
 * Falls back to the literal when the property is missing or null.
 */
function expressionOr(propExpr, literal) {
    return ['case', ['has', propExpr[1]], propExpr, literal];
}

function addExpr(expr, delta) {
    if (typeof expr === 'number') {
        return expr + delta;
    }
    return ['+', expr, delta];
}

// -------------------------------------------------------------------------
// v1.5.2 — BM-CT-1 Control Trio: setPulse / isPulseEnabled / reset
//
// The marker module exposes a single fancy action: "Marker pulse rings".
// These three exports are wired into MapBuilder.registerFancyAction()
// by the parent shell so the on-map control panel can toggle and reset
// the pulse without re-mounting the layers from scratch.
//
// setPulse(map, enabled) — start or stop the RAF loop AND show/hide the
//   pulse layers. The dots themselves stay visible either way.
// isPulseEnabled() — true if the RAF loop is currently running.
// reset(map) — return the action to the dashboard-author default
//   captured during the first mount() call. Idempotent: if the action
//   is already in the default state this is a no-op.
// -------------------------------------------------------------------------

/**
 * Turn the marker pulse rings on or off at runtime without re-mounting
 * the marker layers. When OFF the ring layers' opacity is forced to 0
 * via the static-rings helper (with phase clamped to "invisible") and
 * the RAF loop is stopped. When ON the rings are remounted (if missing)
 * and the RAF loop is restarted.
 */
export function setPulse(map, enabled) {
    if (!map) return;
    const want = !!enabled;
    if (want) {
        // Ensure the 3 ring layers exist. If a prior setPulse(false)
        // hard-removed them we need to recreate them; the simpler path
        // is to call mount() with the same effective options — mount()
        // is idempotent for already-present layers.
        const opts = _defaults
            ? {
                pulse: true,
                radius: _defaults.radius,
                color: _defaults.color || undefined,
                outline: _defaults.outline || undefined
            }
            : { pulse: true, radius: pulseState.baseRadius };
        mount(map, opts);
    } else {
        stopPulse();
        // Hide the three ring layers entirely while keeping the dot and
        // background visible. We do NOT remove the layers — keeping
        // them around makes a re-enable cheap and avoids re-issuing
        // addLayer() in the wrong z-order.
        [LAYER_PULSE_OUTER, LAYER_PULSE_INNER, LAYER_PULSE_HEARTBEAT].forEach(function (id) {
            if (map.getLayer(id)) {
                try {
                    map.setPaintProperty(id, 'circle-opacity', 0);
                    map.setPaintProperty(id, 'circle-radius', pulseState.baseRadius);
                } catch (_e) {
                    /* swallow during style transition */
                }
            }
        });
    }
}

/**
 * Returns true when the pulse RAF loop is currently running. False when
 * stopPulse() has been called or the rings have never been mounted.
 */
export function isPulseEnabled() {
    return !!pulseState.enabled;
}

/**
 * Snap the pulse action back to the dashboard-author default captured
 * during the first mount() call. If no default was captured (e.g.
 * reset called before mount, which should never happen in practice)
 * the function falls back to enabling the pulse.
 */
export function reset(map) {
    if (!map) return;
    const wantEnabled = _defaults ? !!_defaults.pulse : true;
    setPulse(map, wantEnabled);
}
