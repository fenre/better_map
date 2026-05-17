#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""E5 Phase 1 — Per-source recipe schema + structure + index drift gate.

Scope (ROADMAP §3 E5):
    Every per-source recipe under ``docs/recipes/<source-id>/<layer-id>.md``
    is a six-section markdown document with a YAML frontmatter block at
    the top. This gate asserts:

      1. **Frontmatter conforms to recipe-schema.json.**
         The frontmatter parses as YAML, contains every required key,
         every key is the right type, every enum value is on the
         allowlist, every regex matches.  The schema lives at
         ``docs/_machine/recipes/recipe-schema.json`` and is the
         contract that AI agents and llms.txt consumers (G7 Phase 2)
         read against.

      2. **Filesystem path matches frontmatter id.**
         A recipe at ``docs/recipes/<source>/<layer>.md`` MUST declare
         ``id: <source>--<layer>``, ``source.id: <source>``, and
         ``layer.id: <layer>``.  Catches the "I copied a recipe and
         forgot to rename the id" class of bug at PR time.

      3. **Six markdown sections are present.**
         Each recipe MUST contain second-level (`##`) headings numbered
         1..6 with the canonical titles:

           1. Source description
           2. SPL recipe
           3. Expected fields
           4. Recommended formatter config
           5. Screenshot
           6. Gotchas

         (Verbatim match on the heading text after the leading "N. ".)

      4. **The §2 SPL fence is well-formed and pipe-per-line.**
         The first code fence after the "## 2. SPL recipe" heading MUST
         be tagged ``spl`` (or ``splunk``).  Every non-empty,
         non-comment line inside that fence MUST contain at most ONE
         pipe (``|``) character — mirrors the SPL Pipe-Per-Line Rule
         in ``splunk-conf-and-spl.mdc``.  One-time setup fences in §1
         are exempt (they document, they do not run as panel SPL).

      5. **The §4 formatter config fence is valid JSON.**
         The first code fence after the "## 4. Recommended formatter
         config" heading MUST be tagged ``json`` and parse via
         ``json.loads``.  Every key in the parsed object MUST be a
         property in ``docs/_machine/formatter-schema.json`` AND in
         the recipe's ``required_formatter_options`` frontmatter
         array (catches the case where the recipe sets an option but
         forgets to declare it in the contract, OR vice versa).

      6. **expected_fields entries are mentioned in §3.**
         Every ``expected_fields[*].name`` in the frontmatter MUST
         appear as a row in the §3 "Expected fields" markdown table.

      7. **Generated index.yaml is up to date.**
         The script regenerates ``docs/_machine/recipes/index.yaml``
         from the union of every recipe's frontmatter and compares
         byte-for-byte against the checked-in copy.  Drift means a
         maintainer added or changed a recipe without running
         ``scripts/build-recipe-index.py``.

Exit codes::

    0 — every recipe valid AND index in sync
    1 — at least one recipe failed validation OR the index drifted
    2 — schema, index path, or recipes directory missing (bug in
        repo layout, not in a single recipe)

The script depends on PyYAML (preinstalled on ubuntu-latest GitHub
runners and on a typical macOS dev install).  No other third-party
deps; the validator is hand-rolled against the specific schema we
ship — it is NOT a generic JSON Schema engine.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - PyYAML missing
    print(
        "[FAIL] PyYAML is required to validate recipe frontmatter.\n"
        "  Install with: python3 -m pip install --user pyyaml\n"
        "  On CI: ubuntu-latest preinstalls PyYAML; if this fails on a\n"
        "  hosted runner the runner image changed — add a pip install\n"
        "  step to .github/workflows/ci.yml.",
        file=sys.stderr,
    )
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[1]
RECIPES_DIR = REPO_ROOT / "docs" / "recipes"
SCHEMA_PATH = REPO_ROOT / "docs" / "_machine" / "recipes" / "recipe-schema.json"
INDEX_PATH = REPO_ROOT / "docs" / "_machine" / "recipes" / "index.yaml"
FORMATTER_SCHEMA_PATH = REPO_ROOT / "docs" / "_machine" / "formatter-schema.json"
INDEX_BUILDER = REPO_ROOT / "scripts" / "build-recipe-index.py"

