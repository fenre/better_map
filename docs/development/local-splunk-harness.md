---
title: Local Splunk harness
description: >-
  Boot a real Splunk Enterprise in Docker, install the freshly-built
  better_map app, and smoke-test every dashboard's SPL via REST — the
  D5 Phase 1 maintainer workflow.
---

# Local Splunk harness

A working Splunk Enterprise instance on your laptop is the cheapest
place to catch the class of bugs that static gates miss — a typo in
`visualizations.conf` that registers the wrong viz type, an SPL that
parses but emits a warning at dispatch, a CDATA closing tag the XML
parser accepts but Splunk Web cannot render. This page is the
operator-facing how-to for the D5 Phase 1 harness.

The harness gives you:

- A **Splunk Enterprise container** running in Docker, reachable at
  `http://localhost:8000` (UI) and `https://localhost:8089` (REST).
- A **bootstrap script** that builds the app tarball, installs it
  into Splunk via the REST API, mints a long-lived bearer token, and
  writes a `secrets.env` file so every helper script Just Works.
- A **dispatch-test rig** that walks every Dashboard Studio
  dashboard, extracts each `ds.search` query, runs it against the
  live Splunk, and fails non-zero if any query produces an
  error/fatal message.

It does NOT yet give you Playwright in-browser rendering (D5 Phase 2)
or a CI integration (deferred — see "Why CI integration is deferred"
below).

## Prerequisites

- **Docker** — Docker Desktop, Colima, OrbStack, Podman with the
  `docker` shim, or a native Docker Engine install. `docker compose`
  subcommand support (Docker 20.10 or newer).
- **~6 GB RAM free** — Splunk Enterprise plus its first-boot ansible
  playbook is heavy. Splunk's documented minimum is 4 GB; allow 6 GB
  of headroom so MacBook Pros with `mem-overcommit` enabled don't
  thrash.
- **Ports 8000, 8088, 8089 free** — override via `docker/.env` if any
  collide.
- **Node 18+** and **Python 3.9+** on the host — needed to build the
  app tarball (`npm run build`) and run the dispatch-test rig
  respectively. Both are already required for any other repo work.

## Quick start

```bash
# 1. Configure the harness.
cp docker/.env.example docker/.env
# Edit docker/.env: set SPLUNK_PASSWORD (>=8 chars, mixed) and
# SPLUNK_HEC_TOKEN (any uuid4, e.g. `python3 -c "import uuid; print(uuid.uuid4())"`).

# 2. Boot Splunk, build the app, install it, write secrets.env.
bash docker/scripts/bootstrap.sh

# 3. Smoke-test every dashboard.
python3 scripts/dispatch-test.py

# 4. (When done) tear down + wipe state.
bash docker/scripts/teardown.sh
```

Expected first-boot time: 2–4 minutes (Splunk's ansible playbook
plus the app install + restart). Re-running `bootstrap.sh` after the
first boot is ~30 s because the splunk container is already healthy.

## What `bootstrap.sh` does, step by step

1. **Validates prerequisites** — Docker present, `docker compose`
   available, `docker/.env` exists, `SPLUNK_PASSWORD` is not the
   placeholder.
2. **Starts the container** — `docker compose up -d splunk` with the
   port mappings and env vars from `docker/.env`.
3. **Waits for splunkd** — polls
   `https://localhost:8089/services/server/info` with basic auth
   until 200 OK (deadline: 10 minutes; first boot ≈ 1–2 minutes).
4. **Mints a REST bearer token** — calls `splunk add token` inside
   the container, scoped to admin, audience
   `better_map_harness_<timestamp>`, 30-day expiry. The token is
   long-lived so you don't have to re-run bootstrap every time you
   close your laptop.
5. **Builds the tarball** (unless `--skip-build`) — runs
   `npm run build` if `visualization.js` is missing, then stages the
   app tree via the same rsync rules `scripts/run-appinspect-local.sh`
   and `.github/workflows/release.yml` use (strip `node_modules`,
   `src`, `scripts`, build config, `harness.json`). Output:
   `docker/staging/better_map-local.tar.gz`.
6. **Installs the app** (unless `--skip-install`) — POSTs to
   `/services/apps/local` with `name=/staging/better_map-local.tar.gz`
   `filename=true` `update=true`. The `/staging` directory is bind-
   mounted into the container, so splunkd sees the path on its own
   filesystem and accepts it without the multipart-upload gotcha
   documented in
   `~/.cursor/skills/splunk-remote-app-deploy/SKILL.md`.
7. **Restarts splunkd** — POST `/services/server/control/restart`,
   then polls `/services/server/info` until back up.
8. **Writes `secrets.env`** — at the repo root, chmod 600, with
   `SPLUNK_HOST=localhost`, `SPLUNK_PORT=8089`, the minted
   `SPLUNK_TOKEN`, the HEC port + token, and `SPLUNK_INSECURE=1` for
   the self-signed lab cert.

After bootstrap completes, `secrets.env` is the single point of
truth every helper script reads (`scripts/check-splunk-messages.sh`,
`scripts/dispatch-test.py`, anything you add later).

## What `dispatch-test.py` does

