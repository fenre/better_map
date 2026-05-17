#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G7 Phase 2 — Emit ``docs/llms.txt`` (per the llms.txt convention).

The `llms.txt convention <https://llmstxt.org/>`_ asks every project
to publish a single Markdown-formatted text file at the site root
that gives an LLM a structured, link-rich tour of the project's
documentation in roughly a few thousand tokens.  This script walks
the existing structured sources of truth (NO duplication, NO
prose-only inputs) and emits a deterministic ``docs/llms.txt`` that
the MkDocs build copies verbatim to ``site/llms.txt`` (MkDocs treats
``.txt`` as a static asset and does not re-render it as markdown).

Structured inputs (drift-gated elsewhere — see headers in each file):

  * ``mkdocs.yml`` — `nav:` tree is the canonical site map.
  * ``docs/_machine/recipes/index.yaml`` — every E5 per-source recipe
    (E5 Phase 1, drift-gated by ``check-recipe-schema.py``).
  * ``docs/_machine/integrations/*.yaml`` — the eight Splunk
    integration scaffolds (G7 Phase 1, hand-maintained).
  * ``docs/_machine/formatter-schema.json`` — the 82 formatter
    options (G7 Phase 1, drift-gated by
    ``check-formatter-schema.py``).
  * ``docs/_machine/agents.md`` / ``docs/_machine/README.md`` — the
    operator manual and ``_machine/`` contract (G7 Phase 1).

Output format roughly:

    # Better Map

    > <one-line description from mkdocs.yml `site_description`>

    <one-paragraph orientation for an LLM>

    ## Agent guide
    - [Agent operating guide](https://.../_machine/agents/)
    - [Machine-readable layer contract](https://.../_machine/)

    ## Getting started
    - [Install](https://.../getting-started/)
    ...

    ## Reference
    - [Formatter options (82, JSON Schema 2020-12)](https://.../reference/formatter/)
    ...

    ## Integrations
    - [ITSI (Splunk IT Service Intelligence) — service map (experimental)](https://.../_machine/integrations/itsi/) — sourced from `src/lib/splunk/itsi.js`
    ... 8 entries ...

    ## Recipes
    - [CIM Network Traffic → markers (unverified)](https://.../recipes/cim-network-traffic/markers/) — Splunk_SA_CIM, builtin:iplocation
    ... per recipe ...

    ## Runbooks
    - [Supply chain (G1)](...)
    - [Upgrade hygiene (G3)](...)

    ## Machine-readable layer (`docs/_machine/`)
    - [formatter-schema.json](https://github.com/.../formatter-schema.json)
    ...

    ## Project meta
    - [README](https://github.com/.../README.md)
    - [Roadmap](https://github.com/.../ROADMAP.md)
    - [Changelog](https://github.com/.../CHANGELOG.md)
    - [License (MIT)](https://github.com/.../LICENSE)

Usage::

    python3 scripts/build-llms-txt.py            # write docs/llms.txt
    python3 scripts/build-llms-txt.py --stdout   # print only
    python3 scripts/build-llms-txt.py --check    # exit 1 on drift

Deterministic contract:

  * UTF-8 with Unix line endings; trailing newline.
  * Sections are emitted in a fixed order; entries within each
    section follow the source-of-truth file order (mkdocs.yml `nav:`
    declaration order; recipe index.yaml emission order; integration
    YAMLs in lexicographic order).
  * Generation date is NOT embedded — the file is content-derived
    so the drift gate does not fire from a clock tick.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    print(
        "[FAIL] PyYAML is required to build llms.txt.\n"
        "  Install with: python3 -m pip install --user pyyaml",
        file=sys.stderr,
    )
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[1]
LLMS_TXT_PATH = REPO_ROOT / "docs" / "llms.txt"

MKDOCS_YML = REPO_ROOT / "mkdocs.yml"
INTEGRATIONS_DIR = REPO_ROOT / "docs" / "_machine" / "integrations"
RECIPES_INDEX = REPO_ROOT / "docs" / "_machine" / "recipes" / "index.yaml"
FORMATTER_SCHEMA = REPO_ROOT / "docs" / "_machine" / "formatter-schema.json"
RECIPE_SCHEMA = REPO_ROOT / "docs" / "_machine" / "recipes" / "recipe-schema.json"

GITHUB_BLOB_BASE = "https://github.com/fenre/better_map/blob/main"
GITHUB_TREE_BASE = "https://github.com/fenre/better_map/tree/main"


# ----------------------------------------------------- mkdocs.yml parse


class _MkdocsLoader(yaml.SafeLoader):
    """SafeLoader that tolerates MkDocs's custom YAML tags.

    MkDocs uses ``!!python/name:material.extensions.emoji.twemoji`` and
    similar custom tags in ``theme:`` / ``markdown_extensions:``.
    SafeLoader rejects them by default; we register a no-op constructor
    so the parse doesn't fail mid-walk (we only ever read ``nav:`` and
    ``site_*`` keys anyway).
    """


def _ignore_unknown_tag(loader: _MkdocsLoader, suffix: str, node: Any) -> Any:  # noqa: ARG001
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    return None


_MkdocsLoader.add_multi_constructor("tag:yaml.org,2002:python/name:", _ignore_unknown_tag)
_MkdocsLoader.add_multi_constructor("tag:yaml.org,2002:python/object/apply:", _ignore_unknown_tag)
_MkdocsLoader.add_multi_constructor("!", _ignore_unknown_tag)


def parse_mkdocs() -> dict[str, Any]:
    with MKDOCS_YML.open(encoding="utf-8") as f:
        return yaml.load(f, Loader=_MkdocsLoader)  # noqa: S506 — custom loader, controlled input


def url_for(site_url: str, docs_relpath: str) -> str:
    """Convert a `docs/`-relative markdown path to its published URL.

    `mkdocs build` with `use_directory_urls: true` (our config) renders
    every `path/to/foo.md` as `path/to/foo/` (with trailing slash and
    index.html inside).  `path/to/index.md` collapses to `path/to/`.
    """
    site_url = site_url.rstrip("/") + "/"
    rel = docs_relpath.strip("/")
    if rel.endswith(".md"):
        rel = rel[: -len(".md")]
    if rel.endswith("/index"):
        rel = rel[: -len("/index")]
    if rel == "index":
        return site_url
    return f"{site_url}{rel}/"


def walk_nav(
    nav: list[Any], site_url: str
) -> list[tuple[list[str], str, str]]:
    """Flatten the MkDocs nav tree.

    Returns a list of (parent_titles, title, url) tuples, preserving
    declaration order.  ``parent_titles`` is the breadcrumb above the
    entry; empty for top-level items.
    """
    out: list[tuple[list[str], str, str]] = []

    def _walk(items: list[Any], breadcrumbs: list[str]) -> None:
        for item in items:
            if isinstance(item, str):
                out.append((breadcrumbs[:], _title_from_path(item), url_for(site_url, item)))
                continue
            if not isinstance(item, dict) or len(item) != 1:
                continue
            (title, value), = item.items()
            if isinstance(value, str):
                out.append((breadcrumbs[:], title, url_for(site_url, value)))
            elif isinstance(value, list):
                _walk(value, breadcrumbs + [title])

    _walk(nav, [])
    return out


def _title_from_path(path: str) -> str:
    """Derive a display title for a `docs/`-relative path.

    MkDocs would normally use the markdown file's H1; we don't want to
    parse every page, so we use the path stem.  The one case worth
    cleaning up is ``foo/index.md``: in MkDocs that's the section
    landing page and its title comes from the file's H1, but in a flat
    bullet list "Overview" is the clearest stand-in.
    """
    stem = Path(path).stem
    if stem == "index":
        return "Overview"
    return stem.replace("-", " ").replace("_", " ").title()


# ----------------------------------------------------- integrations parse


def collect_integrations() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not INTEGRATIONS_DIR.is_dir():
        return out
    for f in sorted(INTEGRATIONS_DIR.iterdir()):
        if f.suffix != ".yaml":
            continue
        try:
            data = yaml.safe_load(f.read_text(encoding="utf-8"))
        except yaml.YAMLError:  # pragma: no cover
            continue
        if not isinstance(data, dict):
            continue
        out.append(
            {
                "id": data.get("id", f.stem),
                "display_name": data.get("display_name", f.stem),
                "status": data.get("status", "unknown"),
                "splunk_app_required": data.get("splunk_app_required") or "",
                "machine_path": f"docs/_machine/integrations/{f.name}",
                "source_path": data.get("meta", {}).get("source_of_truth_path") or "",
            }
        )
    return out


# ----------------------------------------------------- recipes parse


def collect_recipes() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not RECIPES_INDEX.is_file():
        return out
    data = yaml.safe_load(RECIPES_INDEX.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return out
    for entry in data.get("recipes", []):
        if not isinstance(entry, dict):
            continue
        source = entry.get("source") or {}
        layer = entry.get("layer") or {}
        apps = entry.get("splunk_apps_required") or []
        app_summary = ", ".join(a.get("id", "") for a in apps if a.get("id"))
        out.append(
            {
                "id": entry.get("id", ""),
                "source_display": source.get("display_name", source.get("id", "")),
                "layer_display": layer.get("display_name", layer.get("id", "")),
                "status": entry.get("status", "unknown"),
                "splunk_apps_summary": app_summary or "none",
                "path": entry.get("path", ""),
            }
        )
    return out


# ----------------------------------------------------- formatter schema


def count_formatter_options() -> int:
    if not FORMATTER_SCHEMA.is_file():
        return 0
    schema = json.loads(FORMATTER_SCHEMA.read_text(encoding="utf-8"))
    return len(schema.get("properties", {}))


# ----------------------------------------------------- render


def render(site_url: str, site_desc: str) -> str:
    nav_entries = walk_nav(parse_mkdocs().get("nav") or [], site_url)
    integrations = collect_integrations()
    recipes = collect_recipes()
    formatter_count = count_formatter_options()

    # Bucket nav entries by top-level breadcrumb so we can group cleanly.
    by_section: dict[str, list[tuple[str, str]]] = {}
    flat_top: list[tuple[str, str]] = []
    for crumbs, title, url in nav_entries:
        if not crumbs:
            flat_top.append((title, url))
        else:
            by_section.setdefault(crumbs[0], []).append((title, url))

    buf = io.StringIO()

    # Header
    one_line_desc = " ".join(line.strip() for line in site_desc.strip().splitlines()).strip()
    buf.write("# Better Map\n\n")
    buf.write(f"> {one_line_desc}\n\n")
    buf.write(
        "Better Map is a Splunk Dashboard Studio v2 custom map "
        "visualization built on MapLibre GL JS. The project is documented "
        "in two layers: human-readable pages rendered as a Material site "
        "(this `llms.txt` indexes them) and a structured machine-readable "
        "layer under `docs/_machine/` (JSON Schema for the "
        f"{formatter_count} formatter options, YAML scaffolds for each "
        "Splunk integration, YAML index of per-source recipes). Every "
        "entry below resolves to a single page; the structured "
        "machine-readable files are linked at the bottom for agents that "
        "would rather consume the contract directly than read prose.\n\n"
    )
    buf.write(
        "All URLs below are publicly accessible; the project ships under "
        "the MIT licence and the source repo is at "
        "<https://github.com/fenre/better_map>.\n\n"
    )

    # Agent guide
    buf.write("## Agent guide\n\n")
    buf.write(
        f"- [Agent operating guide]({site_url}_machine/agents/): the five "
        "non-negotiables (formatter schema / manifest / CSS contract / "
        "dashboard tokens / BM-CT-1), the runtime envelope, how to add "
        "a formatter option / integration / recipe, the pre-commit "
        "checklist, and the common mistake → fix table.\n"
    )
    buf.write(
        f"- [Machine-readable layer contract]({site_url}_machine/): what "
        "each file under `docs/_machine/` documents, what its source of "
        "truth is, and which CI gate prevents drift.\n"
    )
    buf.write("\n")

    # Getting started — pull from nav
    if "Getting started" in by_section:
        buf.write("## Getting started\n\n")
        for title, url in by_section["Getting started"]:
            buf.write(f"- [{title}]({url})\n")
        buf.write("\n")

    # Reference
    if "Reference" in by_section:
        buf.write("## Reference\n\n")
        for title, url in by_section["Reference"]:
            if "Formatter" in title:
                buf.write(
                    f"- [{title}]({url}): the {formatter_count} formatter "
                    "options exposed by the visualization. The canonical "
                    "JSON Schema 2020-12 is at "
                    f"<{GITHUB_BLOB_BASE}/docs/_machine/formatter-schema.json>.\n"
                )
            else:
                buf.write(f"- [{title}]({url})\n")
        buf.write("\n")

    # Runtime envelope (top-level page)
    runtime_url = next(
        (url for title, url in flat_top if "Runtime" in title), None
    )
    if runtime_url:
        buf.write("## Runtime envelope (binding)\n\n")
        buf.write(
            f"- [Runtime envelope]({runtime_url}): the binding constraints "
            "on what better_map can do (Dashboard Studio v2 only, single "
            "AMD bundle, CSP / `connect-src 'self'`, no external fetches "
            "outside basemap tiles / air-gapped PMTiles / declared "
            "integrations, no Web Workers from cross-origin URLs, no "
            "Dashboard Studio v3 `core.*` keys). Read this BEFORE proposing "
            "any architectural change.\n"
        )
        buf.write("\n")

    # Integrations
    if integrations or "Integrations" in by_section:
        buf.write("## Integrations (Splunk)\n\n")
        # First: human-facing pages in the Integrations section.
        for title, url in by_section.get("Integrations", []):
            buf.write(f"- [{title}]({url})\n")
        if integrations:
            buf.write(
                "\nEach integration also has a machine-readable scaffold "
                "under `docs/_machine/integrations/` mirroring the JS "
                "module it shadows in `src/lib/splunk/`. The full "
                f"directory is at <{GITHUB_TREE_BASE}/docs/_machine/integrations>.\n\n"
            )
            for entry in integrations:
                status = entry["status"]
                app = entry["splunk_app_required"] or "n/a"
                machine_url = f"{GITHUB_BLOB_BASE}/{entry['machine_path']}"
                buf.write(
                    f"- [{entry['display_name']} ({status})]({machine_url}): "
                    f"requires `{app}`. Source: `{entry['source_path']}`.\n"
                )
        buf.write("\n")

    # Recipes
    if "Recipes" in by_section:
        # The first nav entry under Recipes is the section index — link
        # it as the "Recipes overview" entry below.
        index_url = by_section["Recipes"][0][1]
        buf.write("## Recipes (per-source playbooks)\n\n")
        buf.write(
            f"- [Recipes overview]({index_url}): the recipe contract, the "
            "six-section structure, the CI gate, the JSON Schema, and "
            "how to add a new recipe. The machine-readable index of every "
            "shipped recipe is at "
            f"<{GITHUB_BLOB_BASE}/docs/_machine/recipes/index.yaml>.\n"
        )
        # Then list each recipe with a one-line summary built from the
        # index entry.
        for entry in recipes:
            apps = entry["splunk_apps_summary"]
            status = entry["status"]
            # Convert docs/recipes/<src>/<layer>.md → site URL.
            rel = entry["path"]
            if rel.startswith("docs/"):
                rel_short = rel[len("docs/") :]
            else:
                rel_short = rel
            page_url = url_for(site_url, rel_short)
            label = f"{entry['source_display']} → {entry['layer_display']}"
            buf.write(
                f"- [{label} ({status})]({page_url}): apps required: {apps}.\n"
            )
        buf.write("\n")

    # Runbooks
    if "Runbooks" in by_section:
        buf.write("## Runbooks\n\n")
        for title, url in by_section["Runbooks"]:
            buf.write(f"- [{title}]({url})\n")
        buf.write("\n")

    # Other top-level pages we haven't already linked. ``Home`` is
    # already represented by the H1 / `site_url` link in the header, so
    # drop it here.
    skip_top = {"Runtime envelope", "Home"}
    other_top = [
        (title, url) for title, url in flat_top if title not in skip_top
    ]
    if other_top:
        buf.write("## Operations & deployment\n\n")
        for title, url in other_top:
            buf.write(f"- [{title}]({url})\n")
        buf.write("\n")

    # Performance / Air-gapped / Contributing / Changelog / Roadmap —
    # these are flat top-level entries. If walk_nav populated them above
    # they're already in `other_top`. The Performance and Air-gapped
    # entries deserve a callout in their own section because customers
    # land there first.
    # (No additional emission here; the above loop covers them.)

    # Machine-readable layer (one bullet per drift-gated file)
    buf.write("## Machine-readable layer (`docs/_machine/`)\n\n")
    buf.write(
        "Every file below is either auto-generated from a source of "
        "truth elsewhere in the repo OR hand-maintained with that fact "
        "declared in a `meta:` block. Either way the contents are stable "
        "enough to be diffed in CI; the corresponding drift gates live in "
        f"`scripts/check-*.py`. The README is at <{site_url}_machine/>.\n\n"
    )
    buf.write(
        f"- [`formatter-schema.json`]({GITHUB_BLOB_BASE}/docs/_machine/formatter-schema.json): "
        f"JSON Schema 2020-12 for the {formatter_count} formatter options. "
        "Generated from `formatter.html`. Drift gate: "
        "`scripts/check-formatter-schema.py`.\n"
    )
    buf.write(
        f"- [`integrations/`]({GITHUB_TREE_BASE}/docs/_machine/integrations): "
        f"{len(integrations)} hand-authored YAML scaffolds, one per Splunk "
        "integration in `src/lib/splunk/`.\n"
    )
    buf.write(
        f"- [`recipes/recipe-schema.json`]({GITHUB_BLOB_BASE}/docs/_machine/recipes/recipe-schema.json): "
        "JSON Schema 2020-12 for the YAML frontmatter every recipe "
        "MUST carry. Hand-maintained.\n"
    )
    buf.write(
        f"- [`recipes/index.yaml`]({GITHUB_BLOB_BASE}/docs/_machine/recipes/index.yaml): "
        "auto-generated index of every recipe under `docs/recipes/`. "
        "Drift gate: `scripts/check-recipe-schema.py`.\n"
    )
    buf.write(
        f"- [`agents.md`]({site_url}_machine/agents/): operating guide "
        "for AI agents working on the repository itself.\n"
    )
    buf.write(
        f"- [`README.md`]({site_url}_machine/): the `_machine/` "
        "contract — what's here, what's not, how to consume it.\n"
    )
    buf.write("\n")

    # Project meta
    buf.write("## Project meta\n\n")
    buf.write(
        f"- [README]({GITHUB_BLOB_BASE}/README.md): user-facing overview, "
        "screenshots, installation summary.\n"
    )
    buf.write(
        f"- [Roadmap]({GITHUB_BLOB_BASE}/ROADMAP.md): the binding planning "
        "document. §1a is the runtime envelope; §3 is the work-item "
        "breakdown; §4 is the milestone sequence; §7 is the defensibility "
        "checklist.\n"
    )
    buf.write(
        f"- [Changelog]({GITHUB_BLOB_BASE}/CHANGELOG.md): per-release "
        "summary, in Keep a Changelog format.\n"
    )
    buf.write(
        f"- [LICENSE]({GITHUB_BLOB_BASE}/LICENSE): MIT.\n"
    )
    buf.write(
        f"- [Repository]({GITHUB_TREE_BASE}): the canonical source tree.\n"
    )
    buf.write("\n")

    # Optional — lower priority links agents can skip if budget is tight.
    buf.write("## Optional\n\n")
    buf.write(
        f"- [Air-gapped PMTiles build]({GITHUB_BLOB_BASE}/better_map/appserver/static/visualizations/better_map/AIR-GAPPED-PMTILES.md): "
        "advanced operator runbook for fully-offline basemap deployment.\n"
    )
    buf.write(
        f"- [GitHub Actions]({GITHUB_TREE_BASE}/.github/workflows): "
        "every CI gate documented in the agents.md pre-commit checklist "
        "is wired into one of these workflows.\n"
    )
    buf.write(
        f"- [Cursor rules]({GITHUB_TREE_BASE}/.cursor/rules): repo-local "
        "rules for AI agents working in Cursor. Includes the binding "
        "OT-safety boundary at `ot-safety.mdc`.\n"
    )

    return buf.getvalue()


# ----------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--stdout",
        action="store_true",
        help="print the rendered llms.txt to stdout instead of writing",
    )
    group.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the on-disk llms.txt differs from the rendered output",
    )
    args = parser.parse_args()

    mkdocs = parse_mkdocs()
    site_url = mkdocs.get("site_url") or "https://fenre.github.io/better_map/"
    site_desc = mkdocs.get("site_description") or "Splunk Dashboard Studio map visualization."

    rendered = render(site_url, site_desc)

    if args.stdout:
        sys.stdout.write(rendered)
        return 0

    if args.check:
        if not LLMS_TXT_PATH.is_file():
            print(
                f"[FAIL] {LLMS_TXT_PATH.relative_to(REPO_ROOT)} does not "
                "exist; run `python3 scripts/build-llms-txt.py` to create it.",
                file=sys.stderr,
            )
            return 1
        actual = LLMS_TXT_PATH.read_text(encoding="utf-8")
        if actual != rendered:
            print(
                f"[FAIL] {LLMS_TXT_PATH.relative_to(REPO_ROOT)} is out of "
                "sync vs the structured sources of truth. Run "
                "`python3 scripts/build-llms-txt.py` and commit.",
                file=sys.stderr,
            )
            return 1
        print(f"[PASS] {LLMS_TXT_PATH.relative_to(REPO_ROOT)} is in sync.")
        return 0

    LLMS_TXT_PATH.parent.mkdir(parents=True, exist_ok=True)
    LLMS_TXT_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    line_count = rendered.count("\n")
    print(
        f"[OK] wrote {LLMS_TXT_PATH.relative_to(REPO_ROOT)} "
        f"({len(rendered):,} bytes, {line_count} lines)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
