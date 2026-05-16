/*
 * Time scrubber widget.
 *
 * Floating bottom-bar that lets the user slide through the time range of
 * the data. Emits `change` events with the current timestamp (in
 * milliseconds since epoch). Play / pause / speed controls allow the
 * window to advance automatically.
 *
 * The scrubber is rendered as plain DOM (no React) so it stays AMD-safe
 * and works in the local test harness. It uses CSS classes defined in
 * visualization.css so theming is controlled externally.
 */

const CONTAINER_CLASS = 'better_map-scrubber';
const PLAY_CLASS = 'better_map-scrubber__play';
const RANGE_CLASS = 'better_map-scrubber__range';
const LABEL_CLASS = 'better_map-scrubber__label';
const SPEED_CLASS = 'better_map-scrubber__speed';
const REVERSE_CLASS = 'better_map-scrubber__reverse';
// v1.5.2 — BM-CT-1 reset affordances; CSS lives in visualization.css
// under "v1.5.2 — Time scrubber Reset buttons".
const RESET_CLASS = 'better_map-scrubber__reset';
// v1.6 — event markers and anomaly bands on the rail. The rail wrapper
// holds the <input range>, the event dots, and the anomaly bands as
// absolutely-positioned overlays so they all share the same x-axis.
const RAIL_CLASS = 'better_map-scrubber__rail';
const EVENT_CLASS = 'better_map-scrubber__event';
const ANOMALY_CLASS = 'better_map-scrubber__anomaly';

// v1.6 — speed levels including 16x; index 1 (= 1x) is the dashboard
// default. Reverse playback negates the multiplier in tick().
const SPEED_LEVELS = [0.5, 1, 2, 4, 8, 16];
const DEFAULT_SPEED_IDX = 1;

