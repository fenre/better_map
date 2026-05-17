#!/usr/bin/env python3
"""
Q-1B — Dashboard ↔ widget token cross-check (Theme G follow-up to SPATIAL-1).

Asserts that every `$better_map.<name>$` Splunk Dashboard Studio token
consumed by any dashboard under `better_map/default/data/ui/views/*.xml`
has a matching string-literal producer somewhere in the widget source
tree at `better_map/appserver/static/visualizations/better_map/src/lib/`.

Why this exists (root-cause traceability)
-----------------------------------------
SPATIAL-1: the v1.6 spatial-analytics showcase dashboard consumed
`$better_map.spatial_query$` — the documented contract that matches
`savedsearches.conf.spec` and `formatter.html` user-facing help — but
`spatialQuery.js` defaulted to the non-namespaced `bm_spatial_filter`.
The widget emitted SPL into a token nothing read. Every brushed /
lassoed / drawn shape was silently dropped on the dashboard side, even
though the widget itself emitted SPL correctly. There was no test
asserting the default token name, no IDE diagnostic, no runtime error;
the nudge UX flashed "SPL emitted to $bm_spatial_filter$" which is
technically truthful but only useful if you're reading the screen at
the right moment AND know what the dashboard wanted.

This gate catches that class of regression at PR time without needing
a dedicated unit test per widget. A new dashboard panel that references
a typo'd or unimplemented `better_map.*` token will fail the PR with a
one-line message pointing at the offending dashboard.

The contract
------------
Every `$better_map.<name>$` token reference in any Dashboard Studio v2
JSON definition MUST be matched by a single-or-double-quoted string
literal `'better_map.<name>'` or `"better_map.<name>"` somewhere under
`better_map/appserver/static/visualizations/better_map/src/lib/`.

Why scoped to the `better_map.*` namespace
------------------------------------------
- `better_map.*` is the project-owned token surface that widgets emit.
  Token producers live in a SEPARATE artifact (widget JS) from the
  consumers (dashboard JSON), so dashboard ↔ producer drift is silent.
  That's the regression class this gate fixes.
- Standard Splunk tokens (`$earliest$`, `$latest$`, `$form.*$`,
  `$<input_id>$`) are produced by dashboard inputs in the SAME JSON
  file as the consumer. Splunk's own runtime surfaces missing input
  tokens visibly; they are not silent the way SPATIAL-1 was. We do
  NOT validate those here — the per-dashboard `inputs:` block is the
  source of truth and Splunk catches mismatches.
- Other custom-namespace tokens (`$tok_zone$`, etc. in v1.6
  showcases) are dashboard-local conventions, not widget-emitted.
  Out of scope for this gate.

Why this is asymmetric
----------------------
- Consumer without producer  → FAIL (silently broken UX, SPATIAL-1 class)
- Producer without consumer  → PASS (intentional API surface for
                                       customer dashboards; e.g. the
                                       crossPanel `better_map.camera.*`,
                                       `better_map.selected.*`, and
                                       `better_map.time.*` tokens have
                                       no v1.6 consumer in the bundled
                                       showcases but ARE a documented
                                       extension point per crossPanel.js
                                       docstring).

Exit codes
----------
  0  every consumed token has a producer literal (PASS)
  1  at least one consumed token is orphan (FAIL); per-token error
     printed in a copy-pasteable form
  2  internal error (missing views dir, missing src dir, etc.)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
VIEWS_DIR = REPO_ROOT / "better_map" / "default" / "data" / "ui" / "views"
SRC_LIB_DIR = (
    REPO_ROOT
    / "better_map"
    / "appserver"
    / "static"
    / "visualizations"
    / "better_map"
    / "src"
    / "lib"
)

# Match `$better_map.<dotted_name>$` exactly. The dotted_name allows
# letters / digits / underscore / period (so we catch sub-namespaces
# like `better_map.camera.lng`).
TOKEN_RE = re.compile(r"\$(better_map\.[A-Za-z_][A-Za-z0-9_.]*)\$")

# Match a string literal `'better_map.<dotted_name>'` or the
# double-quoted variant in JS source. JS has no other context where a
# `better_map.<X>` literal would legitimately appear (we own the
# namespace), so a single regex sweep is sufficient.
LITERAL_RE = re.compile(
    r"""['"](better_map\.[A-Za-z_][A-Za-z0-9_.]*)['"]"""
)


def _find_token_consumers() -> list[tuple[str, Path, int]]:
    """Walk dashboard files and return (token, path, line_number) tuples."""
    consumers: list[tuple[str, Path, int]] = []
    for path in sorted(VIEWS_DIR.glob("*.xml")):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            # Q-1 (parse check) catches this; here we just skip.
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            for m in TOKEN_RE.finditer(line):
                consumers.append((m.group(1), path, line_no))
    return consumers


