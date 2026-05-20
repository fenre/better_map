/*
 * Drilldown wiring.
 *
 * Splunk's custom visualization base supports two drilldown payload kinds:
 *
 *   - FIELD_VALUE_DRILLDOWN: emit a field/value list; Dashboard Studio
 *     uses that to populate `row.fields.<name>` and `row.values.<name>`
 *     tokens that flow into other panels and links.
 *   - ROW_VALUE_DRILLDOWN:   emit one row's worth of fields and values.
 *
 * Better Map uses FIELD_VALUE_DRILLDOWN by default because spatial
 * features sometimes synthesise their geometry from multiple rows (e.g.
 * the paths layer materialises one LineString from many rows). We mirror
 * each feature's properties bag back to the visualization base, which
 * then proxies it to the dashboard.
 *
 * Important: Splunk's SplunkVisualizationBase exposes drilldownAction(),
 * not the underlying ROW/FIELD_VALUE_DRILLDOWN constants we know from
 * older releases; we still emit the standard payload shape and rely on
 * the base class to translate.
 *
 * v1.7 — added three new behaviours that the dashboard surface depends on:
 *   1. Hover preview popup (`enableHoverPreview` + `hoverHtmlField`)
 *      — a separate, dismissable-on-leave popup that reads a different
 *        row field than the click popup. Keeps the click popup as the
 *        "rich" view and the hover popup as the "what is this dot"
 *        glance view. NOC walls have no mouse; everywhere else benefits.
 *   2. featureDeselected event on empty-canvas click — fires a regular
 *      drilldown payload with `data._trigger='featureDeselected'` so
 *      the dashboard's drilldown handler can branch on it and reset
 *      tokens to '*' / wildcard.
 *   3. closePopupOnDrilldown — when a marker click is configured to
 *      drilldown AND closePopupOnDrilldown is true, we suppress the
 *      popup flash that happens before the drilldown's setToken
 *      re-renders the map. Default false to keep existing behaviour.
 *   4. popupAllowInlineStyles — forwarded to the sanitizer so dashboard
 *      authors can colour the severity number inline. Default false.
 */

import maplibregl from 'maplibre-gl';
import { sanitizePopup } from './popupSanitizer.js';

const CLICKABLE_LAYER_PREFIXES = [
    'better_map_markers_',
    'better_map_clusters_',
    'better_map_paths_',
    'better_map_polygons_',
    'better_map_choropleth_',
    'better_map_hexbin_',
    'better_map_extrusion'
];

// Hover popup is rate-limited so we don't rebuild the DOM on every
// mousemove pixel. 60ms = ~16 fps which feels instant while keeping
// queryRenderedFeatures + setHTML under a 16ms budget even on
// laptop-tier hardware.
const HOVER_THROTTLE_MS = 60;

