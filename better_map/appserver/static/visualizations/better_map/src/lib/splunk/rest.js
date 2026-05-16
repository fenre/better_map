/*
 * Splunk REST helpers shared across moat modules.
 *
 * - csrfTokenFromCookie()      pulls the Splunk Web CSRF form key out
 *                              of `splunkweb_csrf_token_<port>` cookies
 * - splunkdFetch(path, init)   wraps fetch() to default to
 *                              `credentials: 'same-origin'` and add the
 *                              CSRF header automatically
 * - parseJsonOutput(body)      tolerant JSON parsing for Splunk REST
 *                              responses (handles `output_mode=json` and
 *                              raw `data` strings)
 */

export function csrfTokenFromCookie() {
    if (typeof document === 'undefined' || !document.cookie) return '';
    const match = document.cookie.match(/(?:^|;\s*)splunkweb_csrf_token[^=]*=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

export function splunkdFetch(path, init) {
    if (typeof fetch !== 'function') {
        return Promise.resolve({ ok: false, status: 0, body: '' });
    }
    const opts = Object.assign({ credentials: 'same-origin' }, init || {});
    opts.headers = Object.assign({}, opts.headers || {});
    const csrf = csrfTokenFromCookie();
    if (csrf && (opts.method || 'GET').toUpperCase() !== 'GET') {
        opts.headers['X-Splunk-Form-Key'] = csrf;
    }
    if (opts.body && !opts.headers['Content-Type']
        && !(opts.body instanceof FormData)
        && typeof opts.body !== 'string') {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
        return r.text().then(function (body) {
            return { ok: r.ok, status: r.status, body: body, headers: r.headers };
        });
    });
}

export function parseJsonOutput(body) {
    if (!body) return null;
    try { return JSON.parse(body); } catch (_e) { /* swallow */ }
    // Splunk sometimes returns nested data field with stringified JSON.
    return null;
}
