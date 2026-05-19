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
``strip_roadmap_status_blocks`` below — in wave 10 by trimming
older ``## [VERSION] - DATE`` sections from ``changelog.md`` after
the top ``_CHANGELOG_KEEP_VERSIONS`` are kept — see
``strip_changelog_old_versions`` below — in wave 12 by compacting
``Appendix B — Per-source recipe matrix`` from per-recipe sections
(with bulleted ``Expected fields:`` lists that duplicated §3 of each
recipe body) to a single matrix table that preserves the lookup
contract without the duplication — see the inline format-contract
comment above the ``# === BEGIN: appendix:recipes ===`` write block —
and in wave 13 by generalising the ROADMAP status-block strip from
the narrow E5 + G7 shapes to ANY subsystem (D-, E-, G-, R-, REL-,
T- — see the wave 13 ROADMAP block for the audit data: 16 status
blockquotes were unstripped under the wave 8 narrow regex, ~30k
tokens of write-once historical notes whose live state is duplicated
in the headline table and per-subsystem section bodies — and in
wave 15 by trimming the auto-generated formatter-options enumeration
in ``docs/reference/formatter.md`` between the ``<!-- BEGIN AUTOGEN:
formatter-enumeration -->`` and ``<!-- END AUTOGEN: ... -->`` markers
to a URL pointer — the 82-option enumeration carries ~3.9k tokens of
table content that is already canonically expressed in
``docs/_machine/formatter-schema.json`` and rendered for humans on
the MkDocs site, see ``strip_formatter_appendix_a`` below — and in
wave 16 by trimming the auto-generated per-recipe matrix in
``docs/recipes/index.md`` between the ``<!-- BEGIN AUTOGEN: recipes-
matrix -->`` and ``<!-- END AUTOGEN: ... -->`` markers to a compact
source × layer presence pivot + OT-safety summary + URL pointer —
the 44-row matrix carries ~4.5k tokens of table content where >70%
of every row (status string, app-list, expected-field count, formatter-
option list, OT-safety flag, last-verified date) is canonically
expressed in ``docs/_machine/recipes/index.yaml`` and duplicated in
the per-recipe page bodies kept verbatim in this same file, see
``strip_recipes_index_matrix`` below — and in wave 17 by compacting
each Theme A-G work-item body in ``ROADMAP.md`` to its heading +
Problem + Accept + Status + Done bullets, dropping Design / Prereqs /
Risk and any trailing free-prose body, see
``strip_roadmap_workitem_bodies`` below — the 40 work-items under
the 7 Theme sections together carry ~14.1k rendered tokens (49% of
the roadmap page), of which the Problem + Accept bullets are the WHAT
and DONE-criterion an LLM authoring code in this repo needs while
Design / Prereqs / Risk are HISTORICAL design-decision context
recoverable from the live theme URL pointer the trim appends to
every trimmed item — and in wave 29 by stripping four backward-looking
H3 subsections from ``ROADMAP.md`` (``1c. Specific honest gaps in
v1.6``, ``What we DID verify in v1.6``, ``What v1.6 did NOT verify``,
``9a. ROADMAP.md change log`` — wave 29) plus three further sections
added at wave 30 (``### 1b. Competitive tier table`` plus the H2 pair
``## 6. Open questions for the project owner`` and ``## 7. Defensible
v2.0 claim — checklist`` with children §7a-7e), see
``strip_roadmap_historical_subsections`` below — together ~8.6k tokens
of v1.6 self-audit / single-release verification table / doc-edit
history / narrative-competitive positioning / open-question-escalation
list / destination-state v2.0 sign-off checklist whose live items are
already tracked in current Theme work-items (G1/G2/G3/G8 + R11) or
recoverable via ``git log -- ROADMAP.md`` — and in wave 32 by
consolidating the THREE per-recipe pointer footers (after §2 SPL
fence, after §4 JSON fence, after §5+ trim) into ONE trailing
pointer per recipe — by wave 31 each recipe carried 3×~220-char
footers all pointing to the same URL with the same "read in the
full recipe" boilerplate (~140 tokens / recipe × 84 recipes ≈ ~10k
tokens of pure duplication); the consolidated footer (~290 chars)
preserves the URL signposting at one location per recipe with zero
information loss; see ``strip_recipe_advisory`` for the consolidated
pointer text and ``strip_recipe_walkthroughs`` for the ``del
page_url`` ABI-compat shim):

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

# Recipe walkthrough trim contract — see strip_recipe_walkthroughs() and
# the E5 Phase 2 wave 19 ROADMAP block. Each recipe page §2 SPL recipe
# carries a ```spl ... ``` block (the contract) followed by a
# "Why this exact shape, line by line:" bulleted walkthrough (the
# pedagogy). §4 Recommended formatter config has the same pattern: a
# ```json ... ``` block (the contract) followed by a "Why this specific
# config:" bulleted walkthrough. Across 48 recipes the §2 walkthroughs
# total ~131k chars (~33k tokens) and the §4 walkthroughs total ~79k
# chars (~20k tokens) — together ~53k tokens, by far the largest single
# class of duplicated boilerplate left in llms-full.txt after waves 4a,
# 6, 12, 13, 15, 16, 17, 18. The walkthroughs are HIGH-VALUE
# explanatory content for the rendered MkDocs site (kept verbatim
# there), but for an LLM consuming llms-full.txt the SPL block plus the
# JSON block plus §1's source-description plus §3's expected-fields
# table already give the agent everything needed to (a) confirm the
# recipe is the right one for its task, (b) copy-paste the SPL and
# config into a Splunk panel, and (c) inspect the field contract. The
# per-stage rationale (why-each-pipe, why-each-option) is recoverable
# via the URL pointer this trim inserts in place of each walkthrough
# block. Wave 19 was the first wave where the WARN headroom dropped to
# ~105 tokens after a single recipe (`itsi-kpi-base/heat`) — that
# tightness forced this larger structural trim. After wave 19 every
# future recipe wave gains ~3k of effective headroom (the walkthroughs
# are no longer paid into the corpus), so the wave cadence relaxes
# from "one recipe per wave with mandatory token-trim between" back to
# "two-to-three recipes per wave."
_RECIPE_SPL_SECTION = re.compile(
    r"(?P<heading>^## 2\.\s+SPL recipe\s*$\n+)"
    r"(?P<fence>```spl\s*\n.*?```)"
    r"(?P<tail>.*?)"
    r"(?=^## 3\.)",
    re.MULTILINE | re.DOTALL,
)
_RECIPE_JSON_SECTION = re.compile(
    r"(?P<heading>^## 4\.\s+Recommended formatter config\s*$\n+)"
    r"(?P<fence>```json\s*\n.*?```)"
    r"(?P<tail>.*?)"
    r"(?=^## 5\.)",
    re.MULTILINE | re.DOTALL,
)

