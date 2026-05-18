#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""E2 Phase 2 — Regenerate auto-managed sections of the docs/reference/ pages.

The human-readable reference pages (``docs/reference/*.md``) contain
hand-authored narrative AND auto-generated tables.  This script
regenerates the auto-generated sections in place using a "managed
region" convention:

    <!-- BEGIN AUTOGEN: section-id -->
    (content owned by this script; do not edit by hand)
    <!-- END AUTOGEN: section-id -->

Everything OUTSIDE those marker pairs is hand-authored and survives
re-generation untouched.  Everything BETWEEN them is replaced wholesale
on every run.

Target sections (v1.7-prep, E2 Phase 2 first cut):

* ``docs/reference/formatter.md`` — section ``formatter-enumeration``
  enumerates ALL formatter options grouped by `x-bm.tab` →
  `x-bm.heading`, with type / default / range / enum / description.
  Source: ``docs/_machine/formatter-schema.json``.

Subsequent cuts (E2 Phase 2 follow-up PRs, NOT this script's first
release) will add:

* ``docs/integrations/catalogue.md`` — one auto section per
  ``docs/_machine/integrations/<id>.yaml`` summarising
  endpoints_called, auth_required, splunk_app_required, status.
* ``docs/recipes/index.md`` — auto-rendered matrix table from
  ``docs/_machine/recipes/index.yaml``.

Usage::

    python3 scripts/build-reference-pages.py            # rewrite in place
    python3 scripts/build-reference-pages.py --check    # exit 1 on drift
    python3 scripts/build-reference-pages.py --stdout   # preview to stdout
                                                        # (one file per --target)

The ``--check`` mode is the CI drift gate: it regenerates each
managed region in-memory and exits non-zero (printing the diff
target) if the on-disk file disagrees.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable

REPO_ROOT = Path(__file__).resolve().parents[1]
FORMATTER_SCHEMA = REPO_ROOT / "docs" / "_machine" / "formatter-schema.json"
FORMATTER_DOC = REPO_ROOT / "docs" / "reference" / "formatter.md"

# Marker convention (regex-safe, single line each).
BEGIN_RE_TEMPLATE = r"<!-- BEGIN AUTOGEN: {sid} -->"
END_RE_TEMPLATE = r"<!-- END AUTOGEN: {sid} -->"

# Friendly labels for the three Dashboard Studio tabs.  These MUST
# match the actual ``section-label`` attributes in ``formatter.html``
# so a reader who navigates from one to the other sees the same names.
# (See ``.cursor/rules/splunk-custom-viz-integration.mdc`` §8.1.)
TAB_LABELS = {
    "data": "Data configurations",
    "display": "Data display",
    "style": "Color and style",
}

# Stable display order for the three tabs.  Matches the order the tabs
# render inside Dashboard Studio (left → right).
TAB_ORDER = ("data", "display", "style")


# ----------------------------------------------------- formatter renderer


def _render_default(option: dict[str, Any]) -> str:
    """Render the ``default:`` cell for a single option."""
    if "default" not in option:
        return "—"
    value = option["default"]
    if isinstance(value, bool):
        return "`true`" if value else "`false`"
    if isinstance(value, str):
        if value == "":
            return "`\"\"`"
        return f"`{value}`"
    return f"`{json.dumps(value)}`"


def _render_type(option: dict[str, Any]) -> str:
    """Render the ``type:`` cell, including range / step where useful."""
    base = option.get("type", "?")
    if option.get("type") != "number":
        return base
    lo = option.get("minimum")
    hi = option.get("maximum")
    step = option.get("multipleOf")
    suffixes = []
    if lo is not None or hi is not None:
        suffixes.append(
            f"[{lo if lo is not None else '−∞'}…{hi if hi is not None else '+∞'}]"
        )
    if step is not None:
        suffixes.append(f"step {step}")
    if not suffixes:
        return base
    return f"{base} ({', '.join(suffixes)})"


def _render_enum(option: dict[str, Any]) -> str:
    """Render a short enum list (empty string for non-enum options)."""
    if "enum" not in option:
        return ""
    values = option["enum"]
    rendered = [f"`{v if v != '' else '<empty>'}`" for v in values]
    return " / ".join(rendered)


def _escape_table_cell(text: str) -> str:
    """Escape characters that would break a Markdown table cell.

    Strips trailing whitespace, collapses internal newlines (description
    fields are sometimes hand-wrapped), and escapes pipes / backslashes.
    """
    if text is None:
        return ""
    text = str(text).strip()
    text = re.sub(r"\s+", " ", text)
    text = text.replace("\\", "\\\\").replace("|", "\\|")
    return text


def render_formatter_enumeration() -> str:
    """Return the auto-generated formatter enumeration as Markdown.

    Layout: one ``###`` heading per (tab, heading) pair, ordered by
    `TAB_ORDER` and then alphabetically within each tab.  Each section
    holds a single Markdown table:

        | Option (`splunk-property-path` tail) | Type | Default | Enum / Range | Description |

    Options within a section are sorted alphabetically by their
    ``data-name`` (which is the property key in the schema).
    """
    schema = json.loads(FORMATTER_SCHEMA.read_text(encoding="utf-8"))
    props = schema.get("properties", {})

    # Bucket by (tab, heading).
    buckets: dict[tuple[str, str], list[tuple[str, dict[str, Any]]]] = {}
    for name in sorted(props.keys()):
        prop = props[name]
        xbm = prop.get("x-bm", {})
        tab = xbm.get("tab", "?")
        heading = xbm.get("heading", "?")
        buckets.setdefault((tab, heading), []).append((name, prop))

    buf = io.StringIO()
    buf.write(
        "_The tables below are auto-generated from "
        "[`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json) "
        "by `scripts/build-reference-pages.py`. Do not edit the auto-managed "
        "sections by hand — run the script and commit the regenerated file._\n\n"
    )
    buf.write(
        f"All **{len(props)} options** live in the same Splunk property "
        "namespace: each option's full Splunk path is "
        "`display.visualizations.custom.better_map.better_map.<option>`. "
        "Dashboard Studio shows the short name (`<option>`) in the formatter "
        "UI; the full path appears in the underlying `savedsearches.conf` "
        "stanza.\n\n"
    )

    for tab in TAB_ORDER:
        # Headings under this tab, alphabetical.
        tab_headings = sorted(
            heading for (t, heading) in buckets if t == tab
        )
        if not tab_headings:
            continue
        buf.write(f"### Tab — {TAB_LABELS.get(tab, tab)}\n\n")
        for heading in tab_headings:
            entries = buckets[(tab, heading)]
            buf.write(f"#### {heading}\n\n")
            buf.write(
                "| Option | Type | Default | Enum / range | Description |\n"
            )
            buf.write(
                "|---|---|---|---|---|\n"
            )
            for name, prop in entries:
                desc = _escape_table_cell(prop.get("description", ""))
                title = _escape_table_cell(prop.get("title", ""))
                cell_name = f"`{name}`"
                if title and title.lower() != name.lower():
                    cell_name = f"`{name}`<br>_{title}_"
                row = (
                    cell_name,
                    _escape_table_cell(_render_type(prop)),
                    _escape_table_cell(_render_default(prop)),
                    _escape_table_cell(_render_enum(prop)),
                    desc,
                )
                buf.write("| " + " | ".join(row) + " |\n")
            buf.write("\n")

    return buf.getvalue().rstrip() + "\n"


# ----------------------------------------------------- managed-region IO


# A single managed region is identified by its target file and a string
# section id.  ``render`` returns the body that goes BETWEEN the markers
# (newlines around the body are managed by ``apply_regions`` below so the
# markers always sit on their own lines with one blank line of padding).
class ManagedRegion:
    def __init__(self, target: Path, section_id: str, render: Callable[[], str]) -> None:
        self.target = target
        self.section_id = section_id
        self.render = render

    @property
    def begin_marker(self) -> str:
        return BEGIN_RE_TEMPLATE.format(sid=self.section_id)

    @property
    def end_marker(self) -> str:
        return END_RE_TEMPLATE.format(sid=self.section_id)


def apply_regions(regions: list[ManagedRegion]) -> dict[Path, str]:
    """Return the projected contents of each target file with regions applied.

    Does NOT write to disk.  Caller decides whether to write or compare.

    The ``BEGIN`` / ``END`` markers sit on their own lines.  Around each
    block we ensure exactly one blank line of padding so re-running the
    script is idempotent (without this, a stray run could add extra
    blank lines forever).
    """
    by_target: dict[Path, list[ManagedRegion]] = {}
    for region in regions:
        by_target.setdefault(region.target, []).append(region)

    out: dict[Path, str] = {}
    for target, target_regions in by_target.items():
        if not target.is_file():
            raise SystemExit(
                f"[FAIL] target file missing: {target.relative_to(REPO_ROOT)}"
            )
        text = target.read_text(encoding="utf-8")
        for region in target_regions:
            text = _replace_region(text, region)
        out[target] = text
    return out


def _replace_region(text: str, region: ManagedRegion) -> str:
    pattern = re.compile(
        re.escape(region.begin_marker) + r"(.*?)" + re.escape(region.end_marker),
        re.DOTALL,
    )
    body = region.render().rstrip("\n")
    replacement = f"{region.begin_marker}\n\n{body}\n\n{region.end_marker}"
    if not pattern.search(text):
        raise SystemExit(
            f"[FAIL] {region.target.relative_to(REPO_ROOT)} has no "
            f"`{region.begin_marker}` / `{region.end_marker}` markers. "
            "Add the marker pair where the auto-generated content should "
            "live, then re-run the script."
        )
    return pattern.sub(lambda _m: replacement, text)


# ----------------------------------------------------- main


def _regions() -> list[ManagedRegion]:
    return [
        ManagedRegion(
            target=FORMATTER_DOC,
            section_id="formatter-enumeration",
            render=render_formatter_enumeration,
        ),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--stdout",
        action="store_true",
        help="print the rendered managed-region bodies to stdout instead of writing",
    )
    group.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if any on-disk target differs from the rendered output",
    )
    args = parser.parse_args()

    regions = _regions()

    if args.stdout:
        for region in regions:
            sys.stdout.write(
                f"=== {region.target.relative_to(REPO_ROOT)} :: {region.section_id} ===\n"
            )
            sys.stdout.write(region.render())
            sys.stdout.write("\n")
        return 0

    projected = apply_regions(regions)

    if args.check:
        drift = False
        for target, new_text in projected.items():
            actual = target.read_text(encoding="utf-8")
            if actual != new_text:
                print(
                    f"[FAIL] {target.relative_to(REPO_ROOT)} is out of sync "
                    "vs the structured sources of truth. Run "
                    "`python3 scripts/build-reference-pages.py` and commit.",
                    file=sys.stderr,
                )
                drift = True
        if drift:
            return 1
        print(
            f"[PASS] {len(projected)} reference page(s) in sync with "
            f"{FORMATTER_SCHEMA.relative_to(REPO_ROOT)}."
        )
        return 0

    written = 0
    for target, new_text in projected.items():
        prev = target.read_text(encoding="utf-8") if target.is_file() else ""
        if prev != new_text:
            target.write_text(new_text, encoding="utf-8", newline="\n")
            print(
                f"[OK] regenerated {target.relative_to(REPO_ROOT)} "
                f"({len(new_text):,} bytes)."
            )
            written += 1
        else:
            print(
                f"[SKIP] {target.relative_to(REPO_ROOT)} already in sync."
            )
    if not written:
        print("[OK] nothing to do — all targets already in sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
