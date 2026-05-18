#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""G7 Phase 2 — Emit ``docs/llms-full.txt`` (full-body llms.txt sibling).

The `llms.txt convention <https://llmstxt.org/>`_ pairs a short
``llms.txt`` (link-rich index, drift-gated by ``build-llms-txt.py``)
with an optional ``llms-full.txt`` that concatenates the BODY of every
linked page into a single LLM-friendly text dump. ``llms-full.txt``
exists because some agents would rather one-shot the project than
follow links, and because some CSP-restricted environments cannot
issue follow-up fetches.

This script:

1. Walks ``mkdocs.yml`` `nav:` (declaration order — the same source
   ``build-llms-txt.py`` uses, so the two indices stay in lockstep).
2. For each navigable page, reads ``docs/<path>.md`` and resolves
   ``{% include-markdown "<path>" %}`` directives the
   ``mkdocs-include-markdown-plugin`` exposes (the only two pages
   that use this today are ``docs/changelog.md`` and
   ``docs/roadmap.md``, which pull ``CHANGELOG.md`` and ``ROADMAP.md``
   respectively from the repo root).
3. Strips the MkDocs Material theme chrome that is purely visual and
   carries no information for an LLM:

   * YAML front-matter (``---\\n…\\n---``)
   * ``:material-*:`` / ``:octicons-*:`` / ``:fontawesome-*:`` icon
     shortcodes (the surrounding text is preserved)
   * ``<div class="grid cards" markdown>`` / ``</div>`` wrappers
     (the bullets inside survive)
   * ``{ #anchor data-toc-label="x" }`` and ``{ .css-class }``
     attr-list suffixes
   * ``!!! tip "Title"`` admonitions (kept as ``> **Tip:** Title``
     blockquotes so the semantics survive)
   * MkDocs Material's permalink anchors (``[¶](#…)``)

4. Concatenates the cleaned bodies with deterministic delimiters
   (``# ====`` per page, with the page URL + source path on the line
   below the H1) so an agent can grep BOTH on a heading and on a URL.
5. Appends two machine-readable appendices distilled from the
   structured sources of truth: the integrations matrix and the
   recipe matrix. These mirror what ``llms.txt`` links to, but
   present the field contracts as inline tables so the agent does not
   need a follow-up fetch to ``docs/_machine/integrations/*.yaml``
   or ``docs/_machine/recipes/index.yaml``.

Budget contract (derived from the ``llms-full.txt`` body of the
spec, recalibrated in E5 Phase 2 wave 6 against actual 18-recipe
corpus; further extended in wave 8 by also trimming historical
``> **Status (...): E5 Phase 2 wave N SHIPPED`` and ``G7 Phase 2
follow-up #N SHIPPED`` blockquotes from ``roadmap.md`` — see
``strip_roadmap_status_blocks`` below — and in wave 10 by trimming
older ``## [VERSION] - DATE`` sections from ``changelog.md`` after
the top ``_CHANGELOG_KEEP_VERSIONS`` are kept — see
``strip_changelog_old_versions`` below):

  * Per-page warning at **50,000 estimated tokens** — one page should
    not dominate the corpus.
  * Total warning at **175,000 estimated tokens** — the agent still
    has 25k of headroom inside a 200k context window. The original
    150k threshold was a guess pre-data; with 24 recipes shipped and
    measured per-recipe marginal cost of ~3.3k tokens (post-trim),
    175k matches the actual baseline + ~5-6 recipes of headroom
    before the next recalibration is warranted.
  * Total HARD FAIL at **200,000 estimated tokens** — output is
    deliberately unusable past this. Add a follow-up PR that elides
    less-important pages OR raise the budget after explicit roadmap
    review.

Token estimation uses the same 4-chars-per-token approximation
``openai`` uses in its cookbook; this is a lower bound for English
prose and overshoots slightly on dense Markdown tables. The estimate
is intentionally conservative — if we over-warn, we get to revisit
sooner.

Usage::

    python3 scripts/build-llms-full-txt.py            # write docs/llms-full.txt
    python3 scripts/build-llms-full-txt.py --stdout   # print to stdout
    python3 scripts/build-llms-full-txt.py --check    # CI drift gate

Deterministic contract:

  * UTF-8 with Unix line endings; trailing newline.
  * Pages appear in mkdocs.yml `nav:` declaration order.
  * Integration entries appear in lexicographic filename order
    (mirrors ``build-llms-txt.py``).
  * Recipe entries appear in ``index.yaml`` emission order.
  * No clock-based fields. The drift gate fires only when an input
    file changes.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    print(
        "[FAIL] PyYAML is required to build llms-full.txt.\n"
        "  Install with: python3 -m pip install --user pyyaml",
        file=sys.stderr,
    )
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[1]
LLMS_FULL_PATH = REPO_ROOT / "docs" / "llms-full.txt"
DOCS_DIR = REPO_ROOT / "docs"
MKDOCS_YML = REPO_ROOT / "mkdocs.yml"
INTEGRATIONS_DIR = DOCS_DIR / "_machine" / "integrations"
RECIPES_INDEX = DOCS_DIR / "_machine" / "recipes" / "index.yaml"
FORMATTER_SCHEMA = DOCS_DIR / "_machine" / "formatter-schema.json"

GITHUB_BLOB_BASE = "https://github.com/fenre/better_map/blob/main"
GITHUB_TREE_BASE = "https://github.com/fenre/better_map/tree/main"

# Budget contract (see module docstring).
CHARS_PER_TOKEN = 4
PER_PAGE_WARN_TOKENS = 50_000
TOTAL_WARN_TOKENS = 175_000
TOTAL_FAIL_TOKENS = 200_000

# Recipe trim contract — see strip_recipe_advisory() and the G7 wave
# 4a (initial trim) + wave 6 (extended trim) ROADMAP blocks. Recipe
# pages under `docs/recipes/<source>/<layer>.md` carry the bulk of
# their author guidance in §6 Gotchas and a trailing "## Verification
# status" section. §5 Screenshot is a stub waiting on D5 harness
# (~100 tokens of boilerplate × 18 recipes = ~1.8k tokens of pure
# duplication today). Those sections are human-targeted advisory
# content; the LLM-actionable contract (frontmatter + §1 Source
# description + §2 SPL recipe + §3 Expected fields + §4 Recommended
# formatter config) is fully self-contained without §5 / §6.
# Trimming §5 onward saves ~3.5-4k tokens per recipe (~64-72k across
# 18 recipes) in llms-full.txt vs no-trim. The unabridged recipe is
# one click away via the per-page block's URL header; this trim does
# NOT affect the published MkDocs site, llms.txt, or
# docs/_machine/recipes/index.yaml — only the body emitted into
# llms-full.txt. When D5 ships and §5 carries actual screenshot data
# (not stubs), revisit whether to move the trim point back to §6.
_RECIPE_TRIM_AT = re.compile(r"^## 5\.\s+Screenshot\s*$", re.MULTILINE)

# Roadmap status-block trim contract — see strip_roadmap_status_blocks()
# and the E5 Phase 2 wave 8 ROADMAP block. ROADMAP.md is the project's
# rolling change log; under E5 / G7 each shipped wave appends a
# `> **Status (vX-prep, YYYY-MM-DD): E5 Phase 2 wave N SHIPPED ...`
# blockquote (or `G7 Phase 2 follow-up #N SHIPPED ...`). These blocks
# are write-once human progress notes and their LIVE state
# (recipe count, layer-type coverage, source-pattern coverage) is
# duplicated in (a) the E5 row of the headline goals table at the
# top of ROADMAP.md, and (b) `docs/recipes/index.md` which the
# auto-generator keeps in sync. By the time wave 7 shipped, eight
# such blockquotes accounted for ~20-30k tokens in llms-full.txt
# — the largest single non-recipe content source. Trimming them
# preserves the on-disk ROADMAP.md (unchanged for human readers) and
# the MkDocs site (full ROADMAP.md still renders) while reclaiming
# the budget for new recipes. Match anchor is line-prefix-based so
# the regex never crosses out of the blockquote into adjacent prose.
_ROADMAP_STATUS_BLOCK = re.compile(
    r"^> \*\*Status \(v[\d.]+-prep, \d{4}-\d{2}-\d{2}\): "
    r"(?:E5 Phase 2 wave \d+|G7 Phase 2 follow-up)"
    r"[^\n]*\n"
    r"(?:>[^\n]*\n)*",
    re.MULTILINE,
)

# Changelog older-versions trim contract — see strip_changelog_old_versions()
# and the E5 Phase 2 wave 10 ROADMAP block. CHANGELOG.md is the
# Keep-a-Changelog-formatted release history; by wave 9 the file held
# 18 version sections (1.6.2 down to 0.1.0) totalling ~19.6k tokens
# in llms-full.txt — the second-largest single page after roadmap.md.
# Each section is a `## [VERSION] - DATE` heading. Most of an LLM's
# value for changelog content is in the CURRENT release cycle (the
# top 3 versions tell the agent what the latest behavioural contract
# is, what just changed, and what's pending). Earlier versions are
# historical reference that an agent needs only when explicitly
# investigating a prior release — recoverable via the URL pointer
# the trim appends. The trim keeps the top _CHANGELOG_KEEP_VERSIONS
# sections fully and replaces everything below with a one-line
# pointer + the older-version-titles list (so the agent still knows
# WHICH older versions exist).
#
# The on-disk CHANGELOG.md is unchanged — the trim runs only in
# the in-memory body before it lands in llms-full.txt. The MkDocs
# site continues to render every version for human readers via
# the unaltered `{% include-markdown "../CHANGELOG.md" %}` include.
_CHANGELOG_VERSION_HEADING = re.compile(
    r"^## \[(?P<version>[\d.]+)\] - (?P<date>\d{4}-\d{2}-\d{2})\s*$",
    re.MULTILINE,
)
_CHANGELOG_KEEP_VERSIONS = 3


# ----------------------------------------------------- mkdocs.yml parse


class _MkdocsLoader(yaml.SafeLoader):
    """SafeLoader that tolerates MkDocs's custom YAML tags."""


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
        return yaml.load(f, Loader=_MkdocsLoader)  # noqa: S506


def url_for(site_url: str, docs_relpath: str) -> str:
    """Convert a `docs/`-relative markdown path to its published URL."""
    site_url = site_url.rstrip("/") + "/"
    rel = docs_relpath.strip("/")
    if rel.endswith(".md"):
        rel = rel[: -len(".md")]
    if rel.endswith("/index"):
        rel = rel[: -len("/index")]
    if rel == "index":
        return site_url
    return f"{site_url}{rel}/"


def walk_nav(nav: list[Any]) -> list[tuple[list[str], str, str]]:
    """Return (breadcrumbs, title, docs_relpath) per page in nav order."""
    out: list[tuple[list[str], str, str]] = []

    def _walk(items: list[Any], breadcrumbs: list[str]) -> None:
        for item in items:
            if isinstance(item, str):
                out.append((breadcrumbs[:], _title_from_path(item), item))
                continue
            if not isinstance(item, dict) or len(item) != 1:
                continue
            (title, value), = item.items()
            if isinstance(value, str):
                out.append((breadcrumbs[:], title, value))
            elif isinstance(value, list):
                _walk(value, breadcrumbs + [title])

    _walk(nav, [])
    return out


def _title_from_path(path: str) -> str:
    stem = Path(path).stem
    if stem == "index":
        return "Overview"
    return stem.replace("-", " ").replace("_", " ").title()


# ----------------------------------------------------- include-markdown resolution


_INCLUDE_PATTERN = re.compile(
    r"\{%\s*include-markdown\s+\"([^\"]+)\"(?:[^%]*)%\}",
    re.MULTILINE,
)


def resolve_includes(body: str, base_file: Path, depth: int = 0) -> str:
    """Expand `{% include-markdown "path" %}` directives recursively.

    The plugin's full option surface (``start``, ``end``,
    ``heading-offset``, ``preserve-includer-indent``, ``comments``,
    ``dedent``) is not honoured — we only need the bare include
    semantics for the two pages that use it today (``changelog.md``
    pulls ``CHANGELOG.md``, ``roadmap.md`` pulls ``ROADMAP.md``).
    If a future page uses an unsupported option, the directive is
    expanded as a plain include and the surrounding option string
    is dropped (a no-op for ``comments=false``, harmless for
    ``heading-offset=1``).

    Recursion is bounded at 1 level — the only legitimate include
    pattern in this project is one wrapper page (``changelog.md`` or
    ``roadmap.md``) that pulls one root-level Markdown file
    (``CHANGELOG.md`` or ``ROADMAP.md``). Any depth > 1 indicates a
    DOCUMENTATION TRAP: the included Markdown body contains literal
    ``{% include-markdown ... %}`` text (e.g. inside a code-fenced
    example or a quoted explanation), and `_INCLUDE_PATTERN` is not
    fenced-code-aware so it would match and recursively re-expand
    the file. The wave-8 G7 follow-up #3 status block tripped this
    when it described the include mechanism in prose; lowering the
    guard from 4 to 1 turns the trap into a fast failure (the
    duplicate include text survives in the body but is not
    recursively expanded) rather than a 5x corpus blow-up that
    only surfaces as a `TOTAL_FAIL_TOKENS` violation downstream.
    If a future page legitimately needs a deeper include chain, the
    guard can be raised; the comment is here as the breadcrumb.
    """
    if depth > 1:
        return body  # depth guard (see docstring)

    def _substitute(match: re.Match[str]) -> str:
        rel = match.group(1)
        target = (base_file.parent / rel).resolve()
        if not target.is_file():
            return f"<!-- include-markdown: file not found: {rel} -->"
        included = target.read_text(encoding="utf-8")
        # Recurse so nested includes (none today, but cheap insurance) work.
        return resolve_includes(included, target, depth + 1)

    return _INCLUDE_PATTERN.sub(_substitute, body)


# ----------------------------------------------------- markdown chrome stripper


_FRONTMATTER_PATTERN = re.compile(
    r"\A---\s*\n.*?\n---\s*\n",
    re.DOTALL,
)
_ICON_PATTERN = re.compile(
    r":(?:material|octicons|fontawesome|simple)-[a-z0-9_-]+(?::[a-z0-9_-]+)*:",
)
_ATTR_LIST_PATTERN = re.compile(
    r"\s\{[: ][^{}\n]*\}",
)
_GRID_OPEN_PATTERN = re.compile(
    r"^<div class=\"grid cards\" markdown>\s*$",
    re.MULTILINE,
)
_GRID_CLOSE_PATTERN = re.compile(
    r"^</div>\s*$",
    re.MULTILINE,
)
_PERMALINK_PATTERN = re.compile(
    r"\s*\[¶\]\([^)]+ \"Anchor link to this section\"\)",
)
_ADMONITION_PATTERN = re.compile(
    r"^!!!\s+([a-zA-Z]+)(?:\s+\"([^\"]+)\")?\s*$",
    re.MULTILINE,
)


def is_recipe_page(relpath: str) -> bool:
    """True when `docs/<relpath>` is a per-source/per-layer recipe page.

    Recipe pages live at `docs/recipes/<source>/<layer>.md`. The
    matrix index page at `docs/recipes/index.md` is NOT a recipe
    page (it's the auto-generated matrix), so we exclude it.
    """
    if not relpath.startswith("recipes/"):
        return False
    if relpath == "recipes/index.md":
        return False
    return relpath.endswith(".md")


def strip_recipe_advisory(body: str, page_url: str) -> str:
    """Trim recipe page body at `## 5. Screenshot` and append a URL pointer.

    §5 Screenshot (currently a D5-harness-pending boilerplate stub),
    §6 Gotchas, and the trailing `## Verification status` section
    are human-targeted advisory content. An LLM consuming the recipe
    needs the frontmatter, §1 Source description, §2 SPL recipe,
    §3 Expected fields, and §4 Recommended formatter config — all of
    which precede §5. The advisory content is recoverable via the
    URL pointer appended below for any agent that's debugging a
    recipe and needs the gotchas.

    Trim history:
      * Wave 4a (initial): trimmed at `## 6. Gotchas`.
      * Wave 6 (extended): moved trim point up to `## 5. Screenshot`
        because §5 today is the same ~7-line D5-harness-pending
        stub across every recipe (~100 tokens × 18 recipes = ~1.8k
        tokens of pure duplication). When D5 ships and §5 carries
        actual per-recipe screenshot links / alt-text / metadata,
        revisit moving the trim point back to §6.

    If the recipe does not have a `## 5. Screenshot` heading (every
    current recipe has one, but the helper is defensive), the body
    is returned unchanged.
    """
    match = _RECIPE_TRIM_AT.search(body)
    if not match:
        return body
    trimmed = body[: match.start()].rstrip() + "\n"
    pointer = (
        "\n"
        "_§5 Screenshot, §6 Gotchas, and the trailing Verification "
        "status section are omitted from llms-full.txt for "
        f"token-budget; read them in the full recipe at <{page_url}>._\n"
    )
    return trimmed + pointer


def is_roadmap_page(relpath: str) -> bool:
    """True when `docs/<relpath>` is the roadmap page.

    Only the top-level `docs/roadmap.md` qualifies — this is the page
    that uses `{% include-markdown "ROADMAP.md" %}` to pull the
    project's rolling change log into the docs site.
    """
    return relpath == "roadmap.md"


def is_changelog_page(relpath: str) -> bool:
    """True when `docs/<relpath>` is the changelog page.

    Only the top-level `docs/changelog.md` qualifies — this is the page
    that uses `{% include-markdown "../CHANGELOG.md" %}` to pull the
    project's release history into the docs site.
    """
    return relpath == "changelog.md"


def strip_changelog_old_versions(
    body: str, page_url: str, keep: int = _CHANGELOG_KEEP_VERSIONS
) -> tuple[str, int]:
    """Keep the top `keep` `## [VERSION] - DATE` sections; trim older.

    Returns (cleaned body, number of trimmed versions). The trim
    replaces every section after the `keep`-th version heading with a
    single pointer line plus a bullet list of the trimmed version
    numbers (so the agent still knows WHICH versions exist without
    fetching CHANGELOG.md).

    If the file has `keep` or fewer version headings, the body is
    returned unchanged (the trim is a no-op).
    """
    matches = list(_CHANGELOG_VERSION_HEADING.finditer(body))
    if len(matches) <= keep:
        return body, 0

    trim_start = matches[keep].start()
    older = matches[keep:]
    trimmed_count = len(older)
    older_list_lines = [
        f"- `[{m.group('version')}] - {m.group('date')}`"
        for m in older
    ]
    pointer = (
        "\n"
        f"_The following {trimmed_count} older version section(s) are "
        f"omitted from llms-full.txt for token budget; read them in "
        f"the full CHANGELOG.md at <{page_url}> or in the repo at "
        "<https://github.com/fenre/better_map/blob/main/CHANGELOG.md>:_\n\n"
        + "\n".join(older_list_lines)
        + "\n"
    )
    return body[:trim_start].rstrip() + "\n" + pointer, trimmed_count


def strip_roadmap_status_blocks(body: str) -> tuple[str, int]:
    """Strip historical E5/G7 wave SHIPPED status blockquotes.

    Returns (cleaned body, number of blocks removed). Each block matches
    `> **Status (v...-prep, YYYY-MM-DD): E5 Phase 2 wave N SHIPPED ...`
    or the analogous `G7 Phase 2 follow-up #N SHIPPED` pattern and runs
    until the first line that does NOT start with `> ` (the
    blockquote ends). Adjacent blank lines collapse via the existing
    `re.sub(r"\\n{3,}", "\\n\\n", out)` pass in `strip_chrome` so the
    surrounding prose stays well-formed.

    The on-disk ROADMAP.md is unchanged — the trim runs only against
    the in-memory body before it lands in llms-full.txt. The MkDocs
    site continues to render every status block for human readers via
    the unaltered `{% include-markdown "ROADMAP.md" %}` include.
    """
    blocks_removed = 0

    def _drop(_match: re.Match[str]) -> str:
        nonlocal blocks_removed
        blocks_removed += 1
        return ""

    cleaned = _ROADMAP_STATUS_BLOCK.sub(_drop, body)
    return cleaned, blocks_removed


def strip_chrome(body: str) -> str:
    """Remove MkDocs Material chrome that carries no LLM signal.

    The transformations preserve all author-supplied prose, code, and
    semantic structure (headings, lists, code blocks, links, tables).
    Cosmetic-only Material extensions are dropped or converted to
    portable Markdown.
    """
    out = body
    out = _FRONTMATTER_PATTERN.sub("", out, count=1)
    out = _GRID_OPEN_PATTERN.sub("", out)
    # The matching </div> is harder to scope precisely — strip every
    # bare-line </div> after a grid-cards open. Material's grid is the
    # only construct in this docs tree that uses <div class="grid cards">,
    # so this is safe; we re-check below.
    out = _GRID_CLOSE_PATTERN.sub("", out)
    out = _ICON_PATTERN.sub("", out)
    out = _PERMALINK_PATTERN.sub("", out)
    out = _ATTR_LIST_PATTERN.sub("", out)
    out = _ADMONITION_PATTERN.sub(
        lambda m: f"> **{m.group(1).capitalize()}{(': ' + m.group(2)) if m.group(2) else ''}**",
        out,
    )
    # Tidy up: collapse runs of 3+ blank lines that the strippers leave behind.
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out


# ----------------------------------------------------- integrations + recipes appendices


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
        out.append({"file": f.name, "data": data})
    return out


def collect_recipes() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not RECIPES_INDEX.is_file():
        return out
    data = yaml.safe_load(RECIPES_INDEX.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return out
    for entry in data.get("recipes", []):
        if isinstance(entry, dict):
            out.append(entry)
    return out


def count_formatter_options() -> int:
    if not FORMATTER_SCHEMA.is_file():
        return 0
    schema = json.loads(FORMATTER_SCHEMA.read_text(encoding="utf-8"))
    return len(schema.get("properties", {}))


# ----------------------------------------------------- render


def render(site_url: str, site_desc: str) -> tuple[str, dict[str, int]]:
    """Return (rendered text, per-page token-budget telemetry)."""
    nav_entries = walk_nav(parse_mkdocs().get("nav") or [])
    integrations = collect_integrations()
    recipes = collect_recipes()
    formatter_count = count_formatter_options()

    buf = io.StringIO()
    per_page_chars: dict[str, int] = {}

    # ------------- Header
    one_line_desc = " ".join(line.strip() for line in site_desc.strip().splitlines()).strip()
    buf.write("# Better Map — full documentation\n\n")
    buf.write(f"> {one_line_desc}\n\n")
    buf.write(
        "This file is the body-inclusive sibling of `llms.txt` and "
        "concatenates every page on the Better Map documentation site "
        "into a single, LLM-friendly text dump. The short companion "
        f"index is at <{site_url}llms.txt>. Pages appear in `mkdocs.yml` "
        "`nav:` declaration order. Each page block carries a stable "
        "`# === ... ===` separator plus the source-of-truth path on "
        "disk and the published URL so the same content can be grepped "
        "by either dimension.\n\n"
    )
    buf.write(
        f"At the bottom this file appends two structured appendices "
        f"(the {len(integrations)} Splunk integrations matrix and the "
        f"{len(recipes)} shipped recipes) so an agent does not need a "
        "follow-up fetch into `docs/_machine/` to see the contracts. "
        f"The {formatter_count} formatter options are documented in "
        f"detail on the [Formatter reference page]({site_url}reference/formatter/) "
        "below; the canonical JSON Schema lives at "
        f"<{GITHUB_BLOB_BASE}/docs/_machine/formatter-schema.json>.\n\n"
    )
    buf.write(
        "All page URLs resolve to publicly accessible Material-themed "
        "HTML on GitHub Pages. The project ships under the MIT licence; "
        "the canonical repo is <https://github.com/fenre/better_map>.\n\n"
    )

    # ------------- Table of contents
    buf.write("## Table of contents\n\n")
    for crumbs, title, relpath in nav_entries:
        crumb_prefix = " / ".join(crumbs)
        if crumb_prefix:
            crumb_prefix += " / "
        buf.write(f"- {crumb_prefix}{title} (`docs/{relpath}`)\n")
    buf.write("\n")

    # ------------- Per-page bodies
    for crumbs, title, relpath in nav_entries:
        source_file = DOCS_DIR / relpath
        url = url_for(site_url, relpath)
        crumb_prefix = " / ".join(crumbs)
        full_title = f"{crumb_prefix} / {title}" if crumb_prefix else title

        buf.write("\n")
        buf.write(f"# === BEGIN: {url} ===\n\n")
        buf.write(f"# {full_title}\n\n")
        buf.write(f"> Source: `docs/{relpath}`  \n")
        buf.write(f"> URL: <{url}>\n\n")

        if not source_file.is_file():
            buf.write(
                f"<!-- llms-full.txt: source file missing: docs/{relpath} -->\n"
            )
            per_page_chars[relpath] = 0
            buf.write(f"\n# === END: {url} ===\n")
            continue

        raw = source_file.read_text(encoding="utf-8")
        expanded = resolve_includes(raw, source_file)
        if is_roadmap_page(relpath):
            expanded, _blocks = strip_roadmap_status_blocks(expanded)
        if is_changelog_page(relpath):
            expanded, _versions = strip_changelog_old_versions(
                expanded, url
            )
        cleaned = strip_chrome(expanded).rstrip() + "\n"
        if is_recipe_page(relpath):
            cleaned = strip_recipe_advisory(cleaned, url)
        buf.write(cleaned)
        per_page_chars[relpath] = len(cleaned)
        buf.write(f"\n# === END: {url} ===\n")

    # ------------- Integrations appendix
    buf.write("\n# === BEGIN: appendix:integrations ===\n\n")
    buf.write("# Appendix A — Splunk integrations matrix\n\n")
    buf.write(
        f"> Source of truth: `docs/_machine/integrations/*.yaml` "
        f"({len(integrations)} files, lexicographic order)\n\n"
    )
    buf.write(
        "Each entry below distils the corresponding YAML scaffold so an "
        "LLM can answer integration-readiness questions without "
        "another fetch. The YAMLs themselves remain the contract: drift "
        f"between them and the JS modules under `src/lib/splunk/` is "
        "blocked at PR time by the G7 Phase 1 gates.\n\n"
    )
    for entry in integrations:
        data = entry["data"]
        name = data.get("display_name") or data.get("id") or entry["file"]
        status = data.get("status", "unknown")
        app = data.get("splunk_app_required") or "n/a"
        meta = data.get("meta") or {}
        source = meta.get("source_of_truth_path") or "n/a"
        buf.write(f"## {name}\n\n")
        buf.write(f"- File: `docs/_machine/integrations/{entry['file']}`\n")
        buf.write(f"- Status: {status}\n")
        buf.write(f"- Splunk app required: `{app}`\n")
        version_min = data.get("splunk_version_min")
        if version_min:
            buf.write(f"- Splunk version min: {version_min}\n")
        buf.write(f"- Source path (JS): `{source}`\n")
        endpoints = data.get("endpoints_called") or []
        if endpoints:
            buf.write("- Endpoints called:\n")
            for ep in endpoints:
                if not isinstance(ep, dict):
                    continue
                method = ep.get("method", "?")
                path = ep.get("path", "?")
                auth = ep.get("auth", "?")
                buf.write(f"    - `{method} {path}` (auth: {auth})\n")
        field_contract = data.get("field_contract")
        if isinstance(field_contract, dict):
            keys = list(field_contract.keys())
            if keys:
                buf.write(
                    "- Field contract keys: "
                    + ", ".join(f"`{k}`" for k in keys)
                    + "\n"
                )
        tested = data.get("tested_against")
        if isinstance(tested, dict) and tested:
            parts: list[str] = []
            for k, v in tested.items():
                parts.append(f"{k}={v}")
            buf.write("- Tested against: " + ", ".join(parts) + "\n")
        elif isinstance(tested, str) and tested.strip():
            buf.write(f"- Tested against: {tested}\n")
        else:
            buf.write("- Tested against: (pending live-tenant verification)\n")
        bm_ct_1 = data.get("bm_ct_1") or {}
        if isinstance(bm_ct_1, dict) and bm_ct_1:
            buf.write("- BM-CT-1 contract:\n")
            for slot in ("setEnabled", "isEnabled", "reset"):
                desc = bm_ct_1.get(slot)
                if desc:
                    buf.write(f"    - `{slot}`: {desc}\n")
        references = data.get("references") or []
        if references:
            buf.write("- References:\n")
            for ref in references:
                if isinstance(ref, dict):
                    label = ref.get("description") or ref.get("title") or ""
                    target = ref.get("path") or ref.get("url") or ""
                    if label and target:
                        buf.write(f"    - {label}: `{target}`\n")
                    elif label:
                        buf.write(f"    - {label}\n")
                    elif target:
                        buf.write(f"    - `{target}`\n")
                elif isinstance(ref, str):
                    buf.write(f"    - {ref}\n")
        buf.write("\n")
    buf.write("# === END: appendix:integrations ===\n")

    # ------------- Recipes appendix
    buf.write("\n# === BEGIN: appendix:recipes ===\n\n")
    buf.write("# Appendix B — Per-source recipe matrix\n\n")
    buf.write(
        "> Source of truth: `docs/_machine/recipes/index.yaml` "
        f"({len(recipes)} recipe(s), emission order)\n\n"
    )
    buf.write(
        "Each row distils a `docs/recipes/<source>/<layer>.md` page so "
        "an agent can answer 'which recipe matches this data source?' "
        "without fetching every recipe page. Recipes carry one of three "
        "statuses: `verified` (smoke-tested against a live Splunk tenant "
        "with proof in the YAML metadata), `unverified` (the recipe "
        "follows the contract but has not yet been smoke-tested), or "
        "`deferred` (the recipe is known to be incomplete pending "
        "upstream work).\n\n"
    )
    if not recipes:
        buf.write(
            "(No recipes shipped yet — see E5 in the roadmap for the "
            "matrix design.)\n"
        )
    else:
        for entry in recipes:
            source = entry.get("source") or {}
            layer = entry.get("layer") or {}
            label = (
                f"{source.get('display_name', source.get('id', '?'))} → "
                f"{layer.get('display_name', layer.get('id', '?'))}"
            )
            buf.write(f"## {label}\n\n")
            buf.write(f"- ID: `{entry.get('id', '')}`\n")
            buf.write(f"- Status: {entry.get('status', 'unknown')}\n")
            apps = entry.get("splunk_apps_required") or []
            if apps:
                buf.write("- Splunk apps required:\n")
                for app in apps:
                    if isinstance(app, dict):
                        app_id = app.get("id", "?")
                        app_min = app.get("min_version", "")
                        buf.write(
                            f"    - `{app_id}`"
                            + (f" ≥ {app_min}" if app_min else "")
                            + "\n"
                        )
            path = entry.get("path", "")
            if path:
                rel_short = path[len("docs/") :] if path.startswith("docs/") else path
                page_url = url_for(site_url, rel_short)
                buf.write(f"- Page: [{path}]({page_url})\n")
            verified = entry.get("verified_against") or {}
            if isinstance(verified, dict) and verified:
                parts: list[str] = []
                for k, v in verified.items():
                    parts.append(f"{k}={v}")
                buf.write("- Verified against: " + ", ".join(parts) + "\n")
            expected = entry.get("expected_fields") or []
            if expected:
                buf.write("- Expected fields:\n")
                for field in expected:
                    if isinstance(field, dict):
                        name = field.get("name", "?")
                        ftype = field.get("type", "?")
                        example = field.get("example", "")
                        drives = field.get("drives_formatter_option")
                        bits = [f"`{name}` ({ftype})"]
                        if example != "":
                            bits.append(f"e.g. `{example}`")
                        if drives:
                            bits.append(f"drives `{drives}`")
                        buf.write(f"    - {' — '.join(bits)}\n")
                    elif isinstance(field, str):
                        buf.write(f"    - `{field}`\n")
            buf.write("\n")
    buf.write("# === END: appendix:recipes ===\n")

    # ------------- Footer
    buf.write("\n# === BEGIN: appendix:meta ===\n\n")
    buf.write("# Appendix C — How this file is built\n\n")
    buf.write(
        "This file is regenerated deterministically by "
        f"[`scripts/build-llms-full-txt.py`]({GITHUB_BLOB_BASE}/scripts/build-llms-full-txt.py) "
        "from the same `mkdocs.yml` `nav:` and `docs/_machine/*` "
        "structured sources that drive the short `llms.txt`. The script "
        "carries a hard token budget (per-page warn at 50k, total warn "
        "at 175k, total fail at 200k) so the output stays inside the "
        "context window of every practical LLM. Drift is blocked at PR "
        f"time by the CI gate in [`ci.yml`]({GITHUB_BLOB_BASE}/.github/workflows/ci.yml).\n\n"
    )
    buf.write(
        "To regenerate locally after editing any page:\n\n"
        "```bash\n"
        "python3 scripts/build-llms-full-txt.py\n"
        "```\n\n"
        "To verify the file is in sync before committing:\n\n"
        "```bash\n"
        "python3 scripts/build-llms-full-txt.py --check\n"
        "```\n"
    )
    buf.write("\n# === END: appendix:meta ===\n")

    return buf.getvalue(), per_page_chars


# ----------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--stdout",
        action="store_true",
        help="print the rendered llms-full.txt to stdout instead of writing",
    )
    group.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the on-disk llms-full.txt differs from the rendered output",
    )
    args = parser.parse_args()

    mkdocs = parse_mkdocs()
    site_url = mkdocs.get("site_url") or "https://fenre.github.io/better_map/"
    site_desc = mkdocs.get("site_description") or "Splunk Dashboard Studio map visualization."

    rendered, per_page_chars = render(site_url, site_desc)

    total_chars = len(rendered)
    total_tokens = total_chars // CHARS_PER_TOKEN
    # Page budget check uses the body-only char count, not the
    # delimiter/header overhead.
    per_page_violations = [
        (relpath, chars // CHARS_PER_TOKEN)
        for relpath, chars in per_page_chars.items()
        if chars // CHARS_PER_TOKEN > PER_PAGE_WARN_TOKENS
    ]

    if args.stdout:
        sys.stdout.write(rendered)
        return 0

    if args.check:
        if not LLMS_FULL_PATH.is_file():
            print(
                f"[FAIL] {LLMS_FULL_PATH.relative_to(REPO_ROOT)} does not "
                "exist; run `python3 scripts/build-llms-full-txt.py` to create it.",
                file=sys.stderr,
            )
            return 1
        actual = LLMS_FULL_PATH.read_text(encoding="utf-8")
        if actual != rendered:
            print(
                f"[FAIL] {LLMS_FULL_PATH.relative_to(REPO_ROOT)} is out of "
                "sync vs the structured sources of truth. Run "
                "`python3 scripts/build-llms-full-txt.py` and commit.",
                file=sys.stderr,
            )
            return 1
        if total_tokens > TOTAL_FAIL_TOKENS:
            print(
                f"[FAIL] {LLMS_FULL_PATH.relative_to(REPO_ROOT)} is "
                f"~{total_tokens:,} estimated tokens, over the "
                f"{TOTAL_FAIL_TOKENS:,} hard cap. Trim pages or raise "
                "the budget in build-llms-full-txt.py with roadmap review.",
                file=sys.stderr,
            )
            return 1
        if total_tokens > TOTAL_WARN_TOKENS:
            print(
                f"[WARN] {LLMS_FULL_PATH.relative_to(REPO_ROOT)} is "
                f"~{total_tokens:,} estimated tokens, over the "
                f"{TOTAL_WARN_TOKENS:,} soft warn (hard cap "
                f"{TOTAL_FAIL_TOKENS:,}). Consider trimming.",
                file=sys.stderr,
            )
        for relpath, tokens in per_page_violations:
            print(
                f"[WARN] page docs/{relpath} contributes ~{tokens:,} "
                f"estimated tokens, over the per-page {PER_PAGE_WARN_TOKENS:,} "
                "soft warn.",
                file=sys.stderr,
            )
        print(
            f"[PASS] {LLMS_FULL_PATH.relative_to(REPO_ROOT)} is in sync "
            f"({total_chars:,} chars, ~{total_tokens:,} estimated tokens, "
            f"{TOTAL_WARN_TOKENS:,} warn / {TOTAL_FAIL_TOKENS:,} fail)."
        )
        return 0

    if total_tokens > TOTAL_FAIL_TOKENS:
        print(
            f"[FAIL] Rendered output is ~{total_tokens:,} estimated "
            f"tokens, over the {TOTAL_FAIL_TOKENS:,} hard cap. Refusing "
            "to write — trim pages or raise the budget with roadmap review.",
            file=sys.stderr,
        )
        return 1
    LLMS_FULL_PATH.parent.mkdir(parents=True, exist_ok=True)
    LLMS_FULL_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    line_count = rendered.count("\n")
    msg = (
        f"[OK] wrote {LLMS_FULL_PATH.relative_to(REPO_ROOT)} "
        f"({total_chars:,} chars, {line_count:,} lines, "
        f"~{total_tokens:,} estimated tokens)."
    )
    print(msg)
    if total_tokens > TOTAL_WARN_TOKENS:
        print(
            f"[WARN] over the {TOTAL_WARN_TOKENS:,} soft warn "
            f"(hard cap {TOTAL_FAIL_TOKENS:,}).",
            file=sys.stderr,
        )
    for relpath, tokens in per_page_violations:
        print(
            f"[WARN] page docs/{relpath} contributes ~{tokens:,} "
            f"estimated tokens, over the per-page {PER_PAGE_WARN_TOKENS:,} "
            "soft warn.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