export function attachDrilldown(map, viz, options) {
    if (!map || !viz) return null;
    const opts = options || {};
    const enablePopups = opts.enablePopups !== false;
    // v1.7 — new options. All default OFF for backwards compatibility.
    const popupAllowInlineStyles = !!opts.popupAllowInlineStyles;
    const enableHoverPreview = !!opts.enableHoverPreview;
    const hoverHtmlField = typeof opts.hoverHtmlField === 'string' && opts.hoverHtmlField
        ? opts.hoverHtmlField
        : 'hover';
    const closePopupOnDrilldown = !!opts.closePopupOnDrilldown;

    // Sanitizer options bag, captured once so we don't allocate on
    // every popup. The flag-only shape lets sanitizePopup() short-
    // circuit the per-call ALLOWED_ATTR rebuild when the default
    // (no inline styles) is in effect.
    const sanitizerOpts = popupAllowInlineStyles
        ? { allowInlineStyles: true }
        : undefined;

    let activePopup = null;   // click popup
    let hoverPopup = null;    // hover preview popup (separate instance)
    let hoverLastFeatureId = null;
    let hoverLastTickMs = 0;
    let lastFeatureSelectedId = null; // bookkeeping for featureDeselected

    function showPopup(coords, html, isHtml) {
        if (!enablePopups || !html) return;
        if (activePopup) {
            try { activePopup.remove(); } catch (_err) { /* ignore */ }
            activePopup = null;
        }
        activePopup = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '320px',
            className: 'better_map-popup-wrapper'
        });
        // Even when isHtml is false, treat the value as text by HTML-escaping
        // via the sanitizer (which returns "" for non-strings and strips all
        // tags from non-HTML content because we passed it through allow-list).
        const safe = isHtml
            ? sanitizePopup(html, sanitizerOpts)
            : sanitizePopup(escapeHtml(html), sanitizerOpts);
        activePopup.setLngLat(coords).setHTML(safe).addTo(map);
    }

    /*
     * Hover preview popup. Distinct from the click popup so:
     *   - hover content can be a smaller "name + status" string
     *   - the click popup isn't dismissed when the cursor moves
     *   - mouseleave removes ONLY the hover popup (click popup stays)
     */
    function showHoverPopup(coords, html) {
        if (!enableHoverPreview || !html) return;
        if (!hoverPopup) {
            hoverPopup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                closeOnMove: false,
                maxWidth: '240px',
                offset: 12,
                className: 'better_map-popup-wrapper better_map-hover-popup'
            });
        }
        const safe = sanitizePopup(html, sanitizerOpts);
        hoverPopup.setLngLat(coords).setHTML(safe).addTo(map);
    }

    function clearHoverPopup() {
        if (hoverPopup) {
            try { hoverPopup.remove(); } catch (_err) { /* ignore */ }
            hoverLastFeatureId = null;
        }
    }

    function clickableLayers() {
        const out = [];
        if (!map.getStyle) return out;
        const style = map.getStyle();
        const layers = (style && style.layers) || [];
        for (let i = 0; i < layers.length; i++) {
            const id = layers[i].id;
            for (let j = 0; j < CLICKABLE_LAYER_PREFIXES.length; j++) {
                if (id.indexOf(CLICKABLE_LAYER_PREFIXES[j]) === 0) {
                    out.push(id);
                    break;
                }
            }
        }
        return out;
    }

    function onFeatureClick(evt) {
        const layers = clickableLayers();
        if (!layers.length) return;
        const features = map.queryRenderedFeatures(evt.point, { layers: layers });
        if (!features || !features.length) {
            // v1.7 — Tier 2 #4: empty-canvas click fires featureDeselected.
            // Only emit when the previous click was a feature selection
            // (lastFeatureSelectedId set) — otherwise repeated ocean
            // clicks would generate a storm of identical resets.
            if (lastFeatureSelectedId !== null) {
                lastFeatureSelectedId = null;
                try {
                    viz.drilldown({
                        action: 'fieldValue',
                        data: { _trigger: 'featureDeselected' }
                    }, evt.originalEvent || evt);
                } catch (err) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('[better_map] deselect drilldown failed:', err);
                    }
                }
            }
            return;
        }
        const feature = features[0];

        // Skip cluster aggregates - the clusters layer handles those clicks.
        const props = feature.properties || {};
        if (props.cluster_id !== undefined || props.point_count !== undefined) {
            return;
        }

        // Track the selection id (best-effort: prefer `id`, then any
        // other common identifier) for the next featureDeselected
        // comparison. The dashboard's selection token is the
        // authoritative source — this is only to suppress redundant
        // deselect emits.
        lastFeatureSelectedId = props.id || props.name || props.tooltip || true;

        // Suppress the popup if the dashboard wants drilldown to be
        // the sole interaction. Without this flag the popup briefly
        // flashes before the setToken re-renders the map. With the
        // flag, click is silent until the dashboard reacts.
        const skipPopup = closePopupOnDrilldown;

        // Show popup if the feature carries one and we're not suppressing.
        if (!skipPopup && props.popup) {
            const coords = pickPopupCoord(feature, evt);
            if (coords) {
                showPopup(coords, props.popup, true);
            }
        }

        const payload = buildDrilldownPayload(feature, opts);
        if (!payload) return;
        // Tag with the trigger name so dashboards can branch handlers
        // between feature-selected and feature-deselected events.
        payload.data._trigger = 'featureSelected';
        try {
            viz.drilldown(payload, evt.originalEvent || evt);
        } catch (err) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[better_map] drilldown failed:', err);
            }
        }
    }

    function onPointerMove(evt) {
        const layers = clickableLayers();
        if (!layers.length) {
            map.getCanvas().style.cursor = '';
            clearHoverPopup();
            return;
        }
        const features = map.queryRenderedFeatures(evt.point, { layers: layers });
        if (features && features.length) {
            map.getCanvas().style.cursor = 'pointer';
            // Hover preview path (Tier 2 #5). Throttled, and only
            // reacts when the underlying feature actually changes —
            // moving the cursor across the same dot must not rebuild
            // the popup.
            if (enableHoverPreview) {
                const now = (typeof performance !== 'undefined' && performance.now)
                    ? performance.now()
                    : Date.now();
                if (now - hoverLastTickMs < HOVER_THROTTLE_MS) {
                    return;
                }
                hoverLastTickMs = now;
                const f = features[0];
                const fProps = f.properties || {};
                if (fProps.cluster_id !== undefined || fProps.point_count !== undefined) {
                    clearHoverPopup();
                    return;
                }
                const fid = fProps.id || fProps.name || fProps.tooltip ||
                    JSON.stringify(f.geometry || {});
                if (fid === hoverLastFeatureId) return;
                hoverLastFeatureId = fid;
                const html = fProps[hoverHtmlField];
                if (html) {
                    const coords = pickPopupCoord(f, evt);
                    if (coords) showHoverPopup(coords, html);
                } else {
                    clearHoverPopup();
                }
            }
        } else {
            map.getCanvas().style.cursor = '';
            if (enableHoverPreview) clearHoverPopup();
        }
    }

    map.on('click', onFeatureClick);
    map.on('mousemove', onPointerMove);
    map.on('mouseout', function () {
        map.getCanvas().style.cursor = '';
        clearHoverPopup();
    });

    return function detach() {
        map.off('click', onFeatureClick);
        map.off('mousemove', onPointerMove);
        if (activePopup) {
            try { activePopup.remove(); } catch (_err) { /* ignore */ }
            activePopup = null;
        }
        if (hoverPopup) {
            try { hoverPopup.remove(); } catch (_err) { /* ignore */ }
            hoverPopup = null;
        }
    };
}

function pickPopupCoord(feature, evt) {
    if (!feature) return null;
    const g = feature.geometry;
    if (g && g.type === 'Point' && Array.isArray(g.coordinates)) {
        return g.coordinates.slice();
    }
    if (evt && evt.lngLat) {
        return [evt.lngLat.lng, evt.lngLat.lat];
    }
    return null;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildDrilldownPayload(feature, opts) {
    if (!feature) return null;
    const options = opts || {};
    const props = feature.properties || {};

    // Skip cluster aggregates - clicks on those zoom in (handled by the
    // clusters layer itself).
    if (props.cluster_id !== undefined || props.point_count !== undefined) {
        return null;
    }

    const action = 'fieldValue';
    const data = {};
    const fields = options.fields || Object.keys(props);
    for (let i = 0; i < fields.length; i++) {
        const k = fields[i];
        if (k in props) {
            data[k] = props[k];
        }
    }

    // Always surface a few canonical fields for cross-panel handoff.
    if (feature.geometry && feature.geometry.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
        data.lon = feature.geometry.coordinates[0];
        data.lat = feature.geometry.coordinates[1];
    }

    return {
        action: action,
        data: data
    };
}
