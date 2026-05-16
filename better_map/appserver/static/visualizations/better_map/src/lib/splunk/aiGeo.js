/*
 * Asset & Identity geo-resolution.
 *
 * For events that carry a host / src / dest / src_user / src_ip but no
 * lat/lng, this module looks up the entity against ES `assets.csv` /
 * `identities.csv` (or any equivalent enrichment lookup) and resolves
 * a location.
 *
 * Lookup precedence per feature:
 *
 *   1. Already has feature.geometry as a Point → unchanged
 *   2. host or asset_id → assets.csv → lat/lng
 *   3. user or src_user → identities.csv → lat/lng (via user's primary asset)
 *   4. src_ip / dest_ip → IP geo-lookup macro `geoip(...)`
 *
 * Features that resolve to a location are returned with
 * properties._geoResolvedBy = 'asset' | 'identity' | 'ip' so dashboards
 * can show "resolved by geocoded asset register" badges.
 *
 * Unresolved features are dropped from the output unless `keepUnresolved`
 * is true.
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { splunkdFetch } from './rest';

let _enabled = true;
let _assetsByHost = {};
let _identitiesByUser = {};
let _config = {
    assetsLookup: 'assets.csv',
    identitiesLookup: 'identities.csv',
    app: '-',
    keepUnresolved: false
};

export function configure(opts) {
    if (opts) Object.assign(_config, opts);
}

export function loadAssetsInline(rows) {
    _assetsByHost = {};
    (rows || []).forEach(function (r) {
        if (!r) return;
        const key = r.nt_host || r.dns || r.ip || r.host;
        if (key && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) {
            _assetsByHost[key] = {
                lat: Number(r.lat),
                lng: Number(r.lng),
                priority: r.priority || null,
                category: r.category || null
            };
        }
    });
}

export function loadIdentitiesInline(rows) {
    _identitiesByUser = {};
    (rows || []).forEach(function (r) {
        if (!r) return;
        const key = r.user || r.identity || r.email;
        if (!key) return;
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            _identitiesByUser[key] = {
                lat: lat,
                lng: lng,
                department: r.department || null,
                primaryAsset: r.host || null
            };
        }
    });
}

export function loadAssetsFromLookup() {
    return loadCsvLookup(_config.assetsLookup).then(function (rows) {
        loadAssetsInline(rows);
        return Object.keys(_assetsByHost).length;
    });
}

export function loadIdentitiesFromLookup() {
    return loadCsvLookup(_config.identitiesLookup).then(function (rows) {
        loadIdentitiesInline(rows);
        return Object.keys(_identitiesByUser).length;
    });
}

function loadCsvLookup(name) {
    const path = '/servicesNS/-/' + (_config.app || '-') + '/data/lookups/' + encodeURIComponent(name);
    return splunkdFetch(path, { method: 'GET' }).then(function (resp) {
        if (!resp.ok) return [];
        return parseCsv(resp.body);
    }).catch(function () { return []; });
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

function resolveOne(props) {
    if (!props) return null;
    const host = props.host || props.dest || props.nt_host || props.dns || props.asset_id;
    if (host && _assetsByHost[host]) {
        return { lat: _assetsByHost[host].lat, lng: _assetsByHost[host].lng, source: 'asset' };
    }
    const user = props.user || props.src_user || props.email;
    if (user && _identitiesByUser[user]) {
        return { lat: _identitiesByUser[user].lat, lng: _identitiesByUser[user].lng, source: 'identity' };
    }
    // Caller can wire IP-geo lookups via an external macro; we don't ship
    // one inline because it adds a 6 MB MaxMind database.
    return null;
}

/**
 * Resolve coordinates for every feature in `fc`. Mutates a new FC.
 */
export function resolve(fc) {
    if (!fc || !fc.features) return fc;
    const out = [];
    fc.features.forEach(function (f) {
        if (f.geometry && f.geometry.type === 'Point'
            && Array.isArray(f.geometry.coordinates)
            && f.geometry.coordinates.length === 2) {
            out.push(f);
            return;
        }
        const res = resolveOne(f.properties);
        if (res) {
            out.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [res.lng, res.lat] },
                properties: Object.assign({}, f.properties || {}, { _geoResolvedBy: res.source })
            });
        } else if (_config.keepUnresolved) {
            out.push(Object.assign({}, f, { properties: Object.assign({}, f.properties || {}, { _geoResolvedBy: null }) }));
        }
    });
    return { type: 'FeatureCollection', features: out };
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() {
    _assetsByHost = {};
    _identitiesByUser = {};
    _config = {
        assetsLookup: 'assets.csv',
        identitiesLookup: 'identities.csv',
        app: '-',
        keepUnresolved: false
    };
}
