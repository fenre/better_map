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

Target sections (v1.7-prep, E2 Phase 2):

* ``docs/reference/formatter.md`` — section ``formatter-enumeration``
  enumerates ALL formatter options grouped by `x-bm.tab` →
  `x-bm.heading`, with type / default / range / enum / description.
  Source: ``docs/_machine/formatter-schema.json``.
* ``docs/integrations/catalogue.md`` — section ``integrations-matrix``
  emits a single at-a-glance comparison table across all
  ``docs/_machine/integrations/<id>.yaml`` files (status, required
  Splunk app, version min, REST endpoint count, auth model,
  OT-safety flag, live-tenant test status, machine-file link),
  followed by a per-integration endpoint detail subsection. The
  hand-authored prose blocks BELOW the marker pair (one ``##``
  heading per integration) are preserved verbatim.

Subsequent cuts (E2 Phase 2 follow-up PRs, NOT shipped here) will
add:

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
INTEGRATIONS_DIR = REPO_ROOT / "docs" / "_machine" / "integrations"
INTEGRATIONS_DOC = REPO_ROOT / "docs" / "integrations" / "catalogue.md"
GITHUB_BLOB_BASE = "https://github.com/fenre/better_map/blob/main"
GITHUB_TREE_BASE = "https://github.com/fenre/better_map/tree/main"

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


# --------------------------------------------------- integrations renderer


