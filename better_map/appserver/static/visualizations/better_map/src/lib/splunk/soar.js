/*
 * SOAR (Splunk SOAR / Phantom) playbook trigger.
 *
 * Right-click on a selected feature → menu item "Run SOAR playbook…"
 * which POSTs the selected entities to a configured `phantom_forward`
 * URL (typically `/services/phantom_forward`).
 *
 * The viz never holds API keys directly: the SOAR forwarder app on
 * the host Splunk handles authentication. The viz just hands over a
 * JSON payload containing:
 *
 *   { playbook_id, playbook_name, container_label, entities: [...] }
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { splunkdFetch } from './rest';

let _config = {
    forwardPath: '/services/phantom_forward',
    defaultPlaybookId: null,
    defaultPlaybookName: null,
    defaultContainerLabel: 'investigation'
};
let _enabled = true;

export function configure(opts) {
    if (!opts) return;
    if (typeof opts.forwardPath === 'string') _config.forwardPath = opts.forwardPath;
    if (opts.defaultPlaybookId != null) _config.defaultPlaybookId = opts.defaultPlaybookId;
    if (typeof opts.defaultPlaybookName === 'string') _config.defaultPlaybookName = opts.defaultPlaybookName;
    if (typeof opts.defaultContainerLabel === 'string') _config.defaultContainerLabel = opts.defaultContainerLabel;
}

/**
 * Translate a list of GeoJSON features into SOAR-friendly entity objects.
 */
function extractEntities(features) {
    return (features || []).map(function (f) {
        const p = f.properties || {};
        return {
            id: p.id || p.event_id || f.id,
            label: p.label || p.title || p.name || null,
            ip: p.src || p.ip || null,
            user: p.user || p.src_user || null,
            host: p.host || p.dest || null,
            lat: f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates[1] : null,
            lng: f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates[0] : null,
            properties: p
        };
    });
}

/**
 * Trigger a SOAR playbook for a set of features.
 *
 * @param {object[]} features  GeoJSON Features that were selected
 * @param {object} opts
 *   playbookId?: number|string
 *   playbookName?: string
 *   containerLabel?: string
 * @returns {Promise<{success:boolean, status?:number, body?:string, reason?:string}>}
 */
export function triggerPlaybook(features, opts) {
    if (!_enabled) {
        return Promise.resolve({ success: false, reason: 'disabled' });
    }
    const o = opts || {};
    const playbookId = o.playbookId || _config.defaultPlaybookId;
    const playbookName = o.playbookName || _config.defaultPlaybookName;
    if (!playbookId && !playbookName) {
        return Promise.resolve({ success: false, reason: 'no-playbook' });
    }
    const entities = extractEntities(features);
    if (!entities.length) {
        return Promise.resolve({ success: false, reason: 'no-entities' });
    }
    const payload = {
        playbook_id: playbookId,
        playbook_name: playbookName,
        container_label: o.containerLabel || _config.defaultContainerLabel,
        entities: entities,
        origin: 'better_map_v2'
    };
    return splunkdFetch(_config.forwardPath + '?output_mode=json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(function (resp) {
        return {
            success: resp.ok,
            status: resp.status,
            body: resp.body
        };
    }).catch(function (e) {
        return { success: false, reason: 'fetch-failed', error: String(e) };
    });
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() {
    _config = {
        forwardPath: '/services/phantom_forward',
        defaultPlaybookId: null,
        defaultPlaybookName: null,
        defaultContainerLabel: 'investigation'
    };
}
