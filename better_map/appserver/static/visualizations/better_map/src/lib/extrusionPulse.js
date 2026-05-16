/*
 * Shared "breathing" animator for fill-extrusion layers.
 *
 * Drives a low-amplitude (+/-12%) sine wave on `fill-extrusion-height`
 * by re-applying a multiplied paint property expression each frame. The
 * effect mimics the gentle rise-and-fall of an industrial control room
 * monitor — the world looks alive without distracting from the data.
 *
 * v1.5.1 wires this animator into both:
 *   - lib/layers/extrusion.js  (LAYER_EXTRUSION, fixed `height` field)
 *   - lib/layers/hexbin.js     (LAYER_HEXBIN_EXTRUSION, dynamic `metric`)
 *
 * The animator is keyed on `(map, layerId)` so multiple extrusion
 * layers on the same map (e.g. building footprints + hexbins) each get
 * their own breathing phase, and stop independently when their host
 * layer is unmounted.
 */

import { prefersReducedMotion, shouldSuppressMotion, nowMs, scheduleFrame, cancelFrame } from './motion.js';

const DEFAULT_PERIOD_MS = 4000;   // four-second breath cycle
const DEFAULT_AMPLITUDE = 0.12;   // +/-12% height oscillation
const FRAME_MS = 50;              // 20fps is plenty for a slow breath

const pulsers = new Map();

/**
 * Start a breathing animation on `layerId`.
 *
 * @param {object} map      - MapLibre map instance
 * @param {string} layerId  - target fill-extrusion layer id
 * @param {object} opts
 * @param {*}      opts.baseHeightExpr - the expression that produces the
 *                          neutral fill-extrusion-height. The animator
 *                          will multiply this by `(1 + amplitude * sin(t))`
 *                          every frame.
 * @param {number} [opts.amplitude]  - fractional swing amplitude (default 0.12)
 * @param {number} [opts.periodMs]   - full cycle in milliseconds (default 4000)
 * @param {number} [opts.phaseOffsetRad] - per-layer phase offset so multiple
 *                          extrusion layers on the same map don't breathe
 *                          in lock-step (default 0).
 */
export function startExtrusionPulse(map, layerId, opts) {
    if (!map || !layerId) return;
    const options = opts || {};
    const baseHeightExpr = options.baseHeightExpr;
    if (baseHeightExpr === undefined) return;

    const key = pulseKey(map, layerId);

    // Idempotent: re-starting overrides the baseHeightExpr (e.g. after
    // a data update that changes the scale/metric) without spawning a
    // second RAF.
    let state = pulsers.get(key);
    if (state) {
        state.baseHeightExpr = baseHeightExpr;
        state.amplitude = options.amplitude || DEFAULT_AMPLITUDE;
        state.periodMs = options.periodMs || DEFAULT_PERIOD_MS;
        state.phaseOffset = options.phaseOffsetRad || 0;
        return;
    }

    state = {
        map: map,
        layerId: layerId,
        baseHeightExpr: baseHeightExpr,
        amplitude: options.amplitude || DEFAULT_AMPLITUDE,
        periodMs: options.periodMs || DEFAULT_PERIOD_MS,
        phaseOffset: options.phaseOffsetRad || 0,
        startedAt: nowMs(),
        lastTick: 0,
        rafId: null,
        // v1.5.2 — set true while we are currently parked at the neutral
        // base height because motion is suppressed. Used to detect the
        // suppress→play transition and restart phase cleanly so the
        // column does not "snap" forward by the duration of the pause.
        suppressedPainted: false
    };
    pulsers.set(key, state);

    // v1.5.2 — BM-CT-1: even when motion is currently suppressed
    // (prefers-reduced-motion OR master pause) we ALWAYS start the RAF
    // loop. The tick function paints neutral base height while
    // suppressed and the animated factor otherwise, so toggling master
    // pause OFF resumes the breath seamlessly. Pre-paint the neutral
    // base height now so the column is visible immediately.
    if (shouldSuppressMotion()) {
        applyHeight(map, layerId, baseHeightExpr);
        state.suppressedPainted = true;
    }

    tick(state);
}

/**
 * Stop a breathing animation. Safe to call on a layer that is not
 * currently breathing. Restores the base expression as the final
 * height so the column doesn't get stuck mid-breath.
 */
export function stopExtrusionPulse(map, layerId) {
    if (!map || !layerId) return;
    const key = pulseKey(map, layerId);
    const state = pulsers.get(key);
    if (!state) return;
    if (state.rafId !== null) {
        cancelFrame(state.rafId);
    }
    // Final paint: settle the column at the neutral height so the
    // visual lands stable rather than mid-breath.
    applyHeight(map, layerId, state.baseHeightExpr);
    pulsers.delete(key);
}

/**
 * Stop EVERY breathing animation on a given map. Called from the
 * layer module's unmount() so MapBuilder.destroy() leaves no
 * dangling RAFs.
 */
