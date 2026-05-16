/*
 * Tile provider catalogue.
 *
 * Exposes:
 *   - PROVIDERS: static metadata for each supported provider
 *   - resolveStyle({ provider, theme, apiKey, customStyleUrl }):
 *       picks the right MapLibre style URL (or inline style object) for the
 *       caller's intent. Theme-aware light/dark auto-switching is handled
 *       here so callers can always pass `theme = "dark"` or `theme = "light"`
 *       and get a sensible default.
 *
 * Conventions:
 *   - "openfreemap_liberty" is the v1 DEFAULT. Liberty looks closest to
 *     Google/Apple Maps, has no rate limit, and ships without an API key.
 *   - OSM raster is kept as a fallback option but discouraged for
 *     production per OSM's tile usage policy.
 *   - Provider attribution is locked on by `attribution.js` whenever OSM
 *     or OpenFreeMap is the active provider.
 */

export const PROVIDERS = Object.freeze({
    /*
     * v1.5.0 sexy-maps default. Carto's basemap-styles bucket hosts
     * Dark Matter, Voyager, and Positron as MapLibre style JSON without
     * an API key and without rate-limiting the public read path. This
     * is the same basemap Kepler.gl, Uber Movement, and most of the
     * "sexy demo" map projects use as a foundation. The dark variant
     * (`dark-matter-gl-style/style.json`) is near-black with subtle
     * grey landmasses; ideal for glow / arc / pulse overlays.
     *
     * Light fallback uses Voyager (Carto's modern muted-color style)
     * because Dark Matter on a light theme is unreadable.
     */
    carto_dark_matter: {
        id: 'carto_dark_matter',
        label: 'Carto Dark Matter (sexy default)',
        requiresKey: false,
        vector: true,
        light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        attribution:
            '\u00a9 <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> ' +
            '\u00b7 \u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        attributionLocked: true
    },
    carto_voyager: {
        id: 'carto_voyager',
        label: 'Carto Voyager (muted color)',
        requiresKey: false,
        vector: true,
        light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        dark: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        attribution:
            '\u00a9 <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> ' +
            '\u00b7 \u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        attributionLocked: true
    },
    carto_positron: {
        id: 'carto_positron',
        label: 'Carto Positron (light)',
        requiresKey: false,
        vector: true,
        light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        dark: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        attribution:
            '\u00a9 <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> ' +
            '\u00b7 \u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        attributionLocked: true
    },
    openfreemap_liberty: {
        id: 'openfreemap_liberty',
        label: 'OpenFreeMap Liberty',
        requiresKey: false,
        vector: true,
        light: 'https://tiles.openfreemap.org/styles/liberty',
        dark: 'https://tiles.openfreemap.org/styles/liberty',
        attribution:
            '\u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
            '\u00b7 <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
        attributionLocked: true
    },
    openfreemap_positron: {
        id: 'openfreemap_positron',
        label: 'OpenFreeMap Positron (light)',
        requiresKey: false,
        vector: true,
        light: 'https://tiles.openfreemap.org/styles/positron',
        dark: 'https://tiles.openfreemap.org/styles/positron',
        attribution:
            '\u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
            '\u00b7 <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
        attributionLocked: true
    },
    openfreemap_bright: {
        id: 'openfreemap_bright',
        label: 'OpenFreeMap Bright (high contrast)',
        requiresKey: false,
        vector: true,
        light: 'https://tiles.openfreemap.org/styles/bright',
        dark: 'https://tiles.openfreemap.org/styles/bright',
        attribution:
            '\u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
            '\u00b7 <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
        attributionLocked: true
    },
    osm_raster: {
        id: 'osm_raster',
        label: 'OpenStreetMap raster (fallback)',
        requiresKey: false,
        vector: false,
        // OSM raster is built inline because no public vector style URL
        // exists for it. We keep it for environments that cannot reach
        // openfreemap.org.
        inline: {
            light: makeRasterStyle(
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                '\u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
            ),
            dark: makeRasterStyle(
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                '\u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
            )
        },
        attribution:
            '\u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        attributionLocked: true
    },
    maptiler: {
        id: 'maptiler',
        label: 'MapTiler (API key required)',
        requiresKey: true,
        vector: true,
        light: 'https://api.maptiler.com/maps/streets-v2/style.json?key={KEY}',
        dark: 'https://api.maptiler.com/maps/streets-v2-dark/style.json?key={KEY}',
        attribution:
            '\u00a9 <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> ' +
            '\u00b7 \u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        attributionLocked: false
    },
    stadia: {
        id: 'stadia',
        label: 'Stadia Maps (API key required)',
        requiresKey: true,
        vector: true,
        light: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key={KEY}',
        dark: 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key={KEY}',
        attribution:
            '\u00a9 <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> ' +
            '\u00b7 \u00a9 <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
            '\u00b7 \u00a9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        attributionLocked: false
    },
    pmtiles: {
        id: 'pmtiles',
        label: 'PMTiles (offline-capable, user URL)',
        requiresKey: false,
        vector: true,
        // PMTiles styles are user-supplied. The viz passes the URL through
        // as the style and relies on the pmtiles:// protocol registration in
        // mapBuilder.js to satisfy fetches.
        userUrl: true,
        attribution:
            'Attribution per user-supplied PMTiles bundle',
        attributionLocked: false
    },
    custom: {
        id: 'custom',
        label: 'Custom MapLibre style URL',
        requiresKey: false,
        vector: true,
        userUrl: true,
        attribution: 'Attribution per user-supplied style',
        attributionLocked: false
    }
});

