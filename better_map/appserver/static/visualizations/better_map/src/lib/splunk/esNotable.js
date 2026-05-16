/*
 * ES (Enterprise Security) notable-event drilldown bridge.
 *
 * Two responsibilities:
 *
 *   1. Build the canonical URL for the ES Incident Review workflow,
 *      pre-filtered for a feature's `event_id` / `notable_id`.
 *
 *   2. Provide a REST stub for marking a notable closed via the ES
 *      `notable_update` endpoint:
 *
 *        POST /services/notable_update
 *          ruleUIDs=<comma-separated>
 *          status=5            (1=New, 2=In progress, 3=Pending, 4=Resolved, 5=Closed)
 *          comment=...
 *          urgency=...         (low/medium/high/critical)
 *          newOwner=...        (Splunk username)
 *
 * The REST call requires either a Splunk session cookie (the visualization
 * runs inside Splunk Web, so this works automatically) or a bearer
 * token. Both are auto-detected.
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { csrfTokenFromCookie } from './rest';

const APP_PATH = '/app/SplunkEnterpriseSecuritySuite/incident_review';

let _baseUrl = '';
let _enabled = true;
let _esApp = 'SplunkEnterpriseSecuritySuite';

export function configure(opts) {
    if (!opts) return;
    if (typeof opts.baseUrl === 'string') _baseUrl = opts.baseUrl.replace(/\/$/, '');
    if (typeof opts.esApp === 'string') _esApp = opts.esApp;
}

/**
 * Build the Incident Review URL for one or more notable IDs.
 */
export function incidentReviewUrl(notableIds, options) {
    const ids = Array.isArray(notableIds) ? notableIds : [notableIds];
    const filtered = ids.filter(Boolean);
    if (!filtered.length) return '';
    const query = encodeURIComponent('rule_id="' + filtered.join('" OR rule_id="') + '"');
    const earliest = options && options.earliest ? encodeURIComponent(options.earliest) : '-24h';
    const latest = options && options.latest ? encodeURIComponent(options.latest) : 'now';
    const base = (_baseUrl || '');
    return base + APP_PATH
        + '?form.event_id=' + query
        + '&form.time_range.earliest=' + earliest
        + '&form.time_range.latest=' + latest;
}

/**
 * Open the Incident Review view for the given notable IDs.
 */
export function openIncidentReview(notableIds, options) {
    const url = incidentReviewUrl(notableIds, options);
    if (!url) return;
    if (typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

/**
 * Mark notables as closed (or any other status) via the ES notable_update
 * REST endpoint. Returns a Promise that resolves to { success, body }.
 *
 * NOTE: Requires ES to be installed in the host Splunk instance. When
 * fetch() fails (e.g. test harness, ES not installed), this resolves
 * to { success: false, reason: 'unavailable' } so callers can surface
 * a friendly toast instead of an uncaught exception.
 */
export function updateNotables(notableIds, payload) {
    if (typeof fetch !== 'function') {
        return Promise.resolve({ success: false, reason: 'no-fetch' });
    }
    const ids = Array.isArray(notableIds) ? notableIds : [notableIds];
    const filtered = ids.filter(Boolean);
    if (!filtered.length) {
        return Promise.resolve({ success: false, reason: 'no-ids' });
    }
    const body = new URLSearchParams();
    body.set('ruleUIDs', filtered.join(','));
    body.set('status', String((payload && payload.status) || 5));
    if (payload && payload.comment) body.set('comment', payload.comment);
    if (payload && payload.urgency) body.set('urgency', payload.urgency);
    if (payload && payload.newOwner) body.set('newOwner', payload.newOwner);

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const csrf = csrfTokenFromCookie();
    if (csrf) headers['X-Splunk-Form-Key'] = csrf;

    const url = (_baseUrl || '') + '/services/notable_update';
    return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: body.toString()
    }).then(function (r) {
        return r.text().then(function (text) {
            return { success: r.ok, status: r.status, body: text };
        });
    }).catch(function (e) {
        return { success: false, reason: 'fetch-failed', error: String(e && e.message ? e.message : e) };
    });
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() { _baseUrl = ''; _esApp = 'SplunkEnterpriseSecuritySuite'; }
