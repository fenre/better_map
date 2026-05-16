#!/usr/bin/env python3
"""
Q-1 — Dashboard XML/JSON parse check.

Asserts that every `default/data/ui/views/*.xml` file under the better_map
app:
  1. Parses as well-formed XML (catches malformed tags, missing close
     tags, unescaped entities like a bare `&` in label/description).
  2. Contains a `<definition>` element when the dashboard declares
     `version="2"` (Dashboard Studio); its CDATA content parses as JSON.
  3. The decoded JSON contains the minimum required top-level keys for
     Dashboard Studio: `title`, `dataSources`, `visualizations`,
     `layout`. (We do NOT validate against a schema here — that is the
     splunk-dashboards skill's responsibility; we just verify the JSON
     SHAPE is sane so a typo'd CDATA closing tag or a missing brace
     fails fast in CI instead of in a user's browser.)

Why this exists
---------------
Dashboard XML/JSON is the highest-fragility surface in the app. The
JSON definition lives inside a CDATA section inside an XML wrapper, so
either layer can break silently — a missing brace will not fail any
production test until the dashboard is loaded. ROADMAP §3 G2 PR
pipeline + §7b quality gates require this check before merge.

Exit codes:
  0  — every dashboard parses (PASS)
  1  — at least one dashboard fails to parse (FAIL); per-file errors
       printed in a copy-pasteable form
  2  — internal error (missing views dir, unexpected exception)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

REPO_ROOT = Path(__file__).resolve().parent.parent
VIEWS_DIR = REPO_ROOT / "better_map" / "default" / "data" / "ui" / "views"

REQUIRED_STUDIO_KEYS = ("title", "dataSources", "visualizations", "layout")

# Dashboard Studio dashboards declare version="2" on the root <dashboard|form>
# element. Simple XML (version="1" or unversioned) does NOT have a CDATA
# JSON definition and only needs the XML-well-formedness check.
STUDIO_VERSION_RE = re.compile(r'version\s*=\s*["\']2["\']')

# CDATA-delimiter detection. xml.etree.ElementTree preserves CDATA content
# inside .text but strips the `<![CDATA[ ... ]]>` markers. To produce a
# better error message when the closing `]]>` is malformed, we also do a
# raw-text scan for unbalanced CDATA markers.
CDATA_OPEN_RE = re.compile(r"<!\[CDATA\[")
CDATA_CLOSE_RE = re.compile(r"\]\]>")


def main() -> int:
    if not VIEWS_DIR.is_dir():
        print(f"ERROR: views directory not found at {VIEWS_DIR}", file=sys.stderr)
        return 2

    xml_files = sorted(VIEWS_DIR.glob("*.xml"))
    if not xml_files:
        print(f"ERROR: no dashboard XML files found in {VIEWS_DIR}", file=sys.stderr)
        return 2

    errors: list[str] = []
    studio_count = 0
    classic_count = 0

    for path in xml_files:
        rel = path.relative_to(REPO_ROOT)
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            errors.append(f"  {rel}: read failed: {e}")
            continue

        # Pre-check: balanced CDATA markers. xml.etree will accept some
        # broken CDATA forms (e.g. multiple `]]>` in a row) silently,
        # so do a token-count sanity check first.
        opens = len(CDATA_OPEN_RE.findall(raw))
        closes = len(CDATA_CLOSE_RE.findall(raw))
        if opens != closes:
            errors.append(
                f"  {rel}: unbalanced CDATA markers — {opens} <![CDATA[ vs "
                f"{closes} ]]> (likely a corrupted closing tag)"
            )
            continue

        # 1) XML well-formedness.
        try:
            tree = ET.fromstring(raw)
        except ET.ParseError as e:
            errors.append(f"  {rel}: XML parse failed: {e}")
            continue

        # Is this a Dashboard Studio (version="2") dashboard?
        is_studio = bool(STUDIO_VERSION_RE.search(raw[:512]))

        if not is_studio:
            classic_count += 1
            continue

        studio_count += 1

        # 2) <definition> CDATA → JSON.
        # The element can be at the root or nested; .find scope from root is enough.
        defn = tree.find("definition")
        if defn is None:
            errors.append(
                f"  {rel}: Dashboard Studio dashboard (version=2) but no "
                "<definition> element found"
            )
            continue
        cdata_text = (defn.text or "").strip()
        if not cdata_text:
            errors.append(
                f"  {rel}: <definition> CDATA is empty — Dashboard Studio "
                "needs a JSON body"
            )
            continue

        try:
            parsed = json.loads(cdata_text)
        except json.JSONDecodeError as e:
            # Show a snippet around the failure point so the author can
            # locate the typo without opening the file.
            offset = max(0, e.pos - 40)
            end = min(len(cdata_text), e.pos + 40)
            snippet = cdata_text[offset:end].replace("\n", "\\n")
            errors.append(
                f"  {rel}: JSON parse failed at byte {e.pos} "
                f"(line {e.lineno}, col {e.colno}): {e.msg}\n"
                f"      ... {snippet} ..."
            )
            continue

        # 3) Minimum-shape sanity (Dashboard Studio MUST have these).
        if not isinstance(parsed, dict):
            errors.append(
                f"  {rel}: top-level JSON value is {type(parsed).__name__}, "
                "expected object"
            )
            continue
        missing = [k for k in REQUIRED_STUDIO_KEYS if k not in parsed]
        if missing:
            errors.append(
                f"  {rel}: missing required Dashboard Studio key(s): "
                f"{', '.join(missing)}"
            )
            continue

    total = len(xml_files)
    print("Q-1 — Dashboard XML/JSON parse check")
    print(f"  Dashboards scanned:  {total}")
    print(f"    Studio (v2):       {studio_count}")
    print(f"    Classic (XML):     {classic_count}")
    print(f"  Errors:              {len(errors)}")

    if errors:
        print("\n  FAIL:")
        for line in errors:
            print(line)
        print(
            "\n  Remediation: open each file above and fix the syntax error. "
            "Common causes: a typo'd `]]>` CDATA closing, an unescaped `&` "
            "in <label>/<description> (use &amp;), or a missing brace in "
            "the Dashboard Studio JSON definition."
        )
        return 1

    print("\n  PASS — every dashboard parses cleanly.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — top-level catch for CI clarity
        print(f"Q-1 internal error: {e}", file=sys.stderr)
        sys.exit(2)
