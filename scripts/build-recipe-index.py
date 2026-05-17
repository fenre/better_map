#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""E5 Phase 1 — Emit ``docs/_machine/recipes/index.yaml``.

Walks ``docs/recipes/<source-id>/<layer-id>.md``, parses each
recipe's YAML frontmatter, and writes a single deterministic
``index.yaml`` that's safe to commit.  Consumers:

  * AI agents reading the index instead of paging through every
    recipe file (G7 Phase 1 / Phase 2).
  * llms.txt generation (G7 Phase 2, blocked on this index).
  * Documentation site cross-links (E2 / E5).

Usage::

    python3 scripts/build-recipe-index.py            # write the index
    python3 scripts/build-recipe-index.py --stdout   # print only
    python3 scripts/build-recipe-index.py --check    # exit 1 on drift

The ``--stdout`` mode is what ``scripts/check-recipe-schema.py`` calls
during the drift gate so the two scripts share a single emit path.
``--check`` is provided for symmetry with the rest of the gates but
duplicates the recipe-schema gate's drift check; the canonical drift
gate is ``scripts/check-recipe-schema.py``.

Determinism contract:

  1. Recipes are visited in lexicographic ``<source>/<layer>``.
  2. YAML dump uses ``sort_keys=False`` and ``default_flow_style=False``
     so the on-disk output reads top-to-bottom in the order produced
     here — NOT alphabetised, because we want ``id`` / ``source`` /
     ``layer`` / ``status`` up top where humans skim.
  3. The emitter writes UTF-8 with Unix line endings and a trailing
     newline.  Anything else fails the byte-for-byte drift comparison
     in ``check-recipe-schema.py``.

No third-party deps beyond PyYAML.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore[import-not-found]
except ImportError:
    print(
        "[FAIL] PyYAML is required to build the recipe index.\n"
        "  Install with: python3 -m pip install --user pyyaml",
        file=sys.stderr,
    )
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[1]
RECIPES_DIR = REPO_ROOT / "docs" / "recipes"
INDEX_PATH = REPO_ROOT / "docs" / "_machine" / "recipes" / "index.yaml"


FIELD_ORDER = (
    "id",
    "source",
    "layer",
    "status",
    "last_verified_iso8601",
    "verified_against",
    "splunk_apps_required",
    "expected_fields",
    "required_formatter_options",
    "ot_safety_relevant",
    "references",
    "path",
)


def split_frontmatter(text: str) -> dict[str, Any]:
    """Return the YAML frontmatter dict, or raise ValueError."""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("no frontmatter --- delimiter at top of file")
    closing = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            closing = idx
            break
    if closing is None:
        raise ValueError("frontmatter is not closed by a --- delimiter")
    data = yaml.safe_load("".join(lines[1:closing]))
    if not isinstance(data, dict):
        raise ValueError("frontmatter is not a YAML mapping")
    return data


def collect_recipes() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not RECIPES_DIR.is_dir():
        return out
    for src_dir in sorted(RECIPES_DIR.iterdir()):
        if not src_dir.is_dir():
            continue
        for f in sorted(src_dir.iterdir()):
            if f.suffix != ".md" or f.name == "index.md":
                continue
            try:
                fm = split_frontmatter(f.read_text(encoding="utf-8"))
            except ValueError as exc:
                # The schema gate is the authoritative validator; we
                # just skip malformed files here and let the gate flag
                # them.  Print a warning so a maintainer running the
                # builder directly notices.
                print(
                    f"[WARN] skipping {f.relative_to(REPO_ROOT)}: {exc}",
                    file=sys.stderr,
                )
                continue
            entry = {
                "id": fm.get("id"),
                "source": fm.get("source"),
                "layer": fm.get("layer"),
                "status": fm.get("status"),
                "last_verified_iso8601": fm.get("last_verified_iso8601"),
                "verified_against": fm.get("verified_against"),
                "splunk_apps_required": fm.get("splunk_apps_required", []),
                "expected_fields": fm.get("expected_fields", []),
                "required_formatter_options": fm.get(
                    "required_formatter_options", []
                ),
                "ot_safety_relevant": fm.get("ot_safety_relevant", False),
                "references": fm.get("references", []),
                "path": str(f.relative_to(REPO_ROOT)).replace("\\", "/"),
            }
            # Keep the FIELD_ORDER intact even when some keys are None
            # by reconstructing in order.
            ordered = {k: entry[k] for k in FIELD_ORDER if k in entry}
            out.append(ordered)
    return out


class _OrderedDumper(yaml.SafeDumper):
    """PyYAML SafeDumper that keeps dict key insertion order."""


def _represent_dict_order(dumper: _OrderedDumper, data: dict[str, Any]) -> Any:
    return dumper.represent_mapping("tag:yaml.org,2002:map", data.items())


_OrderedDumper.add_representer(dict, _represent_dict_order)


def render_index(recipes: list[dict[str, Any]]) -> str:
    """Render the full index.yaml document as a string."""
    # Compute a UTC date stamp for the human-facing field.  The actual
    # byte-content is recipe-derived; this stamp does NOT change unless
    # the recipe set changes (so the drift gate doesn't fire from a
    # clock tick).  We embed the recipe COUNT, not the date.
    document: dict[str, Any] = {
        "schema_version": 1,
        "generator": "scripts/build-recipe-index.py",
        "recipe_count": len(recipes),
        "recipes": recipes,
    }

    buf = io.StringIO()
    buf.write(
        "# AUTO-GENERATED — do not edit by hand.\n"
        "# Source: docs/recipes/<source>/<layer>.md frontmatter blocks.\n"
        "# Regenerate: python3 scripts/build-recipe-index.py\n"
        "# Drift gate: python3 scripts/check-recipe-schema.py\n"
    )
    yaml.dump(
        document,
        buf,
        Dumper=_OrderedDumper,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=1000,
    )
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--stdout",
        action="store_true",
        help="print the index to stdout instead of writing to disk",
    )
    group.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the on-disk index differs from the rendered output",
    )
    args = parser.parse_args()

    recipes = collect_recipes()
    rendered = render_index(recipes)

    if args.stdout:
        sys.stdout.write(rendered)
        return 0

    if args.check:
        if not INDEX_PATH.is_file():
            print(
                f"[FAIL] {INDEX_PATH.relative_to(REPO_ROOT)} does not exist; "
                "run `python3 scripts/build-recipe-index.py` to create it.",
                file=sys.stderr,
            )
            return 1
        actual = INDEX_PATH.read_text(encoding="utf-8")
        if actual != rendered:
            print(
                f"[FAIL] {INDEX_PATH.relative_to(REPO_ROOT)} is out of sync; "
                "run `python3 scripts/build-recipe-index.py` and commit.",
                file=sys.stderr,
            )
            return 1
        print(f"[PASS] {INDEX_PATH.relative_to(REPO_ROOT)} is in sync.")
        return 0

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    print(
        f"[OK] wrote {INDEX_PATH.relative_to(REPO_ROOT)} "
        f"({len(recipes)} recipe(s))."
    )
    return 0


# Silence the unused datetime import lint — keep it imported in case
# a future revision wants to embed a deterministic generation date.
_ = dt

if __name__ == "__main__":
    raise SystemExit(main())