```bash
python3 scripts/dispatch-test.py
python3 scripts/dispatch-test.py --filter overview
python3 scripts/dispatch-test.py --verbose
python3 scripts/dispatch-test.py --timeout 120
```

1. Loads `secrets.env`, validates `SPLUNK_HOST` and `SPLUNK_TOKEN`.
2. Pre-flight `GET /services/server/info` — fails fast if the token
   is rejected or splunkd is unreachable.
3. Walks `better_map/default/data/ui/views/*.xml`, parses each
   Dashboard Studio dashboard's CDATA JSON, extracts every
   `ds.search` query.
4. For each query:
   - `POST /servicesNS/nobody/better_map/search/jobs`
     `search=<spl>` `exec_mode=normal` `earliest_time=-24h@h`
     `latest_time=now`.
   - Polls the returned `sid` until `isDone=true` (timeout: 60 s by
     default; override with `--timeout`).
   - Collects the `messages` array from the job content.
5. Classifies messages: `info` / `warn` / `error` / `fatal`. A
   dashboard FAILs if any of its queries returns an `error` or
   `fatal`; WARNs if any returns a `warn` but no errors; PASSes
   otherwise.
6. Prints a per-dashboard report and exits 0 / 1.

Today's repo has **13 dashboards / 66 queries**. Expected wall-clock:
30–60 s on a warm Splunk (all queries use `| makeresults` so they
don't touch any real index).

## Talking to a remote Splunk instead of the local harness

Hand-edit `secrets.env` to point at any reachable Splunk:

```sh
SPLUNK_HOST=splunk.example.com
SPLUNK_PORT=8089
SPLUNK_TOKEN=eyJ...
SPLUNK_INSECURE=1   # only against lab/rev with self-signed certs
```

`scripts/dispatch-test.py` and `scripts/check-splunk-messages.sh`
both work identically against a remote tenant — useful when a
maintainer with live-Splunk access wants to flip an E5 recipe's
status from `unverified` to `verified` (see
[recipes index](../recipes/index.md)).

`docker/scripts/teardown.sh` deliberately preserves `secrets.env`
if it points anywhere other than `localhost`, so the harness
teardown doesn't clobber a remote-tenant config.

## Common failure modes

### `bootstrap.sh` exits with "splunkd did not come up within 10 minutes"

Almost always low memory. Check Docker's per-container memory limit
in Docker Desktop → Settings → Resources; allocate at least 4 GB.
Then `docker logs better_map_splunk --tail 100` for the splunk-
ansible failure message.

### `dispatch-test.py` reports `error: timeout: job <sid> did not complete within 60s`

A real Splunk searching against a real index would hit this; the
13 starter dashboards all use `| makeresults` so they shouldn't.
Re-run with `--timeout 180` and `--filter <name>` to isolate the
specific dashboard, then inspect the SPL — usually a `streamstats`
without a partitioning key against high-cardinality data.

### `dispatch-test.py` reports HTTP 401 on the pre-flight

The token expired (30-day default). Re-run `bash
docker/scripts/bootstrap.sh` — it mints a fresh one and rewrites
`secrets.env`.

### `bootstrap.sh` reports HTTP 400 "Unparsable URI-encoded request data" on the install step

The skill at `~/.cursor/skills/splunk-remote-app-deploy/SKILL.md`
documents the cause: somebody changed the install POST from
URL-encoded `name=<path>` `filename=true` to a multipart body.
splunkd:8089 does not accept multipart. Revert.

### Splunk Web shows the better_map app but `dispatch-test.py` reports HTTP 404 on every query

Namespace mismatch — usually means the app installed under a
different folder name than `better_map`. The dispatch URL uses
`/servicesNS/nobody/better_map/...`; if you forked the app, set
`SPLUNK_NAMESPACE=nobody:<your-app-id>` in `secrets.env`.

## Why CI integration is deferred

The ROADMAP §3 D5 design calls for the dispatch test to run on every
PR via GitHub Actions. That's the right end state, but two
constraints push it past Phase 1:

- **Memory.** Splunk Enterprise in Docker is ≥ 4 GB RAM per
  container. GitHub Actions free runners have 7 GB total RAM; the
  job would OOM under any non-trivial concurrent workload (Node +
  webpack already use 2–3 GB during the bundle build).
- **Splunk version matrix.** D5's full design ships a 10.2 × 10.3
  matrix. Doubling the runner cost or sequencing two Splunk boots
  back-to-back into one 7 GB runner is fragile.

The right answer is either a self-hosted runner or Splunk's own
cloud CI minutes (per the ROADMAP §3 D5 risk note). Until that
decision lands, the dispatch test is a maintainer-driven gate
runnable in 1–2 minutes wall-clock, which captures most of the
value with none of the runner-sizing churn.

## Cleaning up

`bash docker/scripts/teardown.sh` (no args) stops the container,
drops the named volumes (`better_map_splunk_etc`,
`better_map_splunk_var`), clears `docker/staging/`, and removes
`secrets.env` only if it was generated against the local harness
(`SPLUNK_HOST=localhost`).

Pass `--keep-volumes` to preserve indexed data + app installs
across a teardown — useful when you want to swap to a different
better_map branch and re-test without re-ingesting any data.