export function stopAllExtrusionPulsesOnMap(map) {
    if (!map) return;
    const toStop = [];
    pulsers.forEach(function (state, key) {
        if (state.map === map) toStop.push(key);
    });
    toStop.forEach(function (key) {
        const state = pulsers.get(key);
        if (state) {
            if (state.rafId !== null) cancelFrame(state.rafId);
            try { applyHeight(state.map, state.layerId, state.baseHeightExpr); } catch (_e) { /* swallow */ }
            pulsers.delete(key);
        }
    });
}

function tick(state) {
    if (!pulsers.has(pulseKey(state.map, state.layerId))) {
        // Pulser was stopped by an external caller mid-frame.
        return;
    }
    // v1.5.2 — honour the master "Pause all motion" toggle as well as
    // OS-level prefers-reduced-motion. When suppressed we paint the
    // neutral base height once (transition into suppressed) and idle.
    // When unsuppressed we resume animated paint and reset the phase
    // clock so the breath does not jump forward by the pause duration.
    const suppress = shouldSuppressMotion();
    if (suppress) {
        if (!state.suppressedPainted) {
            applyHeight(state.map, state.layerId, state.baseHeightExpr);
            state.suppressedPainted = true;
        }
    } else {
        if (state.suppressedPainted) {
            state.startedAt = nowMs();
            state.lastTick = 0;
            state.suppressedPainted = false;
        }
        const t = nowMs();
        if (t - state.lastTick > FRAME_MS) {
            state.lastTick = t;
            const elapsed = t - state.startedAt;
            const radians = (elapsed / state.periodMs) * Math.PI * 2 + state.phaseOffset;
            // Sine wave on [-1, 1] gives symmetric inhale / exhale of equal
            // duration. Cosine would start at full extension which looks
            // like a "pop in" on first frame.
            const factor = 1 + state.amplitude * Math.sin(radians);
            const expr = ['*', factor, state.baseHeightExpr];
            try {
                if (state.map.getLayer(state.layerId)) {
                    state.map.setPaintProperty(state.layerId, 'fill-extrusion-height', expr);
                } else {
                    // Host layer was removed externally — stop pulsing.
                    stopExtrusionPulse(state.map, state.layerId);
                    return;
                }
            } catch (_e) {
                // setStyle race; bail and retry next frame.
            }
        }
    }
    state.rafId = scheduleFrame(function () { tick(state); }, FRAME_MS);
}

function applyHeight(map, layerId, expr) {
    if (!map.getLayer(layerId)) return;
    try {
        map.setPaintProperty(layerId, 'fill-extrusion-height', expr);
    } catch (_e) {
        /* swallow style race */
    }
}

function pulseKey(map, layerId) {
    // Object identity for the map; layerId is unique within a map.
    return layerId + '@' + (map && map._container ? map._container.id || '?' : '?');
}

// -------------------------------------------------------------------------
// v1.5.2 — BM-CT-1 Control Trio helpers
//
// These three helpers are the introspection / reset API consumed by the
// on-map control panel. They do NOT replace start/stopExtrusionPulse()
// — host layers still own the start/stop lifecycle. They expose:
//
//   isExtrusionPulseRunning(map, layerId)
//     true when a RAF loop is currently registered for that layer.
//
//   hasAnyExtrusionPulseOnMap(map)
//     true when at least one pulser exists for the given map. The
//     extrusion / hexbin host layers use this to decide whether to
//     register the "extrusion pulse" fancy action with MapBuilder.
//
//   resetExtrusionPulsesOnMap(map)
//     Stop every pulser on a given map, then restart each one from
//     its captured baseHeightExpr. Used by the on-map "↻" button so
//     the dashboard-author breath defaults are restored after the
//     user has overridden them at runtime.
// -------------------------------------------------------------------------

export function isExtrusionPulseRunning(map, layerId) {
    if (!map || !layerId) return false;
    return pulsers.has(pulseKey(map, layerId));
}

export function hasAnyExtrusionPulseOnMap(map) {
    if (!map) return false;
    let found = false;
    pulsers.forEach(function (state) {
        if (state.map === map) found = true;
    });
    return found;
}

export function resetExtrusionPulsesOnMap(map) {
    if (!map) return;
    // Snapshot the current pulsers (layerId + baseHeightExpr + amplitude
    // + periodMs + phaseOffset) BEFORE stopping. stop() mutates the
    // pulsers Map so we cannot iterate it directly while stopping.
    const snapshots = [];
    pulsers.forEach(function (state) {
        if (state.map !== map) return;
        snapshots.push({
            layerId: state.layerId,
            baseHeightExpr: state.baseHeightExpr,
            amplitude: state.amplitude,
            periodMs: state.periodMs,
            phaseOffsetRad: state.phaseOffset
        });
    });
    if (snapshots.length === 0) return;
    stopAllExtrusionPulsesOnMap(map);
    snapshots.forEach(function (snap) {
        startExtrusionPulse(map, snap.layerId, {
            baseHeightExpr: snap.baseHeightExpr,
            amplitude: snap.amplitude,
            periodMs: snap.periodMs,
            phaseOffsetRad: snap.phaseOffsetRad
        });
    });
}
