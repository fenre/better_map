# Runbook: better_map upgrade hygiene (G3)

This runbook tells an operator how to detect and remove **orphan files** left
behind by previous releases of the `better_map` Splunk app on a deployed
instance (lab, customer search head, indexer cluster member, etc).

## Background — why orphan files exist

Splunk's `update=true` REST install (`POST /services/apps/local`) extracts the
new tarball **on top of** the previous install but does **NOT** delete files
absent from the new tarball. Over multiple releases this silently accumulates:

- retired dashboards from previous versions
- removed lookups
- dropped `visualizations.conf` stanzas
- dev-only files that historically leaked into a release tarball
  (`node_modules/`, `src/`, `package*.json`, `webpack.config.js`, etc)

These orphans:

- waste disk
- can confuse audits ("what's this old dashboard doing in production?")
- can override new behaviour if Splunk's `btool` precedence happens to fall
  the wrong way
- can cause AppInspect re-vet failures on future cloud-vet runs

ROADMAP §3 G3 introduced the manifest + runbook contract to make this bug
class detectable and fixable.

## What G3 ships

| Artifact | Path | Purpose |
|---|---|---|
| Generator | `scripts/build-manifest.py` | Walks the source tree, applies the same exclude list as `release.yml`, writes `default/_better_map_manifest.json`. |
| Manifest | `better_map/default/_better_map_manifest.json` | List of every shippable file with its SHA-256 + size. Ships inside the release tarball. |
| CI gate | `scripts/check-manifest.py` | PR-blocking check that the checked-in manifest matches the source tree. |
| Runbook | `scripts/find-orphans.sh` | This procedure. SSHes into a deployed host, compares the file tree against the manifest, lists (and optionally deletes) orphans. |

## Procedure — detect orphans

### 1. Confirm the manifest is current for the version you're checking

```bash
python3 scripts/check-manifest.py
# Expected: [PASS] manifest matches source tree (...)
```

If FAIL: run `python3 scripts/build-manifest.py` and commit the result before
proceeding. The runbook compares the deployed install against the checked-in
manifest, so a stale manifest produces noisy false positives.

### 2. Run the runbook against the target host

The runbook expects passwordless SSH (recommended via `~/.ssh/config`
`Host` alias, e.g. `rev`):

```bash
bash scripts/find-orphans.sh --ssh-host rev
```

Or specify the SSH host via env / `secrets.env`:

```bash
echo "BETTER_MAP_SSH_HOST=rev" >> secrets.env
bash scripts/find-orphans.sh
```

The runbook will:

1. Read every shippable path from the manifest.
2. SSH to the host and list every file under
   `/opt/splunk/etc/apps/better_map/` (configurable via `--app-path`),
   pruning Splunk runtime/admin paths (`local/`, `default.old*`,
   `metadata/local.meta`).
3. Compute `installed - manifest = orphans`.
4. Group orphans into maximal "wholly-orphan directories" so a 47k-file
   stale `node_modules/` tree shows as a single line instead of 47,000.
5. Save the full list (with sizes) to a stable tempfile.
6. Print a verdict with total orphan count + total bytes.

### 3. Example output (rev, post-v1.6.3 install on top of v1.5 history)

```
[find-orphans]   files on rev: 51026

=== Orphan summary on rev (present on disk, NOT in manifest) ===
  Grouped (≥10 files per directory):
    appserver/static/react/                                       43935 files   445.8 MiB
    appserver/static/visualizations/better_map/node_modules/       7005 files    98.1 MiB
    appserver/static/visualizations/better_map/src/                  32 files   233.9 KiB
    appserver/static/pages/                                          11 files   109.2 MiB
  Individual orphan files:
    appserver/static/bm_bootstrap_test.css                          105.0 B
    appserver/static/bm_bootstrap_test.js                           1.9 KiB
    appserver/static/bm_react.bundle.js                            13.2 MiB
    appserver/static/bm_react.bundle.js.LICENSE.txt                 971.0 B
    appserver/static/bm_react.bundle.js.map                       344.3 KiB
    appserver/static/visualizations/better_map/docs/AIR-GAPPED-PMTILES.md    5.0 KiB
    appserver/static/visualizations/better_map/harness.json         2.8 KiB
    appserver/static/visualizations/better_map/package-lock.json  117.3 KiB
    appserver/static/visualizations/better_map/package.json         771.0 B
    appserver/static/visualizations/better_map/scripts/build-pmtiles.sh    3.7 KiB
    appserver/static/visualizations/better_map/webpack.config.js    2.5 KiB
  -----
  TOTAL: 50994 orphan files, 667.0 MiB

VERDICT: G3 50994 orphan(s) found on rev (667.0 MiB)
```

What you're seeing:

- `appserver/static/react/` — the entire v1.5 React source tree (including
  `node_modules/`). Should never have shipped.
- `appserver/static/visualizations/better_map/node_modules/` — viz dev
  dependencies that leaked into a past v1.5 / v1.6.0 install.
- `appserver/static/visualizations/better_map/src/` — viz source files.
  Same story.
- `appserver/static/pages/` — old paged React bundles (v1.5 try at a
  multi-page React surface).
