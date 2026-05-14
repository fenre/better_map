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

export function attachDrilldown(map, viz, options) {
    if (!map || !viz) return null;
    const opts = options || {};
    const enablePopups = opts.enablePopups !== false;
    let activePopup = null;

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
        const safe = isHtml ? sanitizePopup(html) : sanitizePopup(escapeHtml(html));
        activePopup.setLngLat(coords).setHTML(safe).addTo(map);
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
        if (!features || !features.length) return;
        const feature = features[0];

        // Skip cluster aggregates - the clusters layer handles those clicks.
        const props = feature.properties || {};
        if (props.cluster_id !== undefined || props.point_count !== undefined) {
            return;
        }

        // Show popup if the feature carries one.
        if (props.popup) {
            const coords = pickPopupCoord(feature, evt);
            if (coords) {
                showPopup(coords, props.popup, true);
            }
        }

        const payload = buildDrilldownPayload(feature, opts);
        if (!payload) return;
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
        if (!layers.length) return;
        const features = map.queryRenderedFeatures(evt.point, { layers: layers });
        if (features && features.length) {
            map.getCanvas().style.cursor = 'pointer';
        } else {
            map.getCanvas().style.cursor = '';
        }
    }

    map.on('click', onFeatureClick);
    map.on('mousemove', onPointerMove);
    map.on('mouseout', function () {
        map.getCanvas().style.cursor = '';
    });

    return function detach() {
        map.off('click', onFeatureClick);
        map.off('mousemove', onPointerMove);
        if (activePopup) {
            try { activePopup.remove(); } catch (_err) { /* ignore */ }
            activePopup = null;
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