def _load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file using PyYAML if available, else a vendored fallback.

    The fallback covers the (tiny) subset of YAML used in
    ``docs/_machine/integrations/*.yaml`` — flow mappings, block lists
    of scalars, nested mappings, and ``key: value`` scalars. It is the
    same approach the other ``scripts/build-llms-*.py`` files use so
    the CI image does not need a hard PyYAML dependency.
    """
    try:
        import yaml  # type: ignore

        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except ImportError:  # pragma: no cover — fallback path
        return _vendored_yaml(path.read_text(encoding="utf-8"))


def _vendored_yaml(text: str) -> dict[str, Any]:
    """Minimal YAML subset parser — keys we need only.

    We never write back to YAML so this is read-only and tolerant.
    For anything richer (nested-list-of-dicts), we fall back to
    treating the field as a raw string so the table cell still
    renders. Production CI runs with PyYAML, so this branch is
    exercised mainly by developers on a clean venv.
    """
    out: dict[str, Any] = {}
    current_key: str | None = None
    buf: list[str] = []
    for raw in text.splitlines():
        if raw.startswith("#") or not raw.strip():
            continue
        if not raw.startswith(" "):
            if current_key is not None:
                out[current_key] = "\n".join(buf).strip()
                buf = []
            if ":" in raw:
                key, _, val = raw.partition(":")
                val = val.strip()
                if val:
                    out[key.strip()] = val.strip("\"'")
                    current_key = None
                else:
                    current_key = key.strip()
        else:
            buf.append(raw)
    if current_key is not None:
        out[current_key] = "\n".join(buf).strip()
    return out


def _yaml_list_count(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    return 0


def _summarise_auth(integration: dict[str, Any]) -> str:
    """Compact auth-model description for the matrix cell."""
    endpoints = integration.get("endpoints_called") or []
    if not endpoints:
        return "n/a (offline)"
    modes: list[str] = []
    for ep in endpoints:
        if not isinstance(ep, dict):
            continue
        mode = str(ep.get("auth", "")).strip()
        if mode and mode not in modes:
            modes.append(mode)
    if not modes:
        return "—"
    return ", ".join(modes)


def _summarise_ot_safety(integration: dict[str, Any]) -> str:
    """Render the OT-safety column.

    ``ot_safety`` blocks are present only on integrations that have an
    explicit safety contract (e.g. purdue, soar). When absent we emit
    an en-dash to keep the column dense.
    """
    block = integration.get("ot_safety")
    if not isinstance(block, dict):
        return "—"
    rules = block.get("rules_applicable") or []
    if isinstance(rules, list) and rules:
        return f"yes ({len(rules)} rule{'s' if len(rules) != 1 else ''})"
    return "yes"


def _summarise_tested(integration: dict[str, Any]) -> str:
    value = integration.get("tested_against")
    if value in (None, "", "null"):
        return "no"
    if isinstance(value, str):
        return _escape_table_cell(value)
    return "yes"


def _machine_file_link(path: Path) -> str:
    rel = path.relative_to(REPO_ROOT).as_posix()
    return f"[`{path.name}`]({GITHUB_BLOB_BASE}/{rel})"


def render_integrations_catalogue() -> str:
    """Render the at-a-glance integrations matrix + endpoint detail.

    Reads every ``docs/_machine/integrations/*.yaml``, emits:

    1. A one-line ``Total: N integrations · …`` summary.
    2. A single Markdown table with one row per integration.
    3. An "Endpoint detail" subsection listing every REST endpoint
       grouped by integration (so a reader can grep the rendered
       docs page for "POST /services/phantom_forward" and find which
       integration owns it).

    Order is stable: sorted by YAML filename (matches ``llms-full.txt``
    Appendix A ordering).
    """
    yaml_files = sorted(INTEGRATIONS_DIR.glob("*.yaml"))
    integrations: list[tuple[Path, dict[str, Any]]] = []
    for path in yaml_files:
        try:
            data = _load_yaml(path)
        except Exception as exc:  # noqa: BLE001 — script-internal
            raise SystemExit(
                f"[FAIL] could not parse {path.relative_to(REPO_ROOT)}: {exc}"
            ) from exc
        if not isinstance(data, dict):
            raise SystemExit(
                f"[FAIL] {path.relative_to(REPO_ROOT)} did not parse as a mapping"
            )
        integrations.append((path, data))

    if not integrations:
        raise SystemExit(
            "[FAIL] no integration YAMLs found under docs/_machine/integrations/"
        )

    statuses = [str(d.get("status", "?")) for _, d in integrations]
    status_counts: dict[str, int] = {}
    for s in statuses:
        status_counts[s] = status_counts.get(s, 0) + 1
    tested_count = sum(
        1
        for _, d in integrations
        if d.get("tested_against") not in (None, "", "null")
    )

    buf = io.StringIO()
    buf.write(
        "_The matrix table and endpoint detail below are auto-generated from "
        f"[`docs/_machine/integrations/*.yaml`]({GITHUB_TREE_BASE}/docs/_machine/integrations) "
        "by `scripts/build-reference-pages.py`. Do not edit the auto-managed "
        "section by hand — run the script and commit the regenerated file._\n\n"
    )

    summary_parts = [f"{len(integrations)} integrations"]
    for status in ("experimental", "beta", "stable", "deprecated"):
        if status in status_counts:
            summary_parts.append(f"{status_counts[status]} {status}")
    for status, count in status_counts.items():
        if status not in {"experimental", "beta", "stable", "deprecated"}:
            summary_parts.append(f"{count} {status}")
    summary_parts.append(
        f"{tested_count} live-tenant verified"
        if tested_count
        else "0 live-tenant verified (Theme C in flight)"
    )
    buf.write(f"**Total: {' · '.join(summary_parts)}.**\n\n")

    # Matrix table.
    buf.write(
        "| Integration | Status | Splunk app required | Splunk version min | "
        "REST endpoints | Auth | OT-safety | Live-tenant tested? | Source YAML |\n"
    )
    buf.write("|---|---|---|---|---|---|---|---|---|\n")
    for path, data in integrations:
        endpoints = data.get("endpoints_called") or []
        endpoint_count = _yaml_list_count(endpoints)
        endpoint_cell = (
            f"{endpoint_count}"
            if endpoint_count
            else "0 (offline helper)"
        )
        row = (
            _escape_table_cell(
                f"`{data.get('id', path.stem)}` — {data.get('display_name', '')}"
            ),
            _escape_table_cell(data.get("status", "?")),
            _escape_table_cell(data.get("splunk_app_required", "?")),
            _escape_table_cell(data.get("splunk_version_min", "?")),
            endpoint_cell,
            _escape_table_cell(_summarise_auth(data)),
            _escape_table_cell(_summarise_ot_safety(data)),
            _escape_table_cell(_summarise_tested(data)),
            _machine_file_link(path),
        )
        buf.write("| " + " | ".join(row) + " |\n")
    buf.write("\n")

    # Endpoint detail subsection — one h4 per integration that has
    # endpoints; offline helpers get a single bullet stating so.
    buf.write("### Endpoint detail\n\n")
    buf.write(
        "_One bullet per REST endpoint the visualization calls. "
        "Offline-only integrations are listed too, with a note._\n\n"
    )
    for path, data in integrations:
        display = str(data.get("display_name") or data.get("id") or path.stem)
        slug = str(data.get("id") or path.stem)
        buf.write(f"#### `{slug}` — {display}\n\n")
        endpoints = data.get("endpoints_called") or []
        if not endpoints:
            note = data.get("auth_required") or "n/a"
            buf.write(
                f"- _No outbound REST surface (offline helper). Auth: {note}._\n\n"
            )
            continue
        for ep in endpoints:
            if not isinstance(ep, dict):
                continue
            method = str(ep.get("method", "GET")).upper()
            ep_path = str(ep.get("path", ""))
            auth = str(ep.get("auth", "")).strip()
            purpose = str(ep.get("purpose", "")).strip()
            auth_suffix = f" (auth: {auth})" if auth else ""
            line = f"- `{method} {ep_path}`{auth_suffix}"
            if purpose:
                line += f" — {purpose}"
            buf.write(line + "\n")
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
        ManagedRegion(
            target=INTEGRATIONS_DOC,
            section_id="integrations-matrix",
            render=render_integrations_catalogue,
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
            "their structured sources of truth "
            f"({FORMATTER_SCHEMA.relative_to(REPO_ROOT)}, "
            f"{INTEGRATIONS_DIR.relative_to(REPO_ROOT)}/)."
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
