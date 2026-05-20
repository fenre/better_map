/*
 * Cross-panel coordination for Dashboard Studio.
 *
 * Better Map publishes the camera state (center / zoom / pitch / bearing)
 * and the most-recently-selected feature into a small set of well-known
 * dashboard tokens so sibling panels can react. Subscribers (other Better
 * Map instances on the same dashboard, or any panel reading these tokens
 * via base-search expressions) can mirror the camera by re-applying the
 * tokens back into their own search drivers.
 *
 * The token contract is intentionally minimal so authors don't have to
 * memorise field names. All tokens are scoped under `better_map.`:
 *
 *   - better_map.camera.lng (number)
 *   - better_map.camera.lat (number)
 *   - better_map.camera.zoom (number)
 *   - better_map.camera.pitch (number)
 *   - better_map.camera.bearing (number)
 *   - better_map.selected.id (any)
 *   - better_map.selected.layer (string, layerName property if present)
 *
 * The viz must be supplied as an argument (so we can call its
 * `getDashboardEvents` API for emit and `subscribeToFormatterChange` for
 * receive). When run outside Splunk (e.g. in the test harness) we silently
 * no-op.
 */

const TOKEN_PREFIX = 'better_map.';

const CAMERA_TOKENS = [
    'better_map.camera.lng',
    'better_map.camera.lat',
    'better_map.camera.zoom',
    'better_map.camera.pitch',
    'better_map.camera.bearing'
];

// v1.6 — time tokens for cross-panel scrubber coordination. When the
// scrubber-owning panel calls broadcastTime(t, isPlaying, speed) we
// publish into these three tokens. Subscriber panels can mirror by
// calling applyRemoteTime(scrubber, tokens).
const TIME_TOKENS = [
    'better_map.time.cursor_ms',
    'better_map.time.playing',
    'better_map.time.speed'
];

export function createCrossPanel(map, viz, options) {
    if (!map || !viz) return noop();
    const opts = options || {};
    if (opts.disabled) return noop();

    let lastBroadcast = 0;
    const minIntervalMs = typeof opts.minIntervalMs === 'number' ? opts.minIntervalMs : 250;

    function broadcastCamera() {
        const now = Date.now();
        if (now - lastBroadcast < minIntervalMs) return;
        // v1.7 — Tier 1 #2: if we just applied an inbound camera token
        // jump, suppress the outbound moveend echo for ~350ms. Without
        // this, a paired panel A → token → panel B → moveend → token →
        // panel A creates a permanent ping-pong every time the user
        // pans either map.
        if (instance && instance._suppressBroadcastUntilMs > now) return;
        lastBroadcast = now;
        const center = map.getCenter();
        const tokens = {
            'better_map.camera.lng': center.lng,
            'better_map.camera.lat': center.lat,
            'better_map.camera.zoom': map.getZoom(),
            'better_map.camera.pitch': map.getPitch(),
            'better_map.camera.bearing': map.getBearing()
        };
        publishTokens(viz, tokens);
    }

    function publishSelection(feature) {
        if (!feature) return;
        const props = feature.properties || {};
        publishTokens(viz, {
            'better_map.selected.id': props.id !== undefined ? props.id : feature.id,
            'better_map.selected.layer': props.layerName || null
        });
    }

    map.on('moveend', broadcastCamera);
    map.on('zoomend', broadcastCamera);
    map.on('pitchend', broadcastCamera);
    map.on('rotateend', broadcastCamera);

    // v1.6 — scrubber broadcast. The owning viz calls broadcastTime() on
    // every scrubber change tick. Subscribers receive via the dashboard
    // token model and replay via applyRemoteTime().
    let lastTimeBroadcast = 0;
    const minTimeIntervalMs = typeof opts.minTimeIntervalMs === 'number' ? opts.minTimeIntervalMs : 100;

    function broadcastTime(timeMs, playing, speed) {
        const now = Date.now();
        if (now - lastTimeBroadcast < minTimeIntervalMs) return;
        lastTimeBroadcast = now;
        publishTokens(viz, {
            'better_map.time.cursor_ms': Number.isFinite(timeMs) ? timeMs : null,
            'better_map.time.playing': !!playing,
            'better_map.time.speed': Number.isFinite(speed) ? speed : 1
        });
    }

    // v1.7 — Tier 1 #2: receive-side camera control.
    //
    // The dashboard publishes new lng/lat/zoom values into tokens
    // (typically `better_map.camera.lng/lat/zoom`) and the parent
    // visualization sees those values flow through config in
    // updateView. Rather than re-implementing the token-resolution
    // dance there, we expose a simple "given these numbers, move the
    // camera" path on the cross-panel instance.
    //
    // Suppression flags (_suppressBroadcastUntilMs) prevent the
    // resulting moveend events from immediately re-broadcasting the
    // same values and creating an echo loop with the sibling panel.
    function applyRemoteCameraFromObj(cam) {
        if (!cam || !Number.isFinite(cam.lng) || !Number.isFinite(cam.lat)) return;
        const cur = map.getCenter();
        const curZoom = map.getZoom();
        const dLng = Math.abs(cur.lng - cam.lng);
        const dLat = Math.abs(cur.lat - cam.lat);
        const dZoom = Number.isFinite(cam.zoom) ? Math.abs(curZoom - cam.zoom) : 0;
        // 1e-4 deg ~= 11 m at equator, dZoom < 0.05 = sub-zoom-level.
        // Anything tighter is a no-op flicker.
        if (dLng < 1e-4 && dLat < 1e-4 && dZoom < 0.05) return;
        // Suppress our own broadcast for the duration of this jump so
        // crossPanel.broadcastCamera() doesn't fire-and-create echo.
        instance._suppressBroadcastUntilMs = Date.now() + 350;
        const next = { center: [cam.lng, cam.lat] };
        if (Number.isFinite(cam.zoom)) next.zoom = cam.zoom;
        if (Number.isFinite(cam.pitch)) next.pitch = cam.pitch;
        if (Number.isFinite(cam.bearing)) next.bearing = cam.bearing;
        try { map.jumpTo(next); } catch (_e) { /* ignore */ }
    }

    var instance = {
        broadcastCamera: broadcastCamera,
        broadcastTime: broadcastTime,
        publishSelection: publishSelection,
        applyRemoteCamera: applyRemoteCameraFromObj,
        _suppressBroadcastUntilMs: 0,
        destroy: function () {
            map.off('moveend', broadcastCamera);
            map.off('zoomend', broadcastCamera);
            map.off('pitchend', broadcastCamera);
            map.off('rotateend', broadcastCamera);
        }
    };
    return instance;
}

