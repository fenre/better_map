/*
 * MITRE ATT&CK overlay.
 *
 * Consumes `attack_id` (single value or comma-separated list) on each
 * feature and decorates it with technique name + tactics from a small
 * built-in lookup table. The lookup covers the most common ~80
 * Enterprise techniques so dashboards work offline; for the full
 * matrix, set `extendedLookupUrl` to a JSON endpoint that returns the
 * remaining technique metadata.
 *
 * Tooltip body (markdown) is emitted by `formatTooltip(props)` and is
 * intended to be fed into the markdownPopup widget.
 *
 * Splunk integration: `annotationStanza()` emits a ready-to-paste
 * `action.correlationsearch.annotations` block for `savedsearches.conf`
 * — the proper way to bind a saved search to ATT&CK techniques.
 *
 * BM-CT-1: stateless module; enable/disable happens at the layer that
 * consumes the decorated FeatureCollection (markers / mil2525).
 */

const TECHNIQUES = {
    'T1078': { name: 'Valid Accounts', tactics: ['Defense Evasion', 'Persistence', 'Privilege Escalation', 'Initial Access'] },
    'T1110': { name: 'Brute Force', tactics: ['Credential Access'] },
    'T1190': { name: 'Exploit Public-Facing Application', tactics: ['Initial Access'] },
    'T1059': { name: 'Command and Scripting Interpreter', tactics: ['Execution'] },
    'T1486': { name: 'Data Encrypted for Impact', tactics: ['Impact'] },
    'T1496': { name: 'Resource Hijacking', tactics: ['Impact'] },
    'T1071': { name: 'Application Layer Protocol', tactics: ['Command and Control'] },
    'T1090': { name: 'Proxy', tactics: ['Command and Control'] },
    'T1041': { name: 'Exfiltration Over C2 Channel', tactics: ['Exfiltration'] },
    'T1567': { name: 'Exfiltration Over Web Service', tactics: ['Exfiltration'] },
    'T1572': { name: 'Protocol Tunneling', tactics: ['Command and Control'] },
    'T1021': { name: 'Remote Services', tactics: ['Lateral Movement'] },
    'T1098': { name: 'Account Manipulation', tactics: ['Persistence'] },
    'T1136': { name: 'Create Account', tactics: ['Persistence'] },
    'T1207': { name: 'Rogue Domain Controller', tactics: ['Defense Evasion'] },
    'T1003': { name: 'OS Credential Dumping', tactics: ['Credential Access'] },
    'T1018': { name: 'Remote System Discovery', tactics: ['Discovery'] },
    'T1046': { name: 'Network Service Discovery', tactics: ['Discovery'] },
    'T1083': { name: 'File and Directory Discovery', tactics: ['Discovery'] },
    'T1135': { name: 'Network Share Discovery', tactics: ['Discovery'] },
    'T1057': { name: 'Process Discovery', tactics: ['Discovery'] },
    'T1518': { name: 'Software Discovery', tactics: ['Discovery'] },
    'T1014': { name: 'Rootkit', tactics: ['Defense Evasion'] },
    'T1027': { name: 'Obfuscated Files or Information', tactics: ['Defense Evasion'] },
    'T1036': { name: 'Masquerading', tactics: ['Defense Evasion'] },
    'T1070': { name: 'Indicator Removal', tactics: ['Defense Evasion'] },
    'T1112': { name: 'Modify Registry', tactics: ['Defense Evasion'] },
    'T1140': { name: 'Deobfuscate/Decode Files or Information', tactics: ['Defense Evasion'] },
    'T1218': { name: 'System Binary Proxy Execution', tactics: ['Defense Evasion'] },
    'T1547': { name: 'Boot or Logon Autostart Execution', tactics: ['Persistence', 'Privilege Escalation'] },
    'T1053': { name: 'Scheduled Task/Job', tactics: ['Execution', 'Persistence', 'Privilege Escalation'] },
    'T1543': { name: 'Create or Modify System Process', tactics: ['Persistence', 'Privilege Escalation'] },
    'T1574': { name: 'Hijack Execution Flow', tactics: ['Persistence', 'Privilege Escalation', 'Defense Evasion'] },
    'T1068': { name: 'Exploitation for Privilege Escalation', tactics: ['Privilege Escalation'] },
    'T1134': { name: 'Access Token Manipulation', tactics: ['Defense Evasion', 'Privilege Escalation'] },
    'T1548': { name: 'Abuse Elevation Control Mechanism', tactics: ['Privilege Escalation', 'Defense Evasion'] },
    'T1555': { name: 'Credentials from Password Stores', tactics: ['Credential Access'] },
    'T1556': { name: 'Modify Authentication Process', tactics: ['Credential Access', 'Defense Evasion', 'Persistence'] },
    'T1558': { name: 'Steal or Forge Kerberos Tickets', tactics: ['Credential Access'] },
    'T1187': { name: 'Forced Authentication', tactics: ['Credential Access'] },
    'T1539': { name: 'Steal Web Session Cookie', tactics: ['Credential Access'] },
    'T1213': { name: 'Data from Information Repositories', tactics: ['Collection'] },
    'T1005': { name: 'Data from Local System', tactics: ['Collection'] },
    'T1039': { name: 'Data from Network Shared Drive', tactics: ['Collection'] },
    'T1113': { name: 'Screen Capture', tactics: ['Collection'] },
    'T1056': { name: 'Input Capture', tactics: ['Collection', 'Credential Access'] },
    'T1029': { name: 'Scheduled Transfer', tactics: ['Exfiltration'] },
    'T1048': { name: 'Exfiltration Over Alternative Protocol', tactics: ['Exfiltration'] }
};

