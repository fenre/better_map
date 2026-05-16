/*
 * Command palette — keyboard launcher (⌘K / Ctrl+K) for quick actions.
 *
 * Inspired by VS Code's command palette and cmdk libraries. Pure DOM,
 * no React, no fancy framework — three-key principle (open with ⌘K,
 * type to filter, Enter to execute).
 *
 * Built-in commands:
 *   - Reset view
 *   - Toggle a layer (one entry per registered layer name)
 *   - Run a fancy action (one entry per registered animation)
 *   - Reset all motion
 *   - Pause / resume all motion
 *   - Export PNG
 *   - Copy share link
 *
 * Extensibility: pass `opts.commands = [{ id, label, hint, action }]`
 * to register dashboard-specific commands (e.g. "Open notable in ES",
 * "Run SOAR playbook X").
 *
 * BM-CT-1 contract — exposes setEnabled / isEnabled / reset.
 */

const ROOT_CLASS = 'better_map-cmdk';
const BACKDROP_CLASS = 'better_map-cmdk__backdrop';
const PANEL_CLASS = 'better_map-cmdk__panel';
const INPUT_CLASS = 'better_map-cmdk__input';
const LIST_CLASS = 'better_map-cmdk__list';
const ITEM_CLASS = 'better_map-cmdk__item';
const ITEM_ACTIVE_CLASS = 'better_map-cmdk__item--active';
const ITEM_LABEL_CLASS = 'better_map-cmdk__item-label';
const ITEM_HINT_CLASS = 'better_map-cmdk__item-hint';
const FOOTER_CLASS = 'better_map-cmdk__footer';

/**
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {object} opts.builder      MapBuilder reference.
 * @param {Array}  [opts.commands]   Extra commands (see top-of-file).
 * @param {Function} [opts.onOpen]   Called when palette opens.
 * @param {Function} [opts.onClose]  Called when palette closes.
 */
