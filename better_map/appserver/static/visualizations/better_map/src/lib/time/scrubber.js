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

const SPEED_LEVELS = [0.5, 1, 2, 4, 8];

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

    let speedIdx = 1;
    let playing = false;
    let rafHandle = null;
    let lastTick = 0;

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

    const range = document.createElement('input');
    range.type = 'range';
    range.className = RANGE_CLASS;
    range.min = String(min);
    range.max = String(max);
    range.step = String(Math.max(1000, Math.round((max - min) / 200)));
    range.value = String(current);
    range.setAttribute('aria-label', 'Current time');
    root.appendChild(range);

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

    parentEl.appendChild(root);

    function tick(now) {
        if (!playing) return;
        if (!lastTick) lastTick = now;
        const dt = now - lastTick;
        lastTick = now;
        const speed = SPEED_LEVELS[speedIdx];
        // Advance proportional to total range so a play-through takes
        // ~20 seconds at 1x.
        const totalMs = max - min;
        const advanceMs = (totalMs / 20000) * dt * speed;
        let next = current + advanceMs;
        if (next >= max) {
            next = min;
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

    range.addEventListener('input', function () {
        const v = parseFloat(range.value);
        if (Number.isFinite(v)) {
            setCurrent(v, true);
        }
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

    function destroy() {
        pause();
        if (root.parentNode) root.parentNode.removeChild(root);
    }

    return {
        setRange: setRange,
        setCurrent: function (v) { setCurrent(v, false); },
        getCurrent: function () { return current; },
        play: play,
        pause: pause,
        destroy: destroy
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
