#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G7 coverage gate (CI).

The drift gate (`check-formatter-schema.py`) already does a byte-for-byte
comparison of the regenerated schema against the checked-in copy. That
catches *content* drift. This gate covers a different failure mode:

  1. HTML → schema coverage
     Every distinct `data-name` attribute in `formatter.html` MUST appear
     as a property in `docs/_machine/formatter-schema.json`. This catches
     the case where the parser silently drops a real option (e.g. due to
     a malformed tag) and the drift gate happily ratifies the loss
     because the regenerated schema also drops it.

  2. Schema → HTML coverage
     Every property in `formatter-schema.json` MUST correspond to a
     `data-name` in `formatter.html`. This catches the case where
     someone edits the JSON Schema by hand and adds a phantom option
     that has no UI control.

  3. Duplicate transparency
     Every duplicate `data-name` in the HTML MUST be recorded in
     `x-meta.known-issues.duplicate-data-names`. This makes the
     duplicate-handling policy auditable: a duplicate that is NOT
     surfaced in the schema is a bug, not a feature.

If any check fails, this script exits 1 with a precise remediation
message. The drift gate and the coverage gate run in parallel in CI so
the operator sees both failure modes if both apply.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = (
    REPO_ROOT
    / "better_map/appserver/static/visualizations/better_map/formatter.html"
)
SCHEMA_PATH = REPO_ROOT / "docs/_machine/formatter-schema.json"


class DataNameParser(HTMLParser):
    """Collect every `data-name="..."` attribute in document order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.names: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for key, value in attrs:
            if key == "data-name" and value:
                self.names.append(value)


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    if not HTML_PATH.exists():
        fail(f"formatter.html missing at {HTML_PATH}")
    if not SCHEMA_PATH.exists():
        fail(
            f"formatter-schema.json missing at {SCHEMA_PATH} — "
            "run `python3 scripts/build-formatter-schema.py` first.",
        )

    parser = DataNameParser()
    parser.feed(HTML_PATH.read_text(encoding="utf-8"))
    html_counts = Counter(parser.names)
    html_unique = set(html_counts)
    html_duplicates = sorted(
        name for name, count in html_counts.items() if count > 1
    )

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema_props = set(schema.get("properties", {}))

    missing_in_schema = sorted(html_unique - schema_props)
    phantom_in_schema = sorted(schema_props - html_unique)

    if missing_in_schema:
        names = ", ".join(missing_in_schema)
        fail(
            "HTML → schema coverage failed: the following data-name "
            f"attribute(s) are present in formatter.html but missing "
            f"from docs/_machine/formatter-schema.json: {names}\n"
            "  Remediation: run `python3 scripts/build-formatter-schema.py` "
            "to regenerate the schema, then commit the result.",
        )

    if phantom_in_schema:
        names = ", ".join(phantom_in_schema)
        fail(
            "Schema → HTML coverage failed: the following propertie(s) "
            "exist in docs/_machine/formatter-schema.json but have NO "
            f"matching data-name in formatter.html: {names}\n"
            "  Remediation: either add the data-name attribute to the "
            "formatter.html control, or regenerate the schema with "
            "`python3 scripts/build-formatter-schema.py`.",
        )

    recorded_dups = sorted(
        d.get("name", "")
        for d in (
            schema.get("x-meta", {})
            .get("known-issues", {})
            .get("duplicate-data-names", [])
        )
    )
    unrecorded_dups = sorted(set(html_duplicates) - set(recorded_dups))

    if unrecorded_dups:
        names = ", ".join(unrecorded_dups)
        fail(
            "Duplicate transparency failed: the following data-name(s) "
            "appear MORE THAN ONCE in formatter.html but are NOT recorded "
            "in x-meta.known-issues.duplicate-data-names of the schema: "
            f"{names}\n"
            "  Remediation: regenerate the schema with "
            "`python3 scripts/build-formatter-schema.py` (the builder "
            "auto-records duplicates).",
        )

    stale_dups = sorted(set(recorded_dups) - set(html_duplicates))
    if stale_dups:
        names = ", ".join(stale_dups)
        fail(
            "Stale duplicate record(s): the schema declares the following "
            "as duplicate data-name(s) but they no longer appear more "
            f"than once in formatter.html: {names}\n"
            "  Remediation: regenerate the schema with "
            "`python3 scripts/build-formatter-schema.py`.",
        )

    print(
        f"[PASS] formatter coverage: {len(html_unique)} unique data-name(s) "
        f"in formatter.html, {len(schema_props)} propert(ies) in schema, "
        f"{len(html_duplicates)} duplicate(s) recorded.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