/**
 * Apply remote tokens (typically set by another panel) onto this map's
 * camera. Pass in the dashboard tokens object as the caller saw it.
 */
export function applyRemoteCamera(map, tokens) {
    if (!map || !tokens) return;
    const lng = pickNumber(tokens, ['better_map.camera.lng']);
    const lat = pickNumber(tokens, ['better_map.camera.lat']);
    const zoom = pickNumber(tokens, ['better_map.camera.zoom']);
    const pitch = pickNumber(tokens, ['better_map.camera.pitch']);
    const bearing = pickNumber(tokens, ['better_map.camera.bearing']);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const next = { center: [lng, lat] };
    if (Number.isFinite(zoom)) next.zoom = zoom;
    if (Number.isFinite(pitch)) next.pitch = pitch;
    if (Number.isFinite(bearing)) next.bearing = bearing;
    try {
        map.jumpTo(next);
    } catch (_err) {
        // ignore
    }
}

export function tokenNames() {
    return CAMERA_TOKENS.slice();
}

export function timeTokenNames() {
    return TIME_TOKENS.slice();
}

export function tokenPrefix() {
    return TOKEN_PREFIX;
}

/**
 * v1.6 — apply incoming time tokens to a scrubber instance. The owning
 * scrubber (which broadcasts) MUST be filtered out by the caller (panel
 * id check) before calling this, otherwise the panels enter an echo
 * loop.
 *
 * @param {object} scrubber created via createScrubber()
 * @param {object} tokens dashboard token bag
 */
export function applyRemoteTime(scrubber, tokens) {
    if (!scrubber || !tokens) return;
    const t = pickNumber(tokens, ['better_map.time.cursor_ms']);
    const speed = pickNumber(tokens, ['better_map.time.speed']);
    const playingRaw = tokens['better_map.time.playing'];
    if (Number.isFinite(t) && typeof scrubber.setCurrent === 'function') {
        scrubber.setCurrent(t);
    }
    if (Number.isFinite(speed) && typeof scrubber.setSpeed === 'function') {
        scrubber.setSpeed(speed);
    }
    if (typeof scrubber.play === 'function' && typeof scrubber.pause === 'function') {
        if (playingRaw === true || playingRaw === 'true' || playingRaw === 1 || playingRaw === '1') {
            scrubber.play();
        } else if (playingRaw === false || playingRaw === 'false' || playingRaw === 0 || playingRaw === '0') {
            scrubber.pause();
        }
    }
}

// -----------------------------------------------------------------------
// Internals

function publishTokens(viz, tokens) {
    if (!viz) return;
    // Splunk's getDashboardEvents() is the preferred API in 10.x.
    let bus = null;
    try {
        if (typeof viz.getDashboardEvents === 'function') {
            bus = viz.getDashboardEvents();
        }
    } catch (_err) {
        bus = null;
    }
    if (bus && typeof bus.publish === 'function') {
        try {
            bus.publish({
                type: 'tokens.set',
                payload: tokens
            });
            return;
        } catch (_err) {
            // fall through to legacy
        }
    }
    // Legacy fallback: many older Splunk releases expose a publishEvent
    // method directly on the visualization base.
    if (typeof viz.publishEvent === 'function') {
        Object.keys(tokens).forEach(function (k) {
            try {
                viz.publishEvent({ type: 'token.set', payload: { name: k, value: tokens[k] } });
            } catch (_err) {
                // ignore
            }
        });
    }
}

function pickNumber(obj, keys) {
    for (let i = 0; i < keys.length; i++) {
        const v = obj[keys[i]];
        if (v === undefined || v === null) continue;
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (Number.isFinite(n)) return n;
    }
    return NaN;
}

function noop() {
    return {
        broadcastCamera: function () {},
        broadcastTime: function () {},
        publishSelection: function () {},
        destroy: function () {}
    };
}
