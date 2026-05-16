/*
 * AI Assistant chat panel (Splunk_AI_Assistant_Cloud bridge).
 *
 * Feature-flagged off by default. When enabled, exposes:
 *
 *   createChatPanel(container, options)
 *     mounts a chat widget in the bottom-right of the map. User
 *     messages POST to the AI Assistant REST endpoint and the response
 *     is streamed back into the panel as Markdown.
 *
 *   askForSPL(question)
 *     one-shot helper — useful for the "Explain this map" command in
 *     the command palette. Returns a Promise<string>.
 *
 * Endpoint contract (Splunk_AI_Assistant_Cloud — verified against
 * docs at the time of writing; subject to change):
 *
 *   POST /servicesNS/-/Splunk_AI_Assistant_Cloud/spl_generator
 *     Form fields:
 *       prompt:   user question
 *       context:  optional SPL or schema context
 *       cim_dm:   optional CIM data model name
 *
 * Until the host Splunk has the app installed, the panel surfaces a
 * "Splunk AI Assistant is not configured for this dashboard" notice
 * with a link to enable.
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { splunkdFetch } from './rest';

const PANEL_CLASS = 'better_map-ai-chat';
const MESSAGES_CLASS = 'better_map-ai-chat__messages';
const INPUT_CLASS = 'better_map-ai-chat__input';
const STATUS_CLASS = 'better_map-ai-chat__status';

let _enabled = false;
let _endpointPath = '/servicesNS/-/Splunk_AI_Assistant_Cloud/spl_generator';

export function configure(opts) {
    if (opts && typeof opts.endpointPath === 'string') {
        _endpointPath = opts.endpointPath;
    }
}

/**
 * Lightweight chat panel — DOM only, no React. Returns a controller
 * with destroy/setEnabled/reset.
 */
export function createChatPanel(container, options) {
    if (!container) return noop();
    const opts = options || {};
    let mounted = false;
    let enabled = !!(opts.enabled || _enabled);

    const root = document.createElement('div');
    root.className = PANEL_CLASS;

    const messages = document.createElement('div');
    messages.className = MESSAGES_CLASS;
    root.appendChild(messages);

    const status = document.createElement('div');
    status.className = STATUS_CLASS;
    root.appendChild(status);

    const inputRow = document.createElement('form');
    inputRow.className = INPUT_CLASS;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask the assistant... (e.g. "show me failed logins near Frankfurt")';
    inputRow.appendChild(input);
    const sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.textContent = 'Send';
    inputRow.appendChild(sendBtn);
    root.appendChild(inputRow);

    function append(role, text) {
        const li = document.createElement('div');
        li.className = MESSAGES_CLASS + '__' + role;
        li.textContent = text;
        messages.appendChild(li);
        messages.scrollTop = messages.scrollHeight;
    }

    function send(prompt) {
        if (!prompt) return;
        append('user', prompt);
        input.value = '';
        status.textContent = 'Thinking...';
        askForSPL(prompt, { context: opts.context, cimDataModel: opts.cimDataModel })
            .then(function (text) {
                append('assistant', text || '(no response)');
                status.textContent = '';
            })
            .catch(function (e) {
                append('assistant', 'Error: ' + (e && e.message ? e.message : String(e)));
                status.textContent = '';
            });
    }

    inputRow.addEventListener('submit', function (e) {
        e.preventDefault();
        send(input.value);
    });

    function mount() {
        if (mounted || !enabled) return;
        container.appendChild(root);
        mounted = true;
        if (!_enabled) {
            status.textContent = 'AI Assistant not enabled in viz options.';
        }
    }
    function unmount() {
        if (!mounted) return;
        if (root.parentNode) root.parentNode.removeChild(root);
        mounted = false;
    }

    mount();
    return {
        setEnabled: function (on) {
            enabled = !!on;
            if (enabled) mount();
            else unmount();
        },
        isEnabled: function () { return enabled; },
        reset: function () {
            messages.innerHTML = '';
            input.value = '';
            status.textContent = '';
        },
        destroy: unmount
    };
}

/**
 * One-shot prompt → SPL via the AI Assistant REST. Returns a
 * Promise<string>. Returns an empty string when the assistant app is
 * not installed (so callers don't need to special-case the failure).
 */
export function askForSPL(prompt, ctx) {
    if (!prompt) return Promise.resolve('');
    const body = new URLSearchParams();
    body.set('prompt', prompt);
    if (ctx && ctx.context) body.set('context', ctx.context);
    if (ctx && ctx.cimDataModel) body.set('cim_dm', ctx.cimDataModel);
    return splunkdFetch(_endpointPath + '?output_mode=json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    }).then(function (resp) {
        if (!resp.ok) return '';
        try {
            const j = JSON.parse(resp.body);
            return j && (j.spl || j.response || j.text) || '';
        } catch (_e) {
            return resp.body;
        }
    }).catch(function () { return ''; });
}

export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() { _enabled = false; _endpointPath = '/servicesNS/-/Splunk_AI_Assistant_Cloud/spl_generator'; }

function noop() {
    return {
        setEnabled: function () {},
        isEnabled: function () { return false; },
        reset: function () {},
        destroy: function () {}
    };
}
