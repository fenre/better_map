/*
 * demo/presets/cyberIncidents.js — global SOC view of 24h of
 * security incidents.
 *
 * Story
 * -----
 * A Splunk Enterprise Security SOC ingests authentication failures,
 * port scans, malware C2 callbacks, data-exfiltration alerts and
 * DDoS warnings from edge sensors world-wide.  The dataset is 600
 * incidents over the last 24h, geolocated to the source IP's city.
 * Each row carries the MITRE ATT&CK technique that fired the alert
 * and the risk score the RBA framework assigned to it.
 *
 * Why this preset showcases Better Map
 * ------------------------------------
 *  - **Hexbin aggregation** at world scale — large regions glow
 *    proportionally to attack density.
 *  - **Heatmap layer** — drop the hexbins and the same data renders
 *    as a heatmap.
 *  - **MITRE chips** — `mitre_technique_id` is recognised by the
 *    MITRE integration (`src/lib/splunk/mitre.js`); popups render
 *    Txxxx chips.
 *  - **RBA colour band** — `risk_score` is consumed by the RBA
 *    integration; `color` shifts from green (low) → red (critical).
 *  - **Choropleth-ready** — `country_code` is an ISO-3166-alpha-2
 *    code, so feature-join against the `countries` preset tileset
 *    immediately yields a per-country choropleth.
 *
 * Realism notes
 * -------------
 * Source distribution is biased toward countries that historically
 * top attack-origin reports (CN, RU, US, IN, BR, …) and away from
 * Antarctica.  These are *not* real attack vectors against real
 * customers — every IP is RFC-5737 documentation space and every
 * country/technique pairing is synthetic.
 */
import { createRng } from '../rng.js';

// (country_code, country_name, lat, lon, weight). Weight biases the
// sampler so attack origins look realistic without bothering with a
// full probability distribution. Lat/lon are the country centroid
// (Wikipedia "Geographic center of <country>").
var SOURCE_COUNTRIES = [
    { code: 'CN', name: 'China',          lat:  35.86, lon: 104.20, weight: 18 },
    { code: 'RU', name: 'Russia',         lat:  61.52, lon:  105.32, weight: 14 },
    { code: 'US', name: 'United States',  lat:  39.83, lon:  -98.58, weight: 10 },
    { code: 'IN', name: 'India',          lat:  22.97, lon:   78.65, weight:  9 },
    { code: 'BR', name: 'Brazil',         lat: -14.24, lon:  -51.93, weight:  6 },
    { code: 'DE', name: 'Germany',        lat:  51.16, lon:   10.45, weight:  5 },
    { code: 'KR', name: 'South Korea',    lat:  35.91, lon:  127.77, weight:  5 },
    { code: 'NG', name: 'Nigeria',        lat:   9.08, lon:    8.68, weight:  4 },
    { code: 'IR', name: 'Iran',           lat:  32.43, lon:   53.69, weight:  4 },
    { code: 'KP', name: 'North Korea',    lat:  40.34, lon:  127.51, weight:  3 },
    { code: 'TR', name: 'Türkiye',        lat:  38.96, lon:   35.24, weight:  3 },
    { code: 'VN', name: 'Vietnam',        lat:  14.06, lon:  108.28, weight:  3 },
    { code: 'PL', name: 'Poland',         lat:  51.92, lon:   19.13, weight:  2 },
    { code: 'GB', name: 'United Kingdom', lat:  55.38, lon:   -3.44, weight:  2 },
    { code: 'CA', name: 'Canada',         lat:  56.13, lon: -106.35, weight:  2 },
    { code: 'AU', name: 'Australia',      lat: -25.27, lon:  133.78, weight:  2 },
    { code: 'JP', name: 'Japan',          lat:  36.20, lon:  138.25, weight:  2 },
    { code: 'EG', name: 'Egypt',          lat:  26.82, lon:   30.80, weight:  2 },
    { code: 'MX', name: 'Mexico',         lat:  23.63, lon: -102.55, weight:  2 },
    { code: 'ZA', name: 'South Africa',   lat: -30.56, lon:   22.94, weight:  1 }
];

// Customer-target distribution. Norwegian-context tenants so the
// "we ingested this in our Splunk" story feels grounded — but the
// dataset is geocoded by SOURCE, not target.
var TARGETS = [
    { asset: 'web-prod-01.example.no',     env: 'production'  },
    { asset: 'web-prod-02.example.no',     env: 'production'  },
    { asset: 'api-gw.internal.example.no', env: 'production'  },
    { asset: 'mail-relay.example.no',      env: 'production'  },
    { asset: 'auth-idp.example.no',        env: 'production'  },
    { asset: 'crm-app-01.example.no',      env: 'production'  },
    { asset: 'ot-dmz-bastion.example.no',  env: 'ot-dmz'      },
    { asset: 'workstation-fin-08.example.no', env: 'corporate' },
    { asset: 'vpn-gw-bergen.example.no',   env: 'production'  },
    { asset: 'sap-erp.example.no',         env: 'production'  }
];

