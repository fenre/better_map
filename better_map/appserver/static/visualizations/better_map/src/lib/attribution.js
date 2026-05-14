/*
 * Attribution control management.
 *
 * MapLibre exposes an AttributionControl that can be configured per-style
 * or per-source. For Better Map we want:
 *
 *   - Always-on, never-hidden attribution when OSM or OpenFreeMap is the
 *     active provider (ODbL clause / OpenFreeMap attribution clause).
 *   - Collapsible attribution for keyed providers where the user accepts
 *     the provider's terms by entering their API key.
 *   - Customisable attribution for user-supplied PMTiles or style URLs.
 *
 * The AttributionControl is created once and re-keyed when the provider
 * changes; we never have two controls active simultaneously.
 */

export function applyAttribution(map, maplibregl, provider) {
    if (!map || !maplibregl || !provider) {
        return null;
    }

    if (map.__better_map_attribution__) {
        try {
            map.removeControl(map.__better_map_attribution__);
        } catch (_err) {
            /* swallow - control may have been auto-removed on style change */
        }
        map.__better_map_attribution__ = null;
    }

    const compact = !provider.attributionLocked;
    const control = new maplibregl.AttributionControl({
        compact: compact,
        customAttribution: provider.attribution || ''
    });

    map.addControl(control, 'bottom-right');
    map.__better_map_attribution__ = control;

    if (provider.attributionLocked) {
        // Defence in depth: provider-locked attribution must never collapse.
        // MapLibre adds a class to the control container we can hook into.
        scheduleLockExpansion(map);
    }

    return control;
}

function scheduleLockExpansion(map) {
    if (!map || !map.getContainer) {
        return;
    }
    const apply = function () {
        const container = map.getContainer();
        if (!container) {
            return;
        }
        const nodes = container.querySelectorAll('.maplibregl-ctrl-attrib');
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].classList.add('maplibregl-compact-show');
            nodes[i].classList.remove('maplibregl-ctrl-attrib-button-shown');
        }
    };
    // The attribution DOM is built after we add the control, so wait a tick
    // before forcing it open.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(apply);
    } else {
        setTimeout(apply, 0);
    }
}