FRONTMATTER_FENCE = re.compile(r"^---\s*$", re.MULTILINE)

CANONICAL_SECTIONS = (
    "1. Source description",
    "2. SPL recipe",
    "3. Expected fields",
    "4. Recommended formatter config",
    "5. Screenshot",
    "6. Gotchas",
)

SPL_LANG_TAGS = {"spl", "splunk"}


# ---------------------------------------------------------------- helpers


def fail(rel_path: str, message: str) -> None:
    """Print a single FAIL with a relative-path tag and an indented body."""
    print(f"[FAIL] {rel_path}: {message}", file=sys.stderr)


def warn(rel_path: str, message: str) -> None:
    print(f"[WARN] {rel_path}: {message}", file=sys.stderr)


def list_recipes() -> list[Path]:
    """Every <source>/<layer>.md under docs/recipes/, sorted, excluding index.md."""
    if not RECIPES_DIR.is_dir():
        return []
    out: list[Path] = []
    for src_dir in sorted(RECIPES_DIR.iterdir()):
        if not src_dir.is_dir():
            continue
        for f in sorted(src_dir.iterdir()):
            if f.suffix == ".md" and f.name != "index.md":
                out.append(f)
    return out


def split_frontmatter(md_text: str) -> tuple[dict[str, Any] | None, str]:
    """Return (frontmatter_dict, body) or (None, original_text) on no frontmatter."""
    lines = md_text.splitlines(keepends=True)
    if not lines or not FRONTMATTER_FENCE.match(lines[0]):
        return None, md_text
    closing = None
    for idx in range(1, len(lines)):
        if FRONTMATTER_FENCE.match(lines[idx]):
            closing = idx
            break
    if closing is None:
        return None, md_text
    frontmatter_text = "".join(lines[1:closing])
    body = "".join(lines[closing + 1 :])
    try:
        data = yaml.safe_load(frontmatter_text)
    except yaml.YAMLError as exc:
        raise ValueError(f"frontmatter is not valid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("frontmatter top-level must be a mapping")
    return data, body


# ----------------------------------------------------- focused schema check


class Validator:
    """Validates ``data`` against a small subset of JSON Schema 2020-12.

    Supported keywords: ``type``, ``required``, ``properties``,
    ``additionalProperties`` (object), ``const``, ``enum``, ``pattern``,
    ``minLength``, ``maxLength``, ``minimum``, ``maximum`` (string /
    integer), ``items``, ``minItems``, ``maxItems`` (array), ``oneOf``.
    Anything else is ignored with a warning (which means the schema MUST
    NOT rely on it — keep this in mind when extending recipe-schema.json).
    """

    JSON_TYPES = {
        "object": dict,
        "string": str,
        "integer": int,
        "boolean": bool,
        "array": list,
        "null": type(None),
    }

    def __init__(self, schema: dict[str, Any]) -> None:
        self.schema = schema
        self.errors: list[str] = []

    def validate(self, data: Any, root_label: str = "$") -> list[str]:
        self.errors = []
        self._check(data, self.schema, root_label)
        return list(self.errors)

    def _check(self, data: Any, schema: dict[str, Any], path: str) -> None:
        if "oneOf" in schema:
            matched = 0
            inner_errors: list[list[str]] = []
            for sub in schema["oneOf"]:
                sub_validator = Validator(sub)
                sub_errs = sub_validator.validate(data, path)
                if not sub_errs:
                    matched += 1
                inner_errors.append(sub_errs)
            if matched != 1:
                summary = "; ".join(
                    f"branch {i}: {'OK' if not errs else errs[0]}"
                    for i, errs in enumerate(inner_errors)
                )
                self.errors.append(
                    f"{path} matched {matched} oneOf branches (expected 1): {summary}"
                )
            # If oneOf passes, the matched branch is authoritative — do
            # not also recurse into outer keywords, which the schema
            # wouldn't define for an oneOf node anyway.
            return

        if "type" in schema:
            expected_type = schema["type"]
            py_type = self.JSON_TYPES.get(expected_type)
            if py_type is None:
                self.errors.append(
                    f"{path} schema bug: unsupported type {expected_type!r}"
                )
                return
            # JSON spec: booleans are NOT integers; PyYAML respects that
            # for `true`/`false`, but a stray `1` could be either.
            if expected_type == "integer" and isinstance(data, bool):
                self.errors.append(f"{path} expected integer, got boolean")
                return
            if not isinstance(data, py_type):
                self.errors.append(
                    f"{path} expected {expected_type}, got "
                    f"{type(data).__name__}"
                )
                return

        if "const" in schema and data != schema["const"]:
            self.errors.append(
                f"{path} expected const {schema['const']!r}, got {data!r}"
            )

        if "enum" in schema and data not in schema["enum"]:
            self.errors.append(
                f"{path} value {data!r} not in enum {schema['enum']!r}"
            )

        if "pattern" in schema and isinstance(data, str):
            if not re.search(schema["pattern"], data):
                self.errors.append(
                    f"{path} value {data!r} does not match pattern "
                    f"{schema['pattern']!r}"
                )

        if "minLength" in schema and isinstance(data, str):
            if len(data) < schema["minLength"]:
                self.errors.append(
                    f"{path} length {len(data)} < minLength {schema['minLength']}"
                )
        if "maxLength" in schema and isinstance(data, str):
            if len(data) > schema["maxLength"]:
                self.errors.append(
                    f"{path} length {len(data)} > maxLength {schema['maxLength']}"
                )

        if "minimum" in schema and isinstance(data, (int, float)):
            if data < schema["minimum"]:
                self.errors.append(
                    f"{path} value {data} < minimum {schema['minimum']}"
                )
        if "maximum" in schema and isinstance(data, (int, float)):
            if data > schema["maximum"]:
                self.errors.append(
                    f"{path} value {data} > maximum {schema['maximum']}"
                )

        if "properties" in schema and isinstance(data, dict):
            properties = schema["properties"]
            for key, sub_schema in properties.items():
                if key in data:
                    self._check(data[key], sub_schema, f"{path}.{key}")
            if "required" in schema:
                for key in schema["required"]:
                    if key not in data:
                        self.errors.append(f"{path}.{key} is required")
            if schema.get("additionalProperties") is False:
                extra = set(data) - set(properties)
                if extra:
                    self.errors.append(
                        f"{path} has unknown properties: {sorted(extra)}"
                    )

        if "items" in schema and isinstance(data, list):
            if "minItems" in schema and len(data) < schema["minItems"]:
                self.errors.append(
                    f"{path} array length {len(data)} < minItems {schema['minItems']}"
                )
            if "maxItems" in schema and len(data) > schema["maxItems"]:
                self.errors.append(
                    f"{path} array length {len(data)} > maxItems {schema['maxItems']}"
                )
            for i, item in enumerate(data):
                self._check(item, schema["items"], f"{path}[{i}]")


# ----------------------------------------------------- body section checks


def section_offsets(body: str) -> dict[str, int]:
    """Return canonical-heading -> body offset.

    A canonical heading is a line like `## 1. Source description` (the
    exact strings in CANONICAL_SECTIONS).  Missing headings get no key.
    """
    offsets: dict[str, int] = {}
    for canonical in CANONICAL_SECTIONS:
        pattern = re.compile(
            r"^##\s+" + re.escape(canonical) + r"\s*$", re.MULTILINE
        )
        match = pattern.search(body)
        if match:
            offsets[canonical] = match.start()
    return offsets


def fence_after(body: str, start_offset: int) -> tuple[str | None, str | None]:
    """Find the first ``` LANG ... ``` fence at or after ``start_offset``.

    ``start_offset`` points at the ``##`` of a section heading.  Advance
    past the rest of that heading line BEFORE searching for the next
    section, otherwise the search would resolve to the very same
    heading and ``region`` would be empty.

    Returns ``(lang, fence_content)`` or ``(None, None)`` if no fence
    is found before the next ``## `` section heading (or end of file).
    """
    fence_pattern = re.compile(
        r"^```([^\s`]*)[^\n]*\n(.*?)^```\s*$",
        re.MULTILINE | re.DOTALL,
    )
    # Skip the heading line itself; then find the NEXT `^## ` heading.
    heading_end = body.find("\n", start_offset)
    scan_from = heading_end + 1 if heading_end != -1 else len(body)
    next_section = re.search(r"^## ", body[scan_from:], re.MULTILINE)
    end_offset = (
        scan_from + next_section.start() if next_section else len(body)
    )
    region = body[scan_from:end_offset]
    match = fence_pattern.search(region)
    if not match:
        return None, None
    return match.group(1).strip().lower(), match.group(2)


def check_spl_pipe_per_line(rel_path: str, fence: str, errors: list[str]) -> None:
    for line_no, raw in enumerate(fence.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("```"):
            continue
        # Allow comments (Splunk SPL uses `comment` macros and ``…``
        # inline pseudo-comments; both are uncommon enough that we just
        # skip lines that look like prose).
        if stripped.startswith("//") or stripped.startswith("#"):
            continue
        # Count un-escaped, non-string pipes.  We don't try to parse
        # SPL strings — instead, treat any line with 2+ pipes as a
        # candidate failure and verify with a coarse "consecutive
        # pipes count > 1 after stripping single-quoted strings".
        bare = re.sub(r"'[^']*'", "''", stripped)
        bare = re.sub(r'"[^"]*"', '""', bare)
        if bare.count("|") > 1:
            errors.append(
                f"{rel_path}: §2 SPL line {line_no} has {bare.count('|')} "
                f"pipes on one physical line: {stripped[:80]}"
            )


def check_recipe_body(
    rel_path: str,
    frontmatter: dict[str, Any],
    body: str,
    formatter_props: set[str],
) -> list[str]:
    errors: list[str] = []
    offsets = section_offsets(body)

    # 3. Six canonical sections present, in order.
    missing = [s for s in CANONICAL_SECTIONS if s not in offsets]
    if missing:
        errors.append(
            f"missing canonical section heading(s): {missing!r} "
            f"(expected exactly: {list(CANONICAL_SECTIONS)})"
        )
        # If a heading is missing, downstream offset-based checks can't
        # run — return early.
        return errors

    ordered_offsets = [offsets[s] for s in CANONICAL_SECTIONS]
    if ordered_offsets != sorted(ordered_offsets):
        errors.append(
            "canonical section headings are not in the required order "
            "(must appear 1..6 sequentially in the document)"
        )

    # 4. §2 SPL fence: present, tagged spl, pipe-per-line.
    spl_lang, spl_fence = fence_after(body, offsets["2. SPL recipe"])
    if spl_lang is None or spl_fence is None:
        errors.append("§2 has no fenced code block (expected ```spl ...```)")
    else:
        if spl_lang not in SPL_LANG_TAGS:
            errors.append(
                f"§2 fence language tag is {spl_lang!r}; expected one of "
                f"{sorted(SPL_LANG_TAGS)!r}"
            )
        check_spl_pipe_per_line(rel_path, spl_fence, errors)

    # 5. §4 JSON fence: present, tagged json, parses, keys are real
    #    formatter properties AND declared in required_formatter_options.
    json_lang, json_fence = fence_after(
        body, offsets["4. Recommended formatter config"]
    )
    if json_lang is None or json_fence is None:
        errors.append(
            "§4 has no fenced code block (expected ```json ...```)"
        )
    elif json_lang != "json":
        errors.append(
            f"§4 fence language tag is {json_lang!r}; expected 'json'"
        )
    else:
        try:
            json_obj = json.loads(json_fence)
        except json.JSONDecodeError as exc:
            errors.append(f"§4 JSON fence is not valid JSON: {exc}")
            json_obj = None
        if isinstance(json_obj, dict):
            declared = set(frontmatter.get("required_formatter_options", []))
            actual = set(json_obj.keys())
            phantom = sorted(actual - formatter_props)
            if phantom:
                errors.append(
                    "§4 references formatter option(s) that are NOT in "
                    f"docs/_machine/formatter-schema.json: {phantom}"
                )
            undeclared = sorted(actual - declared)
            if undeclared:
                errors.append(
                    "§4 sets formatter option(s) not declared in "
                    f"required_formatter_options frontmatter: {undeclared}"
                )
            missing_in_config = sorted(declared - actual)
            if missing_in_config:
                errors.append(
                    "frontmatter required_formatter_options declares "
                    f"option(s) not actually set in §4: {missing_in_config}"
                )

    # 6. expected_fields entries appear in the §3 markdown table.
    expected = frontmatter.get("expected_fields", [])
    if expected and "3. Expected fields" in offsets:
        # Region between §3 and §4 (or end).
        end = offsets.get("4. Recommended formatter config", len(body))
        region = body[offsets["3. Expected fields"]:end]
        for entry in expected:
            name = entry.get("name") if isinstance(entry, dict) else None
            if not name:
                continue
            # The field name SHOULD appear as the first column of a row.
            # Cheap heuristic: search for "| <name> " or "|<name> " in
            # any line that starts with `|` (the table body).
            pattern = re.compile(
                r"^\|\s*" + re.escape(name) + r"\s*\|", re.MULTILINE
            )
            if not pattern.search(region):
                errors.append(
                    f"expected_fields entry {name!r} is not present in "
                    "the §3 markdown table (each entry must be a row)"
                )

    return errors


# ----------------------------------------------------- main


def check_recipe(
    path: Path,
    schema: dict[str, Any],
    formatter_props: set[str],
) -> list[str]:
    rel = path.relative_to(REPO_ROOT)
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    try:
        frontmatter, body = split_frontmatter(text)
    except ValueError as exc:
        errors.append(f"{rel}: {exc}")
        return errors
    if frontmatter is None:
        errors.append(f"{rel}: no YAML frontmatter block at top of file")
        return errors

    schema_errors = Validator(schema).validate(frontmatter)
    for err in schema_errors:
        errors.append(f"{rel}: frontmatter {err}")

    # Path / id agreement.
    expected_source = path.parent.name
    expected_layer = path.stem
    if frontmatter.get("source", {}).get("id") != expected_source:
        errors.append(
            f"{rel}: source.id {frontmatter.get('source', {}).get('id')!r} "
            f"does not match parent directory {expected_source!r}"
        )
    if frontmatter.get("layer", {}).get("id") != expected_layer:
        errors.append(
            f"{rel}: layer.id {frontmatter.get('layer', {}).get('id')!r} "
            f"does not match filename stem {expected_layer!r}"
        )
    expected_id = f"{expected_source}--{expected_layer}"
    if frontmatter.get("id") != expected_id:
        errors.append(
            f"{rel}: id {frontmatter.get('id')!r} should be {expected_id!r} "
            "(<source.id>--<layer.id>)"
        )

    # Verified recipes MUST declare verified_against.
    if frontmatter.get("status") == "verified" and frontmatter.get("verified_against") is None:
        errors.append(
            f"{rel}: status=verified requires a non-null verified_against block"
        )

    # OT-safety recipes MUST mention 'OT safety' or 'safety_related' in §6.
    if frontmatter.get("ot_safety_relevant") is True:
        offsets = section_offsets(body)
        if "6. Gotchas" in offsets:
            end = len(body)
            gotchas_region = body[offsets["6. Gotchas"]:end].lower()
            if "ot safety" not in gotchas_region and "safety_related" not in gotchas_region:
                errors.append(
                    f"{rel}: ot_safety_relevant=true but §6 Gotchas does not "
                    "mention 'OT safety' or 'safety_related' (per ot-safety.mdc Rules 1+5+6)"
                )

    # Body-level structural checks.
    body_errors = check_recipe_body(str(rel), frontmatter, body, formatter_props)
    for err in body_errors:
        errors.append(f"{rel}: {err}")

    return errors


def check_index_drift() -> list[str]:
    """Regenerate index.yaml via build-recipe-index.py and byte-compare."""
    errors: list[str] = []
    if not INDEX_BUILDER.is_file():
        return [f"missing index builder: {INDEX_BUILDER}"]
    if not INDEX_PATH.is_file():
        return [
            f"missing checked-in index: {INDEX_PATH} — run "
            "`python3 scripts/build-recipe-index.py` and commit it"
        ]
    proc = subprocess.run(
        [sys.executable, str(INDEX_BUILDER), "--stdout"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return [f"index builder failed: exit {proc.returncode}"]
    expected = proc.stdout
    actual = INDEX_PATH.read_text(encoding="utf-8")
    if actual != expected:
        errors.append(
            "docs/_machine/recipes/index.yaml drifted vs the recipe files "
            "on disk. To fix: run `python3 scripts/build-recipe-index.py` "
            "and commit the new index."
        )
    return errors


def main() -> int:
    if not SCHEMA_PATH.is_file():
        print(f"::error::missing recipe schema: {SCHEMA_PATH}", file=sys.stderr)
        return 2
    if not RECIPES_DIR.is_dir():
        print(f"::error::missing recipes dir: {RECIPES_DIR}", file=sys.stderr)
        return 2
    if not FORMATTER_SCHEMA_PATH.is_file():
        print(
            f"::error::missing formatter schema: {FORMATTER_SCHEMA_PATH}",
            file=sys.stderr,
        )
        return 2

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    formatter_schema = json.loads(
        FORMATTER_SCHEMA_PATH.read_text(encoding="utf-8")
    )
    formatter_props = set(formatter_schema.get("properties", {}))

    recipes = list_recipes()
    if not recipes:
        # An empty recipes dir is a soft-fail — Phase 1 ships with three
        # starter recipes, so an empty set means someone deleted them.
        print(
            "[FAIL] no recipes found under docs/recipes/<source>/<layer>.md "
            "(expected at least the three v1.7-prep starters)",
            file=sys.stderr,
        )
        return 1

    all_errors: list[str] = []
    for recipe in recipes:
        errs = check_recipe(recipe, schema, formatter_props)
        for e in errs:
            print(f"[FAIL] {e}", file=sys.stderr)
        all_errors.extend(errs)

    drift_errors = check_index_drift()
    for e in drift_errors:
        print(f"[FAIL] {e}", file=sys.stderr)
    all_errors.extend(drift_errors)

    if all_errors:
        print(
            f"\n[FAIL] recipe schema check found {len(all_errors)} issue(s) "
            f"across {len(recipes)} recipe(s).",
            file=sys.stderr,
        )
        return 1

    verified = sum(
        1
        for r in recipes
        if _quick_status(r) == "verified"
    )
    print(
        f"[PASS] recipe schema check: {len(recipes)} recipe(s) valid "
        f"({verified} verified, {len(recipes) - verified} unverified/deferred); "
        f"docs/_machine/recipes/index.yaml in sync."
    )
    return 0


def _quick_status(path: Path) -> str:
    """Re-read the file and return frontmatter['status'] or 'unknown'."""
    try:
        text = path.read_text(encoding="utf-8")
        fm, _ = split_frontmatter(text)
        if fm and isinstance(fm.get("status"), str):
            return fm["status"]
    except Exception:  # pragma: no cover - already validated above
        pass
    return "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