// (attack_type, severity_bias, mitre_technique_id, technique_name).
// Severity bias shifts the gaussian risk-score mean upward for the
// nastier classes (exfil, ransomware staging).
var ATTACK_TYPES = [
    { type: 'auth-failure',         bias:  5, mitre: 'T1110.001', mname: 'Password guessing' },
    { type: 'auth-failure-spray',   bias: 15, mitre: 'T1110.003', mname: 'Password spraying' },
    { type: 'port-scan',            bias:  8, mitre: 'T1046',     mname: 'Network service discovery' },
    { type: 'web-attack-sqli',      bias: 25, mitre: 'T1190',     mname: 'Exploit public-facing app' },
    { type: 'web-attack-xss',       bias: 18, mitre: 'T1190',     mname: 'Exploit public-facing app' },
    { type: 'c2-callback',          bias: 35, mitre: 'T1071.001', mname: 'Application layer (web)' },
    { type: 'data-exfil-dns',       bias: 45, mitre: 'T1048.003', mname: 'Exfil over unencrypted protocol' },
    { type: 'malware-droplet',      bias: 30, mitre: 'T1204.002', mname: 'User executes malicious file' },
    { type: 'ransomware-staging',   bias: 55, mitre: 'T1486',     mname: 'Data encrypted for impact' },
    { type: 'ddos-volumetric',      bias: 12, mitre: 'T1498.001', mname: 'Direct network flood' }
];

function pickWeighted(arr, weightProp, rng) {
    var total = 0;
    for (var i = 0; i < arr.length; i++) total += arr[i][weightProp];
    var r = rng.next() * total;
    for (var j = 0; j < arr.length; j++) {
        r -= arr[j][weightProp];
        if (r <= 0) return arr[j];
    }
    return arr[arr.length - 1];
}

// Risk score 0..100 → colour band.
function riskColor(score) {
    if (score >= 80) return '#7f1d1d';  // crimson — critical
    if (score >= 60) return '#f43f5e';  // red — high
    if (score >= 40) return '#fb923c';  // orange — elevated
    if (score >= 20) return '#fbbf24';  // amber — moderate
    return '#a3e635';                   // green — low
}

function riskBand(score) {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'elevated';
    if (score >= 20) return 'moderate';
    return 'low';
}

/**
 * @param {object} [opts]
 * @param {number} [opts.seed=271828]
 * @param {number} [opts.count=600]
 * @param {number} [opts.hours=24]
 * @param {number} [opts.nowMs]
 */
export function generateCyberIncidents(opts) {
    var o = opts || {};
    var rng = createRng(o.seed || 271828);
    var count = o.count || 600;
    var hours = o.hours || 24;
    var nowMs = o.nowMs || Date.now();

    var totalSeconds = hours * 3600;
    var earliestMs = nowMs - totalSeconds * 1000;

    var rows = [];

    for (var i = 0; i < count; i++) {
        var country = pickWeighted(SOURCE_COUNTRIES, 'weight', rng);
        var attack = ATTACK_TYPES[rng.int(0, ATTACK_TYPES.length)];
        var target = TARGETS[rng.int(0, TARGETS.length)];

        // Scatter ±5° around the country centroid so events don't
        // pile into one pixel per country. Bigger countries get
        // bigger scatter.
        var spread = country.code === 'RU' || country.code === 'US' || country.code === 'CN' ? 8 : 4;
        var lat = country.lat + rng.gauss(0, spread / 3);
        var lon = country.lon + rng.gauss(0, spread / 3);
        // Clamp so we never wrap.
        if (lat >  85) lat =  85;
        if (lat < -85) lat = -85;
        if (lon > 180) lon = 180;
        if (lon < -180) lon = -180;

        var tsMs = earliestMs + Math.floor(rng.next() * totalSeconds * 1000);

        // Risk score: gaussian around (40 + attack bias), clamped 0–100.
        var rawScore = rng.gauss(40 + attack.bias, 15);
        var riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));
        var band = riskBand(riskScore);
        var color = riskColor(riskScore);

        // RFC-5737 documentation address space. Random but
        // deterministic — same seed, same IP per row.
        var srcIp =
            '203.0.' + rng.int(0, 256) + '.' + rng.int(0, 256);
        var incidentId = 'INC-' +
            String(100000 + i).padStart(6, '0');

        var popup =
            '<div style="font-weight:600;font-size:13px">' + incidentId +
            ' — ' + attack.type +
            '</div>' +
            '<div style="opacity:0.8;font-size:11px">' +
            country.name + ' (' + country.code + ') → ' + target.asset +
            '</div>' +
            '<div style="margin-top:6px;font-size:12px">' +
            '<b>Risk</b>: ' + riskScore + ' (' + band + ')<br>' +
            '<b>MITRE</b>: ' + attack.mitre + ' — ' + attack.mname + '<br>' +
            '<b>Source IP</b>: ' + srcIp + '<br>' +
            '<b>Target env</b>: ' + target.env +
            '</div>';

        rows.push([
            new Date(tsMs).toISOString(),
            lat.toFixed(4),
            lon.toFixed(4),
            incidentId,                  // id
            country.code,                // iso  (feature-join key for countries preset)
            country.name,
            srcIp,
            target.asset,
            target.env,
            attack.type,
            attack.mitre,
            attack.mname,
            String(riskScore),
            band,
            color,
            popup
        ]);
    }

    return {
        fields: [
            { name: '_time' },
            { name: 'lat' },
            { name: 'lon' },
            { name: 'id' },
            { name: 'iso' },
            { name: 'country' },
            { name: 'src_ip' },
            { name: 'target_asset' },
            { name: 'target_env' },
            { name: 'attack_type' },
            { name: 'mitre_technique_id' },
            { name: 'mitre_technique_name' },
            { name: 'risk_score' },
            { name: 'risk_band' },
            { name: 'color' },
            { name: 'popup' }
        ],
        rows: rows
    };
}
