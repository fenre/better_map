/*
 * Geocoder widget — top-right search box that resolves a place name to
 * a lon/lat and pans the map.
 *
 * Backed by Nominatim (OpenStreetMap's free geocoder) by default. The
 * service URL is fully overridable via `opts.endpoint` so a customer
 * can point at MapBox/MapTiler/their own ArcGIS GeocodeServer without
 * changing code. Splunk Cloud installs that egress-filter to specific
 * domains can substitute a customer-hosted geocoder endpoint.
 *
 * BM-CT-1 contract — exposes `setEnabled / isEnabled / reset` so the
 * control-panel auto-registration in visualization_source.js wires it
 * up as a fancy action like every other interactive widget.
 *
 * Privacy: queries are sent only when the user explicitly types and
 * hits Enter (or selects a debounced suggestion). No keystroke
 * telemetry. No background queries.
 *
 * Threat model: Nominatim returns plain JSON; we DOMPurify any string
 * that lands in the DOM (display_name can contain quirky unicode and
 * accidental HTML-looking content from OSM users).
 */

import DOMPurify from 'dompurify';

const ROOT_CLASS = 'better_map-geocoder';
const INPUT_CLASS = 'better_map-geocoder__input';
const BUTTON_CLASS = 'better_map-geocoder__button';
const RESULTS_CLASS = 'better_map-geocoder__results';
const RESULT_ITEM_CLASS = 'better_map-geocoder__result';

const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_LIMIT = 6;
const DEBOUNCE_MS = 350;

/**
 * Build a new geocoder widget attached to the viz container.
 *
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder     MapBuilder — used for flyTo() and
 *                                  for setDashboardDefaults() lookup.
 * @param {string} [opts.endpoint]  Override Nominatim base URL.
 * @param {number} [opts.zoom]      Zoom-to level (default 11).
 * @param {string} [opts.placeholder] Input placeholder text.
 * @param {Function} [opts.onSelect] (result) => void — fired after the
 *                                  map flies; result is the chosen
 *                                  Nominatim record.
 */
export function createGeocoder(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    const endpoint = options.endpoint || DEFAULT_ENDPOINT;
    const flyZoom = isFinite(options.zoom) ? options.zoom : 11;
    const placeholder = options.placeholder || 'Search location';
    const onSelect = typeof options.onSelect === 'function' ? options.onSelect : function () {};

    let _enabled = true;
    let _debounceId = null;
    let _abortController = null;

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('role', 'search');
    root.setAttribute('aria-label', 'Geographic place search');

    const input = document.createElement('input');
    input.className = INPUT_CLASS;
    input.type = 'search';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', 'Search for a place');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    const button = document.createElement('button');
    button.className = BUTTON_CLASS;
    button.type = 'button';
    button.setAttribute('aria-label', 'Run search');
    button.textContent = '⌕';

    const results = document.createElement('ul');
    results.className = RESULTS_CLASS;
    results.setAttribute('role', 'listbox');
    results.style.display = 'none';

    root.appendChild(input);
    root.appendChild(button);
    root.appendChild(results);
    parentEl.appendChild(root);

    function clearResults() {
        results.innerHTML = '';
        results.style.display = 'none';
    }

    function renderResults(items) {
        results.innerHTML = '';
        if (!items || !items.length) {
            const empty = document.createElement('li');
            empty.className = RESULT_ITEM_CLASS;
            empty.textContent = 'No matches';
            empty.setAttribute('aria-disabled', 'true');
            results.appendChild(empty);
        } else {
            items.forEach(function (item, idx) {
                const li = document.createElement('li');
                li.className = RESULT_ITEM_CLASS;
                li.setAttribute('role', 'option');
                li.setAttribute('tabindex', '0');
                const safeName = DOMPurify.sanitize(item.display_name || '');
                li.textContent = safeName;
                li.addEventListener('click', function () { choose(item); });
                li.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        choose(item);
                    }
                });
                if (idx === 0) {
                    li.classList.add('better_map-geocoder__result--first');
                }
                results.appendChild(li);
            });
        }
        results.style.display = '';
    }

    function choose(item) {
        if (!builder || !builder.map) {
            return;
        }
        const lon = parseFloat(item.lon);
        const lat = parseFloat(item.lat);
        if (!isFinite(lon) || !isFinite(lat)) {
            return;
        }
        try {
            builder.map.flyTo({ center: [lon, lat], zoom: flyZoom, duration: 1200 });
        } catch (_e) { /* swallow */ }
        clearResults();
        input.value = item.display_name || '';
        onSelect(item);
    }

    function query(text) {
        if (_abortController) {
            try { _abortController.abort(); } catch (_e) { /* noop */ }
        }
        _abortController = (typeof AbortController === 'function') ? new AbortController() : null;
        const url = endpoint + '?format=json&limit=' + DEFAULT_LIMIT +
            '&addressdetails=0&q=' + encodeURIComponent(text);
        fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: _abortController ? _abortController.signal : undefined
        }).then(function (resp) {
            if (!resp.ok) {
                throw new Error('Geocoder HTTP ' + resp.status);
            }
            return resp.json();
        }).then(function (items) {
            renderResults(items);
        }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[better_map] geocoder failed:', err);
            }
            renderResults([]);
        });
    }

    function debounceQuery() {
        if (_debounceId) {
            clearTimeout(_debounceId);
        }
        const text = (input.value || '').trim();
        if (!text || text.length < 2) {
            clearResults();
            return;
        }
        _debounceId = setTimeout(function () { query(text); }, DEBOUNCE_MS);
    }

    input.addEventListener('input', debounceQuery);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (_debounceId) { clearTimeout(_debounceId); _debounceId = null; }
            const text = (input.value || '').trim();
            if (text) query(text);
        } else if (e.key === 'Escape') {
            clearResults();
            input.blur();
        } else if (e.key === 'ArrowDown') {
            const first = results.querySelector('.' + RESULT_ITEM_CLASS);
            if (first && first.focus) { first.focus(); e.preventDefault(); }
        }
    });
    button.addEventListener('click', function () {
        const text = (input.value || '').trim();
        if (text) query(text);
    });

    function setEnabled(enabled) {
        _enabled = !!enabled;
        root.style.display = _enabled ? '' : 'none';
        if (!_enabled) {
            clearResults();
        }
    }

    function isEnabled() {
        return _enabled;
    }

    function reset() {
        input.value = '';
        clearResults();
    }

    function destroy() {
        if (_debounceId) clearTimeout(_debounceId);
        if (_abortController) {
            try { _abortController.abort(); } catch (_e) { /* noop */ }
        }
        if (root.parentNode) {
            root.parentNode.removeChild(root);
        }
    }

    return {
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy
    };
}