# Roadmap status-block trim contract — see strip_roadmap_status_blocks()
# and the E5 Phase 2 wave 8 + wave 13 ROADMAP blocks. ROADMAP.md is the
# project's rolling change log; under EVERY subsystem (D-, E-, G-, R-,
# REL-, T-) each shipped milestone appends a write-once status
# blockquote:
#
#     > **Status (vX-prep, YYYY-MM-DD): <subsystem> SHIPPED ...
#     > <continuation lines, each prefixed with `>`>
#
# By wave 8 the E5/G7 subset of these blockquotes accounted for ~20-30k
# tokens in llms-full.txt and the wave 8 trim shipped a narrow regex
# matching only the E5 Phase 2 wave + G7 Phase 2 follow-up shapes. Wave
# 13 generalises the regex to match ANY subsystem's status blockquote
# because the wave 12 audit (see the wave 12 token-trim status block,
# below) showed 16 D-/E-/G-tier status blockquotes still in flight —
# ~30k tokens of cumulative write-once historical notes whose LIVE state
# is already duplicated in (a) the headline goals table at the top of
# ROADMAP.md, (b) `docs/recipes/index.md` for E5, (c) the per-subsystem
# section bodies further down ROADMAP, and (d) the auto-generated
# machine-readable artefacts under `docs/_machine/`.
#
# Trimming them preserves the on-disk ROADMAP.md (unchanged for human
# readers) and the MkDocs site (full ROADMAP.md still renders) while
# reclaiming the budget for many future recipe waves. Match anchor is
# line-prefix-based so the regex never crosses out of the blockquote
# into adjacent prose, and the `<subsystem>` group is non-greedy +
# bounded to the line-end so it cannot eat unrelated content.
#
# Wave 13 also tightens the date format to `\d{4}-\d{2}-\d{2}` (no
# change from wave 8) and keeps the `vX-prep` version marker so a
# future SHIPPED-at-release status block (carrying the actual release
# version, e.g. `v1.7`) would NOT be stripped by accident.
_ROADMAP_STATUS_BLOCK = re.compile(
    r"^> \*\*Status \(v[\d.]+-prep, \d{4}-\d{2}-\d{2}\):"
    r"[^\n]*\n"
    r"(?:>[^\n]*\n)*",
    re.MULTILINE,
)

# Roadmap Theme work-item body trim contract — see
# strip_roadmap_workitem_bodies() and the E5 Phase 2 wave 17 ROADMAP
# block. ROADMAP.md carries the project's strategic narrative as a
# tree of ``### Theme [A-G] — <name>`` sections, each containing
# multiple ``#### <ID>. <title> — <size>`` work-items (e.g.
# ``#### A1. Move spatial analytics to a Web Worker pool — `M```).
# Each work-item body uses a structured 5-bullet format authored
# at item-creation time:
#
#   * **Problem:** <gap or need this addresses>
#   * **Design:** <how to build it>
#   * **Prereqs:** <what must land first>
#   * **Risk:** <what could go wrong>
#   * **Accept:** <success / done criterion>
#
# (Some items also carry **Status** or **Done** bullets when a
# release ships partial credit.) By wave 16 the Themes A-G section
# spans 40 work-items totalling ~14.1k tokens in the rendered
# roadmap page — 49% of the page weight and the largest single
# trim target in the corpus.
#
# An LLM authoring code in this repo TODAY needs (a) the work-item
# inventory (IDs and titles, for cross-references like "see A1") and
# (b) the WHAT and DONE-criterion (Problem + Accept) to align new
# code with the project's intent. The HOW (Design), the WHEN (Prereqs),
# and the WHAT-IF (Risk) are HISTORICAL design context useful for
# auditing past decisions but rarely needed for authoring new
# recipes / gates / integrations. Full bodies remain at the live
# URL pointer appended at the end of the Themes section.
#
# The trim is structural: it keeps the ``#### Xn. Title`` heading,
# the bullets whose label is in ``_KEEP_WORKITEM_BULLETS`` (case-
# insensitive), and a single 1-line URL pointer per work-item; it
# drops every other bullet body and any trailing free-form prose
# within the item. Net saving: ~18.5k tokens. The on-disk ROADMAP.md
# is unchanged — the trim runs only in the in-memory body before it
# lands in llms-full.txt. The MkDocs site continues to render every
# bullet for human readers via the unaltered
# ``{% include-markdown "ROADMAP.md" %}`` include.
_ROADMAP_THEME_HEADING = re.compile(
    r"^### Theme [A-Z][^\n]*$", re.MULTILINE
)
_ROADMAP_WORKITEM_HEADING = re.compile(
    r"^#### [A-Z]\d+[a-z]?\.[^\n]*$", re.MULTILINE
)

