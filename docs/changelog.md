---
title: Changelog
description: Release history for Better Map.
---

# Changelog

The authoritative changelog lives at
[`CHANGELOG.md`](https://github.com/fenre/better_map/blob/main/CHANGELOG.md)
in the repo root and is generated from conventional commits by the
release workflow.

This page mirrors the file via the `include-markdown` plugin so the
site stays in sync with the repo.

{%
  include-markdown "../CHANGELOG.md"
  comments=false
  heading-offset=1
%}

## How releases are produced

See the [release flow](contributing.md#release-flow) in the
contributing guide. Every release tarball is signed with cosign
keyless and ships with a CycloneDX 1.6 SBOM — see the
[supply-chain runbook](runbooks/supply-chain.md) for the verification
recipe.