- The 5 `bm_*` files in `appserver/static/` are individual v1.5 React
  bundles that have manifest siblings (e.g. `network_diagnostic.html`
  IS in the manifest), so they're listed individually.
- The 6 leaf files in the viz dir are dev-only artefacts that historically
  shipped — the v1.7+ release exclude list correctly drops them.

## Procedure — remove orphans

### Option A: small list (< 100 orphans), use the runbook's --delete

```bash
# Per-file confirmation (safe; recommended for small sets):
bash scripts/find-orphans.sh --ssh-host rev --delete

# One-shot, no prompts (use only after reviewing the dump in option B):
bash scripts/find-orphans.sh --ssh-host rev --delete --yes
```

The runbook does one SSH `rm -f` per file. Safe but slow for large sets.

### Option B: large group (e.g. node_modules tree), SSH in and rm -rf

For the `appserver/static/react/` and similar large-directory cases above,
the per-file `--delete` would take ~50,000 SSH calls. Faster and equally
safe (the runbook has already shown you the file boundaries):

1. Review the full orphan list at the path the runbook printed
   (`/tmp/better-map-orphans-<host>-<ts>.txt`).
2. SSH in once and remove the wholly-orphan directories with `rm -rf`:

   ```bash
   ssh rev
   cd /opt/splunk/etc/apps/better_map

   # Verify you're about to delete what you expect:
   ls appserver/static/react/         # 43k files of v1.5 React tree
   ls appserver/static/pages/         # old paged React bundles
   ls appserver/static/visualizations/better_map/node_modules/
   ls appserver/static/visualizations/better_map/src/

   # Then remove:
   sudo rm -rf appserver/static/react/
   sudo rm -rf appserver/static/pages/
   sudo rm -rf appserver/static/visualizations/better_map/node_modules/
   sudo rm -rf appserver/static/visualizations/better_map/src/

   # And the individual leaves:
   sudo rm -f appserver/static/bm_bootstrap_test.*
   sudo rm -f appserver/static/bm_react.bundle.js*
   sudo rm -f appserver/static/visualizations/better_map/docs/AIR-GAPPED-PMTILES.md
   sudo rm -f appserver/static/visualizations/better_map/harness.json
   sudo rm -f appserver/static/visualizations/better_map/package*.json
   sudo rm -f appserver/static/visualizations/better_map/scripts/build-pmtiles.sh
   sudo rm -f appserver/static/visualizations/better_map/webpack.config.js

   # Restart splunkd to drop any cached references to deleted .conf files
   # (and to trigger appserver/static asset re-scan):
   sudo /opt/splunk/bin/splunk restart
   ```

3. Re-run the runbook to confirm zero orphans:

   ```bash
   bash scripts/find-orphans.sh --ssh-host rev
   # Expected: VERDICT: G3 zero orphans (clean install on rev)
   ```

### Option C: nuke + reinstall (cleanest, requires downtime)

If the orphan accumulation is severe and you're comfortable with downtime:

```bash
ssh rev
sudo /opt/splunk/bin/splunk stop
sudo rm -rf /opt/splunk/etc/apps/better_map
sudo /opt/splunk/bin/splunk start
# Then redeploy v1.7+ via REST, scripts/deploy-app.sh, or Splunk Web UI.
```

This is the only way to also remove `default.old*` backup directories that
Splunk created on previous `update=true` installs (the runbook prunes them
from orphan detection because they're Splunk-generated, but they still
occupy disk).

## Procedure — prevent future orphans

The v1.7+ release workflow already prevents the leak class that caused
the rev orphans above (it `rsync`'s only shippable files into the release
staging directory and explicitly excludes `src/`, `node_modules/`, etc).
The `check-manifest.py` CI gate prevents the manifest itself from
drifting from the source tree.

The remaining orphan-class — files that USED TO ship but no longer do
(e.g. a retired dashboard XML) — is detectable by the runbook above on
any upgrade. Operators should run `find-orphans.sh` against the target
instance as a release acceptance step:

```
1. tag → release workflow → tarball published
2. deploy via REST install (update=true)
3. run find-orphans.sh --ssh-host <target>  ← new acceptance step
4. zero orphans = clean upgrade
5. >0 orphans = either delete (Option B above) or document in the
   release CHANGELOG as known-orphans
```

## CI integration

The `check-manifest.py` gate runs on every PR (see `.github/workflows/ci.yml`)
and on every release tag (see `.github/workflows/release.yml`). It does NOT
require a deployed Splunk instance — it just regenerates the manifest from
the source tree and asserts byte-for-byte equality with the checked-in
manifest. A future enhancement (ROADMAP §3 G3 follow-up) will add a D5
end-to-end test that installs v(N-1) then vN against a container and asserts
the runbook reports zero orphans.

## See also

- `scripts/build-manifest.py` — manifest generator (source of truth)
- `scripts/check-manifest.py` — PR/release CI gate
- `scripts/find-orphans.sh` — this runbook's executable
- ROADMAP §3 G3 — design rationale, prereqs, risks
- ROADMAP §1c — finding catalogue (gap 16 onwards documents observed
  orphans and verification rows)
