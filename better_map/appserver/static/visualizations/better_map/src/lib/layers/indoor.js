/*
 * Indoor / image-overlay layer.
 *
 * Drops a georeferenced raster (typically a floorplan PNG/JPG) onto the
 * map using MapLibre's "image" source type. The coordinates quad maps
 * the image corners to lng/lat positions:
 *
 *   coordinates: [
 *     [top_left_lng,    top_left_lat],
 *     [top_right_lng,   top_right_lat],
 *     [bottom_right_lng, bottom_right_lat],
 *     [bottom_left_lng, bottom_left_lat]
 *   ]
 *
 * If the data contains a `floor` field, each unique value can supply its
 * own image + coordinates pair; a small floor switcher widget allows the
 * user to switch floors at runtime. The layer dispatcher feeds it the
 * tabular feature collection so the switcher can mirror the data without
 * needing geometry.
 *
 * Configuration shape (`opts`):
 *   {
 *     enabled: true,
 *     defaultFloor: 'L1',
 *     floors: {
 *       L1: { image: '...', coordinates: [[..],[..],[..],[..]] },
 *       L2: { image: '...', coordinates: [...] }
 *     },
 *     // OR a single floor short-hand:
 *     image: '...', coordinates: [...]
 *   }
 */

import { isSafeHttpsImage, isSafeDataImage } from '../popupSanitizer.js';

export const SOURCE_ID = 'better_map_indoor_src';
export const LAYER_RASTER = 'better_map_indoor';

const STATE_PROP = '_better_map_indoor_state_';
const SWITCHER_CLASS = 'better_map-floor-switcher';
const SWITCHER_BUTTON_CLASS = 'better_map-floor-switcher__btn';

function isSafeFloorImage(url) {
    return isSafeHttpsImage(url) || isSafeDataImage(url);
}

export function mount(map, opts) {
    const options = opts || {};
    const floors = normalizeFloors(options);
    if (!floors.length) {
        return;
    }
    const activeFloorId = options.defaultFloor || floors[0].id;
    const active = floors.find(function (f) { return f.id === activeFloorId; }) || floors[0];

    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'image',
            url: active.image,
            coordinates: active.coordinates
        });
    }

    if (!map.getLayer(LAYER_RASTER)) {
        map.addLayer({
            id: LAYER_RASTER,
            type: 'raster',
            source: SOURCE_ID,
            paint: {
                'raster-opacity': typeof options.opacity === 'number' ? options.opacity : 0.95,
                'raster-fade-duration': 200
            }
        });
    }

    map[STATE_PROP] = map[STATE_PROP] || {};
    map[STATE_PROP].floors = floors;
    map[STATE_PROP].active = active.id;

    ensureSwitcher(map, floors, active.id);
}

export function update(map, fc, opts) {
    if (!map) return;
    const options = opts || {};
    const observed = collectFloorIdsFromFeatures(fc);
    const explicitFloors = normalizeFloors(options);
    if (observed.length && options.floors) {
        // When the SPL supplies floor IDs that match the configured floors,
        // ensure the switcher is rendered for those (in observed order).
        const seen = {};
        explicitFloors.sort(function (a, b) {
            seen[a.id] = observed.indexOf(a.id);
            seen[b.id] = observed.indexOf(b.id);
            const ai = seen[a.id] === -1 ? Infinity : seen[a.id];
            const bi = seen[b.id] === -1 ? Infinity : seen[b.id];
            return ai - bi;
        });
        if (map[STATE_PROP]) {
            map[STATE_PROP].floors = explicitFloors;
            ensureSwitcher(map, explicitFloors, map[STATE_PROP].active);
        }
    }
}

export function unmount(map) {
    if (!map) return;
    if (map.getLayer(LAYER_RASTER)) map.removeLayer(LAYER_RASTER);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    removeSwitcher(map);
    delete map[STATE_PROP];
}

export function setVisible(map, visible) {
    if (map.getLayer(LAYER_RASTER)) {
        map.setLayoutProperty(LAYER_RASTER, 'visibility', visible ? 'visible' : 'none');
    }
}

// -----------------------------------------------------------------------
// Internals

function normalizeFloors(options) {
    if (options.floors && typeof options.floors === 'object') {
        return Object.keys(options.floors).map(function (id) {
            const cfg = options.floors[id] || {};
            return {
                id: id,
                image: cfg.image,
                coordinates: cfg.coordinates,
                label: cfg.label || id
            };
        }).filter(function (f) {
            return isSafeFloorImage(f.image)
                && Array.isArray(f.coordinates)
                && f.coordinates.length === 4;
        });
    }
    if (
        isSafeFloorImage(options.image)
        && Array.isArray(options.coordinates)
        && options.coordinates.length === 4
    ) {
        return [{
            id: options.floorId || 'default',
            image: options.image,
            coordinates: options.coordinates,
            label: options.floorLabel || 'Floor'
        }];
    }
    return [];
}

function collectFloorIdsFromFeatures(fc) {
    const out = [];
    const seen = {};
    const features = (fc && fc.features) || [];
    for (let i = 0; i < features.length; i++) {
        const p = features[i] && features[i].properties;
        if (!p) continue;
        const id = p.floor || p.level;
        if (id === null || id === undefined) continue;
        const key = String(id);
        if (!seen[key]) {
            seen[key] = true;
            out.push(key);
        }
    }
    return out;
}

function ensureSwitcher(map, floors, activeId) {
    if (!map || floors.length < 2) {
        removeSwitcher(map);
        return;
    }
    const container = map.getContainer && map.getContainer();
    if (!container) return;
    const host = container.parentNode || container;
    let switcher = host.querySelector('.' + SWITCHER_CLASS);
    if (!switcher) {
        switcher = document.createElement('div');
        switcher.className = SWITCHER_CLASS;
        switcher.setAttribute('role', 'group');
        switcher.setAttribute('aria-label', 'Switch floor');
        host.appendChild(switcher);
    }
    switcher.innerHTML = '';
    floors.forEach(function (f) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = SWITCHER_BUTTON_CLASS + (f.id === activeId ? ' is-active' : '');
        btn.textContent = f.label || f.id;
        btn.setAttribute('aria-pressed', f.id === activeId ? 'true' : 'false');
        btn.addEventListener('click', function () {
            switchFloor(map, f.id);
        });
        switcher.appendChild(btn);
    });
}

function removeSwitcher(map) {
    if (!map || !map.getContainer) return;
    const host = map.getContainer().parentNode;
    if (!host) return;
    const switcher = host.querySelector('.' + SWITCHER_CLASS);
    if (switcher && switcher.parentNode) {
        switcher.parentNode.removeChild(switcher);
    }
}

function switchFloor(map, floorId) {
    const state = map[STATE_PROP];
    if (!state) return;
    const next = state.floors.find(function (f) { return f.id === floorId; });
    if (!next) return;
    const src = map.getSource(SOURCE_ID);
    if (!src || !src.updateImage) return;
    src.updateImage({
        url: next.image,
        coordinates: next.coordinates
    });
    state.active = floorId;
    ensureSwitcher(map, state.floors, floorId);
}