let _extendedTechniques = {};
let _enabled = true;

/**
 * Optionally load extended technique metadata from a JSON endpoint.
 * The endpoint should return a flat { "TID": { name, tactics: [] } } object.
 */
export function loadExtendedLookup(url) {
    if (!url || typeof fetch !== 'function') return Promise.resolve();
    return fetch(url, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
            if (j && typeof j === 'object') {
                _extendedTechniques = j;
            }
        })
        .catch(function () { /* ignore — degrade to built-in */ });
}

function lookup(id) {
    if (!id) return null;
    return _extendedTechniques[id] || TECHNIQUES[id] || null;
}

function parseIds(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    return String(raw).split(/[,\s;|]+/).filter(Boolean);
}

/**
 * Enrich a FeatureCollection by adding attack_techniques to each feature
 * whose properties.attack_id contains a known technique.
 */
export function enrich(fc) {
    if (!fc || !fc.features) return fc;
    return {
        type: 'FeatureCollection',
        features: fc.features.map(function (f) {
            const p = f.properties || {};
            const ids = parseIds(p.attack_id || p.attack || p.technique);
            const techniques = ids.map(lookup).filter(Boolean);
            return {
                type: 'Feature',
                geometry: f.geometry,
                properties: Object.assign({}, p, {
                    attack_ids: ids,
                    attack_techniques: techniques
                })
            };
        })
    };
}

/**
 * Build a markdown tooltip body for the markdownPopup widget.
 */
export function formatTooltip(props) {
    const techniques = (props && props.attack_techniques) || [];
    if (!techniques.length) return '';
    const lines = ['### MITRE ATT&CK', ''];
    techniques.forEach(function (t, i) {
        const id = props.attack_ids[i] || '';
        const tactics = (t.tactics || []).join(', ');
        lines.push('- **' + id + ' — ' + t.name + '**');
        if (tactics) lines.push('  Tactics: ' + tactics);
    });
    return lines.join('\n');
}

/**
 * Emit an `action.correlationsearch.annotations` stanza fragment ready
 * to paste into `savedsearches.conf`. Splunk ES uses this exact JSON
 * shape (see ES technical docs).
 *
 * Example output:
 *   action.correlationsearch.annotations =
 *     {"mitre_attack":["T1110","T1078"],"cis20":[],"nist":[],"kill_chain_phases":[]}
 */
export function annotationStanza(attackIds, extras) {
    const annotations = {
        mitre_attack: (attackIds || []).slice(),
        cis20: (extras && extras.cis20) || [],
        nist: (extras && extras.nist) || [],
        kill_chain_phases: (extras && extras.killChainPhases) || []
    };
    return 'action.correlationsearch.annotations = ' + JSON.stringify(annotations);
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() { _extendedTechniques = {}; }
