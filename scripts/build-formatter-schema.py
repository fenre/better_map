#!/usr/bin/env python3
"""Generate ``docs/_machine/formatter-schema.json`` from ``formatter.html``.

Scope — ROADMAP §3 G7 (AI-ingestion-friendly documentation):
The 83-and-counting formatter options that drive better_map are declared in
``better_map/appserver/static/visualizations/better_map/formatter.html``. That
file is the SOURCE OF TRUTH — Splunk's custom-visualization framework parses
it directly to render the Edit panel. A human can read it; an LLM agent
(Cursor, Claude Code, Copilot, Splunk AI Assistant) cannot reliably extract
the type contract from the HTML alone (it's nested HTML, the help text is
free-form, the enum values live in `<option>` children, and defaults are
implicit via the `selected` attribute).

This script extracts the machine-readable representation and emits a
JSON Schema 2020-12 file at ``docs/_machine/formatter-schema.json``.
Every formatter option becomes:

    "<optionName>": {
        "type": "string" | "boolean" | "number",
        "title":        "<the <label> text>",
        "description":  "<the <p class='splunk-formatter-help'> text>",
        "tab":          "data" | "display" | "style",
        "heading":      "<the nearest <h3> heading above>",
        "default":      "<the default value, decoded>",
        "enum":         [...],       # for <select> with discrete options
        "enumLabels":   {...},       # human-friendly labels for each enum value
        "placeholder":  "<placeholder text>",
        "control":      "select" | "text" | "number" | "color"
    }

CI gate ``scripts/check-formatter-schema.py`` regenerates this artifact from
formatter.html via ``--stdout`` and asserts byte-equality with the
checked-in JSON — same pattern as the G3 manifest gate. Adding a new option
in HTML without updating the schema (or vice-versa) is a PR-blocking FAIL.

Usage::

    python3 scripts/build-formatter-schema.py            # write file
    python3 scripts/build-formatter-schema.py --stdout   # print to stdout (used by the gate)

Implementation notes:
  * Uses ``html.parser`` from the stdlib — no third-party dep. Bringing in
    bs4 just for this would inflate the CI Python venv for no win; the
    formatter HTML structure is regular enough that a small SAX-style
    handler is sufficient.
  * JSON Schema 2020-12 is the current published draft (RFC 8927 successor)
    and is what every modern code-gen toolchain (datamodel-codegen,
    quicktype, json-schema-to-typescript, ajv) consumes by default.
  * Output is deterministic: ``sort_keys=True``, two-space indent, trailing
    newline. The gate compares byte-for-byte; non-determinism would defeat
    the whole pattern.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
FORMATTER_PATH = (
    REPO_ROOT
    / "better_map"
    / "appserver"
    / "static"
    / "visualizations"
    / "better_map"
    / "formatter.html"
)
SCHEMA_OUT_PATH = REPO_ROOT / "docs" / "_machine" / "formatter-schema.json"

# Splunk's custom-viz framework prefixes every option name with this
# namespace at runtime. Encoded into the schema so consumers can rebuild
# the full property path used in `savedsearches.conf` /
# `display.visualizations.custom.<app>.<viz>.<key>`.
PROPERTY_NAMESPACE = "display.visualizations.custom.better_map.better_map"

# Tabs in formatter.html. The ids must match the `<section id="tab-X">`
# in the source HTML. If a future revision renames a tab id, this list
# must update too; CI gate `check-formatter-coverage.py` will fail
# otherwise (no row will match the renamed tab).
TAB_IDS = {
    "tab-data": "data",
    "tab-display": "display",
    "tab-style": "style",
}


class FormatterParser(HTMLParser):
    """Walk formatter.html and accumulate option metadata.

    The HTML structure is regular::

        <section id="tab-X">
          <h3 class="splunk-formatter-heading">Group title</h3>
          <div class="splunk-formatter-row">
            <label for="bm-foo">Display name</label>
            <input id="bm-foo" type="text" data-name="foo" placeholder="..." />
            <p class="splunk-formatter-help">Help text...</p>
          </div>
          ...
        </section>

    We track the current ``tab`` (set when we enter a `<section id="tab-X">`),
    the most-recent ``heading`` (set when we encounter an `<h3>` with the
    splunk-formatter-heading class), and accumulate one option dict per
    `<input>` / `<select>` carrying a ``data-name`` attribute, then
    attach the trailing `<p class="splunk-formatter-help">` text.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.options: list[dict[str, Any]] = []

        self._current_tab: str | None = None
        self._current_heading: str | None = None

        # Tracking the currently-open label/input/select/option/help.
        self._collecting_label_for: str | None = None
        self._label_buf: list[str] = []
        self._labels_by_id: dict[str, str] = {}

        # In a <select data-name="...">, accumulate <option> entries.
        self._select_open: dict[str, Any] | None = None
        # If we are inside an <option> tag of the open select, accumulate
        # its text content.
        self._option_open: dict[str, Any] | None = None
        self._option_text_buf: list[str] = []

        # The active "last option" that the next <p class="...help"> body
        # belongs to. Reset when we leave the enclosing row.
        self._pending_option: dict[str, Any] | None = None

        # When we open <p class="splunk-formatter-help">, accumulate text
        # into this buffer and assign to the pending option on close.
        # Inline <code>X</code> children inside the help text are wrapped
        # in markdown backticks so the rendered string is review-friendly
        # AND so the whitespace-collapse below doesn't introduce stray
        # spaces between adjacent character-data segments around the tag.
        self._help_open = False
        self._help_buf: list[str] = []
        self._help_code_depth = 0

    # ---- HTMLParser hooks --------------------------------------------

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k: (v or "") for k, v in attrs}

        if tag == "section":
            sec_id = attr_map.get("id", "")
            if sec_id in TAB_IDS:
                self._current_tab = TAB_IDS[sec_id]
            return

        if tag == "h3":
            classes = (attr_map.get("class") or "").split()
            if "splunk-formatter-heading" in classes:
                self._collecting_label_for = "__heading__"
                self._label_buf = []
            return

        if tag == "label":
            for_id = attr_map.get("for", "")
            if for_id:
                self._collecting_label_for = for_id
                self._label_buf = []
            return

        if tag in ("input", "select"):
            data_name = attr_map.get("data-name")
            if not data_name:
                return
            opt = self._begin_option(tag, attr_map)
            if tag == "select":
                self._select_open = opt
            return

        if tag == "option" and self._select_open is not None:
            self._option_open = {
                "value": attr_map.get("value", ""),
                "selected": "selected" in attr_map,
            }
            self._option_text_buf = []
            return

        if tag == "p":
            classes = (attr_map.get("class") or "").split()
            if "splunk-formatter-help" in classes and self._pending_option:
                self._help_open = True
                self._help_buf = []
                self._help_code_depth = 0
            return

        if tag == "code" and self._help_open:
            if self._help_code_depth == 0:
                self._help_buf.append("`")
            self._help_code_depth += 1
            return

    def handle_endtag(self, tag: str) -> None:
        if tag == "section":
            self._current_tab = None
            self._current_heading = None
            return

        if tag == "h3" and self._collecting_label_for == "__heading__":
            self._current_heading = " ".join(self._label_buf).strip()
            self._collecting_label_for = None
            self._label_buf = []
            return

        if tag == "label" and self._collecting_label_for:
            for_id = self._collecting_label_for
            self._labels_by_id[for_id] = " ".join(self._label_buf).strip()
            self._collecting_label_for = None
            self._label_buf = []
            return

        if tag == "select" and self._select_open is not None:
            self._select_open = None
            return

        if tag == "option" and self._option_open is not None:
            value = self._option_open["value"]
            label = " ".join(self._option_text_buf).strip()
            selected = self._option_open["selected"]
            if self._select_open is not None:
                enum_list = self._select_open.setdefault("enum", [])
                enum_labels = self._select_open.setdefault("enumLabels", {})
                if value not in enum_list:
                    enum_list.append(value)
                enum_labels[value] = label
                if selected:
                    self._select_open["default"] = value
            self._option_open = None
            self._option_text_buf = []
            return

        if tag == "code" and self._help_open and self._help_code_depth > 0:
            self._help_code_depth -= 1
            if self._help_code_depth == 0:
                self._help_buf.append("`")
            return

        if tag == "p" and self._help_open:
            # Join with empty string (we already added the backticks for
            # <code>); HTML indentation introduces whitespace inside the
            # buf segments which the re.sub call collapses below.
            text = "".join(self._help_buf)
            # Collapse runs of whitespace introduced by HTML pretty-printing.
            text = re.sub(r"\s+", " ", text).strip()
            # Tidy stray punctuation gaps: " , " → ", ", " . " → ". ", etc.
            text = re.sub(r"\s+([,.;:)])", r"\1", text)
            text = re.sub(r"([(])\s+", r"\1", text)
            if self._pending_option is not None:
                self._pending_option["description"] = text
            self._help_open = False
            self._help_buf = []
            self._help_code_depth = 0
            return

        if tag == "div":
            # End of a splunk-formatter-row block — flush pending option.
            # We can't easily filter by class on </div>, so we simply use
            # the next data-name to start a new pending option; this is
            # sufficient because help text always precedes the next row.
            return

    def handle_data(self, data: str) -> None:
        if self._collecting_label_for:
            self._label_buf.append(data)
        if self._option_open is not None:
            self._option_text_buf.append(data)
        if self._help_open:
            self._help_buf.append(data)

    # ---- Option construction -----------------------------------------

    def _begin_option(
        self,
        tag: str,
        attr_map: dict[str, str],
    ) -> dict[str, Any]:
        """Start a new option dict from an <input> or <select> tag."""
        name = attr_map["data-name"]
        elem_id = attr_map.get("id", "")
        placeholder = attr_map.get("placeholder", "").strip()

        opt: dict[str, Any] = {
            "name": name,
            "tab": self._current_tab or "unknown",
            "heading": self._current_heading or "",
            "title": self._labels_by_id.get(elem_id, name),
            "control": _classify_control(tag, attr_map),
        }

        if placeholder:
            opt["placeholder"] = placeholder

        # Default value for <input>: use the `value` attribute if present.
        if tag == "input":
            value = attr_map.get("value")
            if value is not None:
                opt["default"] = value

        # Carry through min/max/step for numeric inputs (useful for both
        # validation and for auto-generating UI/agents).
        for key in ("min", "max", "step"):
            if key in attr_map and attr_map[key] != "":
                opt[f"_{key}"] = attr_map[key]

        self.options.append(opt)
        self._pending_option = opt
        return opt


