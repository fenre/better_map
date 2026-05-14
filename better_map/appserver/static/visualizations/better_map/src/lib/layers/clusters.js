/*
 * Clusters layer.
 *
 * Uses MapLibre's built-in clustering (cluster: true on the source) instead
 * of a separate supercluster instance, so we get GPU-accelerated rendering
 * for free. The supercluster dependency is still listed for Phase 3 when we
 * add spiderfy support at the max zoom level.
 *
 * The shape: faded outer halo + filled inner disc + numeric count label.
 * Click on a cluster zooms to the cluster's expansion zoom.
 */

import { SET3 } from '../palettes.js';

export const SOURCE_ID = 'better_map_clusters_src';
export const LAYER_HALO = 'better_map_clusters_halo';
export const LAYER_DOT = 'better_map_clusters_dot';
export const LAYER_COUNT = 'better_map_clusters_count';
export const LAYER_UNCLUSTERED = 'better_map_clusters_uncluster';

const PRIMARY = SET3[0];

export function mount(map, opts) {
    const options = opts || {};
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: typeof options.clusterMaxZoom === 'number' ? options.clusterMaxZoom : 14,
            clusterRadius: typeof options.clusterRadius === 'number' ? options.clusterRadius : 48
        });
    }

    if (!map.getLayer(LAYER_HALO)) {
        map.addLayer({
            id: LAYER_HALO,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': options.color || PRIMARY,
                'circle-opacity': 0.18,
                'circle-radius': [
                    'step',
                    ['get', 'point_count'],
                    18,
                    25,
                    24,
                    100,
                    32,
                    500,
                    44
                ]
            }
        });
    }

    if (!map.getLayer(LAYER_DOT)) {
        map.addLayer({
            id: LAYER_DOT,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': options.color || PRIMARY,
                'circle-opacity': 0.92,
                'circle-stroke-color': options.outline || '#0b1a2d',
                'circle-stroke-width': 1.5,
                'circle-radius': [
                    'step',
                    ['get', 'point_count'],
                    14,
                    25,
                    18,
                    100,
                    24,
                    500,
                    32
                ]
            }
        });
    }

    if (!map.getLayer(LAYER_COUNT)) {
        map.addLayer({
            id: LAYER_COUNT,
            type: 'symbol',
            source: SOURCE_ID,
            filter: ['has', 'point_count'],
            layout: {
                'text-field': '{point_count_abbreviated}',
                'text-size': 12,
                'text-font': ['Noto Sans Regular']
            },
            paint: {
                'text-color': '#0b1a2d',
                'text-halo-color': options.color || PRIMARY,
                'text-halo-width': 1.5
            }
        });
    }

    if (!map.getLayer(LAYER_UNCLUSTERED)) {
        map.addLayer({
            id: LAYER_UNCLUSTERED,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': ['coalesce', ['get', 'color'], options.color || PRIMARY],
                'circle-radius': 6,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': options.outline || '#0b1a2d'
            }
        });
    }

    if (!map._better_map_cluster_click_bound_) {
        map._better_map_cluster_click_bound_ = true;
        map.on('click', LAYER_DOT, function (evt) {
            const features = map.queryRenderedFeatures(evt.point, { layers: [LAYER_DOT] });
            if (!features || !features.length) return;
            const clusterId = features[0].properties.cluster_id;
            const src = map.getSource(SOURCE_ID);
            if (!src || !src.getClusterExpansionZoom) return;
            src.getClusterExpansionZoom(clusterId, function (err, zoom) {
                if (err) return;
                map.easeTo({
                    center: features[0].geometry.coordinates,
                    zoom: zoom + 0.1,
                    duration: 400
                });
            });
        });
        map.on('mouseenter', LAYER_DOT, function () {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', LAYER_DOT, function () {
            map.getCanvas().style.cursor = '';
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
    [LAYER_COUNT, LAYER_DOT, LAYER_HALO, LAYER_UNCLUSTERED].forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    map._better_map_cluster_click_bound_ = false;
}

export function setVisible(map, visible) {
    [LAYER_HALO, LAYER_DOT, LAYER_COUNT, LAYER_UNCLUSTERED].forEach(function (id) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}