export function createCommandPalette(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    const extraCommands = options.commands || [];

    let _enabled = true;
    let _open = false;
    let _activeIdx = 0;
    let _filtered = [];
    let _restoreFocusEl = null;

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Command palette');
    root.style.display = 'none';

    const backdrop = document.createElement('div');
    backdrop.className = BACKDROP_CLASS;

    const panel = document.createElement('div');
    panel.className = PANEL_CLASS;

    const input = document.createElement('input');
    input.className = INPUT_CLASS;
    input.type = 'search';
    input.placeholder = 'Type a command…';
    input.setAttribute('aria-label', 'Command search');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    const list = document.createElement('ul');
    list.className = LIST_CLASS;
    list.setAttribute('role', 'listbox');

    const footer = document.createElement('div');
    footer.className = FOOTER_CLASS;
    footer.textContent = '↑↓ navigate · ↵ run · esc close · ⌘K to open';

    panel.appendChild(input);
    panel.appendChild(list);
    panel.appendChild(footer);
    root.appendChild(backdrop);
    root.appendChild(panel);
    parentEl.appendChild(root);

    function buildCommands() {
        const cmds = [];
        if (builder && typeof builder.resetView === 'function') {
            cmds.push({
                id: 'reset_view',
                label: 'Reset view',
                hint: 'Camera + animations + master pause',
                action: function () { builder.resetView(); }
            });
        }
        if (builder && typeof builder.setMotionPaused === 'function') {
            const paused = builder.isMotionPaused && builder.isMotionPaused();
            cmds.push({
                id: 'toggle_motion',
                label: paused ? 'Resume all motion' : 'Pause all motion',
                hint: 'Master suppress (overrides per-action toggles)',
                action: function () { builder.setMotionPaused(!paused); }
            });
        }
        if (builder && typeof builder.resetAllMotion === 'function') {
            cmds.push({
                id: 'reset_motion',
                label: 'Reset all animations',
                hint: 'Re-apply dashboard defaults',
                action: function () { builder.resetAllMotion(); }
            });
        }
        if (builder && typeof builder.getFancyActions === 'function') {
            const actions = builder.getFancyActions() || [];
            actions.forEach(function (a) {
                const enabled = a.isEnabled();
                cmds.push({
                    id: 'fa_' + a.id,
                    label: (enabled ? 'Disable: ' : 'Enable: ') + a.label,
                    hint: 'Per-action toggle',
                    action: function () { a.setEnabled(!a.isEnabled()); }
                });
            });
        }
        for (let i = 0; i < extraCommands.length; i++) {
            cmds.push(extraCommands[i]);
        }
        return cmds;
    }

    function filterCommands(q) {
        const allCmds = buildCommands();
        const text = (q || '').toLowerCase().trim();
        if (!text) return allCmds;
        return allCmds.filter(function (c) {
            const label = (c.label || '').toLowerCase();
            const hint = (c.hint || '').toLowerCase();
            return label.indexOf(text) !== -1 || hint.indexOf(text) !== -1;
        });
    }

    function render() {
        list.innerHTML = '';
        _filtered = filterCommands(input.value);
        if (_activeIdx >= _filtered.length) {
            _activeIdx = Math.max(0, _filtered.length - 1);
        }
        if (!_filtered.length) {
            const li = document.createElement('li');
            li.className = ITEM_CLASS;
            li.textContent = 'No matching commands';
            li.setAttribute('aria-disabled', 'true');
            list.appendChild(li);
            return;
        }
        _filtered.forEach(function (cmd, idx) {
            const li = document.createElement('li');
            li.className = ITEM_CLASS + (idx === _activeIdx ? ' ' + ITEM_ACTIVE_CLASS : '');
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', idx === _activeIdx ? 'true' : 'false');
            const lab = document.createElement('span');
            lab.className = ITEM_LABEL_CLASS;
            lab.textContent = cmd.label;
            const hint = document.createElement('span');
            hint.className = ITEM_HINT_CLASS;
            hint.textContent = cmd.hint || '';
            li.appendChild(lab);
            li.appendChild(hint);
            li.addEventListener('mouseenter', function () {
                _activeIdx = idx;
                render();
            });
            li.addEventListener('click', function () {
                run(cmd);
            });
            list.appendChild(li);
        });
    }

    function run(cmd) {
        if (!cmd) return;
        close();
        try { cmd.action(); } catch (err) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[better_map] command failed:', err);
            }
        }
    }

    function open() {
        if (!_enabled) return;
        _open = true;
        _restoreFocusEl = document.activeElement;
        root.style.display = '';
        input.value = '';
        _activeIdx = 0;
        render();
        setTimeout(function () { input.focus(); }, 0);
        if (typeof options.onOpen === 'function') options.onOpen();
    }

    function close() {
        _open = false;
        root.style.display = 'none';
        if (_restoreFocusEl && typeof _restoreFocusEl.focus === 'function') {
            try { _restoreFocusEl.focus(); } catch (_e) { /* swallow */ }
        }
        if (typeof options.onClose === 'function') options.onClose();
    }

    function toggle() {
        if (_open) close(); else open();
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (_filtered.length) {
                _activeIdx = (_activeIdx + 1) % _filtered.length;
                render();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (_filtered.length) {
                _activeIdx = (_activeIdx - 1 + _filtered.length) % _filtered.length;
                render();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            run(_filtered[_activeIdx]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    });
    backdrop.addEventListener('click', close);

    const onGlobalKey = function (e) {
        if (!_enabled) return;
        // ⌘K (Mac) or Ctrl+K (others)
        const isK = e.key === 'k' || e.key === 'K';
        if (isK && (e.metaKey || e.ctrlKey) && !e.altKey) {
            e.preventDefault();
            toggle();
        }
    };
    document.addEventListener('keydown', onGlobalKey);

    function setEnabled(enabled) {
        _enabled = !!enabled;
        if (!_enabled && _open) close();
    }

    function isEnabled() {
        return _enabled;
    }

    function reset() {
        close();
        input.value = '';
        _activeIdx = 0;
    }

    function destroy() {
        document.removeEventListener('keydown', onGlobalKey);
        if (root.parentNode) {
            root.parentNode.removeChild(root);
        }
    }

    return {
        open: open,
        close: close,
        toggle: toggle,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        reset: reset,
        destroy: destroy
    };
}