# Roadmap historical-subsection trim contract — see
# strip_roadmap_historical_subsections() and the E5 Phase 2 wave 29
# + wave 30 ROADMAP blocks. ROADMAP.md carries several H3 subsections
# AND H2 sections whose content is purely backward-looking, narrative-
# competitive, project-owner-question, or destination-state-checklist —
# none of it drives code-authoring decisions in any wave that follows.
#
# H3 subsections stripped (wave 29 + wave 30 additions):
#
#   ### 1b. Competitive tier table (wave 30 add) ...
#   ### 1c. Specific honest gaps in v1.6 (wave 29) ...
#   ### What we DID verify in v1.6 (wave 29) ...
#   ### What v1.6 did NOT verify (wave 29) ...
#   ### 9a. ROADMAP.md change log (wave 29) ...
#
# H2 sections stripped (wave 30 add):
#
#   ## 6. Open questions for the project owner ...
#   ## 7. Defensible v2.0 claim — checklist (includes children 7a-7e)
#
# By wave 30 these cumulatively cost ~8.6k tokens in llms-full.txt:
# the wave-29 four H3 trims reclaimed ~4.2k, the wave-30 additions
# (§1b ~0.3k, §6 ~0.7k, §7 ~3.4k) reclaim another ~4.4k. None of
# the content drives code-authoring decisions today:
#
# * §1b is a narrative-competitive positioning table (where v1.6 sits
#   vs kepler.gl, deck.gl, ESRI ArcGIS, Mapbox Studio). Stable;
#   irrelevant to writing the next recipe or hardening a CI gate.
# * §6 is a list of OPEN QUESTIONS waiting for the project owner to
#   answer (e.g., "should we adopt deck.gl interop?"). An agent
#   cannot resolve these; they are escalation items, not work-items.
# * §7 is the destination-state v2.0-shipping checklist — every
#   capability / quality / perf / security / distribution box that
#   must be true BEFORE we can call v2.0 "world-tier". Useful for
#   release sign-off; not actionable when authoring a recipe wave.
#
# Match anchors are non-capturing alternations across the exact
# leading tokens. H3 patterns terminate at the next H3 or H2 heading
# or the section-end `---` horizontal rule (whichever comes first).
# H2 patterns terminate at the next H2 heading or `---`. The on-disk
# ROADMAP.md is unchanged — the trim runs only in the in-memory body
# before it lands in llms-full.txt. The MkDocs site continues to
# render every subsection for human readers via the unaltered
# ``{% include-markdown "ROADMAP.md" %}`` include.
_ROADMAP_HISTORICAL_SUBSECTION = re.compile(
    r"^### (?:"
    r"1b\.\s+Competitive tier table"
    r"|1c\.\s+Specific honest gaps in v1\.6"
    r"|What we DID verify in v1\.6"
    r"|What v1\.6 did NOT verify"
    r"|9a\.\s+ROADMAP\.md change log"
    r")[^\n]*\n"
    r"(?:(?!^### |^## |^---$).*\n)*",
    re.MULTILINE,
)
# H2-level destination-state and open-questions sections (wave 30).
# Children H3 subsections (§7a-e) are captured by the boundary
# stopping only at the next H2 or `---` separator.
_ROADMAP_HISTORICAL_SECTION = re.compile(
    r"^## (?:"
    r"6\.\s+Open questions for the project owner"
    r"|7\.\s+Defensible v2\.0 claim"
    r")[^\n]*\n"
    r"(?:(?!^## |^---$).*\n)*",
    re.MULTILINE,
)
# Match a top-level bullet starting with `* **Label:**`; continuation
# lines (e.g. wrapped prose, nested sub-bullets) are gathered until
# the next top-level `* **` bullet or a blank line.
_WORKITEM_BULLET = re.compile(
    r"^\*\s+\*\*(?P<label>[^*:]+):\*\*[^\n]*"
    r"(?:\n(?!\s*\*\s+\*\*)(?!\s*$).*)*",
    re.MULTILINE,
)
_KEEP_WORKITEM_BULLETS: frozenset[str] = frozenset(
    {"problem", "accept", "status", "done"}
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

# Formatter Appendix A trim contract — see strip_formatter_appendix_a() and
# the E5 Phase 2 wave 15 ROADMAP block. docs/reference/formatter.md is the
# canonical human-readable enumeration of every dashboard / panel formatter
# option exposed by the better-map visualization. The page body has two
# parts:
#   * Narrative intro + worked examples + § "Worked example: 4-layer dashboard"
#     etc. — small, high-signal, hand-authored, MUST stay in llms-full.txt.
#   * Auto-generated tables between `<!-- BEGIN AUTOGEN: formatter-enumeration -->`
#     and `<!-- END AUTOGEN: formatter-enumeration -->`. By wave 14 the
#     enumeration covers ~82 options across ~10 logical groups, ~181 lines
#     / ~16 KB / ~3,948 tokens. The same content is canonically expressed
#     in `docs/_machine/formatter-schema.json` (which is what generates
#     the tables in the first place) and is rendered for humans on the
#     MkDocs site at https://fenre.github.io/better_map/reference/formatter/.
#     An LLM that needs the FULL option set can fetch the schema; an LLM
#     authoring a recipe needs the narrative + the worked examples + the
#     URL pointer, NOT the per-option table dump (the per-option enum is
#     also already encoded one-by-one in the per-recipe §4 Recommended
#     formatter config blocks, which are NOT trimmed).
# The trim replaces the entire AUTOGEN-bounded region with a one-paragraph
# pointer block. Net saving: ~3.8k tokens.
#
# The on-disk docs/reference/formatter.md is unchanged — the trim runs
# only against the in-memory body before it lands in llms-full.txt. The
# MkDocs site continues to render the full enumeration for human readers.
_FORMATTER_AUTOGEN_BLOCK = re.compile(
    r"<!--\s*BEGIN AUTOGEN:\s*formatter-enumeration\s*-->"
    r".*?"
    r"<!--\s*END AUTOGEN:\s*formatter-enumeration\s*-->",
    re.DOTALL,
)

# Recipes-index matrix trim contract — see strip_recipes_index_matrix()
# and the E5 Phase 2 wave 16 ROADMAP block. ``docs/recipes/index.md``
# is the human landing page for the recipes section; the page body
# has two parts:
#   * A narrative intro + "Status (vX-prep, YYYY-MM-DD): E5 Phase N
#     SHIPPED" blockquote (small, high-signal, hand-authored, MUST
#     stay in llms-full.txt) and a trailing "The recipe contract"
#     section that documents the six-section + frontmatter contract
#     every recipe MUST satisfy (also high-signal, also MUST stay).
#   * An auto-generated 44-row matrix table between
#     ``<!-- BEGIN AUTOGEN: recipes-matrix -->`` and
#     ``<!-- END AUTOGEN: recipes-matrix -->``. By wave 15 the matrix
#     carries one row per shipped recipe with 9 columns (status,
#     source pattern, layer, apps required, expected-field count,
#     formatter-option list, OT-safety, last verified) ≈ ~4.5k tokens.
#     >70% of every row is canonically expressed in
#     ``docs/_machine/recipes/index.yaml`` (the source of truth that
#     drives the table in the first place); the per-recipe field
#     contract is duplicated in §3 of each recipe page (kept verbatim
#     in this same file under the matching `# === BEGIN:
#     .../recipes/<source>/<layer>/ ===` block); the per-recipe
#     formatter option list is duplicated in §4 of each recipe page;
#     and the matrix headline ("44 recipes · 8 source patterns ·
#     9 layer types") is replayed in Appendix B of this same file
#     ~10 lines below the matrix. An LLM authoring a recipe needs
#     the narrative + the six-section contract + a compact
#     "which (source, layer) cells already ship?" lookup, NOT the
#     per-recipe row dump.
# The trim replaces the entire AUTOGEN-bounded region with (a) the
# headline totals line, (b) a compact source × layer presence pivot
# (rows = source dir, cols = layer id, cell = Y if a recipe ships,
# · otherwise), (c) an OT-safety-relevant recipe list, (d) the URL
# pointer to the unabridged matrix on GitHub Pages. The pivot is
# regenerated from ``docs/_machine/recipes/index.yaml`` at build
# time so it stays in lockstep with the live recipe set.
# Net saving: ~4k tokens.
#
# The on-disk docs/recipes/index.md is unchanged — the trim runs
# only against the in-memory body before it lands in llms-full.txt.
# The MkDocs site continues to render the full 44-row matrix for
# human readers (via the unaltered AUTOGEN-bounded region).
_RECIPES_INDEX_AUTOGEN_BLOCK = re.compile(
    r"<!--\s*BEGIN AUTOGEN:\s*recipes-matrix\s*-->"
    r".*?"
    r"<!--\s*END AUTOGEN:\s*recipes-matrix\s*-->",
    re.DOTALL,
)


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
    """Trim recipe page body at `## 5. Screenshot` and append one pointer.

    §5 Screenshot (currently a D5-harness-pending boilerplate stub),
    §6 Gotchas, and the trailing `## Verification status` section
    are human-targeted advisory content. An LLM consuming the recipe
    needs the frontmatter, §1 Source description, §2 SPL recipe,
    §3 Expected fields, and §4 Recommended formatter config — all of
    which precede §5. The advisory content is recoverable via the
    consolidated URL pointer appended below.

    The pointer also covers the per-stage SPL walkthrough (§2) and
    per-option config walkthrough (§4) that ``strip_recipe_walkthroughs``
    drops in the same render pass — that helper used to insert its
    own inline footers after the §2 and §4 fences, but wave 32
    consolidated all three pointers into this single trailing line
    (reclaiming ~7-9k tokens of duplicative "read it in the full recipe
    at <URL>" boilerplate × 84 recipes; see the wave-32 ROADMAP block).

    Trim history:
      * Wave 4a (initial): trimmed at `## 6. Gotchas`.
      * Wave 6 (extended): moved trim point up to `## 5. Screenshot`
        because §5 today is the same ~7-line D5-harness-pending
        stub across every recipe (~100 tokens × 18 recipes = ~1.8k
        tokens of pure duplication). When D5 ships and §5 carries
        actual per-recipe screenshot links / alt-text / metadata,
        revisit moving the trim point back to §6.
      * Wave 32 (consolidation): merged the standalone §2/§4
        walkthrough pointer footers (formerly emitted by
        ``strip_recipe_walkthroughs``) into this single trailing
        pointer so each recipe carries one breadcrumb instead of
        three. Zero information loss — every previous footer pointed
        to the same URL with the same boilerplate.

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
        "_Per-stage SPL rationale (§2 walkthrough), per-option config "
        "rationale (§4 walkthrough), §5 Screenshot, §6 Gotchas, and "
        "the trailing Verification status section are omitted from "
        f"llms-full.txt for token-budget; read them in the full "
        f"recipe at <{page_url}>._\n"
    )
    return trimmed + pointer


def strip_recipe_walkthroughs(body: str, page_url: str) -> tuple[str, int]:
    """Drop §2 SPL and §4 formatter-config walkthroughs; keep fences.

    Returns (cleaned body, number of walkthrough sections trimmed).

    For each `## 2. SPL recipe` section the helper keeps the heading and
    the immediately-following ```spl ... ``` fence (the contract), then
    drops every line of prose between the closing fence and the next
    `## 3.` heading. The same trim applies to each `## 4. Recommended
    formatter config` section (keeping the ```json ... ``` fence,
    dropping the prose until `## 5.`).

    Recipes whose §2 / §4 do not match the expected ` ```spl ` /
    ` ```json ` fence prefix are passed through unchanged for that
    section (defensive — every current recipe matches, but a future
    recipe authored with a different fence label, e.g. ` ```text ` for
    a metric-store walkthrough, would silently retain its walkthrough
    rather than corrupt the output).

    Wave 32: the per-section pointer footers ("Per-stage rationale ...
    read it in the full recipe at <URL>") that used to land right after
    each fence are no longer emitted. The consolidated pointer at the
    end of each recipe (see ``strip_recipe_advisory``) covers them.
    Saves ~3 footers per recipe × ~500 chars × 84 recipes ≈ ~7-9k
    tokens with zero information loss. The ``page_url`` argument is
    retained for ABI compatibility and for any future trim that needs
    a per-section breadcrumb again.

    The walkthroughs remain verbatim in the rendered MkDocs site and in
    the per-page source under `docs/recipes/<source>/<layer>.md`; this
    trim only affects llms-full.txt. See the wave-19 + wave-32 ROADMAP
    status blocks for the budget arithmetic and the rationale.
    """
    del page_url  # wave 32: pointer moved to strip_recipe_advisory()
    trimmed = 0

    def _replace_spl(m: re.Match[str]) -> str:
        nonlocal trimmed
        trimmed += 1
        return m.group("heading") + m.group("fence") + "\n\n"

    def _replace_json(m: re.Match[str]) -> str:
        nonlocal trimmed
        trimmed += 1
        return m.group("heading") + m.group("fence") + "\n\n"

    body = _RECIPE_SPL_SECTION.sub(_replace_spl, body)
    body = _RECIPE_JSON_SECTION.sub(_replace_json, body)
    return body, trimmed


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


def is_formatter_page(relpath: str) -> bool:
    """True when `docs/<relpath>` is the formatter-reference page.

    Only the top-level `docs/reference/formatter.md` qualifies. The
    page mixes hand-authored narrative + worked examples with an
    auto-generated enumeration of every formatter option; the trim
    targets only the auto-generated region (see
    ``strip_formatter_appendix_a`` for the contract).
    """
    return relpath == "reference/formatter.md"


def is_recipes_index_page(relpath: str) -> bool:
    """True when `docs/<relpath>` is the recipes-section matrix index page.

    Only the top-level ``docs/recipes/index.md`` qualifies. Per-recipe
    pages under ``docs/recipes/<source>/<layer>.md`` are handled by
    ``is_recipe_page`` + ``strip_recipe_advisory`` and are NOT trimmed
    by this helper.
    """
    return relpath == "recipes/index.md"


def strip_recipes_index_matrix(
    body: str, page_url: str, recipes: list[dict[str, Any]]
) -> tuple[str, bool]:
    """Replace the AUTOGEN recipes-matrix block with a compact pivot.

    Returns ``(cleaned body, trimmed)`` where ``trimmed`` is ``True``
    when the AUTOGEN region was found and replaced, ``False`` when the
    page did not contain the markers (a no-op — defensive against
    future edits that move or rename the markers).

    The pivot is built from the in-memory ``recipes`` list (the same
    list ``collect_recipes`` returned at render time, derived from
    ``docs/_machine/recipes/index.yaml`` which is the source of truth
    that also drives the on-disk matrix). This keeps the trimmed
    payload in lockstep with the live recipe set without a second
    YAML read.

    The replacement carries:

      * Headline totals (recipe count, source-dir count, layer-id
        count) — the same information the live matrix opens with.
      * A compact ``source: layers`` presence list — one bullet per
        source dir that ships at least one recipe, with a comma-
        separated list of the layer ids that ship for that source.
        Adds an at-a-glance "which (source, layer) cells already
        ship?" lookup an LLM authoring a new recipe needs, with no
        empty-cell padding overhead.
      * An OT-safety-relevant recipe list — the canonical inventory
        of recipes flagged ``ot_safety_relevant: true`` in their
        frontmatter, the only piece of per-recipe metadata that does
        NOT survive in the per-recipe body trim (the rest — status,
        apps required, expected-field contract, formatter options —
        is in §3 + §4 of each recipe page, kept verbatim in this
        same file).
      * The URL pointer to the unabridged matrix on GitHub Pages and
        to the source-of-truth YAML on GitHub, in the HTML comment
        header so it does not consume rendered-prose budget.

    If the recipes list is empty (a fresh repo before any recipe
    ships), the trim still runs — the pivot table degenerates to a
    one-line "no recipes shipped yet" pointer.
    """
    # Index recipes by (source_dir, layer_id). The source_dir is
    # derived from the on-disk path (`docs/recipes/<source>/<layer>.md`)
    # rather than the YAML `source.id` because some recipes share a
    # source.id but live in different source directories (e.g. all
    # `splunk-cim` recipes share `source.id = splunk-cim` but live
    # under different `cim-*` directories like cim-alerts, cim-
    # authentication, cim-network-traffic, cim-performance). The
    # pivot wants directory-level grouping so the agent can answer
    # "which layers ship for cim-alerts?" not "which layers ship
    # for splunk-cim?".
    presence: dict[str, list[str]] = {}
    ot_safety_ids: list[str] = []
    for entry in recipes:
        path = entry.get("path") or ""
        if not path.startswith("docs/recipes/"):
            continue
        rel = path[len("docs/recipes/") :]
        if "/" not in rel:
            continue
        source_dir, layer_file = rel.split("/", 1)
        if not layer_file.endswith(".md"):
            continue
        layer_id = layer_file[: -len(".md")]
        presence.setdefault(source_dir, []).append(layer_id)
        if entry.get("ot_safety_relevant") is True:
            ot_safety_ids.append(f"{source_dir}/{layer_id}")

    sources = sorted(presence.keys())
    all_layers = sorted({l for layers in presence.values() for l in layers})

    lines: list[str] = []
    lines.append(
        "<!-- recipes-matrix trimmed for llms-full.txt token budget "
        f"(see Wave 16 ROADMAP block); full matrix at <{page_url}> "
        "and source-of-truth YAML at "
        "<https://github.com/fenre/better_map/blob/main/docs/_machine/recipes/index.yaml>; "
        "per-recipe details (status, apps, expected-field contract, "
        "formatter options) are kept verbatim under the matching "
        "`# === BEGIN: .../recipes/<source>/<layer>/ ===` block in "
        "this same file -->\n"
    )
    lines.append(
        f"**Total: {len(recipes)} recipes · {len(sources)} source "
        f"dir(s) · {len(all_layers)} layer type(s).**\n\n"
    )
    if not recipes:
        lines.append(
            "_(No recipes shipped yet — see E5 in the roadmap for the "
            "matrix design.)_\n\n"
        )
    else:
        lines.append(
            "Source dirs and the layer ids that already ship for each "
            "(any `(source, layer)` not listed below is an open cell "
            "in the E5 matrix and is a candidate for the next recipe "
            "wave):\n\n"
        )
        for src in sources:
            layer_list = ", ".join(sorted(presence[src]))
            lines.append(f"- `{src}`: {layer_list}\n")
        lines.append("\n")

    if ot_safety_ids:
        ot_csv = ", ".join(f"`{rid}`" for rid in sorted(ot_safety_ids))
        lines.append(
            f"**OT-safety-relevant recipes ({len(ot_safety_ids)}):** "
            f"{ot_csv}.\n"
        )

    pointer = "".join(lines)
    cleaned, count = _RECIPES_INDEX_AUTOGEN_BLOCK.subn(pointer, body)
    return cleaned, count > 0


def strip_formatter_appendix_a(body: str, page_url: str) -> tuple[str, bool]:
    """Replace the AUTOGEN formatter-enumeration block with a URL pointer.

    Returns ``(cleaned body, trimmed)`` where ``trimmed`` is ``True`` when
    the AUTOGEN region was found and replaced, ``False`` when the page
    did not contain the markers (a no-op — defensive against future
    edits that move or rename the markers).

    The enumeration between ``<!-- BEGIN AUTOGEN: formatter-enumeration -->``
    and ``<!-- END AUTOGEN: ... -->`` carries ~82 options × ~5 cells per
    option ≈ ~3.9k tokens in wave 14. The same content is canonically
    expressed in ``docs/_machine/formatter-schema.json`` and rendered for
    humans on the MkDocs site, so an LLM that needs the full enumeration
    can fetch either; an LLM authoring a recipe needs the narrative +
    the URL pointer + the per-recipe §4 formatter-config blocks (which
    are NOT trimmed).
    """
    pointer = (
        "<!-- formatter-enumeration trimmed for llms-full.txt token "
        "budget; see Wave 15 ROADMAP block -->\n\n"
        "_The full per-option enumeration (82 options across the tile "
        "provider, layer ordering, basemap, heatmap, H3 cell-fill, "
        "supercluster, 3D extrusion, marker, path, and polygon groups) "
        "is canonically expressed in "
        "[`docs/_machine/formatter-schema.json`]"
        "(https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json) "
        f"and rendered for humans at <{page_url}>. Per-recipe §4 "
        "formatter-config blocks (see Appendix B — recipes index) carry "
        "the option subset actually used by each recipe; the per-recipe "
        "blocks are NOT trimmed and remain the authoritative reference "
        "for any LLM authoring a recipe._\n"
    )
    cleaned, count = _FORMATTER_AUTOGEN_BLOCK.subn(pointer, body)
    return cleaned, count > 0


def strip_roadmap_status_blocks(body: str) -> tuple[str, int]:
    """Strip historical write-once SHIPPED status blockquotes from ROADMAP.

    Returns (cleaned body, number of blocks removed). Each block matches
    `> **Status (v...-prep, YYYY-MM-DD): <any subsystem> ...` and runs
    until the first line that does NOT start with `> ` (the
    blockquote ends). The wave 8 narrow regex matched only E5 Phase 2
    waves + G7 Phase 2 follow-ups; the wave 13 generalisation matches
    ANY subsystem (D-, E-, G-, R-, REL-, T- — see the wave 13 ROADMAP
    block for the audit data that drove the change). The `vX-prep`
    version marker is preserved on the match anchor so a future
    SHIPPED-at-release status block (carrying the actual release
    version, e.g. `v1.7`) would NOT be stripped by accident — a
    deliberate guard that lets us mint permanent release markers in
    ROADMAP without losing them from llms-full.txt.

    Adjacent blank lines collapse via the existing `re.sub(r"\\n{3,}",
    "\\n\\n", out)` pass in `strip_chrome` so the surrounding prose
    stays well-formed.

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


def strip_roadmap_historical_subsections(body: str) -> tuple[str, int]:
    """Strip backward-looking / destination-state ROADMAP sections.

    See the module-level ``_ROADMAP_HISTORICAL_SUBSECTION`` (H3) and
    ``_ROADMAP_HISTORICAL_SECTION`` (H2) contracts for the full
    rationale. Returns ``(cleaned_body, sections_removed)`` summing
    across both passes.

    H3 subsections (wave 29 + wave 30 expansion):

    * ``### 1b. Competitive tier table`` — narrative-competitive
      positioning of v1.6 vs kepler.gl, deck.gl, ESRI ArcGIS,
      Mapbox Studio; stable and irrelevant to recipe authoring or
      CI-gate hardening (wave 30 add).
    * ``### 1c. Specific honest gaps in v1.6`` — historical gap list
      whose live entries are already tracked in current Theme
      work-items (G1/G2/G3/G8 + R11 in the risk register).
    * ``### What we DID verify in v1.6`` — single-release install
      verification table, superseded by per-release G2 CI gates.
    * ``### What v1.6 did NOT verify`` — four bullets describing
      v1.6 REST-only verification limits, no longer current.
    * ``### 9a. ROADMAP.md change log`` — doc-edit history,
      recoverable via ``git log -- ROADMAP.md`` when needed.

    H2 sections (wave 30 add):

    * ``## 6. Open questions for the project owner`` — escalation
      items waiting for human owner resolution; an agent cannot
      action them.
    * ``## 7. Defensible v2.0 claim — checklist`` (including
      children §7a-7e) — destination-state release-sign-off
      criteria; useful at v2.0 cut, not when authoring a recipe.

    The trim is idempotent: re-running it on an already-trimmed
    body is a no-op (the targeted sections are simply gone). The
    on-disk ROADMAP.md is unchanged — the trim runs only against
    the in-memory body before it lands in llms-full.txt. The MkDocs
    site continues to render every subsection for human readers.
    """
    removed = 0

    def _drop(_match: re.Match[str]) -> str:
        nonlocal removed
        removed += 1
        return ""

    cleaned = _ROADMAP_HISTORICAL_SUBSECTION.sub(_drop, body)
    cleaned = _ROADMAP_HISTORICAL_SECTION.sub(_drop, cleaned)
    return cleaned, removed


def strip_roadmap_workitem_bodies(
    body: str, page_url: str
) -> tuple[str, int]:
    """Compact each Theme work-item to heading + Problem + Accept + pointer.

    See the module-level ``_ROADMAP_THEME_HEADING`` /
    ``_ROADMAP_WORKITEM_HEADING`` / ``_WORKITEM_BULLET`` /
    ``_KEEP_WORKITEM_BULLETS`` definitions for the full rationale.
    Returns ``(cleaned_body, items_trimmed)``.

    Algorithm:

    1. Find each ``### Theme [A-Z] …`` section start in document
       order. Anything outside the union of these sections is left
       verbatim (so the v1.6 self-audit, the milestone tables, the
       risk register, and the document-maintenance section all keep
       their full bodies).
    2. Within each theme section, find each ``#### Xn. Title``
       work-item. Replace the work-item body with:
         * the heading line (verbatim),
         * each bullet whose label is in
           ``_KEEP_WORKITEM_BULLETS`` (case-insensitive — typically
           Problem, Accept, Status, Done), and
         * a single one-line URL pointer to the live theme section.
       Bullets matching Design / Prereqs / Risk / Considered /
       Followups / etc. are dropped along with any trailing free
       prose inside the item.
    3. If a work-item has none of the keep-listed bullets (very
       rare — the v1.7-prep convention requires Problem + Accept
       on every new item), the item body is left untouched so the
       trim NEVER produces a content-free item.

    The trim is idempotent: re-running it on an already-trimmed
    body is a no-op (the dropped bullets are already gone; the
    remaining bullets all match the keep-list).
    """
    theme_matches = list(_ROADMAP_THEME_HEADING.finditer(body))
    if not theme_matches:
        return body, 0

    theme_bounds: list[tuple[int, int]] = []
    for i, m in enumerate(theme_matches):
        end = theme_matches[i + 1].start() if i + 1 < len(theme_matches) else None
        if end is None:
            # The Themes section ends at the next ## heading or EOF.
            tail = body[m.end():]
            next_h2 = re.search(r"^## ", tail, re.MULTILINE)
            end = m.end() + next_h2.start() if next_h2 else len(body)
        theme_bounds.append((m.start(), end))

    items_trimmed = 0
    rebuilt: list[str] = []
    cursor = 0
    for theme_start, theme_end in theme_bounds:
        rebuilt.append(body[cursor:theme_start])
        theme_body = body[theme_start:theme_end]
        item_matches = list(_ROADMAP_WORKITEM_HEADING.finditer(theme_body))
        if not item_matches:
            rebuilt.append(theme_body)
            cursor = theme_end
            continue
        rebuilt.append(theme_body[:item_matches[0].start()])
        for j, im in enumerate(item_matches):
            heading = im.group()
            item_start = im.end()
            item_end = (
                item_matches[j + 1].start()
                if j + 1 < len(item_matches)
                else len(theme_body)
            )
            item_body = theme_body[item_start:item_end]
            kept: list[str] = []
            for bm in _WORKITEM_BULLET.finditer(item_body):
                label = bm.group("label").strip().lower()
                if label in _KEEP_WORKITEM_BULLETS:
                    kept.append(bm.group().rstrip())
            if not kept:
                rebuilt.append(heading + item_body)
                continue
            rebuilt.append(heading + "\n\n")
            rebuilt.append("\n".join(kept) + "\n\n")
            rebuilt.append(
                "_Design / Prereqs / Risk / other bullets omitted from "
                f"llms-full.txt for token-budget; read the full work-item "
                f"in the matching Theme section at <{page_url}>._\n\n"
            )
            items_trimmed += 1
        cursor = theme_end
    rebuilt.append(body[cursor:])
    return "".join(rebuilt), items_trimmed


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

    # ------------- Table of contents — TRIMMED in wave 31 token-trim
    #
    # The per-page TOC block used to enumerate every nav entry as
    # ``- <crumbs> / <title> (`docs/<relpath>`)`` lines (~2.5k tokens
    # by wave 30, ~100+ pages × ~25 tokens each). Removed because every
    # page below already opens with a ``# === BEGIN: <URL> ===`` block
    # followed by a ``> Source: docs/<relpath>`` line — the same path
    # AND the published URL, sortable / greppable by either dimension
    # (the file intro paragraph above documents this exact contract).
    # The TOC duplicated that information without adding anything an LLM
    # consumer could not reconstruct from the per-page separators.
    # Net saving: ~2.5k tokens (zero information loss). Human readers
    # of llms-full.txt who want a flat page index can run::
    #
    #     grep '^# === BEGIN: ' docs/llms-full.txt
    #
    # in any shell to reproduce the old TOC content on demand.

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
            expanded, _hist = strip_roadmap_historical_subsections(expanded)
            expanded, _items = strip_roadmap_workitem_bodies(expanded, url)
        if is_changelog_page(relpath):
            expanded, _versions = strip_changelog_old_versions(
                expanded, url
            )
        if is_formatter_page(relpath):
            expanded, _trimmed = strip_formatter_appendix_a(expanded, url)
        if is_recipes_index_page(relpath):
            expanded, _trimmed = strip_recipes_index_matrix(
                expanded, url, recipes
            )
        cleaned = strip_chrome(expanded).rstrip() + "\n"
        if is_recipe_page(relpath):
            cleaned, _walks = strip_recipe_walkthroughs(cleaned, url)
            cleaned = strip_recipe_advisory(cleaned, url)
        buf.write(cleaned)
        per_page_chars[relpath] = len(cleaned)
        buf.write(f"\n# === END: {url} ===\n")

    # ------------- Integrations appendix — COMPACTED in wave 31 token-trim
    #
    # Format history (Appendix A is the per-integration deep-dive):
    #
    #   * Pre-wave-31 — per-integration H2 with bulleted dump of every
    #     YAML field (file path, status, app required, version min,
    #     JS source path, endpoints called with method+path+auth, field
    #     contract keys, tested-against, BM-CT-1 contract methods with
    #     prose descriptions, references) — ~2,317 tokens by wave 30.
    #   * Wave 31 onwards — single matrix table carrying ONLY the
    #     per-integration data that is NOT already in the catalogue
    #     page's matrix above. The catalogue matrix (rendered in this
    #     same file under the ``integrations/catalogue/`` block) already
    #     covers: name + status + app required + version min + endpoint
    #     count + auth + OT-safety + live-tenant tested + source YAML
    #     pointer. The truly unique Appendix A additions were:
    #       (a) BM-CT-1 contract methods (which of setEnabled / isEnabled
    #           / reset exist + a one-line description each)
    #       (b) Field contract keys (what input/output keys the JS
    #           module reads/writes)
    #       (c) JS source-of-truth path
    #     Everything else (per-endpoint detail, tested-against, references)
    #     is already either in the catalogue matrix above or in the
    #     YAML files themselves (linked from the matrix's "Source YAML"
    #     column). The compacted table form preserves the unique value
    #     at ~1/5 the token cost. Net saving: ~1.7-1.9k tokens.
    buf.write("\n# === BEGIN: appendix:integrations ===\n\n")
    buf.write("# Appendix A — Splunk integrations matrix\n\n")
    buf.write(
        f"> Source of truth: `docs/_machine/integrations/*.yaml` "
        f"({len(integrations)} files, lexicographic order)\n\n"
    )
    buf.write(
        "The full per-integration matrix (status, app required, Splunk "
        "version min, endpoint count, auth scheme, OT-safety, live-tenant "
        "tested flag, source-YAML pointer) is rendered above in this "
        f"same file under the `integrations/catalogue/` page block "
        f"(<{site_url}integrations/catalogue/>). This appendix carries "
        "only the per-integration data NOT already on that matrix — "
        "BM-CT-1 contract methods, field contract keys, and JS "
        "source-of-truth pointers — so an agent answering "
        "integration-readiness questions can resolve everything from "
        "one fetch. The YAMLs themselves remain the contract; drift "
        "between them and the JS modules under `src/lib/splunk/` is "
        "blocked at PR time by the G7 Phase 1 gates. For per-endpoint "
        "detail (method + path + auth scheme + description) consult "
        "the endpoint-detail tables on the catalogue page above or "
        "the linked YAML.\n\n"
    )
    buf.write(
        "| Integration | BM-CT-1 methods | Field contract keys "
        "| JS source-of-truth | YAML |\n"
    )
    buf.write(
        "|---|---|---|---|---|\n"
    )
    for entry in integrations:
        data = entry["data"]
        name = data.get("display_name") or data.get("id") or entry["file"]
        meta = data.get("meta") or {}
        source = meta.get("source_of_truth_path") or "n/a"

        bm_ct_1 = data.get("bm_ct_1") or {}
        if isinstance(bm_ct_1, dict) and bm_ct_1:
            present = [
                slot for slot in ("setEnabled", "isEnabled", "reset")
                if bm_ct_1.get(slot)
            ]
            bm_cell = ", ".join(f"`{slot}`" for slot in present) if present else "—"
        else:
            bm_cell = "—"

        field_contract = data.get("field_contract")
        if isinstance(field_contract, dict) and field_contract:
            keys_cell = ", ".join(f"`{k}`" for k in field_contract.keys())
        else:
            keys_cell = "—"

        js_cell = f"`{source}`" if source != "n/a" else "—"
        yaml_cell = (
            f"[`{entry['file']}`]"
            f"({GITHUB_BLOB_BASE}/docs/_machine/integrations/{entry['file']})"
        )

        buf.write(
            f"| {name} | {bm_cell} | {keys_cell} | {js_cell} | {yaml_cell} |\n"
        )
    buf.write("\n")
    buf.write("# === END: appendix:integrations ===\n")

    # ------------- Recipes appendix
    #
    # Format contract (recalibrated in E5 Phase 2 wave 12 — see the
    # corresponding ROADMAP status block): the appendix renders as a
    # single matrix table rather than per-recipe sections with bulleted
    # `Expected fields:` lists. The pre-wave-12 per-section format
    # carried ~150 tokens per recipe (~5.3k tokens across 36 recipes,
    # the second-largest content block after roadmap.md), and >70% of
    # that was the `expected_fields` list — which is fully duplicated
    # in §3 of each recipe page body, retained in llms-full.txt under
    # the wave-4a `## 5. Screenshot` trim point. The matrix preserves
    # the agent-actionable lookup contract (which recipe matches which
    # source+layer? where is the unabridged page? what apps are
    # required? what's the verification status?) while shedding the
    # ~4k tokens of duplication. Agents that need the field contract
    # follow the per-row Page link, which lands on the body block that
    # already contains §3 in this same file.
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
        "upstream work). The expected-field contract for each recipe "
        "lives in §3 of the recipe page (kept verbatim in this file "
        "under the matching `# === BEGIN: …/recipes/<source>/<layer>/ "
        "===` block); follow the Page link below to jump to it.\n\n"
    )
    if not recipes:
        buf.write(
            "(No recipes shipped yet — see E5 in the roadmap for the "
            "matrix design.)\n"
        )
    else:
        buf.write("| Recipe ID | Source → Layer | Status | Apps required | Verified against | Page |\n")
        buf.write("| :-- | :-- | :-- | :-- | :-- | :-- |\n")
        for entry in recipes:
            source = entry.get("source") or {}
            layer = entry.get("layer") or {}
            label = (
                f"{source.get('display_name', source.get('id', '?'))} → "
                f"{layer.get('display_name', layer.get('id', '?'))}"
            )
            recipe_id = entry.get("id", "")
            status = entry.get("status", "unknown")
            apps = entry.get("splunk_apps_required") or []
            app_cells: list[str] = []
            for app in apps:
                if isinstance(app, dict):
                    app_id = app.get("id", "?")
                    app_min = app.get("min_version", "")
                    app_cells.append(
                        f"`{app_id}`" + (f" ≥ {app_min}" if app_min else "")
                    )
            apps_cell = ", ".join(app_cells) if app_cells else "—"
            verified = entry.get("verified_against") or {}
            if isinstance(verified, dict) and verified:
                verified_cell = ", ".join(f"{k}={v}" for k, v in verified.items())
            else:
                verified_cell = "—"
            path = entry.get("path", "")
            if path:
                rel_short = path[len("docs/") :] if path.startswith("docs/") else path
                page_url = url_for(site_url, rel_short)
                page_cell = f"[{path}]({page_url})"
            else:
                page_cell = "—"
            buf.write(
                f"| `{recipe_id}` | {label} | {status} | {apps_cell} | "
                f"{verified_cell} | {page_cell} |\n"
            )
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