export function createScrubber(parentEl, options) {
    const opts = options || {};
    const onChange = opts.onChange || function () {};

    let min = numericTime(opts.min);
    let max = numericTime(opts.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        // Sane defaults so the widget renders something.
        const now = Date.now();
        min = now - 3600000;
        max = now;
    }
    let current = numericTime(opts.value);
    if (!Number.isFinite(current)) current = max;

    let speedIdx = DEFAULT_SPEED_IDX;
    let playing = false;
    let rafHandle = null;
    let lastTick = 0;
    // v1.6 — reverse playback. When true, tick() advances negatively.
    let reverse = false;
    // v1.6 — event markers and anomaly bands. Set via setEvents() /
    // setAnomalyBands(). { t (ms), color?, label? } per event; bands
    // are { fromMs, toMs, level }.
    let events = [];
    let anomalyBands = [];

    const root = document.createElement('div');
    root.className = CONTAINER_CLASS;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Time scrubber');

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = PLAY_CLASS;
    playBtn.setAttribute('aria-label', 'Play time animation');
    playBtn.textContent = '\u25B6';
    root.appendChild(playBtn);

    // v1.5.2 — BM-CT-1: "Jump to start" reset button. ⏮ Pauses playback
    // and snaps the cursor to the earliest timestamp in range.
    const resetStartBtn = document.createElement('button');
    resetStartBtn.type = 'button';
    resetStartBtn.className = RESET_CLASS;
    resetStartBtn.setAttribute('aria-label', 'Jump to start of time range');
    resetStartBtn.title = 'Jump to start';
    resetStartBtn.textContent = '\u23EE';
    root.appendChild(resetStartBtn);

    // v1.6 — rail wrapper holds the slider plus anomaly + event overlays.
    const rail = document.createElement('div');
    rail.className = RAIL_CLASS;
    root.appendChild(rail);

    const anomalyLayer = document.createElement('div');
    anomalyLayer.className = ANOMALY_CLASS + '-layer';
    rail.appendChild(anomalyLayer);

    const range = document.createElement('input');
    range.type = 'range';
    range.className = RANGE_CLASS;
    range.min = String(min);
    range.max = String(max);
    range.step = String(Math.max(1000, Math.round((max - min) / 200)));
    range.value = String(current);
    range.setAttribute('aria-label', 'Current time');
    rail.appendChild(range);

    const eventLayer = document.createElement('div');
    eventLayer.className = EVENT_CLASS + '-layer';
    rail.appendChild(eventLayer);

    // v1.5.2 — BM-CT-1: "Jump to end" reset button. ⏭ Pauses playback
    // and snaps the cursor to the latest timestamp in range — which
    // for live data sources is effectively "Reset to now".
    const resetEndBtn = document.createElement('button');
    resetEndBtn.type = 'button';
    resetEndBtn.className = RESET_CLASS;
    resetEndBtn.setAttribute('aria-label', 'Jump to end of time range');
    resetEndBtn.title = 'Jump to end (live)';
    resetEndBtn.textContent = '\u23ED';
    root.appendChild(resetEndBtn);

    const label = document.createElement('span');
    label.className = LABEL_CLASS;
    label.textContent = formatTimestamp(current);
    root.appendChild(label);

    const speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = SPEED_CLASS;
    speedBtn.textContent = SPEED_LEVELS[speedIdx] + 'x';
    speedBtn.setAttribute('aria-label', 'Playback speed');
    root.appendChild(speedBtn);

    // v1.6 — reverse-playback toggle. ⇄ flips direction without
    // changing speed; visually distinguishable via a CSS active class.
    const reverseBtn = document.createElement('button');
    reverseBtn.type = 'button';
    reverseBtn.className = REVERSE_CLASS;
    reverseBtn.textContent = '\u21BB';
    reverseBtn.setAttribute('aria-label', 'Toggle reverse playback');
    reverseBtn.setAttribute('aria-pressed', 'false');
    reverseBtn.title = 'Reverse playback';
    root.appendChild(reverseBtn);

    parentEl.appendChild(root);

    function tick(now) {
        if (!playing) return;
        if (!lastTick) lastTick = now;
        const dt = now - lastTick;
        lastTick = now;
        const speed = SPEED_LEVELS[speedIdx] * (reverse ? -1 : 1);
        // Advance proportional to total range so a play-through takes
        // ~20 seconds at 1x.
        const totalMs = max - min;
        const advanceMs = (totalMs / 20000) * dt * speed;
        let next = current + advanceMs;
        if (advanceMs >= 0 && next >= max) {
            next = min;
        } else if (advanceMs < 0 && next <= min) {
            next = max;
        }
        setCurrent(next, true);
        if (typeof requestAnimationFrame === 'function') {
            rafHandle = requestAnimationFrame(tick);
        }
    }

    function setCurrent(value, emit) {
        const v = clamp(value, min, max);
        if (Math.abs(v - current) < 0.5) return;
        current = v;
        range.value = String(Math.round(v));
        label.textContent = formatTimestamp(v);
        if (emit !== false) {
            onChange(current);
        }
    }

    function play() {
        if (playing) return;
        playing = true;
        playBtn.textContent = '\u275A\u275A';
        playBtn.setAttribute('aria-label', 'Pause time animation');
        lastTick = 0;
        if (typeof requestAnimationFrame === 'function') {
            rafHandle = requestAnimationFrame(tick);
        }
    }

    function pause() {
        if (!playing) return;
        playing = false;
        playBtn.textContent = '\u25B6';
        playBtn.setAttribute('aria-label', 'Play time animation');
        if (rafHandle && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(rafHandle);
        }
        rafHandle = null;
    }

    playBtn.addEventListener('click', function () {
        if (playing) pause();
        else play();
    });

    speedBtn.addEventListener('click', function () {
        speedIdx = (speedIdx + 1) % SPEED_LEVELS.length;
        speedBtn.textContent = SPEED_LEVELS[speedIdx] + 'x';
    });

    reverseBtn.addEventListener('click', function () {
        reverse = !reverse;
        reverseBtn.setAttribute('aria-pressed', reverse ? 'true' : 'false');
        reverseBtn.textContent = reverse ? '\u21BA' : '\u21BB';
        reverseBtn.classList.toggle(REVERSE_CLASS + '--on', reverse);
    });

    range.addEventListener('input', function () {
        const v = parseFloat(range.value);
        if (Number.isFinite(v)) {
            setCurrent(v, true);
        }
    });

    resetStartBtn.addEventListener('click', function () {
        // Pausing first is important: otherwise the next RAF tick would
        // immediately advance away from `min` and the user-visible
        // effect would be no jump at all.
        pause();
        setCurrent(min, true);
    });

    resetEndBtn.addEventListener('click', function () {
        pause();
        setCurrent(max, true);
    });

    function setRange(nextMin, nextMax) {
        min = numericTime(nextMin);
        max = numericTime(nextMax);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            return;
        }
        range.min = String(min);
        range.max = String(max);
        range.step = String(Math.max(1000, Math.round((max - min) / 200)));
        if (current < min || current > max) {
            setCurrent(max, true);
        } else {
            label.textContent = formatTimestamp(current);
        }
    }

    /**
     * v1.6 — set event markers rendered on the rail.
     *
     * @param {Array<{t:number,color?:string,label?:string,onClick?:Function}>} list
     */
    function setEvents(list) {
        events = (list || []).slice();
        renderEvents();
    }

    function renderEvents() {
        eventLayer.innerHTML = '';
        const totalMs = max - min;
        if (totalMs <= 0) return;
        events.forEach(function (ev) {
            const t = numericTime(ev.t);
            if (!Number.isFinite(t) || t < min || t > max) return;
            const pct = ((t - min) / totalMs) * 100;
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = EVENT_CLASS;
            dot.style.left = pct + '%';
            if (ev.color) dot.style.backgroundColor = ev.color;
            dot.title = (ev.label || '') + ' @ ' + formatTimestamp(t);
            dot.setAttribute('aria-label', dot.title);
            dot.addEventListener('click', function (e) {
                e.stopPropagation();
                setCurrent(t, true);
                if (typeof ev.onClick === 'function') {
                    try { ev.onClick(ev); } catch (_e) { /* swallow */ }
                }
            });
            eventLayer.appendChild(dot);
        });
    }

    /**
     * v1.6 — set anomaly bands rendered as translucent overlays.
     *
     * @param {Array<{fromMs:number,toMs:number,level?:string}>} list
     *        level is one of 'critical' | 'warning' | 'info' (defaults
     *        to 'warning'). The CSS class becomes
     *        better_map-scrubber__anomaly--<level>.
     */
    function setAnomalyBands(list) {
        anomalyBands = (list || []).slice();
        renderAnomalyBands();
    }

    function renderAnomalyBands() {
        anomalyLayer.innerHTML = '';
        const totalMs = max - min;
        if (totalMs <= 0) return;
        anomalyBands.forEach(function (band) {
            const a = numericTime(band.fromMs);
            const b = numericTime(band.toMs);
            if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
            const lo = Math.max(a, min);
            const hi = Math.min(b, max);
            if (hi <= lo) return;
            const div = document.createElement('div');
            div.className = ANOMALY_CLASS + ' ' + ANOMALY_CLASS + '--' + (band.level || 'warning');
            div.style.left = ((lo - min) / totalMs * 100) + '%';
            div.style.width = ((hi - lo) / totalMs * 100) + '%';
            if (band.label) div.title = band.label;
            anomalyLayer.appendChild(div);
        });
    }

    /**
     * v1.6 — programmatic reverse toggle (called from CommandPalette,
     * controlPanel, or dashboards). Idempotent.
     */
    function setReverse(on) {
        const next = !!on;
        if (reverse === next) return;
        reverse = next;
        reverseBtn.setAttribute('aria-pressed', reverse ? 'true' : 'false');
        reverseBtn.textContent = reverse ? '\u21BA' : '\u21BB';
        reverseBtn.classList.toggle(REVERSE_CLASS + '--on', reverse);
    }
    function isReverse() { return reverse; }

    /**
     * v1.6 — programmatic speed setter (called from CommandPalette
     * or crossPanel multi-scrub). Accepts either a multiplier value
     * (matched against SPEED_LEVELS) or an index.
     */
    function setSpeed(value) {
        let idx = -1;
        if (typeof value === 'number') {
            // Try as multiplier first.
            for (let i = 0; i < SPEED_LEVELS.length; i++) {
                if (SPEED_LEVELS[i] === value) { idx = i; break; }
            }
            if (idx < 0 && value >= 0 && value < SPEED_LEVELS.length) {
                idx = Math.floor(value);
            }
        }
        if (idx < 0) return;
        speedIdx = idx;
        speedBtn.textContent = SPEED_LEVELS[speedIdx] + 'x';
    }
    function getSpeed() { return SPEED_LEVELS[speedIdx]; }

    function destroy() {
        pause();
        if (root.parentNode) root.parentNode.removeChild(root);
    }

    /**
     * v1.5.2 — BM-CT-1 reset: snap the scrubber back to the dashboard
     * default state. Pauses playback, restores the default 1x speed,
     * and parks the cursor at the latest timestamp in range (which is
     * the most useful "neutral" position for live data).
     *
     * Re-uses the existing setCurrent() emit path so the parent shell
     * receives the same onChange notification it would for any user
     * scrub. Idempotent: calling reset() twice is harmless.
     */
    function reset() {
        pause();
        if (speedIdx !== DEFAULT_SPEED_IDX) {
            speedIdx = DEFAULT_SPEED_IDX;
            speedBtn.textContent = SPEED_LEVELS[speedIdx] + 'x';
        }
        if (reverse) {
            reverse = false;
            reverseBtn.setAttribute('aria-pressed', 'false');
            reverseBtn.textContent = '\u21BB';
            reverseBtn.classList.remove(REVERSE_CLASS + '--on');
        }
        events = [];
        anomalyBands = [];
        renderEvents();
        renderAnomalyBands();
        setCurrent(max, true);
    }

    // Also re-render rail overlays when the range itself changes
    // (e.g. user changes the dashboard time picker).
    const origSetRange = setRange;
    function setRangeAndRefresh(nextMin, nextMax) {
        origSetRange(nextMin, nextMax);
        renderEvents();
        renderAnomalyBands();
    }

    return {
        setRange: setRangeAndRefresh,
        setCurrent: function (v) { setCurrent(v, false); },
        getCurrent: function () { return current; },
        play: play,
        pause: pause,
        reset: reset,
        destroy: destroy,
        setEvents: setEvents,
        setAnomalyBands: setAnomalyBands,
        setReverse: setReverse,
        isReverse: isReverse,
        setSpeed: setSpeed,
        getSpeed: getSpeed
    };
}

function numericTime(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
}

function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

function formatTimestamp(ms) {
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getUTCFullYear();
    const mm = pad(d.getUTCMonth() + 1);
    const dd = pad(d.getUTCDate());
    const hh = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    const ss = pad(d.getUTCSeconds());
    return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi + ':' + ss + 'Z';
}

function pad(n) {
    return n < 10 ? '0' + n : '' + n;
}
