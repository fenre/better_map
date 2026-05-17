/*
 * Spatial-query emitter.
 *
 * Listens for `bm:draw-finished` and `bm:lasso-select` events from the
 * draw and lasso widgets, then translates the drawn / selected geometry
 * into an SPL fragment and pushes that fragment into:
 *
 *   1. A Splunk Dashboard token (via the SplunkVisualizationBase /
 *      Splunk Web token model, when available)
 *   2. A `bm:spatial-query` CustomEvent on the viz container, so
 *      dashboard-side JS can pick it up if tokens aren't desired
 *   3. The clipboard, if the user invokes the "Copy SPL filter"
 *      action from the lasso context menu (registered here)
 *
 * SPL emission contract:
 *
 *   Polygon (incl. rectangle / lasso):
 *       | where geomatch(lat_field, lon_field, "POLYGON((...))")
 *
 *   Circle:
 *       | where ((acos(sin(lat_field*pi()/180)*sin(<cy>*pi()/180) +
 *                   cos(lat_field*pi()/180)*cos(<cy>*pi()/180)*
 *                   cos((<cx>-lon_field)*pi()/180))) * 6371) < <km>
 *
 *   Selection (lasso result with N feature IDs):
 *       | where id IN ("id1", "id2", ...)
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 *
 * NOTE: `geomatch` is a Splunk Enterprise Security KV-store/cluster
 * helper command that ships with the App for ES; for vanilla Splunk
 * the dashboard author swaps in a `cluster`-based fallback. The
 * emitted SPL is therefore best treated as a TEMPLATE that the
 * customer adapts to their content packs.
 */

const NUDGE_CLASS = 'better_map-spatial-query__nudge';

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {string} [opts.tokenName='better_map.spatial_query']
 *   Splunk Dashboard Studio token name to receive the emitted SPL
 *   fragment. Defaults to the `better_map.*` namespace that the
 *   showcase dashboards (`better_map_spatial_analytics.xml`),
 *   `savedsearches.conf.spec` documentation, and `formatter.html`
 *   user-facing help text all reference. Prior to SPATIAL-1 this
 *   defaulted to `bm_spatial_filter`, breaking the dashboard ↔ widget
 *   contract: the showcase dashboard consumed `$better_map.spatial_query$`
 *   but the widget emitted into `$bm_spatial_filter$`, so the spatial
 *   filter never reached the bound panels. Customers overriding the
 *   token name should pass `opts.tokenName`.
 * @param {string} [opts.latField='lat']
 * @param {string} [opts.lonField='lon']
 * @param {string} [opts.idField='id']
 * @param {Function} [opts.tokenSetter] Optional (name, value) => void
 *                                       to integrate with a custom
 *                                       Dashboard Studio token model.
 */