def _find_token_producers() -> set[str]:
    """Walk src/lib/**/*.js and return the set of `better_map.*` literals."""
    producers: set[str] = set()
    if not SRC_LIB_DIR.is_dir():
        return producers
    for path in SRC_LIB_DIR.rglob("*.js"):
        # Skip test files — they reference the literal *in assertions*
        # so a test asserting `expect(token).toBe('better_map.foo')`
        # would falsely satisfy the producer requirement if the actual
        # widget code did NOT emit it. Restricting producers to
        # non-test code keeps the gate honest: the literal must appear
        # in the runtime path, not just in a test.
        parts = set(path.parts)
        if "__tests__" in parts or path.name.endswith(".test.js"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for m in LITERAL_RE.finditer(text):
            producers.add(m.group(1))
    return producers


def _format_orphans(orphans: Iterable[tuple[str, list[tuple[Path, int]]]]) -> str:
    """Render a copy-pasteable failure block."""
    out: list[str] = []
    for token, sites in orphans:
        out.append("")
        out.append(f"    Token:    better_map.{token.split('.', 1)[1] if '.' in token else token}")
        # Render full token as authored (we already stripped the `$...$`):
        out[-1] = f"    Token:    {token}"
        for path, line_no in sites:
            rel = path.relative_to(REPO_ROOT)
            out.append(f"    Consumed: {rel} (line {line_no})")
        out.append(
            "    Expected: a string literal `'" + token + "'` (or the "
            "double-quoted variant)"
        )
        out.append(
            "              somewhere under "
            "better_map/appserver/static/visualizations/better_map/src/lib/"
        )
    return "\n".join(out)


def main() -> int:
    if not VIEWS_DIR.is_dir():
        print(f"ERROR: views directory not found at {VIEWS_DIR}", file=sys.stderr)
        return 2
    if not SRC_LIB_DIR.is_dir():
        print(f"ERROR: src/lib directory not found at {SRC_LIB_DIR}", file=sys.stderr)
        return 2

    consumers = _find_token_consumers()
    producers = _find_token_producers()

    # Group consumers by token name so the failure block lists each token
    # once with all the dashboards that reference it.
    by_token: dict[str, list[tuple[Path, int]]] = {}
    for token, path, line_no in consumers:
        by_token.setdefault(token, []).append((path, line_no))

    orphan_tokens = [t for t in sorted(by_token) if t not in producers]
    consumed_token_count = len(by_token)

    # Distinct dashboards that contributed at least one token reference.
    consumer_dashboards = sorted({str(p) for _, p, _ in consumers})

    print("Q-1B — Dashboard ↔ widget token cross-check")
    print(f"  Dashboards scanned:     {len(list(VIEWS_DIR.glob('*.xml')))}")
    print(f"  Dashboards w/ tokens:   {len(consumer_dashboards)}")
    print(f"  Distinct tokens used:   {consumed_token_count}")
    print(f"  Producer literals:      {len(producers)} unique (in src/lib/**/*.js)")
    print(f"  Orphan tokens:          {len(orphan_tokens)}")

    if orphan_tokens:
        orphan_pairs = [(t, by_token[t]) for t in orphan_tokens]
        print("")
        print("  FAIL — these `better_map.*` tokens are consumed by a")
        print("  dashboard but have no producer literal in src/lib/**/*.js:")
        print(_format_orphans(orphan_pairs))
        print("")
        print(
            "  Most likely cause: the widget that emits this token uses a"
        )
        print(
            "  different default tokenName. Check src/lib/widgets/*.js for"
        )
        print(
            "  `tokenName = ...` declarations and align them with the"
        )
        print(
            "  dashboard JSON. SPATIAL-1 was exactly this shape; see"
        )
        print(
            "  ROADMAP §1c gap 16 and the regression test at"
        )
        print(
            "  src/lib/widgets/__tests__/spatialQuery.test.js."
        )
        return 1

    # On success, list every (token → producer-found-in-source) pair so
    # the CI log is self-documenting and future debugging is fast.
    print("")
    print("  Token contract honoured:")
    for token in sorted(by_token):
        dash_count = len({p for p, _ in by_token[token]})
        plural = "" if dash_count == 1 else "s"
        print(f"    ${token}$ → consumed in {dash_count} dashboard{plural}")
    print("")
    print("  PASS — every `better_map.*` dashboard token has a producer.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — top-level catch for CI clarity
        print(f"Q-1B internal error: {e}", file=sys.stderr)
        sys.exit(2)
