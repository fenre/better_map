#!/usr/bin/env python3
"""CI gate: assert ``docs/_machine/formatter-schema.json`` matches the source.

Scope — ROADMAP §3 G7:
The machine-readable formatter schema is generated from
``better_map/appserver/static/visualizations/better_map/formatter.html`` by
``scripts/build-formatter-schema.py``. To keep the two in sync we use the
same pattern as the G3 manifest gate: regenerate from source via
``build-formatter-schema.py --stdout`` and assert byte-for-byte equality
with the file checked into git.

If they diverge, the gate FAILs with a unified diff and a one-line
remediation:

    To fix: run `python3 scripts/build-formatter-schema.py` and commit
    the new docs/_machine/formatter-schema.json.

A drift is one of three things:
  1. A new option was added in formatter.html without regenerating the
     schema (most common — addressed by running build-formatter-schema.py).
  2. The schema was edited by hand (forbidden — the comment at the top of
     the JSON says "Do NOT edit by hand"; regenerate from source).
  3. The extractor itself changed output format. In that case the new
     format is correct and the committed schema needs to be regenerated.

Exit codes::
    0 — schema in sync
    1 — schema drifted (printable diff is the body)
    2 — input file missing (no formatter.html or no checked-in schema)
"""

from __future__ import annotations

import difflib
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "docs" / "_machine" / "formatter-schema.json"
BUILDER = REPO_ROOT / "scripts" / "build-formatter-schema.py"


def main() -> int:
    if not BUILDER.is_file():
        print(f"::error::missing builder script: {BUILDER}", file=sys.stderr)
        return 2
    if not SCHEMA_PATH.is_file():
        print(
            f"::error::missing checked-in schema: {SCHEMA_PATH} — run "
            f"`python3 scripts/build-formatter-schema.py` and commit it",
            file=sys.stderr,
        )
        return 2

    proc = subprocess.run(
        [sys.executable, str(BUILDER), "--stdout"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        # Builder errors are printed by build-formatter-schema.py itself.
        sys.stderr.write(proc.stderr)
        return proc.returncode

    expected = proc.stdout
    actual = SCHEMA_PATH.read_text(encoding="utf-8")

    if actual == expected:
        # Quick sanity stats so the green-line is informative.
        line_count = actual.count("\n")
        size = len(actual.encode("utf-8"))
        print(
            f"[PASS] formatter-schema.json matches formatter.html "
            f"({line_count} lines, {size:,} bytes)"
        )
        return 0

    print(
        "[FAIL] formatter-schema.json drifted vs formatter.html",
        file=sys.stderr,
    )
    print(
        "  checked-in: docs/_machine/formatter-schema.json",
        file=sys.stderr,
    )
    print(
        "  expected:   regenerated from formatter.html via "
        "scripts/build-formatter-schema.py --stdout",
        file=sys.stderr,
    )
    print(file=sys.stderr)
    print("Unified diff (- on-disk, + expected):", file=sys.stderr)
    diff = difflib.unified_diff(
        actual.splitlines(keepends=True),
        expected.splitlines(keepends=True),
        fromfile="on-disk:docs/_machine/formatter-schema.json",
        tofile="expected (regenerated)",
        n=3,
    )
    sys.stderr.writelines(diff)
    print(file=sys.stderr)
    print(
        "To fix: run `python3 scripts/build-formatter-schema.py` "
        "and commit the new docs/_machine/formatter-schema.json.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
