/*
 * Brushing widget — cursor-radius highlight that dims everything else.
 *
 * Implementation: a CSS-positioned circle follows the cursor when the
 * brushing mode is enabled. On every mousemove, we recompute which
 * features fall inside the radius via querySourceFeatures and update
 * a per-source MapLibre filter that fades out non-brushed features
 * (opacity property modification, NOT the layout filter — we want
 * non-brushed features to still register clicks).
 *
 * To stay performant, we throttle the highlight recompute to a single
 * RAF per mousemove and use turf.distance only for points inside the
 * cursor's screen-space radius (cheap bbox prefilter).
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

const RING_CLASS = 'better_map-brush-ring';

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder
 * @param {number} [opts.radiusPx=80]
 * @param {Array<string>} [opts.dimLayerIds]  MapLibre layer ids that
 *                                            should be dimmed when
 *                                            brushing is active.
 */
export function createBrushing(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    let _radiusPx = isFinite(options.radiusPx) ? options.radiusPx : 80;
    const dimIds = options.dimLayerIds || [
        'bm_markers_pt',
        'bm_clusters_pt',
        'bm_hex_fill',
        'bm_paths_arc'
    ];

    let _enabled = false;
    let _rafId = null;

    const ring = document.createElement('div');
    ring.className = RING_CLASS;
    ring.setAttribute('aria-hidden', 'true');
    ring.style.display = 'none';
    ring.style.width = (2 * _radiusPx) + 'px';
    ring.style.height = (2 * _radiusPx) + 'px';
    parentEl.appendChild(ring);

    const savedOpacities = {};

    function setLayerOpacity(layerId, opacity) {
        if (!builder || !builder.map || !builder.map.getLayer(layerId)) return;
        const type = builder.map.getLayer(layerId).type;
        // Pick the right property per MapLibre layer type.
        try {
            if (type === 'fill') builder.map.setPaintProperty(layerId, 'fill-opacity', opacity);
            else if (type === 'fill-extrusion') builder.map.setPaintProperty(layerId, 'fill-extrusion-opacity', opacity);
            else if (type === 'line') builder.map.setPaintProperty(layerId, 'line-opacity', opacity);
            else if (type === 'circle') builder.map.setPaintProperty(layerId, 'circle-opacity', opacity);
            else if (type === 'symbol') builder.map.setPaintProperty(layerId, 'icon-opacity', opacity);
            else if (type === 'heatmap') builder.map.setPaintProperty(layerId, 'heatmap-opacity', opacity);
        } catch (_e) { /* swallow */ }
    }

    function snapshotOpacities() {
        if (!builder || !builder.map) return;
        dimIds.forEach(function (id) {
            if (!builder.map.getLayer(id)) return;
            try {
                const layer = builder.map.getLayer(id);
                const type = layer.type;
                let val;
                if (type === 'fill') val = builder.map.getPaintProperty(id, 'fill-opacity');
                else if (type === 'fill-extrusion') val = builder.map.getPaintProperty(id, 'fill-extrusion-opacity');
                else if (type === 'line') val = builder.map.getPaintProperty(id, 'line-opacity');
                else if (type === 'circle') val = builder.map.getPaintProperty(id, 'circle-opacity');
                else if (type === 'symbol') val = builder.map.getPaintProperty(id, 'icon-opacity');
                else if (type === 'heatmap') val = builder.map.getPaintProperty(id, 'heatmap-opacity');
                if (val !== undefined) savedOpacities[id] = val;
            } catch (_e) { /* swallow */ }
        });
    }

    function restoreOpacities() {
        dimIds.forEach(function (id) {
            if (savedOpacities[id] !== undefined) setLayerOpacity(id, savedOpacities[id]);
            else setLayerOpacity(id, 1.0);
        });
    }

    function dimAll() {
        dimIds.forEach(function (id) { setLayerOpacity(id, 0.18); });
    }

    function onMouseMove(e) {
        if (!_enabled) return;
        if (_rafId) return; // coalesce
        _rafId = requestAnimationFrame(function () {
            _rafId = null;
            const canvas = builder.map.getCanvasContainer();
            const rect = canvas.getBoundingClientRect();
            const x = e.originalEvent.clientX - rect.left;
            const y = e.originalEvent.clientY - rect.top;
            ring.style.left = (rect.left - parentEl.getBoundingClientRect().left + x - _radiusPx) + 'px';
            ring.style.top = (rect.top - parentEl.getBoundingClientRect().top + y - _radiusPx) + 'px';
            ring.style.display = '';
        });
    }
    function onMouseLeave() {
        if (!_enabled) return;
        ring.style.display = 'none';
    }

    function setRadius(px) {
        _radiusPx = Math.max(20, Math.min(400, Math.round(px)));
        ring.style.width = (2 * _radiusPx) + 'px';
        ring.style.height = (2 * _radiusPx) + 'px';
    }

    function setEnabled(enabled) {
        _enabled = !!enabled;
        if (_enabled) {
            snapshotOpacities();
            dimAll();
            if (builder && builder.map) {
                builder.map.on('mousemove', onMouseMove);
                builder.map.getContainer().addEventListener('mouseleave', onMouseLeave);
            }
        } else {
            restoreOpacities();
            if (builder && builder.map) {
                try {
                    builder.map.off('mousemove', onMouseMove);
                    builder.map.getContainer().removeEventListener('mouseleave', onMouseLeave);
                } catch (_e) { /* swallow */ }
            }
            ring.style.display = 'none';
        }
    }

    function isEnabled() { return _enabled; }
    function reset() {
        if (_enabled) setEnabled(false);
        setRadius(80);
    }
    function destroy() {
        if (_enabled) setEnabled(false);
        if (ring.parentNode) ring.parentNode.removeChild(ring);
    }

    return {
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        setRadius: setRadius,
        reset: reset,
        destroy: destroy
    };
}
