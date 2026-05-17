# Supply-chain runbook — better_map (ROADMAP §3 G1)

This runbook covers everything a customer, auditor, or release manager
needs to know about better_map's supply-chain posture: which gates run
in CI, how releases are signed, how to verify what you've downloaded,
how to consume the SBOM, and how to manage CVE waivers.

It is the operational companion to ROADMAP §3 **G1 Security audit +
supply-chain hardening** and §7d (the security checklist for the v2.0
defensibility claim).

> Quick links:
> - [Verifying a downloaded release](#verifying-a-downloaded-release)
> - [What the SBOM contains](#what-the-sbom-contains)
> - [Managing CVE waivers](#managing-cve-waivers)
> - [Replacing a copyleft transitive dep](#replacing-a-copyleft-transitive-dep)
> - [What to do when Dependabot opens a PR](#what-to-do-when-dependabot-opens-a-pr)

---

## What ships in a release

Every tagged release at
[github.com/fenre/better_map/releases](https://github.com/fenre/better_map/releases)
includes **nine** files for each version `vX.Y.Z`:

| Group | Files | Purpose |
|---|---|---|
| Install media | `better_map-vX.Y.Z.tar.gz`, `better_map-vX.Y.Z.spl` | The Splunk app archive. Both extensions are accepted by Splunkbase + AppInspect; the files are byte-identical. |
| Integrity | `*.sha256` | SHA-256 sidecar files, one per install-media + SBOM file. Verify with `sha256sum -c`. |
| Provenance | `*.cosign.bundle` | Sigstore keyless signature bundles (signature + cert + Rekor proof) for each install-media + SBOM file. Verify with `cosign verify-blob`. |
| Software bill of materials | `better_map-vX.Y.Z.sbom.json` | CycloneDX 1.5 JSON SBOM of every runtime dependency (production tree only — dev deps excluded). |

---

## Verifying a downloaded release

Two checks. Run both before installing on a production Splunk instance.

### 1. SHA-256 (catches network errors / tampered hosting)

```bash
VERSION="1.7.0"
sha256sum -c "better_map-v${VERSION}.tar.gz.sha256"
# expected: better_map-v1.7.0.tar.gz: OK
```

### 2. Cosign signature (catches malicious replacement)

Requires `cosign` ≥ 2.0:

```bash
brew install cosign        # macOS
# OR:
go install github.com/sigstore/cosign/v2/cmd/cosign@latest
```

Verify the tarball:

```bash
VERSION="1.7.0"
cosign verify-blob \
  --bundle "better_map-v${VERSION}.tar.gz.cosign.bundle" \
  --certificate-identity-regexp '^https://github\.com/fenre/better_map/\.github/workflows/release\.yml@refs/tags/v[0-9.]+$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "better_map-v${VERSION}.tar.gz"
# expected: Verified OK
```

What this proves:

- The artifact was signed by the official release workflow
  (`.github/workflows/release.yml`) on the official GitHub repo.
- It was signed at the tag identified in the bundle (verifiable in the
  Rekor transparency log at <https://search.sigstore.dev/>).
- No one with a fork or a different workflow could have produced this
  signature — the OIDC identity is bound to the source repo path.

Repeat for `.spl` and `.sbom.json`:

```bash
cosign verify-blob --bundle "better_map-v${VERSION}.spl.cosign.bundle" \
  --certificate-identity-regexp '^https://github\.com/fenre/better_map/\.github/workflows/release\.yml@refs/tags/v[0-9.]+$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "better_map-v${VERSION}.spl"

cosign verify-blob --bundle "better_map-v${VERSION}.sbom.json.cosign.bundle" \
  --certificate-identity-regexp '^https://github\.com/fenre/better_map/\.github/workflows/release\.yml@refs/tags/v[0-9.]+$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "better_map-v${VERSION}.sbom.json"
```

### 3. Inspect the Rekor transparency log (optional, auditor flow)

The bundle includes a Rekor inclusion proof. Each signature is also
discoverable on the public log:

```bash
cosign tree better_map-v${VERSION}.tar.gz.cosign.bundle
```

Or browse <https://search.sigstore.dev/> and paste the SHA-256 of the
tarball.

---

## What the SBOM contains

`better_map-vX.Y.Z.sbom.json` is a [CycloneDX 1.6](https://cyclonedx.org/specification/overview/)
JSON SBOM produced by `@cyclonedx/cyclonedx-npm@^4` against the runtime
dependency tree (the lockfile under `--omit=dev`). As of v1.7.0 the
better_map runtime tree resolves to **186 components**, all
permissively licensed (per
[`scripts/license-allowlist.json`](https://github.com/fenre/better_map/blob/main/scripts/license-allowlist.json)).

Scope:

| Included | Excluded |
|---|---|
| Every dep installed by `npm ci --omit=dev` | All dev-only deps (eslint, webpack, vitest, prettier, …) |
| Direct + transitive | Anything not actually packaged into `visualization.js` |

Per dependency the SBOM records:

- name, version, purl, supplier (when declared)
- SHA-512 hash of the package tarball
- declared SPDX license id (or licence expression)
- upstream URL

### What you can do with the SBOM

- **Quick license audit**: `jq '.components[] | {name, license: .licenses[0].license.id}' better_map-v1.7.0.sbom.json`
- **CVE re-scan with osv-scanner**: `osv-scanner --format=table --sbom better_map-v1.7.0.sbom.json`
- **Diff vs the previous release**: `diff <(jq -S '.components' v1.6.3.sbom.json) <(jq -S '.components' v1.7.0.sbom.json)`
- **Splunkbase legal review**: drop into the legal review packet as
  evidence of the redistributable third-party content. Every license id
  is on better_map's
  [allowlist](https://github.com/fenre/better_map/blob/main/scripts/license-allowlist.json).

---

## CI gates that run on every PR

| Gate | Script / step | Threshold |
|---|---|---|
| npm audit | `scripts/check-npm-audit.py` | FAIL on `high`+ without active waiver |
| License allowlist | `scripts/check-license-allowlist.py` | FAIL on any non-allowlisted SPDX id |
| OSV-Scanner | `scripts/check-osv-report.py` | FAIL on `high`+ without active waiver (shared waiver file) |
| AppInspect (cloud + future) | inline step in `ci.yml` | FAIL on error / failure / future_failure |

Plus the existing functional gates (G3 manifest, Q-1 dashboard XML/JSON,
Q-1B dashboard ↔ token contract, Q-2 console noise, Q-3 bundle size,
G8 JS↔CSS contract, REL-1 version consistency, vitest unit tests).

---

## Managing CVE waivers

Waivers live in [`scripts/npm-audit-waivers.json`](https://github.com/fenre/better_map/blob/main/scripts/npm-audit-waivers.json)
and are honoured by BOTH the npm-audit gate and the OSV-Scanner gate (one
CVE, one waiver, one decision).

Each waiver requires:

```json
{
  "ghsa_id": "GHSA-xxxx-xxxx-xxxx",
  "package": "the-vulnerable-package-name",
  "severity": "high",
  "reason": "Not exploitable in better_map because: the CVE requires <X> which better_map does not <Y> at <specific file:line>. Verified by <evidence>.",
  "owner": "github-username",
  "added": "YYYY-MM-DD",
  "expires": "YYYY-MM-DD"
}
```

Hard rules:

1. `expires` MUST be ≤ 90 days from `added`. The gate refuses longer
   windows; expired waivers FAIL the build, forcing re-justification or
   actual fix.
2. `reason` MUST cite a specific code path — "not exploitable in our
   usage" without evidence is not acceptable.
3. The PR that adds or extends a waiver MUST tag the security reviewer
   listed in `CODEOWNERS` for `scripts/npm-audit-waivers.json` (once
   that is set up — see ROADMAP §3 G2 follow-up).

### Adding a waiver — worked example

1. CI fails with:
   ```
   high      foo@1.2.3   GHSA-abcd-efgh-ijkl   un-waived
   ```
2. Read the advisory at `https://github.com/advisories/GHSA-abcd-efgh-ijkl`.
3. Confirm `foo` is in better_map (`npm ls foo` in the viz dir). If it
   is dev-only, the gate shouldn't even see it — file a separate issue.
4. Read the actual vulnerable code path in `node_modules/foo/`. Decide
   whether better_map invokes it.
5. If not exploitable, append to `waivers`:
   ```json
   {
     "ghsa_id": "GHSA-abcd-efgh-ijkl",
     "package": "foo",
     "severity": "high",
     "reason": "GHSA-abcd-efgh-ijkl exploits foo.parse(opts) with an attacker-controlled `opts.bar`. better_map calls foo.parse(<literal>) at src/lib/example.js:42, so the attacker-controlled path is unreachable.",
     "owner": "fenre",
     "added": "2026-05-17",
     "expires": "2026-07-30"
   }
   ```
6. Open a PR. Re-run CI. The waiver gate should now log `WAIVED`.

---

## Replacing a copyleft transitive dep

The license-allowlist gate (`scripts/check-license-allowlist.py`)
FAILs when any runtime dep lands on a license outside MIT / BSD /
Apache-2.0 / CC0 / ISC and the small set in
`scripts/license-allowlist.json`. If a transitive update pulls in a
copyleft dep, you have four options in order of preference:

1. **Upgrade the parent dep** — usually a patch bump of the parent
   already moves to a non-copyleft transitive.
2. **Add a dual-license pick** — if the dep is `(MPL-2.0 OR Apache-2.0)`
   style, add an entry to `dual_license_pick` selecting the permissive
   side. Verify the upstream LICENSE file actually lists both options.
3. **Vendor a fork** — fork the offending dep under a permissive
   licence (only if the upstream allows it). Last resort; carries
   indefinite maintenance burden.
4. **Drop the parent dep** — replace with a permissively-licensed
   alternative. The right answer for non-critical features.

NEVER add a copyleft licence to `allowed_spdx`. The allowlist is a hard
legal contract; relaxing it requires legal-team review, not engineering
discretion.

---

## What to do when Dependabot opens a PR

Dependabot opens weekly grouped PRs (one for runtime deps, one for dev
deps, one for GitHub Actions). Each PR triggers the full CI pipeline:
npm audit + license + OSV-Scanner + AppInspect + bundle-size + everything
else.

Triage rule of thumb:

| CI status | Action |
|---|---|
| All gates green | Merge after smoke-testing v1.x bundle locally on `rev`. Tag a patch release if customer-visible. |
| `check-npm-audit` FAILs | A new advisory hit a dep. Read the advisory; either accept the bump (if it fixes the CVE) or add a waiver. |
| `check-license-allowlist` FAILs | A transitive update pulled in a copyleft licence. See [Replacing a copyleft transitive dep](#replacing-a-copyleft-transitive-dep). |
| `check-bundle-size` FAILs | The bump bloated the bundle past the §7c budget. Decide: roll back, code-split, or raise the budget (the latter only with explicit ROADMAP edit). |
| AppInspect WARN newly raised | Read the message; usually a deprecation. File against the next release. |
| AppInspect FAIL | Block the merge until fixed. |

The Dependabot bot will rebase automatically when main moves. If a PR
sits open > 14 days without merge, close it explicitly — leaving it
open indefinitely is worse than declining the bump.

---

## Splunkbase submission — what we hand the reviewer

For each release that gets submitted to Splunkbase:

1. The `.spl` and `.tar.gz` from the GitHub Release.
2. The `.sbom.json` from the GitHub Release.
3. The signed `.cosign.bundle` files (proof that the artifacts came
   from the GitHub Release workflow).
4. The latest `appinspect-report-vX.Y.Z` artifact (zero error, zero
   warning per the release-gate policy).
5. This runbook URL, so the Splunkbase reviewer can re-verify the
   signatures themselves.

The combined package answers every supply-chain question Splunkbase
or any enterprise legal team has historically asked.

---

## Roadmap follow-ups

Tracked under ROADMAP §3 G1 / §7d:

- **Cosign verification in the install path** — extend the
  REST-install runbook in `scripts/install-app.sh` to call
  `cosign verify-blob` before extracting. Currently optional;
  defence-in-depth makes it mandatory.
- **CODEOWNERS for the waiver file** — ROADMAP §3 G2 once a
  multi-reviewer org is in place; today the project owner is the only
  reviewer so the gate is enough.
- **OSV-Scanner scheduled scan** — separate workflow (`scan-scheduled.yml`)
  that runs the `google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml`
  weekly and posts findings to the GitHub Security tab. Defence
  against "main is green but a new advisory dropped overnight".