def _classify_control(tag: str, attrs: dict[str, str]) -> str:
    if tag == "select":
        return "select"
    input_type = (attrs.get("type") or "text").lower()
    if input_type == "color":
        return "color"
    if input_type == "number":
        return "number"
    return "text"


def _coerce_default(opt: dict[str, Any]) -> Any:
    """Coerce a string default to the correct JSON type for the schema."""
    default = opt.get("default")
    if default is None:
        return None
    control = opt.get("control")
    if control == "number":
        try:
            num = float(default)
        except ValueError:
            return default
        if num.is_integer():
            return int(num)
        return num
    if default in ("true", "false") and _is_boolean_select(opt):
        return default == "true"
    return default


def _is_boolean_select(opt: dict[str, Any]) -> bool:
    """A select is boolean iff its enum is exactly {'true', 'false'}."""
    enum_list = opt.get("enum")
    if enum_list is None:
        return False
    return sorted(enum_list) == ["false", "true"]


def _to_json_type(opt: dict[str, Any]) -> str | list[str]:
    control = opt.get("control")
    if control == "number":
        return "number"
    if control == "select":
        if _is_boolean_select(opt):
            return "boolean"
        return "string"
    return "string"


def _build_schema(options: list[dict[str, Any]]) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    for opt in options:
        prop: dict[str, Any] = {
            "type": _to_json_type(opt),
            "title": opt.get("title", opt["name"]),
            "description": opt.get("description", ""),
        }

        coerced_default = _coerce_default(opt)
        if coerced_default is not None:
            prop["default"] = coerced_default

        if "enum" in opt and not _is_boolean_select(opt):
            prop["enum"] = list(opt["enum"])
            prop["x-enum-labels"] = dict(opt.get("enumLabels", {}))

        if "placeholder" in opt:
            prop["x-placeholder"] = opt["placeholder"]

        # min/max/step → JSON Schema standard validators where they apply.
        if opt.get("_min"):
            try:
                prop["minimum"] = float(opt["_min"])
                if prop["minimum"].is_integer():
                    prop["minimum"] = int(prop["minimum"])
            except ValueError:
                pass
        if opt.get("_max"):
            try:
                prop["maximum"] = float(opt["_max"])
                if prop["maximum"].is_integer():
                    prop["maximum"] = int(prop["maximum"])
            except ValueError:
                pass
        if opt.get("_step"):
            try:
                prop["multipleOf"] = float(opt["_step"])
            except ValueError:
                pass

        # Extension fields kept under an `x-` prefix so consumers that
        # strictly validate JSON Schema 2020-12 don't choke on unknown
        # keywords.
        prop["x-bm"] = {
            "tab": opt.get("tab", "unknown"),
            "heading": opt.get("heading", ""),
            "control": opt.get("control", "text"),
            "splunk-property-path": f"{PROPERTY_NAMESPACE}.{opt['name']}",
        }

        properties[opt["name"]] = prop

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json",
        "title": "better_map formatter options",
        "description": (
            "JSON Schema 2020-12 representation of every option declared in "
            "better_map/appserver/static/visualizations/better_map/formatter.html. "
            "Generated by scripts/build-formatter-schema.py; do NOT edit by hand. "
            "CI gate scripts/check-formatter-schema.py asserts this artifact "
            "matches the source HTML byte-for-byte after regeneration. See "
            "ROADMAP §3 G7."
        ),
        "type": "object",
        "additionalProperties": False,
        "x-meta": {
            "source-of-truth": (
                "better_map/appserver/static/visualizations/better_map/formatter.html"
            ),
            "generator": "scripts/build-formatter-schema.py",
            "splunk-property-namespace": PROPERTY_NAMESPACE,
            "option-count": len(options),
            "tabs": {
                "data": "Data configurations",
                "display": "Data display",
                "style": "Color and style",
            },
        },
        "properties": properties,
    }


