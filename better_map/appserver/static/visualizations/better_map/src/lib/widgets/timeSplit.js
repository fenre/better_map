/*
 * Time-window split view widget.
 *
 * Compares two time windows of the SAME data side-by-side with one
 * shared camera. The user defines a primary window (the dashboard's
 * current time range) and a "compare to" offset (e.g. T-1h, T-24h,
 * T-7d). Both windows render in MapLibre filter expressions so the
 * source data is loaded once and split client-side by the `_time`
 * property of each feature.
 *
 * The widget produces a vertical divider on the map identical in look
 * to sideBySide.js, but instead of clipping two basemaps it clips the
 * SAME data layer filtered by _time into "before divider" and "after
 * divider" subsets. Layer ids:
 *
 *   <layerId>__tsplit_before  filtered to past window
 *   <layerId>__tsplit_after   filtered to current window
 *
 * The original <layerId> is hidden while the split is active and
 * restored on disable / reset (BM-CT-1).
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

const ROOT_CLASS = 'better_map-tsplit';
const HANDLE_CLASS = 'better_map-tsplit__handle';
const LABEL_CLASS = 'better_map-tsplit__label';

const DEFAULT_OFFSETS_MS = [
    { id: '1h', label: 'T-1h', ms: 3600 * 1000 },
    { id: '24h', label: 'T-24h', ms: 24 * 3600 * 1000 },
    { id: '7d', label: 'T-7d', ms: 7 * 24 * 3600 * 1000 }
];

export function createTimeSplit(container, map, options) {
    if (!container || !map) return noop();
    const opts = options || {};
    const layerIds = (opts.layerIds || []).slice();
    const timeField = opts.timeField || '_time';
    const offsets = (opts.offsets || DEFAULT_OFFSETS_MS).slice();
    const defaultPositionPct = clamp(Number(opts.position) || 50, 5, 95);
    const defaultOffset = offsets[0];

    let position = defaultPositionPct;
    let currentOffsetMs = defaultOffset ? defaultOffset.ms : 3600 * 1000;
    let cursorMs = Number(opts.cursorMs) || Date.now();
    let mounted = false;
    let enabled = true;
    let originalVisibility = {};
    let splitLayerIds = [];

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.style.left = position + '%';

    const handle = document.createElement('div');
    handle.className = HANDLE_CLASS;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Time window divider');
    root.appendChild(handle);

    const labelLeft = document.createElement('div');
    labelLeft.className = LABEL_CLASS + ' ' + LABEL_CLASS + '--left';
    labelLeft.textContent = defaultOffset ? defaultOffset.label : 'Past';
    root.appendChild(labelLeft);

    const labelRight = document.createElement('div');
    labelRight.className = LABEL_CLASS + ' ' + LABEL_CLASS + '--right';
    labelRight.textContent = 'Now';
    root.appendChild(labelRight);

    function mount() {
        if (mounted) return;
        container.appendChild(root);
        mounted = true;
        bindDrag();
        materialiseSplitLayers();
    }

    function unmount() {
        if (!mounted) return;
        unbindDrag();
        restoreOriginalLayers();
        if (root.parentNode) root.parentNode.removeChild(root);
        mounted = false;
    }

    function materialiseSplitLayers() {
        if (!enabled) return;
        layerIds.forEach(function (id) {
            try {
                const lyr = map.getLayer(id);
                if (!lyr) return;
                const vis = map.getLayoutProperty(id, 'visibility');
                originalVisibility[id] = vis || 'visible';
                map.setLayoutProperty(id, 'visibility', 'none');
                cloneLayerWithTimeFilter(id, true);
                cloneLayerWithTimeFilter(id, false);
            } catch (_e) {
                // swallow
            }
        });
    }

    function cloneLayerWithTimeFilter(srcId, isPast) {
        const suffix = isPast ? '__tsplit_before' : '__tsplit_after';
        const cloneId = srcId + suffix;
        if (map.getLayer(cloneId)) return;
        const src = map.getStyle().layers.find(function (l) { return l.id === srcId; });
        if (!src) return;
        const clone = JSON.parse(JSON.stringify(src));
        clone.id = cloneId;
        const baseFilter = src.filter || ['all'];
        const earliest = cursorMs - currentOffsetMs - 60 * 1000;
        const latest = cursorMs - currentOffsetMs + 60 * 1000;
        const timeFilter = isPast
            ? ['all',
                ['>=', ['to-number', ['get', timeField]], earliest],
                ['<=', ['to-number', ['get', timeField]], latest]]
            : ['>=', ['to-number', ['get', timeField]], cursorMs - 60 * 1000];
        clone.filter = ['all', baseFilter, timeFilter];
        try {
            map.addLayer(clone);
            splitLayerIds.push(cloneId);
        } catch (_e) {
            // swallow
        }
    }

    function restoreOriginalLayers() {
        splitLayerIds.forEach(function (id) {
            if (map.getLayer(id)) {
                try { map.removeLayer(id); } catch (_e) { /* swallow */ }
            }
        });
        splitLayerIds = [];
        Object.keys(originalVisibility).forEach(function (id) {
            if (map.getLayer(id)) {
                try { map.setLayoutProperty(id, 'visibility', originalVisibility[id]); } catch (_e) { /* swallow */ }
            }
        });
        originalVisibility = {};
    }

    let dragging = false;
    function onDown(ev) { dragging = true; ev.preventDefault && ev.preventDefault(); }
    function onUp() { dragging = false; }
    function onMove(ev) {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const pct = ((x - rect.left) / rect.width) * 100;
        position = clamp(pct, 5, 95);
        root.style.left = position + '%';
    }

    function bindDrag() {
        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('touchstart', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
    }
    function unbindDrag() {
        handle.removeEventListener('mousedown', onDown);
        handle.removeEventListener('touchstart', onDown);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
    }

    function setCursor(ms) {
        cursorMs = Number(ms) || cursorMs;
        if (enabled && mounted) {
            restoreOriginalLayers();
            materialiseSplitLayers();
        }
    }

    function setOffset(offsetMs, label) {
        currentOffsetMs = Number(offsetMs) || currentOffsetMs;
        if (label) labelLeft.textContent = label;
        if (enabled && mounted) {
            restoreOriginalLayers();
            materialiseSplitLayers();
        }
    }

    function setEnabled(on) {
        enabled = !!on;
        if (enabled) mount();
        else unmount();
    }

    function reset() {
        position = defaultPositionPct;
        root.style.left = position + '%';
        currentOffsetMs = defaultOffset ? defaultOffset.ms : 3600 * 1000;
        labelLeft.textContent = defaultOffset ? defaultOffset.label : 'Past';
    }

    mount();
    return {
        setEnabled: setEnabled,
        isEnabled: function () { return enabled; },
        reset: reset,
        setCursor: setCursor,
        setOffset: setOffset,
        destroy: unmount
    };
}

function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

function noop() {
    return {
        setEnabled: function () {},
        isEnabled: function () { return false; },
        reset: function () {},
        setCursor: function () {},
        setOffset: function () {},
        destroy: function () {}
    };
}
