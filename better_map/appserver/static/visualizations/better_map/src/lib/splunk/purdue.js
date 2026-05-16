/*
 * OT Purdue model / IEC 62443 overlay.
 *
 * Decorates each feature with a Purdue level (0..5) by joining the
 * feature's host / asset id against an asset-register lookup. Levels
 * map to fixed colours per the convention in
 * `splunk-skills/methodology/references/ot-safety-considerations.md`.
 *
 * Asset-register lookup is expected to follow:
 *
 *   asset_id,purdue_level,zone,safety_related
 *   PLC-001,1,zone-cell-A,Y
 *   HMI-027,2,zone-cell-A,N
 *
 * The lookup can be fetched from a Splunk lookup file via the REST
 * endpoint:
 *
 *   /servicesNS/-/<app>/data/lookups/asset_register.csv
 *
 * Or supplied inline (for the air-gapped / offline case).
 *
 * Output: a FeatureCollection where every feature has:
 *   properties.purdueLevel  number (-1 = unknown)
 *   properties.purdueColor  hex string
 *   properties.zone         string
 *   properties.safetyRelated boolean
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { splunkdFetch } from './rest';

const PURDUE_COLORS = {
    0: '#9333EA',  // Process / sensors (Level 0)
    1: '#06B6D4',  // Basic control (PLC / DCS)
    2: '#3B82F6',  // Supervisory (HMI / SCADA)
    3: '#22C55E',  // Operations (MES / historian)
    4: '#F59E0B',  // IT / enterprise systems
    5: '#EF4444'   // Internet DMZ
};

let _enabled = true;
let _registry = {};  // assetId -> {purdueLevel, zone, safetyRelated}
let _config = {
    assetIdField: 'host',
    fallbackFields: ['asset_id', 'dest', 'src']
};

export function configure(opts) {
    if (!opts) return;
    if (opts.assetIdField) _config.assetIdField = opts.assetIdField;
    if (Array.isArray(opts.fallbackFields)) _config.fallbackFields = opts.fallbackFields.slice();
}

/**
 * Load the asset register inline. Useful for air-gapped / static demos.
 */
export function loadInline(rows) {
    _registry = {};
    (rows || []).forEach(function (r) {
        if (!r) return;
        const id = r.asset_id || r.host;
        if (!id) return;
        _registry[id] = {
            purdueLevel: Number(r.purdue_level),
            zone: r.zone || null,
            safetyRelated: r.safety_related === 'Y' || r.safety_related === true
        };
    });
}

/**
 * Load the asset register from a Splunk lookup. Requires the host
 * Splunk instance to have the lookup file with that name.
 */
export function loadFromLookup(appName, lookupName) {
    const path = '/servicesNS/-/' + (appName || '-') + '/data/lookups/' + encodeURIComponent(lookupName || 'asset_register') + '?output_mode=json&count=0';
    return splunkdFetch(path, { method: 'GET' }).then(function (resp) {
        if (!resp.ok) {
            return { available: false, reason: 'http-' + resp.status, count: 0 };
        }
        // The data/lookups endpoint returns CSV in `body`. Parse it.
        const rows = parseCsv(resp.body);
        loadInline(rows);
        return { available: true, count: Object.keys(_registry).length };
    }).catch(function (e) {
        return { available: false, reason: 'fetch-failed', error: String(e) };
    });
}

function parseCsv(body) {
    if (!body) return [];
    const lines = body.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (line) {
        const cols = line.split(',');
        const obj = {};
        header.forEach(function (h, i) { obj[h] = (cols[i] || '').trim(); });
        return obj;
    });
}

function resolveAsset(props) {
    if (!props) return null;
    const fields = [_config.assetIdField].concat(_config.fallbackFields);
    for (let i = 0; i < fields.length; i++) {
        const v = props[fields[i]];
        if (v && _registry[v]) return _registry[v];
    }
    return null;
}

/**
 * Decorate every feature with Purdue metadata.
 */
export function enrich(fc) {
    if (!fc || !fc.features) return fc;
    return {
        type: 'FeatureCollection',
        features: fc.features.map(function (f) {
            const p = f.properties || {};
            const asset = resolveAsset(p);
            const level = asset && Number.isFinite(asset.purdueLevel) ? asset.purdueLevel : -1;
            const color = PURDUE_COLORS[level] || '#64748B';
            return {
                type: 'Feature',
                geometry: f.geometry,
                properties: Object.assign({}, p, {
                    purdueLevel: level,
                    purdueColor: color,
                    zone: asset ? asset.zone : null,
                    safetyRelated: asset ? !!asset.safetyRelated : false
                })
            };
        })
    };
}

export function colors() {
    return Object.assign({}, PURDUE_COLORS);
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() {
    _registry = {};
    _config = { assetIdField: 'host', fallbackFields: ['asset_id', 'dest', 'src'] };
}
