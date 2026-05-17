#!/usr/bin/env python3
"""
G3 — Build the better_map ship manifest.

Walks the `better_map/` source tree, applies the canonical SHIPPABLE-files
filter (mirror of the `release.yml` rsync exclude list and the AppInspect
staging step in `ci.yml`), computes SHA-256 + size per file, and emits a
deterministic JSON manifest sorted by path.

Why this exists
---------------
The 2026-05-16 v1.6.2 deploy left two orphan dashboards
(`better_map_test_install`, `bm_react_test`) from prior v1.5 installs on
disk. Splunk's `update=true` REST install extracts the new tarball on top
of the previous one but does NOT delete files absent from the new tarball.
Without a manifest checked into the release, an operator cannot
deterministically detect orphans on a deployed instance, and every release
silently accumulates them.

This script generates the source-of-truth manifest. Its peer
`scripts/check-manifest.py` is the CI gate that asserts the checked-in
manifest matches the source tree, so the manifest cannot drift from what
the release tarball would actually contain. The operator runbook
`scripts/find-orphans.sh` consumes the manifest to detect (and optionally
delete) orphans on a deployed Splunk instance.

Scope decisions
---------------
1. The manifest IS shipped inside the release tarball at
   `default/_better_map_manifest.json` — that way the operator runbook
   can read the canonical file list from the installed app itself,
   without having to fetch a separate artifact.

2. The manifest is excluded from its own file list (chicken-and-egg: a
   self-hash would change every time the manifest is regenerated, which
   is also every time any file changes). Its presence is verified by
   the `check-manifest.py` gate; its correctness is verified by drift
   detection against the source tree.

3. The exclude list is a Python literal mirror of the `release.yml`
   `rsync --exclude=...` flags. When that list changes, this script
   MUST change in the same PR. A future refactor into a shared
   `scripts/package-app.sh` (tracked as a G2-2 follow-up) will collapse
   the duplication.

4. We do NOT recurse into `node_modules/` or any other excluded
   directory (we prune `dirs[]` in the os.walk) — keeps a v1.6.3
   regeneration under 50 ms even with 30+ MB of dev deps on disk.

Run modes
---------
Default          write to `better_map/default/_better_map_manifest.json`
                 with the format described in `Output format`.
`--stdout`       print the same JSON to stdout instead of writing the
                 file. Used by `check-manifest.py` to diff against the
                 checked-in manifest without touching disk.

Output format (JSON, indent=2, sorted by path):
{
  "_comment": "<human note>",
  "app_version": "1.6.3",          // from default/app.conf [launcher]
  "generator": "scripts/build-manifest.py",
  "file_count": 34,
  "total_size_bytes": 1234567,
  "files": [
    {"path": "default/app.conf", "sha256": "<hex>", "size_bytes": 123},
    ...
  ]
}

Exit codes:
  0 — success
  1 — IO / parse error
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "better_map"
MANIFEST_PATH = APP_ROOT / "default" / "_better_map_manifest.json"
APP_CONF = APP_ROOT / "default" / "app.conf"

# Mirror of release.yml `rsync --exclude=...` flags and the AppInspect
# staging step in ci.yml. Paths are relative to APP_ROOT and use forward
# slashes; they match either a directory (in which case everything
# beneath it is excluded) or an exact file.
#
# When this list changes, the corresponding `--exclude=` lines in
# .github/workflows/release.yml AND .github/workflows/ci.yml MUST change
# in the same PR. A future refactor into a shared `scripts/package-app.sh`
# (tracked as a G2-2 follow-up) will collapse this duplication.
SHIP_EXCLUDES_REL = {
    "appserver/static/visualizations/better_map/node_modules",
    "appserver/static/visualizations/better_map/src",
    "appserver/static/visualizations/better_map/scripts",
    "appserver/static/visualizations/better_map/docs",
    "appserver/static/visualizations/better_map/package.json",
    "appserver/static/visualizations/better_map/package-lock.json",
    "appserver/static/visualizations/better_map/webpack.config.js",
    "appserver/static/visualizations/better_map/.eslintrc.cjs",
    "appserver/static/visualizations/better_map/.eslintignore",
    "appserver/static/visualizations/better_map/.npmrc",
    "appserver/static/visualizations/better_map/harness.json",
    # docs/ exclude already catches AIR-GAPPED-PMTILES.md
    # scripts/ exclude already catches build-pmtiles.sh
}

# Filenames to drop regardless of location (macOS dotfiles, resource forks).
SKIP_NAMES = {".DS_Store"}
SKIP_NAME_PREFIXES = ("._",)

# Path of the manifest itself, relative to APP_ROOT. Excluded from its
# own file list to break the self-referential hash cycle (see header
# scope decision #2).
MANIFEST_REL = "default/_better_map_manifest.json"


def _is_excluded(rel_posix: str) -> bool:
    """Return True if `rel_posix` (POSIX path relative to APP_ROOT) is excluded from ship."""
    if rel_posix == MANIFEST_REL:
        return True
    if rel_posix in SHIP_EXCLUDES_REL:
        return True
    for prefix in SHIP_EXCLUDES_REL:
        # SHIP_EXCLUDES_REL holds dir-or-file paths; a file under an
        # excluded dir is also excluded (prefix + '/' to avoid sibling
        # name collisions like `srcfoo` matching `src`).
        if rel_posix.startswith(prefix + "/"):
            return True
    return False


def _walk_shippable() -> Iterable[Path]:
    """Yield absolute paths of files that ship in the release tarball."""
    for root, dirs, files in os.walk(APP_ROOT):
        # Prune excluded subtrees in-place so we don't recurse into
        # node_modules/ (huge), src/, docs/, etc.
        pruned = []
        for d in dirs:
            full = Path(root) / d
            rel = full.relative_to(APP_ROOT).as_posix()
            if _is_excluded(rel):
                continue
            pruned.append(d)
        dirs[:] = pruned

        for f in files:
            if f in SKIP_NAMES or any(f.startswith(p) for p in SKIP_NAME_PREFIXES):
                continue
            full = Path(root) / f
            rel = full.relative_to(APP_ROOT).as_posix()
            if _is_excluded(rel):
                continue
            yield full


def _sha256(path: Path) -> str:
    """SHA-256 of file contents, streamed in 64 KiB chunks."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _app_version() -> str:
    """Extract `[launcher] version` from `default/app.conf` for the manifest header."""
    if not APP_CONF.exists():
        return "unknown"
    in_launcher = False
    for line in APP_CONF.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            in_launcher = s == "[launcher]"
            continue
        if in_launcher and s.startswith("version") and "=" in s:
            return s.split("=", 1)[1].strip()
    return "unknown"