def _render(schema: dict[str, Any]) -> str:
    """Render JSON deterministically (sort_keys, 2-space indent, trailing nl)."""
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--stdout",
        action="store_true",
        help=(
            "Print the regenerated schema JSON to stdout instead of writing "
            "to disk. Consumed by scripts/check-formatter-schema.py."
        ),
    )
    args = parser.parse_args(argv)

    if not FORMATTER_PATH.is_file():
        print(
            f"::error::formatter.html not found at {FORMATTER_PATH}",
            file=sys.stderr,
        )
        return 2

    html = FORMATTER_PATH.read_text(encoding="utf-8")
    fp = FormatterParser()
    fp.feed(html)
    fp.close()

    if not fp.options:
        print(
            "::error::no `data-name` attributes found in formatter.html — "
            "did the form structure change?",
            file=sys.stderr,
        )
        return 2

    # Duplicate data-name detection. We pick the LAST occurrence (matches
    # Splunk's framework behaviour: the framework walks the HTML in document
    # order and the later <input>/<select> with the same data-name overrides
    # the earlier one for the property-bag). We emit a stderr WARNING and
    # record the duplicate set in the schema's x-meta block so an agent
    # reading the schema can see the conflict.
    seen: dict[str, dict[str, Any]] = {}
    duplicates: list[dict[str, str]] = []
    for opt in fp.options:
        name = opt["name"]
        prior = seen.get(name)
        if prior is not None:
            duplicates.append(
                {
                    "name": name,
                    "first": f"tab={prior.get('tab', '?')} heading="
                    f"{prior.get('heading', '?')!r}",
                    "second": f"tab={opt.get('tab', '?')} heading="
                    f"{opt.get('heading', '?')!r}",
                },
            )
        seen[name] = opt
    if duplicates:
        for dup in duplicates:
            print(
                "::warning file=better_map/appserver/static/visualizations/"
                f"better_map/formatter.html::duplicate data-name "
                f"\"{dup['name']}\" — first: {dup['first']}; "
                f"second (wins): {dup['second']}",
                file=sys.stderr,
            )
    deduped_options = list(seen.values())

    # Deterministic ordering: by tab, then heading, then option name.
    tab_order = ["data", "display", "style", "unknown"]
    deduped_options.sort(
        key=lambda o: (
            tab_order.index(o.get("tab", "unknown")),
            o.get("heading", ""),
            o["name"],
        ),
    )

    schema = _build_schema(deduped_options)
    if duplicates:
        schema["x-meta"]["known-issues"] = {
            "duplicate-data-names": duplicates,
            "_note": (
                "Splunk's custom-viz framework processes the formatter "
                "in document order; for each duplicate, the LATER "
                "<input>/<select> wins. Cleanup tracked as a v1.7 "
                "housekeeping follow-up under G7."
            ),
        }
    rendered = _render(schema)

    if args.stdout:
        sys.stdout.write(rendered)
        return 0

    SCHEMA_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_OUT_PATH.write_text(rendered, encoding="utf-8")
    print(
        f"Wrote {len(deduped_options)} options "
        f"({len(duplicates)} duplicates collapsed) "
        f"({SCHEMA_OUT_PATH.relative_to(REPO_ROOT)}, "
        f"{SCHEMA_OUT_PATH.stat().st_size} bytes)"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