/*
 * v1.5.0 default switched from openfreemap_liberty (light raster-ish
 * Google-Maps-look) to carto_dark_matter (near-black cosmic basemap).
 * This is the single biggest visual upgrade in v1.5.0 — every overlay
 * (glow paths, pulsing dots, great-circle arcs) was designed against
 * a dark cosmic background and looks washed-out on light tiles.
 *
 * Dashboards that explicitly want the old basemap can opt back in with
 * `tileProvider="openfreemap_liberty"`.
 */
export const DEFAULT_PROVIDER = 'carto_dark_matter';

/**
 * Resolve a MapLibre style URL or inline style for a given provider intent.
 *
 * @param {object} args
 * @param {string} args.provider     - PROVIDERS key (case-sensitive)
 * @param {string} [args.theme]      - "light" or "dark"; defaults to "dark"
 * @param {string} [args.apiKey]     - API key for keyed providers
 * @param {string} [args.customStyleUrl] - URL for provider in {"custom","pmtiles"}
 * @returns {{ style: (string|object), provider: object }}
 */
export function resolveStyle(args) {
    const opts = args || {};
    const theme = opts.theme === 'light' ? 'light' : 'dark';
    const providerId = PROVIDERS[opts.provider] ? opts.provider : DEFAULT_PROVIDER;
    const provider = PROVIDERS[providerId];

    if (provider.userUrl) {
        const url = opts.customStyleUrl || '';
        if (!isHttpsOrPmtilesUrl(url)) {
            throw new Error(
                'Better Map: ' + providerId + ' provider requires an https:// (or pmtiles://) style URL.'
            );
        }
        return { style: url, provider: provider };
    }

    if (provider.inline) {
        return { style: provider.inline[theme] || provider.inline.dark, provider: provider };
    }

    if (provider.requiresKey) {
        const key = opts.apiKey || '';
        if (!key) {
            // Caller will fall back to OSM raster via PROVIDERS.osm_raster
            // until the user supplies a key; surface the requirement.
            throw new Error(
                'Better Map: ' + provider.label + ' requires an API key. Set the Tile provider API key in the formatter.'
            );
        }
        const url = (provider[theme] || provider.dark).replace('{KEY}', encodeURIComponent(key));
        return { style: url, provider: provider };
    }

    const url = provider[theme] || provider.dark;
    return { style: url, provider: provider };
}

/**
 * Defence-in-depth URL gate. Style URLs go straight into the MapLibre
 * Style spec; we never want to honour `javascript:` or `data:` schemes.
 */
export function isHttpsOrPmtilesUrl(url) {
    if (typeof url !== 'string' || !url) {
        return false;
    }
    return /^(https:\/\/|pmtiles:\/\/)/i.test(url);
}

function makeRasterStyle(tileUrl, attribution) {
    return {
        version: 8,
        sources: {
            'osm-raster': {
                type: 'raster',
                tiles: [tileUrl],
                tileSize: 256,
                attribution: attribution,
                maxzoom: 19
            }
        },
        layers: [
            {
                id: 'osm-raster-layer',
                type: 'raster',
                source: 'osm-raster',
                minzoom: 0,
                maxzoom: 22
            }
        ],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
    };
}
