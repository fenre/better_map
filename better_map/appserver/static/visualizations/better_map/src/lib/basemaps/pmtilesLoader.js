/*
 * Air-gapped PMTiles loader.
 *
 * PMTiles is a single-file format for vector basemaps (HTTP range
 * requests serve tiles directly from the .pmtiles archive — no tile
 * server needed). This is the canonical solution for air-gapped /
 * regulated / classified Splunk deployments where calling out to
 * carto.com or openstreetmap.org is impossible.
 *
 * Usage in a viz dashboard JSON (Dashboard Studio formatter):
 *
 *   "options": {
 *     "basemapId": "pmtiles",
 *     "basemapPMTilesUrl": "https://splunkweb.local/static/app/better_map/basemap.pmtiles",
 *     "basemapPMTilesStyle": "dark"
 *   }
 *
 * The .pmtiles file must be served from the host Splunk (typically as
 * a static asset under the app's `appserver/static` directory) so it's
 * subject to the same CSP and TLS posture as the rest of the dashboard.
 *
 * Build the archive with the companion script:
 *   scripts/build-pmtiles.sh -o basemap.pmtiles \
 *       --bbox -180,-85,180,85 --minzoom 0 --maxzoom 8
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { Protocol } from 'pmtiles';

let _protocol = null;
let _enabled = true;

/**
 * Register the pmtiles:// protocol with MapLibre. Call this exactly
 * once per page (the protocol is global).
 */
export function registerProtocol(maplibreglNamespace) {
    if (_protocol) return _protocol;
    if (!maplibreglNamespace || typeof maplibreglNamespace.addProtocol !== 'function') {
        return null;
    }
    _protocol = new Protocol();
    maplibreglNamespace.addProtocol('pmtiles', _protocol.tile.bind(_protocol));
    return _protocol;
}

/**
 * Build a MapLibre style for a PMTiles vector basemap.
 *
 * @param {object} opts
 *   url: string         absolute or relative URL to the .pmtiles file
 *   style?: 'dark'|'light'|'satellite-overlay'   default 'dark'
 *   sourceLayerPrefix?: string  override OSM source-layer naming
 * @returns {object} MapLibre style object
 */
export function buildStyle(opts) {
    const o = opts || {};
    const url = o.url;
    if (!url) return null;
    const style = (o.style || 'dark').toLowerCase();
    const pmtilesUrl = 'pmtiles://' + url;

    const colors = PALETTES[style] || PALETTES.dark;

    return {
        version: 8,
        glyphs: o.glyphsUrl || undefined,
        sources: {
            pmtiles_basemap: {
                type: 'vector',
                url: pmtilesUrl,
                attribution: o.attribution
                    || '<a href="https://protomaps.com/" target="_blank">© Protomaps</a> '
                    + '<a href="https://openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>'
            }
        },
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: { 'background-color': colors.background }
            },
            {
                id: 'water',
                type: 'fill',
                source: 'pmtiles_basemap',
                'source-layer': 'water',
                paint: { 'fill-color': colors.water }
            },
            {
                id: 'landuse',
                type: 'fill',
                source: 'pmtiles_basemap',
                'source-layer': 'landuse',
                paint: { 'fill-color': colors.landuse, 'fill-opacity': 0.45 }
            },
            {
                id: 'roads',
                type: 'line',
                source: 'pmtiles_basemap',
                'source-layer': 'roads',
                paint: {
                    'line-color': colors.roads,
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 14, 2]
                }
            },
            {
                id: 'admin',
                type: 'line',
                source: 'pmtiles_basemap',
                'source-layer': 'admin',
                paint: { 'line-color': colors.admin, 'line-width': 0.5 }
            }
        ]
    };
}

const PALETTES = {
    dark: {
        background: '#0F1117',
        water: '#1A2536',
        landuse: '#1C2233',
        roads: '#2C3447',
        admin: '#3B4566'
    },
    light: {
        background: '#F8FAFC',
        water: '#DDE6F1',
        landuse: '#E9ECEF',
        roads: '#C2C8D2',
        admin: '#9CA3AF'
    }
};

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() { /* protocol is global; nothing to reset */ }