export function createSpatialQuery(parentEl, opts) {
    const options = opts || {};
    // SPATIAL-1 fix: align the default with the documented contract.
    // The matching dashboard panels, savedsearches.conf.spec entry, and
    // formatter.html help text ALL reference `better_map.spatial_query`.
    // Keep the `better_map.*` namespace consistent with crossPanel.js
    // TOKEN_PREFIX so downstream tokens are discoverable as a group.
    const tokenName = options.tokenName || 'better_map.spatial_query';
    const latField = options.latField || 'lat';
    const lonField = options.lonField || 'lon';
    const idField = options.idField || 'id';
    const tokenSetter = typeof options.tokenSetter === 'function' ? options.tokenSetter : null;

    let _enabled = true;
    let _lastSpl = '';

    function polygonToSpl(polyFeature) {
        const ring = polyFeature.geometry.coordinates[0];
        const wkt = ring.map(function (c) { return c[0].toFixed(6) + ' ' + c[1].toFixed(6); }).join(', ');
        return '| where geomatch(' + latField + ', ' + lonField + ', "POLYGON((' + wkt + '))")';
    }

    function circleToSpl(circleFeature) {
        // The draw widget stores radiusKm in properties for circle mode.
        const km = (circleFeature.properties && circleFeature.properties.radiusKm) || 0;
        // Find the centre as the centroid of the polygon's ring.
        const ring = circleFeature.geometry.coordinates[0];
        const n = ring.length;
        let cx = 0, cy = 0;
        ring.forEach(function (c) { cx += c[0]; cy += c[1]; });
        cx /= n; cy /= n;
        return [
            '| eval _km = acos(sin(' + latField + '*pi()/180)*sin(' + cy.toFixed(6) + '*pi()/180)',
            '       + cos(' + latField + '*pi()/180)*cos(' + cy.toFixed(6) + '*pi()/180)',
            '       *cos((' + cx.toFixed(6) + '-' + lonField + ')*pi()/180)) * 6371',
            '| where _km < ' + km.toFixed(3),
            '| fields - _km'
        ].join(' ');
    }

    function selectionToSpl(selection) {
        const ids = selection.map(function (s) { return String(s.id == null ? '' : s.id); }).filter(Boolean);
        if (!ids.length) return '';
        const quoted = ids.map(function (id) { return '"' + id.replace(/"/g, '\\"') + '"'; }).join(', ');
        return '| where ' + idField + ' IN (' + quoted + ')';
    }

    function emit(splFragment) {
        _lastSpl = splFragment;
        // 1. Splunk Dashboard token (Studio v2).
        if (tokenSetter) {
            try { tokenSetter(tokenName, splFragment); } catch (_e) { /* swallow */ }
        }
        // Best-effort: poke the global TokenUtils if present (works
        // inside Splunk Web's RequireJS context).
        try {
            // eslint-disable-next-line no-undef
            if (typeof window !== 'undefined' && window.SplunkVisualizationUtils &&
                typeof window.SplunkVisualizationUtils.setToken === 'function') {
                window.SplunkVisualizationUtils.setToken(tokenName, splFragment);
            }
        } catch (_e) { /* swallow */ }
        // 2. CustomEvent.
        try {
            parentEl.dispatchEvent(new CustomEvent('bm:spatial-query', { detail: { token: tokenName, spl: splFragment } }));
        } catch (_e) { /* swallow */ }
        // 3. Nudge UX: small flash near the bottom-right.
        nudge(splFragment);
    }

    function nudge(spl) {
        const n = document.createElement('div');
        n.className = NUDGE_CLASS;
        n.textContent = 'SPL emitted to $' + tokenName + '$';
        n.setAttribute('title', spl);
        parentEl.appendChild(n);
        setTimeout(function () {
            if (n && n.parentNode) n.parentNode.removeChild(n);
        }, 2400);
    }

    function onDrawFinished(e) {
        if (!_enabled) return;
        const f = e.detail && e.detail.feature;
        if (!f) return;
        const mode = (f.properties && f.properties.mode) || (e.detail && e.detail.mode) || '';
        if (mode === 'polygon' || mode === 'rectangle') {
            emit(polygonToSpl(f));
        } else if (mode === 'circle') {
            emit(circleToSpl(f));
        }
    }

    function onLassoSelect(e) {
        if (!_enabled) return;
        const sel = (e.detail && e.detail.features) || [];
        const spl = selectionToSpl(sel);
        if (spl) emit(spl);
    }

    parentEl.addEventListener('bm:draw-finished', onDrawFinished);
    parentEl.addEventListener('bm:lasso-select', onLassoSelect);

    function getLastSpl() {
        return _lastSpl;
    }
    function setEnabled(enabled) {
        _enabled = !!enabled;
    }
    function isEnabled() { return _enabled; }
    function reset() {
        _lastSpl = '';
        if (tokenSetter) {
            try { tokenSetter(tokenName, ''); } catch (_e) { /* swallow */ }
        }
    }
    function destroy() {
        parentEl.removeEventListener('bm:draw-finished', onDrawFinished);
        parentEl.removeEventListener('bm:lasso-select', onLassoSelect);
    }

    return {
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy,
        getLastSpl: getLastSpl,
        tokenName: tokenName
    };
}