def build_manifest() -> dict:
    """Walk the source tree and return the manifest dict ready for JSON dump."""
    files = sorted(_walk_shippable(), key=lambda p: p.relative_to(APP_ROOT).as_posix())
    entries: list[dict] = []
    total_bytes = 0
    for path in files:
        rel = path.relative_to(APP_ROOT).as_posix()
        size = path.stat().st_size
        total_bytes += size
        entries.append(
            {
                "path": rel,
                "sha256": _sha256(path),
                "size_bytes": size,
            }
        )

    return {
        "_comment": (
            "Generated by scripts/build-manifest.py. Do NOT edit by hand. "
            "Lists every file that ships in the better_map release tarball "
            "(canonical mirror of release.yml rsync exclude-list). The "
            "manifest itself is excluded from its own file list; CI gate "
            "scripts/check-manifest.py verifies this artifact matches the "
            "source tree. Operator runbook scripts/find-orphans.sh consumes "
            "this manifest to detect orphan files on a deployed Splunk "
            "instance. See ROADMAP \u00a73 G3."
        ),
        "app_version": _app_version(),
        "generator": "scripts/build-manifest.py",
        "file_count": len(entries),
        "total_size_bytes": total_bytes,
        "files": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the better_map ship manifest (G3).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help=(
            "Print manifest JSON to stdout instead of writing it to "
            "better_map/default/_better_map_manifest.json. Used by "
            "scripts/check-manifest.py for drift detection."
        ),
    )
    args = parser.parse_args()

    if not APP_ROOT.is_dir():
        print(f"[FAIL] app root missing: {APP_ROOT}", file=sys.stderr)
        return 1

    manifest = build_manifest()
    # `sort_keys=False` to keep our top-level field order
    # (_comment, app_version, generator, file_count, total_size_bytes, files)
    # which reads more naturally than alphabetical (files would come second).
    text = json.dumps(manifest, indent=2, sort_keys=False) + "\n"

    if args.stdout:
        sys.stdout.write(text)
        return 0

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(text, encoding="utf-8")
    print(
        f"Wrote {MANIFEST_PATH.relative_to(REPO_ROOT)}: "
        f"{manifest['file_count']} files, "
        f"{manifest['total_size_bytes']:,} bytes, "
        f"app v{manifest['app_version']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
